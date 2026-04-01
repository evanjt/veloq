//! Section management: loading, queries, detection, save/apply, names.

use crate::{FrequentSection, GpsPoint, SectionPortion};
use chrono::Utc;
use rusqlite::{Connection, Result as SqlResult, params, types::Type};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;

use super::{
    PersistentRouteEngine, SectionDetectionHandle, SectionDetectionProgress, SectionSummary,
    get_section_word, load_groups_from_db,
};

/// Haversine distance between two lat/lng points in meters.
fn haversine_distance(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let r = 6_371_000.0; // Earth radius in meters
    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    r * 2.0 * a.sqrt().asin()
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

    /// Migration: Generate names for sections that don't have names.
    fn migrate_section_names(&mut self) -> SqlResult<()> {
        let sections_without_names: Vec<(String, String)> = self
            .sections
            .iter()
            .filter(|s| s.name.is_none())
            .map(|s| (s.id.clone(), s.sport_type.clone()))
            .collect();

        if sections_without_names.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [PersistentEngine] Migrating {} sections without names",
            sections_without_names.len()
        );

        let section_word = get_section_word();

        // Collect which numbers are already taken (check both old "{Sport} Section N" and new "Section N" patterns)
        let mut taken_numbers: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for section in &self.sections {
            if let Some(ref name) = section.name {
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
        }

        // Generate and update names for sections without names
        let mut update_stmt = self
            .db
            .prepare("UPDATE sections SET name = ? WHERE id = ?")?;

        // Track next available number (no longer per-sport)
        let mut counter: u32 = 0;

        for (section_id, _sport_type) in &sections_without_names {
            // Find next available number (skip taken numbers)
            loop {
                counter += 1;
                if !taken_numbers.contains(&counter) {
                    break;
                }
            }

            let new_name = format!("{} {}", section_word, counter);
            update_stmt.execute(params![&new_name, section_id])?;
            taken_numbers.insert(counter); // Mark this number as taken

            // Update in-memory section
            if let Some(section) = self.sections.iter_mut().find(|s| &s.id == section_id) {
                section.name = Some(new_name);
            }
        }

        log::info!(
            "tracematch: [PersistentEngine] Generated names for {} sections",
            sections_without_names.len()
        );

        Ok(())
    }

    /// Migration: Strip sport type prefixes from auto-generated section names.
    /// "Walk Section 1" → "Section 1", with conflict resolution.
    fn migrate_strip_sport_prefixes(&mut self) -> SqlResult<()> {
        let section_word = get_section_word();
        let sports = [
            "Ride",
            "Run",
            "Hike",
            "Walk",
            "Swim",
            "VirtualRide",
            "VirtualRun",
        ];

        // Find sections with old-style "{Sport} {Word} N" names
        let mut renames: Vec<(String, String, u32)> = Vec::new(); // (section_id, new_name, number)
        for section in &self.sections {
            if let Some(ref name) = section.name {
                for sport in &sports {
                    let prefix = format!("{} {} ", sport, section_word);
                    if name.starts_with(&prefix) {
                        if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                            let new_name = format!("{} {}", section_word, num);
                            renames.push((section.id.clone(), new_name, num));
                        }
                        break;
                    }
                }
            }
        }

        if renames.is_empty() {
            return Ok(());
        }

        // Collect new-style names already in use to detect conflicts
        let mut used_numbers: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for section in &self.sections {
            if let Some(ref name) = section.name {
                let prefix = format!("{} ", section_word);
                if name.starts_with(&prefix) {
                    if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                        used_numbers.insert(num);
                    }
                }
            }
        }

        // Resolve conflicts: if two old names map to same number, renumber the one with fewer activities
        let mut number_to_sections: HashMap<u32, Vec<(String, u32)>> = HashMap::new();
        for (id, _, num) in &renames {
            let activity_count = self
                .sections
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.activity_ids.len() as u32)
                .unwrap_or(0);
            number_to_sections
                .entry(*num)
                .or_default()
                .push((id.clone(), activity_count));
        }

        let mut update_stmt = self
            .db
            .prepare("UPDATE sections SET name = ? WHERE id = ?")?;
        let mut next_counter = renames.iter().map(|(_, _, n)| *n).max().unwrap_or(0);

        for (num, mut section_ids) in number_to_sections {
            // Sort by activity count DESC — keep the one with most activities at this number
            section_ids.sort_by(|a, b| b.1.cmp(&a.1));

            for (i, (section_id, _)) in section_ids.iter().enumerate() {
                let final_num = if i == 0 && !used_numbers.contains(&num) {
                    // First (most activities) gets the original number if available
                    used_numbers.insert(num);
                    num
                } else {
                    // Conflict: find next available number
                    loop {
                        next_counter += 1;
                        if !used_numbers.contains(&next_counter) {
                            break;
                        }
                    }
                    used_numbers.insert(next_counter);
                    next_counter
                };

                let new_name = format!("{} {}", section_word, final_num);
                update_stmt.execute(params![&new_name, section_id])?;

                // Update in-memory
                if let Some(section) = self.sections.iter_mut().find(|s| &s.id == section_id) {
                    section.name = Some(new_name);
                }
            }
        }

        log::info!(
            "tracematch: [PersistentEngine] Stripped sport prefixes from {} section names",
            renames.len()
        );

        Ok(())
    }

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

    /// Get sections ranked by ML-driven composite relevance score.
    ///
    /// For each section matching the sport type, computes a weighted score from:
    /// - Recency (0.35): exp(-days_since_last / 14.0), 2-week half-life
    /// - Improvement signal (0.30): median of last 3 vs previous 3 efforts
    /// - Anomaly detection (0.20): z-score of most recent effort
    /// - Engagement (0.15): ln(traversal_count) / ln(max_traversal_count)
    ///
    /// Returns top `limit` sections sorted by relevance_score descending.
    pub fn get_ranked_sections(
        &self,
        sport_type: &str,
        limit: u32,
    ) -> Vec<crate::FfiRankedSection> {
        let start = std::time::Instant::now();

        // Query all sections for this sport type with their traversal data
        // Join section_activities with activity_metrics to get dates and lap times
        struct TraversalRow {
            section_id: String,
            section_name: String,
            lap_time: f64,
            activity_date: i64,
        }

        let rows: Vec<TraversalRow> = {
            let mut stmt = match self.db.prepare(
                "SELECT s.id, s.name, sa.lap_time, am.date
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE s.sport_type = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL
                   AND s.disabled = 0 AND s.superseded_by IS NULL
                 ORDER BY s.id, am.date ASC",
            ) {
                Ok(s) => s,
                Err(e) => {
                    log::error!(
                        "tracematch: [RankedSections] Failed to prepare query: {}",
                        e
                    );
                    return Vec::new();
                }
            };

            match stmt.query_map(rusqlite::params![sport_type], |row| {
                Ok(TraversalRow {
                    section_id: row.get(0)?,
                    section_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    lap_time: row.get(2)?,
                    activity_date: row.get(3)?,
                })
            }) {
                Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
                Err(e) => {
                    log::error!("tracematch: [RankedSections] Query failed: {}", e);
                    return Vec::new();
                }
            }
        };

        if rows.is_empty() {
            log::info!(
                "tracematch: [RankedSections] No traversals found for sport_type={}",
                sport_type
            );
            return Vec::new();
        }

        // Group traversals by section
        struct SectionData {
            name: String,
            times: Vec<f64>, // lap times in seconds, ordered by date ascending
            dates: Vec<i64>, // activity dates (unix timestamps), ascending
        }

        let mut sections: HashMap<String, SectionData> = HashMap::new();
        for row in &rows {
            let entry = sections
                .entry(row.section_id.clone())
                .or_insert_with(|| SectionData {
                    name: row.section_name.clone(),
                    times: Vec::new(),
                    dates: Vec::new(),
                });
            entry.times.push(row.lap_time);
            entry.dates.push(row.activity_date);
        }

        let now_secs = Utc::now().timestamp();

        // Find max traversal count for engagement normalization
        let max_traversal_count = sections
            .values()
            .map(|s| s.times.len())
            .max()
            .unwrap_or(1)
            .max(2); // Ensure ln(max) > 0

        let mut ranked: Vec<crate::FfiRankedSection> = sections
            .iter()
            .map(|(section_id, data)| {
                let traversal_count = data.times.len() as u32;
                let last_date = *data.dates.last().unwrap_or(&now_secs);
                let days_since_last = crate::calendar_days_between(last_date, now_secs);

                // --- Recency score (weight 0.35) ---
                // exp(-days / 14): half-life of ~2 weeks
                let recency_score = (-1.0 * days_since_last as f64 / 14.0).exp();

                // --- Improvement signal (weight 0.30) ---
                // Compare median of last 3 efforts to median of previous 3
                let improvement_score = if data.times.len() >= 6 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n - 3..].to_vec();
                    let mut previous: Vec<f64> = data.times[n - 6..n - 3].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    let median_recent = recent[1];
                    let median_previous = previous[1];
                    if median_previous > 0.0 {
                        // Negative change = faster = improving (for time-based metrics)
                        // Normalize: cap at +/- 100% change, then map to 0..1
                        let pct_change = (median_previous - median_recent) / median_previous;
                        (pct_change.clamp(-1.0, 1.0) + 1.0) / 2.0
                    } else {
                        0.5 // neutral
                    }
                } else if data.times.len() >= 3 {
                    // Fewer than 6: compare last effort to first effort
                    let first = data.times[0];
                    let last = *data.times.last().unwrap();
                    if first > 0.0 {
                        let pct_change = (first - last) / first;
                        (pct_change.clamp(-1.0, 1.0) + 1.0) / 2.0
                    } else {
                        0.5
                    }
                } else {
                    0.5 // not enough data, neutral
                };

                // --- Anomaly detection (weight 0.20) ---
                // Z-score of most recent effort against all efforts
                let anomaly_score = if data.times.len() >= 3 {
                    let mean = data.times.iter().sum::<f64>() / data.times.len() as f64;
                    let variance = data.times.iter().map(|t| (t - mean).powi(2)).sum::<f64>()
                        / data.times.len() as f64;
                    let std_dev = variance.sqrt();
                    if std_dev > 0.0 {
                        let latest = *data.times.last().unwrap();
                        let z = ((latest - mean) / std_dev).abs();
                        // Normalize: z of 0 = 0, z of 3+ = 1.0
                        (z / 3.0).min(1.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0 // not enough data for anomaly detection
                };

                // --- Engagement score (weight 0.15) ---
                // ln(traversal_count) / ln(max_traversal_count)
                let engagement_score = if traversal_count >= 2 && max_traversal_count >= 2 {
                    (traversal_count as f64).ln() / (max_traversal_count as f64).ln()
                } else if traversal_count >= 1 {
                    // Single traversal: small engagement score
                    0.1
                } else {
                    0.0
                };

                // --- Composite relevance score ---
                let relevance_score = 0.35 * recency_score
                    + 0.30 * improvement_score
                    + 0.20 * anomaly_score
                    + 0.15 * engagement_score;

                // --- Best time ---
                let best_time_secs = data.times.iter().cloned().fold(f64::INFINITY, f64::min);

                // --- Median of recent efforts ---
                let median_recent_secs = if data.times.len() >= 3 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n.saturating_sub(3)..].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    recent[recent.len() / 2]
                } else if !data.times.is_empty() {
                    let mut all = data.times.clone();
                    all.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    all[all.len() / 2]
                } else {
                    0.0
                };

                // --- Trend ---
                let trend = if data.times.len() >= 6 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n - 3..].to_vec();
                    let mut previous: Vec<f64> = data.times[n - 6..n - 3].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    let median_recent = recent[1];
                    let median_previous = previous[1];
                    let pct = if median_previous > 0.0 {
                        (median_previous - median_recent) / median_previous
                    } else {
                        0.0
                    };
                    if pct > 0.02 {
                        1
                    }
                    // >2% faster = improving
                    else if pct < -0.02 {
                        -1
                    }
                    // >2% slower = declining
                    else {
                        0
                    } // within 2% = stable
                } else if data.times.len() >= 2 {
                    let first = data.times[0];
                    let last = *data.times.last().unwrap();
                    let pct = if first > 0.0 {
                        (first - last) / first
                    } else {
                        0.0
                    };
                    if pct > 0.02 {
                        1
                    } else if pct < -0.02 {
                        -1
                    } else {
                        0
                    }
                } else {
                    0
                };

                let latest_is_pr = if let Some(&latest) = data.times.last() {
                    best_time_secs.is_finite() && (latest - best_time_secs).abs() < 0.01
                } else {
                    false
                };

                crate::FfiRankedSection {
                    section_id: section_id.clone(),
                    section_name: data.name.clone(),
                    relevance_score,
                    recency_score,
                    improvement_score,
                    anomaly_score,
                    engagement_score,
                    traversal_count,
                    best_time_secs: if best_time_secs.is_finite() {
                        best_time_secs
                    } else {
                        0.0
                    },
                    median_recent_secs,
                    days_since_last,
                    trend,
                    latest_is_pr,
                }
            })
            .collect();

        // Sort by relevance_score descending
        ranked.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Limit results
        ranked.truncate(limit as usize);

        log::info!(
            "tracematch: [RankedSections] Ranked {} sections for sport_type={} in {:?} (returning top {})",
            sections.len(),
            sport_type,
            start.elapsed(),
            ranked.len()
        );

        ranked
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

    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion and progress.
    ///
    /// Note: This method is designed to be non-blocking on the calling thread.
    /// All heavy operations (groups loading, track loading, detection) happen
    /// in the background thread to keep the UI responsive.
    pub fn detect_sections_background(
        &mut self,
        sport_filter: Option<String>,
    ) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // Create shared progress tracker
        let progress = SectionDetectionProgress::new();
        let progress_clone = progress.clone();

        // Ensure groups are computed before section detection.
        if self.groups_dirty {
            log::info!(
                "tracematch: [SectionDetection] Computing route groups before section detection..."
            );
            let start = std::time::Instant::now();
            let _ = self.get_groups();
            log::info!(
                "tracematch: [SectionDetection] Route groups computed in {:?}",
                start.elapsed()
            );
        }

        // Build sport type map
        let sport_map: HashMap<String, String> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.sport_type.clone()))
            .collect();

        // Filter activity IDs by sport
        let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
            self.activity_metadata
                .values()
                .filter(|m| &m.sport_type == sport)
                .map(|m| m.id.clone())
                .collect()
        } else {
            self.activity_metadata.keys().cloned().collect()
        };

        // Determine if incremental detection is possible:
        // - Must have existing sections
        // - New (unprocessed) activities must be < 50% of total
        // Use persistent tracking table (includes activities that didn't match any section)
        let existing_sections = self.sections.clone();

        let new_activity_ids: Vec<String> = activity_ids
            .iter()
            .filter(|id| !self.processed_activity_ids.contains(*id))
            .cloned()
            .collect();

        // Short-circuit: no new activities means nothing to detect
        if new_activity_ids.is_empty() && !existing_sections.is_empty() {
            log::info!(
                "tracematch: [SectionDetection] No new activities, skipping detection ({} already processed)",
                self.processed_activity_ids.len()
            );
            let sections_copy = existing_sections.clone();
            let all_ids = activity_ids.clone();
            tx.send((sections_copy, all_ids)).ok();
            return SectionDetectionHandle {
                receiver: rx,
                progress,
            };
        }

        let use_incremental = !existing_sections.is_empty()
            && !new_activity_ids.is_empty()
            && (new_activity_ids.len() as f64) < (activity_ids.len() as f64 * 0.5);

        if use_incremental {
            log::info!(
                "tracematch: [SectionDetection] Using INCREMENTAL mode: {} new of {} total activities, {} existing sections",
                new_activity_ids.len(),
                activity_ids.len(),
                existing_sections.len()
            );
        } else if !new_activity_ids.is_empty() && !existing_sections.is_empty() {
            log::info!(
                "tracematch: [SectionDetection] Using FULL mode: {} new of {} total activities (>{:.0}% threshold)",
                new_activity_ids.len(),
                activity_ids.len(),
                50.0
            );
        }

        // For incremental mode, only load tracks for new activities + section-referenced activities
        let ids_to_load = if use_incremental {
            let mut needed: HashSet<String> = new_activity_ids.iter().cloned().collect();
            for section in &existing_sections {
                for aid in &section.activity_ids {
                    needed.insert(aid.clone());
                }
            }
            needed.into_iter().collect()
        } else {
            activity_ids.clone()
        };
        progress.set_phase("loading", ids_to_load.len() as u32);

        // Clone activity_ids for the background thread (to persist as processed after detection)
        let all_activity_ids = activity_ids.clone();

        thread::spawn(move || {
            log::info!(
                "tracematch: [SectionDetection] Background thread started with {} activity IDs",
                ids_to_load.len()
            );

            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(e) => {
                    log::info!("tracematch: [SectionDetection] Failed to open DB: {:?}", e);
                    tx.send((Vec::new(), Vec::new())).ok();
                    return;
                }
            };

            let groups = load_groups_from_db(&conn);
            log::info!(
                "tracematch: [SectionDetection] Loaded {} groups from DB",
                groups.len()
            );

            progress_clone.set_phase("loading", ids_to_load.len() as u32);

            // Load GPS tracks from DB
            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let tracks: Vec<(String, Vec<GpsPoint>)> = ids_to_load
                .iter()
                .filter_map(|id| {
                    progress_clone.increment();
                    let mut stmt = conn
                        .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
                        .ok()?;
                    let track: Vec<GpsPoint> = stmt
                        .query_row(params![id], |row| {
                            let blob: Vec<u8> = row.get(0)?;
                            match rmp_serde::from_slice(&blob) {
                                Ok(t) => Ok(t),
                                Err(e) => {
                                    log::warn!(
                                        "tracematch: [SectionDetection] Skipping malformed track data for {}: {:?}",
                                        id, e
                                    );
                                    Ok(Vec::new())
                                }
                            }
                        })
                        .ok()?;
                    if track.is_empty() {
                        tracks_empty += 1;
                        return None;
                    }
                    tracks_loaded += 1;
                    Some((id.clone(), track))
                })
                .collect();

            log::info!(
                "tracematch: [SectionDetection] Loaded {} tracks ({} empty/missing) from {} activity IDs",
                tracks_loaded,
                tracks_empty,
                ids_to_load.len()
            );

            if tracks.is_empty() {
                log::info!("tracematch: [SectionDetection] No tracks loaded, skipping detection");
                progress_clone.set_phase("complete", 0);
                tx.send((Vec::new(), all_activity_ids)).ok();
                return;
            }

            let total_points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
            log::info!(
                "tracematch: [SectionDetection] Total GPS points: {}, avg per track: {}",
                total_points,
                total_points / tracks.len().max(1)
            );

            if use_incremental {
                // Incremental mode: match new activities against existing sections
                let new_set: HashSet<String> = new_activity_ids.into_iter().collect();
                let new_tracks: Vec<(String, Vec<GpsPoint>)> = tracks
                    .iter()
                    .filter(|(id, _)| new_set.contains(id))
                    .cloned()
                    .collect();

                log::info!(
                    "tracematch: [SectionDetection] Incremental: {} new tracks to match against {} sections",
                    new_tracks.len(),
                    existing_sections.len()
                );

                let result = tracematch::sections::incremental::detect_sections_incremental(
                    &new_tracks,
                    &existing_sections,
                    &tracks, // all tracks for consensus recalc
                    &sport_map,
                    &groups,
                    &section_config,
                    Arc::new(progress_clone.clone()),
                );

                log::info!(
                    "tracematch: [SectionDetection] Incremental complete: {} updated, {} new, {} matched, {} unmatched",
                    result.updated_sections.len(),
                    result.new_sections.len(),
                    result.matched_activity_ids.len(),
                    result.unmatched_activity_ids.len(),
                );

                // Merge: updated existing + newly discovered
                let mut all_sections = result.updated_sections;
                all_sections.extend(result.new_sections);

                progress_clone.set_phase("complete", 0);
                tx.send((all_sections, all_activity_ids)).ok();
            } else {
                // Full detection mode with batching for large datasets.
                // Cap full pairwise detection at BATCH_CAP activities per batch.
                // Subsequent batches use incremental detection against results from prior batches.
                const BATCH_CAP: usize = 500;

                if tracks.len() <= BATCH_CAP {
                    // Small enough for single-pass full detection
                    let result = tracematch::detect_sections_multiscale_with_progress(
                        &tracks,
                        &sport_map,
                        &groups,
                        &section_config,
                        Arc::new(progress_clone.clone()),
                    );

                    log::info!(
                        "tracematch: [SectionDetection] Detection complete: {} sections, {} potentials",
                        result.sections.len(),
                        result.potentials.len()
                    );

                    progress_clone.set_phase("complete", 0);
                    tx.send((result.sections, all_activity_ids)).ok();
                } else {
                    // Large dataset: process in batches
                    let num_batches = (tracks.len() + BATCH_CAP - 1) / BATCH_CAP;
                    log::info!(
                        "tracematch: [SectionDetection] Batched mode: {} activities in {} batches of up to {}",
                        tracks.len(),
                        num_batches,
                        BATCH_CAP
                    );

                    // Batch 1: full detection on first BATCH_CAP activities
                    let batch1_tracks = &tracks[..BATCH_CAP.min(tracks.len())];
                    let result = tracematch::detect_sections_multiscale_with_progress(
                        batch1_tracks,
                        &sport_map,
                        &groups,
                        &section_config,
                        Arc::new(progress_clone.clone()),
                    );

                    let mut accumulated_sections = result.sections;
                    log::info!(
                        "tracematch: [SectionDetection] Batch 1/{}: {} sections from {} activities",
                        num_batches,
                        accumulated_sections.len(),
                        batch1_tracks.len()
                    );

                    // Subsequent batches: incremental detection against accumulated sections
                    let mut batch_start = BATCH_CAP;
                    let mut batch_num = 2;
                    while batch_start < tracks.len() {
                        let batch_end = (batch_start + BATCH_CAP).min(tracks.len());
                        let batch_tracks = &tracks[batch_start..batch_end];

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: {} new activities against {} sections",
                            batch_num,
                            num_batches,
                            batch_tracks.len(),
                            accumulated_sections.len()
                        );

                        let incr_result =
                            tracematch::sections::incremental::detect_sections_incremental(
                                batch_tracks,
                                &accumulated_sections,
                                &tracks, // all tracks for consensus
                                &sport_map,
                                &groups,
                                &section_config,
                                Arc::new(progress_clone.clone()),
                            );

                        // Replace accumulated with updated + new
                        accumulated_sections = incr_result.updated_sections;
                        accumulated_sections.extend(incr_result.new_sections);

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: now {} total sections ({} matched, {} unmatched)",
                            batch_num,
                            num_batches,
                            accumulated_sections.len(),
                            incr_result.matched_activity_ids.len(),
                            incr_result.unmatched_activity_ids.len(),
                        );

                        batch_start = batch_end;
                        batch_num += 1;
                    }

                    log::info!(
                        "tracematch: [SectionDetection] Batched detection complete: {} sections",
                        accumulated_sections.len()
                    );

                    progress_clone.set_phase("complete", 0);
                    tx.send((accumulated_sections, all_activity_ids)).ok();
                }
            }
        });

        SectionDetectionHandle {
            receiver: rx,
            progress,
        }
    }

    /// Apply completed section detection results.
    /// Saves to DB first, only updates in-memory state on success.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        let old_sections = std::mem::replace(&mut self.sections, sections);
        match self.save_sections() {
            Ok(()) => {
                self.sections_dirty = false;
                // Clear activity_traces to prevent memory leak.
                // These GPS traces were used for consensus computation but are not persisted
                // to SQLite, so keeping them in memory is wasteful.
                for section in &mut self.sections {
                    section.activity_traces.clear();
                }
                // Invalidate section LRU cache since sections changed
                self.section_cache.clear();
                self.invalidate_perf_cache();

                // Merge sections that overlap geographically across different sport types
                if let Err(e) = self.merge_cross_sport_sections() {
                    log::warn!(
                        "tracematch: [apply_sections] Cross-sport merge failed: {}",
                        e
                    );
                }

                Ok(())
            }
            Err(e) => {
                // Rollback in-memory state on DB failure
                self.sections = old_sections;
                Err(e)
            }
        }
    }

    /// Merge sections that overlap geographically across different sport types.
    /// Two sections are candidates for merge if:
    /// - They are both auto-detected (not user-created)
    /// - They have different sport types
    /// - Their bounds centers are within 200m (Haversine)
    /// - Their distances are within 25% of each other
    ///
    /// The primary section (most activities) absorbs the secondary's activities.
    pub fn merge_cross_sport_sections(&mut self) -> SqlResult<()> {
        // Load all auto sections with bounds
        let sections: Vec<(String, String, f64, f64, f64, u32)> = {
            let mut stmt = self.db.prepare(
                "SELECT s.id, s.sport_type, s.distance_meters,
                        (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0,
                        (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0,
                        (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id AND sa.excluded = 0)
                 FROM sections s
                 WHERE s.section_type = 'auto' AND s.original_polyline_json IS NULL
                   AND s.bounds_min_lat IS NOT NULL"
            )?;
            stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?, // id
                    row.get::<_, String>(1)?, // sport_type
                    row.get::<_, f64>(2)?,    // distance_meters
                    row.get::<_, f64>(3)?,    // center_lat
                    row.get::<_, f64>(4)?,    // center_lng
                    row.get::<_, u32>(5)?,    // activity_count
                ))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        if sections.len() < 2 {
            return Ok(());
        }

        // Find merge candidates: different sport types, close centers, similar distances
        let mut merge_pairs: Vec<(usize, usize)> = Vec::new();
        for i in 0..sections.len() {
            for j in (i + 1)..sections.len() {
                let (_, ref sport_i, dist_i, lat_i, lng_i, _) = sections[i];
                let (_, ref sport_j, dist_j, lat_j, lng_j, _) = sections[j];

                // Skip same sport type
                if sport_i == sport_j {
                    continue;
                }

                // Check distance similarity (within 25%)
                let max_dist = dist_i.max(dist_j);
                let min_dist = dist_i.min(dist_j);
                if max_dist > 0.0 && (max_dist - min_dist) / max_dist > 0.25 {
                    continue;
                }

                // Haversine distance between centers
                let center_distance = haversine_distance(lat_i, lng_i, lat_j, lng_j);
                if center_distance > 200.0 {
                    continue;
                }

                merge_pairs.push((i, j));
            }
        }

        if merge_pairs.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [merge_cross_sport] Found {} cross-sport merge candidates",
            merge_pairs.len()
        );

        // Build merge groups using union-find
        let mut parent: Vec<usize> = (0..sections.len()).collect();
        fn find(parent: &mut [usize], i: usize) -> usize {
            if parent[i] != i {
                parent[i] = find(parent, parent[i]);
            }
            parent[i]
        }
        for &(i, j) in &merge_pairs {
            let pi = find(&mut parent, i);
            let pj = find(&mut parent, j);
            if pi != pj {
                // Merge into the one with more activities
                if sections[pi].5 >= sections[pj].5 {
                    parent[pj] = pi;
                } else {
                    parent[pi] = pj;
                }
            }
        }

        // Group sections by their root
        let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..sections.len() {
            let root = find(&mut parent, i);
            groups.entry(root).or_default().push(i);
        }

        let tx = self.db.unchecked_transaction()?;

        for (_, members) in &groups {
            if members.len() < 2 {
                continue;
            }

            // Primary = member with most activities
            let primary_idx = *members.iter().max_by_key(|&&idx| sections[idx].5).unwrap();
            let primary_id = &sections[primary_idx].0;

            // Check if primary has a user-set name (non-auto-generated)
            let primary_name: Option<String> = tx
                .query_row(
                    "SELECT name FROM sections WHERE id = ?",
                    params![primary_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten();

            for &idx in members {
                if idx == primary_idx {
                    continue;
                }
                let secondary_id = &sections[idx].0;

                // If secondary has a user-set name and primary doesn't, preserve it
                if primary_name.is_none() {
                    if let Ok(Some(sec_name)) = tx.query_row(
                        "SELECT name FROM sections WHERE id = ?",
                        params![secondary_id],
                        |row| row.get::<_, Option<String>>(0),
                    ) {
                        let section_word = get_section_word();
                        // Check if it's NOT auto-generated (doesn't match "{Sport} {Word} {N}" pattern)
                        let is_auto = [
                            "Ride",
                            "Run",
                            "Hike",
                            "Walk",
                            "Swim",
                            "VirtualRide",
                            "VirtualRun",
                        ]
                        .iter()
                        .any(|sport| {
                            let prefix = format!("{} {} ", sport, section_word);
                            sec_name.starts_with(&prefix)
                                && sec_name[prefix.len()..].parse::<u32>().is_ok()
                        });
                        if !is_auto {
                            tx.execute(
                                "UPDATE sections SET name = ? WHERE id = ?",
                                params![&sec_name, primary_id],
                            )?;
                        }
                    }
                }

                // Move secondary's activities to primary
                tx.execute(
                    "UPDATE OR IGNORE section_activities SET section_id = ? WHERE section_id = ?",
                    params![primary_id, secondary_id],
                )?;
                // Delete any that couldn't be moved (duplicate activity_id + section_id)
                tx.execute(
                    "DELETE FROM section_activities WHERE section_id = ?",
                    params![secondary_id],
                )?;
                // Delete secondary section
                tx.execute("DELETE FROM sections WHERE id = ?", params![secondary_id])?;

                log::info!(
                    "tracematch: [merge_cross_sport] Merged {} ({}) into {} ({})",
                    secondary_id,
                    sections[idx].1,
                    primary_id,
                    sections[primary_idx].1
                );
            }
        }

        tx.commit()?;

        // Reload sections into memory
        self.section_cache.clear();
        self.invalidate_perf_cache();
        self.load_sections()?;

        Ok(())
    }

    fn save_sections(&self) -> SqlResult<()> {
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

                let (lap_time, lap_pace) = if let Some(times) = times {
                    let start_idx = portion.start_index as usize;
                    let end_idx = portion.end_index as usize;
                    if start_idx < times.len() && end_idx < times.len() {
                        let lap_time = (times[end_idx] as f64 - times[start_idx] as f64).abs();
                        if lap_time > 0.0 {
                            let lap_pace = portion.distance_meters / lap_time;
                            (Some(lap_time), Some(lap_pace))
                        } else {
                            (None, None)
                        }
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

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

    // ========================================================================
    // Section Names
    // ========================================================================

    /// Set the name for a section.
    /// Pass None to clear the name.
    pub fn set_section_name(&mut self, section_id: &str, name: Option<&str>) -> SqlResult<()> {
        match name {
            Some(n) => {
                self.db.execute(
                    "UPDATE sections SET name = ? WHERE id = ?",
                    params![n, section_id],
                )?;
                // Update in-memory section
                if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                    section.name = Some(n.to_string());
                }
            }
            None => {
                self.db.execute(
                    "UPDATE sections SET name = NULL WHERE id = ?",
                    params![section_id],
                )?;
                // Update in-memory section
                if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                    section.name = None;
                }
            }
        }
        Ok(())
    }

    /// Get the name for a section (if any).
    pub fn get_section_name(&self, section_id: &str) -> Option<String> {
        // Check in-memory sections first
        self.sections
            .iter()
            .find(|s| s.id == section_id)
            .and_then(|s| s.name.clone())
    }

    /// Get all section names.
    pub fn get_all_section_names(&self) -> HashMap<String, String> {
        self.sections
            .iter()
            .filter_map(|s| s.name.as_ref().map(|n| (s.id.clone(), n.clone())))
            .collect()
    }
}
