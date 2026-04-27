//! Heatmap tile generation for PersistentRouteEngine.
//!
//! Tile generation runs on a background thread with its own SQLite connection,
//! following the same pattern as section detection. The engine mutex is held
//! only briefly to extract metadata (db_path, tiles_path, activity bounds).

use super::{PersistentRouteEngine, TileGenerationHandle, codec};
use crate::tiles;
use log::info;
use rayon::prelude::*;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use tracematch::{Bounds, GpsPoint};

/// Tile format version — increment when tile size, zoom range, or rendering changes.
/// Triggers automatic cache clear + regeneration on app upgrade.
const TILE_FORMAT_VERSION: &str = "7";

/// Marker file written to the tiles directory when new data arrives.
/// Cleared after tile generation completes. Prevents redundant generation on app restart.
const DIRTY_MARKER: &str = ".dirty";

impl PersistentRouteEngine {
    /// Check whether heatmap tiles need (re)generation.
    /// Returns true if the dirty marker exists or no version file is present (first time / cache cleared).
    pub fn is_heatmap_dirty(&self) -> bool {
        let Some(ref path) = self.heatmap_tiles_path else {
            return false;
        };
        let base = Path::new(path);
        // No version file → first time or OS cleared cache → needs generation
        if !base.join("version.txt").exists() {
            return true;
        }
        // Dirty marker present → new data arrived since last generation
        base.join(DIRTY_MARKER).exists()
    }

    /// Mark heatmap tiles as needing regeneration.
    /// Writes a `.dirty` marker file in the tiles directory.
    pub fn mark_heatmap_dirty(&self) {
        let Some(ref path) = self.heatmap_tiles_path else {
            return;
        };
        let base = Path::new(path);
        if let Err(e) = std::fs::create_dir_all(base) {
            log::warn!("[heatmap] Failed to create tiles directory for dirty marker: {}", e);
            return;
        }
        if let Err(e) = std::fs::write(base.join(DIRTY_MARKER), b"") {
            log::warn!("[heatmap] Failed to write dirty marker: {}", e);
        }
    }

