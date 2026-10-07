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

const GROUND: &str = "ground";
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
        .put(GROUND, 12, 2048, 1362, "jpg", &tile, false)
        .expect("put");

    assert_eq!(store.get(GROUND, 12, 2048, 1362), Some(tile));
}

#[test]
fn a_tile_that_was_never_stored_reads_as_absent() {
    let (store, _tmp) = store();

    assert_eq!(store.get(GROUND, 12, 2048, 1362), None);
    assert_eq!(store.size(), 0, "an empty store costs nothing");
}

#[test]
fn the_three_sources_share_one_tree_without_colliding() {
    let (store, _tmp) = store();
    store
        .put(GROUND, 10, 1, 2, "jpg", &bytes(10, 1), false)
        .expect("put");
    store
        .put(VECTOR, 10, 1, 2, "pbf", &bytes(20, 2), false)
        .expect("put");
    store
        .put(DEM, 10, 1, 2, "png", &bytes(30, 3), false)
        .expect("put");

    assert_eq!(store.get(GROUND, 10, 1, 2), Some(bytes(10, 1)));
    assert_eq!(store.get(VECTOR, 10, 1, 2), Some(bytes(20, 2)));
    assert_eq!(store.get(DEM, 10, 1, 2), Some(bytes(30, 3)));

    assert_eq!(store.size_of(GROUND), 10);
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
        .put(GROUND, 8, 3, 4, "jpg", &bytes(1024, 1), false)
        .expect("put");
    store
        .put(GROUND, 8, 3, 5, "jpg", &bytes(2048, 1), false)
        .expect("put");

    assert_eq!(store.size(), 3072);
}

#[test]
fn size_of_a_source_that_holds_nothing_is_zero_not_an_error() {
    let (store, _tmp) = store();
    store
        .put(GROUND, 8, 3, 4, "jpg", &bytes(16, 1), false)
        .expect("put");

    assert_eq!(store.size_of(VECTOR), 0);
}

// ============================================================================
// Satellite imagery is held in memory only
// ============================================================================

#[test]
fn a_satellite_tile_is_served_again_from_memory_and_never_written_to_the_tree() {
    let (store, tmp) = store();
    let tile = bytes(4096, 9);

    store
        .put("satellite-eox", 12, 2048, 1362, "jpg", &tile, false)
        .expect("put reports success so a draw is never failed for it");

    assert_eq!(store.get("satellite-eox", 12, 2048, 1362), Some(tile));
    assert_eq!(
        store.size(),
        0,
        "the pool the vector basemap needs is untouched"
    );
    assert_eq!(store.size_of("satellite-eox"), 0);
    assert!(
        !tmp.path()
            .join("basemap-tiles")
            .join("satellite-eox")
            .exists(),
        "imagery never reaches the disk tree"
    );
}

#[test]
fn a_satellite_tile_never_put_is_a_miss() {
    let (store, _tmp) = store();

    assert_eq!(store.get("satellite-eox", 12, 1, 1), None);
}

#[test]
fn the_same_tile_in_another_satellite_region_is_a_different_key() {
    let (store, _tmp) = store();

    store
        .put("satellite-eox", 9, 1, 1, "jpg", &bytes(64, 1), false)
        .expect("put");

    assert_eq!(store.get("satellite-swisstopo", 9, 1, 1), None);
    assert_eq!(store.get("satellite-eox", 9, 1, 1), Some(bytes(64, 1)));
}

#[test]
fn every_regional_satellite_source_is_held_in_memory_not_on_disk() {
    let (store, _tmp) = store();

    for source in [
        "satellite",
        "satellite-eox",
        "satellite-swisstopo",
        "satellite-ign",
        "satellite-naip",
        "satellite-luxembourg",
    ] {
        store
            .put(source, 9, 1, 1, "jpg", &bytes(64, 1), false)
            .expect("put");
        assert_eq!(store.get(source, 9, 1, 1), Some(bytes(64, 1)), "{}", source);
    }

    assert_eq!(store.size(), 0);
}

#[test]
fn a_refused_satellite_put_leaves_no_file_and_no_directory_behind() {
    let (store, tmp) = store();

    store
        .put("satellite-eox", 3, 1, 2, "jpg", &bytes(32, 1), false)
        .expect("put");

    let root = tmp.path().join("basemap-tiles");
    assert!(
        !root.join("satellite-eox").exists(),
        "a refused source must not leave a tree to enumerate"
    );
}

