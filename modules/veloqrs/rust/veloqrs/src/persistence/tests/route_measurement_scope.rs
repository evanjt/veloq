//! Which routes a regroup measures again. A route whose members, representative
//! and member tracks are what its stored percentages were measured over keeps
//! those percentages, and only the rest load tracks and run the comparison.

use std::cell::RefCell;

use super::*;
use crate::persistence::regroup::recompute_and_save_groups;

fn route(id: &str, representative: &str, members: &[&str]) -> RouteGroup {
    RouteGroup {
        group_id: id.to_string(),
        representative_id: representative.to_string(),
        activity_ids: members.iter().map(|m| m.to_string()).collect(),
        sport_type: String::new(),
        bounds: None,
        custom_name: None,
        best_time: None,
        avg_time: None,
        best_pace: None,
        best_activity_id: None,
    }
}

fn rows(members: &[&str], percentage: f64) -> Vec<ActivityMatchInfo> {
    members
        .iter()
        .map(|id| ActivityMatchInfo {
            activity_id: id.to_string(),
            match_percentage: percentage,
            direction: Direction::Same,
        })
        .collect()
}

fn library() -> Vec<RouteGroup> {
    vec![
        route("r_1", "a1", &["a1", "a2", "a3", "a4", "a5"]),
        route("r_2", "b1", &["b1", "b2", "b3", "b4", "b5"]),
    ]
}

fn held_for(groups: &[RouteGroup]) -> HashMap<String, Vec<ActivityMatchInfo>> {
    groups
        .iter()
        .map(|g| {
            let members: Vec<&str> = g.activity_ids.iter().map(String::as_str).collect();
            (g.group_id.clone(), rows(&members, 88.0))
        })
        .collect()
}

fn owed(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

#[test]
fn an_unchanged_library_owes_no_route() {
    let previous = library();
    let held = held_for(&previous);
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &HashSet::new()),
        owed(&[])
    );
}

#[test]
fn a_route_that_took_a_member_is_owed_and_its_neighbour_is_not() {
    let previous = library();
    let held = held_for(&previous);
    let mut groups = library();
    groups[0].activity_ids.push("a6".into());
    assert_eq!(
        groups_owing_measurement(&previous, &groups, &held, &HashSet::new()),
        owed(&["r_1"])
    );
}

#[test]
fn a_route_that_lost_a_member_is_owed() {
    let previous = library();
    let held = held_for(&previous);
    let mut groups = library();
    groups[1].activity_ids.retain(|id| id != "b4");
    assert_eq!(
        groups_owing_measurement(&previous, &groups, &held, &HashSet::new()),
        owed(&["r_2"])
    );
}

#[test]
fn member_order_alone_owes_nothing() {
    let previous = library();
    let held = held_for(&previous);
    let mut groups = library();
    groups[0].activity_ids.reverse();
    assert_eq!(
        groups_owing_measurement(&previous, &groups, &held, &HashSet::new()),
        owed(&[])
    );
}

#[test]
fn a_new_representative_owes_its_route() {
    let previous = library();
    let held = held_for(&previous);
    let mut groups = library();
    groups[1].representative_id = "b3".into();
    assert_eq!(
        groups_owing_measurement(&previous, &groups, &held, &HashSet::new()),
        owed(&["r_2"])
    );
}

#[test]
fn a_moved_member_track_owes_only_its_route() {
    let previous = library();
    let held = held_for(&previous);
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &owed(&["b2"])),
        owed(&["r_2"])
    );
}

#[test]
fn a_moved_track_outside_every_route_owes_nothing() {
    let previous = library();
    let held = held_for(&previous);
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &owed(&["z9"])),
        owed(&[])
    );
}

#[test]
fn a_route_with_no_previous_counterpart_is_owed() {
    let previous = library();
    let held = held_for(&previous);
    let mut groups = library();
    groups.push(route("r_3", "c1", &["c1", "c2"]));
    assert_eq!(
        groups_owing_measurement(&previous, &groups, &held, &HashSet::new()),
        owed(&["r_3"])
    );
}

#[test]
fn a_member_with_no_stored_row_owes_its_route() {
    let previous = library();
    let mut held = held_for(&previous);
    held.get_mut("r_1")
        .unwrap()
        .retain(|m| m.activity_id != "a3");
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &HashSet::new()),
        owed(&["r_1"])
    );
}

#[test]
fn a_route_with_no_stored_rows_is_owed() {
    let previous = library();
    let mut held = held_for(&previous);
    held.remove("r_2");
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &HashSet::new()),
        owed(&["r_2"])
    );
}

