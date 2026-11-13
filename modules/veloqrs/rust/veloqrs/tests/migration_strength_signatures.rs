//! Scenario: a library from before the strength signatures holds strength
//! sessions, once from the schema a released build shipped and once from the
//! one just before the table arrived.
//!
//! Expected behaviour: every set row survives, and the signatures arrive filled
//! from the sets, so the first read after the upgrade already groups the sessions.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const DAY: i64 = 86_400;
const NOW: i64 = 1_800_000_000;

fn add_session(conn: &Connection, id: &str, date: i64, sets: &[(i64, i64, i64)]) {
    conn.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
             elapsed_time, elevation_gain, sport_type)
         VALUES (?1, 'n', ?2, 0, 0, 0, 0, 'WeightTraining')",
        params![id, date],
    )
    .unwrap();
    for (order, (category, name, set_type)) in sets.iter().enumerate() {
        conn.execute(
            "INSERT INTO exercise_sets (activity_id, set_order, exercise_category,
                 exercise_name, set_type, repetitions, weight_kg)
             VALUES (?1, ?2, ?3, ?4, ?5, 8, 40.0)",
            params![id, order as i64, category, name, set_type],
        )
        .unwrap();
    }
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    add_session(
        &seeded,
        "a",
        NOW - 9 * DAY,
        &[(0, 1, 0), (0, 1, 0), (23, 2, 0)],
    );
    add_session(
        &seeded,
        "b",
        NOW - 3 * DAY,
        &[(23, 2, 0), (0xFFFE, 0, 0), (0, 1, 0), (0, 1, 1)],
    );
    add_session(&seeded, "c", NOW - DAY, &[(0, 1, 0), (28, 3, 0)]);
    drop(seeded);
    let before = tables_at(&Connection::open(&path).unwrap());
    assert!(!before.contains(&"strength_signatures".to_string()));

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    let groups: Vec<_> = engine
        .recent_strength_groups()
        .unwrap()
        .into_iter()
        .map(|g| (g.signature, g.times, g.latest_activity_id))
        .collect();
    assert_eq!(
        groups,
        vec![
            ("0.1,28.3".to_string(), 1, "c".to_string()),
            ("0.1,23.2".to_string(), 2, "b".to_string()),
        ],
        "from v{version}"
    );
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert_eq!(
        row_count(&conn, "exercise_sets"),
        Some(9),
        "every set row is kept"
    );
}

#[test]
fn an_upgrade_from_the_released_schema_groups_the_sessions_it_holds() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_schema_79_groups_the_sessions_it_holds() {
    upgrade_from(79);
}
