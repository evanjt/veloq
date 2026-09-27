//! What a tile host has already said it has not got.
//!
//! Every regional satellite source is a rectangle over a country whose shape is
//! not a rectangle, so a viewport near a border asks one of them for ground it
//! does not serve and gets a 404 per tile. Nothing remembered that, so a pan
//! back over the same ground paid for it again, and a zoom in paid four times
//! over: one minute over the Valais cost 247 requests that could never have
//! returned a tile.
//!
//! A 404 is remembered per tile and read for that tile and everything under it.
//! Under, not over: a source with no imagery at a tile has none at any of its
//! children, while the parent covers ground the refusal said nothing about.
//! Only 404 is remembered. A 5xx or a timeout is the host having a bad minute
//! and must be asked again.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

/// How many refusals one source keeps. Reached only by panning a border for a
/// long time, and a 404 is cheap enough that forgetting the rest is better than
/// growing without bound. Full means stop adding rather than clear: what is
/// already there is what the map has been asking for.
const PER_SOURCE_CAP: usize = 4096;

/// A tile's `(z, x, y)`.
type TileKey = (u8, u32, u32);

static REFUSED: LazyLock<Mutex<HashMap<String, HashSet<TileKey>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Remember that this source's host answered 404 for this tile.
pub(crate) fn remember_refused(source: &str, z: u8, x: u32, y: u32) {
    let mut refused = REFUSED.lock().unwrap_or_else(|e| e.into_inner());
    let tiles = refused.entry(source.to_string()).or_default();
    if tiles.len() < PER_SOURCE_CAP {
        tiles.insert((z, x, y));
    }
}

/// Whether this tile, or any tile it sits under, has already been refused.
pub(crate) fn is_refused(source: &str, z: u8, x: u32, y: u32) -> bool {
    let refused = REFUSED.lock().unwrap_or_else(|e| e.into_inner());
    let Some(tiles) = refused.get(source) else {
        return false;
    };
    (0..=z).any(|up| {
        let shift = z - up;
        tiles.contains(&(up, x >> shift, y >> shift))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test names its own source, because the table is process-wide and
    /// the suite runs its tests on threads of one process.
    #[test]
    fn a_refused_tile_is_refused_again() {
        remember_refused("same", 10, 512, 340);

        assert!(is_refused("same", 10, 512, 340));
    }

    #[test]
    fn every_tile_under_a_refused_one_is_refused_with_it() {
        remember_refused("under", 10, 512, 340);

        assert!(is_refused("under", 11, 1024, 680));
        assert!(is_refused("under", 11, 1025, 681));
        assert!(is_refused("under", 16, 512 << 6, 340 << 6));
    }

    #[test]
    fn a_neighbour_and_a_parent_are_not() {
        remember_refused("nearby", 10, 512, 340);

        assert!(!is_refused("nearby", 10, 513, 340));
        assert!(!is_refused("nearby", 10, 512, 341));
        assert!(!is_refused("nearby", 9, 256, 170));
    }

    #[test]
    fn a_refusal_belongs_to_the_source_that_gave_it() {
        remember_refused("mine", 10, 512, 340);

        assert!(!is_refused("yours", 10, 512, 340));
        assert!(!is_refused("yours", 12, 2048, 1360));
    }

    #[test]
    fn nothing_is_refused_before_a_host_has_said_so() {
        assert!(!is_refused("fresh", 0, 0, 0));
        assert!(!is_refused("fresh", 14, 8563, 5789));
    }

    #[test]
    fn a_source_stops_growing_at_the_cap() {
        for x in 0..(PER_SOURCE_CAP as u32 + 16) {
            remember_refused("capped", 14, x, 0);
        }

        let refused = REFUSED.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(refused["capped"].len(), PER_SOURCE_CAP);
    }
}
