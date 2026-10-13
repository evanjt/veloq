//! What redraws the heatmap after something deletes part of it.
//!
//! A sweep deletes the tiles an added, changed or removed activity reached and
//! marks the set dirty. Only a deep tile is drawn on demand, so a deleted tile
//! the pass draws answers 404 until a pass redraws it. These pin who starts that pass and
//! which tiles the sweep is allowed to take.
//!
//! The pass slot, the handle slot, the sweep registry and the global engine
//! are all process-wide, so every test here takes `serial_global_state`.

use super::*;
use crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE;
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};
use std::time::{Duration, Instant};

fn sweeps_running() -> bool {
    !crate::persistence::TILE_SWEEPS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_empty()
}

fn wait_for_sweeps() {
    let deadline = Instant::now() + Duration::from_secs(60);
    while sweeps_running() {
        assert!(Instant::now() < deadline, "a tile sweep never ended");
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Wait out every sweep and every pass, including the ones they start, and
/// answer how many passes ran.
fn settle() -> usize {
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut passes = 0;
    loop {
        assert!(Instant::now() < deadline, "the heatmap work never settled");
        if sweeps_running() {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }
        let parked = TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(handle) = parked {
            handle.recv_blocking();
            passes += 1;
            continue;
        }
        if tile_pass_slot().is_some() || tile_pass_retry().is_some() {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }
        return passes;
    }
}

/// A straight line of points from one corner to another.
fn line(from: (f64, f64), to: (f64, f64), points: u32) -> Vec<GpsPoint> {
    (0..=points)
        .map(|i| {
            let t = f64::from(i) / f64::from(points);
            GpsPoint::new(from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t)
        })
        .collect()
}

fn tile_at(lat: f64, lon: f64, z: u8) -> (u8, u32, u32) {
    (
        z,
        crate::tiles::lon_to_tile_x(lon, z).floor() as u32,
        crate::tiles::lat_to_tile_y(lat, z).floor() as u32,
    )
}

fn png(base: &Path, (z, x, y): (u8, u32, u32)) -> PathBuf {
    base.join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.png"))
}

fn store_through_the_ffi(id: &str, track: &[GpsPoint]) {
    let coords: Vec<f64> = track
        .iter()
        .flat_map(|p| [p.latitude, p.longitude])
        .collect();
    crate::objects::activities::ActivityManager::new()
        .add(vec![id.to_string()], coords, vec![0], vec!["Ride".into()])
        .expect("the batch is stored");
}

fn set_tiles_path(tiles: &Path) {
    with_persistent_engine(|e| e.set_heatmap_tiles_path(tiles.to_string_lossy().into_owned()))
        .expect("engine");
}

fn turn_the_heatmap_off() {
    with_persistent_engine(|e| e.clear_heatmap_tiles_path());
}

/// Two rides a few kilometres apart in Sion: the same tile at every low zoom,
/// different tiles at street level.
fn sion_east() -> Vec<GpsPoint> {
    line((46.23, 7.35), (46.23, 7.40), 60)
}

fn sion_west() -> Vec<GpsPoint> {
    line((46.25, 7.30), (46.25, 7.33), 40)
}

/// Scenario: the athlete deletes a duplicate ride. The removal sweeps its box
/// at every zoom, which at low zoom is the tile the rest of the library is
/// drawn in, and the store that would have started a pass never happens.
///
/// Expected behaviour: the sweep's end starts a pass, and the ground the other
/// ride still covers is drawn again.
#[test]
fn removing_an_activity_redraws_the_ground_its_sweep_took() {
    let _serial = serial_global_state();
    // A pass another test left parked is not this test's to count.
    settle();
    let tmp = init_global_engine("removal-redraw.db");
    let tiles = tmp.path().join("tiles");
    with_persistent_engine(|e| {
        e.add_activity("east".into(), sion_east(), "Ride".into())
            .expect("east stored");
        e.add_activity("west".into(), sion_west(), "Ride".into())
            .expect("west stored");
    })
    .expect("engine");
    set_tiles_path(&tiles);
    assert!(settle() > 0, "the stale set drew no first pass");
    let shared = tile_at(46.25, 7.31, 5);
    assert!(
        png(&tiles, shared).exists(),
        "the first pass drew no z5 tile"
    );

    crate::objects::activities::ActivityManager::new()
        .remove("east".into())
        .expect("east removed");
    let passes = settle();

    turn_the_heatmap_off();
    assert!(passes > 0, "the removal sweep started no pass");
    assert!(
        png(&tiles, shared).exists(),
        "the z5 tile the west ride still covers stayed deleted"
    );
}

/// Scenario: a pass is drawing when a sync stores a new ride. The pass asked
/// for after the store is refused, the running one planned from the library
/// before the ride, and nothing asks again.
///
/// Expected behaviour: the running pass sees the set was marked while it
/// worked and runs once more, and the new ride's ground is drawn.
#[test]
fn a_ride_stored_during_a_pass_is_drawn_by_the_pass_after_it() {
    let _serial = serial_global_state();
    // A pass another test left parked is not this test's to count.
    settle();
    let tmp = init_global_engine("rerun.db");
    let tiles = tmp.path().join("tiles");
    with_persistent_engine(|e| {
        e.add_activity("east".into(), sion_east(), "Ride".into())
            .expect("east stored")
    })
    .expect("engine");

    let hold = hold_next_tile_pass();
    set_tiles_path(&tiles);
    hold.wait_until_reached();
    // Melbourne: no tile the first pass planned.
    let melbourne = line((-37.81, 144.96), (-37.80, 144.97), 30);
    store_through_the_ffi("melbourne", &melbourne);
    wait_for_sweeps();
    hold.release();
    let passes = settle();

    turn_the_heatmap_off();
    let street = tile_at(-37.805, 144.965, 14);
    assert!(
        passes >= 2,
        "only {passes} pass ran, the refused one never did"
    );
    assert!(
        png(&tiles, street).exists(),
        "the ride stored during the pass is not on the heatmap"
    );
}

/// Scenario: the heatmap path is set at launch with an empty catalogue, then
/// the demo library or a paired library arrives through one stored batch.
/// The pass the path would have started had nothing to draw, and a batch
/// stored through the FFI started none.
///
/// Expected behaviour: the stored batch is drawn in the same session.
#[test]
fn a_batch_stored_after_the_path_was_set_is_drawn() {
    let _serial = serial_global_state();
    // A pass another test left parked is not this test's to count.
    settle();
    let tmp = init_global_engine("seeded-after-path.db");
    let tiles = tmp.path().join("tiles");
    set_tiles_path(&tiles);
    assert_eq!(settle(), 0, "an empty catalogue started a pass");

    store_through_the_ffi("east", &sion_east());
    let passes = settle();

    turn_the_heatmap_off();
    assert!(passes > 0, "a stored batch started no pass");
    assert!(
        png(&tiles, tile_at(46.23, 7.37, 14)).exists(),
        "the stored ride is not on the heatmap"
    );
}

#[test]
fn test_tile_pass_retries_after_the_attempt_store_is_unlocked() {
    let _serial = serial_global_state();
    settle();
    let tmp = init_global_engine("locked-attempt.db");
    let tiles = tmp.path().join("tiles");
    with_persistent_engine(|engine| {
        engine
            .add_activity("east".into(), sion_east(), "Ride".into())
            .expect("ride stored");
        engine.db.busy_timeout(Duration::ZERO).expect("timeout set");
    });
    let lock = rusqlite::Connection::open(tmp.path().join("locked-attempt.db"))
        .expect("second connection");
    lock.execute_batch("BEGIN IMMEDIATE").expect("writer held");
    set_tiles_path(&tiles);
    lock.execute_batch("COMMIT").expect("writer released");

    let passes = settle();
    turn_the_heatmap_off();
    assert!(passes > 0, "the locked lease dropped the tile pass request");
    assert!(png(&tiles, tile_at(46.23, 7.37, 14)).exists());
}

/// An L: east along 46.20 from 7.30 to 7.40, then north along 7.40 to 46.30.
/// Its box is a square whose north-west quarter it never goes near.
fn l_ride() -> Vec<GpsPoint> {
    let mut track = line((46.20, 7.30), (46.20, 7.40), 80);
    track.extend(line((46.20, 7.40), (46.30, 7.40), 80).into_iter().skip(1));
    track
}

/// Scenario: the athlete rides a loop round their town. The store swept every
/// tile in the loop's box at every zoom, including the dense home tiles inside
/// it that the loop never crosses, and each was a hole until a pass redrew it.
///
/// Expected behaviour: the store takes the tiles its track reaches and leaves
/// the rest of the box as it was.
#[test]
fn a_store_sweeps_the_tiles_its_track_reaches_and_not_its_box() {
    let _serial = serial_global_state();
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let tiles = tmp.path().join("tiles");
    let mut engine =
        PersistentEngine::new(tmp.path().join("box.db").to_str().unwrap()).expect("engine");
    engine.set_heatmap_tiles_path(tiles.to_string_lossy().into_owned());
    let mut inside_the_box = Vec::new();
    let mut on_the_track = Vec::new();
    for z in 14..=17 {
        let off = tile_at(46.28, 7.32, z);
        let on = tile_at(46.20, 7.35, z);
        crate::tiles::save_tile(&tiles, off.0, off.1, off.2, b"home heat").expect("tile");
        crate::tiles::save_tile(&tiles, on.0, on.1, on.2, b"old heat").expect("tile");
        inside_the_box.push(off);
        on_the_track.push(on);
    }

    engine
        .add_activity("loop".into(), l_ride(), "Ride".into())
        .expect("stored");
    wait_for_sweeps();

    for coord in inside_the_box {
        assert_eq!(
            std::fs::read(png(&tiles, coord)).ok().as_deref(),
            Some(&b"home heat"[..]),
            "{coord:?} is inside the box and off the track, and was swept"
        );
    }
    for coord in on_the_track {
        assert!(
            !png(&tiles, coord).exists(),
            "{coord:?} is on the track and was not swept"
        );
    }
}

/// Scenario: a ride is re-uploaded with a GPS fix that removes a spike. The
/// sweep covered only the new bounds, so the spike's heat outside them was
/// never deleted and stayed on the map.
///
/// Expected behaviour: a changed track sweeps the ground of its old track as
/// well as its new one.
#[test]
fn a_changed_track_sweeps_the_ground_it_no_longer_covers() {
    let _serial = serial_global_state();
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let tiles = tmp.path().join("tiles");
    let mut engine =
        PersistentEngine::new(tmp.path().join("spike.db").to_str().unwrap()).expect("engine");
    engine.set_heatmap_tiles_path(tiles.to_string_lossy().into_owned());
    let mut spiked = l_ride();
    spiked.extend(line((46.30, 7.40), (46.25, 7.50), 40).into_iter().skip(1));
    engine
        .add_activity("loop".into(), spiked, "Ride".into())
        .expect("stored with the spike");
    wait_for_sweeps();
    let spike = tile_at(46.26, 7.48, 14);
    crate::tiles::save_tile(&tiles, spike.0, spike.1, spike.2, b"spike heat").expect("tile");

    let mutated = engine
        .add_activity("loop".into(), l_ride(), "Ride".into())
        .expect("stored without the spike");
    wait_for_sweeps();

    assert_eq!(mutated, vec!["loop".to_string()], "the fix is a mutation");
    assert!(
        !png(&tiles, spike).exists(),
        "the spike's heat outside the new track was left on the map"
    );
}

/// Scenario: a first sync stores a large library one activity at a time, and
/// every store sweeps. If each sweep's end started a pass, passes would chain
/// through the whole download, each reloading every track and redrawing home
/// tiles the next store deletes again.
///
/// Expected behaviour: while the sync holds passes back no sweep starts one,
/// and the pass held back is asked for when the sync lets go.
#[test]
fn a_sync_holds_back_the_passes_its_stores_ask_for_until_it_ends() {
    let _serial = serial_global_state();
    // A pass another test left parked is not this test's to count.
    settle();
    let tmp = init_global_engine("deferred.db");
    let tiles = tmp.path().join("tiles");
    set_tiles_path(&tiles);
    settle();

    let held = defer_tile_passes();
    store_through_the_ffi("east", &sion_east());
    store_through_the_ffi("west", &sion_west());
    wait_for_sweeps();
    let started_during_the_sync = TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
        || tile_pass_slot().is_some();
    drop(held);
    let passes = settle();

    turn_the_heatmap_off();
    assert!(
        !started_during_the_sync,
        "a store's sweep started a pass while the sync held them back"
    );
    assert_eq!(passes, 1, "the pass held back was not asked for once");
    assert!(png(&tiles, tile_at(46.25, 7.31, 14)).exists());
}

/// Whether a pass is running or parked, without taking it.
fn a_pass_is_live() -> bool {
    TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
        || tile_pass_slot().is_some()
}

fn engine_with_two_rides(name: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = init_global_engine(name);
    let tiles = tmp.path().join("tiles");
    store_through_the_ffi("east", &sion_east());
    store_through_the_ffi("west", &sion_west());
    set_tiles_path(&tiles);
    settle();
    (tmp, tiles)
}

/// Scenario: a pass was cancelled by a catalogue clear, which keeps every
/// activity and leaves the set dirty, and no sync is running to start another.
///
/// Expected behaviour: the pass request a wipe's end makes starts a pass that
/// clears the marker.
#[test]
fn a_catalogue_clear_leaves_a_dirty_set_that_a_pass_request_draws() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, tiles) = engine_with_two_rides("clear-redraw.db");
    with_persistent_engine(|e| e.mark_heatmap_dirty());

    crate::persistence::wipe_with_persistent_engine_for(
        crate::persistence::engine_install(),
        |e| e.clear_routes_and_sections(),
    )
    .expect("engine")
    .expect("catalogue clear");
    request_tile_pass_if_dirty(crate::persistence::engine_install());
    let passes = settle();

    let dirty = with_persistent_engine(|e| e.is_heatmap_dirty()).unwrap();
    turn_the_heatmap_off();
    assert!(passes > 0, "the clear started no pass");
    assert!(!dirty, "the set stayed dirty after the clear");
    assert!(tiles.join("version.txt").exists());
}

