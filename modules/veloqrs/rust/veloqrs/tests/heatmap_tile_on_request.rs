//! A deep heatmap tile no pass has drawn, drawn when the map asks for it.
//!
//! The map reads tiles through `heatmap_tile_bytes` on the WebView
//! interceptor's thread, with no engine lock. At the deepest zooms a miss is
//! drawn there from the stored tracks whose bounds reach the tile and written
//! for the next read; a shallower miss stays a hole for the pass.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test heatmap_synthetic -- heatmap_tile_on_request::`

use std::fs;
use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::tiles::heatmap_tile_bytes;

/// The tiles directory the reader serves is process-wide, so these run one at
/// a time: two of them setting it at once would read each other's answer.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner())
}

fn engine(dir: &TempDir) -> PersistentEngine {
    PersistentEngine::new(dir.path().join("tiles.db").to_str().unwrap()).expect("engine")
}

const ON_TRACK: (f64, f64) = (45.0001, 6.005);
const OFF_EVERY_TRACK: (f64, f64) = (45.2, 6.2);

fn line(lat: f64, lng: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|k| GpsPoint::new(lat, lng + f64::from(k) * 0.0001))
        .collect()
}

fn tile_at((lat, lng): (f64, f64), z: u8) -> (u32, u32) {
    (
        veloqrs::tiles::lon_to_tile_x(lng, z).floor() as u32,
        veloqrs::tiles::lat_to_tile_y(lat, z).floor() as u32,
    )
}

fn tile_file(base: &std::path::Path, z: u8, x: u32, y: u32, ext: &str) -> std::path::PathBuf {
    base.join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.{ext}"))
}

fn pixels(png: &[u8]) -> Vec<u8> {
    image::load_from_memory(png)
        .expect("a PNG")
        .to_rgba8()
        .into_raw()
}

struct Library {
    _dir: TempDir,
    engine: PersistentEngine,
    /// The set a full pass drew over the same tracks.
    drawn_by_pass: std::path::PathBuf,
    /// The set the map reads, which no pass has touched.
    served: std::path::PathBuf,
}

fn tracks() -> [(&'static str, Vec<GpsPoint>); 3] {
    [
        ("near-1", line(45.0, 6.0)),
        ("near-2", line(45.0003, 6.0)),
        ("far", line(45.4, 6.4)),
    ]
}

/// The tile as the pass draws one: every track whose walk at its zoom holds
/// it, stroked into one canvas.
fn drawn_as_the_pass_draws(z: u8, x: u32, y: u32) -> Vec<u8> {
    let placed: Vec<veloqrs::tiles::ProjectedTrack> = tracks()
        .iter()
        .map(|(_, track)| veloqrs::tiles::ProjectedTrack::new(track))
        .filter(|track| track.tiles_along(z).contains(&(x, y)))
        .collect();
    veloqrs::tiles::draw_heatmap_tile(z, x, y, &placed.iter().collect::<Vec<_>>())
        .expect("the tracks ink the tile")
}

/// Two tracks side by side and one 50 km away, a full pass over them in
/// one set, and a second set at the same format version that no pass has
/// drawn into.
fn library() -> Library {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    for (id, track) in tracks() {
        engine
            .add_activity(id.into(), track, "Walk".into())
            .expect("stored");
    }

    let drawn_by_pass = dir.path().join("drawn-by-pass");
    fs::create_dir_all(&drawn_by_pass).unwrap();
    engine.set_heatmap_tiles_path(drawn_by_pass.to_str().unwrap().to_string());
    veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap()
        .take()
        .expect("a first open with activities starts a pass")
        .recv_blocking()
        .expect("the pass ran");

    let served = dir.path().join("served");
    fs::create_dir_all(&served).unwrap();
    fs::copy(
        drawn_by_pass.join("version.txt"),
        served.join("version.txt"),
    )
    .unwrap();
    engine.set_heatmap_tiles_path(served.to_str().unwrap().to_string());
    assert!(
        veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap()
            .take()
            .is_none(),
        "a clean set at the current version starts no pass"
    );
    Library {
        _dir: dir,
        engine,
        drawn_by_pass,
        served,
    }
}

#[test]
fn a_deep_tile_on_a_track_is_drawn_as_the_pass_draws_it_and_kept() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let lib = library();
    let (x, y) = tile_at(ON_TRACK, 16);
    let by_pass = drawn_as_the_pass_draws(16, x, y);

    let served = heatmap_tile_bytes(16, x, y).expect("the tile is drawn on request");

    assert_eq!(pixels(&served), pixels(&by_pass));
    assert_eq!(
        fs::read(tile_file(&lib.served, 16, x, y, "png")).ok(),
        Some(served),
        "the drawn tile is written, so the next ask reads it off disk"
    );
}

