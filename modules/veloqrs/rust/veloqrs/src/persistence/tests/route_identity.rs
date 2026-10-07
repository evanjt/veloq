use super::*;

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

#[test]
fn test_reseed_identity_preserves_numeric_seniority_on_merge() {
    let prior = vec![
        group("r_9", &["a", "b", "c", "d"]),
        group("r_10", &["e", "f", "g", "h"]),
        group("r_100", &["i"]),
    ];
    let mut identity = reseed_identity(&prior);
    assert!(identity.first_seen["r_9"] < identity.first_seen["r_10"]);
    assert!(identity.first_seen["r_10"] < identity.first_seen["r_100"]);

    let (merged, _) = identity.remap(
        prior,
        vec![group(
            "candidate",
            &["a", "b", "c", "d", "e", "f", "g", "h"],
        )],
        &HashSet::new(),
    );
    assert_eq!(merged[0].group_id, "r_9");
}

#[test]
fn test_reseed_identity_places_other_ids_after_numeric_ids() {
    let prior = vec![
        group("legacy_b", &["b"]),
        group("r_10", &["c"]),
        group("r_9", &["d"]),
        group("legacy_a", &["a"]),
    ];
    let identity = reseed_identity(&prior);
    assert!(identity.first_seen["r_9"] < identity.first_seen["r_10"]);
    assert!(identity.first_seen["r_10"] < identity.first_seen["legacy_a"]);
    assert!(identity.first_seen["legacy_a"] < identity.first_seen["legacy_b"]);
}

#[test]
fn test_remap_breaks_equal_seniority_by_numeric_route_id() {
    let mut identity = RouteIdentity {
        first_seen: [("r_9".to_string(), 1), ("r_10".to_string(), 1)]
            .into_iter()
            .collect(),
        ordinal: 10,
    };
    let prior = vec![group("r_10", &["c", "d"]), group("r_9", &["a", "b"])];
    let (groups, _) = identity.remap(
        prior,
        vec![group("merged", &["a", "b", "c", "d"])],
        &HashSet::new(),
    );
    assert_eq!(groups[0].group_id, "r_9");
}

#[test]
fn test_remap_mints_past_adopted_route_ids() {
    let mut identity = RouteIdentity {
        first_seen: [("r_2".to_string(), 2)].into_iter().collect(),
        ordinal: 6,
    };
    let prior = vec![group("r_7", &["a"]), group("r_8", &["b"])];
    let (groups, _) = identity.remap(
        prior,
        vec![group("carry", &["b"]), group("new", &["c"])],
        &HashSet::new(),
    );
    let ids: BTreeSet<_> = groups.iter().map(|group| group.group_id.as_str()).collect();
    assert_eq!(ids, BTreeSet::from(["r_8", "r_10"]));
}

#[test]
fn test_reload_groups_restores_committed_registry() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.db.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_8', 'b', '[\"b\"]', 'Ride')",
        [],
    ).unwrap();
    let committed = RouteIdentity {
        first_seen: [("r_8".to_string(), 8)].into_iter().collect(),
        ordinal: 8,
    };
    write_identity(&engine.db, &committed).unwrap();

    engine.reload_groups_from_db();
    assert_eq!(engine.route_identity.ordinal, 8);
    assert_eq!(engine.route_identity.first_seen["r_8"], 8);

    let prior = engine.groups.clone();
    let (next, _) = engine.route_identity_remap(
        prior,
        vec![group("carry", &["b"]), group("new", &["c"])],
        &HashSet::new(),
    );
    engine.groups = next;
    engine.save_groups().unwrap();
    let stored: u32 = engine
        .db
        .query_row("SELECT COUNT(DISTINCT id) FROM route_groups", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stored, 2);
    assert!(engine.groups.iter().any(|group| group.group_id == "r_9"));
}

#[test]
fn test_reload_groups_reseeds_unreadable_registry() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.db.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_12', 'b', '[\"b\"]', 'Ride')",
        [],
    ).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO identity_state (key, blob, updated_at) VALUES (?, x'00', datetime('now'))",
            [ROUTE_IDENTITY_KEY],
        )
        .unwrap();

    engine.reload_groups_from_db();
    assert_eq!(engine.route_identity.ordinal, 12);
    assert_eq!(engine.route_identity.first_seen["r_12"], 1);
}

#[test]
fn test_adopting_committed_groups_keeps_an_owed_regroup_owed() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.set_groups_dirty(true);
    engine.adopt_committed_groups();
    assert!(engine.groups_are_dirty());

    engine.set_groups_dirty(false);
    engine.adopt_committed_groups();
    assert!(!engine.groups_are_dirty());
}

#[test]
fn test_remap_carries_a_representative_only_when_the_athlete_chose_it() {
    let prior = vec![group("r_1", &["a", "b", "c"]), group("r_2", &["d", "e"])];
    let mut identity = reseed_identity(&prior);
    let mut regrouped = vec![
        group("x", &["a", "b", "c", "f"]),
        group("y", &["d", "e", "g"]),
    ];
    regrouped[0].representative_id = "b".to_string();
    regrouped[1].representative_id = "e".to_string();

    let chosen = HashSet::from(["r_2".to_string()]);
    let (groups, _) = identity.remap(prior, regrouped, &chosen);

    let representative = |id: &str| {
        groups
            .iter()
            .find(|group| group.group_id == id)
            .map(|group| group.representative_id.as_str())
    };
    assert_eq!(representative("r_1"), Some("b"));
    assert_eq!(representative("r_2"), Some("d"));
}
