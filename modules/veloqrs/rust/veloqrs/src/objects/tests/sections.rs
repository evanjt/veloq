use super::*;
use crate::test_globals::{seeded_global_engine, serial_global_state};

#[test]
fn test_get_sections_empty_filter_preserves_stored_custom_fields() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .unwrap();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
                 VALUES ('r1', 'a0', 100.0, 'same', 0)",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                     activity_count) VALUES ('r1', 'a0', '[]', 'Ride', 2)",
                [],
            )
            .unwrap();
    })
    .expect("engine");

    let filter = crate::FfiSectionFilter {
        sport_type: None,
        min_visits: None,
        section_type: None,
        activity_id: None,
    };
    let unfiltered = sections
        .get_sections(filter.clone())
        .unwrap()
        .into_iter()
        .find(|section| section.id == id)
        .expect("custom section in unfiltered list");
    let by_type = sections
        .get_sections(crate::FfiSectionFilter {
            section_type: Some("custom".into()),
            ..filter
        })
        .unwrap()
        .into_iter()
        .find(|section| section.id == id)
        .expect("custom section in type-filtered list");

    assert_eq!(unfiltered.section_type, "custom");
    assert_eq!(unfiltered.section_type, by_type.section_type);
    assert_eq!(unfiltered.source_activity_id.as_deref(), Some("a0"));
    assert_eq!(unfiltered.source_activity_id, by_type.source_activity_id);
    assert_eq!(
        (unfiltered.start_index, unfiltered.end_index),
        (Some(0), Some(7))
    );
    assert_eq!(unfiltered.start_index, by_type.start_index);
    assert_eq!(unfiltered.end_index, by_type.end_index);
    assert_eq!(unfiltered.route_ids, Some(vec!["r1".into()]));
    assert_eq!(unfiltered.route_ids, by_type.route_ids);
}

#[test]
fn test_get_sections_empty_filter_skips_unreadable_stored_custom_row() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "UPDATE sections SET point_density_blob = x'ff' WHERE id = ?1",
                [&id],
            )
            .expect("corrupt stored density");
    })
    .expect("engine");

    let filter = crate::FfiSectionFilter {
        sport_type: None,
        min_visits: None,
        section_type: None,
        activity_id: None,
    };
    for _ in 0..2 {
        let listed = sections.get_sections(filter.clone()).expect("section list");
        assert!(
            listed.iter().all(|section| section.id != id),
            "an unreadable stored row cannot become a visible auto section"
        );
    }
}

#[test]
fn test_get_sections_empty_filter_ignores_unstored_catalogue_entry() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .db
            .execute("DELETE FROM sections WHERE id = ?1", [&id])
            .expect("remove stored row while catalogue remains");
        assert!(
            engine.get_sections().iter().any(|section| section.id == id),
            "the in-memory catalogue still holds the entry"
        );
    })
    .expect("engine");

    let listed = sections
        .get_sections(crate::FfiSectionFilter {
            sport_type: None,
            min_visits: None,
            section_type: None,
            activity_id: None,
        })
        .expect("section list");
    assert!(
        listed.iter().all(|section| section.id != id),
        "the pooled list only shows stored catalogue entries"
    );
}
