//! Scenario: the page asks for imagery through one composite source and Rust
//! decides which regional host the tile comes from.
//!
//! Expected behaviour: a tile inside a region is fetched from that region's
//! host alone, one outside every region from the fallback, and a region whose
//! host has no tile for it hands the tile to the next provider instead of
//! leaving a hole. A composite is refused until it is registered.

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::basemap::{
    CompositeMember, GeoBox, fetch_tile, set_composite, set_path, set_template,
};

fn store_at(tmp: &TempDir) {
    set_path(
        tmp.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
}

/// The tile at `z` holding a point.
fn tile_at(z: u8, lng: f64, lat: f64) -> (u32, u32) {
    let n = f64::from(1u32 << z);
    let x = ((lng + 180.0) / 360.0 * n).floor();
    let y = ((1.0 - lat.to_radians().tan().asinh() / std::f64::consts::PI) / 2.0 * n).floor();
    (x as u32, y as u32)
}

fn member(source: &str, min_zoom: u8, max_zoom: u8, boxes: Vec<GeoBox>) -> CompositeMember {
    CompositeMember {
        source: source.to_string(),
        min_zoom,
        max_zoom,
        boxes,
    }
}

const NORTH_LAND: GeoBox = GeoBox {
    west: 10.0,
    south: 40.0,
    east: 12.0,
    north: 42.0,
};

#[test]
fn a_composite_fetches_each_tile_from_the_provider_that_holds_it() {
    let _serial = super::serial_state();
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    let region = MockServer::start();
    let world = MockServer::start();
    let region_tile = region.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.jpg$");
        then.status(200).body("regional");
    });
    let world_tile = world.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.jpg$");
        then.status(200).body("world");
    });
    set_template("pick-north".into(), region.url("/{z}/{x}/{y}.jpg"));
    set_template("pick-world".into(), world.url("/{z}/{x}/{y}.jpg"));
    set_composite(
        "pick-imagery".into(),
        vec![
            member("pick-north", 10, 20, vec![NORTH_LAND]),
            member("pick-world", 0, 14, vec![]),
        ],
    );

    let (x, y) = tile_at(12, 11.0, 41.0);
    assert_eq!(
        fetch_tile("pick-imagery", 12, x, y),
        Ok(b"regional".to_vec())
    );
    region_tile.assert_calls(1);
    world_tile.assert_calls(0);

    let (x, y) = tile_at(12, -40.0, 10.0);
    assert_eq!(fetch_tile("pick-imagery", 12, x, y), Ok(b"world".to_vec()));
    region_tile.assert_calls(1);
    world_tile.assert_calls(1);

    let (x, y) = tile_at(16, 11.0, 41.0);
    assert_eq!(
        fetch_tile("pick-imagery", 16, x, y),
        Ok(b"regional".to_vec()),
        "a tile deeper than the fallback serves comes from the region that does"
    );
    world_tile.assert_calls(1);
}

#[test]
fn a_region_with_no_tile_hands_it_to_the_next_provider() {
    let _serial = super::serial_state();
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    let region = MockServer::start();
    let world = MockServer::start();
    let refused = region.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.jpg$");
        then.status(404);
    });
    let fallback = world.mock(|when, then| {
        when.method(GET).path_matches(r"^/\d+/\d+/\d+\.jpg$");
        then.status(200).body("world");
    });
    set_template("edge-north".into(), region.url("/{z}/{x}/{y}.jpg"));
    set_template("edge-world".into(), world.url("/{z}/{x}/{y}.jpg"));
    set_composite(
        "edge-imagery".into(),
        vec![
            member("edge-north", 10, 20, vec![NORTH_LAND]),
            member("edge-world", 0, 14, vec![]),
        ],
    );

    let (x, y) = tile_at(12, 11.0, 41.0);
    assert_eq!(fetch_tile("edge-imagery", 12, x, y), Ok(b"world".to_vec()));
    refused.assert_calls(1);
    fallback.assert_calls(1);

    // The refusal is remembered under the region, so the same tile asks only
    // the fallback, which has it in memory by then.
    assert_eq!(fetch_tile("edge-imagery", 12, x, y), Ok(b"world".to_vec()));
    refused.assert_calls(1);
    fallback.assert_calls(1);
}

#[test]
fn a_composite_with_no_provider_for_a_tile_answers_404() {
    let _serial = super::serial_state();
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);
    let region = MockServer::start();
    let any = region.mock(|when, then| {
        when.method(GET);
        then.status(200).body("regional");
    });
    set_template("only-north".into(), region.url("/{z}/{x}/{y}.jpg"));
    set_composite(
        "only-regions".into(),
        vec![member("only-north", 14, 20, vec![NORTH_LAND])],
    );

    let (x, y) = tile_at(16, -40.0, 10.0);
    assert_eq!(fetch_tile("only-regions", 16, x, y), Err(404));
    let (x, y) = tile_at(21, 11.0, 41.0);
    assert_eq!(fetch_tile("only-regions", 21, x, y), Err(404));
    any.assert_calls(0);
}

#[test]
fn a_composite_nobody_registered_is_refused_without_asking_a_host() {
    let _serial = super::serial_state();
    let tmp = TempDir::new().expect("tempdir");
    store_at(&tmp);

    assert_eq!(fetch_tile("never-registered-imagery", 12, 1, 1), Err(404));
}
