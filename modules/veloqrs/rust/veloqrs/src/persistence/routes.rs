//! Route groups: loading, grouping, matching, consensus routes, names.

use std::collections::HashMap;
use rusqlite::{Result as SqlResult, params};
use crate::{
    Bounds, GpsPoint, RouteGroup, geo_utils,
};

use super::{get_route_word, GroupSummary, PersistentRouteEngine};

impl PersistentRouteEngine {
    // ========================================================================
    // Loading
    // ========================================================================

    /// Load route groups from database.
    pub(super) fn load_groups(&mut self) -> SqlResult<()> {
        self.groups.clear();

        // Scope the statement to release the borrow before load_route_names
        {
            let mut stmt = self.db.prepare(
                "SELECT id, representative_id, activity_ids, sport_type,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                 FROM route_groups",
            )?;

            self.groups = stmt
                .query_map([], |row| {
                    let activity_ids_json: String = row.get(2)?;
                    let activity_ids: Vec<String> =
                        serde_json::from_str(&activity_ids_json).unwrap_or_default();

                    let bounds =
                        if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
                            row.get::<_, Option<f64>>(4)?,
                            row.get::<_, Option<f64>>(5)?,
                            row.get::<_, Option<f64>>(6)?,
                            row.get::<_, Option<f64>>(7)?,
                        ) {
                            Some(Bounds {
                                min_lat,
                                max_lat,
                                min_lng,
                                max_lng,
                            })
                        } else {
                            None
                        };

                    Ok(RouteGroup {
                        group_id: row.get(0)?,
                        representative_id: row.get(1)?,
                        activity_ids,
                        sport_type: row.get(3)?,
                        bounds,
                        custom_name: None, // Will be loaded separately from route_names table
                        // Performance stats populated by engine when metrics are available
                        best_time: None,
                        avg_time: None,
                        best_pace: None,
                        best_activity_id: None,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
        }

        // Load custom names and apply to groups
        self.load_route_names()?;

        // Load activity matches
        self.load_activity_matches()?;

        // If we have groups but no match info, force recompute to populate match percentages
        // This handles databases created before match percentage tracking was added
        let groups_count = self.groups.len();
        let matches_count = self.activity_matches.len();
        log::info!(
            "tracematch: load_groups: {} groups, {} activity_matches entries",
            groups_count,
            matches_count
        );

        if !self.groups.is_empty() && self.activity_matches.is_empty() {
            log::info!(
                "tracematch: Forcing groups recompute: groups exist but activity_matches is empty"
            );
            self.groups_dirty = true;
        } else {
            self.groups_dirty = false;
        }
        Ok(())
    }

    /// Load custom route names and apply them to groups.
    /// Also generates names for any groups that don't have names yet (migration).
    fn load_route_names(&mut self) -> SqlResult<()> {
        let mut stmt = self
            .db
            .prepare("SELECT route_id, custom_name FROM route_names")?;

        let mut names: HashMap<String, String> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Clean up orphaned route_names (names for routes that no longer exist)
        let current_group_ids: std::collections::HashSet<&str> =
            self.groups.iter().map(|g| g.group_id.as_str()).collect();

        let orphaned_ids: Vec<String> = names.keys()
            .filter(|id| !current_group_ids.contains(id.as_str()))
            .cloned()
            .collect();

        if !orphaned_ids.is_empty() {
            log::info!(
                "tracematch: [PersistentEngine] load_route_names: Cleaning up {} orphaned route names",
                orphaned_ids.len()
            );
            let mut delete_stmt = self.db.prepare("DELETE FROM route_names WHERE route_id = ?")?;
            for id in &orphaned_ids {
                delete_stmt.execute(params![id])?;
                names.remove(id);
            }
        }

        // Migration: Generate names for groups that don't have names yet
        let groups_without_names: Vec<(String, String)> = self
            .groups
            .iter()
            .filter(|g| !names.contains_key(&g.group_id))
            .map(|g| (g.group_id.clone(), g.sport_type.clone()))
            .collect();

        if !groups_without_names.is_empty() {
            log::info!(
                "tracematch: [PersistentEngine] Migrating {} routes without names",
                groups_without_names.len()
            );

            let route_word = get_route_word();

            // Collect which numbers are already taken for each sport type
            let mut taken_numbers: HashMap<String, std::collections::HashSet<u32>> = HashMap::new();
            for name in names.values() {
                for sport in ["Ride", "Run", "Hike", "Walk", "Swim", "VirtualRide", "VirtualRun"] {
                    let prefix = format!("{} {} ", sport, route_word);
                    if name.starts_with(&prefix) {
                        if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                            taken_numbers.entry(sport.to_string()).or_default().insert(num);
                        }
                    }
                }
            }

            // Generate and insert names for groups without names
            let mut insert_stmt = self
                .db
                .prepare("INSERT OR IGNORE INTO route_names (route_id, custom_name) VALUES (?, ?)")?;

            // Track next available number for each sport type
            let mut sport_counters: HashMap<String, u32> = HashMap::new();

            for (group_id, sport_type) in groups_without_names {
                let taken = taken_numbers.entry(sport_type.clone()).or_default();
                let counter = sport_counters.entry(sport_type.clone()).or_insert(0);

                // Find next available number (skip taken numbers)
                loop {
                    *counter += 1;
                    if !taken.contains(counter) {
                        break;
                    }
                }

                let new_name = format!("{} {} {}", sport_type, route_word, counter);
                insert_stmt.execute(params![&group_id, &new_name])?;
                names.insert(group_id, new_name.clone());
                taken.insert(*counter); // Mark this number as taken
            }
        }

        // Apply names to groups
        for group in &mut self.groups {
            if let Some(name) = names.get(&group.group_id) {
                group.custom_name = Some(name.clone());
            }
        }

        Ok(())
    }

    // ========================================================================
    // Route Groups
    // ========================================================================

    /// Get route groups, recomputing if dirty.
    pub fn get_groups(&mut self) -> &[RouteGroup] {
        if self.groups_dirty {
            self.recompute_groups();
        }
        &self.groups
    }

    /// Recompute route groups.
    fn recompute_groups(&mut self) {
        use std::time::Instant;
        let total_start = Instant::now();
        log::info!("[RUST: PERF] recompute_groups: starting...");

        // Phase 1: Load all signatures (this will use cache where possible)
        let sig_start = Instant::now();
        let activity_ids: Vec<String> = self.activity_metadata.keys().cloned().collect();
        let mut signatures = Vec::with_capacity(activity_ids.len());

        for id in &activity_ids {
            if let Some(sig) = self.get_signature(id) {
                signatures.push(sig);
            }
        }
        let sig_ms = sig_start.elapsed().as_millis();

        log::info!(
            "[RUST: PERF] Phase 1 - Load signatures: {} from {} activities in {}ms",
            signatures.len(),
            activity_ids.len(),
            sig_ms
        );

        // Phase 2: Group signatures and capture match info (uses parallel rayon)
        let group_start = Instant::now();
        let result = tracematch::group_signatures_parallel_with_matches(&signatures, &self.match_config);

        let group_ms = group_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] Phase 2 - Group signatures: {} groups in {}ms (uses simplified signatures)",
            result.groups.len(),
            group_ms
        );

        self.groups = result.groups;
        self.activity_matches = result.activity_matches;

        // Phase 3: Recalculate match percentages using ORIGINAL GPS tracks (not simplified signatures)
        // This captures actual GPS variation that was smoothed out by Douglas-Peucker
        // NOTE: This is the BOTTLENECK - see PERF logs inside this function
        self.recalculate_match_percentages_from_tracks();

        // Log match info computed
        let total_matches: usize = self.activity_matches.values().map(|v| v.len()).sum();
        log::info!(
            "[RUST: PERF] Phase 3 complete: {} groups with {} total match entries",
            self.groups.len(),
            total_matches
        );

        // Populate sport_type for each group from the representative activity
        for group in &mut self.groups {
            if let Some(meta) = self.activity_metadata.get(&group.representative_id) {
                group.sport_type = if meta.sport_type.is_empty() {
                    "Ride".to_string() // Default for empty sport type
                } else {
                    meta.sport_type.clone()
                };
            } else {
                // Representative activity not found - use default
                group.sport_type = "Ride".to_string();
            }
        }

        // Phase 4: Save to database
        let save_start = Instant::now();
        self.save_groups().ok();
        let save_ms = save_start.elapsed().as_millis();
        self.groups_dirty = false;

        let total_ms = total_start.elapsed().as_millis();
        log::info!("[RUST: PERF] Phase 4 - Save groups: {}ms", save_ms);
        log::info!(
            "[RUST: PERF] recompute_groups TOTAL: {}ms (signatures={}ms + grouping={}ms + AMD_recalc=see_above + save={}ms)",
            total_ms,
            sig_ms,
            group_ms,
            save_ms
        );
    }

