//! Section management: loading, queries, detection, save/apply, names.

mod detection;
mod merging;
mod naming;
mod ranking;

use crate::{FrequentSection, GpsPoint, SectionPortion};
use chrono::Utc;
use rusqlite::{Result as SqlResult, params, types::Type};
use std::collections::HashMap;

use super::{PersistentRouteEngine, SectionSummary, get_section_word};

/// Haversine distance between two lat/lng points in meters.
pub(super) fn haversine_distance(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let r = 6_371_000.0; // Earth radius in meters
    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    r * 2.0 * a.sqrt().asin()
}

/// Compute `(lap_time, lap_pace)` from a time stream slice and traversal indices.
///
/// Returns `(None, None)` when:
/// - `times` is `None` (no stream available)
/// - either index is out of bounds
/// - the traversal spans zero (or negative) time
///
/// Shared by the detection-time populate path (`save_sections`), the manual
/// insert path (`insert_section_activity`), and the lazy backfill path.
pub(super) fn compute_lap_time_from_stream(
    times: Option<&[u32]>,
    start_index: u32,
    end_index: u32,
    distance_meters: f64,
) -> (Option<f64>, Option<f64>) {
    let times = match times {
        Some(t) => t,
        None => return (None, None),
    };
    let si = start_index as usize;
    let ei = end_index as usize;
    if si >= times.len() || ei >= times.len() {
        return (None, None);
    }
    let lap_time = (times[ei] as f64 - times[si] as f64).abs();
    if lap_time <= 0.0 {
        return (None, None);
    }
    let lap_pace = distance_meters / lap_time;
    (Some(lap_time), Some(lap_pace))
}

impl PersistentRouteEngine {
    /// Load sections from database.
    pub(super) fn load_sections(&mut self) -> SqlResult<()> {
        self.sections.clear();

        // First check how many rows are in the table
        let count: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0);
        log::info!(
            "tracematch: [PersistentEngine] Loading sections: {} rows in DB",
            count
        );

