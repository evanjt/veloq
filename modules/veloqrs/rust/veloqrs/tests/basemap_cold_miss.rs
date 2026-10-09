//! Scenario: a pan over new ground asks for two dozen tiles the store does not
//! hold. The WebView's interceptor runs on a small fixed pool, so a miss that
//! holds its thread for the whole upstream fetch puts the pan's misses on the
//! wire a few at a time.
//!
//! Expected behaviour: the store answers a miss at once and the fetch runs on
//! the engine's own runtime, completing later. A host that answers 429 or 503
//! fails that one tile, and every miss for its source in the next few seconds
//! is answered with the same status without asking it again, so the page's
//! throttle backoff still sees the refusal.

use httpmock::prelude::*;
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;
use veloqrs::basemap::{TileLookup, fetch_tile, lookup_tile, set_path, set_template};

fn store_at(tmp: &TempDir) {
    set_path(
        tmp.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
}

fn spawn_and_wait(lookup: TileLookup) -> Result<Vec<u8>, u16> {
    let TileLookup::Miss(miss) = lookup else {
        panic!("expected a miss to fetch");
    };
    let (tx, rx) = mpsc::channel();
    miss.spawn(move |result| {
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_secs(10))
        .expect("a spawned miss always completes")
}

#[test]
fn a_miss_is_answered_before_the_host_is_asked_and_kept_once_fetched() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let tile = host.mock(|when, then| {
        when.method(GET).path("/14/8000/5000.pbf");
        then.status(200).body("tile-bytes");
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("cold-vector".to_string(), host.url("/{z}/{x}/{y}.pbf"));

    let lookup = lookup_tile("cold-vector", 14, 8000, 5000);
    assert!(matches!(lookup, TileLookup::Miss(_)));
    tile.assert_hits(0);

    assert_eq!(spawn_and_wait(lookup), Ok(b"tile-bytes".to_vec()));
    tile.assert_hits(1);

    match lookup_tile("cold-vector", 14, 8000, 5000) {
        TileLookup::Ready(bytes) => assert_eq!(bytes, b"tile-bytes"),
        _ => panic!("a fetched tile is kept and served from the store"),
    }
    tile.assert_hits(1);
}

#[test]
fn a_host_that_answered_429_is_not_asked_again_inside_the_hold() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let busy = host.mock(|when, then| {
        when.method(GET)
            .path_matches(Regex::new(r"^/\d+/\d+/\d+\.pbf$").unwrap());
        then.status(429);
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("busy-vector".to_string(), host.url("/{z}/{x}/{y}.pbf"));

    assert_eq!(fetch_tile("busy-vector", 14, 8000, 5000), Err(429));
    busy.assert_hits(1);

    // A neighbour, which is the rest of the same pan.
    assert_eq!(fetch_tile("busy-vector", 14, 8001, 5000), Err(429));
    busy.assert_hits(1);
}

#[test]
fn a_spawned_miss_refused_with_503_holds_the_next_miss_with_503() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let down = host.mock(|when, then| {
        when.method(GET)
            .path_matches(Regex::new(r"^/\d+/\d+/\d+\.jpg$").unwrap());
        then.status(503);
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("down-imagery".to_string(), host.url("/{z}/{x}/{y}.jpg"));

    assert_eq!(
        spawn_and_wait(lookup_tile("down-imagery", 14, 8000, 5000)),
        Err(503)
    );
    assert!(matches!(
        lookup_tile("down-imagery", 14, 8001, 5000),
        TileLookup::Refused(503)
    ));
    down.assert_hits(1);
}

#[test]
fn a_host_that_failed_otherwise_is_asked_again() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let failing = host.mock(|when, then| {
        when.method(GET)
            .path_matches(Regex::new(r"^/\d+/\d+/\d+\.pbf$").unwrap());
        then.status(500);
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("flaky-vector".to_string(), host.url("/{z}/{x}/{y}.pbf"));

    assert_eq!(
        spawn_and_wait(lookup_tile("flaky-vector", 14, 8000, 5000)),
        Err(502)
    );
    assert!(matches!(
        lookup_tile("flaky-vector", 14, 8001, 5000),
        TileLookup::Miss(_)
    ));
    failing.assert_hits(1);
}
