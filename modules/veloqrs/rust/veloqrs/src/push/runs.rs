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
    /// The run had an entry for a ride the tray already held one for, and
    /// nothing in it was new, so it posted nothing.
    Unchanged,
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
            PushRunOutcome::Unchanged => "unchanged",
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
    writing(install, activity_id, |engine| {
        engine.record_push_run(activity_id, outcome.as_str(), detail, None, KEPT)
    });
}

/// The one take of the engine every run record goes through, against the
/// library the run started in, with the failure logged rather than returned.
fn writing<T>(
    install: u64,
    activity_id: &str,
    write: impl FnOnce(&mut crate::persistence::PersistentEngine) -> rusqlite::Result<T>,
) -> Option<T> {
    match crate::persistence::with_persistent_engine_for(install, write) {
        Some(Ok(value)) => Some(value),
        Some(Err(e)) => {
            log::warn!("[push] the run of {activity_id} was not recorded: {e}");
            None
        }
        None => {
            log::warn!("[push] the run of {activity_id} was not recorded: the engine is not open");
            None
        }
    }
}

/// Whether an entry is worth putting in the tray, given the newest entry a
/// kept run already put there for the same ride.
///
/// One alert per ride. intervals.icu sends an uploaded and an analysed event a
/// minute apart and each is a run of its own, so the second run posts only
/// when it has something the first did not: a highlight where the first had
/// the plain entry, or a highlight that reads differently. A plain entry never
/// follows another entry, and an identical one is never posted twice, which
/// would sound the phone again and bring back an entry the athlete dismissed.
///
/// `previous` is the outcome, title and body that run recorded, and
/// `highlight` is whether this entry is the ladder's sentence rather than the
/// plain one.
pub fn posts_again(
    previous: Option<(&str, &str, &str)>,
    title: &str,
    body: &str,
    highlight: bool,
) -> bool {
    match previous {
        None => true,
        Some(_) if !highlight => false,
        Some((outcome, posted_title, posted_body)) => {
            outcome != PushRunOutcome::Posted.as_str()
                || posted_title != title
                || posted_body != body
        }
    }
}

/// Record a run that answered with an entry, and say whether the handler
/// should post it: [`posts_again`] against the runs kept for this ride.
///
/// A run that posts nothing is recorded as [`PushRunOutcome::Unchanged`],
/// keeping its detail. The read and the write share one take of the engine, so
/// two runs for one ride cannot both read an empty tray. When the run cannot
/// be recorded the entry is posted: a second alert is a smaller loss than a
/// ride that reached the phone and left nothing in the tray.
pub fn settle_for(
    install: u64,
    activity_id: &str,
    outcome: PushRunOutcome,
    detail: Option<&str>,
    title: &str,
    body: &str,
) -> bool {
    writing(install, activity_id, |engine| {
        settle_on(engine, activity_id, outcome, detail, title, body)
    })
    .unwrap_or(true)
}

