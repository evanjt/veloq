use super::*;

fn track(latitude: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|index| GpsPoint::new(latitude + f64::from(index) * 0.00001, 7.0))
        .collect()
}

fn group() -> RouteGroup {
    RouteGroup {
        group_id: "r_1".to_string(),
        representative_id: "a".to_string(),
        activity_ids: ["a", "b", "c"].map(str::to_string).to_vec(),
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
fn test_set_route_representative_persists_self_match_and_zero_match() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activity("a".into(), track(47.0), "Ride".into())
        .unwrap();
    engine
        .add_activity("b".into(), track(47.0), "Ride".into())
        .unwrap();
    engine
        .add_activity("c".into(), track(48.0), "Ride".into())
        .unwrap();
    engine.groups = vec![group()];
    engine.db.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_1', 'a', '[\"a\",\"b\",\"c\"]', 'Ride')",
        [],
    ).unwrap();
    engine.activity_matches.insert(
        "r_1".into(),
        ["a", "b", "c"]
            .map(|activity_id| ActivityMatchInfo {
                activity_id: activity_id.to_string(),
                match_percentage: 40.0,
                direction: Direction::Same,
            })
            .to_vec(),
    );
    for activity_id in ["a", "b", "c"] {
        engine.db.execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction) VALUES ('r_1', ?, 40.0, 'same')",
            [activity_id],
        ).unwrap();
    }

    engine.set_route_representative("r_1", "b").unwrap();
    let percentage = |activity_id: &str| {
        engine.db.query_row(
        "SELECT match_percentage FROM activity_matches WHERE route_id = 'r_1' AND activity_id = ?",
        [activity_id],
        |row| row.get::<_, f64>(0),
    ).unwrap()
    };
    assert_eq!(percentage("b"), 100.0);
    assert_eq!(percentage("c"), 0.0);
}

#[test]
fn test_set_route_representative_records_self_match_without_track() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let mut route = group();
    route.activity_ids = ["a", "b"].map(str::to_string).to_vec();
    engine.groups = vec![route];
    engine.db.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_1', 'a', '[\"a\",\"b\"]', 'Ride')",
        [],
    ).unwrap();
    engine.activity_matches.insert(
        "r_1".into(),
        vec![ActivityMatchInfo {
            activity_id: "b".into(),
            match_percentage: 40.0,
            direction: Direction::Same,
        }],
    );
    engine.db.execute(
        "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction) VALUES ('r_1', 'b', 40.0, 'same')",
        [],
    ).unwrap();

    engine.set_route_representative("r_1", "b").unwrap();
    let stored: f64 = engine.db.query_row(
        "SELECT match_percentage FROM activity_matches WHERE route_id = 'r_1' AND activity_id = 'b'",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(stored, 100.0);
}

fn corridor(reversed: bool) -> Vec<GpsPoint> {
    let mut points: Vec<GpsPoint> = (0..200)
        .map(|index| GpsPoint::new(47.0 + f64::from(index) * 0.0001, 7.0))
        .collect();
    if reversed {
        points.reverse();
    }
    points
}