    /// Set the filesystem path where heatmap tiles are stored.
    /// Called once from JS at engine init time.
    /// If the engine already has activities and tiles are stale, spawns background generation.
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
            // Format changed — mark dirty so generation runs
            self.mark_heatmap_dirty();
        }

        // Only generate if tiles are stale (new data, format change, first time, or cache cleared).
        // Skips the expensive tile enumeration + file-existence checks on normal app restart.
        if !self.activity_metadata.is_empty() && self.is_heatmap_dirty() {
            info!("[heatmap] Tiles are stale — spawning background generation");
            if let Some(handle) = self.generate_tiles_background() {
                if let Ok(mut guard) = super::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock() {
                    *guard = Some(handle);
                }
            }
        } else if !self.activity_metadata.is_empty() {
            info!("[heatmap] Tiles are up to date — skipping generation");
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

        // Extract all activity (id, bounds) pairs from in-memory metadata.
        // The background thread uses IDs to bulk-load GPS tracks and bounds
        // for an early tile/bounds intersection filter.
        let activities: Vec<(String, Bounds)> = self
            .activity_metadata
            .iter()
            .map(|(id, m)| (id.clone(), m.bounds.clone()))
            .collect();

        let (tx, rx) = mpsc::channel();
        let generated_counter = Arc::new(AtomicU32::new(0));
        let total_counter = Arc::new(AtomicU32::new(0));
        let gen_clone = generated_counter.clone();
        let total_clone = total_counter.clone();

        std::thread::spawn(move || {
            let generated = background_generate_tiles(
                &db_path,
                &tiles_path,
                &activities,
                &gen_clone,
                &total_clone,
            );
            clear_dirty_marker(&tiles_path);
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

    /// Clear all heatmap tiles from disk and mark as dirty so they regenerate when re-enabled.
    pub fn clear_heatmap_tiles(&self, base_path: &str) -> u32 {
        let count = tiles::clear_all_tiles(Path::new(base_path));
        if count > 0 {
            self.mark_heatmap_dirty();
        }
        count
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

/// Remove the dirty marker from the tiles directory after successful generation.
fn clear_dirty_marker(tiles_path: &str) {
    let marker = Path::new(tiles_path).join(DIRTY_MARKER);
    if marker.exists() {
        if let Err(e) = std::fs::remove_file(&marker) {
            log::warn!("[heatmap] Failed to clear dirty marker: {}", e);
        }
    }
}

/// Generate heatmap tiles on a background thread.
/// Opens its own SQLite connection — does NOT touch PERSISTENT_ENGINE.
///
/// Pipeline (rewritten for Tier 1.1/1.3):
/// 1. Bulk-load every activity's GPS track into an in-memory Arc-cache.
/// 2. Iterate activities × zooms, using polyline-swept tile enumeration to
///    build a `(z,x,y) → [Arc<track>]` map.
/// 3. Filter out tiles that already exist on disk (incremental safeguard).
/// 4. Parallel-generate each tile (rayon) + write PNG.
///
/// Strictly better than the old per-tile loop: GPS tracks are deserialized
/// once instead of once-per-tile, empty bbox tiles are never enumerated, and
/// the slow rasterization+PNG encode parallelises across cores.
fn background_generate_tiles(
    db_path: &str,
    tiles_path: &str,
    activities: &[(String, Bounds)],
    generated_counter: &AtomicU32,
    total_counter: &AtomicU32,
) -> u32 {
    let start = std::time::Instant::now();
    let base = Path::new(tiles_path);
    let config = tiles::HeatmapConfig::default();

    if activities.is_empty() {
        return 0;
    }

    // Open own SQLite connection (same pattern as section detection).
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[heatmap] Failed to open database: {}", e);
            return 0;
        }
    };

    // --- Phase 1: bulk-load all GPS tracks into an Arc cache ----------------
    let load_started = std::time::Instant::now();
    let tracks_by_id = bulk_load_tracks(&conn, activities);
    let load_ms = load_started.elapsed().as_millis();

    // --- Phase 2: build (z,x,y) → [Arc<track>] via polyline sweep ------------
    let plan_started = std::time::Instant::now();
    let mut tile_tracks: HashMap<(u8, u32, u32), Vec<Arc<Vec<GpsPoint>>>> = HashMap::new();
    for (id, _bounds) in activities {
        let Some(track) = tracks_by_id.get(id) else {
            continue;
        };
        if track.is_empty() {
            continue;
        }
        for z in config.min_zoom..=config.max_zoom {
            for coord in tiles::tiles_along_track(track, z) {
                tile_tracks
                    .entry((z, coord.0, coord.1))
                    .or_default()
                    .push(Arc::clone(track));
            }
        }
    }
    let plan_ms = plan_started.elapsed().as_millis();

    // --- Phase 3: filter existing, sort for deterministic progress ----------
    let mut pending: Vec<((u8, u32, u32), Vec<Arc<Vec<GpsPoint>>>)> = tile_tracks
        .into_iter()
        .filter(|(coord, _)| !tiles::tile_exists(base, coord.0, coord.1, coord.2))
        .collect();
    // Deterministic ordering keeps progress reporting stable across runs —
    // otherwise HashMap iteration order shuffles `processed_counter` deltas.
    pending.sort_unstable_by_key(|((z, x, y), _)| (*z, *x, *y));

    let total = pending.len() as u32;
    total_counter.store(total, Ordering::SeqCst);

    if total == 0 {
        info!(
            "[heatmap] Background: nothing to generate (load={}ms plan={}ms)",
            load_ms, plan_ms
        );
        return 0;
    }

    info!(
        "[heatmap] Background: generating {} tiles for {} activities z{}-{} (load={}ms plan={}ms)",
        total,
        activities.len(),
        config.min_zoom,
        config.max_zoom,
        load_ms,
        plan_ms,
    );

    // --- Phase 4: parallel rasterize + save ---------------------------------
    // Each worker owns its own refs; Arc<Vec<GpsPoint>> is shared so we don't
    // deep-clone tracks across threads. No SQLite connection inside workers.
    let generated = AtomicU32::new(0);
    let processed = AtomicU32::new(0);

    pending.par_iter().for_each(|(coord, arcs)| {
        // Build a slice-of-slices view without deep-cloning the track data;
        // each `&[GpsPoint]` impls `AsRef<[GpsPoint]>`, matching the
        // generic bound on `generate_heatmap_tile`.
        let slices: Vec<&[GpsPoint]> = arcs.iter().map(|a| a.as_slice()).collect();
        if let Some(png_data) =
            tiles::generate_heatmap_tile(coord.0, coord.1, coord.2, &slices)
        {
            if tiles::save_tile(base, coord.0, coord.1, coord.2, &png_data).is_ok() {
                generated.fetch_add(1, Ordering::Relaxed);
            }
        }
        let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
        generated_counter.store(done, Ordering::SeqCst);
    });

    let generated = generated.load(Ordering::SeqCst);

    info!(
        "[heatmap] Background: generated {} tiles / {} scheduled, total wall time {}ms",
        generated,
        total,
        start.elapsed().as_millis()
    );
    generated
}

/// Bulk-load every activity's GPS track in chunked `IN (...)` queries.
/// Returns a map from activity_id → Arc<Vec<GpsPoint>>. Missing rows and
/// failed deserialization log warnings and are omitted (same behaviour as
/// the old per-tile `load_gps_track`).
fn bulk_load_tracks(
    conn: &Connection,
    activities: &[(String, Bounds)],
) -> HashMap<String, Arc<Vec<GpsPoint>>> {
    // SQLite's default parameter limit is 999; chunk well under that so the
    // query never fails for large corpora.
    const CHUNK: usize = 500;
    let mut out: HashMap<String, Arc<Vec<GpsPoint>>> = HashMap::with_capacity(activities.len());

    for chunk in activities.chunks(CHUNK) {
        let placeholders: String = std::iter::repeat("?")
            .take(chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
            placeholders
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[heatmap] bulk-load prepare failed: {}", e);
                continue;
            }
        };

        let ids: Vec<&str> = chunk.iter().map(|(id, _)| id.as_str()).collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        });

        let rows = match rows {
            Ok(r) => r,
            Err(e) => {
                log::error!("[heatmap] bulk-load query failed: {}", e);
                continue;
            }
        };

        for row in rows {
            let Ok((id, blob)) = row else { continue };
            match codec::deserialize_points(&blob) {
                Ok(track) => {
                    out.insert(id, Arc::new(track));
                }
                Err(e) => {
                    log::warn!(
                        "[heatmap] Failed to deserialize GPS track for activity {}: {}",
                        id,
                        e
                    );
                    out.insert(id, Arc::new(Vec::new()));
                }
            }
        }
    }

    out
}
