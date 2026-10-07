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
    GROUND_BUDGET_BYTES, GROUND_ZOOMS, PreseedSource, TileFetcher, TileStore, plan_area_preseed,
    plan_preseed, seed_preseed, seed_ranked_preseed,
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

#[test]
fn terrain_areas_keep_rank_order_and_stop_at_the_live_pool_share() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(bytes(100, 9));
    });
    let (store, _tmp) = store();
    let terrain = PreseedSource {
        name: "terrain".into(),
        template: format!("{}/terrarium/{{z}}/{{x}}/{{y}}.png", server.base_url()),
        ext: "png".into(),
        zooms: 8..=12,
    };
    let planned = plan_area_preseed(&[(46.6, 7.6), (-33.8, 151.2)], &terrain);
    assert!(planned.iter().any(|tile| tile.z == 8));
    assert!(planned.iter().any(|tile| tile.z == 12));
    assert!(planned.iter().all(|tile| (8..=12).contains(&tile.z)));
    let first_area_end = planned
        .iter()
        .position(|tile| tile.y > (1 << (tile.z - 1)))
        .unwrap();
    assert!(
        planned[..first_area_end]
            .iter()
            .all(|tile| tile.y < (1 << (tile.z - 1)))
    );

    store.set_budget(1_000).unwrap();
    let small = veloqrs::runtime::block_on(seed_ranked_preseed(
        &store,
        &fetcher(),
        &planned,
        store.budget().unwrap() * 2 / 5,
        "terrain",
    ));
    assert!(small.stopped_at_budget);
    assert!(small.bytes <= 400);
    store.set_budget(2_000).unwrap();
    let large = veloqrs::runtime::block_on(seed_ranked_preseed(
        &store,
        &fetcher(),
        &planned,
        store.budget().unwrap() * 2 / 5,
        "terrain",
    ));
    assert!(large.bytes <= 800);
    assert!(large.fetched + large.kept > small.fetched + small.kept);
    assert_eq!(
        store.get("terrain", planned[0].z, planned[0].x, planned[0].y),
        Some(bytes(100, 9))
    );
    store
        .put("terrain", 13, 0, 0, "png", &bytes(100, 1), false)
        .unwrap();
    store.evict_to(store.size() - 100).unwrap();
    assert!(store.get("terrain", 13, 0, 0).is_none());
    assert!(
        store
            .get("terrain", planned[0].z, planned[0].x, planned[0].y)
            .is_some()
    );

    // A later pass at a lower limit must leave the old tail evictable.
    store.set_budget(500).unwrap();
    let reduced = veloqrs::runtime::block_on(seed_ranked_preseed(
        &store,
        &fetcher(),
        &planned,
        store.budget().unwrap() * 2 / 5,
        "terrain",
    ));
    assert_eq!(reduced.bytes, 200);
    store.evict_to(200).unwrap();
    assert!(
        store
            .get("terrain", planned[0].z, planned[0].x, planned[0].y)
            .is_some()
    );
    assert!(
        store
            .get("terrain", planned[4].z, planned[4].x, planned[4].y)
            .is_none()
    );
}

#[test]
fn a_failed_ranked_refresh_keeps_the_previous_offline_pins() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(503);
    });
    let (store, _tmp) = store();
    store
        .put("terrain", 8, 2, 3, "png", &bytes(100, 9), true)
        .unwrap();
    let plan = vec![veloqrs::basemap::PlannedTile {
        source: "terrain".into(),
        z: 8,
        x: 4,
        y: 5,
        url: format!("{}/missing", server.base_url()),
        ext: "png".into(),
    }];

    let outcome = veloqrs::runtime::block_on(seed_ranked_preseed(
        &store,
        &fetcher(),
        &plan,
        200,
        "terrain",
    ));

    assert_eq!(outcome.failed, 1);
    store
        .put("terrain", 9, 6, 7, "png", &bytes(100, 1), false)
        .unwrap();
    store.evict_to(100).unwrap();
    assert_eq!(store.get("terrain", 8, 2, 3), Some(bytes(100, 9)));
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
// A segment change
// ============================================================================