#[test]
fn a_deep_tile_off_every_track_reads_as_nothing_and_is_marked_empty() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let lib = library();
    let (x, y) = tile_at(OFF_EVERY_TRACK, 16);

    assert!(heatmap_tile_bytes(16, x, y).is_none());
    assert!(
        tile_file(&lib.served, 16, x, y, "empty").exists(),
        "an empty tile is recorded, so the pass and the next ask skip it"
    );
    assert!(!tile_file(&lib.served, 16, x, y, "png").exists());
}

#[test]
fn with_the_heatmap_off_a_deep_tile_is_neither_drawn_nor_written() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let mut lib = library();
    let (x, y) = tile_at(ON_TRACK, 16);
    lib.engine.clear_heatmap_tiles_path();

    assert!(heatmap_tile_bytes(16, x, y).is_none());
    assert!(!tile_file(&lib.served, 16, x, y, "png").exists());
    assert!(!tile_file(&lib.served, 16, x, y, "empty").exists());
}

#[test]
fn a_missing_tile_below_the_deep_zooms_is_left_to_the_pass() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let lib = library();
    let (x, y) = tile_at(ON_TRACK, 10);
    assert!(
        tile_file(&lib.drawn_by_pass, 10, x, y, "png").exists(),
        "the pass draws this tile"
    );

    assert!(heatmap_tile_bytes(10, x, y).is_none());
    assert!(!tile_file(&lib.served, 10, x, y, "png").exists());
    assert!(!tile_file(&lib.served, 10, x, y, "empty").exists());
}

#[test]
fn every_deep_zoom_is_drawn_on_request() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _lib = library();
    for z in [15u8, 17] {
        let (x, y) = tile_at(ON_TRACK, z);
        let by_pass = drawn_as_the_pass_draws(z, x, y);
        let served = heatmap_tile_bytes(z, x, y).expect("drawn on request");
        assert_eq!(pixels(&served), pixels(&by_pass), "z{z}");
    }
}

#[test]
fn only_the_tracks_whose_bounds_reach_the_tile_are_read() {
    use veloqrs::persistence::tiles::take_on_request_counts;
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _lib = library();
    let (x, y) = tile_at(ON_TRACK, 16);
    take_on_request_counts();

    heatmap_tile_bytes(16, x, y).expect("drawn on request");

    let counts = take_on_request_counts();
    assert_eq!(counts.draws, 1);
    assert_eq!(
        counts.tracks_loaded, 2,
        "the two tracks under the tile are read, the one 50 km away is not"
    );

    heatmap_tile_bytes(16, x, y).expect("read off disk");
    assert_eq!(
        take_on_request_counts().draws,
        0,
        "a tile drawn once is read, not drawn again"
    );
}

#[test]
fn two_asks_for_one_tile_draw_it_once() {
    use std::time::{Duration, Instant};
    use veloqrs::persistence::tiles::{hold_next_tile_draw, take_on_request_counts};
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _lib = library();
    let (x, y) = tile_at(ON_TRACK, 16);
    take_on_request_counts();

    let hold = hold_next_tile_draw();
    let first = std::thread::spawn(move || heatmap_tile_bytes(16, x, y));
    hold.wait_until_reached();
    let second = std::thread::spawn(move || heatmap_tile_bytes(16, x, y));
    let deadline = Instant::now() + Duration::from_secs(10);
    let (mut misses, mut draws) = (0, 0);
    while misses < 2 {
        assert!(Instant::now() < deadline, "the second ask never arrived");
        std::thread::sleep(Duration::from_millis(5));
        let counts = take_on_request_counts();
        misses += counts.misses;
        draws += counts.draws;
    }
    hold.release();

    let first = first.join().unwrap().expect("drawn");
    let second = second.join().unwrap().expect("drawn");
    draws += take_on_request_counts().draws;
    assert_eq!(first, second);
    assert_eq!(
        draws, 1,
        "the second ask waits for the first draw and reads it"
    );
}
