//! Scenario: a library from before the census recorded whether an activity
//! carries a series beyond its track is opened by this build, once from the
//! schema a released build shipped and once from the one just before the
//! column arrived, the second holding a census row already.
//!
//! Expected behaviour: the row survives the upgrade reading no series, which
//! is what keeps every trackless activity out of the stream pass until the
//! next census pull says otherwise, and a pull recorded afterwards reads back.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    let had_census = tables_at(&seeded).contains(&"activity_census".to_string());
    if had_census {
        assert!(!columns_of(&seeded, "activity_census").contains(&"has_series".to_string()));
        seeded
            .execute(
                "INSERT INTO activity_census (athlete_id, intervals_id, start_date_local, has_latlng)
                 VALUES ('a1', 'kept', '2026-09-01T08:00:00', 1)",
                [],
            )
            .unwrap();
    }
    drop(seeded);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    let census = engine.activity_census("a1");
    if had_census {
        let kept = census
            .iter()
            .find(|e| e.id == "kept")
            .expect("the row survives");
        assert!(kept.has_latlng);
        assert!(
            !kept.has_series,
            "an upgrade from v{version} claims no series it was never told about"
        );
    } else {
        assert!(census.is_empty());
    }

    engine
        .record_activity_census(
            "a1",
            &[
                ActivityCensusEntry {
                    id: "gym".to_string(),
                    start_date_local: Some("2026-09-02T08:00:00".to_string()),
                    has_series: true,
                    ..Default::default()
                },
                ActivityCensusEntry {
                    id: "stretch".to_string(),
                    start_date_local: Some("2026-09-03T08:00:00".to_string()),
                    ..Default::default()
                },
            ],
        )
        .unwrap();
    let census = engine.activity_census("a1");
    let series = |id: &str| census.iter().find(|e| e.id == id).map(|e| e.has_series);
    assert_eq!(series("gym"), Some(true));
    assert_eq!(series("stretch"), Some(false));
    drop(engine);

    assert_eq!(
        user_version(&Connection::open(&path).unwrap()),
        latest_version()
    );
}

#[test]
fn an_upgrade_from_the_released_schema_records_which_activities_carry_a_series() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_column_reads_no_series_until_the_next_pull() {
    upgrade_from(64);
}
