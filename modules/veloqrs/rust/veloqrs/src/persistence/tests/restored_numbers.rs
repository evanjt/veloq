//! A restore brings each route's and section's number back onto the ground it
//! was shown on, never onto whatever local row holds the old id. A number this
//! device already gave to other ground moves to a fresh one inside the same
//! restore, and a number whose ground is not here yet is held for it.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::params;
use tracematch::GpsPoint;

use crate::RouteGroup;
use crate::persistence::PersistentEngine;
use crate::persistence::record_backup::collect_record_payload;
use crate::persistence::sections::numbers::unnamed_label;

fn line(offset: f64) -> Vec<GpsPoint> {
    (0..30)
        .map(|i| GpsPoint::new(46.0 + offset + f64::from(i) * 0.000_09, 7.0))
        .collect()
}

fn add_section(engine: &PersistentEngine, id: &str, offset: f64) {
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES (?1, 'auto', 'Ride', ?2, 1000)",
            params![id, serde_json::to_string(&line(offset)).unwrap()],
        )
        .unwrap();
}

fn section_numbers(engine: &PersistentEngine) -> BTreeMap<String, u32> {
    let mut stmt = engine
        .db
        .prepare("SELECT section_id, number FROM section_numbers")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn route_numbers(engine: &PersistentEngine) -> BTreeMap<String, u32> {
    let mut stmt = engine
        .db
        .prepare("SELECT route_id, number FROM route_numbers")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn assert_no_number_shared(numbers: &BTreeMap<String, u32>) {
    let distinct: BTreeSet<u32> = numbers.values().copied().collect();
    assert_eq!(
        distinct.len(),
        numbers.len(),
        "a number is shared: {numbers:?}"
    );
}

fn restore(engine: &mut PersistentEngine, from: &PersistentEngine) -> super::RestoreRecordResult {
    let payload = collect_record_payload(&from.db).unwrap();
    engine
        .restore_record_json(&serde_json::to_string(&payload).unwrap())
        .unwrap()
}

fn group(id: &str, members: &[&str]) -> RouteGroup {
    RouteGroup {
        group_id: id.to_string(),
        representative_id: members[0].to_string(),
        activity_ids: members.iter().map(|member| member.to_string()).collect(),
        sport_type: "Ride".to_string(),
        bounds: None,
        custom_name: None,
        best_time: None,
        avg_time: None,
        best_pace: None,
        best_activity_id: None,
    }
}

fn save_groups(engine: &mut PersistentEngine, groups: Vec<RouteGroup>) {
    engine.groups = groups;
    engine.route_identity_reseed();
    engine.save_groups().unwrap();
}

fn set_route_number(engine: &PersistentEngine, route_id: &str, number: u32) {
    engine
        .db
        .execute(
            "UPDATE route_numbers SET number = ?2 WHERE route_id = ?1",
            params![route_id, number],
        )
        .unwrap();
}

/// Scenario: the backed-up library showed a climb as section 7. The new device
/// has numbered its own sections 1 to 9, with the climb as its section 3 and
/// its section 7 on other ground.
#[test]
fn a_restored_section_number_lands_on_its_ground_and_the_local_holder_moves() {
    let _serial = crate::test_globals::serial_global_state();
    let source = PersistentEngine::in_memory().unwrap();
    add_section(&source, "old-climb", 0.0);
    source
        .db
        .execute("UPDATE section_numbers SET number = 7", [])
        .unwrap();

    let mut restored = PersistentEngine::in_memory().unwrap();
    for n in 1..=9 {
        let offset = if n == 3 { 0.0 } else { f64::from(n) * 0.05 };
        add_section(&restored, &format!("local-{n}"), offset);
    }
    assert_eq!(section_numbers(&restored)["local-3"], 3);
    assert_eq!(section_numbers(&restored)["local-7"], 7);

    let result = restore(&mut restored, &source);
    assert_eq!(result.unplaced, 0);

    let numbers = section_numbers(&restored);
    assert_eq!(numbers["local-3"], 7, "the climb is section 7 again");
    assert_eq!(
        numbers["local-7"], 3,
        "the former 7 takes the lowest free number"
    );
    assert_eq!(numbers.len(), 9);
    assert_no_number_shared(&numbers);
    assert_eq!(
        unnamed_label(&restored.db, "local-3", &Default::default()).as_deref(),
        Some("Section 7")
    );

    let again = restore(&mut restored, &source);
    assert_eq!(again.unplaced, 0);
    assert_eq!(
        section_numbers(&restored),
        numbers,
        "a second restore moves nothing"
    );
}

#[test]
fn a_restored_number_whose_ground_is_not_here_is_held_until_it_is() {
    let _serial = crate::test_globals::serial_global_state();
    let source = PersistentEngine::in_memory().unwrap();
    add_section(&source, "old-climb", 0.0);
    source
        .db
        .execute("UPDATE section_numbers SET number = 2", [])
        .unwrap();

    let mut restored = PersistentEngine::in_memory().unwrap();
    for n in 1..=3 {
        add_section(&restored, &format!("local-{n}"), f64::from(n) * 0.05);
    }

    let result = restore(&mut restored, &source);
    assert_eq!(result.unplaced, 0, "a held number is not a record to place");
    assert!(restored.unplaced_records().unwrap().is_empty());
    let numbers = section_numbers(&restored);
    assert_eq!(
        numbers["local-2"], 4,
        "the local 2 moves off the restored number"
    );
    assert_no_number_shared(&numbers);

    add_section(&restored, "later", 0.4);
    assert_eq!(
        section_numbers(&restored)["later"],
        5,
        "a section detected later never takes the held number"
    );

    let reexported = collect_record_payload(&restored.db).unwrap();
    let carried: Vec<i64> = reexported
        .entries
        .iter()
        .filter(|row| row.table == "section_numbers")
        .filter_map(|row| row.values.get("number").and_then(|n| n.as_i64()))
        .collect();
    assert_eq!(
        carried.iter().filter(|n| **n == 2).count(),
        1,
        "a backup taken now carries the held number once: {carried:?}"
    );

    add_section(&restored, "climb", 0.0);
    assert_eq!(restored.retry_record_restore().unwrap().unplaced, 0);
    let numbers = section_numbers(&restored);
    assert_eq!(numbers["climb"], 2);
    assert_eq!(
        numbers.len(),
        5,
        "the hold is gone once its section holds it"
    );
    assert_no_number_shared(&numbers);
}

#[test]
fn a_restored_hand_cut_takes_its_number_over_an_auto_section_on_the_same_ground() {
    let _serial = crate::test_globals::serial_global_state();
    let ride = line(0.0);
    let mut source = PersistentEngine::in_memory().unwrap();
    source
        .add_activity("ride-1".to_string(), ride.clone(), "Ride".to_string())
        .unwrap();
    let cut = source
        .create_section(crate::sections::CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: ride[5..25].to_vec(),
            distance_meters: 1000.0,
            name: None,
            source_activity_id: Some("ride-1".to_string()),
            start_index: Some(5),
            end_index: Some(24),
        })
        .unwrap();
    source
        .db
        .execute(
            "UPDATE section_numbers SET number = 7 WHERE section_id = ?",
            [&cut],
        )
        .unwrap();

    let mut restored = PersistentEngine::in_memory().unwrap();
    restored
        .add_activity("ride-1".to_string(), ride.clone(), "Ride".to_string())
        .unwrap();
    restored
        .db
        .execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('detected', 'auto', 'Ride', ?1, 1000)",
            [serde_json::to_string(&ride[5..25]).unwrap()],
        )
        .unwrap();
    for n in 2..=7 {
        add_section(&restored, &format!("local-{n}"), f64::from(n) * 0.05);
    }

    assert_eq!(restore(&mut restored, &source).unplaced, 0);
    let custom: String = restored
        .db
        .query_row(
            "SELECT id FROM sections WHERE section_type = 'custom'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let numbers = section_numbers(&restored);
    assert_eq!(numbers[&custom], 7);
    assert_eq!(numbers["detected"], 1);
    assert_ne!(numbers["local-7"], 7);
    assert_no_number_shared(&numbers);
}

/// Scenario: the backed-up library showed one loop as route 7 and named
/// another "Harbour loop" on its `r_3`. The new device numbered its own routes
/// 1 to 9 and its `r_3` is the old route 7's ground.
#[test]
fn a_restored_route_number_and_name_land_by_members_not_by_id() {
    let _serial = crate::test_globals::serial_global_state();
    let mut source = PersistentEngine::in_memory().unwrap();
    save_groups(
        &mut source,
        vec![
            group("r_1", &["a", "b", "c"]),
            group("r_2", &["x1"]),
            group("r_3", &["f", "g"]),
        ],
    );
    source.db.execute("DELETE FROM route_numbers", []).unwrap();
    source
        .db
        .execute_batch(
            "INSERT INTO route_numbers (route_id, number) VALUES ('r_1', 7), ('r_2', 1), ('r_3', 2)",
        )
        .unwrap();
    source.set_route_name("r_3", Some("Harbour loop")).unwrap();

    let mut restored = PersistentEngine::in_memory().unwrap();
    let members: Vec<Vec<String>> = (1..=9)
        .map(|n| match n {
            3 => vec!["b".into(), "c".into(), "a".into()],
            5 => vec!["f".into(), "g".into()],
            _ => vec![format!("x{n}")],
        })
        .collect();
    let groups = members
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let m: Vec<&str> = m.iter().map(String::as_str).collect();
            group(&format!("r_{}", i + 1), &m)
        })
        .collect();
    save_groups(&mut restored, groups);
    for n in 1..=9 {
        set_route_number(&restored, &format!("r_{n}"), 100 + n);
    }
    for n in 1..=9 {
        set_route_number(&restored, &format!("r_{n}"), n);
    }

    assert_eq!(restore(&mut restored, &source).unplaced, 0);

    let numbers = route_numbers(&restored);
    assert_eq!(
        numbers["r_3"], 7,
        "the old route 7's ground is route 7 again"
    );
    assert_eq!(
        numbers["r_7"], 3,
        "the former 7 takes the lowest free number"
    );
    assert_eq!(numbers["r_5"], 2);
    assert_eq!(numbers.len(), 9);
    assert_no_number_shared(&numbers);

    let names = restored.get_all_route_names();
    assert_eq!(
        names["r_5"], "Harbour loop",
        "the name is on its own ground"
    );
    assert_eq!(names["r_3"], "Route 7");
    assert_eq!(names["r_7"], "Route 3");
    let shown = restored
        .get_groups()
        .iter()
        .find(|group| group.group_id == "r_3")
        .and_then(|group| group.custom_name.clone());
    assert_eq!(shown.as_deref(), Some("Route 7"));
}

