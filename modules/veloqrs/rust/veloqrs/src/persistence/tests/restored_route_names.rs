//! A local route takes one restored name per restore. When the grouping here
//! merges several backed-up routes into one, the name of the old route that
//! shares the most rides with it is the one it takes, and the others are
//! counted as not restored rather than written over one another.

use crate::RouteGroup;
use crate::persistence::PersistentEngine;

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

fn name_entry(old_route: &str, name: &str, members: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "table": "route_names",
        "values": { "route_id": old_route, "custom_name": name },
        "ground": { "rep_activity_id": members[0], "activity_ids": members },
    })
}

fn restore_entries(
    engine: &mut PersistentEngine,
    entries: Vec<serde_json::Value>,
) -> super::RestoreRecordResult {
    let payload = serde_json::json!({
        "version": super::super::record_backup::RECORD_VERSION,
        "entries": entries,
    });
    engine.restore_record_json(&payload.to_string()).unwrap()
}

fn stored_name(engine: &PersistentEngine, route_id: &str) -> Option<String> {
    engine
        .db
        .query_row(
            "SELECT custom_name FROM route_names WHERE route_id = ?1",
            [route_id],
            |row| row.get(0),
        )
        .ok()
}

fn merged_library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    save_groups(
        &mut engine,
        vec![group("r_1", &["a", "b", "c"]), group("r_2", &["far"])],
    );
    engine
}

/// Scenario: the backed-up library named its route over rides a and b
/// "Canal tow" and its route over ride c "Lock gate". Here one route holds
/// all three rides.
#[test]
fn two_names_on_one_merged_route_keep_the_closer_match_in_either_order() {
    let _serial = crate::test_globals::serial_global_state();
    let long = name_entry("old-tow", "Canal tow", &["a", "b"]);
    let short = name_entry("old-gate", "Lock gate", &["c"]);
    for entries in [
        vec![long.clone(), short.clone()],
        vec![short.clone(), long.clone()],
    ] {
        let mut restored = merged_library();
        let result = restore_entries(&mut restored, entries);
        assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Canal tow"));
        assert_eq!(result.placed, 1, "only the name written counts as placed");
        assert_eq!(result.names_not_restored, 1);
        assert_eq!(result.unplaced, 0);
        assert_eq!(restored.not_restored_name_count().unwrap(), 1);

        restored.retry_record_restore().unwrap();
        assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Canal tow"));
        assert_eq!(restored.not_restored_name_count().unwrap(), 1);
    }
}

#[test]
fn equal_matches_on_one_route_go_to_the_first_in_the_record() {
    let _serial = crate::test_globals::serial_global_state();
    let mut restored = merged_library();
    let result = restore_entries(
        &mut restored,
        vec![
            name_entry("old-north", "North bank", &["a"]),
            name_entry("old-south", "South bank", &["b"]),
        ],
    );
    assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("North bank"));
    assert_eq!((result.placed, result.names_not_restored), (1, 1));
}

/// Scenario: two backed-up routes carried the same name and now share one
/// route here. The athlete loses nothing, so nothing is reported dropped.
#[test]
fn the_same_name_twice_on_one_route_is_placed_twice() {
    let _serial = crate::test_globals::serial_global_state();
    let mut restored = merged_library();
    let result = restore_entries(
        &mut restored,
        vec![
            name_entry("old-tow", "Canal tow", &["a", "b"]),
            name_entry("old-tow-again", "Canal tow", &["c"]),
        ],
    );
    assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Canal tow"));
    assert_eq!((result.placed, result.names_not_restored), (2, 0));
    assert_eq!(restored.not_restored_name_count().unwrap(), 0);
}

/// Scenario: the first pass names a route "Canal tow". A second backed-up
/// route's rides are not here yet, so its name "Lock gate" waits. Once they
/// arrive the grouping folds them into the named route, sharing more rides
/// with it than "Canal tow" ever did.
///
/// Expected behaviour: the later pass leaves "Canal tow" alone and counts
/// "Lock gate" as not restored.
#[test]
fn a_later_pass_never_overwrites_a_name_an_earlier_pass_restored() {
    let _serial = crate::test_globals::serial_global_state();
    let mut restored = merged_library();
    let first = restore_entries(
        &mut restored,
        vec![
            name_entry("old-tow", "Canal tow", &["a", "b"]),
            name_entry("old-gate", "Lock gate", &["x", "y", "z"]),
        ],
    );
    assert_eq!((first.placed, first.unplaced), (1, 1));
    assert_eq!(first.names_not_restored, 0);

    save_groups(
        &mut restored,
        vec![
            group("r_1", &["a", "b", "c", "x", "y", "z"]),
            group("r_2", &["far"]),
        ],
    );
    let second = restored.retry_record_restore().unwrap();
    assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Canal tow"));
    assert_eq!((second.placed, second.unplaced), (0, 0));
    assert_eq!(second.names_not_restored, 1);
    assert_eq!(restored.not_restored_name_count().unwrap(), 1);
}

/// Scenario: two backed-up routes land on two different routes here, one in
/// each pass. Neither is a merge, so both names stand.
#[test]
fn names_on_different_routes_place_across_passes() {
    let _serial = crate::test_globals::serial_global_state();
    let mut restored = merged_library();
    restore_entries(
        &mut restored,
        vec![
            name_entry("old-tow", "Canal tow", &["a", "b"]),
            name_entry("old-weir", "Weir path", &["w"]),
        ],
    );
    save_groups(
        &mut restored,
        vec![group("r_1", &["a", "b", "c"]), group("r_2", &["far", "w"])],
    );
    let second = restored.retry_record_restore().unwrap();
    assert_eq!((second.placed, second.names_not_restored), (1, 0));
    assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Canal tow"));
    assert_eq!(stored_name(&restored, "r_2").as_deref(), Some("Weir path"));
}

/// Scenario: a restore named a route and finished. A later import of another
/// backup is a restore of its own, and its name for that route is written.
#[test]
fn a_finished_restore_does_not_hold_its_names_against_the_next() {
    let _serial = crate::test_globals::serial_global_state();
    let mut restored = merged_library();
    restore_entries(
        &mut restored,
        vec![name_entry("old-tow", "Canal tow", &["a", "b"])],
    );
    let next = restore_entries(
        &mut restored,
        vec![name_entry("old-tow", "Towpath", &["a", "b"])],
    );
    assert_eq!((next.placed, next.names_not_restored), (1, 0));
    assert_eq!(stored_name(&restored, "r_1").as_deref(), Some("Towpath"));
}
