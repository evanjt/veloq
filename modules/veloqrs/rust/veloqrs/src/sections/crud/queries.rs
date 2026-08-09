//! Read-only section queries.
//!
//! Fetching sections by type or activity, summaries, counts, bounds checks,
//! and the reference-activity extension track. All functions here are pure
//! reads - they never mutate section state.

use super::super::{Section, SectionSummary, SectionType};
use crate::persistence::{PersistentRouteEngine, codec};
use rusqlite::params;
use tracematch::GpsPoint;
use tracematch::sections::{build_rtree, find_all_track_portions};

impl PersistentRouteEngine {
    /// Column list for full section queries.
    pub(super) const SECTION_COLUMNS: &'static str =
        "id, section_type, name, sport_type, polyline_json, distance_meters,
         representative_activity_id, confidence, observation_count, average_spread,
         point_density_json, scale, version, is_user_defined, stability,
         source_activity_id, start_index, end_index, created_at, updated_at,
         disabled, superseded_by, polyline_blob, point_density_blob";

    /// Visibility filter: exclude disabled and superseded sections.
    pub(super) const VISIBLE_FILTER: &'static str = "disabled = 0 AND superseded_by IS NULL";

    /// Get sections with optional type filter (excludes disabled/superseded).
    pub fn get_sections_by_type(&self, section_type: Option<SectionType>) -> Vec<Section> {
        let query = match section_type {
            Some(st) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}' AND {}",
                Self::SECTION_COLUMNS,
                st.as_str(),
                Self::VISIBLE_FILTER
            ),
            None => format!(
                "SELECT {} FROM sections WHERE {}",
                Self::SECTION_COLUMNS,
                Self::VISIBLE_FILTER
            ),
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let section_type_str: String = row.get(1)?;
            let polyline_json: String = row.get(4)?;
            let point_density_json: Option<String> = row.get(10)?;
            let polyline_blob: Option<Vec<u8>> = row.get(22)?;
            let point_density_blob: Option<Vec<u8>> = row.get(23)?;

            // Get activity IDs from junction table
            let activity_ids = self.get_section_activity_ids(&id);