#[test]
fn the_satellite_cache_evicts_the_least_recently_read_tile_at_its_cap() {
    let tmp = TempDir::new().expect("tempdir");
    let store = TileStore::new(tmp.path().join("basemap-tiles")).with_satellite_cache_cap(300);
    let src = "satellite-eox";

    for y in 0..3 {
        store
            .put(src, 5, 0, y, "jpg", &bytes(100, y as u8), false)
            .expect("put");
    }
    assert!(
        store.get(src, 5, 0, 0).is_some(),
        "reading y=0 refreshes it"
    );
    store
        .put(src, 5, 0, 3, "jpg", &bytes(100, 3), false)
        .expect("put");

    assert_eq!(store.get(src, 5, 0, 1), None, "least recently used went");
    assert!(store.get(src, 5, 0, 0).is_some());
    assert!(store.get(src, 5, 0, 2).is_some());
    assert!(store.get(src, 5, 0, 3).is_some());
}

#[test]
fn a_satellite_tile_larger_than_the_cap_is_not_kept_and_evicts_nothing() {
    let tmp = TempDir::new().expect("tempdir");
    let store = TileStore::new(tmp.path().join("basemap-tiles")).with_satellite_cache_cap(100);
    let src = "satellite-eox";

    store
        .put(src, 5, 0, 0, "jpg", &bytes(60, 1), false)
        .expect("put");
    store
        .put(src, 5, 0, 1, "jpg", &bytes(500, 2), false)
        .expect("put");

    assert_eq!(store.get(src, 5, 0, 1), None);
    assert!(store.get(src, 5, 0, 0).is_some());
}

#[test]
fn putting_a_satellite_key_again_replaces_it_without_double_counting_bytes() {
    let tmp = TempDir::new().expect("tempdir");
    let store = TileStore::new(tmp.path().join("basemap-tiles")).with_satellite_cache_cap(200);
    let src = "satellite-eox";

    for _ in 0..5 {
        store
            .put(src, 5, 0, 0, "jpg", &bytes(100, 1), false)
            .expect("put");
    }
    store
        .put(src, 5, 0, 1, "jpg", &bytes(100, 2), false)
        .expect("put");

    assert!(store.get(src, 5, 0, 0).is_some());
    assert!(store.get(src, 5, 0, 1).is_some());
}

