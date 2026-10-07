use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::attempts::{Claim, JobKey};
use veloqrs::push::prepare_native_session_from_keychain;

#[test]
fn push_open_preserves_foreground_lease_upload_and_indicator_version() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    let foreground = PersistentEngine::new(path).unwrap();
    foreground.mint_lease_generation().unwrap();
    let key = JobKey::new("sync", &["athlete-1"]);
    assert_eq!(foreground.claim_job(&key, 100).unwrap(), Claim::Taken);

    let conn = Connection::open(path).unwrap();
    conn.execute(
        "INSERT INTO recordings (id, fit_path, activity_type, name, start_time, \
         duration_seconds, distance_meters, created_at, upload_status) \
         VALUES ('r1', 'ride.fit', 'Ride', 'Ride', 1, 20, 100, 1, 'uploading')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE schema_info SET value = '0' WHERE key = 'indicator_version'",
        [],
    )
    .unwrap();

    assert_eq!(
        prepare_native_session_from_keychain(path, None, Some("key"), Some("athlete-1")),
        Ok(())
    );

    assert_eq!(foreground.claim_job(&key, 101).unwrap(), Claim::InFlight);
    assert_eq!(
        foreground
            .get_recording("r1")
            .unwrap()
            .unwrap()
            .upload_status,
        "uploading"
    );
    let indicator_version: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'indicator_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(indicator_version, "0");
}
