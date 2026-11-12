//! Curve bodies and per-activity curves on a library upgraded from the last
//! release.
//!
//! Expected behaviour: a curve body stored by the last release reads as the
//! server's, the per-activity curve table starts empty, and an activity's
//! curves go with the activity.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const SERVER_BODY: &str = r#"{"list":[{"secs":[60],"values":[310]}]}"#;

fn upgraded_release_library_with_a_stored_curve() -> (TempDir, Connection) {
    let release = latest_release();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let seed = Connection::open(&path).expect("open fixture");
    seed.execute_batch(release.library.expect("the latest release has a library"))
        .expect("replay fixture");
    seed.execute(
        "INSERT INTO curve_bodies (kind, sport, days, gap, raw) VALUES ('power', 'Ride', 90, 0, ?1)",
        [SERVER_BODY],
    )
    .expect("a curve the last release stored");
    drop(seed);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load");
    drop(engine);
    let conn = Connection::open(&path).expect("reopen");
    conn.execute_batch("PRAGMA foreign_keys = ON")
        .expect("keys");
    (dir, conn)
}

#[test]
fn a_curve_the_last_release_stored_reads_as_the_servers() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library_with_a_stored_curve();

    let (raw, source): (String, String) = conn
        .query_row(
            "SELECT raw, source FROM curve_bodies WHERE kind = 'power' AND days = 90",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the stored curve survives");

    assert_eq!(raw, SERVER_BODY);
    assert_eq!(source, "intervals");
    let curves: i64 = conn
        .query_row("SELECT COUNT(*) FROM activity_curves", [], |r| r.get(0))
        .expect("the table exists");
    assert_eq!(curves, 0);
}

#[test]
fn an_activitys_curves_go_with_the_activity() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library_with_a_stored_curve();
    conn.execute(
        "INSERT INTO activity_curves (activity_id, kind, points) VALUES ('lib-ride-1', 'power', x'00')",
        [],
    )
    .expect("curve of a stored activity");
    assert!(
        conn.execute(
            "INSERT INTO activity_curves (activity_id, kind, points) VALUES ('nobody', 'power', x'00')",
            [],
        )
        .is_err(),
        "a curve names an activity the library holds"
    );

    conn.execute("DELETE FROM activities WHERE id = 'lib-ride-1'", [])
        .expect("delete the activity");

    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM activity_curves", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}
