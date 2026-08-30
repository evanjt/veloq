//! Scenario: the cached section geometry is cleared, the way a "clear cache"
//! must be free to clear it, and the catalogue is read again.
//! Expected behaviour: a section whose provenance is `exact` rebuilds its line
//! from the stored triple against the stored stream, so clearing the blob
//! costs nothing. A section with no triple has nothing to rebuild from and
//! loads empty rather than taking the rest of the catalogue down with it.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use tracematch::{GpsPoint, SectionConfig};
use veloqrs::PersistentEngine;

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 40,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn detected() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("droppable.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_section_config(SectionConfig {
        ..Default::default()
    });

    for activity in corpus() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }

    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");

    (dir, engine)
}

fn exact_ids(db: &Connection) -> Vec<String> {
    let mut stmt = db
        .prepare(
            "SELECT id FROM sections
             WHERE geometry_source = 'exact' AND disabled = 0
             ORDER BY id",
        )
        .expect("prepare");
    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect("query")
        .collect::<Result<Vec<_>, _>>()
        .expect("rows")
}

/// Everything a "clear cache" is allowed to drop from the sections table.
fn clear_geometry_cache(db: &Connection) {
    db.execute(
        "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL",
        [],
    )
    .expect("clear the cached geometry");
}

/// Every section the routes bundle renders, as (id, encoded polyline).
fn bundle_lines(engine: &mut PersistentEngine) -> Vec<(String, Vec<u8>)> {
    let mut lines: Vec<(String, Vec<u8>)> = engine
        .get_routes_screen_data(0, 0, 500, 0, 1, false, false, f64::NAN, f64::NAN)
        .sections
        .into_iter()
        .map(|s| (s.id, s.encoded_polyline))
        .collect();
    lines.sort();
    lines
}

fn same_points(a: &[GpsPoint], b: &[GpsPoint]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(x, y)| {
            x.latitude == y.latitude && x.longitude == y.longitude && x.elevation == y.elevation
        })
}

fn lines_of(engine: &mut PersistentEngine, ids: &[String]) -> Vec<Vec<GpsPoint>> {
    ids.iter()
        .map(|id| {
            engine
                .get_section_by_id(id)
                .unwrap_or_else(|| panic!("section {id} is readable"))
                .polyline
        })
        .collect()
}

