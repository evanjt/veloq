//! Scenario: activities are measured in start order, each against the z17
//! tiles every earlier one touched.
//!
//! Expected behaviour: the first activity in an empty library is entirely new
//! ground, an exact repeat is none, a partial overlap lands between, a track
//! that cannot be read adds no ground, and only the two measured states earn
//! a badge.

use super::*;
use crate::persistence::PersistentEngine;
use crate::tiles::{lat_to_tile_y, lon_to_tile_x, tile_x_to_lon, tile_y_to_lat};

const ROW: u32 = 52_000;
const FIRST_COLUMN: u32 = 68_000;

/// One point at the middle of each of `count` neighbouring tiles of a row,
/// starting `from` tiles along from a fixed column.
fn row_of_tiles(from: u32, count: u32) -> Vec<GpsPoint> {
    let lat = tile_y_to_lat(f64::from(ROW) + 0.5, GROUND_ZOOM);
    (from..from + count)
        .map(|column| {
            let lon = tile_x_to_lon(f64::from(FIRST_COLUMN + column) + 0.5, GROUND_ZOOM);
            GpsPoint::new(lat, lon)
        })
        .collect()
}

fn novelty(tiles: u32, new_tiles: u32) -> Novelty {
    Novelty { tiles, new_tiles }
}

#[test]
fn the_first_activity_in_an_empty_library_is_entirely_new() {
    let mut covered = Covered::default();
    let measured = covered.measure(Some(&row_of_tiles(0, 10))).unwrap();

    assert_eq!(measured, novelty(10, 10));
    assert_eq!(measured.fraction(), Some(1.0));
    assert_eq!(
        measured.badge(),
        Some(crate::FfiNewGroundBadge::EntirelyNew)
    );
}

#[test]
fn an_exact_repeat_has_no_new_ground() {
    let mut covered = Covered::default();
    covered.measure(Some(&row_of_tiles(0, 10)));
    let repeat = covered.measure(Some(&row_of_tiles(0, 10))).unwrap();

    assert_eq!(repeat, novelty(10, 0));
    assert_eq!(repeat.fraction(), Some(0.0));
    assert_eq!(repeat.badge(), None);
}

#[test]
fn a_partial_overlap_is_the_share_not_yet_covered() {
    let mut covered = Covered::default();
    covered.measure(Some(&row_of_tiles(0, 10)));
    let outing = covered.measure(Some(&row_of_tiles(6, 10))).unwrap();

    assert_eq!(outing, novelty(10, 6));
    assert_eq!(outing.badge(), Some(crate::FfiNewGroundBadge::MostlyNew));
}

#[test]
fn ground_counts_once_for_the_activity_that_reached_it_first() {
    let mut covered = Covered::default();
    covered.measure(Some(&row_of_tiles(0, 4)));
    covered.measure(Some(&row_of_tiles(2, 4)));
    let third = covered.measure(Some(&row_of_tiles(0, 6))).unwrap();

    assert_eq!(third, novelty(6, 0));
}

#[test]
fn a_segment_counts_the_tiles_it_crosses() {
    let mut covered = Covered::default();
    let ends = vec![row_of_tiles(0, 1)[0], row_of_tiles(7, 1)[0]];

    assert_eq!(covered.measure(Some(&ends)), Some(novelty(8, 8)));
}

#[test]
fn a_neighbour_the_drawing_margin_reaches_is_not_ground() {
    let lat = tile_y_to_lat(f64::from(ROW) + 0.5, GROUND_ZOOM);
    // One percent into its tile, well inside the drawing margin of the tile
    // before it.
    let edge = tile_x_to_lon(f64::from(FIRST_COLUMN) + 0.01, GROUND_ZOOM);
    let before = tile_x_to_lon(f64::from(FIRST_COLUMN) - 0.5, GROUND_ZOOM);
    assert!(lon_to_tile_x(edge, GROUND_ZOOM).fract() < 0.1);
    assert!(lat_to_tile_y(lat, GROUND_ZOOM).fract() > 0.1);

    let mut covered = Covered::default();
    covered.measure(Some(&[GpsPoint::new(lat, edge)]));
    let next = covered
        .measure(Some(&[GpsPoint::new(lat, before)]))
        .unwrap();

    assert_eq!(next, novelty(1, 1));
}

