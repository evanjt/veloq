use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

fn filter() -> crate::FfiSectionFilter {
    crate::FfiSectionFilter {
        sport_type: None,
        min_visits: None,
        section_type: None,
        activity_id: None,
    }
}

#[test]
fn test_get_sections_unfiltered_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("all_sections_under_writer.db");
    let sections = SectionManager::new();
    assert!(read_while_writer_holds(|| sections.get_sections(filter()).unwrap()).is_empty());
}

#[test]
fn test_get_by_id_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_by_id_under_writer.db");
    let sections = SectionManager::new();
    assert!(read_while_writer_holds(|| sections.get_by_id("absent".into()).unwrap()).is_none());
}

#[test]
fn test_get_count_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_count_under_writer.db");
    let sections = SectionManager::new();
    assert_eq!(read_while_writer_holds(|| sections.get_count().unwrap()), 0);
}

#[test]
fn test_get_summaries_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_summaries_under_writer.db");
    let sections = SectionManager::new();
    let result = read_while_writer_holds(|| sections.get_summaries(filter(), None).unwrap());
    assert_eq!(result.total_count, 0);
}

#[test]
fn test_pooled_section_reads_match_catalogue_pin_and_identity() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), Some("Climb".into()), "a0".into(), 0, 7)
        .unwrap();
    crate::with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO section_pins (section_id, version) VALUES (?1, 1)",
            [&id],
        )
        .unwrap();
    })
    .unwrap();

    let old = crate::with_persistent_engine(|e| {
        let section = e.get_section(&id).unwrap();
        let portions = e.get_section_portions(&id);
        (
            crate::FfiSection::from(section).with_portions(portions),
            e.get_section_count(),
            e.get_section_summaries(),
        )
    })
    .unwrap();
    let by_id = sections.get_by_id(id.clone()).unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(&by_id).unwrap(),
        serde_json::to_value(&old.0).unwrap()
    );
    assert_eq!(
        serde_json::to_value(sections.get_by_id(id.clone()).unwrap()).unwrap(),
        serde_json::to_value(Some(by_id)).unwrap()
    );
    let filtered = crate::FfiSectionFilter {
        sport_type: Some("Ride".into()),
        min_visits: Some(99),
        ..filter()
    };
    let listed = sections.get_sections(filtered).unwrap();
    assert_eq!(
        serde_json::to_value(listed).unwrap(),
        serde_json::to_value(vec![&old.0]).unwrap()
    );
    let other_sport = crate::FfiSectionFilter {
        sport_type: Some("Run".into()),
        min_visits: Some(99),
        ..filter()
    };
    assert!(sections.get_sections(other_sport).unwrap().is_empty());
    assert_eq!(sections.get_count().unwrap(), old.1);
    let summaries = sections.get_summaries(filter(), None).unwrap();
    assert_eq!(
        serde_json::to_value(summaries.summaries).unwrap(),
        serde_json::to_value(old.2).unwrap()
    );
    let query = crate::FfiRoutesScreenQuery::default();
    let old_screen =
        crate::with_persistent_engine(|e| e.get_routes_screen_data(query.clone())).unwrap();
    let pooled_screen =
        with_reader(|conn| crate::persistence::pooled_routes_screen_data(conn, query)).unwrap();
    assert_eq!(pooled_screen.section_count, old_screen.section_count);
    assert_eq!(
        pooled_screen.filtered_section_count,
        old_screen.filtered_section_count
    );
    assert_eq!(pooled_screen.custom_count, old_screen.custom_count);
    assert_eq!(pooled_screen.sections[0].id, old_screen.sections[0].id);
    assert_eq!(
        pooled_screen.sections[0].encoded_polyline,
        old_screen.sections[0].encoded_polyline
    );
    crate::with_persistent_engine(|e| {
        e.db.execute("DELETE FROM section_pins WHERE section_id = ?", [&id])
            .unwrap();
    })
    .unwrap();
    let filtered = crate::FfiSectionFilter {
        sport_type: Some("Ride".into()),
        min_visits: Some(99),
        ..filter()
    };
    assert!(sections.get_sections(filtered).unwrap().is_empty());
    sections.set_name(id.clone(), "New climb".into()).unwrap();
    assert_eq!(
        sections.get_by_id(id).unwrap().unwrap().name.as_deref(),
        Some("New climb")
    );
}

