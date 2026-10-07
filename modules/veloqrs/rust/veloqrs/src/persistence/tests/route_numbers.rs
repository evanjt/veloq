//! An unnamed route is shown as its number behind the current language's route
//! word. The number is stored apart from any name the athlete typed, so it
//! reads the same in every language and two routes never share one.

use std::collections::{BTreeSet, HashMap};

use rusqlite::params;

use super::{PersistentEngine, RouteGroup};
use crate::persistence::NAME_TRANSLATIONS;

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

/// Sets the process-wide route word and puts the default back on drop, so a
/// failing assertion cannot leave another test minting in the wrong language.
struct RouteWord;

impl RouteWord {
    fn set(word: &str) -> Self {
        NAME_TRANSLATIONS.write().unwrap().route_word = word.to_string();
        RouteWord
    }
}

impl Drop for RouteWord {
    fn drop(&mut self) {
        NAME_TRANSLATIONS.write().unwrap().route_word = "Route".to_string();
    }
}

fn save(engine: &mut PersistentEngine, groups: Vec<RouteGroup>) {
    engine.groups = groups;
    engine.route_identity_reseed();
    engine.save_groups().unwrap();
}

fn number_of(name: &str) -> u32 {
    name.rsplit(' ').next().unwrap().parse().unwrap()
}

fn stored_numbers(engine: &PersistentEngine) -> HashMap<String, u32> {
    let mut stmt = engine
        .db
        .prepare("SELECT route_id, number FROM route_numbers")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn routes_minted_under_two_route_words_never_show_one_number() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(
        &mut engine,
        vec![group("r_1", &["a", "b"]), group("r_2", &["c"])],
    );

    let _word = RouteWord::set("ルート");
    save(
        &mut engine,
        vec![
            group("r_1", &["a", "b"]),
            group("r_2", &["c"]),
            group("r_3", &["d"]),
        ],
    );

    let names = engine.get_all_route_names();
    assert_eq!(names.get("r_1").map(String::as_str), Some("ルート 1"));
    assert_eq!(names.get("r_2").map(String::as_str), Some("ルート 2"));
    assert_eq!(names.get("r_3").map(String::as_str), Some("ルート 3"));
    let numbers: BTreeSet<u32> = names.values().map(|name| number_of(name)).collect();
    assert_eq!(
        numbers.len(),
        names.len(),
        "two routes share a number: {names:?}"
    );
}

#[test]
fn the_in_memory_names_follow_a_change_of_language() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(&mut engine, vec![group("r_1", &["a"])]);
    assert_eq!(
        engine.get_groups()[0].custom_name.as_deref(),
        Some("Route 1")
    );

    let _word = RouteWord::set("Strecke");
    assert_eq!(
        engine.get_groups()[0].custom_name.as_deref(),
        Some("Strecke 1")
    );
    assert_eq!(engine.get_route_name("r_1").as_deref(), Some("Strecke 1"));
}

#[test]
fn the_store_refuses_two_routes_on_one_number() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = PersistentEngine::in_memory().unwrap();
    let insert = "INSERT INTO route_numbers (route_id, number) VALUES (?, ?)";
    engine.db.execute(insert, params!["r_1", 7]).unwrap();
    assert!(engine.db.execute(insert, params!["r_2", 7]).is_err());
    assert!(engine.db.execute(insert, params!["r_3", 0]).is_err());
}

#[test]
fn a_typed_name_replaces_the_number_on_screen_and_clearing_it_brings_the_number_back() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(
        &mut engine,
        vec![group("r_1", &["a", "b"]), group("r_2", &["c"])],
    );

    engine.set_route_name("r_1", Some("Harbour loop")).unwrap();
    assert_eq!(
        engine.get_route_name("r_1").as_deref(),
        Some("Harbour loop")
    );
    assert_eq!(stored_numbers(&engine).get("r_1"), Some(&1));

    engine.set_route_name("r_1", None).unwrap();
    assert_eq!(engine.get_route_name("r_1").as_deref(), Some("Route 1"));
    assert_eq!(
        engine.get_all_route_names().get("r_1").map(String::as_str),
        Some("Route 1")
    );

    // Saving the handle unchanged stores no name, so the label still follows
    // the language.
    engine.set_route_name("r_2", Some("Route 2")).unwrap();
    let _word = RouteWord::set("Rute");
    assert_eq!(
        engine.get_all_route_names().get("r_2").map(String::as_str),
        Some("Rute 2")
    );
}