    /// Recalculate match percentages using original GPS tracks instead of simplified signatures.
    /// Uses AMD (Average Minimum Distance) for accurate track comparison.
    fn recalculate_match_percentages_from_tracks(&mut self) {
        use crate::matching::{amd_to_percentage, average_min_distance};
        use std::collections::HashMap;
        use std::time::Instant;

        let func_start = Instant::now();

        // PERF ASSESSMENT: This function is a BOTTLENECK
        // - Loads ALL GPS tracks from SQLite (I/O bound)
        // - Does pairwise AMD calculations SEQUENTIALLY (CPU bound, O(n*m) per pair)
        // - Could be parallelized with rayon but requires restructuring
        log::info!(
            "tracematch: [PERF] recalculate_match_percentages: SEQUENTIAL pairwise AMD - {} groups",
            self.groups.len()
        );

        // First pass: collect all activity IDs and load tracks
        // PERF: I/O bound - loads tracks SEQUENTIALLY from SQLite
        let load_start = Instant::now();
        let mut tracks: HashMap<String, Vec<GpsPoint>> = HashMap::new();
        let mut total_points_loaded: usize = 0;

        for group in &self.groups {
            // Load representative track
            if let Some(track) = self.load_gps_track_from_db(&group.representative_id)
                && track.len() >= 2
            {
                total_points_loaded += track.len();
                tracks.insert(group.representative_id.clone(), track);
            }

            // Load all activity tracks in this group
            if let Some(matches) = self.activity_matches.get(&group.group_id) {
                for match_info in matches {
                    if !tracks.contains_key(&match_info.activity_id)
                        && let Some(track) = self.load_gps_track_from_db(&match_info.activity_id)
                        && track.len() >= 2
                    {
                        total_points_loaded += track.len();
                        tracks.insert(match_info.activity_id.clone(), track);
                    }
                }
            }
        }
        let load_ms = load_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] Track loading: {} tracks, {} total points in {}ms (SEQUENTIAL I/O)",
            tracks.len(),
            total_points_loaded,
            load_ms
        );

        // Second pass: recalculate match percentages using AMD
        // PERF: CPU bound - O(n*m) distance calculations per pair
        // OPTIMIZATION 1: Skip self-comparisons (activity == representative)
        // OPTIMIZATION 2: Parallelize with rayon
        let calc_start = Instant::now();

        // Collect work items for parallel processing
        let mut work_items: Vec<(String, String, Vec<GpsPoint>, Vec<GpsPoint>)> = Vec::new();
        let mut skipped_self = 0u32;

        for group in &self.groups {
            let rep_track = match tracks.get(&group.representative_id) {
                Some(t) => t,
                None => continue,
            };

            if let Some(matches) = self.activity_matches.get(&group.group_id) {
                for match_info in matches {
                    // OPTIMIZATION: Skip self-comparisons - always 100% match
                    if match_info.activity_id == group.representative_id {
                        skipped_self += 1;
                        continue;
                    }

                    let activity_track = match tracks.get(&match_info.activity_id) {
                        Some(t) => t,
                        None => continue,
                    };

                    work_items.push((
                        group.group_id.clone(),
                        match_info.activity_id.clone(),
                        activity_track.clone(),
                        rep_track.clone(),
                    ));
                }
            }
        }

        log::info!(
            "[RUST: PERF] AMD work: {} pairs to compute, {} self-comparisons skipped",
            work_items.len(),
            skipped_self
        );

        // Parallel AMD calculation using rayon
        use rayon::prelude::*;

        let results: Vec<(String, String, f64, usize, usize)> = work_items
            .par_iter()
            .map(|(group_id, activity_id, activity_track, rep_track)| {
                let amd_1_to_2 = average_min_distance(activity_track, rep_track);
                let amd_2_to_1 = average_min_distance(rep_track, activity_track);
                let avg_amd = (amd_1_to_2 + amd_2_to_1) / 2.0;
                (
                    group_id.clone(),
                    activity_id.clone(),
                    avg_amd,
                    activity_track.len(),
                    rep_track.len(),
                )
            })
            .collect();

        let amd_calculations = (results.len() * 2) as u32;

        // Apply results back to activity_matches
        for (group_id, activity_id, avg_amd, activity_len, rep_len) in results {
            let new_percentage = amd_to_percentage(
                avg_amd,
                self.match_config.perfect_threshold,
                self.match_config.zero_threshold,
            );

            if let Some(matches) = self.activity_matches.get_mut(&group_id)
                && let Some(match_info) = matches.iter_mut().find(|m| m.activity_id == activity_id)
            {
                log::debug!(
                    "tracematch: recalc match % for {}: {:.1}% -> {:.1}% (AMD: {:.1}m, {} vs {} points)",
                    activity_id,
                    match_info.match_percentage,
                    new_percentage,
                    avg_amd,
                    activity_len,
                    rep_len
                );
                match_info.match_percentage = new_percentage;
            }
        }

        let calc_ms = calc_start.elapsed().as_millis();
        let total_ms = func_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] AMD calculations: {} calls in {}ms (PARALLEL with rayon)",
            amd_calculations,
            calc_ms
        );
        log::info!(
            "[RUST: PERF] recalculate_match_percentages TOTAL: {}ms (load={}ms + calc={}ms)",
            total_ms,
            load_ms,
            calc_ms
        );
    }

    fn save_groups(&self) -> SqlResult<()> {
        // Clear existing groups and matches
        self.db.execute("DELETE FROM route_groups", [])?;
        self.db.execute("DELETE FROM activity_matches", [])?;

        // Load existing route names to preserve user-set names
        let existing_names: HashMap<String, String> = {
            let mut stmt = self.db.prepare("SELECT route_id, custom_name FROM route_names")?;
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Clean up orphaned route_names (names for routes that no longer exist)
        let current_group_ids: std::collections::HashSet<&str> =
            self.groups.iter().map(|g| g.group_id.as_str()).collect();

        let orphaned_ids: Vec<String> = existing_names.keys()
            .filter(|id| !current_group_ids.contains(id.as_str()))
            .cloned()
            .collect();

        if !orphaned_ids.is_empty() {
            log::info!(
                "tracematch: [PersistentEngine] Cleaning up {} orphaned route names",
                orphaned_ids.len()
            );
            let mut delete_stmt = self.db.prepare("DELETE FROM route_names WHERE route_id = ?")?;
            for id in &orphaned_ids {
                delete_stmt.execute(params![id])?;
            }
        }

        // Rebuild existing_names after cleanup
        let existing_names: HashMap<String, String> = {
            let mut stmt = self.db.prepare("SELECT route_id, custom_name FROM route_names")?;
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let route_word = get_route_word();

        // Collect which numbers are already taken for each sport type (from user-renamed routes)
        // Only count names that follow the auto-generated pattern (e.g., "Run Route 1")
        let mut taken_numbers: HashMap<String, std::collections::HashSet<u32>> = HashMap::new();
        for name in existing_names.values() {
            for sport in ["Ride", "Run", "Hike", "Walk", "Swim", "VirtualRide", "VirtualRun"] {
                let prefix = format!("{} {} ", sport, route_word);
                if name.starts_with(&prefix) {
                    if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                        taken_numbers.entry(sport.to_string()).or_default().insert(num);
                    }
                }
            }
        }

        // Insert groups
        let mut stmt = self.db.prepare(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                        activity_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        // Prepare statement for inserting new route names
        let mut name_stmt = self.db.prepare(
            "INSERT OR IGNORE INTO route_names (route_id, custom_name) VALUES (?, ?)"
        )?;

        // Sort groups by sport type and activity count (most activities first)
        // This ensures consistent, predictable numbering
        let mut sorted_groups: Vec<&tracematch::RouteGroup> = self.groups.iter().collect();
        sorted_groups.sort_by(|a, b| {
            a.sport_type.cmp(&b.sport_type)
                .then_with(|| b.activity_ids.len().cmp(&a.activity_ids.len()))
        });

        // Track next available number for each sport type (for sequential assignment)
        let mut sport_counters: HashMap<String, u32> = HashMap::new();

        for group in sorted_groups {
            let activity_ids_json = serde_json::to_string(&group.activity_ids).unwrap_or_default();
            stmt.execute(params![
                group.group_id,
                group.representative_id,
                activity_ids_json,
                group.sport_type,
                group.bounds.map(|b| b.min_lat),
                group.bounds.map(|b| b.max_lat),
                group.bounds.map(|b| b.min_lng),
                group.bounds.map(|b| b.max_lng),
                group.activity_ids.len() as u32,
            ])?;

            // Generate unique name if route doesn't already have one
            if !existing_names.contains_key(&group.group_id) {
                let taken = taken_numbers.entry(group.sport_type.clone()).or_default();
                let counter = sport_counters.entry(group.sport_type.clone()).or_insert(0);

                // Find next available number (skip taken numbers)
                loop {
                    *counter += 1;
                    if !taken.contains(counter) {
                        break;
                    }
                }

                let new_name = format!("{} {} {}", group.sport_type, route_word, counter);
                name_stmt.execute(params![group.group_id, new_name])?;
                taken.insert(*counter); // Mark this number as taken
            }
        }

        // Insert activity matches
        let mut match_stmt = self.db.prepare(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES (?, ?, ?, ?)",
        )?;

        for (route_id, matches) in &self.activity_matches {
            for m in matches {
                match_stmt.execute(params![
                    route_id,
                    m.activity_id,
                    m.match_percentage,
                    m.direction.to_string(),
                ])?;
            }
        }

        Ok(())
    }

    // ========================================================================
    // Group Queries
    // ========================================================================

    /// Get group count from database.
    pub fn get_group_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get group summaries for the routes screen.
    pub fn get_group_summaries(&self) -> Vec<GroupSummary> {
        let mut stmt = match self.db.prepare(
            "SELECT id, representative_id, sport_type, activity_ids,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    activity_count
             FROM route_groups",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare group summaries query: {}",
                    e
                );
                return Vec::new();
            }
        };

        // Load custom names
        let custom_names = self.get_all_route_names();

        let results: Vec<GroupSummary> = stmt
            .query_map([], |row| {
                let group_id: String = row.get(0)?;
                let representative_id: String = row.get(1)?;
                let sport_type: String = row.get(2)?;

                // Read activity_count from cached column, fall back to JSON parse if NULL
                let activity_count: u32 = match row.get::<_, Option<u32>>(8)? {
                    Some(count) => count,
                    None => {
                        let activity_ids_json: String = row.get(3)?;
                        serde_json::from_str::<Vec<String>>(&activity_ids_json)
                            .map(|ids| ids.len() as u32)
                            .unwrap_or(0)
                    }
                };

                // Build bounds if present
                let bounds = if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<f64>>(7)?,
                ) {
                    Some(crate::FfiBounds {
                        min_lat,
                        max_lat,
                        min_lng,
                        max_lng,
                    })
                } else {
                    None
                };

                // Look up custom name
                let custom_name = custom_names.get(&group_id).cloned();

                Ok(GroupSummary {
                    group_id,
                    representative_id,
                    sport_type,
                    activity_count,
                    custom_name,
                    bounds,
                })
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        log::info!(
            "tracematch: [PersistentEngine] get_group_summaries returned {} summaries",
            results.len()
        );
        results
    }

    /// Get a single group by ID with LRU caching.
    /// Uses LRU cache to avoid repeated SQLite queries for hot groups.
    pub fn get_group_by_id(&mut self, group_id: &str) -> Option<RouteGroup> {
        // Check LRU cache first
        if let Some(group) = self.group_cache.get(&group_id.to_string()) {
            log::debug!(
                "tracematch: [PersistentEngine] get_group_by_id cache hit for {}",
                group_id
            );
            return Some(group.clone());
        }

        let custom_names = self.get_all_route_names();

        let result: Option<RouteGroup> = self
            .db
            .query_row(
                "SELECT id, representative_id, activity_ids, sport_type,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                 FROM route_groups WHERE id = ?",
                params![group_id],
                |row| {
                    let id: String = row.get(0)?;
                    let representative_id: String = row.get(1)?;
                    let activity_ids_json: String = row.get(2)?;
                    let sport_type: String = row.get(3)?;

                    let activity_ids: Vec<String> =
                        serde_json::from_str(&activity_ids_json).unwrap_or_default();

                    let bounds =
                        if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
                            row.get::<_, Option<f64>>(4)?,
                            row.get::<_, Option<f64>>(5)?,
                            row.get::<_, Option<f64>>(6)?,
                            row.get::<_, Option<f64>>(7)?,
                        ) {
                            Some(Bounds {
                                min_lat,
                                max_lat,
                                min_lng,
                                max_lng,
                            })
                        } else {
                            None
                        };

                    let custom_name = custom_names.get(&id).cloned();

                    Ok(RouteGroup {
                        group_id: id,
                        representative_id,
                        activity_ids,
                        sport_type,
                        bounds,
                        custom_name,
                        best_time: None,
                        avg_time: None,
                        best_pace: None,
                        best_activity_id: None,
                    })
                },
            )
            .ok();

        // Cache for future access
        if let Some(ref group) = result {
            self.group_cache.put(group_id.to_string(), group.clone());
            log::info!(
                "tracematch: [PersistentEngine] get_group_by_id found and cached group {}",
                group_id
            );
        } else {
            log::info!(
                "tracematch: [PersistentEngine] get_group_by_id: group {} not found",
                group_id
            );
        }

        result
    }

    // ========================================================================
    // Consensus Routes
    // ========================================================================

    /// Load a group's activity IDs directly from SQLite without triggering recomputation.
    fn get_group_activity_ids_from_db(&self, group_id: &str) -> Option<Vec<String>> {
        self.db
            .query_row(
                "SELECT activity_ids FROM route_groups WHERE id = ?",
                params![group_id],
                |row| {
                    let json: String = row.get(0)?;
                    Ok(serde_json::from_str(&json).unwrap_or_default())
                },
            )
            .ok()
    }

    /// Batch-load simplified signature polylines for multiple activity IDs.
    /// Returns a map of activity_id → flat [lat, lng, lat, lng, ...] coordinates.
    /// Uses the signatures table (MessagePack BLOBs with ~100 simplified points).
    pub(super) fn get_representative_polylines_batch(&self, activity_ids: &[&str]) -> HashMap<String, Vec<f64>> {
        if activity_ids.is_empty() {
            return HashMap::new();
        }

        let placeholders: Vec<&str> = activity_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT activity_id, points FROM signatures WHERE activity_id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare batch signature query: {}",
                    e
                );
                return HashMap::new();
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let results: HashMap<String, Vec<f64>> = stmt
            .query_map(params.as_slice(), |row| {
                let activity_id: String = row.get(0)?;
                let points_blob: Vec<u8> = row.get(1)?;
                let points: Vec<GpsPoint> = rmp_serde::from_slice(&points_blob).unwrap_or_default();
                let flat_coords: Vec<f64> = points
                    .iter()
                    .flat_map(|p| vec![p.latitude, p.longitude])
                    .collect();
                Ok((activity_id, flat_coords))
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        results
    }

    /// Get consensus route for a group, with caching.
    pub fn get_consensus_route(&mut self, group_id: &str) -> Option<Vec<GpsPoint>> {
        // Check cache
        if let Some(consensus) = self.consensus_cache.get(&group_id.to_string()) {
            return Some(consensus.clone());
        }

        // Load activity IDs directly from SQLite to avoid triggering recompute_groups()
        let activity_ids = self.get_group_activity_ids_from_db(group_id)?;
        if activity_ids.is_empty() {
            return None;
        }

        // Get tracks for this group (now we can borrow self again)
        let tracks: Vec<Vec<GpsPoint>> = activity_ids
            .iter()
            .filter_map(|id| self.get_gps_track(id))
            .collect();

        if tracks.is_empty() {
            return None;
        }

        // Compute medoid (most representative track)
        let consensus = self.compute_medoid_track(&tracks);

        // Cache result
        self.consensus_cache
            .put(group_id.to_string(), consensus.clone());

        Some(consensus)
    }

    fn compute_medoid_track(&self, tracks: &[Vec<GpsPoint>]) -> Vec<GpsPoint> {
        if tracks.is_empty() {
            return vec![];
        }
        if tracks.len() == 1 {
            return tracks[0].clone();
        }

        // Find track with minimum total distance to all others
        let mut best_idx = 0;
        let mut best_total_dist = f64::MAX;

        for (i, track_i) in tracks.iter().enumerate() {
            let total_dist: f64 = tracks
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, track_j)| self.track_distance(track_i, track_j))
                .sum();

            if total_dist < best_total_dist {
                best_total_dist = total_dist;
                best_idx = i;
            }
        }

        tracks[best_idx].clone()
    }

    fn track_distance(&self, track1: &[GpsPoint], track2: &[GpsPoint]) -> f64 {
        if track1.is_empty() || track2.is_empty() {
            return f64::MAX;
        }

        let sample_size = 20.min(track1.len().min(track2.len()));
        let step1 = track1.len() / sample_size;
        let step2 = track2.len() / sample_size;

        let sampled1: Vec<&GpsPoint> = (0..sample_size).map(|i| &track1[i * step1]).collect();
        let sampled2: Vec<&GpsPoint> = (0..sample_size).map(|i| &track2[i * step2]).collect();

        sampled1
            .iter()
            .map(|p1| {
                sampled2
                    .iter()
                    .map(|p2| geo_utils::haversine_distance(p1, p2))
                    .fold(f64::MAX, f64::min)
            })
            .sum::<f64>()
            / sample_size as f64
    }

    // ========================================================================
    // Route Names
    // ========================================================================

    /// Set a custom name for a route.
    /// Pass None to clear the custom name.
    pub fn set_route_name(&mut self, route_id: &str, name: Option<&str>) -> SqlResult<()> {
        match name {
            Some(n) => {
                self.db.execute(
                    "INSERT OR REPLACE INTO route_names (route_id, custom_name) VALUES (?, ?)",
                    params![route_id, n],
                )?;
                // Update in-memory group
                if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                    group.custom_name = Some(n.to_string());
                }
            }
            None => {
                self.db.execute(
                    "DELETE FROM route_names WHERE route_id = ?",
                    params![route_id],
                )?;
                // Update in-memory group
                if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                    group.custom_name = None;
                }
            }
        }
        Ok(())
    }

    /// Get the custom name for a route (if any).
    pub fn get_route_name(&self, route_id: &str) -> Option<String> {
        // Check in-memory groups first
        self.groups
            .iter()
            .find(|g| g.group_id == route_id)
            .and_then(|g| g.custom_name.clone())
    }

    /// Get all custom route names from the database.
    pub fn get_all_route_names(&self) -> HashMap<String, String> {
        // Query the database directly to ensure we get the latest names
        let mut result = HashMap::new();
        if let Ok(mut stmt) = self.db.prepare("SELECT route_id, custom_name FROM route_names") {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    result.insert(row.0, row.1);
                }
            }
        }
        result
    }

    // ========================================================================
    // Route Activity Exclusion
    // ========================================================================

    /// Exclude an activity from a route's analysis.
    /// Sets the `excluded` flag to 1 on the activity_matches row.
    pub fn exclude_activity_from_route(&mut self, route_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE activity_matches SET excluded = 1 WHERE route_id = ? AND activity_id = ?",
                params![route_id, activity_id],
            )
            .map_err(|e| format!("Failed to exclude activity from route: {}", e))?;
        Ok(())
    }

    /// Re-include a previously excluded activity in a route's analysis.
    /// Sets the `excluded` flag back to 0 on the activity_matches row.
    pub fn include_activity_in_route(&mut self, route_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE activity_matches SET excluded = 0 WHERE route_id = ? AND activity_id = ?",
                params![route_id, activity_id],
            )
            .map_err(|e| format!("Failed to include activity in route: {}", e))?;
        Ok(())
    }

    /// Get activity IDs that are excluded from a route.
    pub fn get_excluded_route_activity_ids(&self, route_id: &str) -> Vec<String> {
        let mut stmt = match self.db.prepare(
            "SELECT DISTINCT activity_id FROM activity_matches WHERE route_id = ? AND excluded = 1"
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(params![route_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }
}
