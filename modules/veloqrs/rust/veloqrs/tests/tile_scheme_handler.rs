//! The C entry points the iOS scheme handler calls, through the symbols it links.
//!
//! iOS has no JNI: the handler is Objective-C and reaches the store through
//! plain C symbols in the static library. These tests call them by those
//! names, the way the handler does, so a rename on either side fails here
//! rather than at link time on the Mac build host. The bytes cross the boundary as a
//! leaked slice and come back through the free, which is the other half of the
//! contract.
//!
//! Run: `cargo test --test heatmap -p veloqrs -- tile_scheme_handler::`

use std::ffi::{CString, c_void};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::raw::c_char;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

type TileDone = unsafe extern "C" fn(context: *mut c_void, bytes: *mut u8, len: usize, status: u16);

unsafe extern "C" {
    fn veloq_tile_answer(
        source: *const c_char,
        z: u32,
        x: u32,
        y: u32,
        context: *mut c_void,
        done: Option<TileDone>,
    );
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

type Answer = (Option<Vec<u8>>, u16);

/// What the handler's callback does: take the bytes, give them back through
/// the free, and pass the answer on. The context is the sender `ask_async`
/// leaked, and it is reclaimed here because the callback runs exactly once.
unsafe extern "C" fn deliver(context: *mut c_void, bytes: *mut u8, len: usize, status: u16) {
    let reply = unsafe { Box::from_raw(context as *mut mpsc::Sender<Answer>) };
    let answer = if bytes.is_null() {
        assert_eq!(len, 0, "a null answer carries no length");
        assert_ne!(status, 200, "a null answer is never a success");
        (None, status)
    } else {
        assert_eq!(status, 200);
        let copy = unsafe { std::slice::from_raw_parts(bytes, len) }.to_vec();
        unsafe { veloq_tile_free(bytes, len) };
        (Some(copy), status)
    };
    let _ = reply.send(answer);
}

/// Ask the way the handler asks, with the answer arriving on `reply`.
fn ask_async(source: Option<&str>, z: u32, x: u32, y: u32, reply: mpsc::Sender<Answer>) {
    let source = source.map(|s| CString::new(s).unwrap());
    let ptr = source.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    let context = Box::into_raw(Box::new(reply)) as *mut c_void;
    unsafe { veloq_tile_answer(ptr, z, x, y, context, Some(deliver)) };
}

/// Ask the way the handler asks, and give the bytes back the way it does.
fn ask(source: Option<&str>, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    answer(source, z, x, y).0
}

/// The bytes and the status the handler would answer the page with.
fn answer(source: Option<&str>, z: u32, x: u32, y: u32) -> Answer {
    let (tx, rx) = mpsc::channel();
    ask_async(source, z, x, y, tx);
    rx.recv_timeout(Duration::from_secs(30))
        .expect("every ask is answered exactly once")
}

fn heatmap_dir(dir: &TempDir) -> std::path::PathBuf {
    let mut e = engine(dir);
    let tiles = dir.path().join("heatmap-tiles");
    fs::create_dir_all(&tiles).unwrap();
    e.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    tiles
}

/// A tile as the pass draws it, from one ride across the middle of it.
fn drawn_tile(z: u8, x: u32, y: u32) -> Vec<u8> {
    use veloqrs::tiles::{tile_x_to_lon, tile_y_to_lat};
    let lat = tile_y_to_lat(f64::from(y) + 0.5, z);
    let ride: Vec<veloqrs::GpsPoint> = (0..=20)
        .map(|i| {
            let lon = tile_x_to_lon(f64::from(x) + 0.1 + 0.04 * f64::from(i), z);
            veloqrs::GpsPoint::new(lat, lon)
        })
        .collect();
    veloqrs::tiles::generate_heatmap_tile(z, x, y, &[ride]).expect("the ride draws heat")
}

/// Scenario: the page asks one heatmap tile for each base map.
///
/// Expected behaviour: each answer is the stored tile in that base's palette.
#[test]
fn a_drawn_heatmap_tile_crosses_the_boundary_in_the_asking_base_palette() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    let stored = drawn_tile(12, 2048, 1361);
    write_tile(&tiles, 12, 2048, 1361, &stored);

    for base in veloqrs::tiles::HeatmapBase::ALL {
        let source = format!("heatmap-{}", base.name());
        assert_eq!(
            ask(Some(&source), 12, 2048, 1361),
            veloqrs::tiles::tile_for_base(&stored, base),
            "{source}"
        );
    }
}

#[test]
fn a_heatmap_source_naming_no_base_is_a_404() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 2048, 1361, &drawn_tile(12, 2048, 1361));

    for source in ["heatmap", "heatmap-", "heatmap-sepia"] {
        assert_eq!(
            answer(Some(source), 12, 2048, 1361),
            (None, 404),
            "{source}"
        );
    }
}

