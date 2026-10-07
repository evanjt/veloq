//! A section with no name of its own is shown as its number behind the current
//! language's section word. The number is stored apart from the name, held by
//! every section from the moment its row appears, and unique by constraint.

use std::collections::{BTreeMap, HashMap};

use rusqlite::params;
use tracematch::{Direction, FrequentSection, GpsPoint, SectionPortion};

use crate::persistence::{NAME_TRANSLATIONS, PersistentEngine, SectionNameError};

/// Sets the process-wide section word and puts the default back on drop, so a
/// failing assertion cannot leave another test reading in the wrong language.
struct SectionWord;

impl SectionWord {
    fn set(word: &str) -> Self {
        NAME_TRANSLATIONS.write().unwrap().section_word = word.to_string();
        SectionWord
    }
}

impl Drop for SectionWord {
    fn drop(&mut self) {
        NAME_TRANSLATIONS.write().unwrap().section_word = "Section".to_string();
    }
}

fn track(offset: f64) -> Vec<GpsPoint> {
    (0..50)
        .map(|i| GpsPoint::new(46.0 + offset + i as f64 * 0.0005, 7.0))
        .collect()
}

fn detected(id: &str, members: usize) -> FrequentSection {
    let activity_ids: Vec<String> = (0..members).map(|i| format!("a{i}")).collect();
    FrequentSection {
        id: id.to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        polyline: track(0.0),
        representative_activity_id: "a0".to_string(),
        representative_range: None,
        activity_ids: activity_ids.clone(),
        activity_portions: activity_ids
            .iter()
            .map(|activity_id| SectionPortion {
                activity_id: activity_id.clone(),
                start_index: 0,
                end_index: 50,
                distance_meters: 2500.0,
                direction: Direction::Same,
            })
            .collect(),
        visit_count: members as u32,
        distance_meters: 2500.0,
        activity_traces: HashMap::new(),
        confidence: 0.8,
        observation_count: members as u32,
        average_spread: 10.0,
        point_density: vec![members as u32; 50],
        scale: Some(tracematch::sections::ScaleName::Medium),
        is_user_defined: false,
        stability: 1.0,
        version: 1,
        updated_at: None,
        created_at: None,
        consensus_state: None,
        elevation_gain_m: None,
        avg_grade_percent: None,
        enrichment: Default::default(),
        rank: None,
    }
}

fn engine_with_rides(rides: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for i in 0..rides {
        engine
            .add_activity(format!("a{i}"), track(0.0), "Ride".to_string())
            .unwrap();
    }
    engine
}

/// Put `sections` in the auto catalogue the way a detection apply does.
fn detect(engine: &mut PersistentEngine, sections: Vec<FrequentSection>) {
    engine.sections.retain(|s| s.is_user_defined);
    engine.sections.extend(sections);
    engine.save_sections().unwrap();
}

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

fn numbers(engine: &PersistentEngine) -> BTreeMap<String, u32> {
    let mut stmt = engine
        .db
        .prepare("SELECT section_id, number FROM section_numbers")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn stored_name(engine: &PersistentEngine, id: &str) -> Option<String> {
    engine
        .db
        .query_row(
            "SELECT name FROM sections WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .unwrap()
}

fn shown(engine: &PersistentEngine, id: &str) -> Option<String> {
    engine.get_all_section_names().remove(id)
}

#[test]
fn mints_under_two_section_words_never_share_a_number() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(3);
    {
        let _german = SectionWord::set("Abschnitt");
        detect(&mut engine, vec![detected("s_a", 3)]);
    }
    detect(&mut engine, vec![detected("s_a", 3), detected("s_b", 2)]);

    assert_eq!(
        numbers(&engine),
        BTreeMap::from([("s_a".to_string(), 1), ("s_b".to_string(), 2)])
    );
    assert_eq!(stored_name(&engine, "s_a"), None);
    assert_eq!(stored_name(&engine, "s_b"), None);
    assert_eq!(shown(&engine, "s_a").as_deref(), Some("Section 1"));
    assert_eq!(shown(&engine, "s_b").as_deref(), Some("Section 2"));

    let _german = SectionWord::set("Abschnitt");
    assert_eq!(shown(&engine, "s_a").as_deref(), Some("Abschnitt 1"));
    assert_eq!(shown(&engine, "s_b").as_deref(), Some("Abschnitt 2"));
}

#[test]
fn the_store_refuses_a_second_section_on_one_number() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = engine_with_rides(0);
    insert_row(&engine, "s_a", "auto", None);
    insert_row(&engine, "s_b", "auto", None);
    assert_eq!(numbers(&engine).len(), 2);

    let duplicate = engine.db.execute(
        "UPDATE section_numbers SET number = 1 WHERE section_id = 's_b'",
        [],
    );
    assert!(duplicate.is_err(), "two sections took number 1");
    let zero = engine.db.execute(
        "INSERT INTO section_numbers (section_id, number) VALUES ('s_c', 0)",
        [],
    );
    assert!(zero.is_err(), "a section took number 0");
}