#[test]
fn a_restored_route_number_whose_members_are_not_here_is_held_across_regroups() {
    let _serial = crate::test_globals::serial_global_state();
    let mut source = PersistentEngine::in_memory().unwrap();
    save_groups(&mut source, vec![group("r_1", &["far-a", "far-b"])]);
    set_route_number(&source, "r_1", 2);

    let mut restored = PersistentEngine::in_memory().unwrap();
    save_groups(
        &mut restored,
        vec![group("r_1", &["x1", "x2"]), group("r_2", &["y1"])],
    );
    assert_eq!(route_numbers(&restored)["r_2"], 2);

    assert_eq!(restore(&mut restored, &source).unplaced, 0);
    let numbers = route_numbers(&restored);
    assert_eq!(
        numbers["r_2"], 3,
        "the local 2 moves off the restored number"
    );
    assert_no_number_shared(&numbers);
    let shown = restored
        .get_groups()
        .iter()
        .find(|group| group.group_id == "r_2")
        .and_then(|group| group.custom_name.clone());
    assert_eq!(shown.as_deref(), Some("Route 3"));

    save_groups(
        &mut restored,
        vec![
            group("r_1", &["x1", "x2"]),
            group("r_2", &["y1"]),
            group("r_3", &["z1"]),
        ],
    );
    assert_eq!(
        route_numbers(&restored)["r_3"],
        4,
        "a route grouped later never takes the held number"
    );

    save_groups(
        &mut restored,
        vec![
            group("r_1", &["x1", "x2"]),
            group("r_2", &["y1"]),
            group("r_3", &["z1"]),
            group("r_4", &["far-b", "far-a"]),
        ],
    );
    assert_eq!(restored.retry_record_restore().unwrap().unplaced, 0);
    let numbers = route_numbers(&restored);
    assert_eq!(numbers["r_4"], 2);
    assert_eq!(numbers.len(), 4, "the hold is gone once its route holds it");
    assert_no_number_shared(&numbers);
}
