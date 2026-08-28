//! Activity management: CRUD, GPS tracks, signatures, spatial queries, time streams.

use crate::{ActivityMatchInfo, ActivityMetrics, Bounds, GpsPoint, RouteSignature};
use rstar::{AABB, RTree};
use rusqlite::{OptionalExtension, Result as SqlResult, params, types::Type};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use super::codec;
use super::codec::{TrackRead, TrackWalk};
use super::{ActivityBoundsEntry, ActivityMetadata, MapActivityComplete, PersistentRouteEngine};

/// Mark every id of a batch the SQL failure covers as `Corrupt`, leaving ids
/// the query already answered alone.
fn fail_chunk(decoded: &mut HashMap<String, TrackRead>, chunk: &[String], reason: &str) {
    log::error!("[tracks_batch] {}", reason);
    for id in chunk {
        decoded
            .entry(id.clone())
            .or_insert_with(|| TrackRead::Corrupt(reason.to_string()));
    }
}

/// Elevation provenance a stored track can be in: `elevation_state` 0.
pub const ELEVATION_STATE_UNKNOWN: u8 = 0;
/// Elevation provenance a stored track can be in: `elevation_state` 1.
pub const ELEVATION_STATE_FETCHED: u8 = 1;
/// Elevation provenance a stored track can be in: `elevation_state` 2.
pub const ELEVATION_STATE_UNAVAILABLE: u8 = 2;

/// How many stored tracks sit in each elevation provenance state.
///
/// The question the rest of the system asks is whether the library is
/// uniformly elevated, which is a scalar. Counts answer it without loading a
/// list of ids the caller would then have to walk.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ElevationStateCounts {
    /// Never asked, or stored before the provenance column existed.
    pub unknown: u64,
    /// Points carry elevation.
    pub fetched: u64,
    /// Asked, and upstream had no usable altitude series.
    pub unavailable: u64,
}

