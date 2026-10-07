use super::*;

#[test]
fn test_recompute_saves_numbers_before_reload() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = crate::PersistentEngine::in_memory().unwrap();
    for (id, latitude) in [("a", 40.0), ("b", 50.0)] {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?, 'Ride', ?, ?, 10.0, 10.0)",
                params![id, latitude, latitude + 0.04],
            )
            .unwrap();
        let points: Vec<GpsPoint> = (0..40)
            .map(|i| GpsPoint::new(latitude + i as f64 * 0.001, 10.0))
            .collect();
        let bounds = Bounds::from_points(&points).unwrap();
        let signature = RouteSignature {
            activity_id: id.to_string(),
            start_point: points[0],
            end_point: *points.last().unwrap(),
            bounds,
            center: bounds.center(),
            total_distance: 4000.0,
            points,
        };
        engine.store_signature(id, &signature).unwrap();
    }
    let (groups, _) = recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &MatchConfig::default(),
        &[],
        engine.group_generation,
    );
    let numbered: u32 = engine
        .db
        .query_row("SELECT COUNT(*) FROM route_numbers", [], |row| row.get(0))
        .unwrap();
    assert_eq!(numbered as usize, groups.len());
    assert!(!groups.is_empty());
}

#[test]
fn test_background_save_mints_numbers_in_member_count_order() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = crate::PersistentEngine::in_memory().unwrap();
    let groups = vec![
        RouteGroup {
            group_id: "r_10".to_string(),
            representative_id: "short".to_string(),
            activity_ids: vec!["short".to_string()],
            sport_type: "Unknown".to_string(),
            bounds: None,
            custom_name: None,
            best_time: None,
            avg_time: None,
            best_pace: None,
            best_activity_id: None,
        },
        RouteGroup {
            group_id: "r_9".to_string(),
            representative_id: "long_1".to_string(),
            activity_ids: vec!["long_1".to_string(), "long_2".to_string()],
            sport_type: "Unknown".to_string(),
            bounds: None,
            custom_name: None,
            best_time: None,
            avg_time: None,
            best_pace: None,
            best_activity_id: None,
        },
    ];
    let identity = crate::persistence::route_identity::reseed_identity(&groups);
    save_groups_to_db(
        &engine.db,
        crate::persistence::engine_install(),
        &groups,
        &identity,
        &HashMap::new(),
        &tracematch::MatchConfig::default(),
        engine.group_generation,
    )
    .unwrap();

    let numbers: Vec<(String, u32)> = engine
        .db
        .prepare("SELECT route_id, number FROM route_numbers ORDER BY route_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        numbers,
        vec![("r_10".to_string(), 2), ("r_9".to_string(), 1),]
    );

    engine.db.execute("DELETE FROM route_numbers", []).unwrap();
    engine.reload_groups_from_db();
    let reloaded: Vec<(String, u32)> = engine
        .db
        .prepare("SELECT route_id, number FROM route_numbers ORDER BY route_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(reloaded, numbers);

    engine.db.execute("DELETE FROM route_numbers", []).unwrap();
    engine.groups = groups;
    engine.save_groups().unwrap();
    let foreground: Vec<(String, u32)> = engine
        .db
        .prepare("SELECT route_id, number FROM route_numbers ORDER BY route_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(foreground, numbers);
}

#[test]
fn test_background_save_rebuilds_the_route_line_layer() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = crate::PersistentEngine::in_memory().unwrap();
    for (id, latitude) in [
        ("a", 40.0),
        ("b", 40.0),
        ("c", 50.0),
        ("d", 50.0),
        ("e", 60.0),
    ] {
        let points: Vec<GpsPoint> = (0..40)
            .map(|i| GpsPoint::new(latitude + i as f64 * 0.001, 10.0))
            .collect();
        engine
            .add_activity(id.into(), points, "Ride".into())
            .unwrap();
    }

    let (groups, save) = recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &MatchConfig::default(),
        &[],
        engine.group_generation,
    );
    assert_eq!(save, GroupSave::Committed);

    let mut drawn: Vec<(&str, &str)> = groups
        .iter()
        .filter(|group| group.activity_ids.len() >= 2)
        .map(|group| (group.group_id.as_str(), group.representative_id.as_str()))
        .collect();
    drawn.sort();
    assert_eq!(drawn.len(), 2, "two routes of two rides: {groups:?}");
    let lines = crate::persistence::route_lines::pooled::layer(&engine.db)
        .unwrap()
        .expect("a layer stamped with the background write's generation");
    let expected: Vec<(String, Vec<u8>)> = drawn
        .iter()
        .map(|(route, representative)| {
            let signature =
                crate::persistence::activities::pooled::signature(&engine.db, representative)
                    .unwrap();
            (
                route.to_string(),
                crate::persistence::codec::encode_polyline(&signature.points),
            )
        })
        .collect();
    let stored: Vec<(String, Vec<u8>)> = lines
        .into_iter()
        .map(|line| (line.route_id, line.polyline))
        .collect();
    assert_eq!(stored, expected);
}
