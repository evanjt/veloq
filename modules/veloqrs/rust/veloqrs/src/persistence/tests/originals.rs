//! Scenario: a ride with no connector behind it keeps its original file.
//!
//! Expected behaviour: the bytes come back exactly, the stored body is smaller
//! than the file, a second keep under the same key stores one row, a drop
//! leaves nothing to read, a damaged body reads as absent, and `clear` empties
//! the table.

use super::{drop_original, keep_original, original_of, originals_bytes};
use crate::persistence::PersistentEngine;

fn engine() -> PersistentEngine {
    PersistentEngine::in_memory().expect("in-memory engine")
}

fn rows(engine: &PersistentEngine) -> i64 {
    engine
        .db
        .query_row("SELECT count(*) FROM ride_originals", [], |r| r.get(0))
        .expect("count")
}

/// The fixture ride repeated, so the file is long enough to compress.
fn long_fit() -> Vec<u8> {
    crate::fit::recorded_ride_fit().repeat(40)
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_original_comes_back_byte_for_byte_and_is_stored_smaller() {
    let engine = engine();
    let fit = long_fit();
    assert_eq!(original_of(&engine.db, "src-1").unwrap(), None);

    keep_original(&engine.db, "src-1", "import", "fit", &fit, 10).unwrap();

    assert_eq!(original_of(&engine.db, "src-1").unwrap(), Some(fit.clone()));
    let stored = originals_bytes(&engine.db).unwrap();
    assert!(
        stored > 0 && stored < fit.len() as i64,
        "{stored} of {}",
        fit.len()
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn keeping_twice_under_one_key_stores_one_row_with_the_later_bytes() {
    let engine = engine();
    keep_original(&engine.db, "src-1", "import", "fit", b"first", 1).unwrap();
    keep_original(&engine.db, "src-1", "import", "fit", b"second", 2).unwrap();
    keep_original(&engine.db, "src-2", "import", "fit", b"other", 2).unwrap();

    assert_eq!(rows(&engine), 2);
    assert_eq!(
        original_of(&engine.db, "src-1").unwrap(),
        Some(b"second".to_vec())
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_file_is_kept_and_read_back_empty() {
    let engine = engine();
    keep_original(&engine.db, "src-1", "import", "fit", b"", 1).unwrap();
    assert_eq!(original_of(&engine.db, "src-1").unwrap(), Some(Vec::new()));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_dropped_original_reads_as_none_and_dropping_none_is_fine() {
    let engine = engine();
    keep_original(&engine.db, "src-1", "import", "fit", b"bytes", 1).unwrap();
    drop_original(&engine.db, "src-1").unwrap();
    drop_original(&engine.db, "src-1").unwrap();

    assert_eq!(original_of(&engine.db, "src-1").unwrap(), None);
    assert_eq!(originals_bytes(&engine.db).unwrap(), 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_body_that_no_longer_matches_its_digest_reads_as_absent() {
    let engine = engine();
    let fit = long_fit();
    keep_original(&engine.db, "src-1", "import", "fit", &fit, 1).unwrap();
    let other = super::deflate(&[7u8; 64]).unwrap();
    engine
        .db
        .execute("UPDATE ride_originals SET body = ?1", [other])
        .unwrap();

    assert_eq!(original_of(&engine.db, "src-1").unwrap(), None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn clear_empties_the_table() {
    let mut engine = engine();
    keep_original(&engine.db, "src-1", "import", "fit", b"bytes", 1).unwrap();
    engine.clear().expect("clear");
    assert_eq!(rows(&engine), 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn removing_an_activity_takes_its_original_with_it() {
    let mut engine = engine();
    keep_original(&engine.db, "src-1", "import", "fit", b"bytes", 1).unwrap();
    engine.remove_activity("src-1").ok();
    assert_eq!(original_of(&engine.db, "src-1").unwrap(), None);
}
