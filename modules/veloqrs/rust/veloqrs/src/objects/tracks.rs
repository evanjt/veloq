//! The attempt-store side of the GPS track download.
//!
//! A bulk run asks for each activity under its own key, so a track that fails
//! is remembered by the engine and backs off on the store's schedule rather
//! than on a timer in the caller. A run re-offers its failures itself, up to
//! `MAX_TRACK_PASSES` passes, and what still fails is left in the store for the
//! next run to find held back.

use crate::persistence::attempts::{Claim, JobKey, Release};

use super::start::FfiStartOutcome;

/// Passes in total, counting the first.
pub(crate) const MAX_TRACK_PASSES: u32 = 3;

/// The longest a run waits inside itself for a failed track to free. A key a
/// run before this one pushed far into its backoff is left to the next run.
pub(crate) const MAX_RETRY_WAIT_MS: i64 = 10_000;

pub(crate) fn track_key(activity_id: &str) -> JobKey {
    JobKey::new("gps_track", &[activity_id])
}

/// What a pass owes after asking the store about its ids.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct TrackClaims {
    /// Ids this pass holds the lease on, and so fetches.
    pub taken: Vec<String>,
    /// Ids another run holds. That run stores them, so this one neither
    /// fetches nor reports them.
    pub in_flight: Vec<String>,
    /// Ids still inside a backoff, with when the earliest frees.
    pub backing_off: Vec<String>,
    pub frees_at: Option<i64>,
}

pub(crate) fn sort_claims(verdicts: Vec<(String, Claim)>) -> TrackClaims {
    let mut claims = TrackClaims::default();
    for (id, verdict) in verdicts {
        match verdict {
            Claim::Taken => claims.taken.push(id),
            Claim::InFlight => claims.in_flight.push(id),
            Claim::BackingOff { until } => {
                claims.frees_at = Some(claims.frees_at.map_or(until, |at| at.min(until)));
                claims.backing_off.push(id);
            }
        }
    }
    claims
}

/// How a failed download is released. A request that never reached the server
/// says nothing about the activity, so it frees the lease without growing the
/// backoff.
pub(crate) fn failure_release(error: &str) -> Release {
    if error.starts_with("transport error") {
        Release::Deferred
    } else {
        Release::failed(FfiStartOutcome::Failed, Some(error))
    }
}

/// Whether a failure says the network is absent, so a retry now is wasted.
pub(crate) fn network_absent(error: &str) -> bool {
    error.starts_with("transport error")
}

/// The ids a run still asks the server about: those not already refused for
/// good or given up on. Such an id is dropped, neither fetched nor reported, because the
/// server would answer with the same stream.
pub(crate) fn without_refused(ids: &[String], refused: &[String]) -> Vec<String> {
    ids.iter()
        .filter(|id| !refused.contains(id))
        .cloned()
        .collect()
}

/// Ask the store for each id. `None` when the install has closed.
pub(crate) fn claim_tracks(install: u64, ids: &[String], now: i64) -> Option<TrackClaims> {
    crate::persistence::with_persistent_engine_for(install, |engine| {
        let refused = engine
            .get_setting(crate::persistence::settings_keys::ATHLETE_ID)
            .ok()
            .flatten()
            .map(|athlete_id| {
                let mut ids = engine.refused_track_ids(&athlete_id);
                ids.extend(engine.unavailable_track_ids(&athlete_id));
                ids
            })
            .unwrap_or_default();
        let verdicts = without_refused(ids, &refused)
            .into_iter()
            .map(|id| {
                // A store that cannot be read must not stop the download: the
                // id is fetched as if no record existed.
                let verdict = engine
                    .claim_job(&track_key(&id), now)
                    .unwrap_or(Claim::Taken);
                (id, verdict)
            })
            .collect();
        sort_claims(verdicts)
    })
}

/// The ids that failed on a server answer. A lost network says nothing about
/// the activity, so it is not counted against it.
pub(crate) fn settled_failures(failed: &[(String, String)]) -> Vec<String> {
    failed
        .iter()
        .filter(|(_, error)| !network_absent(error))
        .map(|(id, _)| id.clone())
        .collect()
}

/// Give each lease back: landed ids are forgotten, the rest carry their error.
/// `refused` is the landed ids whose track the server can never supply, kept
/// so a later run does not ask for them. `settled` names the failures that
/// end a run, which count against the census row, and a landed id clears its
/// count.
pub(crate) fn release_tracks(
    install: u64,
    landed: &[String],
    refused: &[(String, crate::persistence::TrackRefusalKind)],
    failed: &[(String, String)],
    settled: &[String],
    unattempted: &[String],
    now: i64,
) {
    crate::persistence::with_persistent_engine_for(install, |engine| {
        if let Some(athlete_id) = engine
            .get_setting(crate::persistence::settings_keys::ATHLETE_ID)
            .ok()
            .flatten()
        {
            let _ = engine.record_track_refusals(&athlete_id, refused);
            let _ = engine.record_track_fetch_outcomes(&athlete_id, landed, settled);
        }
        for id in landed {
            let _ = engine.release_job(&track_key(id), Release::Done, now);
        }
        for (id, error) in failed {
            let _ = engine.release_job(&track_key(id), failure_release(error), now);
        }
        for id in unattempted {
            let _ = engine.release_job(&track_key(id), Release::Deferred, now);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_lost_network_is_not_a_settled_failure() {
        let failed = vec![
            ("a".to_string(), "transport error: timed out".to_string()),
            ("b".to_string(), "HTTP 500".to_string()),
        ];
        assert_eq!(settled_failures(&failed), vec!["b"]);
    }

    use super::*;

    #[test]
    fn claims_are_sorted_and_the_earliest_backoff_is_kept() {
        let claims = sort_claims(vec![
            ("a".into(), Claim::Taken),
            ("b".into(), Claim::BackingOff { until: 900 }),
            ("c".into(), Claim::InFlight),
            ("d".into(), Claim::BackingOff { until: 400 }),
        ]);
        assert_eq!(claims.taken, vec!["a"]);
        assert_eq!(claims.in_flight, vec!["c"]);
        assert_eq!(claims.backing_off, vec!["b", "d"]);
        assert_eq!(claims.frees_at, Some(400));
    }

    #[test]
    fn a_refused_id_is_not_asked_for_and_the_rest_keep_their_order() {
        let ids: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        assert_eq!(without_refused(&ids, &["b".to_string()]), vec!["a", "c"]);
        assert_eq!(without_refused(&ids, &[]), ids);
        assert!(without_refused(&[], &["b".to_string()]).is_empty());
    }

    #[test]
    fn a_missing_network_does_not_grow_the_backoff() {
        assert!(matches!(
            failure_release("transport error: connection refused"),
            Release::Deferred
        ));
        assert!(matches!(
            failure_release("JSON parse error: x"),
            Release::Failed { .. }
        ));
    }
}