#[test]
fn a_rewrite_of_the_catalogue_keeps_each_number_and_never_reissues_a_dropped_one() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(3);
    detect(
        &mut engine,
        vec![detected("s_a", 3), detected("s_b", 2), detected("s_c", 1)],
    );
    let first = numbers(&engine);
    assert_eq!(first.len(), 3);

    detect(&mut engine, vec![detected("s_c", 3), detected("s_a", 1)]);
    assert_eq!(numbers(&engine).get("s_a"), first.get("s_a"));
    assert_eq!(numbers(&engine).get("s_c"), first.get("s_c"));
    assert_eq!(numbers(&engine).get("s_b"), first.get("s_b"));

    detect(
        &mut engine,
        vec![detected("s_c", 3), detected("s_a", 1), detected("s_d", 1)],
    );
    assert_eq!(numbers(&engine).get("s_d"), Some(&4));

    detect(
        &mut engine,
        vec![detected("s_a", 3), detected("s_b", 2), detected("s_c", 1)],
    );
    assert_eq!(
        numbers(&engine).get("s_b"),
        first.get("s_b"),
        "a dissolved section that is detected again comes back under its number"
    );
}

#[test]
fn every_writer_takes_the_next_number_after_the_highest_issued_without_naming_one() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = engine_with_rides(0);
    insert_row(&engine, "s_1", "auto", None);
    insert_row(&engine, "s_2", "auto", None);
    insert_row(&engine, "s_3", "auto", None);
    insert_row(&engine, "split_child", "custom", None);
    insert_row(&engine, "merge_survivor", "custom", Some("Harbour climb"));
    engine
        .db
        .execute("DELETE FROM sections WHERE id = 's_2'", [])
        .unwrap();
    engine
        .db
        .execute("DELETE FROM section_numbers WHERE section_id = 's_2'", [])
        .unwrap();
    insert_row(&engine, "late", "auto", None);

    assert_eq!(
        numbers(&engine),
        BTreeMap::from([
            ("s_1".to_string(), 1),
            ("s_3".to_string(), 3),
            ("split_child".to_string(), 4),
            ("merge_survivor".to_string(), 5),
            ("late".to_string(), 6),
        ])
    );
}

#[test]
fn a_disabled_section_keeps_its_number() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(3);
    detect(&mut engine, vec![detected("s_a", 3), detected("s_b", 2)]);
    engine
        .db
        .execute("UPDATE sections SET disabled = 1 WHERE id = 's_a'", [])
        .unwrap();
    let before = numbers(&engine);

    detect(&mut engine, vec![detected("s_b", 2), detected("s_c", 1)]);
    assert_eq!(numbers(&engine).get("s_a"), before.get("s_a"));
    assert_eq!(numbers(&engine).get("s_c"), Some(&3));
}