            Ok(Section {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                polyline: codec::decode_polyline_row(
                    polyline_blob.as_deref(),
                    Some(&polyline_json),
                )
                .unwrap_or_default(),
                distance_meters: row.get(5)?,
                representative_activity_id: row.get(6)?,
                activity_ids,
                visit_count: 0, // Set below via get_section_visit_count()
                confidence: row.get(7)?,
                observation_count: row.get(8)?,
                average_spread: row.get(9)?,
                point_density: point_density_blob
                    .and_then(|b| codec::deserialize(&b).ok())
                    .or_else(|| point_density_json.and_then(|j| serde_json::from_str(&j).ok())),
                scale: row.get(11)?,
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                version: row.get(12)?,
                updated_at: row.get(19)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                route_ids: None,
                disabled: row.get::<_, Option<i32>>(20)?.unwrap_or(0) != 0,
                superseded_by: row.get(21)?,
            })
        });

        match rows {
            Ok(iter) => iter
                .filter_map(|r| r.ok())
                .map(|mut s| {
                    // Count total traversals (laps), not unique activities
                    s.visit_count = self.get_section_visit_count(&s.id);
                    self.apply_named_overlay_to_section(&mut s);
                    s
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Get all visible sections that contain a specific activity.
    /// Uses section_activities junction table for O(1) lookup (was O(N)
    /// with full table scan). 25-50x speedup: 250-570ms → 10-20ms.
    /// Excludes disabled and superseded sections.
    ///
    /// Tier 3.4: results are pre-deduplicated and pre-sorted by visit
    /// count (descending) so TS callers don't need to walk the array
    /// twice. The SELECT DISTINCT handles section_id dedup; the
    /// post-load sort orders by `Section.visit_count`.
    pub fn get_sections_for_activity(&self, activity_id: &str) -> Vec<Section> {
        // Query junction table for section IDs (indexed by activity_id), filtered by visibility
        let query = format!(
            "SELECT DISTINCT sa.section_id FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE sa.activity_id = ? AND sa.excluded = 0 AND s.{}",
            Self::VISIBLE_FILTER
        );
        let section_ids: Vec<String> = match self.db.prepare(&query) {
            Ok(mut stmt) => stmt
                .query_map([activity_id], |row| row.get(0))
                .ok()
                .map(|iter| iter.flatten().collect())
                .unwrap_or_default(),
            Err(_) => return Vec::new(),
        };

        // Load full section data for each ID
        let mut sections = Vec::new();
        for section_id in section_ids {
            if let Some(section) = self.get_section(&section_id) {
                sections.push(section);
            }
        }

        // Sort by visit count descending - most-traversed sections first.
        // Stable order, ties broken by section id for determinism.
        sections.sort_by(|a, b| {
            b.visit_count
                .cmp(&a.visit_count)
                .then_with(|| a.id.cmp(&b.id))
        });

        sections
    }

    /// Get activity IDs for a section from the junction table (deduplicated).
    pub(super) fn get_section_activity_ids(&self, section_id: &str) -> Vec<String> {
        let mut stmt = match self.db.prepare(
            "SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ?1 AND excluded = 0",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Get total visit count (number of traversals/laps) for a section.
    /// Reads the trigger-maintained column: the junction triggers are the
    /// one owner of this number, never an independent recount.
    pub(super) fn get_section_visit_count(&self, section_id: &str) -> u32 {
        self.db
            .query_row(
                "SELECT visit_count FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Get visible section count by type (excludes disabled/superseded).
    pub fn get_section_count_by_type(&self, section_type: Option<SectionType>) -> u32 {
        let query = match section_type {
            Some(st) => format!(
                "SELECT COUNT(*) FROM sections WHERE section_type = '{}' AND {}",
                st.as_str(),
                Self::VISIBLE_FILTER
            ),
            None => format!(
                "SELECT COUNT(*) FROM sections WHERE {}",
                Self::VISIBLE_FILTER
            ),
        };

        self.db.query_row(&query, [], |row| row.get(0)).unwrap_or(0)
    }

    /// Get visible section summaries by type (lightweight, no polylines).
    /// Excludes disabled and superseded sections.
    pub fn get_section_summaries_by_type(
        &self,
        section_type: Option<SectionType>,
    ) -> Vec<SectionSummary> {
        self.get_section_summaries_filtered(section_type, true)
    }

    /// Get ALL section summaries including disabled/superseded (for restore UI).
    pub fn get_all_section_summaries(
        &self,
        section_type: Option<SectionType>,
    ) -> Vec<SectionSummary> {
        self.get_section_summaries_filtered(section_type, false)
    }

    /// Internal: get section summaries with optional visibility filter.
    fn get_section_summaries_filtered(
        &self,
        section_type: Option<SectionType>,
        visible_only: bool,
    ) -> Vec<SectionSummary> {
        // Same junction-derived sport list the canonical summaries read uses.
        let section_sport_types: std::collections::HashMap<String, Vec<String>> = {
            let mut stmt = match self.db.prepare(
                "SELECT sa.section_id, GROUP_CONCAT(DISTINCT am.sport_type)
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0
                 GROUP BY sa.section_id",
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

        let base_cols = "id, section_type, name, sport_type, distance_meters,
                         representative_activity_id, created_at, confidence, scale,
                         bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                         is_user_defined, disabled, superseded_by, visit_count";
        let query = match (section_type, visible_only) {
            (Some(st), true) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}' AND {}",
                base_cols,
                st.as_str(),
                Self::VISIBLE_FILTER
            ),
            (Some(st), false) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}'",
                base_cols,
                st.as_str()
            ),
            (None, true) => format!(
                "SELECT {} FROM sections WHERE {}",
                base_cols,
                Self::VISIBLE_FILTER
            ),
            (None, false) => format!("SELECT {} FROM sections", base_cols),
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;

            // Traversals off the denormalised column, outings from a DISTINCT.
            let visit_count: u32 = row.get::<_, Option<u32>>(16)?.unwrap_or(0);
            let activity_count = self.get_section_activity_count(&id);

            let bounds = match (
                row.get::<_, Option<f64>>(9)?,
                row.get::<_, Option<f64>>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<f64>>(12)?,
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

            let sport_type: String = row.get(3)?;
            let sport_types = section_sport_types
                .get(&id)
                .cloned()
                .unwrap_or_else(|| vec![sport_type.clone()]);
            Ok(SectionSummary {
                id,
                section_type: row
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| "auto".to_string()),
                name: row.get(2)?,
                sport_type: sport_type.clone(),
                distance_meters: row.get(4)?,
                visit_count,
                activity_count,
                representative_activity_id: row.get(5)?,
                confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                scale: row.get(8)?,
                bounds,
                created_at: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                sport_types,
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                disabled: row.get::<_, Option<i32>>(14)?.unwrap_or(0) != 0,
                superseded_by: row.get(15)?,
            })
        });

        let mut results: Vec<SectionSummary> = match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        };
        for summary in &mut results {
            self.apply_named_overlay_to_summary(summary);
        }
        results
    }

    /// Get distinct activity count for a section.
    fn get_section_activity_count(&self, section_id: &str) -> u32 {
        self.db
            .query_row(
                "SELECT COUNT(DISTINCT activity_id) FROM section_activities
                 WHERE section_id = ? AND excluded = 0",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Activity IDs fully excluded from a section: no included row remains.
    /// An activity with only some laps excluded is per-lap state, served by
    /// `get_excluded_section_laps`.
    pub fn get_excluded_activity_ids(&self, section_id: &str) -> Vec<String> {
        let mut stmt = match self.db.prepare(
            "SELECT activity_id FROM section_activities WHERE section_id = ?
             GROUP BY activity_id HAVING SUM(excluded = 0) = 0",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Every excluded junction row as an (activity, start_index) pair, the
    /// per-lap state the lap rows render.
    pub fn get_excluded_section_laps(&self, section_id: &str) -> Vec<(String, u32)> {
        let mut stmt = match self.db.prepare(
            "SELECT activity_id, start_index FROM section_activities
             WHERE section_id = ? AND excluded = 1
             ORDER BY activity_id, start_index",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(params![section_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Get a single section by ID with the corridor-name overlay applied
    /// (includes disabled/superseded - needed for detail/restore).
    pub fn get_section(&self, section_id: &str) -> Option<Section> {
        let mut section = self.get_section_raw(section_id)?;
        self.apply_named_overlay_to_section(&mut section);
        Some(section)
    }

    /// The raw DB row without the overlay — what caches must store, so a
    /// later overlay change never serves a baked stale name.
    pub(crate) fn get_section_raw(&self, section_id: &str) -> Option<Section> {
        let query = format!(
            "SELECT {} FROM sections WHERE id = ?",
            Self::SECTION_COLUMNS
        );
        let mut stmt = self.db.prepare(&query).ok()?;

        stmt.query_row(params![section_id], |row| {
            let id: String = row.get(0)?;
            let section_type_str: String = row.get(1)?;
            let polyline_json: String = row.get(4)?;
            let point_density_json: Option<String> = row.get(10)?;
            let polyline_blob: Option<Vec<u8>> = row.get(22)?;
            let point_density_blob: Option<Vec<u8>> = row.get(23)?;

            let activity_ids = self.get_section_activity_ids(&id);
            let visit_count = self.get_section_visit_count(&id);

            Ok(Section {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                polyline: codec::decode_polyline_row(
                    polyline_blob.as_deref(),
                    Some(&polyline_json),
                )
                .unwrap_or_default(),
                distance_meters: row.get(5)?,
                representative_activity_id: row.get(6)?,
                activity_ids: activity_ids.clone(),
                visit_count,
                confidence: row.get(7)?,
                observation_count: row.get(8)?,
                average_spread: row.get(9)?,
                point_density: point_density_blob
                    .and_then(|b| codec::deserialize(&b).ok())
                    .or_else(|| point_density_json.and_then(|j| serde_json::from_str(&j).ok())),
                scale: row.get(11)?,
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                version: row.get(12)?,
                updated_at: row.get(19)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                route_ids: None,
                disabled: row.get::<_, Option<i32>>(20)?.unwrap_or(0) != 0,
                superseded_by: row.get(21)?,
            })
        })
        .ok()
    }

    /// Load a section's stored polyline (blob authoritative, JSON fallback for
    /// legacy rows). Shared by the geometry-editing and intent-capture paths.
    pub(crate) fn stored_section_polyline(
        &self,
        section_id: &str,
    ) -> Result<Vec<GpsPoint>, String> {
        let (blob, json): (Option<Vec<u8>>, Option<String>) = self
            .db
            .query_row(
                "SELECT polyline_blob, polyline_json FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;
        codec::decode_polyline_row(blob.as_deref(), json.as_deref())
    }

    /// Check if a section has original (pre-trim) bounds that can be restored.
    pub fn has_original_bounds(&self, section_id: &str) -> bool {
        self.db
            .query_row(
                "SELECT original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(false)
    }

    /// Get the representative activity's full GPS track for section expansion.
    /// Returns the track + the indices where the current section starts/ends within it.
    /// Used by the UI to let users extend section bounds beyond the current polyline.
    pub fn get_section_extension_track(
        &self,
        section_id: &str,
    ) -> Result<(Vec<GpsPoint>, u32, u32), String> {
        // Load section data: representative activity ID + current polyline
        let rep_id: Option<String> = self
            .db
            .query_row(
                "SELECT representative_activity_id FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        let rep_id = rep_id.ok_or_else(|| "Section has no representative activity".to_string())?;

        // Load the representative activity's full GPS track
        let track = self
            .get_gps_track(&rep_id)
            .ok_or_else(|| format!("GPS track not found for activity: {}", rep_id))?;

        if track.len() < 3 {
            return Err("Representative activity track too short".to_string());
        }

        let polyline: Vec<GpsPoint> = self.stored_section_polyline(section_id)?;

        if polyline.len() < 2 {
            return Err("Section polyline too short".to_string());
        }

        // Find where the section starts/ends in the representative activity's
        // track. Generous bar, half the proximity anchor (100 m at the
        // default 200 m), derived so it co-varies with the slider like every
        // other matching window.
        let portions = find_all_track_portions(
            &track,
            &polyline,
            self.section_config.proximity_threshold * 0.5,
        );

        if portions.is_empty() {
            // Fallback: use nearest-point matching for start and end
            let ref_tree = build_rtree(&track);
            let start_query = [polyline[0].latitude, polyline[0].longitude];
            let end_query = [
                polyline[polyline.len() - 1].latitude,
                polyline[polyline.len() - 1].longitude,
            ];

            let start_idx = ref_tree
                .nearest_neighbor(&start_query)
                .map(|p| p.idx as u32)
                .unwrap_or(0);
            let end_idx = ref_tree
                .nearest_neighbor(&end_query)
                .map(|p| p.idx as u32)
                .unwrap_or(track.len() as u32 - 1);

            let (s, e) = if start_idx <= end_idx {
                (start_idx, end_idx)
            } else {
                (end_idx, start_idx)
            };
            return Ok((track, s, e));
        }

        // Use the first (longest) matching portion
        let best = portions.iter().max_by_key(|(s, e, _)| e - s).unwrap();
        Ok((track, best.0 as u32, best.1 as u32))
    }
}
