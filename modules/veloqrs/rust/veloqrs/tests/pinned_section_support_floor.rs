//! Scenario: a pin freezes a section's existence, but `load_sections`
//! derives `activity_ids` from the junction rows, so a section persisted with
//! no `section_activities` comes off disk with no contributors at all.
//!
//! Expected behaviour: a pinned section survives the support floor with no
//! traversals of its own, and an unpinned one of the same shape still does not.
//! The exemption is the pin and nothing else, because a section with no
//! traversals and no pin is what the floor exists to keep out of the catalogue.
//!
//! Run: `cargo test --test pinned_section_support_floor -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn insert_activity(db: &Connection, id: &str, start_unix: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?3, 1000.0, 300)",
        params![id, start_unix, format!("Activity {}", id)],
    )
    .expect("insert activity");
}

fn insert_section(db: &Connection, id: &str, sport: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                               created_at, updated_at)
         VALUES (?1, 'auto', ?1, ?2, '[]', 500.0, 0, 1,
                 46.0, 46.01, 7.0, 7.01, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, sport],
    )
    .expect("insert section");
}

fn pin(db: &Connection, section_id: &str) {
    db.execute(
        "INSERT INTO section_pins (section_id, version) VALUES (?1, 1)",
        params![section_id],
    )
    .expect("pin section");
}

/// Seed a database with one pinned and one unpinned section, both with two
/// stored activities and no junction rows, then reopen so both come off disk
/// through `load_sections`.
fn reopened_with_two_unsupported_sections() -> (PersistentEngine, TempDir) {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();

    {
        let engine = PersistentEngine::new(&path_str).expect("engine new");
        drop(engine);
    }
    let raw = Connection::open(&path).expect("raw open");
    insert_activity(&raw, "act_1", 1_700_000_000);
    insert_activity(&raw, "act_2", 1_700_003_600);
    insert_section(&raw, "sec_pinned", "Ride");
    insert_section(&raw, "sec_loose", "Ride");
    pin(&raw, "sec_pinned");
    drop(raw);

    let mut engine = PersistentEngine::new(&path_str).expect("engine reopen");
    engine.load().expect("load");
    (engine, tmp)
}

fn ids(engine: &PersistentEngine, sport: Option<&str>, min: Option<u32>) -> Vec<String> {
    engine
        .get_sections_filtered(sport, min)
        .into_iter()
        .map(|s| s.id.clone())
        .collect()
}

#[test]
fn a_pinned_section_with_no_traversals_survives_the_support_floor() {
    let (engine, _tmp) = reopened_with_two_unsupported_sections();

    let listed = ids(&engine, None, Some(2));

    assert!(
        listed.contains(&"sec_pinned".to_string()),
        "a pin freezes existence, so the floor must not drop it: {:?}",
        listed
    );
}

#[test]
fn an_unpinned_section_with_no_traversals_is_still_dropped() {
    let (engine, _tmp) = reopened_with_two_unsupported_sections();

    let listed = ids(&engine, None, Some(2));

    assert!(
        !listed.contains(&"sec_loose".to_string()),
        "the exemption is the pin and nothing else: {:?}",
        listed
    );
}

#[test]
fn the_exemption_survives_a_sport_filter_on_the_pinned_sections_own_sport() {
    let (engine, _tmp) = reopened_with_two_unsupported_sections();

    let listed = ids(&engine, Some("Ride"), Some(1));

    assert!(listed.contains(&"sec_pinned".to_string()), "{:?}", listed);
    assert!(!listed.contains(&"sec_loose".to_string()), "{:?}", listed);
}

/// A pin is not a claim that another sport travelled the ground. The sport
/// filter is a relevance question, not a support floor, so it still applies.
#[test]
fn a_pin_does_not_put_a_ride_in_the_run_list() {
    let (engine, _tmp) = reopened_with_two_unsupported_sections();

    let listed = ids(&engine, Some("Run"), Some(1));

    assert!(!listed.contains(&"sec_pinned".to_string()), "{:?}", listed);
}

/// With no floor asked for there is nothing to exempt, and the answer must be
/// the same as it always was: both sections list.
#[test]
fn no_floor_lists_both_pinned_and_unpinned() {
    let (engine, _tmp) = reopened_with_two_unsupported_sections();

    let listed = ids(&engine, None, None);

    assert!(listed.contains(&"sec_pinned".to_string()), "{:?}", listed);
    assert!(listed.contains(&"sec_loose".to_string()), "{:?}", listed);
}
