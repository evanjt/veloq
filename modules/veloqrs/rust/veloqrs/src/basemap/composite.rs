//! One tile source that answers each tile from whichever provider covers it.
//!
//! The satellite style asks for imagery through two sources: the page names
//! one `z/x/y` and Rust decides which regional provider holds that tile. A
//! provider is a source of its own with its own template, memory cache and
//! refused ground, so a composite keeps no tiles itself. It only orders the
//! providers a tile may come from.
//!
//! A provider holds a tile when the tile's ground overlaps one of its boxes
//! and its zoom range includes the tile's zoom. A provider with no box holds
//! every position, which makes it the fallback. Candidates come back in the
//! order the page listed the members, so the page decides which provider
//! draws on top where two overlap.

use crate::poison::Recover;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// A geographic rectangle in degrees.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, uniffi::Record)]
pub struct GeoBox {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

/// A body a provider answers, byte for byte, on ground it holds no imagery for.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct BlankTile {
    /// The body's length in bytes. A digest is computed only for a body of a
    /// declared length.
    pub length: u32,
    /// The body's SHA-256 as 64 lowercase hex digits.
    pub sha256: String,
}

/// One provider a composite may answer from.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct CompositeMember {
    /// The provider's own source name, which has a template registered.
    pub source: String,
    /// The shallowest tile zoom the provider is asked for.
    pub min_zoom: u8,
    /// The deepest tile zoom the provider serves.
    pub max_zoom: u8,
    /// The ground the provider covers. Empty means everywhere.
    pub boxes: Vec<GeoBox>,
    /// The bodies the provider answers where it has no imagery. A 200 with one
    /// of these bodies is no tile.
    pub blank_tiles: Vec<BlankTile>,
}

static COMPOSITES: LazyLock<Mutex<HashMap<String, Vec<CompositeMember>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The blank bodies each provider source declares, by source name.
static BLANKS: LazyLock<Mutex<HashMap<String, Vec<BlankTile>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Whether `body` is one of the blank bodies `source` declares.
pub(crate) fn is_blank(source: &str, body: &[u8]) -> bool {
    let blanks = BLANKS.lock_recover();
    let Some(declared) = blanks.get(source) else {
        return false;
    };
    let mut digest = None;
    declared.iter().any(|blank| {
        if usize::try_from(blank.length) != Ok(body.len()) {
            return false;
        }
        let hex = digest.get_or_insert_with(|| hex_of(&crate::remote::digest::sha256(&[body])));
        hex.eq_ignore_ascii_case(&blank.sha256)
    })
}

