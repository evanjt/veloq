//! The pinned offline base: the ground an athlete's own regions need, fetched
//! once and evicted last.
//!
//! Scenario: a fresh install syncs a library and the radio goes off before any
//! map is opened, so nothing has ever browsed a tile into the store.
//! Expected behaviour: the world and every region the athlete rides in draw
//! from disk, the set never outgrows its budget, and a pan somewhere else
//! cannot cost the athlete the ground they downloaded.

use std::time::Duration;

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::Bounds;
use veloqrs::basemap::{
    GROUND_BUDGET_BYTES, GROUND_ZOOMS, PreseedSource, TileFetcher, TileStore, plan_preseed,
    seed_preseed,
};

const VECTOR: &str = "openmaptiles";
const GROUND: &str = "ne2_shaded";

fn store() -> (TileStore, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    (TileStore::new(tmp.path().join("basemap-tiles")), tmp)
}

fn bytes(n: usize, fill: u8) -> Vec<u8> {
    vec![fill; n]
}

/// A box over the Bernese Oberland, which is one tile at every zoom the ground
/// pre-seed covers.
fn home() -> Bounds {
    Bounds {
        min_lat: 46.55,
        max_lat: 46.75,
        min_lng: 7.55,
        max_lng: 7.85,
    }
}

/// A box over Rome, which shares `home`'s z2 tile and none of its z5 tiles.
fn near() -> Bounds {
    Bounds {
        min_lat: 41.80,
        max_lat: 41.95,
        min_lng: 12.40,
        max_lng: 12.60,
    }
}

/// A box over Sydney, far enough from `home` to share no tile at any zoom the
/// band covers.
fn away() -> Bounds {
    Bounds {
        min_lat: -33.95,
        max_lat: -33.75,
        min_lng: 151.10,
        max_lng: 151.30,
    }
}

/// What an activity with no GPS carries, which is not a place.
fn sentinel() -> Bounds {
    Bounds {
        min_lat: 0.0,
        max_lat: 0.0,
        min_lng: 0.0,
        max_lng: 0.0,
    }
}

fn sources(base: &str) -> Vec<PreseedSource> {
    vec![
        PreseedSource {
            name: VECTOR.to_string(),
            template: format!("{base}/planet/{{z}}/{{x}}/{{y}}.pbf"),
            ext: "pbf".to_string(),
            zooms: GROUND_ZOOMS,
        },
        PreseedSource {
            name: GROUND.to_string(),
            template: format!("{base}/ne2sr/{{z}}/{{x}}/{{y}}.png"),
            ext: "png".to_string(),
            zooms: GROUND_ZOOMS,
        },
    ]
}

fn fetcher() -> TileFetcher {
    TileFetcher::new(Duration::ZERO).expect("fetcher")
}

// ============================================================================
// The plan
// ============================================================================

#[test]
fn the_plan_covers_every_zoom_of_the_band_for_every_source() {
    let planned = plan_preseed(&[home()], &sources("https://tiles.test"));

    for source in [VECTOR, GROUND] {
        for z in GROUND_ZOOMS {
            assert!(
                planned.iter().any(|t| t.source == source && t.z == z),
                "{source} has no z{z} tile"
            );
        }
    }
    assert!(
        !planned.iter().any(|t| !GROUND_ZOOMS.contains(&t.z)),
        "the plan left the band"
    );
}

#[test]
fn the_plan_takes_the_lowest_zoom_first_so_a_budget_cut_costs_detail() {
    let planned = plan_preseed(&[home(), away()], &sources("https://tiles.test"));

    let zooms: Vec<u8> = planned.iter().map(|t| t.z).collect();
    let mut ascending = zooms.clone();
    ascending.sort();
    assert_eq!(
        zooms, ascending,
        "a lower zoom is queued behind a higher one"
    );
}

#[test]
fn two_regions_that_share_a_low_zoom_tile_are_planned_once() {
    let one = plan_preseed(&[home()], &sources("https://tiles.test"));
    let both = plan_preseed(&[home(), near()], &sources("https://tiles.test"));

    let mut keys: Vec<(String, u8, u32, u32)> = both
        .iter()
        .map(|t| (t.source.clone(), t.z, t.x, t.y))
        .collect();
    let before = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), before, "the same tile is planned twice");
    assert!(both.len() > one.len(), "a second region added no ground");
}

#[test]
fn the_same_library_plans_the_same_tiles_in_the_same_order() {
    let forwards = plan_preseed(&[home(), near(), away()], &sources("https://tiles.test"));
    let backwards = plan_preseed(&[away(), near(), home()], &sources("https://tiles.test"));

    assert_eq!(
        forwards, backwards,
        "the order bounds arrive in changes which tiles a budget cut keeps"
    );
}

#[test]
fn an_activity_with_no_gps_seeds_no_ground() {
    let planned = plan_preseed(&[sentinel()], &sources("https://tiles.test"));

    assert!(
        planned.is_empty(),
        "the (0, 0, 0, 0) sentinel seeded the Gulf of Guinea"
    );
}

