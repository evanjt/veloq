//! A split child with no name of its own reads as "{parent's shown name} / N"
//! when its parent shows a typed name, N being its part along the parent's
//! line. The name is composed at read and never stored, nests through further
//! splits, and counts as a shown name when another section is renamed.

use std::collections::BTreeMap;

use rusqlite::params;

use crate::persistence::{PersistentEngine, SectionNameError};

fn insert_row(engine: &PersistentEngine, id: &str, section_type: &str, name: Option<&str>) {
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, is_user_defined)
             VALUES (?, ?, ?, 'Ride', '[]', 100.0, ?)",
            params![id, section_type, name, section_type == "custom"],
        )
        .unwrap();
}

fn birth(engine: &PersistentEngine, child: &str, parent: &str, line_order: u32) {
    let details = serde_json::json!({
        "split_from": parent,
        "discriminator": "2",
        "line_order": line_order,
    });
    engine
        .db
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES (?1, '2026-01-01T00:00:00Z', 'formed', ?2)",
            params![child, details.to_string()],
        )
        .unwrap();
}

fn number(engine: &PersistentEngine, id: &str) -> u32 {
    engine
        .db
        .query_row(
            "SELECT number FROM section_numbers WHERE section_id = ?",
            params![id],
            |row| row.get(0),
        )
        .unwrap()
}

/// The names the pooled readers and the engine's own reads show, which must
/// agree.
fn shown(engine: &PersistentEngine) -> BTreeMap<String, String> {
    let pooled: BTreeMap<String, String> =
        crate::persistence::sections::naming::pooled::all_section_names(&engine.db)
            .into_iter()
            .collect();
    let overlay = crate::persistence::sections::named::pooled::overlay_names(&engine.db);
    let cached = engine.named_overlay_cached_names();
    for (id, name) in overlay.iter() {
        assert_eq!(pooled.get(id), Some(name), "pooled names disagree on {id}");
        assert_eq!(cached.get(id), Some(name), "engine names disagree on {id}");
    }
    pooled
}

fn shown_one(engine: &PersistentEngine, id: &str) -> Option<String> {
    let one = engine.named_overlay_name(id);
    assert_eq!(
        one,
        shown(engine).get(id).cloned(),
        "single read disagrees on {id}"
    );
    one
}

/// A named parent whose retained piece sits second along its line, with a
/// child either side of it.
fn named_parent_split_in_two() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_row(&engine, "summit", "custom", Some("Harbour Climb"));
    insert_row(&engine, "lower", "auto", None);
    insert_row(&engine, "upper", "auto", None);
    birth(&engine, "upper", "summit", 3);
    birth(&engine, "lower", "summit", 1);
    engine
}

#[test]
fn children_of_a_named_parent_are_numbered_along_its_line() {
    let engine = named_parent_split_in_two();
    let names = shown(&engine);
    assert_eq!(names["summit"], "Harbour Climb");
    assert_eq!(names["lower"], "Harbour Climb / 1");
    assert_eq!(names["upper"], "Harbour Climb / 3");
    assert_eq!(
        shown_one(&engine, "upper").as_deref(),
        Some("Harbour Climb / 3")
    );
}

#[test]
fn a_child_split_again_nests_its_part_under_its_own() {
    let engine = named_parent_split_in_two();
    insert_row(&engine, "ledge", "auto", None);
    birth(&engine, "ledge", "lower", 2);
    assert_eq!(shown(&engine)["ledge"], "Harbour Climb / 1 / 2");
    assert_eq!(
        shown_one(&engine, "ledge").as_deref(),
        Some("Harbour Climb / 1 / 2")
    );
}

#[test]
fn a_child_whose_parent_is_gone_keeps_its_number() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_row(&engine, "orphan", "auto", None);
    birth(&engine, "orphan", "vanished", 1);
    let label = format!("Section {}", number(&engine, "orphan"));
    assert_eq!(shown(&engine)["orphan"], label);
    assert_eq!(shown_one(&engine, "orphan"), Some(label));
}

#[test]
fn a_child_of_an_unnamed_parent_keeps_its_number() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_row(&engine, "plain", "auto", None);
    insert_row(&engine, "piece", "auto", None);
    insert_row(&engine, "sliver", "auto", None);
    birth(&engine, "piece", "plain", 1);
    birth(&engine, "sliver", "piece", 1);
    let names = shown(&engine);
    assert_eq!(
        names["piece"],
        format!("Section {}", number(&engine, "piece"))
    );
    assert_eq!(
        names["sliver"],
        format!("Section {}", number(&engine, "sliver"))
    );
}

#[test]
fn a_parent_shown_under_a_kept_handle_is_not_a_typed_name() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_row(&engine, "kept", "custom", Some("Section 40"));
    insert_row(&engine, "piece", "auto", None);
    birth(&engine, "piece", "kept", 1);
    assert_eq!(
        shown(&engine)["piece"],
        format!("Section {}", number(&engine, "piece"))
    );
}

#[test]
fn a_child_with_its_own_name_shows_it_and_passes_it_down() {
    let engine = named_parent_split_in_two();
    engine
        .db
        .execute(
            "UPDATE sections SET name = 'Quay Ramp' WHERE id = 'upper'",
            [],
        )
        .unwrap();
    insert_row(&engine, "crest", "auto", None);
    birth(&engine, "crest", "upper", 2);
    let names = shown(&engine);
    assert_eq!(names["upper"], "Quay Ramp");
    assert_eq!(names["crest"], "Quay Ramp / 2");
    assert_eq!(names["lower"], "Harbour Climb / 1");
}