#[test]
fn a_named_custom_section_holds_a_number_and_clearing_the_name_shows_it() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(0);
    insert_row(&engine, "s_a", "auto", None);
    insert_row(&engine, "mine", "custom", Some("Harbour climb"));
    engine.load_sections().unwrap();
    assert_eq!(numbers(&engine).get("mine"), Some(&2));
    assert_eq!(shown(&engine, "mine").as_deref(), Some("Harbour climb"));

    engine.set_section_name("mine", None).unwrap();
    assert_eq!(stored_name(&engine, "mine"), None);
    assert_eq!(shown(&engine, "mine").as_deref(), Some("Section 2"));
    assert_eq!(
        engine.get_section("mine").and_then(|s| s.name).as_deref(),
        Some("Section 2")
    );
    assert!(
        engine
            .get_section_summaries()
            .iter()
            .any(|s| s.id == "mine" && s.name.as_deref() == Some("Section 2"))
    );
}

#[test]
fn deleting_a_section_keeps_its_number_retired() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(0);
    insert_row(&engine, "mine", "custom", None);
    insert_row(&engine, "other", "custom", None);
    engine.load_sections().unwrap();

    engine.delete_section("mine").unwrap();
    assert_eq!(numbers(&engine).get("mine"), Some(&1));
    insert_row(&engine, "next", "custom", None);
    assert_eq!(numbers(&engine).get("next"), Some(&3));
}

#[test]
fn a_section_merged_away_keeps_its_number_and_a_new_section_takes_the_next() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(2);
    insert_row(&engine, "mine_a", "custom", None);
    insert_row(&engine, "mine_b", "custom", None);

    engine.merge_user_sections("mine_a", "mine_b").unwrap();
    insert_row(&engine, "mine_c", "custom", None);

    let held = numbers(&engine);
    assert_eq!(held.get("mine_a"), Some(&1));
    assert_eq!(
        held.get("mine_b"),
        Some(&2),
        "the absorbed id keeps its number"
    );
    assert_eq!(held.get("mine_c"), Some(&3));
}

#[test]
fn a_typed_label_for_the_number_of_a_retired_section_is_refused() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(2);
    insert_row(&engine, "mine_a", "custom", None);
    insert_row(&engine, "mine_b", "custom", None);
    insert_row(&engine, "mine_c", "custom", None);
    engine.load_sections().unwrap();
    engine.merge_user_sections("mine_a", "mine_b").unwrap();

    assert_eq!(
        engine.set_section_name("mine_c", Some("Section 2")),
        Err(SectionNameError::Taken("Section 2".into()))
    );
}

#[test]
fn the_record_backup_carries_the_numbers_of_retired_sections() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(2);
    insert_row(&engine, "mine_a", "custom", None);
    insert_row(&engine, "mine_b", "custom", None);
    engine.merge_user_sections("mine_a", "mine_b").unwrap();

    let payload = crate::persistence::record_backup::collect_record_payload(&engine.db).unwrap();
    let carried: Vec<(String, i64)> = payload
        .entries
        .iter()
        .filter(|row| row.table == "section_numbers")
        .map(|row| {
            (
                row.values["section_id"].as_str().unwrap().to_string(),
                row.values["number"].as_i64().unwrap(),
            )
        })
        .collect();
    assert!(carried.contains(&("mine_b".to_string(), 2)), "{carried:?}");
}

fn five_sections_with_third_named() -> PersistentEngine {
    let mut engine = engine_with_rides(0);
    for i in 1..=5 {
        insert_row(&engine, &format!("s_{i}"), "custom", None);
    }
    engine.load_sections().unwrap();
    engine
        .set_section_name("s_3", Some("Harbour climb"))
        .unwrap();
    engine
}

#[test]
fn a_typed_label_for_a_number_a_named_section_holds_is_refused() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = five_sections_with_third_named();

    assert_eq!(
        engine.set_section_name("s_2", Some("Section 3")),
        Err(SectionNameError::Taken("Section 3".into()))
    );
    assert_eq!(stored_name(&engine, "s_2"), None);
}

#[test]
fn a_typed_label_for_a_free_number_is_refused_and_changes_nothing() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = five_sections_with_third_named();
    let before = numbers(&engine);

    assert_eq!(
        engine.set_section_name("s_2", Some("Section 9")),
        Err(SectionNameError::Taken("Section 9".into()))
    );
    assert_eq!(stored_name(&engine, "s_2"), None);
    assert_eq!(shown(&engine, "s_2").as_deref(), Some("Section 2"));
    assert_eq!(numbers(&engine), before);
}

