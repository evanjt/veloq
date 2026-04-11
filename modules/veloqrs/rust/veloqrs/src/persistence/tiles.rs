//! Heatmap tile generation for PersistentRouteEngine.
//!
//! Tile generation runs on a background thread with its own SQLite connection,
//! following the same pattern as section detection. The engine mutex is held
//! only briefly to extract metadata (db_path, tiles_path, activity bounds).

use super::{PersistentRouteEngine, TileGenerationHandle};
use crate::tiles;
use log::info;
use rusqlite::{Connection, params};
use std::collections::HashSet;
use std::path::Path;
use std::sync::mpsc;
use tracematch::{Bounds, GpsPoint};

/// Tile format version — increment when tile size, zoom range, or rendering changes.
/// Triggers automatic cache clear + regeneration on app upgrade.
const TILE_FORMAT_VERSION: &str = "6";

/// Expand activity bounds slightly so line antialiasing and low-zoom blur can bleed into
/// neighboring tiles without getting clipped by strict metadata bounds.
const TILE_ENUMERATION_MARGIN_DEGREES: f64 = 0.002;

impl PersistentRouteEngine {
    /// Set the filesystem path where heatmap tiles are stored.
    /// Called once from JS at engine init time.
    /// If the engine already has activities, spawns background tile generation immediately.
    pub fn set_heatmap_tiles_path(&mut self, path: String) {
        info!("[heatmap] Tiles path set to: {}", path);
        self.heatmap_tiles_path = Some(path.clone());

        // Check tile format version — clear stale tiles on upgrade
        let version_file = Path::new(&path).join("version.txt");
        let current_version = std::fs::read_to_string(&version_file).unwrap_or_default();
        if current_version.trim() != TILE_FORMAT_VERSION {
            info!(
                "[heatmap] Tile format changed ({:?} → {}), clearing stale tiles",
                current_version.trim(),
                TILE_FORMAT_VERSION
            );
            tiles::clear_all_tiles(Path::new(&path));
            if let Err(e) = std::fs::create_dir_all(&path) {
                log::warn!(
                    "[heatmap] Failed to create tiles directory {:?}: {}",
                    path,
                    e
                );
            }
            if let Err(e) = std::fs::write(&version_file, TILE_FORMAT_VERSION) {
                log::warn!(
                    "[heatmap] Failed to write version file {:?}: {}",
                    version_file,
                    e
                );
            }
        }

        // If we already have activity data (existing user / upgrade),
        // generate tiles immediately so the map shows the heatmap on first view.
        if !self.activity_metadata.is_empty() {
            if let Some(handle) = self.generate_tiles_background() {
                if let Ok(mut guard) = super::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock() {
                    *guard = Some(handle);
                }
            }
        }
    }

    /// Spawn background tile generation. Extracts metadata while holding &self
    /// (microseconds), then releases. The heavy work runs on a separate thread
    /// with its own SQLite connection.
    ///
    /// Returns None if no tiles path is configured or no activities exist.
    pub fn generate_tiles_background(&self) -> Option<TileGenerationHandle> {
        let tiles_path = self.heatmap_tiles_path.clone()?;
        let db_path = self.db_path.clone();

        if self.activity_metadata.is_empty() {
            return None;
        }

        // Extract all activity bounds from in-memory metadata (fast HashMap iteration)
        let all_bounds: Vec<Bounds> = self
            .activity_metadata
            .values()
            .map(|m| m.bounds.clone())
            .collect();

        let (tx, rx) = mpsc::channel();
        let generated_counter = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let total_counter = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let gen_clone = generated_counter.clone();
        let total_clone = total_counter.clone();

        std::thread::spawn(move || {
            let generated = background_generate_tiles(
                &db_path,
                &tiles_path,
                &all_bounds,
                &gen_clone,
                &total_clone,
            );
            tx.send(generated).ok();
        });

        Some(TileGenerationHandle {
            receiver: rx,
            generated: generated_counter,
            total: total_counter,
        })
    }

    /// Disable heatmap tile generation by clearing the tiles path.
    /// Prevents regeneration on next sync.
    pub fn clear_heatmap_tiles_path(&mut self) {
        info!("[heatmap] Tiles path cleared — generation disabled");
        self.heatmap_tiles_path = None;
    }

    /// Clear all heatmap tiles from disk.
    pub fn clear_heatmap_tiles(&self, base_path: &str) -> u32 {
        tiles::clear_all_tiles(Path::new(base_path))
    }

    /// Delete heatmap tiles within a geographic bounding box across all zoom levels.
    /// Used when activities are removed to prevent stale heatmap traces.
    pub fn invalidate_tiles_for_bounds(&self, bounds: &Bounds) -> u32 {
        if let Some(ref tiles_path) = self.heatmap_tiles_path {
            let config = tiles::HeatmapConfig::default();
            tiles::invalidate_tiles_in_bounds(
                Path::new(tiles_path),
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng,
                config.min_zoom,
                config.max_zoom,
            )
        } else {
            0
        }
    }
}

