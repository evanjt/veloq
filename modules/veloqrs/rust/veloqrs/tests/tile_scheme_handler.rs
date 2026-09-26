//! The C entry point the iOS scheme handler calls, through the symbol it links.
//!
//! iOS has no JNI: the handler is Objective-C and reaches the store through a
//! plain C symbol in the xcframework. These tests call it by that name, the
//! way the handler does, so a rename on either side fails here rather than at
//! link time on the macmini. The bytes cross the boundary as a leaked slice
//! and come back through the free, which is the other half of the contract.
//!
//! Run: `cargo test --test tile_scheme_handler -p veloqrs`

use std::ffi::CString;
use std::fs;
use std::os::raw::c_char;
use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use veloqrs::PersistentEngine;

unsafe extern "C" {
    fn veloq_tile_get_or_fetch(
        source: *const c_char,
        z: u32,
        x: u32,
        y: u32,
        len: *mut usize,
    ) -> *mut u8;
    fn veloq_tile_free(bytes: *mut u8, len: usize);
}

/// The tiles directory the handler reads is process-wide, so these run one at
/// a time: two of them setting it at once would read each other's answer.
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

/// Ask the way the handler asks, and give the bytes back the way it does.
fn ask(source: Option<&str>, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    let source = source.map(|s| CString::new(s).unwrap());
    let ptr = source.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    let mut len = usize::MAX;
    let bytes = unsafe { veloq_tile_get_or_fetch(ptr, z, x, y, &mut len) };
    if bytes.is_null() {
        assert_eq!(len, 0, "a null answer carries no length");
        return None;
    }
    let copy = unsafe { std::slice::from_raw_parts(bytes, len) }.to_vec();
    unsafe { veloq_tile_free(bytes, len) };
    Some(copy)
}

fn heatmap_dir(dir: &TempDir) -> std::path::PathBuf {
    let mut e = engine(dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    tiles
}

#[test]
fn a_drawn_heatmap_tile_crosses_the_boundary_whole() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 2048, 1361, b"\x89PNG\r\n\x1a\n heatmap");

    assert_eq!(
        ask(Some("heatmap"), 12, 2048, 1361).as_deref(),
        Some(&b"\x89PNG\r\n\x1a\n heatmap"[..])
    );
}

#[test]
fn a_tile_the_pass_has_not_drawn_yet_is_null() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert!(ask(Some("heatmap"), 12, 1, 1).is_none());
}

#[test]
fn an_empty_marker_file_is_null_rather_than_an_empty_slice() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 5, 6, b"");

    assert!(ask(Some("heatmap"), 12, 5, 6).is_none());
}

#[test]
fn a_source_the_store_never_admitted_is_null() {
    let _serial = serial();

    assert!(ask(Some("nowhere"), 12, 1, 1).is_none());
}

#[test]
fn a_null_source_is_null() {
    let _serial = serial();

    assert!(ask(None, 12, 1, 1).is_none());
}

#[test]
fn a_zoom_beyond_a_byte_is_null_before_anything_is_read() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert!(ask(Some("heatmap"), 256, 0, 0).is_none());
}

#[test]
fn freeing_a_null_answer_is_a_no_op() {
    unsafe { veloq_tile_free(std::ptr::null_mut(), 0) };
}