fn hex_of(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(64), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// Record the providers one composite source chooses among, in priority order.
pub(crate) fn set(name: String, members: Vec<CompositeMember>) {
    {
        let mut blanks = BLANKS.lock_recover();
        for member in &members {
            blanks.insert(member.source.clone(), member.blank_tiles.clone());
        }
    }
    COMPOSITES.lock_recover().insert(name, members);
}

/// The members of a composite that hold every position, or `None` when `name`
/// is not a composite.
pub(crate) fn everywhere_of(name: &str) -> Option<Vec<String>> {
    let composites = COMPOSITES.lock_recover();
    composites.get(name).map(|members| {
        members
            .iter()
            .filter(|m| m.boxes.is_empty())
            .map(|m| m.source.clone())
            .collect()
    })
}

/// The providers of a composite that hold this tile, in priority order, or
/// `None` when `name` is not a composite.
pub(crate) fn candidates_of(name: &str, z: u8, x: u32, y: u32) -> Option<Vec<String>> {
    let composites = COMPOSITES.lock_recover();
    composites
        .get(name)
        .map(|members| candidates(members, z, x, y))
}

/// The members that hold this tile, in the order given.
pub fn candidates(members: &[CompositeMember], z: u8, x: u32, y: u32) -> Vec<String> {
    let tile = tile_box(z, x, y);
    members
        .iter()
        .filter(|m| z >= m.min_zoom && z <= m.max_zoom)
        .filter(|m| m.boxes.is_empty() || m.boxes.iter().any(|b| overlaps(b, &tile)))
        .map(|m| m.source.clone())
        .collect()
}

/// The edges of a web-mercator tile in EPSG:3857 metres, as
/// `[west, south, east, north]`, on the standard 256-pixel grid.
pub(crate) fn tile_bounds_metres(z: u8, x: u32, y: u32) -> [f64; 4] {
    /// Half the width of the projected world: pi times the earth's radius.
    const HALF_WORLD: f64 = std::f64::consts::PI * 6_378_137.0;
    let size = 2.0 * HALF_WORLD / f64::from(1u32 << z.min(31));
    let west = f64::from(x) * size - HALF_WORLD;
    let north = HALF_WORLD - f64::from(y) * size;
    [west, north - size, west + size, north]
}

/// The ground a web-mercator tile covers.
fn tile_box(z: u8, x: u32, y: u32) -> GeoBox {
    let n = f64::from(1u32 << z.min(31));
    let lng = |x: f64| x / n * 360.0 - 180.0;
    let lat = |y: f64| {
        (std::f64::consts::PI * (1.0 - 2.0 * y / n))
            .sinh()
            .atan()
            .to_degrees()
    };
    GeoBox {
        west: lng(f64::from(x)),
        east: lng(f64::from(x) + 1.0),
        north: lat(f64::from(y)),
        south: lat(f64::from(y) + 1.0),
    }
}

/// Whether two rectangles share ground. Rectangles that only touch do not.
fn overlaps(a: &GeoBox, b: &GeoBox) -> bool {
    a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tile at `z` holding a point, so a test names ground rather than
    /// tile numbers.
    fn tile_at(z: u8, lng: f64, lat: f64) -> (u32, u32) {
        let n = f64::from(1u32 << z);
        let x = ((lng + 180.0) / 360.0 * n).floor();
        let lat_rad = lat.to_radians();
        let y = ((1.0 - lat_rad.tan().asinh() / std::f64::consts::PI) / 2.0 * n).floor();
        (x as u32, y as u32)
    }

    fn member(source: &str, min_zoom: u8, max_zoom: u8, boxes: &[[f64; 4]]) -> CompositeMember {
        CompositeMember {
            source: source.to_string(),
            blank_tiles: vec![],
            min_zoom,
            max_zoom,
            boxes: boxes
                .iter()
                .map(|b| GeoBox {
                    west: b[0],
                    south: b[1],
                    east: b[2],
                    north: b[3],
                })
                .collect(),
        }
    }

    /// Two invented countries, side by side, over a world fallback.
    fn members() -> Vec<CompositeMember> {
        vec![
            member("north-land", 10, 20, &[[10.0, 40.0, 12.0, 42.0]]),
            member("south-land", 10, 17, &[[10.0, 30.0, 14.0, 41.0]]),
            member("world", 0, 14, &[]),
        ]
    }

    fn choose(z: u8, lng: f64, lat: f64) -> Vec<String> {
        let (x, y) = tile_at(z, lng, lat);
        candidates(&members(), z, x, y)
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_inside_a_region_is_offered_to_that_region_first() {
        assert_eq!(choose(12, 11.0, 41.5)[0], "north-land");
        assert_eq!(choose(12, 13.0, 35.0)[0], "south-land");
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_outside_every_region_is_offered_to_the_fallback_alone() {
        assert_eq!(choose(12, -40.0, 10.0), ["world"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn the_first_member_listed_wins_where_two_regions_overlap() {
        let overlap = choose(12, 11.0, 40.5);

        assert_eq!(overlap, ["north-land", "south-land", "world"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_deeper_than_a_region_serves_is_offered_to_the_next_that_holds_it() {
        assert_eq!(choose(18, 11.0, 40.5), ["north-land"]);
        assert_eq!(choose(15, 11.0, 40.5), ["north-land", "south-land"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_deeper_than_every_member_serves_has_no_candidate() {
        assert!(choose(21, 11.0, 41.5).is_empty());
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_shallower_than_a_region_starts_is_offered_to_the_fallback() {
        assert_eq!(choose(8, 11.0, 41.5), ["world"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_straddling_a_border_is_offered_to_every_region_it_touches() {
        let at_border = choose(8, 12.0, 41.0);

        assert_eq!(at_border, ["world"], "below the regions' minimum zoom");
        let straddling = {
            let (x, y) = tile_at(11, 12.0, 41.0);
            candidates(&members(), 11, x, y)
        };
        assert_eq!(straddling, ["north-land", "south-land", "world"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tile_that_only_touches_a_box_edge_is_not_in_it() {
        // Tile x = 2^z / 2 begins at longitude 0.
        let members = vec![member("edge", 0, 20, &[[-10.0, -10.0, 0.0, 10.0]])];

        assert!(candidates(&members, 4, 8, 7).is_empty());
        assert_eq!(candidates(&members, 4, 7, 7), ["edge"]);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_source_that_is_not_a_composite_has_no_candidates_to_ask() {
        set("composite-known".into(), members());

        assert_eq!(candidates_of("composite-unknown", 12, 1, 1), None);
        let (x, y) = tile_at(12, 11.0, 41.5);
        assert_eq!(
            candidates_of("composite-known", 12, x, y).map(|c| c[0].clone()),
            Some("north-land".to_string())
        );
    }
}