#[test]
fn a_regroup_that_splits_and_merges_leaves_no_two_routes_on_one_number() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(
        &mut engine,
        vec![
            group("r_1", &["a", "b", "c", "d"]),
            group("r_2", &["e", "f"]),
            group("r_3", &["g"]),
        ],
    );
    assert_eq!(
        stored_numbers(&engine),
        HashMap::from([
            ("r_1".to_string(), 1),
            ("r_2".to_string(), 2),
            ("r_3".to_string(), 3)
        ])
    );

    // r_1 splits in two and r_3 is folded into r_2.
    engine.groups = vec![
        group("r_1", &["a", "b"]),
        group("r_4", &["c", "d"]),
        group("r_2", &["e", "f", "g"]),
    ];
    engine.save_groups().unwrap();

    let numbers = stored_numbers(&engine);
    assert_eq!(
        numbers.get("r_1"),
        Some(&1),
        "a surviving route was renumbered"
    );
    assert_eq!(
        numbers.get("r_2"),
        Some(&2),
        "a surviving route was renumbered"
    );
    assert_eq!(
        numbers.get("r_3"),
        Some(&3),
        "a dissolved route lost its number"
    );
    assert_eq!(numbers.get("r_4"), Some(&4));
    let distinct: BTreeSet<u32> = numbers.values().copied().collect();
    assert_eq!(distinct.len(), numbers.len(), "{numbers:?}");
}

#[test]
fn a_kept_label_holds_its_number_and_a_new_route_takes_the_lowest_free_one() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    let names = [
        ("r_1", "Route 3"),
        ("r_2", "Walk Route 5"),
        ("r_3", "Harbour loop"),
        ("r_5", "Strecke 4"),
        ("r_6", "Route 3"),
    ];
    for (id, name) in names {
        engine
            .db
            .execute(
                "INSERT INTO route_names (route_id, custom_name) VALUES (?, ?)",
                params![id, name],
            )
            .unwrap();
    }
    save(
        &mut engine,
        vec![
            group("r_1", &["a", "b"]),
            group("r_2", &["c"]),
            group("r_3", &["d"]),
            group("r_4", &["e"]),
            group("r_5", &["f"]),
            group("r_6", &["g"]),
        ],
    );

    let numbers = stored_numbers(&engine);
    assert_eq!(numbers.get("r_1"), Some(&3));
    assert_eq!(numbers.get("r_2"), Some(&5));
    assert_eq!(numbers.get("r_5"), Some(&4));
    assert_eq!(numbers.get("r_3"), Some(&1));
    assert_eq!(numbers.get("r_4"), Some(&2));
    assert_eq!(numbers.get("r_6"), Some(&6));

    let shown = engine.get_all_route_names();
    for (id, name) in names {
        assert_eq!(
            shown.get(id).map(String::as_str),
            Some(name),
            "{id} lost its name"
        );
    }
    assert_eq!(shown.get("r_4").map(String::as_str), Some("Route 2"));
}

#[test]
fn a_number_freed_when_its_group_leaves_is_never_given_to_another_route() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(
        &mut engine,
        vec![group("r_a", &["a1", "a2"]), group("r_b", &["b1"])],
    );
    assert_eq!(stored_numbers(&engine)["r_b"], 2);

    save(&mut engine, vec![group("r_a", &["a1", "a2"])]);
    save(
        &mut engine,
        vec![group("r_a", &["a1", "a2"]), group("r_c", &["c1"])],
    );
    let numbers = stored_numbers(&engine);
    assert_eq!(numbers["r_c"], 3, "the new route took a retired number");
    assert_eq!(numbers["r_b"], 2, "the departed route lost its number");
    assert_eq!(
        engine.get_all_route_names().get("r_c").map(String::as_str),
        Some("Route 3")
    );
}

#[test]
fn a_group_that_returns_keeps_the_number_it_left_with() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let _word = RouteWord::set("Route");
    save(
        &mut engine,
        vec![group("r_a", &["a1"]), group("r_b", &["b1"])],
    );
    save(&mut engine, vec![group("r_a", &["a1"])]);
    save(
        &mut engine,
        vec![group("r_a", &["a1"]), group("r_b", &["b1"])],
    );
    assert_eq!(stored_numbers(&engine)["r_b"], 2);
    assert_eq!(stored_numbers(&engine).len(), 2);
}

#[test]
fn the_record_backup_carries_the_numbers_of_retired_routes() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    save(
        &mut engine,
        vec![group("r_a", &["a1"]), group("r_b", &["b1"])],
    );
    save(&mut engine, vec![group("r_a", &["a1"])]);

    let payload = crate::persistence::record_backup::collect_record_payload(&engine.db).unwrap();
    let carried: Vec<(String, i64)> = payload
        .entries
        .iter()
        .filter(|row| row.table == "route_numbers")
        .map(|row| {
            (
                row.values["route_id"].as_str().unwrap().to_string(),
                row.values["number"].as_i64().unwrap(),
            )
        })
        .collect();
    assert!(carried.contains(&("r_b".to_string(), 2)), "{carried:?}");
}