#[test]
fn an_unreadable_track_adds_no_ground() {
    let mut covered = Covered::default();

    assert_eq!(covered.measure(None), None);
    assert_eq!(covered.measure(Some(&[])), None);
    assert_eq!(
        covered.measure(Some(&[GpsPoint::new(f64::NAN, 7.0)])),
        None,
        "a track of invalid points has no ground"
    );
    assert_eq!(
        covered.measure(Some(&row_of_tiles(0, 3))),
        Some(novelty(3, 3))
    );
}

#[test]
fn only_all_new_and_at_least_half_new_earn_a_badge() {
    use crate::FfiNewGroundBadge::{EntirelyNew, MostlyNew};

    assert_eq!(novelty(10, 10).badge(), Some(EntirelyNew));
    assert_eq!(novelty(100, 99).badge(), Some(MostlyNew));
    assert_eq!(novelty(100, 50).badge(), Some(MostlyNew));
    assert_eq!(novelty(100, 49).badge(), None);
    assert_eq!(novelty(100, 0).badge(), None);
    assert_eq!(novelty(0, 0).badge(), None);
    assert_eq!(novelty(0, 0).fraction(), None);
}

fn store_activity(engine: &mut PersistentEngine, id: &str, start: i64, track: Vec<GpsPoint>) {
    engine
        .add_activities_batch(vec![(id.to_string(), track, "Ride".to_string())])
        .unwrap();
    engine
        .update_activity_metadata(id, Some(start), Some(id), None, None)
        .unwrap();
}

fn refresh(engine: &PersistentEngine) {
    let generation = engine.new_ground.generation();
    let measured = measure_library(&engine.db).unwrap();
    assert!(store(&engine.db, &engine.new_ground, generation, &measured).unwrap());
}

fn stored(engine: &PersistentEngine, id: &str) -> Option<(u32, u32)> {
    engine
        .db
        .query_row(
            "SELECT tiles, new_tiles FROM activity_new_ground WHERE activity_id = ?",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()
}

#[test]
fn the_library_is_measured_in_start_order_not_storage_order() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "later", 2_000, row_of_tiles(0, 10));
    store_activity(&mut engine, "earlier", 1_000, row_of_tiles(0, 10));
    assert_eq!(owed_count(&engine.db).unwrap(), 2);

    refresh(&engine);

    assert_eq!(stored(&engine, "earlier"), Some((10, 10)));
    assert_eq!(stored(&engine, "later"), Some((10, 0)));
    assert_eq!(owed_count(&engine.db).unwrap(), 0);
}

#[test]
fn an_undecodable_track_is_measured_without_a_fraction_and_not_owed_again() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "broken", 1_000, row_of_tiles(0, 3));
    store_activity(&mut engine, "after", 2_000, row_of_tiles(0, 3));
    engine
        .db
        .execute(
            "UPDATE gps_tracks SET track_data = X'00ff' WHERE activity_id = 'broken'",
            [],
        )
        .unwrap();

    refresh(&engine);

    assert_eq!(stored(&engine, "broken"), Some((0, 0)));
    assert_eq!(stored(&engine, "after"), Some((3, 3)));
    assert_eq!(owed_count(&engine.db).unwrap(), 0);
    let ids = vec!["broken".to_string(), "after".to_string()];
    let read = pooled::new_ground_of(&engine.db, &ids);
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].activity_id, "after");
    assert_eq!(read[0].badge, Some(crate::FfiNewGroundBadge::EntirelyNew));
}

#[test]
fn an_undated_activity_is_not_measured_or_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activities_batch(vec![(
            "undated".to_string(),
            row_of_tiles(0, 3),
            "Ride".into(),
        )])
        .unwrap();

    refresh(&engine);

    assert_eq!(stored(&engine, "undated"), None);
    assert_eq!(owed_count(&engine.db).unwrap(), 0);
}

