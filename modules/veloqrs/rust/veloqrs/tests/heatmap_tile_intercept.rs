//! The map page's heatmap tiles, read the way the WebView's request
//! interceptor reads them.
//!
//! The tiles are PNGs a Rust pass wrote under `<dir>/<z>/<x>/<y>.png`. They
//! used to reach the page as base64 over the React Native bridge, measured at
//! 47.8 ms a tile against 6.6 ms intercepted, so the interceptor reads the file
//! itself. It runs on a background thread with no JavaScript context, and it
//! must not take the engine lock to do it.
//!
//! Run: `cargo test --test heatmap -p veloqrs -- heatmap_tile_intercept::`

use std::fs;
use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// The tiles directory the interceptor reads is process-wide, so these run one
/// at a time: two of them setting it at once would read each other's answer.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner())
}

fn engine(dir: &TempDir) -> PersistentEngine {
    PersistentEngine::new(dir.path().join("tiles.db").to_str().unwrap()).expect("engine")
}

fn write_tile(base: &std::path::Path, z: u8, x: u32, y: u32, bytes: &[u8]) {
    let dir = base.join(z.to_string()).join(x.to_string());
    fs::create_dir_all(&dir).expect("tile directory");
    fs::write(dir.join(format!("{}.png", y)), bytes).expect("tile");
}

#[test]
fn a_drawn_tile_is_read_straight_off_disk() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let mut e = engine(&dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());

    write_tile(&tiles, 12, 2048, 1361, b"\x89PNG\r\n\x1a\n heatmap");

    assert_eq!(
        veloqrs::persistence::tiles::heatmap_tile_bytes(12, 2048, 1361).as_deref(),
        Some(&b"\x89PNG\r\n\x1a\n heatmap"[..])
    );
}

#[test]
fn a_tile_the_pass_has_not_drawn_yet_reads_as_nothing() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let mut e = engine(&dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());

    assert!(
        veloqrs::persistence::tiles::heatmap_tile_bytes(12, 1, 1).is_none(),
        "a miss is not drawn yet, and the interceptor answers 404 rather than a hole"
    );
}

/// An empty file is the marker the pass writes for a tile with no track on it.
#[test]
fn an_empty_tile_marker_reads_as_nothing() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let mut e = engine(&dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());

    write_tile(&tiles, 12, 5, 6, b"");

    assert!(veloqrs::persistence::tiles::heatmap_tile_bytes(12, 5, 6).is_none());
}

#[test]
fn the_heatmap_switched_off_serves_nothing_even_where_tiles_remain() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let mut e = engine(&dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    write_tile(&tiles, 12, 7, 8, b"png");

    e.clear_heatmap_tiles_path();

    assert!(
        veloqrs::persistence::tiles::heatmap_tile_bytes(12, 7, 8).is_none(),
        "the path is what the athlete turned off, and the files outlive it"
    );
}
