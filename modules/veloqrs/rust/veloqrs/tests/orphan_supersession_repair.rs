use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

fn create(engine: &mut PersistentEngine, name: &str) -> String {
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: (0..20)
                .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.0005, 7.35))
                .collect(),
            distance_meters: 1_100.0,
            name: Some(name.into()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create section")
}

#[test]
fn reopening_clears_only_supersession_without_an_owner() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("sections.db");
    let path = db_path.to_str().expect("utf8");
    let mut engine = PersistentEngine::new(path).expect("open");
    let orphaned = create(&mut engine, "Orphaned");
    let retained = create(&mut engine, "Retained");
    let owner = create(&mut engine, "Owner");
    drop(engine);

    let conn = Connection::open(path).expect("reopen sqlite");
    conn.execute(
        "UPDATE sections SET superseded_by = 'deleted_custom' WHERE id = ?",
        [&orphaned],
    )
    .expect("orphan link");
    conn.execute(
        "UPDATE sections SET superseded_by = ? WHERE id = ?",
        [&owner, &retained],
    )
    .expect("valid link");
    conn.execute(
        "DELETE FROM schema_info WHERE key = 'orphan_superseded_repair_done'",
        [],
    )
    .expect("pre-repair file");
    drop(conn);

    drop(PersistentEngine::new(path).expect("reopen engine"));
    let conn = Connection::open(path).expect("read sqlite");
    let orphan_link: Option<String> = conn
        .query_row(
            "SELECT superseded_by FROM sections WHERE id = ?",
            [&orphaned],
            |row| row.get(0),
        )
        .expect("orphan row");
    let retained_link: Option<String> = conn
        .query_row(
            "SELECT superseded_by FROM sections WHERE id = ?",
            [&retained],
            |row| row.get(0),
        )
        .expect("retained row");
    assert_eq!(orphan_link, None);
    assert_eq!(retained_link.as_deref(), Some(owner.as_str()));
}
