use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

#[test]
fn filtered_summaries_keep_sports_before_activity_metrics_load() {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("sports.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let db = Connection::open(&path).expect("database");

    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, created_at)
         VALUES ('shared', 'auto', 'Shared hill', 'Ride', '[]', 500, '2026-01-01')",
        [],
    )
    .expect("section");
    for (id, sport) in [("ride", "Ride"), ("run", "Run")] {
        db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1)",
            params![id, sport],
        )
        .expect("activity");
        db.execute(
            "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
             VALUES ('shared', ?1, 0, 10)",
            [id],
        )
        .expect("junction");
    }

    let canonical = engine
        .get_section_summaries()
        .into_iter()
        .find(|s| s.id == "shared")
        .expect("canonical summary");
    let filtered = engine
        .get_section_summaries_by_type(None)
        .into_iter()
        .find(|s| s.id == "shared")
        .expect("filtered summary");

    assert_eq!(canonical.sport_types, ["Ride", "Run"]);
    assert_eq!(filtered.sport_types, canonical.sport_types);
    assert_eq!(filtered.activity_count, canonical.activity_count);
    assert_eq!(filtered.visit_count, canonical.visit_count);
}