#[test]
fn a_planned_tile_names_the_url_its_own_template_gives_it() {
    let planned = plan_preseed(&[home()], &sources("https://tiles.test"));
    let tile = planned
        .iter()
        .find(|t| t.source == VECTOR && t.z == 2)
        .expect("a z2 vector tile");

    assert_eq!(
        tile.url,
        format!("https://tiles.test/planet/2/{}/{}.pbf", tile.x, tile.y)
    );
    assert_eq!(tile.ext, "pbf");
}

// ============================================================================
// The seed
// ============================================================================

#[test]
fn a_seeded_tile_reads_back_from_disk_with_the_radio_off() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(128, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.fetched as usize, planned.len());
    assert_eq!(outcome.failed, 0);
    assert!(!outcome.stopped_at_budget);
    for tile in &planned {
        assert_eq!(
            store.get(&tile.source, tile.z, tile.x, tile.y),
            Some(bytes(128, 9)),
            "{} {}/{}/{} is not on disk",
            tile.source,
            tile.z,
            tile.x,
            tile.y
        );
    }
}

#[test]
fn a_tile_the_store_already_holds_is_pinned_rather_than_fetched_again() {
    let server = MockServer::start();
    let host = server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(128, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));
    let held = &planned[0];
    store
        .put(
            &held.source,
            held.z,
            held.x,
            held.y,
            &held.ext,
            &bytes(64, 3),
            false,
        )
        .expect("put");

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.kept, 1, "the held tile was not counted as kept");
    assert_eq!(outcome.fetched as usize, planned.len() - 1);
    assert_eq!(
        host.hits(),
        planned.len() - 1,
        "the held tile was refetched"
    );
    assert_eq!(
        store.get(&held.source, held.z, held.x, held.y),
        Some(bytes(64, 3)),
        "the held tile's bytes were replaced"
    );
}

#[test]
fn an_index_entry_that_outlived_its_file_is_fetched_rather_than_pinned() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(128, 9));
    });
    let (store, tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));
    let held = &planned[0];
    store
        .put(
            &held.source,
            held.z,
            held.x,
            held.y,
            &held.ext,
            &bytes(64, 3),
            false,
        )
        .expect("put");
    std::fs::remove_file(
        tmp.path()
            .join("basemap-tiles")
            .join(&held.source)
            .join(held.z.to_string())
            .join(held.x.to_string())
            .join(format!("{}.{}", held.y, held.ext)),
    )
    .expect("remove");

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.kept, 0, "a tile that is not on disk was pinned");
    assert_eq!(outcome.fetched as usize, planned.len());
    assert_eq!(
        store.get(&held.source, held.z, held.x, held.y),
        Some(bytes(128, 9))
    );
}

#[test]
fn the_seed_stops_at_its_budget_and_never_stores_past_it() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(1000, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home(), away()], &sources(&server.base_url()));
    assert!(planned.len() > 4, "the fixture has nothing to cut");

    let outcome = veloqrs::runtime::block_on(seed_preseed(&store, &fetcher(), &planned, 3_500));

    assert!(outcome.stopped_at_budget, "the whole plan fitted");
    assert!(
        store.size() <= 3_500,
        "the seed spent {} against a 3,500 byte budget",
        store.size()
    );
    assert!(outcome.fetched >= 3, "the seed stopped before the budget");
}

#[test]
fn a_tile_the_host_refuses_costs_the_rest_of_the_plan_nothing() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path_contains("/planet/2/");
        then.status(500).body("no tile");
    });
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(128, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));
    let refused = planned
        .iter()
        .filter(|t| t.source == VECTOR && t.z == 2)
        .count();

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.failed as usize, refused);
    assert_eq!(outcome.fetched as usize, planned.len() - refused);
}

// ============================================================================
// What the pin is for
// ============================================================================

#[test]
fn browsing_elsewhere_scrubs_the_pan_before_the_seed() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(100, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));
    veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));
    let seeded = store.size();
    // A pan over ground the athlete does not ride, at a zoom the seed never
    // covers, which is the case the pin exists for.
    for x in 0..20u32 {
        store
            .put(VECTOR, 9, x, 300, "pbf", &bytes(100, 1), false)
            .expect("put");
    }

    store.evict_to(seeded).expect("evict");

    for tile in &planned {
        assert!(
            store.get(&tile.source, tile.z, tile.x, tile.y).is_some(),
            "the seed lost {} {}/{}/{} to a pan",
            tile.source,
            tile.z,
            tile.x,
            tile.y
        );
    }
}

#[test]
fn a_seed_that_re_pins_a_browsed_tile_keeps_it_through_the_same_pan() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(100, 9));
    });
    let (store, _tmp) = store();
    let planned = plan_preseed(&[home()], &sources(&server.base_url()));
    let held = &planned[0];
    store
        .put(
            &held.source,
            held.z,
            held.x,
            held.y,
            &held.ext,
            &bytes(100, 3),
            false,
        )
        .expect("put");
    veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));
    let seeded = store.size();
    for x in 0..20u32 {
        store
            .put(VECTOR, 9, x, 300, "pbf", &bytes(100, 1), false)
            .expect("put");
    }

    store.evict_to(seeded).expect("evict");

    assert!(
        store.get(&held.source, held.z, held.x, held.y).is_some(),
        "a tile the seed re-pinned was still evicted as opportunistic"
    );
}
