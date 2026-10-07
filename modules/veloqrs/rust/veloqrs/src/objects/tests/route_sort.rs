use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};

#[test]
fn test_name_sort_uses_displayed_route_name_case_insensitively() {
    let _guard = serial_global_state();
    let _temp = init_global_engine("route_sort.db");
    crate::persistence::with_persistent_engine(|engine| {
        for (id, name) in [("r_1", "Zulu"), ("r_2", "alpha"), ("r_3", "Bravo")] {
            engine.db.execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES (?, ?, '[]', 'Ride')",
                [id, id],
            ).unwrap();
            engine.set_route_name(id, Some(name)).unwrap();
        }
        engine.db.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_0', 'r_0', '[]', 'Ride')",
            [],
        ).unwrap();
    }).unwrap();

    let summaries = RouteManager::new()
        .get_summaries(None, Some("name".into()))
        .unwrap();
    let ids: Vec<_> = summaries
        .summaries
        .iter()
        .map(|group| group.group_id.as_str())
        .collect();
    assert_eq!(ids, ["r_2", "r_3", "r_0", "r_1"]);
}
