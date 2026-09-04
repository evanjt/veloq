//! The Rust-owned basemap tile store: one `<source>/<z>/<x>/<y>.<ext>` tree
//! that Rust can enumerate, size, evict from and pre-seed.
//!
//! Scenario: the basemap bytes used to live in three per-origin Cache API
//! buckets inside the map page, so nothing outside the WebView could see them.
//! Expected behaviour: every one of those questions is answerable from Rust
//! with the radio off, the pre-seeded base is the last thing evicted, and a
//! killed write leaves neither a truncated tile nor an unreadable index.

use std::time::Duration;

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::basemap::{TileFetchError, TileFetcher, TileStore};

const SATELLITE: &str = "satellite";
const VECTOR: &str = "vector";
const DEM: &str = "terrain-dem";

fn store() -> (TileStore, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    (TileStore::new(tmp.path().join("basemap-tiles")), tmp)
}

fn bytes(n: usize, fill: u8) -> Vec<u8> {
    vec![fill; n]
}

// ============================================================================
// The tree
// ============================================================================

#[test]
fn a_stored_tile_reads_back_byte_for_byte() {
    let (store, _tmp) = store();
    let tile = bytes(64, 7);

    store
        .put(SATELLITE, 12, 2048, 1362, "jpg", &tile, false)
        .expect("put");

    assert_eq!(store.get(SATELLITE, 12, 2048, 1362), Some(tile));
}

#[test]
fn a_tile_that_was_never_stored_reads_as_absent() {
    let (store, _tmp) = store();

    assert_eq!(store.get(SATELLITE, 12, 2048, 1362), None);
    assert_eq!(store.size(), 0, "an empty store costs nothing");
}

#[test]
fn the_three_sources_share_one_tree_without_colliding() {
    let (store, _tmp) = store();
    store
        .put(SATELLITE, 10, 1, 2, "jpg", &bytes(10, 1), false)
        .expect("put");
    store
        .put(VECTOR, 10, 1, 2, "pbf", &bytes(20, 2), false)
        .expect("put");
    store
        .put(DEM, 10, 1, 2, "png", &bytes(30, 3), false)
        .expect("put");

    assert_eq!(store.get(SATELLITE, 10, 1, 2), Some(bytes(10, 1)));
    assert_eq!(store.get(VECTOR, 10, 1, 2), Some(bytes(20, 2)));
    assert_eq!(store.get(DEM, 10, 1, 2), Some(bytes(30, 3)));

    assert_eq!(store.size_of(SATELLITE), 10);
    assert_eq!(store.size_of(VECTOR), 20);
    assert_eq!(store.size_of(DEM), 30);
    assert_eq!(store.size(), 60, "the total is every source, not just one");
}

#[test]
fn storing_the_same_key_twice_replaces_rather_than_accumulates() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 1, 1, "pbf", &bytes(100, 1), false)
        .expect("first put");
    store
        .put(VECTOR, 5, 1, 1, "pbf", &bytes(40, 2), false)
        .expect("second put");

    assert_eq!(store.get(VECTOR, 5, 1, 1), Some(bytes(40, 2)));
    assert_eq!(
        store.size_of(VECTOR),
        40,
        "the replaced bytes are not counted twice"
    );
}

#[test]
fn a_put_leaves_no_temporary_file_behind() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 1, 1, "pbf", &bytes(100, 1), false)
        .expect("put");
    store.flush().expect("flush");

    let leftovers = walk(store.root());
    let temps: Vec<&String> = leftovers.iter().filter(|p| p.ends_with(".tmp")).collect();
    assert!(temps.is_empty(), "temp files survived a put: {:?}", temps);
    assert_eq!(
        leftovers.len(),
        2,
        "one tile and one sidecar, nothing else: {:?}",
        leftovers
    );
}

// ============================================================================
// Size
// ============================================================================

#[test]
fn size_is_answerable_with_no_webview_and_no_network() {
    let (store, _tmp) = store();
    store
        .put(SATELLITE, 8, 3, 4, "jpg", &bytes(1024, 1), false)
        .expect("put");
    store
        .put(SATELLITE, 8, 3, 5, "jpg", &bytes(2048, 1), false)
        .expect("put");

    assert_eq!(store.size(), 3072);
}