#[test]
fn clearing_the_store_empties_the_satellite_cache() {
    let (store, _tmp) = store();
    store
        .put("satellite-eox", 5, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");
    store
        .put("satellite-ign", 5, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");

    store.clear().expect("clear");

    assert_eq!(store.get("satellite-eox", 5, 0, 0), None);
    assert_eq!(store.get("satellite-ign", 5, 0, 0), None);
}

#[test]
fn clearing_one_satellite_source_leaves_the_other_regions_cached() {
    let (store, _tmp) = store();
    store
        .put("satellite-eox", 5, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");
    store
        .put("satellite-ign", 5, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");

    store.clear_source("satellite-eox").expect("clear");

    assert_eq!(store.get("satellite-eox", 5, 0, 0), None);
    assert!(store.get("satellite-ign", 5, 0, 0).is_some());
}

#[test]
fn a_satellite_put_from_before_a_clear_is_not_kept() {
    let (store, _tmp) = store();
    let began = store.generation();
    store.clear().expect("clear");

    store
        .put_in_generation(began, "satellite-eox", 5, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");

    assert_eq!(store.get("satellite-eox", 5, 0, 0), None);
}

#[test]
fn a_source_whose_name_merely_contains_satellite_is_still_kept() {
    let (store, _tmp) = store();

    store
        .put(
            "vector-satellite-labels",
            9,
            1,
            1,
            "pbf",
            &bytes(48, 4),
            false,
        )
        .expect("put");

    assert_eq!(
        store.get("vector-satellite-labels", 9, 1, 1),
        Some(bytes(48, 4)),
        "the rule is the satellite source prefix, not the word anywhere in a name"
    );
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

    let removed = store.evict_to(200).expect("evict");

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
    let removed = store.evict_to(100).expect("evict");

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

    let removed = store.evict_to(100).expect("evict");

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
fn the_budget_is_one_pool_over_every_source_rather_than_a_share_each() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(300, 1), false)
        .expect("put");
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(300, 2), false)
        .expect("put");

    store.evict_to(0).expect("evict");

    assert_eq!(store.size(), 0, "one budget empties the whole tree");
    assert_eq!(store.size_of(VECTOR), 0);
    assert_eq!(store.size_of(GROUND), 0);
}

#[test]
fn one_pool_evicts_the_oldest_bytes_wherever_they_sit_and_spares_the_pre_seed() {
    let (store, _tmp) = store();
    // 60 units across three sources, the oldest read in the source that is
    // otherwise quietest, so a per-source share would have spared it.
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(10, 1), true)
        .expect("put pinned");
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(10, 2), false)
        .expect("put oldest");
    store
        .put(DEM, 5, 0, 0, "png", &bytes(25, 3), false)
        .expect("put");
    store
        .put(VECTOR, 5, 0, 1, "pbf", &bytes(15, 4), false)
        .expect("put");
    assert_eq!(store.size(), 60);

    // Everything but the lone ground tile is read again, so it is the oldest.
    assert!(store.get(DEM, 5, 0, 0).is_some());
    assert!(store.get(VECTOR, 5, 0, 1).is_some());

    let removed = store.evict_to(50).expect("evict");

    assert_eq!(removed, 1);
    assert_eq!(store.size(), 50);
    assert!(
        store.get(GROUND, 5, 0, 0).is_none(),
        "the least recently read tile goes, whichever source holds it"
    );
    assert!(
        store.get(VECTOR, 5, 0, 0).is_some(),
        "the pinned pre-seed is not touched while anything else is left"
    );
}

#[test]
fn a_read_orders_a_tile_against_reads_of_every_other_source() {
    let (store, _tmp) = store();
    // A busy source and a quiet one. The busy source has read its own tiles
    // several times, so its own stamps are high; the quiet source has one tile
    // and one read, so its own stamp is low. Ordered per source the quiet
    // tile looks like the oldest thing in the tree. It is in fact the newest.
    for y in 0..3u32 {
        store
            .put(VECTOR, 5, 0, y, "pbf", &bytes(100, 1), false)
            .expect("put");
    }
    for y in 0..3u32 {
        assert!(store.get(VECTOR, 5, 0, y).is_some());
    }
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 2), false)
        .expect("put");
    assert!(
        store.get(GROUND, 5, 0, 0).is_some(),
        "the newest read of all"
    );

    store.evict_to(300).expect("evict");

    assert!(
        store.get(GROUND, 5, 0, 0).is_some(),
        "the most recently read tile in the tree must not be the first to go"
    );
    assert_eq!(store.size_of(VECTOR), 200, "a vector tile went instead");
}

#[test]
fn evicting_a_store_already_under_budget_removes_nothing() {
    let (held, _tmp) = store();
    held.put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put");

    assert_eq!(held.evict_to(1_000).expect("evict"), 0);
    assert_eq!(held.evict_to(100).expect("evict exactly on budget"), 0);
    assert_eq!(held.size_of(VECTOR), 100);

    let (empty, _empty_tmp) = store();
    assert_eq!(empty.evict_to(0).expect("evict an empty tree"), 0);
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
        .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 2), false)
        .expect("put");

    let removed = store.clear().expect("clear");

    assert_eq!(removed, 2);
    assert_eq!(store.size(), 0);
    assert!(store.get(VECTOR, 2, 0, 0).is_none());
    assert!(store.get(GROUND, 5, 0, 0).is_none());
}

#[test]
fn clear_leaves_the_root_standing_and_the_store_writable() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("put");
    store
        .put(VECTOR, 9, 3, 4, "pbf", &bytes(100, 2), false)
        .expect("put");
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 3), false)
        .expect("put");

    store.clear().expect("clear");

    assert!(store.root().is_dir());
    assert_eq!(
        std::fs::read_dir(store.root()).expect("read root").count(),
        0
    );
    let reopened = TileStore::new(store.root());
    assert_eq!(reopened.size(), 0);
    assert!(reopened.get(VECTOR, 2, 0, 0).is_none());
    store
        .put(VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put after clear");
    assert_eq!(store.size(), 100);
}

#[test]
fn a_pre_seed_that_began_before_a_clear_writes_nothing_after_it() {
    let (store, _tmp) = store();
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 3), false)
        .expect("put");
    let began = store.generation();
    store.clear().expect("clear");

    let stored = store
        .put_in_generation(began, VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("put");

    assert!(!stored);
    assert_eq!(store.size(), 0);
    assert!(store.get(VECTOR, 2, 0, 0).is_none());
    assert_eq!(
        std::fs::read_dir(store.root()).expect("read root").count(),
        0
    );
}

