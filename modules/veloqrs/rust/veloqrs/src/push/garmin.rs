//! The Garmin step of a push: a ride intervals.icu holds and will not serve is
//! completed from the original Garmin keeps for the athlete.
//!
//! The push's detail fetch meets a stub for such a ride, with no streams, no
//! track and no intervals. The stub names the Garmin id (`external_id`), the
//! athlete's own Garmin key downloads the original, and the original is stored
//! as the `src-garmin-` row linked to the intervals.icu activity, so the ride
//! is one complete row before the sentence is built.
//!
//! The key is held in process memory only, by `objects::garmin_key`, and the
//! token it is exchanged for stays in that client. Neither is written to the
//! database, a file, a setting or a run's reason. Any Garmin failure leaves the
//! push as it is without a key: the stub is stored, the plain entry is posted
//! and the ride waits for the next sync. intervals.icu is never written to.

use std::time::Duration;

use crate::net::garmin::wire::ListedActivity;
use crate::net::intervals::wire::ActivityRecord;
use crate::objects::garmin_key::{GARMIN_KEY, hold_garmin_key_if_absent};
use crate::persistence::origin::{garmin_id_named, garmin_id_of_source_key, garmin_source_key};

/// How long the Garmin step may wait on Garmin, token exchange and download
/// together. The handler has seconds, not minutes: an Android worker is
/// expedited work and an iOS extension is given 30 s in all, of which the
/// detail fetch and the index have already taken theirs.
const STEP_LIMIT: Duration = Duration::from_secs(8);

#[cfg(test)]
static STEP_LIMIT_OVERRIDE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Change the step's limit for a test, or put it back with `None`.
#[cfg(test)]
pub(crate) fn set_step_limit(limit: Option<Duration>) {
    STEP_LIMIT_OVERRIDE_MS.store(
        limit.map_or(0, |l| l.as_millis() as u64),
        std::sync::atomic::Ordering::SeqCst,
    );
}

fn step_limit() -> Duration {
    #[cfg(test)]
    {
        let ms = STEP_LIMIT_OVERRIDE_MS.load(std::sync::atomic::Ordering::SeqCst);
        if ms > 0 {
            return Duration::from_millis(ms);
        }
    }
    STEP_LIMIT
}

/// Hold the Garmin key a native handler read from the keychain, for the push it
/// is about to run. A missing or blank item holds nothing, and a key the
/// process already holds is kept with the token it has exchanged.
pub fn hold_native_garmin_key(key: Option<&str>) {
    if let Some(key) = key {
        hold_garmin_key_if_absent(key);
    }
}

/// What the Garmin step did for a push.
pub(super) enum Step {
    /// Not a stub for a Garmin ride, or no key is held to complete it with:
    /// the push goes on as it would without this step.
    NotApplicable,
    /// The library is not the one the push started in, so nothing was written.
    Dropped,
    /// The library holds the ride complete under this key.
    Completed { key: String },
    /// Garmin could not complete it, or the original would not store. The stub
    /// is stored and the push goes on with it.
    Failed(String),
}

/// Complete the stub `body` of the intervals.icu activity `upstream`, held in
/// the library under `key`, from its Garmin original.
///
/// A ride already stored as a Garmin row is complete: the stub is not stored
/// over it and Garmin is not asked again.
pub(super) fn complete(
    install: u64,
    incoming_athlete_id: &str,
    key: &str,
    body: &str,
    record: &ActivityRecord,
) -> Step {
    if !record.is_held_back() {
        return Step::NotApplicable;
    }
    if garmin_id_of_source_key(key).is_some() {
        return Step::Completed {
            key: key.to_string(),
        };
    }
    let Some(garmin_id) = garmin_id_named(record.source.as_deref(), record.external_id.as_deref())
    else {
        return Step::NotApplicable;
    };
    let Some(client) = GARMIN_KEY.client() else {
        return Step::NotApplicable;
    };

    // The stub goes in first, so the original links to the activity that
    // names it as it is stored.
    match super::store_pushed_detail(install, incoming_athlete_id, key, body, false) {
        Ok(Some(_)) => {}
        Ok(None) => return Step::Dropped,
        Err(e) => return Step::Failed(e),
    }

    let original_key = garmin_source_key(garmin_id);
    if already_stored(&original_key) {
        let linked = crate::persistence::with_persistent_engine_for(install, |engine| {
            engine.link_garmin_original(&original_key)
        });
        return match linked {
            Some(Ok(_)) => Step::Completed { key: original_key },
            Some(Err(e)) => Step::Failed(format!("the link of {original_key}: {e}")),
            None => Step::Dropped,
        };
    }

    let limit = step_limit();
    let downloaded = crate::runtime::block_on(async {
        tokio::time::timeout(
            limit,
            client.download_original(garmin_id, crate::net::garmin::dispatch()),
        )
        .await
    });
    let fit = match downloaded {
        Ok(Ok(fit)) => fit,
        Ok(Err(e)) => return Step::Failed(format!("Garmin did not give the original: {e}")),
        Err(_) => return Step::Failed(format!("Garmin did not answer within {limit:?}")),
    };

    let listed = listed_from(garmin_id, record);
    // intervals.icu already holds this ride, so its original is never uploaded.
    let ingested = match crate::net::garmin::ingest::ingest_original(install, &listed, &fit, false)
    {
        Ok(ingested) => ingested,
        Err(e) => return Step::Failed(e.to_string()),
    };
    if matches!(
        ingested,
        crate::net::garmin::ingest::Ingested::Stored { tracked: true }
    ) {
        index(install, &original_key);
    }
    Step::Completed { key: original_key }
}

/// The list entry the ingest reads its fallbacks from, made from what the stub
/// says. The original's own figures win over every one of these.
fn listed_from(garmin_id: i64, record: &ActivityRecord) -> ListedActivity {
    ListedActivity {
        activity_id: garmin_id,
        start_time_local: None,
        start_time_gmt: None,
        activity_name: record.name.clone().filter(|n| !n.trim().is_empty()),
        activity_type: None,
        duration: record.moving_time.map(|s| s as f64),
        elapsed_duration: record.elapsed_time.map(|s| s as f64),
        distance: record.distance,
        manual_activity: None,
    }
}

/// Match the stored original against the catalogue and wait for the regroup
/// that puts it in a route, as the push does for a track it fetched itself.
/// Best effort: the sentence is built from whatever has landed.
fn index(install: u64, key: &str) {
    match crate::ffi::index_stored_track(install, key) {
        Ok(_) => {
            if !crate::persistence::regroup::settle_regroup(install, super::PUSH_REGROUP_LIMIT) {
                log::warn!("[push] {key} is announced before its route settled");
            }
        }
        Err(_) if crate::persistence::engine_install() != install => {}
        Err(e) => log::warn!("[push] the index of {key} failed: {e}"),
    }
}

/// Whether the library already holds the original under `key`, body and
/// metrics both: a read off the pool, since the take that links is a write.
fn already_stored(key: &str) -> bool {
    crate::persistence::read_pool::with_read_conn(|conn| {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM activity_bodies WHERE activity_id = ?1)
                AND EXISTS(SELECT 1 FROM activity_metrics WHERE activity_id = ?1)",
            [key],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// The name the library holds the ride under, for the plain entry.
pub(super) fn stored_name(key: &str) -> Option<String> {
    crate::persistence::read_pool::with_read_conn(|conn| {
        conn.query_row(
            "SELECT raw FROM activity_bodies WHERE activity_id = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    })
    .flatten()
    .and_then(|raw| serde_json::from_str::<ActivityRecord>(&raw).ok())
    .and_then(|record| record.name)
}
