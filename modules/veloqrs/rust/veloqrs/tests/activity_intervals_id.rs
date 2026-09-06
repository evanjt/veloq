//! The internal key is ours; the intervals.icu id is metadata beside it.
//!
//! Every key an older build wrote IS the server's id, so the column is
//! backfilled from it and nothing that references an activity moves. What
//! changes is who reads it: a URL naming an activity upstream reads the
//! column, and the sync matches a server record against it, so a row the
//! device minted and later uploaded is found rather than stored twice.
//!
//! Run: `cargo test --test activity_intervals_id -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track(seed: f64) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint {
            latitude: 46.0 + seed * 0.01 + f64::from(i) * 0.0002,
            longitude: 7.0 + seed * 0.01,
            elevation: None,
        })
        .collect()
}

fn engine_with(ids: &[&str]) -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    for (i, id) in ids.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), track(i as f64), "Ride".to_string())
            .expect("store");
    }
    (dir, engine)
}

#[test]
fn an_activity_from_the_server_records_the_id_it_arrived_as() {
    let (_dir, engine) = engine_with(&["i12345"]);

    assert_eq!(engine.intervals_id("i12345").as_deref(), Some("i12345"));
    assert_eq!(
        engine.activity_id_for_intervals_id("i12345").as_deref(),
        Some("i12345"),
        "the server's id resolves back to the row that claims it"
    );
}

#[test]
fn an_id_no_row_claims_resolves_to_nothing() {
    let (_dir, engine) = engine_with(&["i1"]);

    assert_eq!(engine.intervals_id("never-stored"), None);
    assert_eq!(engine.activity_id_for_intervals_id("i9999"), None);
}

/// A batch of URLs reads the column once, not once per activity.
#[test]
fn the_batch_resolver_answers_for_every_row_that_has_one() {
    let (_dir, engine) = engine_with(&["i1", "i2", "i3"]);

    let ids = ["i1".to_string(), "i3".to_string(), "i9".to_string()];
    let resolved = engine.intervals_ids(&ids);

    assert_eq!(resolved.len(), 2, "i9 is not stored: {resolved:?}");
    assert_eq!(resolved.get("i1").map(String::as_str), Some("i1"));
    assert_eq!(resolved.get("i3").map(String::as_str), Some("i3"));

    let back = engine.local_ids_for_intervals_ids(&ids);
    assert_eq!(back.get("i1").map(String::as_str), Some("i1"));
    assert_eq!(back.get("i9"), None);
}

/// The point of the column. A row the device keyed itself is found by the
/// server id it later gained, so the next sync updates it rather than
/// storing the same ride a second time.
#[test]
fn a_row_the_device_keyed_is_found_by_the_id_it_gained() {
    let (dir, engine) = engine_with(&["local-abc"]);
    let path = dir.path().join("routes.db");
    drop(engine);

    let conn = Connection::open(&path).expect("reopen");
    conn.execute(
        "UPDATE activities SET intervals_id = ? WHERE id = ?",
        params!["i77", "local-abc"],
    )
    .expect("the upload answers with the server's id");
    drop(conn);

    let engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen engine");

    assert_eq!(
        engine.activity_id_for_intervals_id("i77").as_deref(),
        Some("local-abc"),
        "the sync matches on the column, not on the key"
    );
    assert_eq!(engine.intervals_id("local-abc").as_deref(), Some("i77"));
}

/// A re-ingest must not overwrite an id an upload already recorded: the key
/// would then name the row upstream and the whole separation is undone.
#[test]
fn a_re_ingest_leaves_a_recorded_server_id_alone() {
    let (dir, engine) = engine_with(&["local-abc"]);
    let path = dir.path().join("routes.db");
    drop(engine);

    let conn = Connection::open(&path).expect("reopen");
    conn.execute(
        "UPDATE activities SET intervals_id = ? WHERE id = ?",
        params!["i77", "local-abc"],
    )
    .expect("record the server id");
    drop(conn);

    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen engine");
    engine
        .add_activity("local-abc".to_string(), track(5.0), "Ride".to_string())
        .expect("re-ingest");

    assert_eq!(engine.intervals_id("local-abc").as_deref(), Some("i77"));
}