#[test]
fn a_pre_seed_in_the_current_generation_stores_its_tile() {
    let (store, _tmp) = store();
    store.clear().expect("clear");
    let began = store.generation();

    let stored = store
        .put_in_generation(began, VECTOR, 2, 0, 0, "pbf", &bytes(100, 1), true)
        .expect("put");

    assert!(stored);
    assert_eq!(store.size(), 100);
}

#[test]
fn clearing_one_source_leaves_the_others_standing() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put");
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 2), false)
        .expect("put");

    assert_eq!(store.clear_source(VECTOR).expect("clear"), 1);

    assert_eq!(store.size_of(VECTOR), 0);
    assert_eq!(store.size_of(GROUND), 100);
}

#[test]
fn clearing_every_unpinned_tile_keeps_the_pre_seed_across_sources_and_a_reopen() {
    let (store, tmp) = store();
    store
        .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
        .expect("put");
    store
        .put(VECTOR, 5, 0, 1, "pbf", &bytes(40, 2), true)
        .expect("put");
    store
        .put(GROUND, 5, 0, 0, "jpg", &bytes(200, 3), false)
        .expect("put");
    store
        .put(GROUND, 5, 0, 1, "jpg", &bytes(60, 4), true)
        .expect("put");
    store
        .put(DEM, 5, 0, 0, "png", &bytes(30, 5), false)
        .expect("put");

    assert_eq!(store.clear_all_opportunistic().expect("clear"), 3);

    assert_eq!(store.size(), 100);
    assert!(store.get(VECTOR, 5, 0, 0).is_none());
    assert!(store.get(VECTOR, 5, 0, 1).is_some());
    assert!(store.get(GROUND, 5, 0, 0).is_none());
    assert!(store.get(GROUND, 5, 0, 1).is_some());
    assert!(store.get(DEM, 5, 0, 0).is_none());

    store.flush().expect("flush");
    let reopened = TileStore::new(tmp.path().join("basemap-tiles"));
    assert_eq!(reopened.size(), 100);
    assert!(reopened.get(GROUND, 5, 0, 1).is_some());
    assert!(reopened.get(GROUND, 5, 0, 0).is_none());
}

#[test]
fn clearing_every_unpinned_tile_of_an_empty_store_is_not_an_error() {
    let (store, _tmp) = store();

    assert_eq!(store.clear_all_opportunistic().expect("clear"), 0);
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
        reopened.evict_to(0).expect("evict"),
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
    reopened.evict_to(100).expect("evict");

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

// ============================================================================
// Concurrency
// ============================================================================

/// Scenario: a map pan asks for dozens of tiles at once and the native
/// transport answers each on its own WebView thread. `get` used to hold the
/// store's one mutex, which covers every source, across the file read, so
/// every one of those threads queued behind whichever read held it.
///
/// Expected behaviour: a read that cannot finish blocks nobody else. The
/// blocked read here is a FIFO that is open for writing and never written to,
/// which `std::fs::read` waits on, so this is deterministic rather than a
/// timing margin. The test knows the blocked read is under way because a
/// non-blocking open for writing is refused until a reader is waiting at the
/// other end.
#[cfg(unix)]
#[test]
fn a_read_that_blocks_forever_does_not_block_another_source() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let (store, tmp) = store();
    let store = Arc::new(store);
    store
        .put(GROUND, 1, 1, 1, "jpg", &bytes(32, 7), false)
        .expect("put the tile that must stay readable");
    store
        .put(VECTOR, 1, 1, 1, "pbf", &bytes(32, 9), false)
        .expect("put the tile that becomes a fifo");

    // Replace one tile's file with a fifo nothing ever writes to. The index
    // still names it, so `get` resolves the path and then waits at the open.
    let fifo = tmp
        .path()
        .join("basemap-tiles")
        .join(VECTOR)
        .join("1")
        .join("1")
        .join("1.pbf");
    std::fs::remove_file(&fifo).expect("remove the real tile");
    let made = std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .expect("run mkfifo");
    assert!(made.success(), "mkfifo failed");

    let blocked = Arc::clone(&store);
    let blocker = std::thread::spawn(move || blocked.get(VECTOR, 1, 1, 1));

    // The blocked read has to be under way before the second one starts, or
    // this passes without proving anything. A non-blocking open for writing
    // fails with ENXIO until a reader is waiting at the other end, and once
    // it succeeds it holds the fifo open with nothing written, so the reader
    // goes on waiting for data.
    #[cfg(target_os = "linux")]
    const O_NONBLOCK: i32 = 0o4000;
    #[cfg(not(target_os = "linux"))]
    const O_NONBLOCK: i32 = 0x4;
    const ENXIO: i32 = 6;
    let hang_guard = std::time::Instant::now() + Duration::from_secs(30);
    let writer = loop {
        match std::os::unix::fs::OpenOptionsExt::custom_flags(
            std::fs::OpenOptions::new().write(true),
            O_NONBLOCK,
        )
        .open(&fifo)
        {
            Ok(file) => break file,
            Err(e) if e.raw_os_error() == Some(ENXIO) => {
                assert!(
                    std::time::Instant::now() < hang_guard,
                    "the blocked read never reached the fifo"
                );
                std::thread::yield_now();
            }
            Err(e) => panic!("open the fifo for writing: {e}"),
        }
    };

    let (tx, rx) = mpsc::channel();
    let reader = Arc::clone(&store);
    std::thread::spawn(move || {
        let _ = tx.send(reader.get(GROUND, 1, 1, 1));
    });

    let answered = rx
        .recv_timeout(Duration::from_secs(30))
        .expect("a read of another source waited on the blocked one");
    assert_eq!(
        answered,
        Some(bytes(32, 7)),
        "and it answered with its own tile"
    );

    // Closing the writer ends the blocked read, so the test does not leak it.
    drop(writer);
    let _ = blocker.join();
}