impl ElevationStateCounts {
    /// Tracks in a state other than `fetched`, ie. the size of the remaining
    /// backfill plus the activities that can never be filled.
    pub fn not_fetched(&self) -> u64 {
        self.unknown + self.unavailable
    }
}

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

        let rows: Vec<SqlResult<ActivityBoundsEntry>> = stmt
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
            .collect::<Vec<_>>();
        // A malformed row is skipped; a corrupt page is the caller's to
        // quarantine, and swallowing it here would hide the one signal the
        // failover keys on.
        let mut entries = Vec::with_capacity(rows.len());
        for r in rows {
            match r {
                Ok(v) => entries.push(v),
                Err(e) if super::is_corruption_error(&e) => return Err(e),
                Err(e) => {
                    log::warn!("Skipping malformed row during metadata loading: {:?}", e);
                }
            }
        }

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
        self.add_activities_batch(vec![(id, coords, sport_type)])
    }

    /// Add multiple activities in a single transaction with one R-tree rebuild.
    pub fn add_activities_batch(
        &mut self,
        activities: Vec<(String, Vec<GpsPoint>, String)>,
    ) -> SqlResult<()> {
        if activities.is_empty() {
            return Ok(());
        }

        // R6 freshness: an add that REPLACES a previously-synced activity with a
        // DIFFERENT track is a GPS mutation the catalogue must re-derive. Detect
        // it here, before the store overwrites the old track, so the ids can be
        // evicted from the processed set after commit (below). A verbatim
        // re-ingest (identical points) is NOT a mutation and must stay
        // idempotent, so compare the stored track, not just the id.
        let mutated_ids: Vec<String> = activities
            .iter()
            .filter(|(id, coords, _)| {
                self.activity_metadata.contains_key(id)
                    && self
                        .load_gps_track_from_db(id)
                        .map(|stored| stored != *coords)
                        .unwrap_or(true)
            })
            .map(|(id, _, _)| id.clone())
            .collect();

        self.db.execute_batch("BEGIN IMMEDIATE")?;

        let mut all_bounds: Vec<Bounds> = Vec::with_capacity(activities.len());

        for (id, coords, sport_type) in &activities {
            let bounds = Bounds::from_points(coords).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });

            let signature = RouteSignature::from_points(id, coords, &self.match_config);

            self.store_activity(id, sport_type, &bounds)?;
            self.store_gps_track(id, coords)?;
            if let Some(sig) = &signature {
                self.store_signature(id, sig)?;
                self.signature_cache.put(id.clone(), Arc::new(sig.clone()));
            }

            self.activity_metadata.insert(
                id.clone(),
                ActivityMetadata {
                    id: id.clone(),
                    sport_type: sport_type.clone(),
                    bounds,
                },
            );

            all_bounds.push(bounds);
        }

        self.db.execute_batch("COMMIT")?;

        self.rebuild_spatial_index();

        // Evict the mutated activities so the next detect re-analyses them
        // (their new tracks now count as unprocessed). No-op when nothing
        // changed, so a routine re-sync of unchanged activities stays free.
        if !mutated_ids.is_empty() {
            self.evict_processed_activity_ids(&mutated_ids);
        }

        self.groups_dirty = true;
        self.sections_dirty = true;

        if let Some(tiles_path) = self.heatmap_tiles_path.clone() {
            // The heatmap regenerates from the dirty flag regardless; set it under
            // the lock (cheap, in-memory).
            self.mark_heatmap_dirty();

            // Tile invalidation deletes PNGs on disk - slow filesystem I/O. Run it
            // on a detached thread so it does not happen while the engine write
            // lock is held (that would convoy every foreground read). The sweep
            // needs only the path and bounds, never `self`.
            let bounds_to_clear = all_bounds;
            let activity_count = activities.len();
            std::thread::spawn(move || {
                let config = crate::tiles::HeatmapConfig::default();
                let path = std::path::Path::new(&tiles_path);
                let margin = 0.001;
                let mut total_deleted = 0;
                for bounds in &bounds_to_clear {
                    total_deleted += crate::tiles::invalidate_tiles_in_bounds(
                        path,
                        bounds.min_lat - margin,
                        bounds.max_lat + margin,
                        bounds.min_lng - margin,
                        bounds.max_lng + margin,
                        config.min_zoom,
                        config.max_zoom,
                    );
                }
                if total_deleted > 0 {
                    log::info!(
                        "[heatmap] Invalidated {} tiles for {} new activities",
                        total_deleted,
                        activity_count
                    );
                }
            });
        }

        Ok(())
    }

    /// Sections whose stored geometry is cut from this activity. An
    /// activity naming any of them is the reference the triple points at,
    /// so deleting it would leave that geometry unreadable.
    pub fn sections_referencing_activity(&self, id: &str) -> Vec<String> {
        self.db
            .prepare(
                "SELECT id FROM sections WHERE representative_activity_id = ?1
                 UNION
                 SELECT DISTINCT section_id FROM section_geometry WHERE rep_activity_id = ?1",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![id], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
    }

    /// Add an activity from flat coordinate buffer.
    /// Remove an activity.
    pub fn remove_activity(&mut self, id: &str) -> SqlResult<()> {
        // Capture bounds before removal for heatmap tile invalidation
        let removed_bounds = self.activity_metadata.get(id).map(|m| m.bounds.clone());

        // Sections this activity contributes to, captured before the cascade
        // removes its junction rows. The delete trigger fires on the cascade
        // and keeps visit_count current; the recompute below is a redundant
        // backstop, kept because it is cheap and self-healing.
        let affected_sections: Vec<String> = self
            .db
            .prepare("SELECT DISTINCT section_id FROM section_activities WHERE activity_id = ?")
            .and_then(|mut stmt| {
                stmt.query_map([id], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default();

        // Remove from database (cascade deletes signature and track)
        self.db
            .execute("DELETE FROM activities WHERE id = ?", params![id])?;

        // Recompute visit_count on the sections the removed activity was in.
        for sid in &affected_sections {
            let _ = self.db.execute(
                "UPDATE sections SET visit_count = (
                    SELECT COUNT(*) FROM section_activities
                    WHERE section_id = ? AND excluded = 0
                 ) WHERE id = ?",
                params![sid, sid],
            );
        }

        // Remove from memory
        self.activity_metadata.remove(id);
        self.signature_cache.pop(&id.to_string());
        self.consensus_cache.clear(); // Invalidate all consensus since groups may change

        self.rebuild_spatial_index();

        self.groups_dirty = true;
        self.sections_dirty = true;

        // Drop the gone activity from the identity registry's carried sections and
        // the in-memory catalogue. The junction rows are cascade-deleted by the
        // activity_id foreign key, but the append-only fold would keep the activity
        // as a phantom member of a carried section, and the next detect's save would
        // then try to re-insert its junction row against a deleted activity —
        // aborting the whole apply on a foreign-key violation.
        self.section_identity_purge_activity(id);

        // R6 freshness: the removed activity may have contributed to any section,
        // so the next detect must re-derive the catalogue without it. Its id is
        // now gone from `activity_metadata`, so it can never re-enter
        // `new_activity_ids` — a targeted eviction can't defeat the
        // no-new-activities short-circuit. Clear the whole processed set so the
        // next detect re-analyses the remaining library.
        self.clear_processed_activity_ids();

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
             DELETE FROM processed_activities;
             DELETE FROM athlete_profile;
             DELETE FROM sport_settings;",
        )?;

        // Settings survive `clear()` on purpose, but three of them describe the
        // catalogue that was just deleted. Left behind, the next athlete to
        // sign in inherits the previous one's detector and a spent cutover
        // token, with no surface to change either.
        let mut stmt = self
            .db
            .prepare("DELETE FROM settings WHERE key IN (?, ?, ?)")?;
        stmt.execute(rusqlite::params![
            super::cutover::CUTOVER_KEY,
            super::cutover::CUTOVER_DIFF_KEY,
            super::settings_keys::SECTION_CONFIG_JSON,
        ])?;
        drop(stmt);

        self.activity_metadata.clear();
        self.activity_metrics.clear();
        self.spatial_index = RTree::new();
        self.signature_cache.clear();
        self.consensus_cache.clear();
        self.groups.clear();
        self.sections.clear();
        self.processed_activity_ids.clear();
        self.invalidate_evidence_cache();
        self.time_streams.clear();
        self.groups_dirty = false;
        self.sections_dirty = false;
        self.invalidate_perf_cache();

        Ok(())
    }

    /// Clear detected route/section data, keeping GPS tracks, activities and
    /// user-defined sections intact. Used when route matching is toggled off
    /// to free section memory without losing the underlying GPS data (needed
    /// for heatmap).
    pub fn clear_routes_and_sections(&mut self) -> SqlResult<()> {
        self.db.execute_batch(
            "DELETE FROM section_activities
                WHERE section_id IN (SELECT id FROM sections WHERE is_user_defined = 0);
             DELETE FROM sections WHERE is_user_defined = 0;
             DELETE FROM route_groups;
             DELETE FROM activity_matches;
             DELETE FROM overlap_cache;",
        )?;

        self.groups.clear();
        self.load_sections()?;
        self.consensus_cache.clear();
        self.invalidate_evidence_cache();
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
        // A reference activity is the geometry of the sections that point at
        // it, so retention leaves it alone and the returned count says so.
        let deleted = self.db.execute(
            "DELETE FROM activities WHERE created_at < (strftime('%s', 'now') - ?)
               AND id NOT IN (SELECT representative_activity_id FROM sections
                              WHERE representative_activity_id IS NOT NULL)
               AND id NOT IN (SELECT rep_activity_id FROM section_geometry
                              WHERE rep_activity_id IS NOT NULL)",
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
        // An upsert, never REPLACE: SQLite runs REPLACE as DELETE then INSERT,
        // and the delete cascades to every child row keyed on the activity
        // (section_activities, signatures, time_streams). A re-ingest must
        // update the row in place so those links and the unnamed columns
        // (date, name, distance) survive.
        self.db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 sport_type = excluded.sport_type,
                 min_lat = excluded.min_lat, max_lat = excluded.max_lat,
                 min_lng = excluded.min_lng, max_lng = excluded.max_lng",
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
        let track_data = codec::serialize_points(coords)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
        self.db.execute(
            "INSERT OR REPLACE INTO gps_tracks (activity_id, track_data, point_count)
             VALUES (?, ?, ?)",
            params![id, track_data, coords.len() as i64],
        )?;
        Ok(())
    }

    /// Record elevation provenance for tracks that are already stored, where
    /// `state` is 0 unknown, 1 fetched, 2 unavailable upstream.
    ///
    /// Provenance cannot ride on the insert: the batch tuple is
    /// `(id, coords, sport)` with no room for it, and an activity whose
    /// upstream has no altitude still stores its points, so state 2 has nothing
    /// to attach to. This writer touches `elevation_state` alone, leaving the
    /// points blob, `point_count` and every activity column untouched, and an
    /// id with no track row updates nothing rather than minting a phantom.
    ///
    /// `store_gps_track` writes with `INSERT OR REPLACE`, which resets the
    /// column to its default, so a re-ingest must record state AFTER storing
    /// the track.
    ///
    /// One statement per chunk, grouped by state, chunked like `tracks_batch`
    /// to stay under SQLite's parameter limit.
    pub fn record_elevation_state(&self, states: &[(String, u8)]) -> SqlResult<()> {
        const CHUNK: usize = 500;
        let mut by_state: BTreeMap<u8, Vec<&String>> = BTreeMap::new();
        for (id, state) in states {
            by_state.entry(*state).or_default().push(id);
        }

        for (state, ids) in by_state {
            let state = i64::from(state);
            for chunk in ids.chunks(CHUNK) {
                let placeholders = std::iter::repeat_n("?", chunk.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "UPDATE gps_tracks SET elevation_state = ? WHERE activity_id IN ({})",
                    placeholders
                );
                let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
                params_vec.push(&state);
                params_vec.extend(chunk.iter().map(|s| *s as &dyn rusqlite::ToSql));
                self.db.execute(&sql, params_vec.as_slice())?;
            }
        }
        Ok(())
    }

    /// How many stored tracks sit in each elevation provenance state. Any value
    /// outside the known set counts as unknown, which is the honest reading of
    /// a state this build does not understand.
    pub fn elevation_state_counts(&self) -> SqlResult<ElevationStateCounts> {
        let mut stmt = self
            .db
            .prepare("SELECT elevation_state, COUNT(*) FROM gps_tracks GROUP BY elevation_state")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;

        let mut counts = ElevationStateCounts::default();
        for row in rows {
            let (state, n) = row?;
            let n = n.max(0) as u64;
            match u8::try_from(state).unwrap_or(ELEVATION_STATE_UNKNOWN) {
                ELEVATION_STATE_FETCHED => counts.fetched += n,
                ELEVATION_STATE_UNAVAILABLE => counts.unavailable += n,
                _ => counts.unknown += n,
            }
        }
        Ok(counts)
    }

    pub(super) fn store_signature(&self, id: &str, sig: &RouteSignature) -> SqlResult<()> {
        let points_blob = codec::serialize_points(&sig.points)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
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
    /// Flag the catalogue as owing a detect. Used where a caller knows the
    /// pool moved under a run that has already reported its own result.
    pub fn mark_sections_dirty(&mut self) {
        self.sections_dirty = true;
    }

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
    pub fn get_signature(&mut self, id: &str) -> Option<Arc<RouteSignature>> {
        if let Some(sig) = self.signature_cache.get(&id.to_string()) {
            return Some(Arc::clone(sig));
        }

        let sig = self.load_signature_from_db(id)?;
        let arc = Arc::new(sig);
        self.signature_cache.put(id.to_string(), Arc::clone(&arc));
        Some(arc)
    }

    /// Load a stored signature. A corrupt points blob names itself in the log
    /// before the read gives up, so route grouping never drops an activity in
    /// silence.
    fn load_signature_from_db(&self, id: &str) -> Option<RouteSignature> {
        let mut stmt = match self
            .db
            .prepare(
                "SELECT points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance
                 FROM signatures WHERE activity_id = ?",
            ) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[load_signature_from_db] activity {}: query failed: {}", id, e);
                return None;
            }
        };

        let row = stmt
            .query_row(params![id], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    GpsPoint::new(row.get(1)?, row.get(2)?),
                    GpsPoint::new(row.get(3)?, row.get(4)?),
                    row.get::<_, f64>(5)?,
                ))
            })
            .optional();

        let (points_blob, start_point, end_point, total_distance) = match row {
            Ok(Some(values)) => values,
            Ok(None) => return None,
            Err(e) => {
                log::warn!(
                    "[load_signature_from_db] activity {}: row read failed: {}",
                    id,
                    e
                );
                return None;
            }
        };

        let points =
            TrackRead::from_blob(&points_blob).into_option("load_signature_from_db", id)?;

        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();

        Some(RouteSignature {
            activity_id: id.to_string(),
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        })
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
            let Some(points) =
                TrackRead::from_blob(&points_blob).into_option("map_signatures", &activity_id)
            else {
                continue;
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

            result.push(crate::ffi_types::FfiMapSignature {
                activity_id,
                encoded_coords: crate::coords::encode(&points),
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    /// Get map signatures for a specific set of activity IDs.
    /// Avoids deserializing the whole `signatures` table when only a handful
    /// of activities are needed (e.g. section-detail map overlay).
    pub fn get_map_signatures_for_ids(
        &self,
        ids: &[String],
    ) -> Vec<crate::ffi_types::FfiMapSignature> {
        if ids.is_empty() {
            return Vec::new();
        }

        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, points FROM signatures WHERE activity_id IN ({})",
            placeholders
        );
        let mut stmt = match self.db.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let params_vec: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = match stmt.query_map(params_vec.as_slice(), |row| {
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
            let Some(points) =
                TrackRead::from_blob(&points_blob).into_option("map_signatures", &activity_id)
            else {
                continue;
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

            result.push(crate::ffi_types::FfiMapSignature {
                activity_id,
                encoded_coords: crate::coords::encode(&points),
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    // ========================================================================
    // Track reads
    // ========================================================================

    /// Read one stored track, distinguishing an activity with no row from a row
    /// that did not decode. The single decode path: every other track read on
    /// this engine goes through here.
    pub fn track(&self, activity_id: &str) -> TrackRead {
        let mut stmt = match self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
        {
            Ok(s) => s,
            Err(e) => return TrackRead::Corrupt(format!("track query failed: {}", e)),
        };
        let blob: Option<Vec<u8>> = match stmt
            .query_row(params![activity_id], |row| row.get::<_, Vec<u8>>(0))
            .optional()
        {
            Ok(b) => b,
            Err(e) => return TrackRead::Corrupt(format!("track row read failed: {}", e)),
        };
        match blob {
            Some(bytes) => TrackRead::from_blob(&bytes),
            None => TrackRead::Missing,
        }
    }

    /// Read many tracks in one query per chunk. Ids with no row come back as
    /// `Missing`, and the result carries one entry per requested id in the
    /// order requested, repeated ids included. A SQL failure is reported as
    /// `Corrupt` for every id it covers, the same classification [`track`]
    /// gives the same event, so a readable row is never reported as an
    /// activity that was never synced.
    ///
    /// [`track`]: Self::track
    pub fn tracks_batch(&self, ids: &[String]) -> Vec<(String, TrackRead)> {
        // SQLite's default parameter limit is 999; stay well under it.
        const CHUNK: usize = 500;
        let mut decoded: HashMap<String, TrackRead> = HashMap::with_capacity(ids.len());

        for chunk in ids.chunks(CHUNK) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                placeholders
            );
            let mut stmt = match self.db.prepare(&sql) {
                Ok(s) => s,
                Err(e) => {
                    fail_chunk(&mut decoded, chunk, &format!("track query failed: {}", e));
                    continue;
                }
            };
            let params_vec: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(params_vec.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            });
            let rows = match rows {
                Ok(r) => r,
                Err(e) => {
                    fail_chunk(&mut decoded, chunk, &format!("track query failed: {}", e));
                    continue;
                }
            };
            let mut row_failures = 0usize;
            for row in rows {
                match row {
                    Ok((id, bytes)) => {
                        let read = TrackRead::from_blob(&bytes);
                        if let TrackRead::Corrupt(reason) = &read {
                            log::warn!("[tracks_batch] activity {}: corrupt track, {}", id, reason);
                        }
                        decoded.insert(id, read);
                    }
                    Err(e) => {
                        row_failures += 1;
                        log::warn!("[tracks_batch] row read failed: {}", e);
                    }
                }
            }
            // The failed rows carry no id, so every id the chunk did not
            // account for is unresolved rather than known to be absent.
            if row_failures > 0 {
                fail_chunk(
                    &mut decoded,
                    chunk,
                    &format!(
                        "track row read failed for {} rows in this batch",
                        row_failures
                    ),
                );
            }
        }

        ids.iter()
            .map(|id| {
                let read = decoded.get(id).cloned().unwrap_or(TrackRead::Missing);
                (id.clone(), read)
            })
            .collect()
    }

    /// Visit every stored track once, streaming. The callback borrows the
    /// points for the length of the call and the decoded buffer is dropped
    /// before the next row, so the whole library is never resident at once.
    /// A corrupt row is logged and visited with an empty slice. The returned
    /// [`TrackWalk`] counts what the walk saw and what it lost, so a caller
    /// can tell a short result from a complete one.
    pub fn for_each_track(&self, mut f: impl FnMut(&str, &[GpsPoint])) -> TrackWalk {
        let mut walk = TrackWalk::default();
        let mut stmt = match self
            .db
            .prepare("SELECT activity_id, track_data FROM gps_tracks")
        {
            Ok(s) => s,
            Err(e) => {
                log::error!("[for_each_track] prepare failed: {}", e);
                walk.failed += 1;
                return walk;
            }
        };
        let mut rows = match stmt.query([]) {
            Ok(r) => r,
            Err(e) => {
                log::error!("[for_each_track] query failed: {}", e);
                walk.failed += 1;
                return walk;
            }
        };
        loop {
            // rusqlite resets the statement on a row error, so the next call
            // ends the walk. The count is what tells the caller it was short.
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(e) => {
                    log::warn!("[for_each_track] row read failed: {}", e);
                    walk.failed += 1;
                    continue;
                }
            };
            let (id, blob): (String, Vec<u8>) = match (row.get(0), row.get(1)) {
                (Ok(id), Ok(blob)) => (id, blob),
                (Err(e), _) | (_, Err(e)) => {
                    log::warn!("[for_each_track] column read failed: {}", e);
                    walk.failed += 1;
                    continue;
                }
            };
            walk.visited += 1;
            match TrackRead::from_blob(&blob) {
                TrackRead::Present(points) => f(&id, &points),
                TrackRead::Missing => f(&id, &[]),
                TrackRead::Corrupt(reason) => {
                    walk.corrupt += 1;
                    log::warn!(
                        "[for_each_track] activity {}: corrupt track, {}",
                        id,
                        reason
                    );
                    f(&id, &[]);
                }
            }
        }
        walk
    }

    /// Get GPS track from database (on-demand, never cached).
    pub fn get_gps_track(&self, id: &str) -> Option<Vec<GpsPoint>> {
        self.track(id).into_option("get_gps_track", id)
    }

    /// Get all GPS tracks from database for tile generation.
    /// Returns a vector of track point arrays, suitable for heatmap rendering.
    pub fn get_all_tracks(&self) -> Vec<Vec<GpsPoint>> {
        let mut tracks: Vec<Vec<GpsPoint>> = Vec::new();
        let mut total_points = 0usize;
        let walk = self.for_each_track(|_, points| {
            if points.is_empty() {
                return;
            }
            total_points += points.len();
            tracks.push(points.to_vec());
        });
        if walk.corrupt > 0 || walk.is_incomplete() {
            log::warn!(
                "[get_all_tracks] {} tracks, {} total points, {} corrupt, {} unreadable rows: the result is incomplete",
                tracks.len(),
                total_points,
                walk.corrupt,
                walk.failed
            );
        } else {
            log::info!(
                "[get_all_tracks] {} tracks, {} total points",
                tracks.len(),
                total_points
            );
        }
        tracks
    }

    /// Load original GPS track from database (separate function to avoid borrow issues)
    pub(super) fn load_gps_track_from_db(&self, activity_id: &str) -> Option<Vec<GpsPoint>> {
        self.track(activity_id)
            .into_option("load_gps_track_from_db", activity_id)
    }

    // ========================================================================
    // Activity Bodies (untyped intervals.icu payloads)
    // ========================================================================

    /// Store the untyped body for each activity, keyed by id. Idempotent: a
    /// re-sync overwrites the day's payload in place.
    pub fn upsert_activity_bodies(&mut self, rows: &[(String, i64, String)]) -> SqlResult<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let tx = self.db.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
                 VALUES (?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(activity_id) DO UPDATE SET
                    date = excluded.date,
                    raw = excluded.raw,
                    updated_at = excluded.updated_at",
            )?;
            for (activity_id, date, raw) in rows {
                stmt.execute(params![activity_id, date, raw])?;
            }
        }
        tx.commit()
    }

    /// Untyped activity bodies over an inclusive timestamp window, newest
    /// first to match the order intervals.icu returns and the feed renders.
    pub fn get_activity_bodies(&self, oldest_ts: i64, newest_ts: i64) -> SqlResult<Vec<String>> {
        let mut stmt = self.db.prepare(
            "SELECT raw FROM activity_bodies
             WHERE date >= ? AND date <= ?
             ORDER BY date DESC",
        )?;
        let rows = stmt.query_map(params![oldest_ts, newest_ts], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    // ========================================================================
    // Time Streams (for section performance calculations)
    // ========================================================================

    /// Store time stream to database.
    pub(super) fn store_time_stream(&self, activity_id: &str, times: &[u32]) -> SqlResult<()> {
        let times_blob = codec::serialize(times)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
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
            Ok(codec::deserialize(&times_blob)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, e.into()))?)
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
            .filter(|id| !self.time_streams.contains(*id))
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
        if self.time_streams.contains(activity_id) {
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
        if self.time_streams.contains(activity_id) {
            return true;
        }
        // Try to load from SQLite
        if let Some(times) = self.load_time_stream(activity_id) {
            self.time_streams.put(activity_id.to_string(), times);
            return true;
        }
        false
    }
}
