//! What each native push run did, kept where the Developer Dashboard can read
//! it.
//!
//! The Android worker has no JavaScript in its process, so it cannot reach the
//! `AsyncStorage` ring the background insight task writes, and a device build
//! logs at `Warn`, so an `info!` line reaches nobody with the phone in hand.
//! The engine is the one thing both the worker and the dashboard can see, so
//! the run goes in a table.
//!
//! Every run ends in exactly one [`PushRunOutcome`], including the ones that
//! post nothing. That is the whole point: "the tray shows only the placeholder"
//! has four answers and the athlete's phone could tell them apart from none of
//! them.

/// How one native push run ended.
///
/// Only notifications off is silent. The ladder finding nothing worth a
/// sentence, or no string bundle having been pushed yet (a fresh install whose
/// JavaScript has not had a full launch), post the plain entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushRunOutcome {
    Posted,
    NotificationsOff,
    AthleteMismatch,
    NothingWorthPosting,
    NoStringBundle,
    Failed,
}

impl PushRunOutcome {
    /// The word stored and shown. Stable, since old rows keep it.
    pub fn as_str(self) -> &'static str {
        match self {
            PushRunOutcome::Posted => "posted",
            PushRunOutcome::NotificationsOff => "notifications-off",
            PushRunOutcome::AthleteMismatch => "athlete-mismatch",
            PushRunOutcome::NothingWorthPosting => "nothing-worth-posting",
            PushRunOutcome::NoStringBundle => "no-string-bundle",
            PushRunOutcome::Failed => "failed",
        }
    }
}

/// How many runs are kept. Twenty is what the JavaScript task's ring holds,
/// and a dashboard list longer than that is scrolled past rather than read.
const KEPT: i64 = 20;

/// One run of `activity_push_json`, as the dashboard shows it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPushRun {
    /// Seconds since the epoch, the unit every other date on the surface uses.
    pub ts: f64,
    pub activity_id: String,
    pub outcome: String,
    /// The sentence behind a `failed`, or nothing for the outcomes that are
    /// their own explanation.
    pub detail: Option<String>,
}

/// Record one run, and trim the table to the newest [`KEPT`].
///
/// Best effort, and deliberately so: a diagnostic that fails a push is worse
/// than no diagnostic. It takes the writer, which a sync page may be holding,
/// and the run is over by the time it is called, so nothing is waiting on it.
pub fn record(activity_id: &str, outcome: PushRunOutcome, detail: Option<&str>) {
    record_for(
        crate::persistence::engine_install(),
        activity_id,
        outcome,
        detail,
    );
}

/// [`record`] against the library a run started in. A run that outlived its
/// library leaves nothing in the next athlete's table.
pub fn record_for(install: u64, activity_id: &str, outcome: PushRunOutcome, detail: Option<&str>) {
    let wrote = crate::persistence::with_persistent_engine_for(install, |engine| {
        engine.record_push_run(activity_id, outcome.as_str(), detail, KEPT)
    });
    match wrote {
        Some(Ok(())) => {}
        Some(Err(e)) => log::warn!("[push] the run of {activity_id} was not recorded: {e}"),
        None => {
            log::warn!("[push] the run of {activity_id} was not recorded: the engine is not open")
        }
    }
}

/// The kept runs, newest first, for the dashboard.
///
/// Off the read pool: the dashboard opens while the foreground is live and a
/// diagnostic has no business waiting on the writer.
pub fn recent() -> Vec<FfiPushRun> {
    crate::persistence::read_pool::with_read_conn(read_from)
        .unwrap_or_default()
        .unwrap_or_default()
}

/// The rows off one connection, so the SQL is testable without a pool.
pub fn read_from(conn: &rusqlite::Connection) -> Option<Vec<FfiPushRun>> {
    let mut stmt = conn
        .prepare(
            "SELECT ts, activity_id, outcome, detail FROM push_runs
             ORDER BY ts DESC, id DESC LIMIT ?",
        )
        .ok()?;
    let rows = stmt
        .query_map([KEPT], |row| {
            Ok(FfiPushRun {
                ts: row.get::<_, i64>(0)? as f64,
                activity_id: row.get(1)?,
                outcome: row.get(2)?,
                detail: row.get(3)?,
            })
        })
        .ok()?
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    Some(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentEngine;

    fn engine() -> (tempfile::TempDir, PersistentEngine) {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let db = tmp.path().join("routes.db");
        let engine = PersistentEngine::new(db.to_str().expect("path")).expect("engine");
        (tmp, engine)
    }

    #[test]
    fn a_run_is_read_back_with_its_outcome_and_detail() {
        let (_tmp, mut engine) = engine();

        engine
            .record_push_run(
                "a1",
                PushRunOutcome::Failed.as_str(),
                Some("no network"),
                KEPT,
            )
            .expect("the write");

        let runs = read_from(&engine.db).expect("the read");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].activity_id, "a1");
        assert_eq!(runs[0].outcome, "failed");
        assert_eq!(runs[0].detail.as_deref(), Some("no network"));
        assert!(runs[0].ts > 0.0, "the row is stamped");
    }

    /// Expected behaviour: the silent outcomes are told apart, which is the
    /// whole reason the table exists.
    #[test]
    fn the_three_silent_outcomes_are_distinguishable() {
        let (_tmp, mut engine) = engine();

        for outcome in [
            PushRunOutcome::NotificationsOff,
            PushRunOutcome::NothingWorthPosting,
            PushRunOutcome::NoStringBundle,
        ] {
            engine
                .record_push_run("a1", outcome.as_str(), None, KEPT)
                .expect("the write");
        }

        let words: Vec<String> = read_from(&engine.db)
            .expect("the read")
            .into_iter()
            .map(|r| r.outcome)
            .collect();
        assert_eq!(
            words,
            vec![
                "no-string-bundle",
                "nothing-worth-posting",
                "notifications-off"
            ],
            "newest first"
        );
    }

    #[test]
    fn the_table_keeps_only_the_newest_runs() {
        let (_tmp, mut engine) = engine();

        for i in 0..KEPT + 5 {
            engine
                .record_push_run(&format!("a{i}"), "posted", None, KEPT)
                .expect("the write");
        }

        let runs = read_from(&engine.db).expect("the read");
        assert_eq!(runs.len() as i64, KEPT);
        assert_eq!(
            runs[0].activity_id,
            format!("a{}", KEPT + 4),
            "newest first"
        );
        assert!(
            runs.iter().all(|r| r.activity_id != "a0"),
            "the oldest run was trimmed"
        );
    }

    /// Scenario: the dashboard is opened on an install that has had no push.
    #[test]
    fn an_empty_table_reads_as_no_runs() {
        let (_tmp, engine) = engine();

        assert_eq!(read_from(&engine.db), Some(vec![]));
    }
}