#[test]
fn a_renamed_parent_renames_its_children_and_nothing_is_stored() {
    let mut engine = named_parent_split_in_two();
    engine
        .set_section_name("summit", Some("Breakwater Rise"))
        .unwrap();
    assert_eq!(shown(&engine)["lower"], "Breakwater Rise / 1");
    let stored: Option<String> = engine
        .db
        .query_row("SELECT name FROM sections WHERE id = 'lower'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stored, None);
}

#[test]
fn a_rename_to_a_composed_name_another_section_shows_is_refused() {
    let mut engine = named_parent_split_in_two();
    insert_row(&engine, "elsewhere", "custom", Some("Pier Loop"));
    assert_eq!(
        engine.set_section_name("elsewhere", Some("Harbour Climb / 3")),
        Err(SectionNameError::Taken("Harbour Climb / 3".to_string()))
    );
    assert_eq!(shown(&engine)["elsewhere"], "Pier Loop");
}

#[test]
fn a_lineage_that_loops_falls_back_to_numbers() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_row(&engine, "east", "auto", None);
    insert_row(&engine, "west", "auto", None);
    birth(&engine, "east", "west", 1);
    birth(&engine, "west", "east", 1);
    let names = shown(&engine);
    assert_eq!(
        names["east"],
        format!("Section {}", number(&engine, "east"))
    );
    assert_eq!(
        names["west"],
        format!("Section {}", number(&engine, "west"))
    );
}

fn insert_line(engine: &PersistentEngine, id: &str, from_lat: f64, to_lat: f64) {
    let steps = ((to_lat - from_lat) / 0.0001).round() as i32;
    let line: Vec<tracematch::GpsPoint> = (0..=steps)
        .map(|i| tracematch::GpsPoint::new(from_lat + f64::from(i) * 0.0001, 7.0))
        .collect();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, is_user_defined, version, created_at)
             VALUES (?, 'auto', NULL, 'Ride', ?, 100.0, 0, 1, '2026-01-01T00:00:00Z')",
            params![id, serde_json::to_string(&line).unwrap()],
        )
        .unwrap();
}

fn name_ground(engine: &PersistentEngine, name: &str, from_lat: f64, to_lat: f64) {
    let steps = ((to_lat - from_lat) / 0.0001).round() as i32;
    let line: Vec<tracematch::GpsPoint> = (0..=steps)
        .map(|i| tracematch::GpsPoint::new(from_lat + f64::from(i) * 0.0001, 7.0))
        .collect();
    engine
        .db
        .execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES ('ni_1', 'named', ?, '2026-01-01T00:00:00Z', ?, 'Ride')",
            params![serde_json::to_string(&line).unwrap(), name],
        )
        .unwrap();
    engine.ensure_named_overlay();
}

/// A named line cut into a head, a middle holding the largest share and a
/// short tail. The tail keeps the parent's id; the other two are born of it.
fn named_line_split_in_three() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_line(&engine, "parent", 46.0315, 46.037);
    insert_line(&engine, "head", 46.0, 46.015);
    insert_line(&engine, "middle", 46.015, 46.0315);
    birth(&engine, "head", "parent", 1);
    birth(&engine, "middle", "parent", 2);
    name_ground(&engine, "Quay Climb", 46.0, 46.037);
    engine
}

#[test]
fn a_name_on_a_split_line_follows_the_piece_holding_the_parents_id() {
    let engine = named_line_split_in_three();
    let names = shown(&engine);
    assert_eq!(shown_one(&engine, "parent").as_deref(), Some("Quay Climb"));
    assert_eq!(names["head"], "Quay Climb / 1");
    assert_eq!(names["middle"], "Quay Climb / 2");
}

#[test]
fn a_name_on_an_unsplit_line_stays_on_its_largest_piece() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_line(&engine, "head", 46.0, 46.015);
    insert_line(&engine, "middle", 46.015, 46.0315);
    name_ground(&engine, "Quay Climb", 46.0, 46.037);
    assert_eq!(shown(&engine)["middle"], "Quay Climb");
}

#[test]
fn renaming_a_split_child_names_that_child_and_leaves_its_siblings_alone() {
    let mut engine = named_line_split_in_three();
    engine
        .set_section_name("middle", Some("Harbour Rise"))
        .unwrap();
    engine.ensure_named_overlay();
    let names = shown(&engine);
    assert_eq!(names["middle"], "Harbour Rise");
    assert_eq!(names["parent"], "Quay Climb");
    assert_eq!(names["head"], "Quay Climb / 1");
}

#[test]
fn a_child_renamed_after_its_split_keeps_its_name_beside_a_named_parent() {
    let mut engine = named_line_split_in_three();
    engine
        .set_section_name("head", Some("Harbour Rise"))
        .unwrap();
    engine
        .set_section_name("middle", Some("Pier Steps"))
        .unwrap();
    engine.ensure_named_overlay();
    let names = shown(&engine);
    assert_eq!(names["head"], "Harbour Rise");
    assert_eq!(names["middle"], "Pier Steps");
    assert_eq!(names["parent"], "Quay Climb");
}