#[test]
fn a_superseded_pinned_tile_is_served_but_the_next_seed_fetches_a_fresh_one() {
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
            true,
        )
        .expect("put");

    store.supersede(&held.source).expect("supersede");
    assert_eq!(
        store.get(&held.source, held.z, held.x, held.y),
        Some(bytes(64, 3)),
        "the old tile stopped being served before its replacement arrived"
    );
    assert_eq!(store.pin(&held.source, held.z, held.x, held.y), None);

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.kept, 0, "the old tile was re-pinned");
    assert_eq!(outcome.fetched as usize, planned.len());
    assert_eq!(host.hits(), planned.len());
    assert_eq!(
        store.get(&held.source, held.z, held.x, held.y),
        Some(bytes(128, 9)),
        "the fresh tile did not replace the old one"
    );
    assert_eq!(
        store.pin(&held.source, held.z, held.x, held.y),
        Some(128),
        "the fresh tile is not pinned"
    );
}

#[test]
fn a_superseded_tile_keeps_serving_when_the_fresh_fetch_fails() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(500).body("no tile");
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
            true,
        )
        .expect("put");
    store.supersede(&held.source).expect("supersede");

    let outcome = veloqrs::runtime::block_on(seed_preseed(
        &store,
        &fetcher(),
        &planned,
        GROUND_BUDGET_BYTES,
    ));

    assert_eq!(outcome.failed as usize, planned.len());
    assert_eq!(
        store.get(&held.source, held.z, held.x, held.y),
        Some(bytes(64, 3)),
        "a failed fetch cost the athlete the tile they had"
    );
}

#[test]
fn supersede_drops_unpinned_tiles_and_leaves_other_sources_pinned() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(64, 1), true)
        .unwrap();
    store
        .put(VECTOR, 2, 1, 2, "pbf", &bytes(64, 2), false)
        .unwrap();
    store
        .put(GROUND, 2, 1, 1, "png", &bytes(64, 3), true)
        .unwrap();

    store.supersede(VECTOR).expect("supersede");

    assert_eq!(
        store.get(VECTOR, 2, 1, 2),
        None,
        "an unpinned tile survived"
    );
    assert!(store.get(VECTOR, 2, 1, 1).is_some());
    assert_eq!(
        store.pin(GROUND, 2, 1, 1),
        Some(64),
        "another source was demoted"
    );
}

#[test]
fn a_superseded_tile_is_evicted_before_a_pinned_tile_of_another_source() {
    let (store, _tmp) = store();
    store
        .put(GROUND, 2, 1, 1, "png", &bytes(64, 3), true)
        .unwrap();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(64, 1), true)
        .unwrap();
    // Read last, so only its demotion can put it ahead of the pinned tile.
    store.get(VECTOR, 2, 1, 1);
    store.supersede(VECTOR).expect("supersede");

    store.evict_to(64).expect("evict");

    assert_eq!(store.get(VECTOR, 2, 1, 1), None);
    assert!(store.get(GROUND, 2, 1, 1).is_some());
}

#[test]
fn a_second_supersede_drops_the_tile_the_first_demoted() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(64, 1), true)
        .unwrap();
    store.supersede(VECTOR).unwrap();
    store.supersede(VECTOR).unwrap();
    assert_eq!(store.get(VECTOR, 2, 1, 1), None);
}

#[test]
fn a_write_of_a_superseded_key_makes_it_current_again() {
    let (store, _tmp) = store();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(64, 1), true)
        .unwrap();
    store.supersede(VECTOR).unwrap();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(32, 2), false)
        .unwrap();
    assert_eq!(store.pin(VECTOR, 2, 1, 1), Some(32));
}

#[test]
fn a_sidecar_written_before_supersession_loads_with_its_pins_intact() {
    let (store, tmp) = store();
    store
        .put(VECTOR, 2, 1, 1, "pbf", &bytes(64, 1), true)
        .unwrap();
    store.flush().unwrap();
    let sidecar = tmp
        .path()
        .join("basemap-tiles")
        .join(VECTOR)
        .join("index.json");
    let body = std::fs::read_to_string(&sidecar).unwrap();
    let mut json: serde_json::Value = serde_json::from_str(&body).unwrap();
    for entry in json["entries"].as_object_mut().unwrap().values_mut() {
        entry.as_object_mut().unwrap().remove("superseded");
    }
    std::fs::write(&sidecar, serde_json::to_vec(&json).unwrap()).unwrap();

    let reopened = TileStore::new(tmp.path().join("basemap-tiles"));
    assert_eq!(reopened.pin(VECTOR, 2, 1, 1), Some(64));
    assert_eq!(reopened.size_of(VECTOR), 64);
    reopened.supersede(VECTOR).unwrap();
    assert_eq!(reopened.pin(VECTOR, 2, 1, 1), None);
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