/// Scenario: the heatmap is off when the athlete clears derived data.
///
/// Expected behaviour: no pass starts.
#[test]
fn a_derived_clear_with_the_heatmap_off_starts_no_pass() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, _tiles) = engine_with_two_rides("clear-off.db");
    turn_the_heatmap_off();

    crate::runtime::block_on(
        crate::objects::VeloqEngine::create("unused".into()).run_clear_derived(),
    )
    .expect("derived clear");
    let live = a_pass_is_live();
    let passes = settle();

    assert!(!live && passes == 0, "a pass started with the heatmap off");
}

/// Scenario: the install has moved on before the request runs, as when
/// another library is opened.
///
/// Expected behaviour: the request starts nothing, and a clean set starts
/// nothing either.
#[test]
fn a_redraw_request_for_a_stale_install_or_clean_set_starts_nothing() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, _tiles) = engine_with_two_rides("request-guard.db");

    request_tile_pass_if_dirty(crate::persistence::engine_install());
    assert!(!a_pass_is_live(), "a clean set started a pass");

    with_persistent_engine(|e| e.mark_heatmap_dirty());
    request_tile_pass_if_dirty(crate::persistence::engine_install().wrapping_sub(1));
    assert!(!a_pass_is_live(), "a stale install started a pass");
    turn_the_heatmap_off();
}

