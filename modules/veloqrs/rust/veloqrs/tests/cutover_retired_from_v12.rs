//! The real cutover over a database a released 0.3.8 build wrote.
//!
//! Scenario: an athlete upgrades with a catalogue of auto sections and the
//! cutover re-cuts it. Expected behaviour: every auto section the cutover took
//! out of the catalogue is on the retired list with a version to roll back to
//! and a name or length, restoring one makes it a live pinned user-defined
//! section, and a section the athlete pinned or hid in 0.3.8 is not touched.

use rusqlite::Connection;
use std::collections::BTreeSet;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

const FIXTURE: &str = include_str!("fixtures/v12_demo.sql");

/// Two sections the athlete had taken hold of in 0.3.8: one made their own,
/// one hidden. The fixture itself holds neither.
const OWNED: &str = "sec_ride_28";
const HIDDEN: &str = "sec_ride_19";

fn ids(conn: &Connection, sql: &str) -> BTreeSet<String> {
    let mut stmt = conn.prepare(sql).expect(sql);
    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect(sql)
        .collect::<Result<_, _>>()
        .expect(sql)
}

fn seed(path: &Path) -> BTreeSet<String> {
    let conn = Connection::open(path).expect("open fixture database");
    conn.execute_batch(FIXTURE).expect("replay fixture");
    conn.execute(
        "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
        [OWNED],
    )
    .expect("own a section");
    conn.execute("UPDATE sections SET disabled = 1 WHERE id = ?", [HIDDEN])
        .expect("hide a section");
    ids(
        &conn,
        "SELECT id FROM sections WHERE is_user_defined = 0 AND disabled = 0",
    )
}

/// Opens the library, which starts the owed cutover on its own thread, and
/// waits for it to settle.
fn cut_over(path: &Path) {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    loop {
        let settled = !veloqrs::persistence::cutover::cutover_running()
            && !veloqrs::ffi::is_cutover_pending();
        if settled {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the cutover did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[test]
fn every_wiped_auto_section_of_a_released_library_is_retired_and_restorable() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let auto_before = seed(&path);
    assert!(!auto_before.is_empty());

    cut_over(&path);

    let db = Connection::open(&path).expect("open");
    let live = ids(&db, "SELECT id FROM sections");
    let retired = with_persistent_engine(|e| e.retired_sections()).unwrap();
    let retired_ids: BTreeSet<String> = retired.iter().map(|r| r.section_id.clone()).collect();

    // The sections the athlete took hold of are untouched.
    assert!(live.contains(OWNED), "the owned section left the catalogue");
    assert!(
        live.contains(HIDDEN),
        "the hidden section left the catalogue"
    );
    assert!(!retired_ids.contains(OWNED) && !retired_ids.contains(HIDDEN));

    assert!(
        !retired_ids.is_empty(),
        "the cutover retired nothing, so the checks below prove nothing"
    );
    let lost: Vec<&String> = auto_before
        .iter()
        .filter(|id| !live.contains(*id) && !retired_ids.contains(*id))
        .collect();
    assert!(
        lost.is_empty(),
        "wiped sections on no list: {lost:?} ({} of {})",
        lost.len(),
        auto_before.len()
    );
    for r in &retired {
        assert!(!r.versions.is_empty(), "{} has no version", r.section_id);
        assert!(
            r.name.is_some() || r.distance_meters.is_some(),
            "{} names nothing",
            r.section_id
        );
    }

    // Restoring each one makes it live, pinned and user-defined.
    for r in &retired {
        let version = r.versions.last().unwrap().0;
        with_persistent_engine(|e| e.revert_section_to_version(&r.section_id, version))
            .unwrap()
            .unwrap_or_else(|err| panic!("restore {}: {err}", r.section_id));
    }
    let db = Connection::open(&path).expect("open");
    for id in &retired_ids {
        let user_defined: i64 = db
            .query_row(
                "SELECT is_user_defined FROM sections WHERE id = ?",
                [id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| panic!("{id} is not live after restore"));
        assert_eq!(user_defined, 1, "{id} is not user-defined");
        let pinned = with_persistent_engine(|e| e.pinned_section_version(id)).unwrap();
        assert!(pinned.is_some(), "{id} is not pinned");
    }
    // A second detect keeps what the athlete brought back.
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, _) = main.expect("detect");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply");
    })
    .unwrap();
    let live_after = ids(&db, "SELECT id FROM sections");
    let dropped: Vec<&String> = retired_ids.difference(&live_after).collect();
    assert!(dropped.is_empty(), "a detect dropped restored {dropped:?}");
    let still_retired = with_persistent_engine(|e| e.retired_sections()).unwrap();
    assert!(still_retired.is_empty(), "{still_retired:?}");
}
