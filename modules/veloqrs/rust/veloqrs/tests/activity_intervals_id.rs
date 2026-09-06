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

/// Scenario: a ride recorded with no signal. Nothing upstream has named it,
/// so the device has to name it itself, and the name must be one the server
/// can never hand out.
#[test]
fn a_minted_key_cannot_be_mistaken_for_a_server_id() {
    let a = veloqrs::mint_local_activity_id();
    let b = veloqrs::mint_local_activity_id();

    assert_ne!(a, b, "two rides recorded in the same second are two rides");
    for key in [&a, &b] {
        assert!(
            key.starts_with("local-"),
            "a minted key must be recognisable as ours: {key}"
        );
        assert!(
            !key[1..].chars().all(|c| c.is_ascii_digit()),
            "an intervals.icu id is `i` and digits, so a key must not be: {key}"
        );
        assert!(
            !key.starts_with("demo-"),
            "the demo corpora own that prefix: {key}"
        );
    }
}

/// The row is a real activity the moment it is stored, and it is upstream of
/// nothing: no URL names it, and a sync that lists the server's activities
/// must not think the device already holds it under that id.
#[test]
fn a_row_under_a_minted_key_claims_no_server_id() {
    let key = veloqrs::mint_local_activity_id();
    let (_dir, engine) = engine_with(&[key.as_str()]);

    assert_eq!(
        engine.intervals_id(&key),
        None,
        "nothing upstream has named this ride yet"
    );
    assert_eq!(engine.activity_id_for_intervals_id(&key), None);
    assert!(engine.intervals_ids(&[key.clone()]).is_empty());
}

/// The upload's answer, which is the whole point of the column. One write,
/// and every resolver that could not see the row now can.
#[test]
fn a_successful_upload_records_the_id_the_server_gave_it() {
    let key = veloqrs::mint_local_activity_id();
    let (_dir, mut engine) = engine_with(&[key.as_str()]);

    assert!(
        engine.record_upload(&key, "i4242").expect("record"),
        "the row had no id, so the answer is recorded"
    );

    assert_eq!(engine.intervals_id(&key).as_deref(), Some("i4242"));
    assert_eq!(
        engine.activity_id_for_intervals_id("i4242").as_deref(),
        Some(key.as_str()),
        "the sync now matches the server's record onto the row the device keyed"
    );
}

/// A retried upload that lands twice, or an answer arriving after the sync
/// has already matched the ride, must not repoint the row.
#[test]
fn a_second_answer_leaves_the_first_one_standing() {
    let key = veloqrs::mint_local_activity_id();
    let (_dir, mut engine) = engine_with(&[key.as_str()]);
    engine.record_upload(&key, "i4242").expect("first answer");

    assert!(
        !engine.record_upload(&key, "i9999").expect("second answer"),
        "the row already names its ride upstream, so nothing is written"
    );
    assert_eq!(engine.intervals_id(&key).as_deref(), Some("i4242"));
    assert_eq!(engine.activity_id_for_intervals_id("i9999"), None);
}

/// A key nothing stored is not an error, it is a no-op: the recording could
/// have been deleted between the upload starting and the server answering.
#[test]
fn an_answer_for_a_row_that_is_gone_writes_nothing() {
    let (_dir, mut engine) = engine_with(&["i1"]);

    assert!(
        !engine
            .record_upload("local-vanished", "i5")
            .expect("no row is not a failure"),
        "there is nothing to record the answer on"
    );
    assert_eq!(engine.activity_id_for_intervals_id("i5"), None);
}