/// Generate heatmap tiles on a background thread.
/// Opens its own SQLite connection — does NOT touch PERSISTENT_ENGINE.
fn background_generate_tiles(
    db_path: &str,
    tiles_path: &str,
    all_bounds: &[Bounds],
    generated_counter: &std::sync::atomic::AtomicU32,
    total_counter: &std::sync::atomic::AtomicU32,
) -> u32 {
    let start = std::time::Instant::now();
    let base = Path::new(tiles_path);
    let config = tiles::HeatmapConfig::default();

    // Enumerate tile coordinates from each activity bounds rather than the full global bbox.
    // This keeps higher zoom generation tractable for users with travel far apart.
    let mut tile_coords_set: HashSet<(u8, u32, u32)> = HashSet::new();
    for b in all_bounds {
        let min_lat =
            (b.min_lat - TILE_ENUMERATION_MARGIN_DEGREES).clamp(-85.051_128_78, 85.051_128_78);
        let max_lat =
            (b.max_lat + TILE_ENUMERATION_MARGIN_DEGREES).clamp(-85.051_128_78, 85.051_128_78);
        let min_lng = (b.min_lng - TILE_ENUMERATION_MARGIN_DEGREES).clamp(-180.0, 180.0);
        let max_lng = (b.max_lng + TILE_ENUMERATION_MARGIN_DEGREES).clamp(-180.0, 180.0);

        for z in config.min_zoom..=config.max_zoom {
            for (x, y) in tiles::tiles_for_bounds(min_lat, max_lat, min_lng, max_lng, z) {
                tile_coords_set.insert((z, x, y));
            }
        }
    }
    let mut tile_coords: Vec<(u8, u32, u32)> = tile_coords_set.into_iter().collect();
    tile_coords.sort_unstable();

    if tile_coords.is_empty() {
        return 0;
    }

    total_counter.store(tile_coords.len() as u32, std::sync::atomic::Ordering::SeqCst);

    info!(
        "[heatmap] Background: generating {} tiles for {} activities z{}-{}",
        tile_coords.len(),
        all_bounds.len(),
        config.min_zoom,
        config.max_zoom,
    );

    // Open own SQLite connection (same pattern as section detection)
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[heatmap] Failed to open database: {}", e);
            return 0;
        }
    };

    let mut generated = 0u32;
    let mut skipped = 0u32;
    let mut processed = 0u32;
    for (z, x, y) in &tile_coords {
        // Skip tiles that already exist — only generate new ones.
        // Tiles are invalidated (deleted) when activities change via
        // invalidate_tiles_for_bounds(), so existing tiles are up-to-date.
        if tiles::tile_exists(base, *z, *x, *y) {
            skipped += 1;
            processed += 1;
            generated_counter.store(processed, std::sync::atomic::Ordering::SeqCst);
            continue;
        }

        let tb = tiles::tile_bounds(*z, *x, *y);

        // Query activities overlapping this tile directly from SQL
        let activity_ids: Vec<String> = match conn.prepare(
            "SELECT id FROM activities \
             WHERE min_lat <= ?1 AND max_lat >= ?2 \
               AND min_lng <= ?3 AND max_lng >= ?4",
        ) {
            Ok(mut stmt) => stmt
                .query_map(
                    params![tb.max_lat, tb.min_lat, tb.max_lon, tb.min_lon],
                    |row| row.get(0),
                )
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };

        if activity_ids.is_empty() {
            continue;
        }

        // Load GPS tracks from database
        let tracks: Vec<Vec<GpsPoint>> = activity_ids
            .iter()
            .filter_map(|id| load_gps_track(&conn, id))
            .collect();

        if tracks.is_empty() {
            continue;
        }

        match tiles::generate_heatmap_tile(*z, *x, *y, &tracks) {
            Some(png_data) => {
                if tiles::save_tile(base, *z, *x, *y, &png_data).is_ok() {
                    generated += 1;
                }
            }
            None => {}
        }
        processed += 1;
        generated_counter.store(processed, std::sync::atomic::Ordering::SeqCst);
    }

    info!(
        "[heatmap] Background: generated {} tiles, skipped {} existing, in {}ms",
        generated,
        skipped,
        start.elapsed().as_millis()
    );
    generated
}

/// Load a GPS track from the database (used by background thread).
fn load_gps_track(conn: &Connection, activity_id: &str) -> Option<Vec<GpsPoint>> {
    conn.query_row(
        "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
        params![activity_id],
        |row| {
            let blob: Vec<u8> = row.get(0)?;
            match rmp_serde::from_slice(&blob) {
                Ok(track) => Ok(track),
                Err(e) => {
                    log::warn!(
                        "[heatmap] Failed to deserialize GPS track for activity {}: {}",
                        activity_id,
                        e
                    );
                    // Return empty track so one bad record doesn't halt tile generation
                    Ok(Vec::new())
                }
            }
        },
    )
    .ok()
}