#[test]
fn size_of_a_source_that_holds_nothing_is_zero_not_an_error() {
    let (store, _tmp) = store();
    store
        .put(SATELLITE, 8, 3, 4, "jpg", &bytes(16, 1), false)
        .expect("put");

    assert_eq!(store.size_of(VECTOR), 0);
}

// ============================================================================
// Eviction
// ============================================================================

#[test]
fn eviction_takes_the_least_recently_read_tile_first() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put a");
    store
        .put(VECTOR, 5, 0, 1, "pbf", &bytes(100, 2), false)
        .expect("put b");
    store
        .put(VECTOR, 5, 0, 2, "pbf", &bytes(100, 3), false)
        .expect("put c");

    // The home area is read again, so it is no longer the oldest set.
    assert!(store.get(VECTOR, 5, 0, 0).is_some());

    let removed = store.evict_to(VECTOR, 200).expect("evict");

    assert_eq!(removed, 1);
    assert_eq!(store.size_of(VECTOR), 200);
    assert!(
        store.get(VECTOR, 5, 0, 1).is_none(),
        "the unread tile goes first"
    );
    assert!(
        store.get(VECTOR, 5, 0, 0).is_some(),
        "the re-read tile stays"
    );
    assert!(store.get(VECTOR, 5, 0, 2).is_some());
}

#[test]
fn eviction_scrubs_every_opportunistic_tile_before_it_touches_the_pre_seed() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("pinned put");
    store
        .put(VECTOR, 5, 0, 1, "pbf", &bytes(100, 2), false)
        .expect("put b");
    store
        .put(VECTOR, 5, 0, 2, "pbf", &bytes(100, 3), false)
        .expect("put c");

    // The pinned tile is the oldest by read order, so only pinning can save it.
    let removed = store.evict_to(VECTOR, 100).expect("evict");

    assert_eq!(removed, 2);
    assert!(
        store.get(VECTOR, 2, 0, 0).is_some(),
        "the pre-seed outlives both"
    );
    assert!(store.get(VECTOR, 5, 0, 1).is_none());
    assert!(store.get(VECTOR, 5, 0, 2).is_none());
}

#[test]
fn the_budget_is_a_hard_cap_so_a_pinned_tile_goes_once_nothing_else_is_left() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("pinned put");
    store
        .put(VECTOR, 2, 0, 1, "pbf", &bytes(100, 2), true)
        .expect("pinned put");
    store
        .put(VECTOR, 5, 0, 2, "pbf", &bytes(100, 3), false)
        .expect("put c");

    let removed = store.evict_to(VECTOR, 100).expect("evict");

    assert_eq!(removed, 2);
    assert_eq!(
        store.size_of(VECTOR),
        100,
        "the store never runs the user out of storage"
    );
    assert!(
        store.get(VECTOR, 5, 0, 2).is_none(),
        "the opportunistic tile goes first"
    );
    assert!(
        store.get(VECTOR, 2, 0, 0).is_none(),
        "the older pinned tile goes second"
    );
    assert!(
        store.get(VECTOR, 2, 0, 1).is_some(),
        "the newest pinned tile is the last to go"
    );
}

#[test]
fn eviction_only_spends_the_budget_of_the_source_it_was_given() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(300, 1), false)
        .expect("put");
    store
        .put(SATELLITE, 5, 0, 0, "jpg", &bytes(300, 2), false)
        .expect("put");

    store.evict_to(VECTOR, 0).expect("evict");

    assert_eq!(store.size_of(VECTOR), 0);
    assert_eq!(
        store.size_of(SATELLITE),
        300,
        "satellite keeps its own budget"
    );
}

#[test]
fn evicting_a_store_already_under_budget_removes_nothing() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put");

    assert_eq!(store.evict_to(VECTOR, 1_000).expect("evict"), 0);
    assert_eq!(store.evict_to(DEM, 0).expect("evict an empty source"), 0);
    assert_eq!(store.size_of(VECTOR), 100);
}

// ============================================================================
// Clear
// ============================================================================

#[test]
fn clear_empties_every_source_including_the_pinned_pre_seed() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("put");
    store
        .put(SATELLITE, 5, 0, 0, "jpg", &bytes(100, 2), false)
        .expect("put");

    let removed = store.clear().expect("clear");

    assert_eq!(removed, 2);
    assert_eq!(store.size(), 0);
    assert!(store.get(VECTOR, 2, 0, 0).is_none());
    assert!(store.get(SATELLITE, 5, 0, 0).is_none());
}