#[test]
fn a_typed_label_equal_to_the_sections_own_handle_clears_the_name() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = five_sections_with_third_named();

    engine.set_section_name("s_3", Some("Abschnitt 3")).unwrap();
    assert_eq!(stored_name(&engine, "s_3"), None);
    assert_eq!(shown(&engine, "s_3").as_deref(), Some("Section 3"));

    engine.set_section_name("s_2", Some("Section 2")).unwrap();
    assert_eq!(stored_name(&engine, "s_2"), None);
}

#[test]
fn a_typed_label_in_another_shipped_language_is_refused() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = five_sections_with_third_named();

    assert!(engine.set_section_name("s_2", Some("Sezione 4")).is_err());
    assert_eq!(stored_name(&engine, "s_2"), None);
}

#[test]
fn a_name_with_no_section_word_ending_in_a_number_is_accepted() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = five_sections_with_third_named();

    engine
        .set_section_name("s_2", Some("Hill climb 2"))
        .unwrap();
    assert_eq!(stored_name(&engine, "s_2").as_deref(), Some("Hill climb 2"));
}

#[test]
fn a_typed_name_ending_in_a_number_on_an_auto_section_survives_the_next_apply() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(3);
    detect(&mut engine, vec![detected("s_auto", 3)]);

    for name in ["Col 2", "Hill climb 2", "Route 66"] {
        engine.set_section_name("s_auto", Some(name)).unwrap();
        assert_eq!(shown(&engine, "s_auto").as_deref(), Some(name));

        detect(&mut engine, vec![detected("s_auto", 3)]);

        assert_eq!(
            shown(&engine, "s_auto").as_deref(),
            Some(name),
            "{name} was dropped by the apply"
        );
    }
}

#[test]
fn a_typed_name_a_trim_left_on_the_row_survives_the_next_apply() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(3);
    detect(&mut engine, vec![detected("s_auto", 3)]);
    engine
        .db
        .execute(
            "UPDATE sections SET name = 'Hill climb 2' WHERE id = 's_auto'",
            [],
        )
        .unwrap();

    engine.return_row_name_to_intent("s_auto").unwrap();
    detect(&mut engine, vec![detected("s_auto", 3)]);

    assert_eq!(shown(&engine, "s_auto").as_deref(), Some("Hill climb 2"));
}

#[test]
fn a_legacy_minted_label_is_not_promoted_but_a_typed_name_ending_in_a_number_is() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = engine_with_rides(3);
    for (id, name) in [("s_typed", "Col 2"), ("s_minted", "Ride Section 4")] {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, is_user_defined)
                 VALUES (?, 'auto', ?, 'Ride', ?, 2500.0, 0)",
                params![id, name, serde_json::to_string(&track(0.0)).unwrap()],
            )
            .unwrap();
    }

    let promoted =
        PersistentEngine::promote_legacy_named_rows(&engine.db, &engine.db, true).unwrap();

    assert_eq!(promoted, 1);
    assert_eq!(stored_name(&engine, "s_typed"), None);
    assert_eq!(
        stored_name(&engine, "s_minted").as_deref(),
        Some("Ride Section 4")
    );
}

#[test]
fn merging_keeps_a_typed_name_ending_in_a_number_from_either_side() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = engine_with_rides(2);
    insert_row(&engine, "mine_a", "custom", Some("Col 2"));
    insert_row(&engine, "mine_b", "custom", Some("Hill climb 3"));
    insert_row(&engine, "mine_c", "custom", None);

    engine.merge_user_sections("mine_a", "mine_b").unwrap();
    assert_eq!(stored_name(&engine, "mine_a").as_deref(), Some("Col 2"));

    engine.merge_user_sections("mine_c", "mine_a").unwrap();
    assert_eq!(stored_name(&engine, "mine_c").as_deref(), Some("Col 2"));
}
