//! Heatmap tile generation methods for PersistentRouteEngine.
//!
//! Uses the R-tree spatial index to load only relevant GPS tracks per tile,
//! then delegates to the `tiles` module for rendering.

use super::PersistentRouteEngine;
use crate::tiles;
use log::info;
use rstar::AABB;
use std::path::Path;

impl PersistentRouteEngine {
    /// Generate heatmap tiles for a bounding box at the specified zoom levels.
    /// Uses the R-tree to load only GPS tracks that intersect each tile's bounds.
    /// Returns the number of tiles written to disk (excluding empty sentinels).
    pub fn generate_heatmap_tiles(
        &self,
        base_path: &str,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
        min_zoom: u8,
        max_zoom: u8,
    ) -> u32 {
        let base = Path::new(base_path);
        let start = std::time::Instant::now();

        // Collect all tile coordinates across zoom levels, skipping existing tiles
        let mut tile_coords: Vec<(u8, u32, u32)> = Vec::new();
        for z in min_zoom..=max_zoom {
            for (x, y) in tiles::tiles_for_bounds(min_lat, max_lat, min_lng, max_lng, z) {
                if !tiles::tile_exists(base, z, x, y) {
                    tile_coords.push((z, x, y));
                }
            }
        }

        if tile_coords.is_empty() {
            return 0;
        }

        info!(
            "[heatmap] Generating {} tiles for bounds ({:.2},{:.2})-({:.2},{:.2}) z{}-{}",
            tile_coords.len(),
            min_lat,
            min_lng,
            max_lat,
            max_lng,
            min_zoom,
            max_zoom,
        );

        // For each tile, use R-tree to find relevant activities and load their tracks
        let mut generated = 0u32;
        for (z, x, y) in &tile_coords {
            let tb = tiles::tile_bounds(*z, *x, *y);

            // Query R-tree for activities intersecting this tile
            let search_bounds = AABB::from_corners(
                [tb.min_lon, tb.min_lat],
                [tb.max_lon, tb.max_lat],
            );
            let activity_ids: Vec<String> = self
                .spatial_index
                .locate_in_envelope_intersecting(&search_bounds)
                .map(|b| b.activity_id.clone())
                .collect();

            if activity_ids.is_empty() {
                // No activities touch this tile — write sentinel
                let _ = tiles::save_empty_sentinel(base, *z, *x, *y);
                continue;
            }

            // Load GPS tracks for matching activities
            let tracks: Vec<Vec<tracematch::GpsPoint>> = activity_ids
                .iter()
                .filter_map(|id| self.get_gps_track(id))
                .collect();

            if tracks.is_empty() {
                let _ = tiles::save_empty_sentinel(base, *z, *x, *y);
                continue;
            }

            // Generate the tile
            match tiles::generate_heatmap_tile(*z, *x, *y, &tracks) {
                Some(png_data) => {
                    if tiles::save_tile(base, *z, *x, *y, &png_data).is_ok() {
                        generated += 1;
                    }
                }
                None => {
                    let _ = tiles::save_empty_sentinel(base, *z, *x, *y);
                }
            }
        }

        info!(
            "[heatmap] Generated {} tiles in {}ms",
            generated,
            start.elapsed().as_millis()
        );
        generated
    }

    /// Invalidate (delete) heatmap tiles that intersect with the given bounds.
    /// Called after new activities are synced to mark affected tiles as stale.
    pub fn invalidate_heatmap_tiles(
        &self,
        base_path: &str,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> u32 {
        let config = tiles::HeatmapConfig::default();
        tiles::invalidate_tiles_in_bounds(
            Path::new(base_path),
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            config.min_zoom,
            config.max_zoom,
        )
    }

    /// Clear all heatmap tiles from disk.
    pub fn clear_heatmap_tiles(&self, base_path: &str) -> u32 {
        tiles::clear_all_tiles(Path::new(base_path))
    }
}
