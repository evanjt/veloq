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
    tile.assert_calls(0);

    assert_eq!(spawn_and_wait(lookup), Ok(b"tile-bytes".to_vec()));
    tile.assert_calls(1);

    match lookup_tile("cold-vector", 14, 8000, 5000) {
        TileLookup::Ready(bytes) => assert_eq!(bytes, b"tile-bytes"),
        _ => panic!("a fetched tile is kept and served from the store"),
    }
    tile.assert_calls(1);
}

#[test]
fn a_host_that_answered_429_is_not_asked_again_inside_the_hold() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let busy = host.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.pbf$");
        then.status(429);
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("busy-vector".to_string(), host.url("/{z}/{x}/{y}.pbf"));

    assert_eq!(fetch_tile("busy-vector", 14, 8000, 5000), Err(429));
    busy.assert_calls(1);

    // A neighbour, which is the rest of the same pan.
    assert_eq!(fetch_tile("busy-vector", 14, 8001, 5000), Err(429));
    busy.assert_calls(1);
}

#[test]
fn a_spawned_miss_refused_with_503_holds_the_next_miss_with_503() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let down = host.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.jpg$");
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
    down.assert_calls(1);
}

#[test]
fn a_host_that_failed_otherwise_is_asked_again() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let failing = host.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.pbf$");
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
    failing.assert_calls(1);
}

/// Every miss in `lookups`, spawned at once, and their answers in order.
fn spawn_all(lookups: Vec<TileLookup>) -> Vec<Result<Vec<u8>, u16>> {
    let (tx, rx) = mpsc::channel();
    let count = lookups.len();
    for (i, lookup) in lookups.into_iter().enumerate() {
        match lookup {
            TileLookup::Miss(miss) => {
                let tx = tx.clone();
                miss.spawn(move |result| {
                    let _ = tx.send((i, result));
                });
            }
            TileLookup::Refused(status) => {
                let _ = tx.send((i, Err(status)));
            }
            TileLookup::Ready(bytes) => {
                let _ = tx.send((i, Ok(bytes)));
            }
        }
    }
    let mut answers: Vec<Option<Result<Vec<u8>, u16>>> = vec![None; count];
    for _ in 0..count {
        let (i, result) = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("every miss completes");
        answers[i] = Some(result);
    }
    answers.into_iter().map(Option::unwrap).collect()
}

/// Scenario: a fresh install pans over new ground on a source that names a
/// TileJSON, with no template resolved yet.
///
/// Expected behaviour: no lookup asks any host, so the interceptor thread is
/// never held. The misses resolve the TileJSON once between them on the
/// engine's runtime, and every one of them is then filled.
#[test]
fn a_pan_with_no_template_held_resolves_the_tilejson_once_off_the_lookup() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let tilejson = host.mock(|when, then| {
        when.method(GET).path("/planet");
        then.status(200).body(format!(
            r#"{{"tiles":["{}"]}}"#,
            host.url("/run-1/{z}/{x}/{y}.pbf")
        ));
    });
    let tiles = host.mock(|when, then| {
        when.method(GET).path_matches(r"^/run-1/\d+/\d+/\d+\.pbf$");
        then.status(200).body("tile-bytes");
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    veloqrs::basemap::forget_resolved_templates();
    set_template("fresh-vector".to_string(), host.url("/planet"));

    let lookups: Vec<_> = (0..12)
        .map(|i| lookup_tile("fresh-vector", 14, 8000 + i, 5000))
        .collect();
    tilejson.assert_calls(0);

    for answer in spawn_all(lookups) {
        assert_eq!(answer, Ok(b"tile-bytes".to_vec()));
    }
    tilejson.assert_calls(1);
    tiles.assert_calls(12);
}

/// Scenario: the same pan with the TileJSON host failing.
///
/// Expected behaviour: the TileJSON is asked for once, and every miss is
/// answered 502 without another request.
#[test]
fn a_pan_with_no_template_held_and_the_tilejson_down_asks_once() {
    let _serial = super::serial_state();
    let host = MockServer::start();
    let tilejson = host.mock(|when, then| {
        when.method(GET).path("/planet");
        then.status(502);
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    veloqrs::basemap::forget_resolved_templates();
    set_template("dark-vector".to_string(), host.url("/planet"));

    let first = spawn_all(vec![lookup_tile("dark-vector", 14, 8000, 5000)]);
    assert_eq!(first, vec![Err(502)]);

    let rest: Vec<_> = (1..20)
        .map(|i| lookup_tile("dark-vector", 14, 8000 + i, 5000))
        .collect();
    for answer in spawn_all(rest) {
        assert_eq!(answer, Err(502));
    }
    tilejson.assert_calls(1);
}

/// Both platforms read tiles through the lookup, the fetched miss and the hit
/// after it alike, and a tile handed to the map still compressed renders
/// blank.
#[test]
fn a_tile_the_host_gzipped_reaches_the_page_decoded_on_the_miss_and_the_hit() {
    use std::io::Write;
    let _serial = super::serial_state();
    let tile = b"\x1avector-tile-layers-vector-tile-layers-vector-tile-layers".to_vec();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&tile).expect("gzip");
    let sent = encoder.finish().expect("gzip");
    let host = MockServer::start();
    host.mock(|when, then| {
        when.method(GET).path("/14/8000/5000.pbf");
        then.status(200)
            .header("content-encoding", "gzip")
            .body(sent.clone());
    });
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    set_template("gzip-vector".to_string(), host.url("/{z}/{x}/{y}.pbf"));

    assert_eq!(
        spawn_and_wait(lookup_tile("gzip-vector", 14, 8000, 5000)),
        Ok(tile.clone())
    );
    match lookup_tile("gzip-vector", 14, 8000, 5000) {
        TileLookup::Ready(bytes) => assert_eq!(bytes, tile),
        _ => panic!("a fetched tile is kept and served from the store"),
    }
    assert_eq!(
        veloqrs::basemap::store()
            .expect("store")
            .size_of("gzip-vector"),
        sent.len() as u64
    );
}