/// The backfills write a member's row at zero before anything measured it.
#[test]
fn a_member_row_at_the_zero_placeholder_owes_its_route() {
    let previous = library();
    let mut held = held_for(&previous);
    held.get_mut("r_2").unwrap()[3].match_percentage = 0.0;
    assert_eq!(
        groups_owing_measurement(&previous, &library(), &held, &HashSet::new()),
        owed(&["r_2"])
    );
}

fn line(latitude: f64, longitude: f64, offset: f64) -> Vec<GpsPoint> {
    (0..120)
        .map(|i| {
            let step = f64::from(i) * 0.0001;
            GpsPoint::new(latitude + step + offset, longitude + step)
        })
        .collect()
}

/// Every track of `groups`, counting each load.
fn counted_tracks(groups: &[RouteGroup]) -> HashMap<String, Vec<GpsPoint>> {
    groups
        .iter()
        .enumerate()
        .flat_map(|(n, g)| {
            g.activity_ids
                .iter()
                .enumerate()
                .map(move |(k, id)| (id.clone(), line(40.0 + n as f64, 7.0, k as f64 * 0.00002)))
        })
        .collect()
}

#[test]
fn measuring_a_scope_loads_and_compares_only_its_routes() {
    let mut groups = library();
    groups[0].activity_ids.push("a6".into());
    let tracks = counted_tracks(&groups);
    let loaded: RefCell<Vec<String>> = RefCell::new(Vec::new());
    let seed = held_for(&library());
    let scope = owed(&["r_1"]);

    let measured = measure_match_percentages(
        &groups,
        &seed,
        &tracematch::MatchConfig::default(),
        |id| {
            loaded.borrow_mut().push(id.to_string());
            tracks.get(id).cloned()
        },
        Some(&scope),
        None,
    );

    let mut loaded = loaded.into_inner();
    loaded.sort();
    assert_eq!(loaded, ["a1", "a2", "a3", "a4", "a5", "a6"]);
    assert_eq!(
        measured["r_2"]
            .iter()
            .map(|m| m.match_percentage)
            .collect::<Vec<_>>(),
        vec![88.0; 5],
        "a route out of scope keeps the percentages it held"
    );
    assert!(measured["r_1"].iter().all(|m| m.match_percentage != 88.0));
    assert_eq!(measured["r_1"].len(), 6);
}

#[test]
fn an_empty_scope_loads_no_track() {
    let groups = library();
    let tracks = counted_tracks(&groups);
    let loads = RefCell::new(0usize);
    let seed = held_for(&groups);

    let measured = measure_match_percentages(
        &groups,
        &seed,
        &tracematch::MatchConfig::default(),
        |id| {
            *loads.borrow_mut() += 1;
            tracks.get(id).cloned()
        },
        Some(&HashSet::new()),
        None,
    );

    assert_eq!(*loads.borrow(), 0);
    assert_eq!(percentages(&measured), percentages(&seed));
}

fn percentages(matches: &HashMap<String, Vec<ActivityMatchInfo>>) -> Vec<(String, String, f64)> {
    let mut rows: Vec<(String, String, f64)> = matches
        .iter()
        .flat_map(|(route, rows)| {
            rows.iter()
                .map(|m| (route.clone(), m.activity_id.clone(), m.match_percentage))
        })
        .collect();
    rows.sort_by(|a, b| a.partial_cmp(b).unwrap());
    rows
}

const MARK: f64 = 61.0;

fn stored(conn: &Connection) -> HashMap<String, f64> {
    let mut stmt = conn
        .prepare("SELECT activity_id, match_percentage FROM activity_matches")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Stamp every stored percentage, on disk and in memory, with a value no
/// measurement of these tracks produces, so a route measured again shows it.
fn mark_every_percentage(engine: &mut PersistentEngine) {
    engine
        .db
        .execute("UPDATE activity_matches SET match_percentage = ?", [MARK])
        .unwrap();
    for matches in engine.activity_matches.values_mut() {
        for m in matches {
            m.match_percentage = MARK;
        }
    }
}

const CORRIDOR_A: (f64, f64) = (47.0, 7.0);
const CORRIDOR_B: (f64, f64) = (46.0, 8.0);

fn ride(corridor: (f64, f64), k: usize) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| {
            let frac = f64::from(i) / 200.0;
            GpsPoint::new(
                corridor.0 + frac * 0.01 + (k as f64) * 0.000005 * f64::from(i % 3),
                corridor.1 + frac * 0.01 + (k as f64) * 0.000005 * f64::from(i % 5),
            )
        })
        .collect()
}

/// Two routes of five, grouped and saved, every percentage then marked.
fn two_routes() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for k in 0..5 {
        engine
            .add_activity(format!("a{k}"), ride(CORRIDOR_A, k), "Ride".into())
            .unwrap();
        engine
            .add_activity(format!("b{k}"), ride(CORRIDOR_B, k), "Ride".into())
            .unwrap();
    }
    let groups = engine.get_groups().to_vec();
    assert_eq!(groups.len(), 2, "two corridors make two routes");
    mark_every_percentage(&mut engine);
    engine
}