/// [`settle_for`] on one engine, so the decision is testable without the
/// process-wide one.
pub fn settle_on(
    engine: &mut crate::persistence::PersistentEngine,
    activity_id: &str,
    outcome: PushRunOutcome,
    detail: Option<&str>,
    title: &str,
    body: &str,
) -> rusqlite::Result<bool> {
    // One alert per Garmin ride, whichever route reached the phone first: a
    // ride announced under another of its rows is not announced again.
    if engine.ride_announced_elsewhere(activity_id)? {
        engine.record_push_run(
            activity_id,
            PushRunOutcome::Unchanged.as_str(),
            detail,
            None,
            KEPT,
        )?;
        return Ok(false);
    }
    let previous = engine.last_posted_push(activity_id)?;
    let posts = posts_again(
        previous
            .as_ref()
            .map(|(o, t, b)| (o.as_str(), t.as_str(), b.as_str())),
        title,
        body,
        outcome == PushRunOutcome::Posted,
    );
    if posts {
        engine.record_push_run(
            activity_id,
            outcome.as_str(),
            detail,
            Some((title, body)),
            KEPT,
        )?;
    } else {
        engine.record_push_run(
            activity_id,
            PushRunOutcome::Unchanged.as_str(),
            detail,
            None,
            KEPT,
        )?;
    }
    Ok(posts)
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
                None,
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
                .record_push_run("a1", outcome.as_str(), None, None, KEPT)
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
                .record_push_run(&format!("a{i}"), "posted", None, None, KEPT)
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

    fn settle(
        engine: &mut PersistentEngine,
        activity_id: &str,
        outcome: PushRunOutcome,
        title: &str,
        body: &str,
    ) -> bool {
        settle_on(engine, activity_id, outcome, None, title, body).expect("the write")
    }

    /// Scenario: the uploaded event posts a highlight, the athlete dismisses
    /// it, and the analysed event a minute later builds the same sentence.
    ///
    /// Expected behaviour: the second run posts nothing and says so, so the
    /// phone sounds once and the dismissed entry stays dismissed.
    #[test]
    fn the_same_highlight_twice_for_one_ride_posts_once() {
        let (_tmp, mut engine) = engine();

        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
        assert!(!settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));

        let runs = read_from(&engine.db).expect("the read");
        assert_eq!(runs[0].outcome, "unchanged");
        assert_eq!(runs[1].outcome, "posted");
    }

    /// Scenario: the uploaded event found nothing worth a sentence and posted
    /// the plain entry, and the analysed event finds a section PR.
    ///
    /// Expected behaviour: the highlight is posted, replacing the plain entry.
    #[test]
    fn a_highlight_after_the_plain_entry_is_posted() {
        let (_tmp, mut engine) = engine();

        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::NothingWorthPosting,
            "Activity Recorded",
            "Lunch Ride"
        ));
        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
    }

    /// Scenario: both events find nothing, or the second finds less than the
    /// first did, or fails before the ladder ran.
    ///
    /// Expected behaviour: no second entry. A plain entry never follows another
    /// entry for the same ride, even when the name it carries changed.
    #[test]
    fn a_plain_entry_never_follows_another_entry_for_the_ride() {
        let (_tmp, mut engine) = engine();

        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::NothingWorthPosting,
            "Activity Recorded",
            "Ride"
        ));
        assert!(!settle(
            &mut engine,
            "a1",
            PushRunOutcome::NothingWorthPosting,
            "Activity Recorded",
            "Lunch Ride"
        ));

        assert!(settle(
            &mut engine,
            "a2",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
        assert!(!settle(
            &mut engine,
            "a2",
            PushRunOutcome::Failed,
            "Activity Recorded",
            ""
        ));
        assert!(!settle(
            &mut engine,
            "a2",
            PushRunOutcome::NoStringBundle,
            "New activity",
            "Lunch Ride"
        ));
    }

    /// Scenario: the analysed event's sentence differs from the one the
    /// uploaded event posted, because a section PR was written between them.
    ///
    /// Expected behaviour: the new sentence is posted, and compared against
    /// from then on rather than the first.
    #[test]
    fn a_different_highlight_is_posted_and_becomes_the_one_compared() {
        let (_tmp, mut engine) = engine();

        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "Faster Than Usual",
            "Faster than usual on Loop"
        ));
        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
        assert!(!settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "Faster Than Usual",
            "Faster than usual on Loop"
        ));
    }

    /// Scenario: two rides land close together, each with its own sentence,
    /// and a run before them recorded nothing in the tray.
    ///
    /// Expected behaviour: each ride is judged against its own entries only,
    /// and a run that posted nothing is not an entry.
    #[test]
    fn each_ride_is_judged_against_its_own_entries() {
        let (_tmp, mut engine) = engine();
        engine
            .record_push_run(
                "a2",
                PushRunOutcome::NotificationsOff.as_str(),
                None,
                None,
                KEPT,
            )
            .expect("the write");

        assert!(settle(
            &mut engine,
            "a1",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
        assert!(settle(
            &mut engine,
            "a2",
            PushRunOutcome::Posted,
            "New PR",
            "PR on Hill"
        ));
    }

    /// Scenario: a run that failed and posted the plain entry is recorded as
    /// unchanged by the run after it.
    ///
    /// Expected behaviour: the reason stays on the row, so the dashboard still
    /// says why the run had nothing better.
    #[test]
    fn an_unchanged_run_keeps_its_reason() {
        let (_tmp, mut engine) = engine();
        settle(
            &mut engine,
            "a1",
            PushRunOutcome::NothingWorthPosting,
            "Activity Recorded",
            "Ride",
        );

        assert!(
            !settle_on(
                &mut engine,
                "a1",
                PushRunOutcome::Failed,
                Some("no network"),
                "Activity Recorded",
                ""
            )
            .expect("the write")
        );

        let runs = read_from(&engine.db).expect("the read");
        assert_eq!(runs[0].outcome, "unchanged");
        assert_eq!(runs[0].detail.as_deref(), Some("no network"));
    }
}