/// The read still stamps what it read, or eviction loses its order, and it
/// still corrects a byte count for a file the OS truncated under it.
#[test]
fn a_read_still_stamps_the_entry_and_follows_the_bytes_it_got() {
    let (store, tmp) = store();
    store
        .put(GROUND, 2, 0, 0, "jpg", &bytes(64, 1), false)
        .expect("put");
    store
        .put(GROUND, 2, 0, 1, "jpg", &bytes(64, 2), false)
        .expect("put");

    // Truncate one tile behind the store's back, then read it.
    let path = tmp
        .path()
        .join("basemap-tiles")
        .join(GROUND)
        .join("2")
        .join("0")
        .join("0.jpg");
    std::fs::write(&path, bytes(8, 1)).expect("truncate");
    assert_eq!(store.get(GROUND, 2, 0, 0), Some(bytes(8, 1)));
    assert_eq!(
        store.size_of(GROUND),
        8 + 64,
        "the byte count follows what was read, not what the index remembered"
    );

    // The tile just read is the most recent, so eviction takes the other one.
    store.evict_to(8).expect("evict");
    assert_eq!(store.get(GROUND, 2, 0, 1), None);
    assert_eq!(store.get(GROUND, 2, 0, 0), Some(bytes(8, 1)));
}

/// The index outliving its file is still forgotten rather than answered.
#[test]
fn a_read_of_a_file_that_vanished_forgets_the_entry() {
    let (store, tmp) = store();
    store
        .put(GROUND, 3, 0, 0, "jpg", &bytes(16, 4), false)
        .expect("put");
    std::fs::remove_file(
        tmp.path()
            .join("basemap-tiles")
            .join(GROUND)
            .join("3")
            .join("0")
            .join("0.jpg"),
    )
    .expect("remove");

    assert_eq!(store.get(GROUND, 3, 0, 0), None);
    assert_eq!(store.size_of(GROUND), 0, "and stops counting its bytes");
}

// ============================================================================
// The read clock across a restart
// ============================================================================

/// The clock a source's sidecar carries on disk.
fn sidecar_clock(root: &std::path::Path, source: &str) -> u64 {
    let body = std::fs::read(root.join(source).join("index.json")).expect("sidecar");
    let sidecar: serde_json::Value = serde_json::from_slice(&body).expect("sidecar parses");
    sidecar["clock"].as_u64().expect("clock")
}