fn stored_direction(engine: &PersistentEngine, activity_id: &str) -> String {
    engine
        .db
        .query_row(
            "SELECT direction FROM activity_matches WHERE route_id = 'r_1' AND activity_id = ?",
            [activity_id],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn test_measure_match_percentages_measures_direction_of_a_member_with_no_row() {
    let tracks: HashMap<&str, Vec<GpsPoint>> = HashMap::from([
        ("a", corridor(false)),
        ("b", corridor(false)),
        ("c", corridor(true)),
    ]);

    let measured = crate::persistence::routes::measure_match_percentages(
        &[group()],
        &HashMap::new(),
        &tracematch::MatchConfig::default(),
        |id| tracks.get(id).cloned(),
        None,
        None,
    );

    let direction = |activity_id: &str| {
        measured["r_1"]
            .iter()
            .find(|m| m.activity_id == activity_id)
            .unwrap()
            .direction
    };
    assert_eq!(direction("b"), Direction::Same);
    assert_eq!(direction("c"), Direction::Reverse);
}

#[test]
fn test_measure_match_percentages_replaces_a_stored_direction_with_the_measured_one() {
    let tracks: HashMap<&str, Vec<GpsPoint>> = HashMap::from([
        ("a", corridor(false)),
        ("b", corridor(false)),
        ("c", corridor(true)),
    ]);
    let seed = HashMap::from([(
        "r_1".to_string(),
        ["a", "b", "c"]
            .map(|activity_id| ActivityMatchInfo {
                activity_id: activity_id.to_string(),
                match_percentage: 0.0,
                direction: Direction::Same,
            })
            .to_vec(),
    )]);

    let measured = crate::persistence::routes::measure_match_percentages(
        &[group()],
        &seed,
        &tracematch::MatchConfig::default(),
        |id| tracks.get(id).cloned(),
        None,
        Some("c"),
    );

    let direction = |activity_id: &str| {
        measured["r_1"]
            .iter()
            .find(|m| m.activity_id == activity_id)
            .unwrap()
            .direction
    };
    assert_eq!(direction("a"), Direction::Reverse);
    assert_eq!(direction("b"), Direction::Reverse);
}

#[test]
fn test_set_route_representative_stores_the_measured_direction() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activity("a".into(), corridor(false), "Ride".into())
        .unwrap();
    engine
        .add_activity("b".into(), corridor(false), "Ride".into())
        .unwrap();
    engine
        .add_activity("c".into(), corridor(true), "Ride".into())
        .unwrap();
    engine.groups = vec![group()];
    engine.db.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type) VALUES ('r_1', 'a', '[\"a\",\"b\",\"c\"]', 'Ride')",
        [],
    ).unwrap();
    for activity_id in ["a", "b", "c"] {
        engine.db.execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction) VALUES ('r_1', ?, 0.0, 'same')",
            [activity_id],
        ).unwrap();
    }

    engine.set_route_representative("r_1", "c").unwrap();

    assert_eq!(stored_direction(&engine, "a"), "reverse");
    assert_eq!(stored_direction(&engine, "b"), "reverse");
    assert_eq!(stored_direction(&engine, "c"), "same");
}

fn offset_corridor(reversed: bool, metres_east: f64) -> Vec<GpsPoint> {
    let degrees = metres_east / (111_320.0 * 47.0_f64.to_radians().cos());
    corridor(reversed)
        .into_iter()
        .map(|p| GpsPoint::new(p.latitude, p.longitude + degrees))
        .collect()
}

fn measure_with_offset_member(reversed: bool, metres_east: f64) -> (f64, Direction) {
    let tracks: HashMap<&str, Vec<GpsPoint>> = HashMap::from([
        ("a", corridor(false)),
        ("b", corridor(false)),
        ("c", offset_corridor(reversed, metres_east)),
    ]);
    let measured = crate::persistence::routes::measure_match_percentages(
        &[group()],
        &HashMap::new(),
        &tracematch::MatchConfig::default(),
        |id| tracks.get(id).cloned(),
        None,
        None,
    );
    let member = measured["r_1"]
        .iter()
        .find(|m| m.activity_id == "c")
        .unwrap();
    (member.match_percentage, member.direction)
}

#[test]
fn test_measure_match_percentages_stores_a_member_under_the_partial_threshold_as_partial() {
    let (percentage, direction) = measure_with_offset_member(false, 49.0);
    assert!((55.0..70.0).contains(&percentage), "{percentage}");
    assert_eq!(direction, Direction::Partial);

    let (percentage, direction) = measure_with_offset_member(true, 49.0);
    assert!((55.0..70.0).contains(&percentage), "{percentage}");
    assert_eq!(direction, Direction::Partial);
}

#[test]
fn test_measure_match_percentages_keeps_the_endpoint_direction_above_the_partial_threshold() {
    let (percentage, direction) = measure_with_offset_member(true, 32.0);
    assert!(percentage >= 70.0, "{percentage}");
    assert_eq!(direction, Direction::Reverse);

    let (_, direction) = measure_with_offset_member(false, 32.0);
    assert_eq!(direction, Direction::Same);
}
