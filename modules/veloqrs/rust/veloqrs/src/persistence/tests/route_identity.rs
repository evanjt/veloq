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

fn matched(route_id: &str, members: &[&str]) -> (String, Vec<tracematch::ActivityMatchInfo>) {
    let rows = members
        .iter()
        .map(|member| tracematch::ActivityMatchInfo {
            activity_id: member.to_string(),
            match_percentage: 90.0,
            direction: tracematch::Direction::Same,
        })
        .collect();
    (route_id.to_string(), rows)
}

/// A library of two routes, the second named, with the athlete's exclusions on
/// two members of the first, saved the way a foreground regroup saves it.
fn seeded_regroup_library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.groups = vec![group("r_5", &["a", "b", "c"]), group("r_10", &["d", "e"])];
    engine.route_identity_reseed();
    engine.activity_matches = [
        matched("r_5", &["a", "b", "c"]),
        matched("r_10", &["d", "e"]),
    ]
    .into_iter()
    .collect();
    engine.save_groups().unwrap();
    engine
        .db
        .execute_batch(
            "INSERT INTO route_names (route_id, custom_name) VALUES ('r_5', 'Harbour loop');
             INSERT INTO route_names (route_id, custom_name) VALUES ('r_10', 'Quarry climb');
             UPDATE activity_matches SET excluded = 1
              WHERE route_id = 'r_5' AND activity_id IN ('a', 'b');",
        )
        .unwrap();
    engine
}

type CatalogueRows = (
    Vec<(String, String, Option<i64>)>,
    Vec<(String, String, f64, String, i64)>,
    Vec<(String, String)>,
    Vec<(String, i64)>,
);

fn catalogue_rows(conn: &Connection) -> CatalogueRows {
    fn rows<T>(
        conn: &Connection,
        sql: &str,
        map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> Vec<T> {
        let mut stmt = conn.prepare(sql).unwrap();
        stmt.query_map([], map)
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }
    (
        rows(
            conn,
            "SELECT id, representative_id, activity_count FROM route_groups ORDER BY id",
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ),
        rows(
            conn,
            "SELECT route_id, activity_id, match_percentage, direction, excluded
             FROM activity_matches ORDER BY route_id, activity_id",
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        ),
        rows(
            conn,
            "SELECT route_id, custom_name FROM route_names ORDER BY route_id",
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        rows(
            conn,
            "SELECT route_id, number FROM route_numbers ORDER BY route_id",
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
    )
}

/// Scenario: a regroup keeps r_5 for one of its three members and dissolves
/// the named r_10, while the held match map still carries r_5's old members.
/// Expected behaviour: whichever writer saves it, the stored catalogue is the
/// same, holds no match row for an activity that left its route and no name
/// for a route that no longer exists, and keeps the exclusion that survives.
#[test]
fn test_both_group_writers_store_one_catalogue_for_a_shrunk_and_dissolved_route() {
    let _serial = crate::test_globals::serial_global_state();
    let regrouped = vec![group("r_5", &["a"])];
    let held_matches: HashMap<_, _> = [matched("r_5", &["a", "b", "c"])].into_iter().collect();

    let mut foreground = seeded_regroup_library();
    foreground.groups = regrouped.clone();
    foreground.activity_matches = held_matches.clone();
    foreground.save_groups().unwrap();

    let (groups, matches, names, _) = catalogue_rows(&foreground.db);
    assert_eq!(groups, vec![("r_5".into(), "a".into(), Some(1))]);
    assert_eq!(
        matches,
        vec![("r_5".into(), "a".into(), 90.0, "same".into(), 1)],
        "an activity that left the route keeps no match row, and the surviving exclusion stays"
    );
    assert_eq!(
        names,
        vec![("r_5".into(), "Harbour loop".into())],
        "a dissolved route takes its name with it"
    );

    let background = seeded_regroup_library();
    let saved = crate::persistence::regroup::save_groups_to_db(
        &background.db,
        crate::persistence::engine_install(),
        &regrouped,
        &background.route_identity,
        &held_matches,
        &background.match_config,
        background.group_generation,
    )
    .unwrap();
    assert_eq!(saved, crate::persistence::regroup::GroupSave::Committed);

    assert_eq!(
        catalogue_rows(&background.db),
        catalogue_rows(&foreground.db),
        "the background and foreground writers store the same rows"
    );
}