#[test]
fn clearing_the_blob_does_not_lose_an_exact_line() {
    let (dir, mut engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    assert!(
        !ids.is_empty(),
        "no exact section was detected, so this test would pass vacuously"
    );
    let before = lines_of(&mut engine, &ids);
    assert!(
        before.iter().all(|line| line.len() > 1),
        "the lines under test must be real geometry before the clear"
    );
    drop(engine);

    clear_geometry_cache(&db);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after the clear");
    let after = lines_of(&mut engine, &ids);
    for ((id, want), got) in ids.iter().zip(&before).zip(&after) {
        assert!(
            same_points(want, got),
            "section {id} lost its line when the blob was cleared: {} points became {}",
            want.len(),
            got.len()
        );
    }
}

/// The in-memory catalogue is rebuilt by `load`, not by the per-id read, so it
/// has to rebuild from the triple too.
#[test]
fn the_loaded_catalogue_rebuilds_its_lines_too() {
    let (dir, mut engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    assert!(!ids.is_empty(), "no exact section to rebuild");
    let before = lines_of(&mut engine, &ids);
    drop(engine);

    clear_geometry_cache(&db);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after the clear");
    let loaded = engine.get_sections();
    for (id, want) in ids.iter().zip(&before) {
        let got = loaded
            .iter()
            .find(|s| &s.id == id)
            .unwrap_or_else(|| panic!("section {id} is in the loaded catalogue"));
        assert!(
            same_points(want, &got.polyline),
            "section {id} loaded with {} points instead of {}",
            got.polyline.len(),
            want.len()
        );
    }
}

/// The flat read the UI uses goes through the same rebuild.
#[test]
fn the_flat_polyline_read_rebuilds_as_well() {
    let (dir, engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    assert!(!ids.is_empty(), "no exact section to rebuild");
    let want: Vec<usize> = ids
        .iter()
        .map(|id| engine.get_section_polyline(id).len())
        .collect();
    drop(engine);

    clear_geometry_cache(&db);

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    for (id, n) in ids.iter().zip(&want) {
        assert_eq!(
            engine.get_section_polyline(id).len(),
            *n,
            "flat read of section {id} did not rebuild"
        );
    }
}

/// A cleared blob with no stream behind it is a section with no line, not a
/// panic and not a load that takes the catalogue with it.
#[test]
fn a_rebuild_with_no_stream_left_degrades_to_an_empty_line() {
    let (dir, mut engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    assert!(ids.len() > 1, "need more than one exact section");
    let orphan = ids[0].clone();
    let representative: String = db
        .query_row(
            "SELECT representative_activity_id FROM sections WHERE id = ?",
            rusqlite::params![orphan],
            |row| row.get(0),
        )
        .expect("the orphan names its activity");
    let survivors: Vec<String> = ids
        .iter()
        .filter(|id| **id != orphan)
        .filter(|id| {
            let rep: Option<String> = db
                .query_row(
                    "SELECT representative_activity_id FROM sections WHERE id = ?",
                    rusqlite::params![id],
                    |row| row.get(0),
                )
                .ok();
            rep.as_deref() != Some(representative.as_str())
        })
        .cloned()
        .collect();
    assert!(
        !survivors.is_empty(),
        "every exact section shares one representative, so nothing would prove the load survived"
    );
    let before = lines_of(&mut engine, &survivors);
    drop(engine);

    clear_geometry_cache(&db);
    db.execute(
        "DELETE FROM gps_tracks WHERE activity_id = ?",
        rusqlite::params![representative],
    )
    .expect("drop the stream the orphan needs");

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine
        .load()
        .expect("load must survive an unrebuildable row");
    let gone = engine
        .get_section_by_id(&orphan)
        .expect("the row still reads");
    assert!(
        gone.polyline.is_empty(),
        "a section with no stream must load empty, got {} points",
        gone.polyline.len()
    );
    for (id, want) in survivors.iter().zip(&before) {
        let got = engine
            .get_section_by_id(id)
            .unwrap_or_else(|| panic!("section {id} still reads"));
        assert!(
            same_points(want, &got.polyline),
            "an unrebuildable neighbour cost section {id} its line"
        );
    }
}

/// A range that no longer indexes its stream is refused, not clamped into a
/// different line that would read as real geometry.
#[test]
fn a_range_past_the_end_of_the_stream_is_refused() {
    let (dir, engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    let target = ids.first().expect("an exact section").clone();
    drop(engine);

    clear_geometry_cache(&db);
    db.execute(
        "UPDATE sections SET rep_start_index = 10000000, rep_end_index = 10000005
         WHERE id = ?",
        rusqlite::params![target],
    )
    .expect("push the range past the stream");

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    let section = engine
        .get_section_by_id(&target)
        .expect("the row still reads");
    assert!(
        section.polyline.is_empty(),
        "an out-of-range triple must not produce a line, got {} points",
        section.polyline.len()
    );
}

/// The map reads sections as encoded polylines, in bulk, through the routes
/// bundle. A rebuild that only reached the per-id path would leave the map
/// blank while every single-section read looked right.
#[test]
fn the_routes_bundle_rebuilds_its_encoded_lines() {
    let (dir, mut engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");
    assert!(!exact_ids(&db).is_empty(), "no exact section to rebuild");

    let before = bundle_lines(&mut engine);
    assert!(
        before.iter().any(|(_, encoded)| !encoded.is_empty()),
        "the bundle carried no geometry before the clear"
    );
    drop(engine);

    clear_geometry_cache(&db);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after the clear");
    assert_eq!(
        bundle_lines(&mut engine),
        before,
        "the routes bundle lost geometry when the blob was cleared"
    );
}

/// Nearby summaries render their own polylines and read the row directly.
#[test]
fn nearby_summaries_rebuild_after_the_clear() {
    let (dir, engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    let anchor = ids.first().expect("an exact section").clone();
    let before: Vec<(String, Vec<u8>)> = engine
        .get_nearby_sections(&anchor, 50_000.0)
        .into_iter()
        .map(|s| (s.id, s.encoded_polyline))
        .collect();
    assert!(
        before.iter().any(|(_, encoded)| !encoded.is_empty()),
        "no nearby section carried geometry before the clear"
    );
    drop(engine);

    clear_geometry_cache(&db);

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    let after: Vec<(String, Vec<u8>)> = engine
        .get_nearby_sections(&anchor, 50_000.0)
        .into_iter()
        .map(|s| (s.id, s.encoded_polyline))
        .collect();
    assert_eq!(after, before, "nearby summaries lost their geometry");
}

/// A refresh rewrites one section in the loaded catalogue from its row. Its
/// geometry decode is a hard gate: a line it cannot read makes it return
/// before it applies anything else, so a cleared cache would quietly cost the
/// section every other field the refresh carries.
#[test]
fn a_refresh_after_the_clear_still_applies_the_row() {
    let (dir, mut engine) = detected();
    let path = dir.path().join("droppable.db");
    let db = Connection::open(&path).expect("open");

    let ids = exact_ids(&db);
    let target = ids.first().expect("an exact section").clone();
    let before = lines_of(&mut engine, std::slice::from_ref(&target)).remove(0);
    drop(engine);

    clear_geometry_cache(&db);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after the clear");
    db.execute(
        "UPDATE sections SET name = 'renamed after the clear' WHERE id = ?",
        rusqlite::params![target],
    )
    .expect("rename the row behind the loaded catalogue");
    engine.refresh_section_in_memory(&target);
    let refreshed = engine
        .get_sections()
        .iter()
        .find(|s| s.id == target)
        .cloned()
        .expect("the refreshed section is in memory");
    assert_eq!(
        refreshed.name.as_deref(),
        Some("renamed after the clear"),
        "the refresh gave up before it applied the row"
    );
    assert!(
        same_points(&before, &refreshed.polyline),
        "a refresh blanked section {target}: {} points became {}",
        before.len(),
        refreshed.polyline.len()
    );
}
