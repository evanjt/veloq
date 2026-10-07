use rusqlite::params;

use super::{PersistentEngine, load_groups_from_db};

fn insert_group(engine: &PersistentEngine, id: &str, json: &str, blob: Option<&[u8]>) {
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                activity_ids_blob) VALUES (?1, 'activity', ?2, 'Ride', ?3)",
            params![id, json, blob],
        )
        .unwrap();
}

#[test]
fn test_group_loaders_skip_malformed_json_consistently() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.load_groups().unwrap();
    assert!(engine.groups.is_empty());
    assert!(load_groups_from_db(&engine.db).is_empty());
    insert_group(&engine, "valid", "[\"activity\"]", None);
    insert_group(&engine, "broken", "not json", None);

    engine.load_groups().unwrap();
    let loaded: Vec<_> = engine
        .groups
        .iter()
        .map(|group| group.group_id.as_str())
        .collect();
    let worker: Vec<_> = load_groups_from_db(&engine.db)
        .iter()
        .map(|group| group.group_id.clone())
        .collect();

    assert_eq!(loaded, ["valid"]);
    assert_eq!(worker, ["valid"]);

    engine.load_groups().unwrap();
    assert_eq!(engine.groups.len(), 1);
    assert_eq!(load_groups_from_db(&engine.db).len(), 1);
}

#[test]
fn test_group_loaders_skip_corrupt_activity_blob() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    insert_group(&engine, "valid", "[\"activity\"]", None);
    insert_group(&engine, "broken", "[\"activity\"]", Some(&[0x01, 0x02]));

    engine.load_groups().unwrap();
    let loaded: Vec<_> = engine
        .groups
        .iter()
        .map(|group| group.group_id.as_str())
        .collect();
    let worker: Vec<_> = load_groups_from_db(&engine.db)
        .iter()
        .map(|group| group.group_id.clone())
        .collect();

    assert_eq!(loaded, ["valid"]);
    assert_eq!(worker, ["valid"]);
}

#[test]
fn test_group_membership_read_prefers_valid_blob() {
    let engine = PersistentEngine::in_memory().unwrap();
    let members = vec!["activity".to_string()];
    let blob = super::codec::serialize(&members).unwrap();
    insert_group(&engine, "valid", "broken json", Some(&blob));

    assert_eq!(
        crate::persistence::routes::pooled::group_by_id(&engine.db, "valid")
            .map(|group| group.activity_ids),
        Some(members)
    );
}