/// Scenario: the last session read ground tiles last, so the ground sidecar's
/// clock is well past the vector sidecar's. After a restart the athlete pans the
/// vector map before anything has loaded the ground source.
///
/// Expected behaviour: those vector reads are the newest in the tree, so an
/// eviction takes the ground tiles last read in the previous session.
#[test]
fn a_read_after_a_restart_is_newer_than_every_source_on_disk() {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join("basemap-tiles");
    {
        let store = TileStore::new(&root);
        store
            .put(VECTOR, 5, 0, 0, "pbf", &bytes(100, 1), false)
            .expect("put vector");
        store
            .put(GROUND, 5, 0, 0, "jpg", &bytes(100, 2), false)
            .expect("put ground a");
        store
            .put(GROUND, 5, 0, 1, "jpg", &bytes(100, 3), false)
            .expect("put ground b");
        for _ in 0..5 {
            assert!(store.get(GROUND, 5, 0, 0).is_some());
            assert!(store.get(GROUND, 5, 0, 1).is_some());
        }
        store.flush().expect("flush");
    }
    assert!(sidecar_clock(&root, GROUND) > sidecar_clock(&root, VECTOR));

    let reopened = TileStore::new(&root);
    assert!(
        reopened.get(VECTOR, 5, 0, 0).is_some(),
        "the vector map is panned first"
    );
    reopened.evict_to(200).expect("evict");

    assert!(
        reopened.get(VECTOR, 5, 0, 0).is_some(),
        "the tile read in this session went ahead of one read in the last"
    );
    assert_eq!(reopened.size_of(GROUND), 100);
}

/// Scenario: the first tile stored after a restart, in a source that already
/// holds tiles read in the previous session.
///
/// Expected behaviour: the new tile is the newest in the source, an eviction
/// takes an old one, and the sidecar's clock does not go backwards.
#[test]
fn the_first_tile_stored_after_a_restart_is_the_newest() {
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
        assert!(store.get(VECTOR, 5, 0, 0).is_some());
        assert!(store.get(VECTOR, 5, 0, 1).is_some());
        store.flush().expect("flush");
    }
    let before = sidecar_clock(&root, VECTOR);

    let reopened = TileStore::new(&root);
    reopened
        .put(VECTOR, 5, 0, 2, "pbf", &bytes(100, 3), false)
        .expect("put c");
    reopened.flush().expect("flush");
    assert!(
        sidecar_clock(&root, VECTOR) > before,
        "the sidecar was written back with a clock older than its own tiles"
    );

    assert_eq!(reopened.evict_to(200).expect("evict"), 1);
    assert!(
        reopened.get(VECTOR, 5, 0, 2).is_some(),
        "the tile just stored was evicted as the oldest"
    );
    assert!(reopened.get(VECTOR, 5, 0, 0).is_none());
}

// ============================================================================
// The budget the athlete set
// ============================================================================

/// Scenario: the athlete's ceiling is set and the map is panned well past it.
///
/// Expected behaviour: no `put` leaves the tree over the ceiling, and the
/// pinned pre-seed survives for as long as an opportunistic tile is left.
#[test]
fn a_store_filled_past_its_budget_through_put_stays_inside_it() {
    let (store, _tmp) = store();
    let budget = 5_000;
    store.set_budget(budget).expect("budget");

    for y in 0..10u32 {
        store
            .put(GROUND, 3, 0, y, "jpg", &bytes(100, 1), true)
            .expect("pinned put");
    }
    for y in 0..50u32 {
        store
            .put(VECTOR, 12, 0, y, "pbf", &bytes(100, 2), false)
            .expect("put");
        assert!(
            store.size() <= budget,
            "put {y} left the tree at {} bytes against {budget}",
            store.size()
        );
    }

    assert_eq!(store.size_of(GROUND), 1_000, "a pinned tile went first");
    assert!(
        store.get(VECTOR, 12, 0, 0).is_none(),
        "the oldest opportunistic tile is the one to go"
    );
    assert!(store.get(VECTOR, 12, 0, 49).is_some());
}

/// Scenario: the athlete lowers the ceiling below what the pre-seed alone holds.
///
/// Expected behaviour: the store is brought under it at once, every
/// opportunistic tile going before the oldest pinned ones.
#[test]
fn lowering_the_budget_evicts_at_once_and_takes_the_pre_seed_last() {
    let (store, _tmp) = store();
    for y in 0..4u32 {
        store
            .put(GROUND, 3, 0, y, "jpg", &bytes(100, 1), true)
            .expect("pinned put");
    }
    for y in 0..4u32 {
        store
            .put(VECTOR, 12, 0, y, "pbf", &bytes(100, 2), false)
            .expect("put");
    }
    assert_eq!(store.size(), 800, "no budget set, nothing evicted");

    let removed = store.set_budget(300).expect("budget");

    assert_eq!(removed, 5);
    assert_eq!(store.size(), 300);
    assert_eq!(store.size_of(VECTOR), 0, "every opportunistic tile went");
    assert!(
        store.get(GROUND, 3, 0, 0).is_none(),
        "the oldest pinned tile"
    );
    assert!(
        store.get(GROUND, 3, 0, 3).is_some(),
        "the newest pinned tile"
    );
}