fn measured_again(conn: &Connection, prefix: &str) -> Vec<String> {
    let mut ids: Vec<String> = stored(conn)
        .into_iter()
        .filter(|(id, percentage)| id.starts_with(prefix) && *percentage != MARK)
        .map(|(id, _)| id)
        .collect();
    ids.sort();
    ids
}

#[test]
fn a_foreground_regroup_measures_only_the_route_that_took_a_ride() {
    let mut engine = two_routes();
    engine
        .add_activity("a5".into(), ride(CORRIDOR_A, 5), "Ride".into())
        .unwrap();
    engine.get_groups();

    assert_eq!(measured_again(&engine.db, "b"), Vec::<String>::new());
    assert!(measured_again(&engine.db, "a").contains(&"a5".to_string()));
    assert!(
        measured_again(&engine.db, "a").len() >= 5,
        "every non-representative member of the route that took a ride is measured again"
    );
}

#[test]
fn a_background_regroup_measures_only_the_route_that_took_a_ride() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = two_routes();
    engine
        .add_activity("a5".into(), ride(CORRIDOR_A, 5), "Ride".into())
        .unwrap();

    let (_, save) = recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &engine.match_config.clone(),
        &engine.groups,
        engine.group_generation,
        &engine.moved_tracks.keys().cloned().collect(),
    );

    assert_eq!(save, crate::persistence::regroup::GroupSave::Committed);
    assert_eq!(measured_again(&engine.db, "b"), Vec::<String>::new());
    assert!(measured_again(&engine.db, "a").contains(&"a5".to_string()));
}

#[test]
fn a_moved_track_measures_its_route_again_and_no_other() {
    let mut engine = two_routes();
    let mut moved = ride(CORRIDOR_B, 2);
    for point in &mut moved {
        point.latitude += 0.00002;
    }
    engine
        .add_activity("b2".into(), moved, "Ride".into())
        .unwrap();
    assert!(engine.moved_tracks.contains_key("b2"));
    engine.get_groups();

    assert_eq!(measured_again(&engine.db, "a"), Vec::<String>::new());
    assert!(measured_again(&engine.db, "b").contains(&"b2".to_string()));
    assert!(
        engine.moved_tracks.is_empty(),
        "a committed regroup has measured every move it saw"
    );
}

#[test]
fn a_regroup_with_nothing_changed_measures_nothing() {
    let mut engine = two_routes();
    engine.set_groups_dirty(true);
    engine.get_groups();

    assert_eq!(measured_again(&engine.db, ""), Vec::<String>::new());
}

#[test]
fn a_changed_match_rule_measures_every_route_again() {
    let mut engine = two_routes();
    let (min, endpoint) = engine.match_strictness();
    engine.set_match_strictness(min, endpoint + 1.0);
    engine.get_groups();

    assert!(!measured_again(&engine.db, "a").is_empty());
    assert!(!measured_again(&engine.db, "b").is_empty());
}

#[test]
fn a_background_regroup_measures_the_route_of_a_moved_track() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = two_routes();
    let mut moved = ride(CORRIDOR_A, 3);
    for point in &mut moved {
        point.longitude += 0.00002;
    }
    engine
        .add_activity("a3".into(), moved, "Ride".into())
        .unwrap();

    let (_, save) = recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &engine.match_config.clone(),
        &engine.groups,
        engine.group_generation,
        &engine.moved_tracks.keys().cloned().collect(),
    );

    assert_eq!(save, crate::persistence::regroup::GroupSave::Committed);
    assert_eq!(measured_again(&engine.db, "b"), Vec::<String>::new());
    assert!(measured_again(&engine.db, "a").contains(&"a3".to_string()));
}

/// Scenario: a background regroup snapshots the moves at one epoch, and a
/// track is replaced again while it runs.
///
/// Expected behaviour: its commit settles only the moves its snapshot saw, and a
/// regroup that committed nothing settles none.
#[test]
fn a_committed_regroup_settles_only_the_moves_its_snapshot_saw() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.moved_tracks = HashMap::from([("seen".to_string(), 3), ("later".to_string(), 5)]);

    engine.adopt_run_groups(true, 4);
    assert_eq!(
        engine.moved_tracks.len(),
        2,
        "an uncommitted regroup settles nothing"
    );

    engine.adopt_run_groups(false, 4);
    assert_eq!(
        engine.moved_tracks.keys().collect::<Vec<_>>(),
        ["later"],
        "a move made after the snapshot is still owed"
    );
}
