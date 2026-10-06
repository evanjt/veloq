//! The world ground the app carries, so a map with no network and nothing in
//! the store still draws coastlines at the lowest zooms.
//!
//! A floor under the store and never a member of it: bytes here are in the
//! binary, so they are never written to disk, never counted against the
//! store's budget and never evicted. Only z0 and z1 are carried, five tiles of
//! each ground source, which is what the pre-seed's z2 start leaves bare.
//!
//! `floor/SNAPSHOT` names the planet run the vector tiles came from. The
//! raster ground is undated.

/// The tile for `source` at `z/x/y`, or `None` when the app does not carry it.
pub(crate) fn tile(source: &str, z: u8, x: u32, y: u32) -> Option<&'static [u8]> {
    // Literal paths, so the build-input hasher can name every embedded tile.
    Some(match source {
        "openmaptiles" => match (z, x, y) {
            (0, 0, 0) => &include_bytes!("../../floor/openmaptiles/0/0/0.pbf")[..],
            (1, 0, 0) => &include_bytes!("../../floor/openmaptiles/1/0/0.pbf")[..],
            (1, 0, 1) => &include_bytes!("../../floor/openmaptiles/1/0/1.pbf")[..],
            (1, 1, 0) => &include_bytes!("../../floor/openmaptiles/1/1/0.pbf")[..],
            (1, 1, 1) => &include_bytes!("../../floor/openmaptiles/1/1/1.pbf")[..],
            _ => return None,
        },
        "ne2_shaded" => match (z, x, y) {
            (0, 0, 0) => &include_bytes!("../../floor/ne2_shaded/0/0/0.png")[..],
            (1, 0, 0) => &include_bytes!("../../floor/ne2_shaded/1/0/0.png")[..],
            (1, 0, 1) => &include_bytes!("../../floor/ne2_shaded/1/0/1.png")[..],
            (1, 1, 0) => &include_bytes!("../../floor/ne2_shaded/1/1/0.png")[..],
            (1, 1, 1) => &include_bytes!("../../floor/ne2_shaded/1/1/1.png")[..],
            _ => return None,
        },
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_ground_sources_carry_all_five_tiles_of_z0_and_z1() {
        for source in ["openmaptiles", "ne2_shaded"] {
            for (z, x, y) in [(0, 0, 0), (1, 0, 0), (1, 0, 1), (1, 1, 0), (1, 1, 1)] {
                let bytes = tile(source, z, x, y).unwrap_or_else(|| panic!("{source} {z}/{x}/{y}"));
                assert!(!bytes.is_empty());
            }
        }
    }

    #[test]
    fn z2_and_unknown_sources_are_not_carried() {
        assert!(tile("openmaptiles", 2, 0, 0).is_none());
        assert!(tile("ne2_shaded", 1, 2, 0).is_none());
        assert!(tile("satellite", 0, 0, 0).is_none());
    }

    #[test]
    fn the_raster_floor_is_a_png() {
        assert_eq!(&tile("ne2_shaded", 0, 0, 0).unwrap()[..4], b"\x89PNG");
    }
}
