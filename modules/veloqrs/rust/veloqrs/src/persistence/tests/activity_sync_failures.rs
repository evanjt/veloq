//! Scenario: a sync fails to ready one activity, fails again, and later
//! readies it cleanly, with another activity failing beside it.
//!
//! Expected behaviour: the failure is kept against its own activity only, a
//! second failure replaces the first rather than adding a row, a clear takes
//! only that activity's row, and removing the activity takes its failure.

use super::{clear, of, record};
use crate::persistence::PersistentEngine;

fn engine() -> PersistentEngine {
    PersistentEngine::in_memory().expect("in-memory engine")
}

#[test]
fn a_failure_belongs_to_its_activity_and_the_latest_attempt_replaces_it() {
    let engine = engine();
    assert_eq!(of(&engine.db, "a1").unwrap(), None);

    record(&engine.db, "a1", "track was not stored", 1_000);
    record(&engine.db, "a2", "streams did not decode", 2_000);
    record(&engine.db, "a1", "track was not stored again", 3_000);

    let first = of(&engine.db, "a1").unwrap().expect("a1 failed");
    assert_eq!(first.message, "track was not stored again");
    assert_eq!(first.failed_at, crate::WholeNumber(3_000));
    assert_eq!(
        of(&engine.db, "a2").unwrap().expect("a2 failed").message,
        "streams did not decode"
    );
    let rows: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM activity_sync_failures", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(rows, 2);
}

#[test]
fn a_clear_takes_only_that_activitys_failure_and_clearing_nothing_is_fine() {
    let engine = engine();
    record(&engine.db, "a1", "x", 1);
    record(&engine.db, "a2", "y", 2);

    clear(&engine.db, "a1");
    clear(&engine.db, "never-failed");

    assert_eq!(of(&engine.db, "a1").unwrap(), None);
    assert!(of(&engine.db, "a2").unwrap().is_some());
}