/// Scenario: a pass is requested by a sweep on another thread and its handle
/// is taken long after the worker has finished.
///
/// Expected behaviour: the duration the handle reports is the worker's own,
/// from the request to the last tile, so it is the same whenever the handle is
/// taken.
#[test]
fn a_pass_reports_its_own_duration_however_late_its_handle_is_taken() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, tiles) = engine_with_two_rides("pass-duration.db");
    crate::tiles::clear_all_tiles(&tiles).expect("tiles cleared");
    with_persistent_engine(|e| e.mark_heatmap_dirty());

    let requested = Instant::now();
    assert!(with_persistent_engine(|e| e.start_tile_pass()).expect("engine"));
    let deadline = requested + Duration::from_secs(60);
    while tile_pass_slot().is_some() {
        assert!(Instant::now() < deadline, "the pass never ended");
        std::thread::sleep(Duration::from_millis(1));
    }
    let ended = requested.elapsed();
    std::thread::sleep(Duration::from_millis(300));
    let handle = TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .expect("the pass parked its handle");
    assert!(handle.recv_blocking().expect("the pass reported") > 0);
    let reported = handle.generation_elapsed();
    turn_the_heatmap_off();

    assert!(
        reported >= Duration::from_millis(1),
        "the reported duration {reported:?} leaves out the generation"
    );
    assert!(
        reported <= ended + Duration::from_millis(5),
        "the reported duration {reported:?} runs past the pass ending at {ended:?}"
    );
}

