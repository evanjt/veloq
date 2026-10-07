use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::FfiSectionFilter;
use veloqrs::objects::sections::SectionManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

fn ids(filter: FfiSectionFilter) -> Vec<String> {
    let mut ids: Vec<String> = SectionManager::new()
        .get_sections(filter)
        .expect("sections")
        .into_iter()
        .map(|s| s.id)
        .collect();
    ids.sort();
    ids
}

#[test]
fn combined_filters_use_outings_sport_membership_and_pins() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("filters.db");
    let path_string = path.to_str().unwrap().to_string();
    drop(veloqrs::PersistentEngine::new(&path_string).expect("schema"));
    let db = Connection::open(&path).expect("database");
    let line = "[{\"latitude\":46.0,\"longitude\":7.0},{\"latitude\":46.01,\"longitude\":7.01}]";

    for id in ["lapped", "pinned", "shared"] {
        db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, created_at, version)
             VALUES (?1, 'auto', ?1, 'Ride', ?2, 1000, '2026-01-01', 1)",
            params![id, line],
        )
        .expect("section");
    }
    for (id, sport) in [("ride", "Ride"), ("run", "Run")] {
        db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1)",
            params![id, sport],
        )
        .expect("activity");
    }
    for start in [0, 10, 20] {
        db.execute(
            "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
             VALUES ('lapped', 'ride', ?1, ?2)",
            params![start, start + 5],
        )
        .expect("lap");
    }
    for id in ["ride", "run"] {
        db.execute(
            "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
             VALUES ('shared', ?1, 0, 5)",
            [id],
        )
        .expect("shared outing");
    }
    db.execute(
        "INSERT INTO section_pins (section_id, version) VALUES ('pinned', 1)",
        [],
    )
    .expect("pin");
    drop(db);

    assert!(persistent_engine_init(path_string));
    with_persistent_engine(|engine| engine.load().expect("load catalogue")).expect("engine");

    let floor = FfiSectionFilter {
        min_visits: Some(2),
        ..Default::default()
    };
    let narrowed = FfiSectionFilter {
        section_type: Some("auto".into()),
        ..floor.clone()
    };
    assert_eq!(ids(floor), ["pinned", "shared"]);
    assert_eq!(ids(narrowed), ["pinned", "shared"]);
    assert_eq!(
        ids(FfiSectionFilter {
            activity_id: Some("ride".into()),
            min_visits: Some(2),
            ..Default::default()
        }),
        ["shared"]
    );
    assert_eq!(
        ids(FfiSectionFilter {
            sport_type: Some("Run".into()),
            section_type: Some("auto".into()),
            min_visits: Some(1),
            ..Default::default()
        }),
        ["shared"]
    );
}