#[test]
fn removing_an_activity_clears_the_values_measured_against_it() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "first", 1_000, row_of_tiles(0, 5));
    store_activity(&mut engine, "second", 2_000, row_of_tiles(0, 5));
    refresh(&engine);
    assert_eq!(stored(&engine, "second"), Some((5, 0)));

    engine.remove_activity("first").unwrap();

    assert_eq!(owed_count(&engine.db).unwrap(), 1);
    refresh(&engine);
    assert_eq!(stored(&engine, "second"), Some((5, 5)));
}

#[test]
fn a_measurement_taken_before_a_removal_is_refused_and_taken_again() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "first", 1_000, row_of_tiles(0, 5));
    store_activity(&mut engine, "second", 2_000, row_of_tiles(0, 5));
    let before = engine.new_ground.generation();
    let stale = measure_library(&engine.db).unwrap();

    engine.remove_activity("first").unwrap();

    let stored_stale = store(&engine.db, &engine.new_ground, before, &stale).unwrap();
    assert!(
        !stored_stale,
        "a measurement older than the removal is refused"
    );
    assert_eq!(stored(&engine, "second"), None);
    assert_eq!(owed_count(&engine.db).unwrap(), 1);

    refresh(&engine);
    assert_eq!(stored(&engine, "second"), Some((5, 5)));
}

#[test]
fn clearing_the_derived_rows_moves_the_generation() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "first", 1_000, row_of_tiles(0, 5));
    let before = engine.new_ground.generation();
    let stale = measure_library(&engine.db).unwrap();

    engine.clear_derived().unwrap();

    assert!(!store(&engine.db, &engine.new_ground, before, &stale).unwrap());
}

#[test]
fn a_removal_starts_the_pass_that_measures_the_rest_again() {
    use crate::persistence::with_persistent_engine;

    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("new_ground_removal.db");
    with_persistent_engine(|engine| {
        store_activity(engine, "first", 1_000, row_of_tiles(0, 5));
        store_activity(engine, "second", 2_000, row_of_tiles(0, 5));
        refresh(engine);
        assert_eq!(stored(engine, "second"), Some((5, 0)));
    })
    .unwrap();

    with_persistent_engine(|engine| engine.remove_activity("first").unwrap()).unwrap();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while with_persistent_engine(|engine| stored(engine, "second")).unwrap() != Some((5, 5)) {
        assert!(
            std::time::Instant::now() < deadline,
            "no pass measured the library after the removal"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    while RUNNING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[test]
fn a_new_activity_makes_the_table_owed_again() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_activity(&mut engine, "first", 1_000, row_of_tiles(0, 5));
    refresh(&engine);
    assert_eq!(owed_count(&engine.db).unwrap(), 0);

    store_activity(&mut engine, "backfilled", 500, row_of_tiles(0, 5));

    assert_eq!(owed_count(&engine.db).unwrap(), 1);
    refresh(&engine);
    assert_eq!(stored(&engine, "backfilled"), Some((5, 5)));
    assert_eq!(stored(&engine, "first"), Some((5, 0)));
}

#[test]
fn the_owed_work_at_open_measures_a_library_on_a_thread_of_its_own() {
    use crate::persistence::with_persistent_engine;

    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("new_ground_pass.db");
    with_persistent_engine(|engine| {
        store_activity(engine, "first", 1_000, row_of_tiles(0, 8));
        store_activity(engine, "second", 2_000, row_of_tiles(4, 8));
    })
    .unwrap();

    crate::net::elevation_backfill::start_owed_work();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while with_persistent_engine(|engine| owed_count(&engine.db).unwrap()).unwrap() > 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the pass never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    with_persistent_engine(|engine| {
        assert_eq!(stored(engine, "first"), Some((8, 8)));
        assert_eq!(stored(engine, "second"), Some((8, 4)));
    })
    .unwrap();
    // The thread clears its slot just after the last round, so wait it out.
    while RUNNING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