fn read_set(base: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, out);
            } else if path.extension().is_some_and(|e| e == "png") {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                out.insert(name, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = std::collections::BTreeMap::new();
    walk(base, base, &mut out);
    out
}

/// Scenario: a ride is stored after a full set was drawn, and another ride is
/// removed.
///
/// Expected behaviour: the pass that follows plans only the swept ground and
/// leaves every tile byte-identical to a cold pass over the same library, and
/// a deleted record makes the next pass plan in full.
#[test]
fn a_swept_pass_draws_what_a_cold_pass_draws() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, tiles) = engine_with_two_rides("swept-pass.db");
    let added = line((46.232, 7.34), (46.232, 7.37), 50);

    store_through_the_ffi("added", &added);
    settle();
    let after_store = read_set(&tiles);
    assert!(
        !tiles.join("swept-tiles").exists(),
        "the record outlived the pass"
    );

    with_persistent_engine(|e| e.remove_activity("west"))
        .expect("engine")
        .expect("removed");
    settle();
    let after_removal = read_set(&tiles);

    let (_cold_tmp, cold) = {
        let tmp = init_global_engine("swept-pass-cold.db");
        let cold = tmp.path().join("tiles");
        store_through_the_ffi("east", &sion_east());
        store_through_the_ffi("added", &added);
        set_tiles_path(&cold);
        settle();
        (tmp, cold)
    };
    let cold_set = read_set(&cold);
    turn_the_heatmap_off();

    assert!(after_store.len() > 20);
    assert!(
        after_removal.len() < after_store.len(),
        "the removal drew nothing less"
    );
    assert_eq!(after_removal, cold_set);
}

