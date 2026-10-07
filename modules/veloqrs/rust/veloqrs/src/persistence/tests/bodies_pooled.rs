use tempfile::TempDir;

use super::*;

fn engine_and_reader() -> (TempDir, PersistentEngine, Connection) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bodies_pooled.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let reader = Connection::open(path).unwrap();
    (dir, engine, reader)
}

#[test]
fn test_pooled_interval_body_matches_engine_for_present_and_missing_rows() {
    let (_dir, engine, reader) = engine_and_reader();
    engine.set_interval_body("a1", "laps").unwrap();
    assert_eq!(
        pooled::interval_body(&reader, "a1").unwrap(),
        engine.get_interval_body("a1").unwrap()
    );
    assert_eq!(
        pooled::interval_body(&reader, "missing").unwrap(),
        engine.get_interval_body("missing").unwrap()
    );
}

#[test]
fn test_pooled_stream_body_matches_engine_for_cached_and_reconstructed_series() {
    let (_dir, engine, reader) = engine_and_reader();
    let body = r#"[{"type":"watts","data":[100.0,110.0]}]"#;
    engine.set_stream_body("a1", "watts", body).unwrap();
    let cached = pooled::stream_body(&reader, "a1", "watts").unwrap();
    assert_eq!(cached.0, engine.read_stream_body("a1", "watts").unwrap());
    assert!(!cached.1);

    engine
        .db
        .execute("DELETE FROM stream_bodies WHERE activity_id = 'a1'", [])
        .unwrap();
    let rebuilt = pooled::stream_body(&reader, "a1", "watts").unwrap();
    assert_eq!(rebuilt.0, engine.read_stream_body("a1", "watts").unwrap());
    assert!(!rebuilt.1);
    assert!(rebuilt.0.is_some());
    assert_eq!(
        pooled::stream_body(&reader, "missing", "watts").unwrap().0,
        None
    );
}
