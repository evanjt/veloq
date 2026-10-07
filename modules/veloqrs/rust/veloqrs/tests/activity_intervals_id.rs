//! The internal key is ours; the intervals.icu id is metadata beside it.
//!
//! Every key an older build wrote IS the server's id, so the column is
//! backfilled from it and nothing that references an activity moves. What
//! changes is who reads it: a URL naming an activity upstream reads the
//! column, and the sync matches a server record against it, so a row the
//! device minted and later uploaded is found rather than stored twice.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_intervals_id::`

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

    let back = engine.local_ids_for_intervals_ids(&ids).expect("lookup");
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
    assert!(engine.intervals_ids(std::slice::from_ref(&key)).is_empty());
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

fn insert_uploaded_recording(conn: &Connection) {
    conn.execute("INSERT INTO recordings (
        id, fit_path, activity_type, name, start_time, duration_seconds, distance_meters,
        created_at, upload_status, intervals_activity_id, engine_activity_id
    ) VALUES ('r1', 'ride.fit', 'Ride', 'Ride', 1, 20, 100, 1, 'uploaded', 'i4242', 'local-recording')", []).unwrap();
}

fn upload_race() -> (TempDir, PersistentEngine, Connection) {
    let (dir, mut engine) = engine_with(&["local-recording", "i4242"]);
    engine
        .upsert_activity_bodies(&[
            (
                "local-recording".to_string(),
                1,
                r#"{"id":"local-recording"}"#.to_string(),
            ),
            ("i4242".to_string(), 1, r#"{"id":"i4242"}"#.to_string()),
        ])
        .unwrap();
    let conn = Connection::open(dir.path().join("routes.db")).unwrap();
    for id in ["local-recording", "i4242"] {
        conn.execute("INSERT INTO activity_streams (activity_id, kind, data, sample_count) VALUES (?1, 'power', X'00', 1)", [id]).unwrap();
    }
    insert_uploaded_recording(&conn);
    (dir, engine, conn)
}

#[test]
fn an_upload_answer_after_sync_removes_the_provisional_copy_and_its_dependants() {
    let (dir, mut engine, conn) = upload_race();
    let server_track = engine.get_gps_track("i4242").unwrap();
    assert!(
        engine
            .record_upload("local-recording", "i4242")
            .expect("reconcile server copy")
    );
    assert!(!engine.has_activity("local-recording"));
    assert_eq!(engine.activity_count(), 1);
    assert_eq!(
        engine.activity_id_for_intervals_id("i4242").as_deref(),
        Some("i4242")
    );
    assert_eq!(
        engine.get_gps_track("i4242").unwrap().len(),
        server_track.len()
    );
    for table in [
        "activities",
        "gps_tracks",
        "signatures",
        "activity_bodies",
        "activity_streams",
    ] {
        let column = if table == "activities" {
            "id"
        } else {
            "activity_id"
        };
        let ids: Vec<String> = conn
            .prepare(&format!("SELECT {column} FROM {table}"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(ids, vec!["i4242"], "{table} retains only the server copy");
    }
    assert!(!engine.record_upload("local-recording", "i4242").unwrap());
    drop(engine);
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine.load().unwrap();
    assert_eq!(engine.get_activity_ids(), vec!["i4242"]);
}

#[test]
fn a_failed_upload_reconciliation_rolls_back_the_provisional_track_and_body() {
    let (_dir, mut engine, conn) = upload_race();
    conn.execute_batch("CREATE TRIGGER refuse_stream_delete BEFORE DELETE ON activity_streams
        WHEN OLD.activity_id = 'local-recording' BEGIN SELECT RAISE(ABORT, 'stream retained'); END;").unwrap();
    let error = engine
        .record_upload("local-recording", "i4242")
        .unwrap_err();
    assert!(error.to_string().contains("stream retained"), "{error}");
    assert!(engine.has_activity("local-recording"));
    assert!(engine.get_gps_track("local-recording").is_some());
    assert!(engine.get_activity_body("local-recording").is_some());
    assert_eq!(engine.intervals_id("local-recording"), None);
    assert_eq!(engine.activity_count(), 2);
    let recording_id: String = conn
        .query_row(
            "SELECT engine_activity_id FROM recordings WHERE id = 'r1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(recording_id, "local-recording");
    conn.execute_batch("DROP TRIGGER refuse_stream_delete")
        .unwrap();
    assert!(engine.record_upload("local-recording", "i4242").unwrap());
    assert_eq!(engine.activity_count(), 1);
}

#[test]
fn a_second_upload_answer_cannot_remove_a_recording_that_already_claims_an_id() {
    let (_dir, mut engine) = engine_with(&["local-recording", "i4242"]);
    assert!(engine.record_upload("local-recording", "i11").unwrap());
    assert!(!engine.record_upload("local-recording", "i4242").unwrap());
    assert_eq!(engine.activity_count(), 2);
    assert_eq!(
        engine.intervals_id("local-recording").as_deref(),
        Some("i11")
    );
}

#[test]
fn a_failed_upload_reconciliation_commit_can_be_retried() {
    let (_dir, mut engine, conn) = upload_race();
    engine
        .save_processed_activity_ids(&["local-recording".to_string(), "i4242".to_string()])
        .unwrap();
    conn.execute_batch(
        "CREATE TABLE deferred_activity (
        activity_id TEXT REFERENCES activities(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER refuse_reconciliation AFTER DELETE ON activity_streams
        WHEN OLD.activity_id = 'local-recording' BEGIN
        INSERT INTO deferred_activity VALUES ('local-recording'); END;",
    )
    .unwrap();
    assert!(engine.record_upload("local-recording", "i4242").is_err());
    assert!(engine.has_activity("local-recording"));
    assert!(engine.get_activity_body("local-recording").is_some());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM processed_activities", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        2
    );
    conn.execute_batch("DROP TRIGGER refuse_reconciliation")
        .unwrap();
    assert!(engine.record_upload("local-recording", "i4242").unwrap());
    assert_eq!(engine.activity_count(), 1);
}

#[test]
fn an_upload_reconciliation_retargets_the_recording_to_the_canonical_row() {
    let (dir, mut engine) = engine_with(&["local-recording", "local-canonical"]);
    engine.record_upload("local-canonical", "i4242").unwrap();
    let conn = Connection::open(dir.path().join("routes.db")).unwrap();
    insert_uploaded_recording(&conn);
    engine.record_upload("local-recording", "i4242").unwrap();
    let retained_id: String = conn
        .query_row(
            "SELECT engine_activity_id FROM recordings WHERE id = 'r1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(retained_id, "local-canonical");
    assert!(engine.has_activity(&retained_id));
    assert_eq!(engine.intervals_id(&retained_id).as_deref(), Some("i4242"));
}

/// Scenario: a strength session or a trainer ride with no GPS is saved. Its
/// provisional row is a body and metrics with no `activities` row, so the id
/// the upload gains had nowhere to live, and the next sync stored the server
/// copy beside it and counted the session twice.
///
/// Expected behaviour: the trackless row takes the server's id, every
/// identity read answers it, the sync's page lands on the device's key, and
/// it all survives a reopen.
mod trackless_provisional {
    use super::*;

    const LOCAL: &str = "local-recording-r1";
    const DATE: i64 = 1_788_000_000;

    fn body(id: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"Gym","type":"WeightTraining","start_date_local":"2026-08-29T07:00:00","moving_time":3600,"elapsed_time":3600,"distance":0}}"#
        )
    }

    fn engine_with_trackless() -> (TempDir, PersistentEngine) {
        let (dir, mut engine) = engine_with(&[]);
        engine
            .save_provisional_activity(
                LOCAL,
                Vec::new(),
                &veloqrs::FfiActivityBody {
                    activity_id: LOCAL.to_string(),
                    date: DATE as f64,
                    raw: body(LOCAL),
                },
            )
            .expect("trackless provisional row");
        (dir, engine)
    }

    fn count(dir: &TempDir, table: &str) -> i64 {
        Connection::open(dir.path().join("routes.db"))
            .unwrap()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    /// The list sync's own step: a server id a row claims is written under
    /// that row's key, any other under the server's id.
    fn sync_page(engine: &mut PersistentEngine, server_id: &str) {
        let local = engine
            .local_ids_for_intervals_ids(&[server_id.to_string()])
            .expect("lookup");
        let key = local
            .get(server_id)
            .cloned()
            .unwrap_or_else(|| server_id.to_string());
        engine
            .upsert_activity_bodies_with_metrics(&[(key, DATE, body(server_id))])
            .expect("store the page");
    }

    #[test]
    fn an_uploaded_trackless_ride_syncs_back_as_one_activity() {
        let (dir, mut engine) = engine_with_trackless();

        assert!(
            engine.record_upload(LOCAL, "i123").expect("record"),
            "a trackless row waiting for its id took it"
        );
        assert_eq!(engine.intervals_id(LOCAL).as_deref(), Some("i123"));
        assert_eq!(
            engine.activity_id_for_intervals_id("i123").as_deref(),
            Some(LOCAL)
        );
        assert_eq!(
            engine
                .intervals_ids(&[LOCAL.to_string()])
                .get(LOCAL)
                .map(String::as_str),
            Some("i123")
        );

        sync_page(&mut engine, "i123");
        assert_eq!(count(&dir, "activity_bodies"), 1);
        assert_eq!(count(&dir, "activity_metrics"), 1);
        assert!(
            engine
                .census_candidates("2100-01-01")
                .contains(&(LOCAL.to_string(), "i123".to_string())),
            "a server deletion reaches the uploaded trackless row"
        );

        drop(engine);
        let mut engine =
            PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).expect("reopen");
        sync_page(&mut engine, "i123");
        assert_eq!(count(&dir, "activity_bodies"), 1);
        assert_eq!(count(&dir, "activity_metrics"), 1);
        assert!(
            !engine.record_upload(LOCAL, "i999").unwrap(),
            "a second answer leaves the first standing"
        );
        assert_eq!(engine.intervals_id(LOCAL).as_deref(), Some("i123"));
    }

    /// The sync can land the server copy before the upload's answer is
    /// recorded. The device's copy goes and the recording follows the
    /// server's, as it does for a ride with a track.
    #[test]
    fn an_answer_after_the_sync_stored_the_server_copy_keeps_one() {
        let (dir, mut engine) = engine_with_trackless();
        sync_page(&mut engine, "i123");
        assert_eq!(count(&dir, "activity_bodies"), 2);
        let conn = Connection::open(dir.path().join("routes.db")).unwrap();
        conn.execute(
            "INSERT INTO recordings (id, fit_path, activity_type, name, start_time, \
             duration_seconds, distance_meters, created_at, upload_status, \
             intervals_activity_id, engine_activity_id) \
             VALUES ('r1', '', 'WeightTraining', 'Gym', 1, 3600, 0, 1, 'uploaded', 'i123', ?1)",
            params![LOCAL],
        )
        .unwrap();

        assert!(engine.record_upload(LOCAL, "i123").expect("reconcile"));

        assert_eq!(count(&dir, "activity_bodies"), 1);
        assert_eq!(count(&dir, "activity_metrics"), 1);
        assert!(engine.get_activity_body(LOCAL).is_none());
        let retained: String = conn
            .query_row(
                "SELECT engine_activity_id FROM recordings WHERE id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(retained, "i123");
    }

    /// A rejected upload frees the id, so a manual retry under a new one
    /// lands on the same row.
    #[test]
    fn a_rejected_upload_frees_the_trackless_rows_id() {
        let (dir, mut engine) = engine_with_trackless();
        engine.record_upload(LOCAL, "i123").unwrap();
        let conn = Connection::open(dir.path().join("routes.db")).unwrap();
        conn.execute(
            "INSERT INTO recordings (id, fit_path, activity_type, name, start_time, \
             duration_seconds, distance_meters, created_at, upload_status, \
             intervals_activity_id, engine_activity_id) \
             VALUES ('r1', '', 'WeightTraining', 'Gym', 1, 3600, 0, 1, 'uploaded', 'i123', ?1)",
            params![LOCAL],
        )
        .unwrap();

        engine
            .set_recording_rejected("r1", "intervals.icu no longer has it", 2)
            .unwrap();
        assert_eq!(engine.intervals_id(LOCAL), None);
        assert_eq!(engine.activity_id_for_intervals_id("i123"), None);
        assert!(engine.record_upload(LOCAL, "i456").unwrap());
        assert_eq!(
            engine.activity_id_for_intervals_id("i456").as_deref(),
            Some(LOCAL)
        );
    }
}