#[test]
fn a_stored_heatmap_tile_that_is_not_a_png_is_a_404() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 2048, 1361, b"\x89PNG\r\n\x1a\n heatmap");

    assert_eq!(answer(Some("heatmap-light"), 12, 2048, 1361), (None, 404));
}

#[test]
fn a_tile_the_pass_has_not_drawn_yet_is_null() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    heatmap_dir(&dir);

    assert!(ask(Some("heatmap-dark"), 12, 1, 1).is_none());
}

#[test]
fn an_empty_marker_file_is_null_rather_than_an_empty_slice() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let tiles = heatmap_dir(&dir);
    write_tile(&tiles, 12, 5, 6, b"");

    assert!(ask(Some("heatmap-dark"), 12, 5, 6).is_none());
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

    assert!(ask(Some("heatmap-dark"), 256, 0, 0).is_none());
}

#[test]
fn freeing_a_null_answer_is_a_no_op() {
    let _serial_state = super::serial_state();
    unsafe { veloq_tile_free(std::ptr::null_mut(), 0) };
}

/// A handler that wants no answer must not have a null pointer called.
#[test]
fn a_null_callback_is_never_called() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let source = CString::new("nowhere").unwrap();

    unsafe { veloq_tile_answer(source.as_ptr(), 12, 1, 1, std::ptr::null_mut(), None) };
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

    assert_eq!(answer(Some("heatmap-satellite"), 12, 3, 3), (None, 404));
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

// ============================================================================
// A miss holds no caller thread
// ============================================================================

/// A tile host that takes every request and answers none of them until it is
/// released, counting what reached it.
struct HeldHost {
    url: String,
    seen: Arc<AtomicUsize>,
    gate: Arc<(Mutex<bool>, Condvar)>,
}

impl HeldHost {
    fn start(body: &'static [u8]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (seen_in, gate_in) = (Arc::clone(&seen), Arc::clone(&gate));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let (seen, gate) = (Arc::clone(&seen_in), Arc::clone(&gate_in));
                std::thread::spawn(move || {
                    let mut request = Vec::new();
                    let mut chunk = [0u8; 1024];
                    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                        match stream.read(&mut chunk) {
                            Ok(0) | Err(_) => return,
                            Ok(n) => request.extend_from_slice(&chunk[..n]),
                        }
                    }
                    seen.fetch_add(1, Ordering::SeqCst);
                    let (open, wake) = &*gate;
                    let mut open = open.lock().unwrap();
                    while !*open {
                        open = wake.wait(open).unwrap();
                    }
                    drop(open);
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(body);
                });
            }
        });
        Self { url, seen, gate }
    }

    fn release(&self) {
        let (open, wake) = &*self.gate;
        *open.lock().unwrap() = true;
        wake.notify_all();
    }
}

impl Drop for HeldHost {
    fn drop(&mut self) {
        self.release();
    }
}

/// Scenario: a fast pan over new ground on a slow network asks for several
/// dozen tiles the store does not hold, and the host is slow to answer any of
/// them.
///
/// Expected behaviour: every ask returns to its caller before the host has
/// answered, all of the misses are on the wire at once, and each is answered
/// once the host speaks. A miss that held its caller would leave one blocked
/// handler thread per tile, which on iOS is a thread taken from the global
/// queues for as long as the host takes.
#[test]
fn sixty_four_misses_on_a_silent_host_return_to_their_callers_at_once() {
    const MISSES: u32 = 64;
    let _serial_state = super::serial_state();
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let host = HeldHost::start(b"held-tile");
    veloqrs::basemap::set_path(
        dir.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
    veloqrs::basemap::set_template(
        "held".to_string(),
        format!("{}/{{z}}/{{x}}/{{y}}.pbf", host.url),
    );

    let (answers, answered) = mpsc::channel();
    let (returned, all_returned) = mpsc::channel();
    std::thread::spawn(move || {
        for x in 0..MISSES {
            ask_async(Some("held"), 14, 9000 + x, 6000, answers.clone());
        }
        let _ = returned.send(());
    });

    if all_returned.recv_timeout(Duration::from_secs(10)).is_err() {
        host.release();
        panic!("an ask held its caller while the host was silent");
    }
    for _ in 0..1000 {
        if host.seen.load(Ordering::SeqCst) == MISSES as usize {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        host.seen.load(Ordering::SeqCst),
        MISSES as usize,
        "every miss is on the wire at once"
    );
    assert!(
        answered.try_recv().is_err(),
        "nothing is answered before the host speaks"
    );

    host.release();
    for _ in 0..MISSES {
        let answer = answered
            .recv_timeout(Duration::from_secs(30))
            .expect("every miss is answered once the host speaks");
        assert_eq!(answer, (Some(b"held-tile".to_vec()), 200));
    }
}