/// Raising the ceiling keeps everything, and so does a store with no ceiling.
#[test]
fn raising_the_budget_evicts_nothing() {
    let (store, _tmp) = store();
    for y in 0..4u32 {
        store
            .put(VECTOR, 12, 0, y, "pbf", &bytes(100, 2), false)
            .expect("put");
    }
    assert_eq!(store.set_budget(400).expect("budget"), 0);
    assert_eq!(store.set_budget(10_000).expect("budget"), 0);
    assert_eq!(store.size(), 400);
    assert_eq!(store.budget(), Some(10_000));
}

/// A clear empties the tree and leaves the ceiling where the athlete set it.
#[test]
fn a_clear_keeps_the_budget() {
    let (store, _tmp) = store();
    store.set_budget(200).expect("budget");
    store
        .put(VECTOR, 12, 0, 0, "pbf", &bytes(100, 2), false)
        .expect("put");
    store.clear().expect("clear");
    for y in 0..4u32 {
        store
            .put(VECTOR, 12, 0, y, "pbf", &bytes(100, 2), false)
            .expect("put");
    }
    assert_eq!(store.size(), 200);
}

// ============================================================================
// Counters
// ============================================================================

#[test]
fn a_read_counts_a_hit_when_the_tile_is_held_and_a_miss_when_it_is_not() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 3, 1, 2, "pbf", &bytes(8, 1), false)
        .expect("put");

    store.get(VECTOR, 3, 1, 2);
    store.get(VECTOR, 3, 1, 2);
    store.get(VECTOR, 3, 9, 9);

    let counts = store.tile_counts(VECTOR);
    assert_eq!((counts.hits, counts.misses, counts.fetches), (2, 1, 0));
    assert_eq!(store.tile_counts(GROUND).hits, 0, "counts are per source");
}

#[test]
fn a_fetch_through_counts_a_fetch_and_a_satellite_read_counts_no_miss() {
    let (store, _tmp) = store();

    store.get(GROUND, 1, 0, 0);
    store.record_fetch(GROUND);
    store.get("satellite-eox", 1, 0, 0);
    store.record_fetch("satellite-eox");

    let ground = store.tile_counts(GROUND);
    assert_eq!((ground.misses, ground.fetches), (1, 1));
    let satellite = store.tile_counts("satellite-eox");
    assert_eq!(
        (satellite.hits, satellite.misses, satellite.fetches),
        (0, 0, 1)
    );
}

#[test]
fn the_counters_read_zero_after_a_reset_and_count_again_after() {
    let (store, _tmp) = store();
    store.get(VECTOR, 1, 0, 0);
    store.record_fetch(VECTOR);

    store.reset_tile_counts();
    let zeroed = store.tile_counts(VECTOR);
    assert_eq!((zeroed.hits, zeroed.misses, zeroed.fetches), (0, 0, 0));

    store.get(VECTOR, 1, 0, 0);
    assert_eq!(store.tile_counts(VECTOR).misses, 1);
}

#[test]
fn the_screen_read_carries_each_sources_counts_after_a_hit_a_miss_and_a_fetch() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 3, 1, 2, "pbf", &bytes(8, 1), false)
        .expect("put");

    store.get(VECTOR, 3, 1, 2);
    store.get(VECTOR, 3, 9, 9);
    store.record_fetch(VECTOR);
    store.record_fetch("satellite-eox");

    let rows = store.source_tile_counts();
    let names: Vec<&str> = rows.iter().map(|r| r.source.as_str()).collect();
    assert_eq!(names, vec!["satellite-eox", VECTOR]);
    let vector = rows.iter().find(|r| r.source == VECTOR).unwrap();
    assert_eq!(
        (vector.hits, vector.misses, vector.fetches),
        (1.0, 1.0, 1.0)
    );
    let satellite = &rows[0];
    assert_eq!(
        (satellite.hits, satellite.misses, satellite.fetches),
        (0.0, 0.0, 1.0)
    );

    store.reset_tile_counts();
    assert!(store.source_tile_counts().is_empty());
}