/// Scenario: a cold pass over a library whose rides reach every zoom and many
/// tiles at each.
///
/// Expected behaviour: each stored point is projected onto the map once for
/// the whole pass, not once for every zoom it is planned at and every tile it
/// is drawn into, which made a pass cost the library's points times its zooms
/// and a low-zoom tile cost every point of every ride under it.
#[test]
fn a_pass_projects_each_point_once() {
    let _serial = serial_global_state();
    settle();
    let tmp = init_global_engine("projected-once.db");
    let rides: Vec<Vec<GpsPoint>> = (0..12)
        .map(|i| {
            let lat = 46.23 + f64::from(i) * 0.002;
            line((lat, 7.30), (lat, 7.70), 400)
        })
        .collect();
    for (i, ride) in rides.iter().enumerate() {
        store_through_the_ffi(&format!("ride-{i}"), ride);
    }
    settle();
    let (db, activities) = with_persistent_engine(|e| {
        let activities: Vec<(String, Bounds)> = e
            .activity_metadata
            .iter()
            .map(|(id, m)| (id.clone(), m.bounds))
            .collect();
        (e.db_path.clone(), activities)
    })
    .expect("engine");
    let tiles = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles).unwrap();

    // One worker, so every projection the pass makes lands on the thread
    // that counts them.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .build()
        .unwrap();
    let (run, projected) = pool.install(|| {
        crate::tiles::work::take_projections();
        let run = background_generate_tiles(
            &db,
            &tiles.to_string_lossy(),
            &activities,
            &AtomicU32::new(0),
            &AtomicU32::new(0),
            &crate::persistence::CancelToken::new(),
            None,
        );
        (run, crate::tiles::work::take_projections())
    });

    let points: usize = rides.iter().map(Vec::len).sum();
    assert_eq!(activities.len(), rides.len());
    assert!(run.generated > 50, "the pass drew {} tiles", run.generated);
    assert!(
        projected <= 2 * points,
        "{projected} projections for {points} stored points"
    );
}

