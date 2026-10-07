use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};

#[test]
fn test_name_sort_uses_displayed_section_name_case_insensitively() {
    let _guard = serial_global_state();
    let _temp = init_global_engine("section_sort.db");
    crate::persistence::with_persistent_engine(|engine| {
        for (id, name) in [("s_1", "Zulu"), ("s_2", "alpha"), ("s_3", "Bravo")] {
            engine.db.execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json, distance_meters, is_user_defined) VALUES (?, 'custom', ?, 'Ride', '[]', 100, 1)",
                [id, name],
            ).unwrap();
        }
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters, is_user_defined) VALUES ('s_0', 'custom', 'Ride', '[]', 100, 1)",
            [],
        ).unwrap();
    }).unwrap();

    let summaries = SectionManager::new()
        .get_summaries(crate::FfiSectionFilter::default(), Some("name".into()))
        .unwrap();
    let ids: Vec<_> = summaries
        .summaries
        .iter()
        .map(|section| section.id.as_str())
        .collect();
    assert_eq!(ids, ["s_2", "s_3", "s_0", "s_1"]);
}