#[test]
fn clearing_one_source_leaves_the_others_standing() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put");
    store
        .put(SATELLITE, 5, 0, 0, "jpg", &bytes(100, 2), false)
        .expect("put");

    assert_eq!(store.clear_source(VECTOR).expect("clear"), 1);

    assert_eq!(store.size_of(VECTOR), 0);
    assert_eq!(store.size_of(SATELLITE), 100);
}

#[test]
fn clearing_an_empty_store_is_not_an_error() {
    let (store, _tmp) = store();

    assert_eq!(store.clear().expect("clear"), 0);
}

// ============================================================================
// Surviving a partial write
// ============================================================================

#[test]
fn a_truncated_index_is_rebuilt_from_the_tree_rather_than_read_as_empty() {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join("basemap-tiles");
    {
        let store = TileStore::new(&root);
        store
            .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
            .expect("put");
        store
            .put(VECTOR, 5, 0, 1, "pbf", &bytes(200, 2), false)
            .expect("put");
        store.flush().expect("flush");
    }

    let index = root.join(VECTOR).join("index.json");
    assert!(
        index.exists(),
        "the sidecar index is written beside the tree"
    );
    std::fs::write(&index, b"{\"version\":1,\"entr").expect("truncate the index");

    let reopened = TileStore::new(&root);

    assert_eq!(
        reopened.size_of(VECTOR),
        300,
        "the bytes on disk are still counted"
    );
    assert_eq!(reopened.get(VECTOR, 5, 0, 0), Some(bytes(100, 1)));
    assert_eq!(
        reopened.evict_to(VECTOR, 0).expect("evict"),
        2,
        "and are still evictable"
    );
}

#[test]
fn a_missing_index_is_rebuilt_from_the_tree() {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join("basemap-tiles");
    {
        let store = TileStore::new(&root);
        store
            .put(DEM, 9, 4, 5, "png", &bytes(512, 9), false)
            .expect("put");
        store.flush().expect("flush");
    }
    std::fs::remove_file(root.join(DEM).join("index.json")).expect("remove index");

    let reopened = TileStore::new(&root);

    assert_eq!(reopened.size_of(DEM), 512);
    assert_eq!(reopened.get(DEM, 9, 4, 5), Some(bytes(512, 9)));
}

#[test]
fn a_pinned_tile_reaches_the_sidecar_before_the_put_returns() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("put");

    // Read the sidecar off disk rather than through the store: nothing in a
    // plain tree records pinning, so a kill before the next flush would demote
    // the pre-seed and evict it ahead of everything it was meant to outlive.
    let sidecar = std::fs::read_to_string(store.root().join(VECTOR).join("index.json"))
        .expect("the sidecar is on disk already");

    assert!(
        sidecar.contains("\"2/0/0\""),
        "the pinned tile is missing: {}",
        sidecar
    );
    assert!(
        sidecar.contains("\"pinned\":true"),
        "the pin is missing: {}",
        sidecar
    );
}

#[test]
fn the_read_order_survives_a_reopen() {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join("basemap-tiles");
    {
        let store = TileStore::new(&root);
        store
            .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
            .expect("put a");
        store
            .put(VECTOR, 5, 0, 1, "pbf", &bytes(100, 2), false)
            .expect("put b");
        assert!(store.get(VECTOR, 5, 0, 0).is_some(), "a is read again");
        store.flush().expect("flush");
    }

    let reopened = TileStore::new(&root);
    reopened.evict_to(VECTOR, 100).expect("evict");

    assert!(
        reopened.get(VECTOR, 5, 0, 0).is_some(),
        "the re-read tile survives the restart"
    );
    assert!(reopened.get(VECTOR, 5, 0, 1).is_none());
}

// ============================================================================
// Fetching, on its own client and its own pace
// ============================================================================

