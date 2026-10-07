use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

fn seed_groups() {
    crate::with_persistent_engine(|engine| {
        for (id, members) in [("g1", &["a0", "a1"][..]), ("g2", &["a2"][..])] {
            engine.db.execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES (?1, ?2, ?3, 'Ride', ?4)",
                rusqlite::params![id, members[0], serde_json::to_string(members).unwrap(), members.len()],
            ).unwrap();
        }
    }).unwrap();
}

#[test]
fn test_get_summaries_pooled_matches_locked() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    let routes = RouteManager::new();
    routes.set_name("g1".into(), "Lake loop".into()).unwrap();
    let expected = crate::with_persistent_engine(|engine| engine.get_group_summaries()).unwrap();
    let actual = routes.get_summaries(None, None).unwrap();
    assert_eq!(actual.total_count, 2);
    assert_eq!(actual.summaries.len(), expected.len());
    for (actual, expected) in actual.summaries.iter().zip(expected) {
        assert_eq!(actual.group_id, expected.group_id);
        assert_eq!(actual.activity_count, expected.activity_count);
        assert_eq!(actual.sport_types, expected.sport_types);
        assert_eq!(actual.custom_name, expected.custom_name);
    }
}

/// Scenario: the overlay picker offered while recording lists these
/// summaries, and they carried no distance, so two routes from one start
/// read alike. The distance is the representative's, as the routes list's.
#[test]
fn test_get_summaries_carry_the_representatives_distance() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    crate::with_persistent_engine(|engine| {
        let metric = |id: &str, distance: f64| crate::ActivityMetrics {
            activity_id: id.to_string(),
            name: "Ride".to_string(),
            date: 1_700_000_000,
            distance,
            moving_time: 3_600,
            elapsed_time: 3_700,
            elevation_gain: 100.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        };
        engine
            .set_activity_metrics(vec![metric("a0", 4_200.0), metric("a2", 12_600.0)])
            .unwrap();
    })
    .unwrap();

    let routes = RouteManager::new();
    let pooled = routes.get_summaries(None, None).unwrap().summaries;
    let locked = crate::with_persistent_engine(|engine| engine.get_group_summaries()).unwrap();

    for summaries in [&pooled, &locked] {
        let distance = |id: &str| {
            summaries
                .iter()
                .find(|g| g.group_id == id)
                .map(|g| g.distance_meters)
        };
        assert_eq!(distance("g1"), Some(4_200.0));
        assert_eq!(distance("g2"), Some(12_600.0));
    }
}

#[test]
fn test_get_summaries_without_a_representative_metric_carry_zero_distance() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute("DELETE FROM activity_metrics", [])
            .unwrap();
    })
    .unwrap();

    let summaries = RouteManager::new()
        .get_summaries(None, None)
        .unwrap()
        .summaries;

    assert_eq!(summaries.len(), 2);
    assert!(summaries.iter().all(|g| g.distance_meters == 0.0));
}

#[test]
fn test_get_screen_data_pooled_matches_locked_distance_page() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    let routes = RouteManager::new();
    let query = crate::FfiRoutesScreenQuery {
        group_sort: crate::FfiGroupSort::Distance,
        group_limit: 1,
        ..Default::default()
    };
    let expected =
        crate::with_persistent_engine(|engine| engine.get_routes_screen_data(query.clone()))
            .unwrap();
    let actual = routes.get_screen_data(query).unwrap();
    assert_eq!(actual.activity_count, expected.activity_count);
    assert_eq!(actual.group_count, expected.group_count);
    assert_eq!(actual.filtered_group_count, expected.filtered_group_count);
    assert_eq!(actual.has_more_groups, expected.has_more_groups);
    assert_eq!(actual.groups.len(), 1);
    assert_eq!(actual.groups[0].group_id, expected.groups[0].group_id);
    assert_eq!(
        actual.groups[0].distance_meters,
        expected.groups[0].distance_meters
    );
    assert_eq!(actual.groups[0].sport_types, expected.groups[0].sport_types);
    assert_eq!(
        actual.groups[0].encoded_polyline,
        expected.groups[0].encoded_polyline
    );
    assert_eq!(actual.groups_dirty, expected.groups_dirty);
}

#[test]
fn test_get_screen_data_dirty_state_follows_engine_install() {
    let _guard = serial_global_state();
    let old = seeded_global_engine();
    let routes = RouteManager::new();
    assert!(
        routes
            .get_screen_data(Default::default())
            .unwrap()
            .groups_dirty
    );
    let current = init_global_engine("empty_after_dirty.db");
    assert!(
        !routes
            .get_screen_data(Default::default())
            .unwrap()
            .groups_dirty
    );
    drop((old, current));
}

#[test]
fn test_get_summaries_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("route_summaries_under_writer.db");
    let routes = RouteManager::new();
    let result = read_while_writer_holds(|| routes.get_summaries(None, None).unwrap());
    assert_eq!(result.total_count, 0);
}

#[test]
fn test_get_screen_data_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("routes_screen_under_writer.db");
    let routes = RouteManager::new();
    let result = read_while_writer_holds(|| {
        routes
            .get_screen_data(crate::FfiRoutesScreenQuery::default())
            .unwrap()
    });
    assert_eq!(result.group_count, 0);
}

#[test]
fn test_routes_screen_page_reads_count_distance_and_sports_without_a_stored_count() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "UPDATE route_groups SET activity_count = NULL WHERE id = 'g1'",
                [],
            )
            .unwrap();
        engine
            .set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: "a0".to_string(),
                name: "Ride".to_string(),
                date: 1_700_000_000,
                distance: 4_200.0,
                moving_time: 3_600,
                elapsed_time: 3_700,
                elevation_gain: 100.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .unwrap();
    })
    .unwrap();

    let page = RouteManager::new()
        .get_screen_data(crate::FfiRoutesScreenQuery {
            group_limit: 10,
            ..Default::default()
        })
        .unwrap();

    let g1 = page.groups.iter().find(|g| g.group_id == "g1").unwrap();
    assert_eq!(g1.activity_count, 2);
    assert_eq!(g1.distance_meters, 4_200.0);
    assert!(!g1.sport_types.is_empty());
    assert_eq!(
        page.groups[0].group_id, "g1",
        "two members sort ahead of one"
    );
}