/// The zooms a set holds a tile or an empty marker at.
fn zooms_held(base: &Path) -> std::collections::BTreeSet<u8> {
    std::fs::read_dir(base)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_string_lossy().parse::<u8>().ok())
        .collect()
}

/// Scenario: a five-year library draws its heatmap on a fresh install. The
/// deepest three zooms are most of the tree on disk, and the map draws any of
/// them when it asks.
///
/// Expected behaviour: the pass draws every zoom up to the on-request floor
/// and nothing at or below it.
#[test]
fn a_pass_draws_nothing_the_map_draws_on_request() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, tiles) = engine_with_two_rides("pass-floor.db");
    turn_the_heatmap_off();

    let deepest = ON_REQUEST_MIN_ZOOM - 1;
    assert_eq!(
        zooms_held(&tiles),
        (1..=deepest).collect(),
        "the pass drew a zoom the map draws on request, or skipped one it owes"
    );
    assert!(png(&tiles, tile_at(46.23, 7.37, deepest)).exists());
}

/// Scenario: the athlete looked at a street at z16, which drew and kept its
/// tile, and a ride across that street then syncs.
///
/// Expected behaviour: the ride's sweep deletes the kept tile, the pass that
/// follows does not draw it, and the next ask draws it again with the new
/// ride in it.
#[test]
fn a_stored_track_clears_a_deep_tile_drawn_on_request_and_the_next_ask_redraws_it() {
    let _serial = serial_global_state();
    settle();
    let (_tmp, tiles) = engine_with_two_rides("deep-sweep.db");
    let (z, x, y) = tile_at(46.23, 7.37, 16);
    let before = heatmap_tile_bytes(z, x, y).expect("the street is drawn on request");
    assert!(
        png(&tiles, (z, x, y)).exists(),
        "the drawn tile was not kept"
    );

    let crossing = line((46.225, 7.371), (46.235, 7.371), 40);
    store_through_the_ffi("crossing", &crossing);
    wait_for_sweeps();
    let swept = !png(&tiles, (z, x, y)).exists();
    settle();
    let after_pass = png(&tiles, (z, x, y)).exists();
    let after = heatmap_tile_bytes(z, x, y);

    let (_cold_tmp, cold) = {
        let tmp = init_global_engine("deep-sweep-cold.db");
        let tiles = tmp.path().join("tiles");
        store_through_the_ffi("east", &sion_east());
        store_through_the_ffi("west", &sion_west());
        store_through_the_ffi("crossing", &crossing);
        set_tiles_path(&tiles);
        settle();
        let cold = heatmap_tile_bytes(z, x, y);
        (tmp, cold)
    };
    turn_the_heatmap_off();

    assert!(
        swept,
        "the sweep left the deep tile drawn without the new ride"
    );
    assert!(!after_pass, "the pass drew a deep tile");
    let after = after.expect("the street is drawn again on request");
    assert_ne!(after, before, "the redrawn tile does not hold the new ride");
    let pixels = |png: &[u8]| image::load_from_memory(png).unwrap().to_rgba8().into_raw();
    assert_eq!(
        pixels(&after),
        pixels(&cold.expect("a cold library draws the street")),
        "the redrawn tile is not what a library holding the new ride draws"
    );
}