        // Load full activity portions from junction table (includes direction, indices, distance)
        // After cross-sport merge, sections can have activities from multiple sport types
        // Also track which portions have valid performance data for accurate visit counts
        let (section_portions, section_valid_counts): (
            HashMap<String, Vec<SectionPortion>>,
            HashMap<String, u32>,
        ) = {
            let mut stmt = self.db.prepare(
                "SELECT sa.section_id, sa.activity_id, sa.direction, sa.start_index, sa.end_index, sa.distance_meters, sa.lap_time
                 FROM section_activities sa
                 WHERE sa.excluded = 0
                 ORDER BY sa.section_id, sa.start_index"
            )?;
            let mut map: HashMap<String, Vec<SectionPortion>> = HashMap::new();
            let mut valid_counts: HashMap<String, u32> = HashMap::new();
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?, // section_id
                    SectionPortion {
                        activity_id: row.get(1)?,
                        direction: {
                            let s: String = row.get(2)?;
                            s.parse().map_err(|_| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    2,
                                    Type::Text,
                                    Box::new(std::fmt::Error),
                                )
                            })?
                        },
                        start_index: row.get(3)?,
                        end_index: row.get(4)?,
                        distance_meters: row.get(5)?,
                    },
                    row.get::<_, Option<f64>>(6)?, // lap_time
                ))
            })?;
            for row in rows {
                let row = match row {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!(
                            "tracematch: [PersistentEngine] Skipping malformed section_activities row during loading: {:?}",
                            e
                        );
                        continue;
                    }
                };
                let has_valid_perf = row.2.is_some();
                map.entry(row.0.clone()).or_default().push(row.1);
                if has_valid_perf {
                    *valid_counts.entry(row.0).or_insert(0) += 1;
                }
            }
            (map, valid_counts)
        };

        // Scope the statement to release the borrow before migrate_section_names
        {
            let mut stmt = self.db.prepare(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at
                 FROM sections WHERE section_type = 'auto'",
            )?;

            self.sections = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let polyline_json: String = row.get(4)?;
                    let point_density_json: Option<String> = row.get(10)?;
                    let representative_activity_id: Option<String> = row.get(6)?;

                    let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
                        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, Type::Text, Box::new(e)))?;
                    let point_density: Vec<u32> = point_density_json
                        .and_then(|j| serde_json::from_str(&j).ok())
                        .unwrap_or_default();

                    let portions = section_portions.get(&id)
                        .cloned()
                        .unwrap_or_default();
                    // Derive activity_ids from portions (deduplicated)
                    let activity_ids: Vec<String> = portions.iter()
                        .map(|p| p.activity_id.clone())
                        .collect::<std::collections::HashSet<_>>()
                        .into_iter()
                        .collect();
                    let visit_count = section_valid_counts.get(&id).copied()
                        .unwrap_or(portions.len() as u32);

                    Ok(FrequentSection {
                        id,
                        name: row.get(2)?,
                        sport_type: row.get(3)?,
                        polyline,
                        representative_activity_id: representative_activity_id.unwrap_or_default(),
                        activity_ids,
                        activity_portions: portions,
                        route_ids: vec![],
                        visit_count,
                        distance_meters: row.get(5)?,
                        activity_traces: std::collections::HashMap::new(),
                        confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                        observation_count: row.get::<_, Option<u32>>(8)?.unwrap_or(0),
                        average_spread: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                        point_density,
                        scale: {
                            let s: Option<String> = row.get(11)?;
                            match s {
                                None => None,
                                Some(s) => Some(s.parse().map_err(|_| {
                                    rusqlite::Error::FromSqlConversionFailure(11, Type::Text, Box::new(std::fmt::Error))
                                })?),
                            }
                        },
                        is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                        stability: row.get::<_, Option<f64>>(14)?.unwrap_or(0.0),
                        version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                        updated_at: row.get(16)?,
                        created_at: row.get(15)?,
                    })
                })?
                .filter_map(|r| match r {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::warn!("tracematch: [PersistentEngine] Skipping malformed section row during loading: {:?}", e);
                        None
                    }
                })
                .filter(|s: &FrequentSection| !s.id.is_empty())
                .collect();
        }

        log::info!(
            "tracematch: [PersistentEngine] Loaded {} sections into memory (from {} in DB)",
            self.sections.len(),
            count
        );

        // Log section IDs for debugging
        if !self.sections.is_empty() {
            let section_ids: Vec<&str> = self
                .sections
                .iter()
                .take(10)
                .map(|s| s.id.as_str())
                .collect();
            log::info!(
                "tracematch: [PersistentEngine] First {} section IDs: {:?}",
                section_ids.len(),
                section_ids
            );
        }

        // Migration: Generate names for sections that don't have names yet
        self.migrate_section_names()?;

        // Migration: Strip sport prefixes from auto-generated names ("Walk Section 1" → "Section 1")
        self.migrate_strip_sport_prefixes()?;

        // Backfill any NULL lap_time/lap_pace from available time streams
        // Handles migration edge cases and activities synced after section detection
        self.backfill_section_performance_cache();

        self.sections_dirty = false;
        Ok(())
    }

    /// Load processed activity IDs from database (for incremental section detection).
    pub(super) fn load_processed_activity_ids(&mut self) -> SqlResult<()> {
        self.processed_activity_ids.clear();
        let mut stmt = self
            .db
            .prepare("SELECT activity_id FROM processed_activities")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows.flatten() {
            self.processed_activity_ids.insert(row);
        }
        log::info!(
            "tracematch: [PersistentEngine] Loaded {} processed activity IDs",
            self.processed_activity_ids.len()
        );
        Ok(())
    }

    /// Save processed activity IDs to database after section detection.
    pub(crate) fn save_processed_activity_ids(&mut self, activity_ids: &[String]) -> SqlResult<()> {
        let tx = self.db.unchecked_transaction()?;
        let mut stmt =
            tx.prepare("INSERT OR IGNORE INTO processed_activities (activity_id) VALUES (?)")?;
        for id in activity_ids {
            stmt.execute(params![id])?;
        }
        drop(stmt);
        tx.commit()?;
        // Update in-memory set
        for id in activity_ids {
            self.processed_activity_ids.insert(id.clone());
        }
        Ok(())
    }

    /// Clear all processed activity IDs to force full re-detection.
    pub(crate) fn clear_processed_activity_ids(&mut self) {
        let _ = self.db.execute("DELETE FROM processed_activities", []);
        self.processed_activity_ids.clear();
        log::info!("tracematch: [PersistentEngine] Cleared all processed activity IDs for forced re-detection");
    }

    // Section name migration and management methods live in `naming.rs`.


    // ========================================================================
    // Sections (Background Detection)
    // ========================================================================

    /// Get sections (must call detect_sections first or load from DB).
    pub fn get_sections(&self) -> &[FrequentSection] {
        &self.sections
    }

    /// Get sections filtered by sport type and/or minimum visit count.
    /// Filters in-memory sections to avoid FFI overhead for non-matching entries.
    pub fn get_sections_filtered(
        &self,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
    ) -> Vec<FrequentSection> {
        let min = min_visits.unwrap_or(0);
        self.sections
            .iter()
            .filter(|s| sport_type.map_or(true, |st| s.sport_type == st) && s.visit_count >= min)
            .cloned()
            .collect()
    }

    /// Update a section's name in memory (for immediate visibility after rename).
    pub fn update_section_name_in_memory(&mut self, section_id: &str, name: &str) {
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.name = Some(name.to_string());
        }
    }

    /// Refresh a section in memory from the database.
    /// Only applies to auto sections (custom sections are not cached in memory).
    /// Call this after modifying a section's polyline or activity list.
    pub fn refresh_section_in_memory(&mut self, section_id: &str) {
        // Only auto sections are cached in self.sections
        // Custom sections always come from DB via get_section()

        // First check if this is an auto section by querying the DB
        let section_data: Option<(
            String,
            String,
            Option<String>,
            String,
            f64,
            Option<String>,
            Option<f64>,
            Option<u32>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<u32>,
            Option<i32>,
            Option<f64>,
            Option<String>,
            Option<String>,
        )> = {
            let mut stmt = match self.db.prepare(
                "SELECT section_type, sport_type, name, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at
                 FROM sections WHERE id = ?",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };

            stmt.query_row(params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,          // section_type
                    row.get::<_, String>(1)?,          // sport_type
                    row.get::<_, Option<String>>(2)?,  // name
                    row.get::<_, String>(3)?,          // polyline_json
                    row.get::<_, f64>(4)?,             // distance_meters
                    row.get::<_, Option<String>>(5)?,  // representative_activity_id
                    row.get::<_, Option<f64>>(6)?,     // confidence
                    row.get::<_, Option<u32>>(7)?,     // observation_count
                    row.get::<_, Option<f64>>(8)?,     // average_spread
                    row.get::<_, Option<String>>(9)?,  // point_density_json
                    row.get::<_, Option<String>>(10)?, // scale
                    row.get::<_, Option<u32>>(11)?,    // version
                    row.get::<_, Option<i32>>(12)?,    // is_user_defined
                    row.get::<_, Option<f64>>(13)?,    // stability
                    row.get::<_, Option<String>>(14)?, // created_at
                    row.get::<_, Option<String>>(15)?, // updated_at
                ))
            })
            .ok()
        };

        let (
            section_type,
            sport_type,
            name,
            polyline_json,
            distance_meters,
            representative_activity_id,
            confidence,
            observation_count,
            average_spread,
            point_density_json,
            scale,
            version,
            is_user_defined,
            stability,
            created_at,
            updated_at,
        ) = match section_data {
            Some(data) => data,
            None => return, // Section not found
        };

        // Only auto sections are cached in memory
        if section_type != "auto" {
            return;
        }

        // Get activity IDs from junction table (deduplicated)
        let activity_ids: Vec<String> = {
            let mut stmt = match self.db.prepare(
                "SELECT DISTINCT sa.activity_id FROM section_activities sa
                 WHERE sa.section_id = ? AND sa.excluded = 0",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            stmt.query_map(params![section_id], |row| row.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
        };

        // Parse polyline and point density
        let polyline: Vec<GpsPoint> = match serde_json::from_str(&polyline_json) {
            Ok(p) => p,
            Err(e) => {
                log::error!(
                    "tracematch: [refresh_section_in_memory] Failed to parse polyline for {}: {}",
                    section_id,
                    e
                );
                return;
            }
        };
        let point_density: Vec<u32> = point_density_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();

        // Count total traversals (laps) with valid performance data
        let visit_count: u32 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities sa
                 WHERE sa.section_id = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(activity_ids.len() as u32);

        // Build the FrequentSection
        let updated_section = FrequentSection {
            id: section_id.to_string(),
            name,
            sport_type,
            polyline,
            representative_activity_id: representative_activity_id.unwrap_or_default(),
            activity_ids,
            activity_portions: vec![], // Not stored in DB
            route_ids: vec![],         // Not stored in DB
            visit_count,
            distance_meters,
            activity_traces: std::collections::HashMap::new(), // Not stored in DB
            confidence: confidence.unwrap_or(0.0),
            observation_count: observation_count.unwrap_or(0),
            average_spread: average_spread.unwrap_or(0.0),
            point_density,
            scale: scale.and_then(|s| match s.parse::<tracematch::sections::ScaleName>() {
                Ok(v) => Some(v),
                Err(_) => {
                    log::warn!(
                        "tracematch: [refresh_section_in_memory] Failed to parse scale '{}' for {}",
                        s,
                        section_id
                    );
                    None
                }
            }),
            is_user_defined: is_user_defined.unwrap_or(0) != 0,
            stability: stability.unwrap_or(0.0),
            version: version.unwrap_or(1),
            updated_at,
            created_at,
        };

        // Find and update existing section, or append if new
        if let Some(existing) = self.sections.iter_mut().find(|s| s.id == section_id) {
            *existing = updated_section;
            log::debug!(
                "tracematch: [refresh_section_in_memory] Updated section {} in memory",
                section_id
            );
        } else {
            self.sections.push(updated_section);
            log::debug!(
                "tracematch: [refresh_section_in_memory] Added section {} to memory",
                section_id
            );
        }
    }

    /// Remove a section from in-memory cache.
    /// Call this after deleting a section.
    pub fn remove_section_from_memory(&mut self, section_id: &str) {
        self.sections.retain(|s| s.id != section_id);
        self.invalidate_perf_cache();
        log::debug!(
            "tracematch: [remove_section_from_memory] Removed section {} from memory",
            section_id
        );
    }

    /// Get section count directly from SQLite (no data loading).
    /// This is O(1) and doesn't require loading sections into memory.
    pub fn get_section_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    /// Queries SQLite and extracts only summary fields, skipping heavy data like
    /// polylines, activityTraces, and pointDensity.
    pub fn get_section_summaries(&self) -> Vec<SectionSummary> {
        // Get activity counts per section from junction table
        let activity_counts: HashMap<String, u32> = {
            let mut stmt = match self.db.prepare(
                "SELECT sa.section_id, COUNT(*) FROM section_activities sa
                 WHERE sa.excluded = 0
                 GROUP BY sa.section_id",
            ) {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        };

        // Get distinct sport types per section from activities
        let section_sport_types: HashMap<String, Vec<String>> = {
            let mut stmt = match self.db.prepare(
                "SELECT sa.section_id, GROUP_CONCAT(DISTINCT am.sport_type) FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0
                 GROUP BY sa.section_id"
            ) {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };
            stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let types_csv: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let types: Vec<String> = types_csv
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                Ok((id, types))
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        };

        let mut stmt = match self.db.prepare(
            "SELECT id, name, sport_type, distance_meters, confidence, scale,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    section_type, representative_activity_id, created_at,
                    disabled, superseded_by
             FROM sections
             WHERE disabled = 0 AND superseded_by IS NULL",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare section summaries query: {}",
                    e
                );
                return Vec::new();
            }
        };

        let results: Vec<SectionSummary> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;

                // Read bounds from cached columns (populated at INSERT time or by migration)
                let bounds = match (
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<f64>>(7)?,
                    row.get::<_, Option<f64>>(8)?,
                    row.get::<_, Option<f64>>(9)?,
                ) {
                    (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) => {
                        Some(crate::FfiBounds {
                            min_lat,
                            max_lat,
                            min_lng,
                            max_lng,
                        })
                    }
                    _ => None,
                };

                let activity_count = activity_counts.get(&id).copied().unwrap_or(0);
                let sport_types = section_sport_types.get(&id).cloned().unwrap_or_default();

                Ok(SectionSummary {
                    id,
                    section_type: row
                        .get::<_, Option<String>>(10)?
                        .unwrap_or_else(|| "auto".to_string()),
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    distance_meters: row.get(3)?,
                    visit_count: activity_count,
                    activity_count,
                    representative_activity_id: row.get(11)?,
                    confidence: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    scale: row.get(5)?,
                    bounds,
                    created_at: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    sport_types,
                    disabled: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                    superseded_by: row.get(14)?,
                })
            })
            .ok()
            .map(|iter| {
                iter.filter_map(|r| {
                    r.map_err(|e| {
                    log::error!(
                        "tracematch: [PersistentEngine] get_section_summaries row parse error: {}",
                        e
                    );
                    e
                }).ok()
                })
                .collect()
            })
            .unwrap_or_default();

        // Log section type breakdown for debugging
        let auto_count = results
            .iter()
            .filter(|s| !s.id.starts_with("custom_"))
            .count();
        let custom_count = results.len() - auto_count;
        log::info!(
            "tracematch: [PersistentEngine] get_section_summaries returned {} summaries ({} auto, {} custom)",
            results.len(),
            auto_count,
            custom_count
        );
        if custom_count > 0 {
            for s in results.iter().filter(|s| s.id.starts_with("custom_")) {
                log::info!(
                    "tracematch: [PersistentEngine]   custom section: id={}, name={:?}, visits={}, distance={:.0}m",
                    s.id,
                    s.name,
                    s.visit_count,
                    s.distance_meters
                );
            }
        }
        results
    }

    /// Get section summaries filtered by sport type.
    pub fn get_section_summaries_for_sport(&self, sport_type: &str) -> Vec<SectionSummary> {
        self.get_section_summaries()
            .into_iter()
            .filter(|s| s.sport_type == sport_type)
            .collect()
    }

    /// Get a single section by ID with LRU caching.
    /// Returns the full FrequentSection with polyline data.
    /// Uses LRU cache to avoid repeated SQLite queries for hot sections.
    ///
    /// Delegates to crud.rs get_section() which handles both auto and custom sections
    /// reliably, then loads activity portions from the junction table.
    pub fn get_section_by_id(&mut self, section_id: &str) -> Option<FrequentSection> {
        // Check LRU cache first
        if let Some(section) = self.section_cache.get(&section_id.to_string()) {
            log::debug!(
                "tracematch: [PersistentEngine] get_section_by_id cache hit for {}",
                section_id
            );
            return Some(section.clone());
        }

        // Use crud.rs get_section() which is proven to work for both auto and custom sections
        let section = match self.get_section(section_id) {
            Some(s) => s,
            None => {
                log::info!(
                    "tracematch: [PersistentEngine] get_section_by_id: section {} not found in DB",
                    section_id
                );
                return None;
            }
        };

        // Load full activity portions from junction table
        let portions = self.get_section_portions(section_id);

        // Convert Section → FrequentSection
        let frequent = FrequentSection {
            id: section.id,
            name: section.name,
            sport_type: section.sport_type,
            polyline: section.polyline,
            representative_activity_id: section.representative_activity_id.unwrap_or_default(),
            activity_ids: section.activity_ids,
            activity_portions: portions,
            route_ids: section.route_ids.unwrap_or_default(),
            visit_count: section.visit_count,
            distance_meters: section.distance_meters,
            activity_traces: std::collections::HashMap::new(),
            confidence: section.confidence.unwrap_or(0.0),
            observation_count: section.observation_count.unwrap_or(0),
            average_spread: section.average_spread.unwrap_or(0.0),
            point_density: section.point_density.unwrap_or_default(),
            scale: section.scale.and_then(|s| s.parse().ok()),
            is_user_defined: section.is_user_defined,
            stability: section.stability.unwrap_or(0.0),
            version: section.version.unwrap_or(1),
            updated_at: section.updated_at,
            created_at: Some(section.created_at),
        };

        // Cache for future access
        self.section_cache
            .put(section_id.to_string(), frequent.clone());
        log::info!(
            "tracematch: [PersistentEngine] get_section_by_id found and cached section {} (type={:?})",
            section_id,
            frequent.is_user_defined
        );

        Some(frequent)
    }

    /// Load activity portions for a section from the junction table.
    fn get_section_portions(&self, section_id: &str) -> Vec<SectionPortion> {
        let mut stmt = match self.db.prepare(
            "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index, sa.distance_meters
             FROM section_activities sa
             WHERE sa.section_id = ? AND sa.excluded = 0
             ORDER BY sa.start_index",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] get_section_portions query failed for {}: {}",
                    section_id,
                    e
                );
                return Vec::new();
            }
        };
        stmt.query_map(params![section_id], |row| {
            Ok(SectionPortion {
                activity_id: row.get(0)?,
                direction: {
                    let s: String = row.get(1)?;
                    s.parse().map_err(|_| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            Type::Text,
                            Box::new(std::fmt::Error),
                        )
                    })?
                },
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
            })
        })
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    /// Invalidate a section in the LRU cache.
    /// Call this after modifying a section to ensure fresh data on next fetch.
    pub fn invalidate_section_cache(&mut self, section_id: &str) {
        self.section_cache.pop(&section_id.to_string());
    }

    /// Get section polyline only (flat coordinates for map rendering).
    /// Returns [lat1, lng1, lat2, lng2, ...] or empty vec if not found.
    pub fn get_section_polyline(&self, section_id: &str) -> Vec<f64> {
        let result: Option<Vec<f64>> = self
            .db
            .query_row(
                "SELECT polyline_json FROM sections WHERE id = ?",
                params![section_id],
                |row| {
                    let polyline_json: String = row.get(0)?;
                    let points: Vec<serde_json::Value> = match serde_json::from_str(&polyline_json)
                    {
                        Ok(v) => v,
                        Err(e) => {
                            log::error!(
                                "tracematch: get_section_polyline JSON parse error for {}: {}",
                                section_id,
                                e
                            );
                            return Ok(None);
                        }
                    };

                    let coords: Vec<f64> = points
                        .iter()
                        .flat_map(|p| {
                            let lat = p["latitude"].as_f64().unwrap_or(0.0);
                            let lng = p["longitude"].as_f64().unwrap_or(0.0);
                            vec![lat, lng]
                        })
                        .collect();

                    Ok(Some(coords))
                },
            )
            .ok()
            .flatten();

        result.unwrap_or_default()
    }

    /// Batch-load section polylines for multiple section IDs in a single query.
    /// Returns a map of section_id → flat [lat, lng, lat, lng, ...] coordinates.
    pub(super) fn get_section_polylines_batch(
        &self,
        section_ids: &[&str],
    ) -> HashMap<String, Vec<f64>> {
        if section_ids.is_empty() {
            return HashMap::new();
        }

        let placeholders: Vec<&str> = section_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, polyline_json FROM sections WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare batch section polyline query: {}",
                    e
                );
                return HashMap::new();
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let results: HashMap<String, Vec<f64>> = stmt
            .query_map(params.as_slice(), |row| {
                let section_id: String = row.get(0)?;
                let polyline_json: String = row.get(1)?;
                let points: Vec<serde_json::Value> =
                    serde_json::from_str(&polyline_json).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(1, Type::Text, Box::new(e))
                    })?;
                let coords: Vec<f64> = points
                    .iter()
                    .flat_map(|p| {
                        let lat = p["latitude"].as_f64().unwrap_or(0.0);
                        let lng = p["longitude"].as_f64().unwrap_or(0.0);
                        vec![lat, lng]
                    })
                    .collect();
                Ok((section_id, coords))
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        results
    }



    /// Insert a single section_activities row for a manually matched activity.
    pub fn insert_section_activity(
        &self,
        section_id: &str,
        activity_id: &str,
        direction: &tracematch::Direction,
        start_index: u32,
        end_index: u32,
        distance_meters: f64,
    ) -> Result<(), String> {
        let dir_str = direction.to_string();

        // Compute lap_time from time_stream when available (in-memory or DB)
        let (lap_time, lap_pace) = self
            .load_lap_time(activity_id, start_index, end_index, distance_meters);

        self.db
            .execute(
                "INSERT OR IGNORE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rusqlite::params![section_id, activity_id, dir_str, start_index, end_index, distance_meters, lap_time, lap_pace],
            )
            .map_err(|e| format!("Failed to insert section_activity: {}", e))?;
        Ok(())
    }

    /// Load lap_time from time_stream (in-memory or DB fallback).
    fn load_lap_time(
        &self,
        activity_id: &str,
        start_index: u32,
        end_index: u32,
        distance_meters: f64,
    ) -> (Option<f64>, Option<f64>) {
        let times = if let Some(ts) = self.time_streams.get(activity_id) {
            Some(ts.clone())
        } else {
            self.db
                .query_row(
                    "SELECT times FROM time_streams WHERE activity_id = ?",
                    rusqlite::params![activity_id],
                    |row| {
                        let bytes: Vec<u8> = row.get(0)?;
                        rmp_serde::from_slice::<Vec<u32>>(&bytes)
                            .map_err(|_| rusqlite::Error::InvalidQuery)
                    },
                )
                .ok()
        };

        compute_lap_time_from_stream(times.as_deref(), start_index, end_index, distance_meters)
    }

    /// Get sections near a given section within a radius (meters).
    /// Returns summaries with polyline data for map rendering.
    pub fn get_nearby_sections(
        &self,
        section_id: &str,
        radius_meters: f64,
    ) -> Vec<crate::FfiNearbySectionSummary> {
        // Get the query section's center
        let query_center: Option<(f64, f64)> = self
            .db
            .query_row(
                "SELECT (COALESCE(bounds_min_lat, 0) + COALESCE(bounds_max_lat, 0)) / 2.0,
                        (COALESCE(bounds_min_lng, 0) + COALESCE(bounds_max_lng, 0)) / 2.0
                 FROM sections WHERE id = ? AND bounds_min_lat IS NOT NULL",
                rusqlite::params![section_id],
                |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
            )
            .ok();

        let (center_lat, center_lng) = match query_center {
            Some(c) => c,
            None => return vec![],
        };

        // Query all sections with bounds (excluding query section, disabled, superseded)
        let mut stmt = match self.db.prepare(
            "SELECT s.id, s.section_type, s.name, s.sport_type, s.distance_meters,
                    (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id AND sa.excluded = 0) as visit_count,
                    (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0 as center_lat,
                    (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0 as center_lng,
                    s.polyline_json
             FROM sections s
             WHERE s.id != ? AND s.disabled = 0 AND s.superseded_by IS NULL
               AND s.bounds_min_lat IS NOT NULL",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt
            .query_map(rusqlite::params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,           // id
                    row.get::<_, String>(1)?,           // section_type
                    row.get::<_, Option<String>>(2)?,   // name
                    row.get::<_, String>(3)?,           // sport_type
                    row.get::<_, f64>(4)?,              // distance_meters
                    row.get::<_, u32>(5)?,              // visit_count
                    row.get::<_, f64>(6)?,              // center_lat
                    row.get::<_, f64>(7)?,              // center_lng
                    row.get::<_, Option<String>>(8)?,   // polyline_json
                ))
            })
            .ok();

        let mut results: Vec<crate::FfiNearbySectionSummary> = Vec::new();

        if let Some(rows) = rows {
            for row in rows.flatten() {
                let (id, section_type, name, sport_type, distance_meters, visit_count, lat, lng, polyline_json) = row;
                let dist = haversine_distance(center_lat, center_lng, lat, lng);
                if dist > radius_meters {
                    continue;
                }

                // Parse polyline to flat coords
                let polyline_coords = polyline_json
                    .and_then(|json| {
                        serde_json::from_str::<Vec<serde_json::Value>>(&json).ok()
                    })
                    .map(|points| {
                        points
                            .iter()
                            .flat_map(|p| {
                                let lat = p["latitude"].as_f64().unwrap_or(0.0);
                                let lng = p["longitude"].as_f64().unwrap_or(0.0);
                                vec![lat, lng]
                            })
                            .collect::<Vec<f64>>()
                    })
                    .unwrap_or_default();

                results.push(crate::FfiNearbySectionSummary {
                    id,
                    section_type,
                    name,
                    sport_type,
                    distance_meters,
                    visit_count,
                    center_distance_meters: dist,
                    polyline_coords,
                });
            }
        }

        results.sort_by(|a, b| {
            a.center_distance_meters
                .partial_cmp(&b.center_distance_meters)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(20);
        results
    }



    pub(super) fn save_sections(&self) -> SqlResult<()> {
        let tx = self.db.unchecked_transaction()?;

        // Clear existing auto sections (keep custom sections and trimmed auto sections)
        tx.execute("DELETE FROM section_activities WHERE section_id IN (SELECT id FROM sections WHERE section_type = 'auto' AND original_polyline_json IS NULL)", [])?;
        tx.execute(
            "DELETE FROM sections WHERE section_type = 'auto' AND original_polyline_json IS NULL",
            [],
        )?;

        // Load existing section names to preserve user-set names (from custom sections)
        let existing_names: HashMap<String, String> = {
            let mut stmt = tx.prepare("SELECT id, name FROM sections WHERE name IS NOT NULL")?;
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        let section_word = get_section_word();

        // Collect which numbers are already taken (check both old and new patterns)
        let mut taken_numbers: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for name in existing_names.values() {
            // New pattern: "Section N"
            let prefix = format!("{} ", section_word);
            if name.starts_with(&prefix) {
                if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                    taken_numbers.insert(num);
                }
            }
            // Old pattern: "{Sport} Section N" — still recognize for numbering
            for sport in [
                "Ride",
                "Run",
                "Hike",
                "Walk",
                "Swim",
                "VirtualRide",
                "VirtualRun",
            ] {
                let old_prefix = format!("{} {} ", sport, section_word);
                if name.starts_with(&old_prefix) {
                    if let Ok(num) = name[old_prefix.len()..].parse::<u32>() {
                        taken_numbers.insert(num);
                    }
                }
            }
        }

        // Insert auto-detected sections with new schema
        let mut section_stmt = tx.prepare(
            "INSERT INTO sections (
                id, section_type, name, sport_type, polyline_json, distance_meters,
                representative_activity_id, confidence, observation_count, average_spread,
                point_density_json, scale, version, is_user_defined, stability, created_at, updated_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
            ) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )?;
        let mut junction_stmt = tx
            .prepare("INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")?;

        // Sort sections by sport type and activity count for consistent numbering
        let mut sorted_sections: Vec<&FrequentSection> = self.sections.iter().collect();
        sorted_sections.sort_by(|a, b| {
            a.sport_type
                .cmp(&b.sport_type)
                .then_with(|| b.activity_ids.len().cmp(&a.activity_ids.len()))
        });

        // Track next available number for each sport type (for sequential assignment)
        let mut sport_counters: HashMap<String, u32> = HashMap::new();

        for section in sorted_sections {
            let polyline_json = serde_json::to_string(&section.polyline)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            let point_density_json = if section.point_density.is_empty() {
                None
            } else {
                serde_json::to_string(&section.point_density).ok()
            };
            let created_at = section
                .created_at
                .clone()
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            // Determine the name to use: preserve existing names, generate new ones
            let name_to_save: Option<String> =
                if let Some(existing) = existing_names.get(&section.id) {
                    // Preserve user-set or previously generated name
                    Some(existing.clone())
                } else if section.name.is_some() {
                    // Section already has a name (e.g., from detection)
                    section.name.clone()
                } else {
                    // Generate unique sequential name (no sport prefix)
                    let counter = sport_counters.entry("_global".to_string()).or_insert(0);

                    // Find next available number (skip taken numbers)
                    loop {
                        *counter += 1;
                        if !taken_numbers.contains(counter) {
                            break;
                        }
                    }

                    let new_name = format!("{} {}", section_word, counter);
                    taken_numbers.insert(*counter); // Mark this number as taken
                    Some(new_name)
                };

            // Compute bounds from polyline
            let (bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng) =
                if section.polyline.len() >= 2 {
                    let bounds = tracematch::geo_utils::compute_bounds(&section.polyline);
                    (
                        Some(bounds.min_lat),
                        Some(bounds.max_lat),
                        Some(bounds.min_lng),
                        Some(bounds.max_lng),
                    )
                } else {
                    (None, None, None, None)
                };

            section_stmt.execute(params![
                section.id,
                name_to_save,
                section.sport_type,
                polyline_json,
                section.distance_meters,
                if section.representative_activity_id.is_empty() {
                    None
                } else {
                    Some(&section.representative_activity_id)
                },
                section.confidence,
                section.observation_count,
                section.average_spread,
                point_density_json,
                section.scale.map(|s| s.to_string()),
                section.version,
                if section.is_user_defined { 1 } else { 0 },
                section.stability,
                created_at,
                section.updated_at,
                bounds_min_lat,
                bounds_max_lat,
                bounds_min_lng,
                bounds_max_lng,
            ])?;

            // Populate junction table with full portion details and cached performance metrics.
            // Time streams may not be in memory (e.g., after background detection on a
            // separate thread), so load from DB on cache miss to guarantee lap_time/lap_pace
            // are always populated.
            let mut db_time_streams: HashMap<String, Vec<u32>> = HashMap::new();
            for portion in &section.activity_portions {
                let times = if let Some(times) = self.time_streams.get(&portion.activity_id) {
                    Some(times.as_slice())
                } else {
                    // Load from DB if not in memory
                    if !db_time_streams.contains_key(&portion.activity_id) {
                        if let Ok(stream) = tx.query_row(
                            "SELECT times FROM time_streams WHERE activity_id = ?",
                            params![&portion.activity_id],
                            |row| {
                                let bytes: Vec<u8> = row.get(0)?;
                                rmp_serde::from_slice::<Vec<u32>>(&bytes)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)
                            },
                        ) {
                            db_time_streams.insert(portion.activity_id.clone(), stream);
                        }
                    }
                    db_time_streams
                        .get(&portion.activity_id)
                        .map(|v| v.as_slice())
                };

                let (lap_time, lap_pace) = compute_lap_time_from_stream(
                    times,
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                );

                junction_stmt.execute(params![
                    section.id,
                    portion.activity_id,
                    portion.direction.to_string(),
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                    lap_time,
                    lap_pace,
                ])?;
            }
        }

        // Drop prepared statements before committing (they hold borrows on tx)
        drop(section_stmt);
        drop(junction_stmt);
        tx.commit()?;

        Ok(())
    }
}
