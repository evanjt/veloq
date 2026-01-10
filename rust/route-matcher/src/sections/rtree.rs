//! R-tree indexed point types and spatial query utilities.

use crate::geo_utils::{bounds_overlap, compute_bounds};
use crate::GpsPoint;
use rstar::{PointDistance, RTree, RTreeObject, AABB};

/// A GPS point with its index for R-tree queries
#[derive(Debug, Clone, Copy)]
pub struct IndexedPoint {
    pub idx: usize,
    pub lat: f64,
    pub lng: f64,
}

impl RTreeObject for IndexedPoint {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_point([self.lat, self.lng])
    }
}

impl PointDistance for IndexedPoint {
    fn distance_2(&self, point: &[f64; 2]) -> f64 {
        let dlat = self.lat - point[0];
        let dlng = self.lng - point[1];
        dlat * dlat + dlng * dlng
    }
}

/// Build R-tree from GPS points for efficient spatial queries
pub fn build_rtree(points: &[GpsPoint]) -> RTree<IndexedPoint> {
    let indexed: Vec<IndexedPoint> = points
        .iter()
        .enumerate()
        .map(|(i, p)| IndexedPoint {
            idx: i,
            lat: p.latitude,
            lng: p.longitude,
        })
        .collect();
    RTree::bulk_load(indexed)
}

/// Check if two tracks' bounding boxes overlap
pub fn bounds_overlap_tracks(track_a: &[GpsPoint], track_b: &[GpsPoint], buffer: f64) -> bool {
    if track_a.is_empty() || track_b.is_empty() {
        return false;
    }

    let bounds_a = compute_bounds(track_a);
    let bounds_b = compute_bounds(track_b);

    // Use reference latitude from center of bounds_a for meter-to-degree conversion
    let ref_lat = (bounds_a.min_lat + bounds_a.max_lat) / 2.0;
    bounds_overlap(&bounds_a, &bounds_b, buffer, ref_lat)
}