#[test]
fn test_get_summaries_pooled_keeps_sports_without_metrics() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), Some("Climb".into()), "a0".into(), 0, 7)
        .unwrap();
    crate::with_persistent_engine(|engine| {
        engine.db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES ('run', 'Run', 46.2, 46.2, 7.35, 7.35)", [],
        ).unwrap();
        engine.db.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters)
             VALUES (?1, 'run', 'same', 0, 1, 100)", [&id],
        ).unwrap();
        assert_eq!(engine.db.query_row(
            "SELECT COUNT(*) FROM activity_metrics WHERE activity_id = 'run'", [],
            |row| row.get::<_, u32>(0),
        ).unwrap(), 0);
    }).unwrap();
    let locked = crate::with_persistent_engine(|engine| engine.get_section_summaries()).unwrap();
    assert_eq!(locked[0].sport_types, vec!["Ride", "Run"]);
    let pooled = sections.get_summaries(filter(), None).unwrap();
    assert_eq!(
        serde_json::to_value(pooled.summaries).unwrap(),
        serde_json::to_value(locked).unwrap()
    );
}

/// Scenario: a ride section one run also crossed, so it has two outings and
/// one of them is a ride. Then the same section pinned, with a floor it could
/// never reach on its own.
///
/// Expected behaviour: the summaries and the map floor on the filtered sport's
/// outings and let a pin through, the rule `get_sections` keeps.
#[test]
fn test_summaries_and_map_floor_on_sport_outings_and_pins() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), Some("Climb".into()), "a0".into(), 0, 7)
        .unwrap();
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('run', 'Run', 46.2, 46.2, 7.35, 7.35)",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters)
                 VALUES (?1, 'run', 'same', 0, 1, 100)",
                [&id],
            )
            .unwrap();
    })
    .unwrap();
    let summary_ids = |sport: Option<&str>, min_visits: u32| -> Vec<String> {
        let filter = crate::FfiSectionFilter {
            sport_type: sport.map(str::to_string),
            min_visits: Some(min_visits),
            ..filter()
        };
        sections
            .get_summaries(filter, None)
            .unwrap()
            .summaries
            .into_iter()
            .map(|s| s.id)
            .collect()
    };
    let map_ids = |sport: Option<&str>, min_visits: u32| -> Vec<String> {
        crate::with_persistent_engine(|engine| {
            engine
                .get_map_sections(sport, Some(min_visits))
                .into_iter()
                .map(|s| s.id)
                .collect()
        })
        .unwrap()
    };

    assert_eq!(summary_ids(None, 2), vec![id.clone()]);
    assert_eq!(map_ids(None, 2), vec![id.clone()]);
    assert!(summary_ids(Some("Ride"), 2).is_empty());
    assert!(map_ids(Some("Ride"), 2).is_empty());
    assert_eq!(summary_ids(Some("Ride"), 1), vec![id.clone()]);
    assert_eq!(map_ids(Some("Ride"), 1), vec![id.clone()]);

    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES (?1, 1)",
                [&id],
            )
            .unwrap();
    })
    .unwrap();

    assert_eq!(summary_ids(None, 99), vec![id.clone()]);
    assert_eq!(map_ids(None, 99), vec![id.clone()]);
    assert_eq!(summary_ids(Some("Ride"), 99), vec![id.clone()]);
    assert_eq!(map_ids(Some("Ride"), 99), vec![id.clone()]);
    assert!(summary_ids(Some("Hike"), 99).is_empty());
}
