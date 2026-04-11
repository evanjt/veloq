//! Activity management: CRUD, GPS tracks, signatures, spatial queries, time streams.

use crate::{ActivityMatchInfo, ActivityMetrics, Bounds, GpsPoint, RouteSignature};
use rstar::{AABB, RTree};
use rusqlite::{Result as SqlResult, params, types::Type};

use super::{ActivityBoundsEntry, ActivityMetadata, MapActivityComplete, PersistentRouteEngine};

impl PersistentRouteEngine {
    // ========================================================================
    // Loading
    // ========================================================================

    /// Load activity metadata into memory (lightweight).
    pub(super) fn load_metadata(&mut self) -> SqlResult<()> {
        self.activity_metadata.clear();

        let mut stmt = self
            .db
            .prepare("SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng FROM activities")?;

        let entries: Vec<ActivityBoundsEntry> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let sport_type: String = row.get(1)?;
                let bounds = Bounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                };

                self.activity_metadata.insert(
                    id.clone(),
                    ActivityMetadata {
                        id: id.clone(),
                        sport_type,
                        bounds,
                    },
                );

                Ok(ActivityBoundsEntry {
                    activity_id: id,
                    bounds,
                })
            })?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                Err(e) => {
                    log::warn!("Skipping malformed row during metadata loading: {:?}", e);
                    None
                }
            })
            .collect();

        self.spatial_index = RTree::bulk_load(entries);
        Ok(())
    }

    /// Load activity match info from the database.
    pub(super) fn load_activity_matches(&mut self) -> SqlResult<()> {
        self.activity_matches.clear();

        let mut stmt = self.db.prepare(
            "SELECT route_id, activity_id, match_percentage, direction FROM activity_matches",
        )?;

        let matches: Vec<(String, ActivityMatchInfo)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ActivityMatchInfo {
                        activity_id: row.get(1)?,
                        match_percentage: row.get(2)?,
                        direction: {
                            let s: String = row.get(3)?;
                            s.parse().map_err(|_: ()| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    3,
                                    Type::Text,
                                    Box::new(std::io::Error::new(
                                        std::io::ErrorKind::InvalidData,
                                        "invalid direction",
                                    )),
                                )
                            })?
                        },
                    },
                ))
            })?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                Err(e) => {
                    log::warn!(
                        "Skipping malformed row during activity match loading: {:?}",
                        e
                    );
                    None
                }
            })
            .collect();

        // Group by route_id
        for (route_id, match_info) in matches {
            self.activity_matches
                .entry(route_id)
                .or_default()
                .push(match_info);
        }

        Ok(())
    }

    /// Load activity metrics from the database.
    pub(super) fn load_activity_metrics(&mut self) -> SqlResult<()> {
        self.activity_metrics.clear();

        let mut stmt = self.db.prepare(
            "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                    elevation_gain, avg_hr, avg_power, sport_type
             FROM activity_metrics",
        )?;

        let metrics_iter = stmt.query_map([], |row| {
            Ok(ActivityMetrics {
                activity_id: row.get(0)?,
                name: row.get(1)?,
                date: row.get(2)?,
                distance: row.get(3)?,
                moving_time: row.get(4)?,
                elapsed_time: row.get(5)?,
                elevation_gain: row.get(6)?,
                avg_hr: row.get::<_, Option<i32>>(7)?.map(|v| v as u16),
                avg_power: row.get::<_, Option<i32>>(8)?.map(|v| v as u16),
                sport_type: row.get(9)?,
            })
        })?;

        for m in metrics_iter.flatten() {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }

        Ok(())
    }

    // ========================================================================
    // Activity Management
    // ========================================================================

    /// Add an activity with its GPS coordinates.
    pub fn add_activity(
        &mut self,
        id: String,
        coords: Vec<GpsPoint>,
        sport_type: String,
    ) -> SqlResult<()> {
        let bounds = Bounds::from_points(&coords).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });

        // Create signature
        let signature = RouteSignature::from_points(&id, &coords, &self.match_config);

        // Store to database
        self.store_activity(&id, &sport_type, &bounds)?;
        self.store_gps_track(&id, &coords)?;
        if let Some(sig) = &signature {
            self.store_signature(&id, sig)?;
            // Also cache it since we just computed it
            self.signature_cache.put(id.clone(), sig.clone());
        }

        // Update in-memory state
        let metadata = ActivityMetadata {
            id: id.clone(),
            sport_type,
            bounds,
        };
        self.activity_metadata.insert(id.clone(), metadata);

        // Rebuild spatial index (could be optimized with incremental insert)
        self.rebuild_spatial_index();

        // Mark computed results as dirty
        self.groups_dirty = true;
        self.sections_dirty = true;

        Ok(())
    }

    /// Add an activity from flat coordinate buffer.
    /// Remove an activity.
    pub fn remove_activity(&mut self, id: &str) -> SqlResult<()> {
        // Capture bounds before removal for heatmap tile invalidation
        let removed_bounds = self.activity_metadata.get(id).map(|m| m.bounds.clone());

        // Remove from database (cascade deletes signature and track)
        self.db
            .execute("DELETE FROM activities WHERE id = ?", params![id])?;

        // Remove from memory
        self.activity_metadata.remove(id);
        self.signature_cache.pop(&id.to_string());
        self.consensus_cache.clear(); // Invalidate all consensus since groups may change

        self.rebuild_spatial_index();

        self.groups_dirty = true;
        self.sections_dirty = true;

        // Invalidate heatmap tiles covering the removed activity
        // Add small margin (~100m) to catch edge tiles where GPS points bled into neighbors
        if let Some(ref bounds) = removed_bounds {
            if let Some(ref tiles_path) = self.heatmap_tiles_path {
                let config = crate::tiles::HeatmapConfig::default();
                let path = std::path::Path::new(tiles_path);
                let margin = 0.001; // ~111m at equator
                let deleted = crate::tiles::invalidate_tiles_in_bounds(
                    path,
                    bounds.min_lat - margin,
                    bounds.max_lat + margin,
                    bounds.min_lng - margin,
                    bounds.max_lng + margin,
                    config.min_zoom,
                    config.max_zoom,
                );
                if deleted > 0 {
                    log::info!(
                        "[heatmap] Invalidated {} tiles for removed activity {}",
                        deleted,
                        id
                    );
                    self.mark_heatmap_dirty();
                }
            }
        }

        Ok(())
    }

    /// Clear all data.
    pub fn clear(&mut self) -> SqlResult<()> {
        self.db.execute_batch(
            "DELETE FROM section_activities;
             DELETE FROM sections;
             DELETE FROM route_groups;
             DELETE FROM gps_tracks;
             DELETE FROM signatures;
             DELETE FROM activities;
             DELETE FROM activity_metrics;
             DELETE FROM activity_matches;
             DELETE FROM time_streams;
             DELETE FROM overlap_cache;
             DELETE FROM processed_activities;",
        )?;

        self.activity_metadata.clear();
        self.activity_metrics.clear();
        self.spatial_index = RTree::new();
        self.signature_cache.clear();
        self.consensus_cache.clear();
        self.groups.clear();
        self.sections.clear();
        self.processed_activity_ids.clear();
        self.time_streams.clear();
        self.groups_dirty = false;
        self.sections_dirty = false;
        self.invalidate_perf_cache();

        Ok(())
    }

    /// Clear only route/section data, keeping GPS tracks and activities intact.
    /// Used when route matching is toggled off to free section memory
    /// without losing the underlying GPS data (needed for heatmap).
    pub fn clear_routes_and_sections(&mut self) -> SqlResult<()> {
        self.db.execute_batch(
            "DELETE FROM section_activities;
             DELETE FROM sections;
             DELETE FROM route_groups;
             DELETE FROM activity_matches;
             DELETE FROM overlap_cache;",
        )?;

        self.groups.clear();
        self.sections.clear();
        self.consensus_cache.clear();
        self.groups_dirty = true;
        self.sections_dirty = true;
        self.invalidate_perf_cache();

        log::info!("[engine] Cleared routes and sections (GPS tracks preserved)");
        Ok(())
    }

    /// Remove activities older than the specified retention period.
    ///
    /// This cleans up old activities and their associated data (GPS tracks, signatures)
    /// to prevent unbounded database growth. Cascade deletes handle related data automatically.
    ///
    /// # Arguments
    /// * `retention_days` - Number of days to retain activities (0 = keep all, 30-365 for cleanup)
    ///
    /// # Returns
    /// * `Ok(deleted_count)` - Number of activities deleted
    /// * `Err(...)` - Database error
    ///
    /// # Side Effects
    /// * Marks groups and sections as dirty for re-computation
    /// * Reloads metadata from database
    ///
    /// # Example
    /// ```no_run
    /// # use veloqrs::persistence::PersistentRouteEngine;
    /// # let mut engine: PersistentRouteEngine = unsafe { std::mem::zeroed() };
    /// // Delete activities older than 90 days
    /// let deleted = engine.cleanup_old_activities(90).unwrap();
    /// println!("Deleted {} old activities", deleted);
    ///
    /// // Keep all activities (retention_days = 0)
    /// let deleted = engine.cleanup_old_activities(0).unwrap();
    /// assert_eq!(deleted, 0);
    /// ```
    pub fn cleanup_old_activities(&mut self, retention_days: u32) -> SqlResult<u32> {
        // If retention_days is 0, keep all activities
        if retention_days == 0 {
            log::info!(
                "tracematch: [PersistentEngine] Cleanup skipped: retention period is 0 (keep all)"
            );
            return Ok(0);
        }

        // Calculate cutoff timestamp (current time - retention period)
        let cutoff_seconds = retention_days as i64 * 24 * 60 * 60;

        // Delete old activities (cascade will handle signatures, GPS tracks, matches)
        let deleted = self.db.execute(
            "DELETE FROM activities WHERE created_at < (strftime('%s', 'now') - ?)",
            params![cutoff_seconds],
        )?;

        // If any activities were deleted, reload metadata and mark for re-computation
        if deleted > 0 {
            // Clear affected caches
            self.signature_cache.clear();
            self.consensus_cache.clear();

            // Reload metadata from database
            self.load_metadata()?;

            // Mark groups and sections as dirty since activities changed
            self.groups_dirty = true;
            self.sections_dirty = true;

            log::info!(
                "tracematch: [PersistentEngine] Cleaned up {} activities older than {} days",
                deleted,
                retention_days
            );
        }

        Ok(deleted as u32)
    }

    /// Force re-computation of route groups and sections.
    ///
    /// This should be called when historical activities are added (e.g., cache expansion)
    /// to improve route quality with the new data. The next call to `get_groups()` or
    /// `get_sections()` will trigger re-computation with the expanded dataset.
    ///
    /// # Example
    /// ```no_run
    /// # use veloqrs::persistence::PersistentRouteEngine;
    /// # let mut engine: PersistentRouteEngine = unsafe { std::mem::zeroed() };
    /// // User expanded cache from 90 days to 1 year
    /// engine.mark_for_recomputation();
    /// // Next access to groups/sections will re-compute with improved data
    /// let groups = engine.get_groups();
    /// ```
    pub fn mark_for_recomputation(&mut self) {
        if !self.groups_dirty && !self.sections_dirty {
            self.groups_dirty = true;
            self.sections_dirty = true;
            log::info!("tracematch: [PersistentEngine] Marked for re-computation (cache expanded)");
        }
    }

    // ========================================================================
    // Database Storage
    // ========================================================================

    pub(super) fn store_activity(
        &self,
        id: &str,
        sport_type: &str,
        bounds: &Bounds,
    ) -> SqlResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                id,
                sport_type,
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng
            ],
        )?;
        Ok(())
    }

    /// Update activity metadata (date, name, distance, duration).
    /// Called after GPS sync to add metadata from intervals.icu API.
    pub fn update_activity_metadata(
        &self,
        id: &str,
        start_date: Option<i64>,
        name: Option<&str>,
        distance_meters: Option<f64>,
        duration_secs: Option<i64>,
    ) -> SqlResult<()> {
        self.db.execute(
            "UPDATE activities SET start_date = ?, name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
            params![start_date, name, distance_meters, duration_secs, id],
        )?;
        Ok(())
    }

    pub(super) fn store_gps_track(&self, id: &str, coords: &[GpsPoint]) -> SqlResult<()> {
        let track_data = rmp_serde::to_vec(coords)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.db.execute(
            "INSERT OR REPLACE INTO gps_tracks (activity_id, track_data, point_count)
             VALUES (?, ?, ?)",
            params![id, track_data, coords.len() as i64],
        )?;
        Ok(())
    }

    pub(super) fn store_signature(&self, id: &str, sig: &RouteSignature) -> SqlResult<()> {
        let points_blob = rmp_serde::to_vec(&sig.points)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.db.execute(
            "INSERT OR REPLACE INTO signatures (activity_id, points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance, point_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                points_blob,
                sig.start_point.latitude,
                sig.start_point.longitude,
                sig.end_point.latitude,
                sig.end_point.longitude,
                sig.total_distance,
                sig.points.len() as i64
            ],
        )?;
        Ok(())
    }

    pub(super) fn rebuild_spatial_index(&mut self) {
        let entries: Vec<ActivityBoundsEntry> = self
            .activity_metadata
            .values()
            .map(|m| ActivityBoundsEntry {
                activity_id: m.id.clone(),
                bounds: m.bounds,
            })
            .collect();
        self.spatial_index = RTree::bulk_load(entries);
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /// Get activity count.
    pub fn activity_count(&self) -> usize {
        self.activity_metadata.len()
    }
    /// Get all activity IDs.
    pub fn get_activity_ids(&self) -> Vec<String> {
        self.activity_metadata.keys().cloned().collect()
    }

    /// Get activity IDs filtered by sport type.
    pub fn get_activity_ids_by_sport(&self, sport_type: &str) -> Vec<String> {
        self.activity_metadata
            .iter()
            .filter(|(_, meta)| meta.sport_type == sport_type)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Check if an activity exists.
    pub fn has_activity(&self, id: &str) -> bool {
        self.activity_metadata.contains_key(id)
    }

    /// Query activities within a viewport.
    pub fn query_viewport(&self, bounds: &Bounds) -> Vec<String> {
        let search_bounds = AABB::from_corners(
            [bounds.min_lng, bounds.min_lat],
            [bounds.max_lng, bounds.max_lat],
        );

        self.spatial_index
            .locate_in_envelope_intersecting(&search_bounds)
            .map(|b| b.activity_id.clone())
            .collect()
    }

    /// Get all activities with complete metadata for map display.
    /// Queries the database for metadata fields (date, name, distance, duration).
    /// Get activities filtered by date range and sport types.
    /// - start_ts: Unix timestamp (seconds) for start of range
    /// - end_ts: Unix timestamp (seconds) for end of range
    /// - sport_types: Optional list of sport types to include (empty = all)
    pub fn get_map_activities_filtered(
        &self,
        start_ts: i64,
        end_ts: i64,
        sport_types: &[String],
    ) -> Vec<MapActivityComplete> {
        // Build query based on filters
        let base_query = "SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 COALESCE(start_date, 0) as start_date,
                                 COALESCE(name, '') as name,
                                 COALESCE(distance_meters, 0.0) as distance_meters,
                                 COALESCE(duration_secs, 0) as duration_secs
                          FROM activities
                          WHERE (start_date IS NULL OR (start_date >= ? AND start_date <= ?))";

        let query = if sport_types.is_empty() {
            base_query.to_string()
        } else {
            let placeholders = sport_types
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            format!("{} AND sport_type IN ({})", base_query, placeholders)
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[PersistentEngine] Failed to prepare filtered query: {}", e);
                return Vec::new();
            }
        };

        // Build params
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(start_ts), Box::new(end_ts)];
        for sport in sport_types {
            params.push(Box::new(sport.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let results = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(MapActivityComplete {
                activity_id: row.get(0)?,
                sport_type: row.get(1)?,
                bounds: crate::FfiBounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                },
                date: row.get(6)?,
                name: row.get(7)?,
                distance: row.get(8)?,
                duration: row.get(9)?,
            })
        });

        match results {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                log::error!(
                    "[PersistentEngine] Failed to query filtered activities: {}",
                    e
                );
                Vec::new()
            }
        }
    }

    /// Get a signature, loading from DB if not cached.
    pub fn get_signature(&mut self, id: &str) -> Option<RouteSignature> {
        // Check cache first
        if let Some(sig) = self.signature_cache.get(&id.to_string()) {
            return Some(sig.clone());
        }

        // Load from database
        let sig = self.load_signature_from_db(id)?;
        self.signature_cache.put(id.to_string(), sig.clone());
        Some(sig)
    }

    fn load_signature_from_db(&self, id: &str) -> Option<RouteSignature> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance
                 FROM signatures WHERE activity_id = ?",
            )
            .ok()?;

        stmt.query_row(params![id], |row| {
            let points_blob: Vec<u8> = row.get(0)?;
            let points: Vec<GpsPoint> = rmp_serde::from_slice(&points_blob).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, Box::new(e))
            })?;
            let start_point = GpsPoint::new(row.get(1)?, row.get(2)?);
            let end_point = GpsPoint::new(row.get(3)?, row.get(4)?);
            let total_distance: f64 = row.get(5)?;

            // Compute bounds and center from points
            let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });
            let center = bounds.center();

            Ok(RouteSignature {
                activity_id: id.to_string(),
                points,
                total_distance,
                start_point,
                end_point,
                bounds,
                center,
            })
        })
        .ok()
    }

    /// Get all map signatures in a single query.
    /// Returns lightweight flat-coord signatures for map rendering.
    /// Bypasses LRU cache since we want all rows at once.
    pub fn get_all_map_signatures(&self) -> Vec<crate::ffi_types::FfiMapSignature> {
        let mut stmt = match self
            .db
            .prepare("SELECT activity_id, points FROM signatures")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| {
            let activity_id: String = row.get(0)?;
            let points_blob: Vec<u8> = row.get(1)?;
            Ok((activity_id, points_blob))
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let mut result = Vec::new();
        for row in rows {
            let (activity_id, points_blob) = match row {
                Ok(r) => r,
                Err(_) => continue,
            };
            let points: Vec<GpsPoint> = match rmp_serde::from_slice(&points_blob) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if points.is_empty() {
                continue;
            }

            // Compute center from bounds
            let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });
            let center = bounds.center();

            // Flatten points to [lat, lng, lat, lng, ...]
            let mut coords = Vec::with_capacity(points.len() * 2);
            for p in &points {
                coords.push(p.latitude);
                coords.push(p.longitude);
            }

            result.push(crate::ffi_types::FfiMapSignature {
                activity_id,
                coords,
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    /// Get GPS track from database (on-demand, never cached).
    pub fn get_gps_track(&self, id: &str) -> Option<Vec<GpsPoint>> {
        let mut stmt = self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![id], |row| {
            let track_blob: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&track_blob).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, Box::new(e))
            })?)
        })
        .ok()
    }

    /// Get all GPS tracks from database for tile generation.
    /// Returns a vector of track point arrays, suitable for heatmap rendering.
    pub fn get_all_tracks(&self) -> Vec<Vec<GpsPoint>> {
        log::info!("[get_all_tracks] Starting query...");

        let mut stmt = match self.db.prepare("SELECT track_data FROM gps_tracks") {
            Ok(s) => s,
            Err(e) => {
                log::error!("[get_all_tracks] Failed to prepare statement: {:?}", e);
                return Vec::new();
            }
        };

        let rows = stmt.query_map([], |row| {
            let track_blob: Vec<u8> = row.get(0)?;
            let blob_len = track_blob.len();
            let track = rmp_serde::from_slice::<Vec<GpsPoint>>(&track_blob).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, Box::new(e))
            })?;
            log::debug!(
                "[get_all_tracks] Blob {} bytes -> {} points",
                blob_len,
                track.len()
            );
            Ok(track)
        });

        match rows {
            Ok(iter) => {
                let mut success_count = 0;
                let mut error_count = 0;
                let mut empty_count = 0;
                let mut total_points = 0usize;
                let mut sample_points: Vec<(f64, f64)> = Vec::new();

                let result: Vec<Vec<GpsPoint>> = iter
                    .filter_map(|r| match r {
                        Ok(track) => {
                            if track.is_empty() {
                                empty_count += 1;
                                None
                            } else {
                                // Sample first few points from first track
                                if success_count == 0 && sample_points.len() < 5 {
                                    for point in track.iter().take(5) {
                                        sample_points.push((point.latitude, point.longitude));
                                    }
                                }
                                total_points += track.len();
                                success_count += 1;
                                Some(track)
                            }
                        }
                        Err(e) => {
                            error_count += 1;
                            log::warn!("[get_all_tracks] Row error: {:?}", e);
                            None
                        }
                    })
                    .collect();

                log::info!(
                    "[get_all_tracks] Results: {} tracks, {} total points, {} errors, {} empty",
                    success_count,
                    total_points,
                    error_count,
                    empty_count
                );

                if !sample_points.is_empty() {
                    log::info!(
                        "[get_all_tracks] Sample points from first track: {:?}",
                        sample_points
                    );
                }

                result
            }
            Err(e) => {
                log::error!("[get_all_tracks] Query failed: {:?}", e);
                Vec::new()
            }
        }
    }

    /// Load original GPS track from database (separate function to avoid borrow issues)
    pub(super) fn load_gps_track_from_db(&self, activity_id: &str) -> Option<Vec<GpsPoint>> {
        let mut stmt = self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![activity_id], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&data).ok())
        })
        .ok()
        .flatten()
    }

    // ========================================================================
    // Time Streams (for section performance calculations)
    // ========================================================================

    /// Store time stream to database.
    pub(super) fn store_time_stream(&self, activity_id: &str, times: &[u32]) -> SqlResult<()> {
        let times_blob = rmp_serde::to_vec(times)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.db.execute(
            "INSERT OR REPLACE INTO time_streams (activity_id, times, point_count)
             VALUES (?, ?, ?)",
            params![activity_id, times_blob, times.len() as i64],
        )?;
        Ok(())
    }

    /// Load time stream from database.
    pub(super) fn load_time_stream(&self, activity_id: &str) -> Option<Vec<u32>> {
        let mut stmt = self
            .db
            .prepare("SELECT times FROM time_streams WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![activity_id], |row| {
            let times_blob: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&times_blob).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, Box::new(e))
            })?)
        })
        .ok()
    }

    /// Check which activities are missing time streams (not in memory or SQLite).
    /// Returns list of activity IDs that need to be fetched from the API.
    pub fn get_activities_missing_time_streams(&self, activity_ids: &[String]) -> Vec<String> {
        if activity_ids.is_empty() {
            return Vec::new();
        }

        // First filter out any that are already in memory
        let not_in_memory: Vec<&String> = activity_ids
            .iter()
            .filter(|id| !self.time_streams.contains_key(*id))
            .collect();

        if not_in_memory.is_empty() {
            return Vec::new();
        }

        // Check SQLite for the remaining ones
        let placeholders: Vec<&str> = not_in_memory.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT activity_id FROM time_streams WHERE activity_id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => {
                // On error, return all that aren't in memory
                return not_in_memory.into_iter().cloned().collect();
            }
        };

        // Bind all activity IDs as parameters
        let params: Vec<&dyn rusqlite::ToSql> = not_in_memory
            .iter()
            .map(|s| *s as &dyn rusqlite::ToSql)
            .collect();

        let cached_in_sqlite: std::collections::HashSet<String> = stmt
            .query_map(params.as_slice(), |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        // Return IDs that are NOT in memory AND NOT in SQLite
        not_in_memory
            .into_iter()
            .filter(|id| !cached_in_sqlite.contains(*id))
            .cloned()
            .collect()
    }

    /// Check if a specific activity has a time stream (in memory or SQLite).
    pub fn has_time_stream(&self, activity_id: &str) -> bool {
        // First check memory cache
        if self.time_streams.contains_key(activity_id) {
            return true;
        }
        // Then check SQLite
        let mut stmt = match self
            .db
            .prepare("SELECT 1 FROM time_streams WHERE activity_id = ? LIMIT 1")
        {
            Ok(s) => s,
            Err(_) => return false,
        };
        stmt.exists(params![activity_id]).unwrap_or(false)
    }

    /// Ensure time stream is loaded into memory (from SQLite if needed).
    /// Returns true if the time stream is available.
    pub(super) fn ensure_time_stream_loaded(&mut self, activity_id: &str) -> bool {
        // Already in memory?
        if self.time_streams.contains_key(activity_id) {
            return true;
        }
        // Try to load from SQLite
        if let Some(times) = self.load_time_stream(activity_id) {
            self.time_streams.insert(activity_id.to_string(), times);
            return true;
        }
        false
    }
}
