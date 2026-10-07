//! The C entry point the iOS scheme handler calls, through the symbol it links.
//!
//! iOS has no JNI: the handler is Objective-C and reaches the store through a
//! plain C symbol in the static library. These tests call it by that name, the
//! way the handler does, so a rename on either side fails here rather than at
//! link time on the macmini. The bytes cross the boundary as a leaked slice
//! and come back through the free, which is the other half of the contract.
//!
//! Run: `cargo test --test heatmap -p veloqrs -- tile_scheme_handler::`

use std::ffi::CString;
use std::fs;
use std::os::raw::c_char;
use std::sync::{Mutex, MutexGuard};

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

unsafe extern "C" {
    fn veloq_tile_get_or_fetch(
        source: *const c_char,
        z: u32,
        x: u32,
        y: u32,
        len: *mut usize,
        status: *mut u16,
    ) -> *mut u8;
    fn veloq_tile_free(bytes: *mut u8, len: usize);
    fn veloq_glyph_get_or_fetch(
        fontstack: *const c_char,
        range: *const c_char,
        len: *mut usize,
        status: *mut u16,
    ) -> *mut u8;
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
    answer(source, z, x, y).0
}

/// The bytes and the status the handler would answer the page with.
fn answer(source: Option<&str>, z: u32, x: u32, y: u32) -> (Option<Vec<u8>>, u16) {
    let source = source.map(|s| CString::new(s).unwrap());
    let ptr = source.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    let mut len = usize::MAX;
    let mut status = 0u16;
    let bytes = unsafe { veloq_tile_get_or_fetch(ptr, z, x, y, &mut len, &mut status) };
    if bytes.is_null() {
        assert_eq!(len, 0, "a null answer carries no length");
        assert_ne!(status, 200, "a null answer is never a success");
        return (None, status);
    }
    assert_eq!(status, 200);
    let copy = unsafe { std::slice::from_raw_parts(bytes, len) }.to_vec();
    unsafe { veloq_tile_free(bytes, len) };
    (Some(copy), status)
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
    let _serial_state = super::serial_state();
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
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert!(ask(Some("heatmap"), 12, 1, 1).is_none());
}

#[test]
fn an_empty_marker_file_is_null_rather_than_an_empty_slice() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 5, 6, b"");

    assert!(ask(Some("heatmap"), 12, 5, 6).is_none());
}

#[test]
fn a_source_the_store_never_admitted_is_null() {
    let _serial_state = super::serial_state();
    let _serial = serial();

    assert!(ask(Some("nowhere"), 12, 1, 1).is_none());
}

#[test]
fn a_null_source_is_null() {
    let _serial_state = super::serial_state();
    let _serial = serial();

    assert!(ask(None, 12, 1, 1).is_none());
}

#[test]
fn a_zoom_beyond_a_byte_is_null_before_anything_is_read() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert!(ask(Some("heatmap"), 256, 0, 0).is_none());
}

#[test]
fn freeing_a_null_answer_is_a_no_op() {
    let _serial_state = super::serial_state();
    unsafe { veloq_tile_free(std::ptr::null_mut(), 0) };
}

#[test]
fn a_null_status_pointer_still_answers_the_bytes() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 7, 8, b"\x89PNG\r\n\x1a\n heat");
    let source = CString::new("heatmap").unwrap();
    let mut len = 0usize;

    let bytes = unsafe {
        veloq_tile_get_or_fetch(source.as_ptr(), 12, 7, 8, &mut len, std::ptr::null_mut())
    };

    assert!(!bytes.is_null());
    unsafe { veloq_tile_free(bytes, len) };
}

// ============================================================================
// What the page is told when the tile host did not answer with a tile
// ============================================================================

/// A basemap source of this test's own, filled from `server`. Named per test:
/// the store remembers a 404 per source for the life of the process.
fn basemap_source(dir: &TempDir, name: &str, server: &MockServer) {
    veloqrs::basemap::set_path(
        dir.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
    veloqrs::basemap::set_template(name.to_string(), server.url("/{z}/{x}/{y}.pbf"));
}

fn host_answering(status: u16) -> MockServer {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(status).body("not a tile");
    });
    server
}

/// Scenario: a tile host rate-limits a feed scroll.
///
/// Expected behaviour: the page sees the 429, which is what its throttle
/// backoff counts, rather than a 404 it skips as out of coverage.
#[test]
fn a_rate_limited_tile_reaches_the_page_as_429() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    basemap_source(&dir, "throttled", &host_answering(429));

    assert_eq!(answer(Some("throttled"), 12, 2148, 1436), (None, 429));
}

#[test]
fn an_unavailable_host_reaches_the_page_as_503() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    basemap_source(&dir, "unavailable", &host_answering(503));

    assert_eq!(answer(Some("unavailable"), 12, 2148, 1436), (None, 503));
}

/// Any other upstream failure is ours to report and not a hole in coverage.
#[test]
fn any_other_upstream_error_reaches_the_page_as_a_bad_gateway() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    basemap_source(&dir, "broken", &host_answering(500));

    assert_eq!(answer(Some("broken"), 12, 2148, 1436), (None, 502));
}

#[test]
fn a_host_that_cannot_be_reached_reaches_the_page_as_a_bad_gateway() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    veloqrs::basemap::set_path(
        dir.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
    // Port 9 is discard, which nothing listens on here.
    veloqrs::basemap::set_template(
        "unreachable".to_string(),
        "http://127.0.0.1:9/{z}/{x}/{y}.pbf".to_string(),
    );

    assert_eq!(answer(Some("unreachable"), 12, 2148, 1436), (None, 502));
}

/// A real refusal stays a 404, which the page skips as out of coverage.
#[test]
fn a_tile_the_host_refuses_still_reaches_the_page_as_404() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    basemap_source(&dir, "refusing", &host_answering(404));

    assert_eq!(answer(Some("refusing"), 12, 2148, 1436), (None, 404));
    assert_eq!(
        answer(Some("refusing"), 12, 2148, 1436),
        (None, 404),
        "the remembered refusal answers the same way"
    );
}

#[test]
fn a_fetched_tile_reaches_the_page_as_200() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/12/2148/1436.pbf");
        then.status(200).body([7u8; 32]);
    });
    basemap_source(&dir, "answering", &server);

    assert_eq!(
        answer(Some("answering"), 12, 2148, 1436),
        (Some(vec![7u8; 32]), 200)
    );
}

#[test]
fn a_source_the_store_never_admitted_is_a_404() {
    let _serial_state = super::serial_state();
    let _serial = serial();

    assert_eq!(answer(Some("never-admitted"), 12, 1, 1), (None, 404));
}

#[test]
fn a_heatmap_tile_not_drawn_yet_is_a_404() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert_eq!(answer(Some("heatmap"), 12, 3, 3), (None, 404));
}

#[test]
fn a_glyph_stack_the_host_does_not_serve_is_a_404_through_the_symbol() {
    let stack = CString::new("../outside").unwrap();
    let range = CString::new("19968-20223").unwrap();
    let mut len = usize::MAX;
    let mut status = 0u16;
    let bytes =
        unsafe { veloq_glyph_get_or_fetch(stack.as_ptr(), range.as_ptr(), &mut len, &mut status) };
    assert!(bytes.is_null());
    assert_eq!(len, 0);
    assert_eq!(status, 404);
}