#[test]
fn a_fetched_tile_lands_under_its_key_and_is_readable_offline() {
    let server = MockServer::start();
    let tile = server.mock(|when, then| {
        when.method(GET).path("/12/2048/1362.pbf");
        then.status(200).body(bytes(256, 4));
    });
    let (store, _tmp) = store();
    let fetcher = TileFetcher::new(Duration::from_millis(0)).expect("fetcher");

    let stored = veloqrs::runtime::block_on(fetcher.fetch_into(
        &store,
        VECTOR,
        12,
        2048,
        1362,
        "pbf",
        &server.url("/12/2048/1362.pbf"),
        false,
    ))
    .expect("fetch");

    tile.assert();
    assert_eq!(stored, 256);
    assert_eq!(store.get(VECTOR, 12, 2048, 1362), Some(bytes(256, 4)));
}

#[test]
fn a_rejected_fetch_stores_nothing_at_all() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/12/2048/1362.pbf");
        then.status(404).body("no tile");
    });
    let (store, _tmp) = store();
    let fetcher = TileFetcher::new(Duration::from_millis(0)).expect("fetcher");

    let outcome = veloqrs::runtime::block_on(fetcher.fetch_into(
        &store,
        VECTOR,
        12,
        2048,
        1362,
        "pbf",
        &server.url("/12/2048/1362.pbf"),
        false,
    ));

    assert!(matches!(
        outcome,
        Err(TileFetchError::Rejected { status: 404 })
    ));
    assert_eq!(store.get(VECTOR, 12, 2048, 1362), None);
    assert_eq!(store.size(), 0, "a 404 body is not a tile");
}

#[test]
fn an_empty_response_is_not_stored_as_a_tile() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/1/0/0.pbf");
        then.status(200).body("");
    });
    let (store, _tmp) = store();
    let fetcher = TileFetcher::new(Duration::from_millis(0)).expect("fetcher");

    let outcome = veloqrs::runtime::block_on(fetcher.fetch_into(
        &store,
        VECTOR,
        1,
        0,
        0,
        "pbf",
        &server.url("/1/0/0.pbf"),
        false,
    ));

    assert!(matches!(outcome, Err(TileFetchError::Empty)));
    assert_eq!(store.size(), 0);
}

#[test]
fn a_fetch_that_cannot_reach_the_host_leaves_the_store_untouched() {
    let (store, _tmp) = store();
    let fetcher = TileFetcher::new(Duration::from_millis(0)).expect("fetcher");

    let outcome = veloqrs::runtime::block_on(fetcher.fetch_into(
        &store,
        VECTOR,
        1,
        0,
        0,
        "pbf",
        "http://127.0.0.1:1/1/0/0.pbf",
        false,
    ));

    assert!(matches!(outcome, Err(TileFetchError::Unreachable(_))));
    assert_eq!(store.size(), 0);
}

#[test]
fn tile_requests_keep_their_own_pace_rather_than_the_intervals_icu_budget() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path_contains("/tile");
        then.status(200).body(bytes(8, 1));
    });
    let pace = Duration::from_millis(120);
    let fetcher = TileFetcher::new(pace).expect("fetcher");
    let url = server.url("/tile.png");

    let started = std::time::Instant::now();
    veloqrs::runtime::block_on(async {
        for _ in 0..3 {
            fetcher.fetch(&url).await.expect("fetch");
        }
    });
    let elapsed = started.elapsed();

    // Three requests at one every 120ms: the first goes immediately, so two
    // paced gaps have to have elapsed.
    assert!(
        elapsed >= pace * 2,
        "three tile requests finished in {:?}, faster than the tile pace allows",
        elapsed
    );
}

#[test]
fn the_tile_fetcher_never_carries_an_intervals_icu_credential() {
    let server = MockServer::start();
    let unauthenticated = server.mock(|when, then| {
        when.method(GET).path("/1/0/0.png").matches(|req| {
            !req.headers
                .as_ref()
                .map(|h| {
                    h.iter()
                        .any(|(k, _)| k.eq_ignore_ascii_case("authorization"))
                })
                .unwrap_or(false)
        });
        then.status(200).body(bytes(8, 1));
    });
    let fetcher = TileFetcher::new(Duration::from_millis(0)).expect("fetcher");

    veloqrs::runtime::block_on(fetcher.fetch(&server.url("/1/0/0.png"))).expect("fetch");

    unauthenticated.assert();
}

// ============================================================================

fn walk(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path.to_string_lossy().to_string());
        }
    }
    out
}
