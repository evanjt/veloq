//! The route side reads that answer from committed rows: one group, its
//! representative line, the names and the exclusions. The representative line
//! is read once per route row on mount, so a sync page in flight used to hold
//! the whole routes list behind its write.

use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

fn seed_groups() {
    crate::with_persistent_engine(|engine| {
        for (id, members) in [("g1", &["a0", "a1"][..]), ("g2", &["a2"][..])] {
            engine
                .db
                .execute(
                    "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                     VALUES (?1, ?2, ?3, 'Ride', ?4)",
                    rusqlite::params![
                        id,
                        members[0],
                        serde_json::to_string(members).unwrap(),
                        members.len()
                    ],
                )
                .unwrap();
        }
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
                 VALUES ('g1', 'a1', 0.9, 'same', 1)",
                [],
            )
            .unwrap();
    })
    .unwrap();
}

#[test]
fn test_get_representative_route_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("route_representative_under_writer.db");
    let routes = RouteManager::new();
    assert!(
        read_while_writer_holds(|| routes.get_representative_route("g1".into()).unwrap())
            .is_empty()
    );
}

#[test]
fn test_get_all_names_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("route_names_under_writer.db");
    let routes = RouteManager::new();
    assert!(read_while_writer_holds(|| routes.get_all_names().unwrap()).is_empty());
}

#[test]
fn test_get_excluded_activities_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("route_excluded_under_writer.db");
    let routes = RouteManager::new();
    assert!(
        read_while_writer_holds(|| routes.get_excluded_activities("g1".into()).unwrap()).is_empty()
    );
}

#[test]
fn test_route_side_reads_match_the_engine() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    seed_groups();
    let routes = RouteManager::new();
    routes.set_name("g1".into(), "Lake loop".into()).unwrap();

    let group = routes
        .get_all()
        .unwrap()
        .into_iter()
        .find(|g| g.group_id == "g1")
        .expect("seeded group");
    let locked = crate::with_persistent_engine(|e| {
        crate::persistence::routes::pooled::group_by_id(&e.db, "g1")
    })
    .unwrap()
    .expect("seeded group");
    assert_eq!(group.group_id, locked.group_id);
    assert_eq!(group.representative_id, locked.representative_id);
    assert_eq!(group.activity_ids, locked.activity_ids);
    assert_eq!(group.custom_name.as_deref(), Some("Lake loop"));
    assert_eq!(group.custom_name, locked.custom_name);

    let line = routes.get_representative_route("g1".into()).unwrap();
    assert!(!line.is_empty(), "a0 carries a stored track");
    assert_eq!(
        line,
        crate::with_persistent_engine(|e| e
            .get_representative_route("g1")
            .map(|points| crate::persistence::codec::encode_polyline(&points))
            .unwrap_or_default())
        .unwrap()
    );

    assert_eq!(
        routes.get_all_names().unwrap(),
        crate::with_persistent_engine(|e| e.get_all_route_names()).unwrap()
    );
    assert_eq!(
        routes.get_excluded_activities("g1".into()).unwrap(),
        vec!["a1".to_string()]
    );
}
