//! Read-only section queries.
//!
//! Fetching sections by type or activity, summaries, counts, bounds checks,
//! and the reference-activity extension track. All functions here are pure
//! reads - they never mutate section state.

use super::geometry;
use crate::persistence::PersistentEngine;
use crate::sections::{Section, SectionSummary, SectionType};
use rusqlite::params;
use tracematch::GpsPoint;
use tracematch::sections::{build_rtree, find_all_track_portions};

/// What a section row says about itself beyond the catalogue record.
pub(crate) struct SectionRowIdentity {
    pub section_type: String,
    pub disabled: bool,
    pub superseded_by: Option<String>,
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
}

impl PersistentEngine {
    /// Visibility filter: exclude disabled and superseded sections.
    pub(crate) const VISIBLE_FILTER: &'static str = pooled::VISIBLE_FILTER;

    /// Get sections with optional type filter (excludes disabled/superseded).
    pub fn get_sections_by_type(&self, section_type: Option<SectionType>) -> Vec<Section> {
        pooled::sections_by_type(&self.db, section_type, &self.named_overlay_cached_names())
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
        pooled::sections_for_activity(&self.db, activity_id, &self.named_overlay_cached_names())
    }

    /// Get activity IDs for a section from the junction table (deduplicated).
    pub(super) fn get_section_activity_ids(&self, section_id: &str) -> Vec<String> {
        pooled::section_activity_ids(&self.db, section_id)
    }

    /// Auto sections a custom section covers, so the caller can hide them.
    ///
    /// The measure is the fraction of the *auto* section lying within
    /// `threshold_meters` of the custom one, strictly above
    /// `overlap_threshold`. One read: the R-tree over the custom line is built
    /// once and an auto section whose bounds cannot reach it never has its
    /// polyline decoded at all.
    pub fn find_superseded_auto_sections(
        &self,
        custom_section_id: &str,
        threshold_meters: f64,
        overlap_threshold: f64,
    ) -> Vec<String> {
        let custom = self.get_section_polyline(custom_section_id);
        let index = match crate::persistence::OverlapIndex::new(&custom) {
            Some(i) => i,
            None => return Vec::new(),
        };

        let query = format!(
            "SELECT id, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
             FROM sections WHERE section_type = '{}' AND {} AND id != ?",
            SectionType::Auto.as_str(),
            Self::VISIBLE_FILTER
        );
        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("veloqrs: find_superseded_auto_sections prepare failed: {e}");
                return Vec::new();
            }
        };

        type Bounds = (String, Option<f64>, Option<f64>, Option<f64>, Option<f64>);
        let rows = stmt.query_map(params![custom_section_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<f64>>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
            ))
        });
        let rows: Vec<Bounds> = match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                log::error!("veloqrs: find_superseded_auto_sections query failed: {e}");
                return Vec::new();
            }
        };

        let mut superseded = Vec::new();
        for (id, min_lat, max_lat, min_lng, max_lng) in rows {
            // Bounds are optional on the row, and a section without them is
            // measured rather than skipped.
            if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) =
                (min_lat, max_lat, min_lng, max_lng)
                && !index.bbox_can_reach(min_lat, max_lat, min_lng, max_lng, threshold_meters)
            {
                continue;
            }

            let auto = self.get_section_polyline(&id);
            if index.fraction_within(&auto, threshold_meters) > overlap_threshold {
                superseded.push(id);
            }
        }

        superseded
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
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        pooled::section_summaries_filtered(&self.db, section_type, visible_only, &names)
    }

    /// Activity IDs fully excluded from a section: no included row remains.
    /// An activity with only some laps excluded is per-lap state, served by
    /// `get_excluded_section_laps`.
    pub fn get_excluded_activity_ids(&self, section_id: &str) -> Vec<String> {
        pooled::excluded_activity_ids(&self.db, section_id)
    }

    /// Every excluded junction row as an (activity, start_index) pair, the
    /// per-lap state the lap rows render.
    pub fn get_excluded_section_laps(&self, section_id: &str) -> Vec<(String, u32)> {
        pooled::excluded_section_laps(&self.db, section_id)
    }

    /// Get a single section by ID with the corridor-name overlay applied
    /// (includes disabled/superseded - needed for detail/restore).
    pub fn get_section(&self, section_id: &str) -> Option<Section> {
        let mut section = self.get_section_raw(section_id)?;
        self.apply_named_overlay_to_section(&mut section);
        Some(section)
    }

    /// The raw DB row without the overlay, what caches must store, so a
    /// later overlay change never serves a baked stale name.
    /// The row's own account of a section, which the catalogue record lacks:
    /// its type, its visibility, and the slice a custom section was cut from.
    pub(crate) fn section_row_identity(&self, section_id: &str) -> Option<SectionRowIdentity> {
        self.db
            .query_row(
                "SELECT section_type, disabled, superseded_by, source_activity_id, start_index, \
                 end_index FROM sections WHERE id = ?",
                rusqlite::params![section_id],
                |row| {
                    Ok(SectionRowIdentity {
                        section_type: row.get(0)?,
                        disabled: row.get::<_, i64>(1)? != 0,
                        superseded_by: row.get(2)?,
                        source_activity_id: row.get(3)?,
                        start_index: row.get(4)?,
                        end_index: row.get(5)?,
                    })
                },
            )
            .ok()
    }

    pub(crate) fn get_section_raw(&self, section_id: &str) -> Option<Section> {
        pooled::section_raw(&self.db, section_id)
    }

    /// Load a section's stored polyline (blob authoritative, JSON fallback for
    /// legacy rows). Shared by the geometry-editing and intent-capture paths.
    pub(crate) fn stored_section_polyline(
        &self,
        section_id: &str,
    ) -> Result<Vec<GpsPoint>, String> {
        geometry::stored_line(&self.db, section_id)
    }

    /// Check if a section has original (pre-trim) bounds that can be restored.
    pub fn has_original_bounds(&self, section_id: &str) -> bool {
        pooled::has_original_bounds(&self.db, section_id)
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

/// Catalogue reads that need no engine, only its database.
///
/// The engine methods above are these same reads on the write connection, so a
/// pooled reader and a lock holder cannot answer differently. The corridor name
/// an athlete gave a section is not derivable from the row, so every read that
/// returns a named section takes the overlay as an argument: the engine passes
/// its cached map, a pooled reader passes `named::pooled::overlay_names`.
pub(crate) mod pooled {
    use std::collections::BTreeMap;

    use rusqlite::{Connection, Row, params};

    use super::super::geometry;
    use crate::persistence::PersistentEngine;
    use crate::persistence::codec;
    use crate::sections::{Section, SectionSummary, SectionType};

    /// The sport an activity was recorded as, from the row rather than the
    /// memory tier the engine reads first.
    pub(crate) fn sport_of_activity(conn: &Connection, activity_id: &str) -> Option<String> {
        conn.query_row(
            "SELECT sport_type FROM activities WHERE id = ?",
            params![activity_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    /// Column list for full section queries.
    pub(crate) const SECTION_COLUMNS: &str =
        "id, section_type, name, sport_type, polyline_json, distance_meters,
         representative_activity_id, confidence, observation_count, average_spread,
         point_density_json, scale, version, is_user_defined, stability,
         source_activity_id, start_index, end_index, created_at, updated_at,
         disabled, superseded_by, polyline_blob, point_density_blob,
         elevation_gain_m, avg_grade_percent,
         elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score,
         rep_start_index, rep_end_index";

    /// Visibility filter: exclude disabled and superseded sections.
    pub(crate) const VISIBLE_FILTER: &str = "disabled = 0 AND superseded_by IS NULL";

    /// One row of [`SECTION_COLUMNS`] as a catalogue record, with its activity
    /// ids. `visit_count` and `route_ids` are left for the caller, which reads
    /// them per section or in bulk depending on how many it asked for.
    fn section_from_row(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<Section> {
        let id: String = row.get(0)?;
        let section_type_str: String = row.get(1)?;
        let polyline_json: Option<String> = row.get(4)?;
        let point_density_json: Option<String> = row.get(10)?;
        let polyline_blob: Option<Vec<u8>> = row.get(22)?;
        let point_density_blob: Option<Vec<u8>> = row.get(23)?;
        let representative_activity_id: Option<String> = row.get(6)?;
        let rep_start: Option<u32> = row.get(33)?;
        let rep_end: Option<u32> = row.get(34)?;

        let activity_ids = section_activity_ids(conn, &id);

        Ok(Section {
            id,
            section_type: SectionType::parse(&section_type_str).unwrap_or(SectionType::Auto),
            name: row.get(2)?,
            sport_type: row.get(3)?,
            polyline: geometry::line(
                conn,
                polyline_blob.as_deref(),
                polyline_json.as_deref(),
                geometry::reference(representative_activity_id.as_deref(), rep_start, rep_end),
            )
            .unwrap_or_default(),
            distance_meters: row.get(5)?,
            representative_activity_id,
            activity_ids,
            visit_count: 0,
            confidence: row.get(7)?,
            observation_count: row.get(8)?,
            average_spread: row.get(9)?,
            point_density: point_density_blob
                .and_then(|b| codec::deserialize(&b).ok())
                .or_else(|| point_density_json.and_then(|j| serde_json::from_str(&j).ok())),
            scale: row.get(11)?,
            is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
            stability: row.get(14)?,
            elevation_gain_m: row.get(24)?,
            avg_grade_percent: row.get(25)?,
            elevation_loss_m: row.get(26)?,
            max_grade_percent: row.get(27)?,
            straightness: row.get(28)?,
            klass: row.get(29)?,
            is_lift: row.get::<_, Option<i32>>(30)?.unwrap_or(0) != 0,
            rank_score: row.get(31)?,
            sport_rank_score: row.get(32)?,
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
    }

    /// The corridor name displaces the generated one on an auto section, and
    /// never on a section the athlete defined or cut themselves.
    fn apply_overlay(section: &mut Section, names: &BTreeMap<String, String>) {
        if section.is_user_defined || section.section_type != SectionType::Auto {
            return;
        }
        if let Some(name) = names.get(&section.id) {
            section.name = Some(name.clone());
        }
    }

    /// Fill in what `section_from_row` left: the traversal count and the
    /// routes, the latter in one query for the whole batch.
    fn finish(conn: &Connection, sections: &mut [Section], names: &BTreeMap<String, String>) {
        for section in sections.iter_mut() {
            section.visit_count = section_visit_count(conn, &section.id);
            apply_overlay(section, names);
        }
        let ids: Vec<String> = sections.iter().map(|s| s.id.clone()).collect();
        let mut routes = super::super::super::routes::pooled::route_ids_for_sections(conn, &ids);
        for section in sections.iter_mut() {
            section.route_ids = Some(routes.remove(&section.id).unwrap_or_default());
        }
    }

    /// Every visible section, optionally narrowed to one type.
    pub(crate) fn sections_by_type(
        conn: &Connection,
        section_type: Option<SectionType>,
        names: &BTreeMap<String, String>,
    ) -> Vec<Section> {
        let query = match section_type {
            Some(st) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}' AND {}",
                SECTION_COLUMNS,
                st.as_str(),
                VISIBLE_FILTER
            ),
            None => format!(
                "SELECT {} FROM sections WHERE {}",
                SECTION_COLUMNS, VISIBLE_FILTER
            ),
        };
        let Ok(mut stmt) = conn.prepare(&query) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| section_from_row(conn, row));
        let mut sections: Vec<Section> = match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        };
        finish(conn, &mut sections, names);
        sections
    }

    /// Every visible section a given activity traverses, most-traversed first
    /// and ties broken by id, which is the order the screens draw them in.
    pub(crate) fn sections_for_activity(
        conn: &Connection,
        activity_id: &str,
        names: &BTreeMap<String, String>,
    ) -> Vec<Section> {
        let query = format!(
            "SELECT DISTINCT sa.section_id FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE sa.activity_id = ? AND sa.excluded = 0 AND s.{}",
            VISIBLE_FILTER
        );
        let section_ids: Vec<String> = match conn.prepare(&query) {
            Ok(mut stmt) => stmt
                .query_map([activity_id], |row| row.get(0))
                .ok()
                .map(|iter| iter.flatten().collect())
                .unwrap_or_default(),
            Err(_) => return Vec::new(),
        };

        let mut sections: Vec<Section> = section_ids
            .into_iter()
            .filter_map(|id| section(conn, &id, names))
            .collect();
        sections.sort_by(|a, b| {
            b.visit_count
                .cmp(&a.visit_count)
                .then_with(|| a.id.cmp(&b.id))
        });
        sections
    }

    /// One section with the corridor overlay applied.
    pub(crate) fn section(
        conn: &Connection,
        section_id: &str,
        names: &BTreeMap<String, String>,
    ) -> Option<Section> {
        let mut section = section_raw(conn, section_id)?;
        apply_overlay(&mut section, names);
        Some(section)
    }

    /// Every activity whose every junction row for this section is excluded.
    pub(crate) fn excluded_activity_ids(conn: &Connection, section_id: &str) -> Vec<String> {
        let mut stmt = match conn.prepare(
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
    pub(crate) fn excluded_section_laps(conn: &Connection, section_id: &str) -> Vec<(String, u32)> {
        let mut stmt = match conn.prepare(
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

    /// Whether the section kept the bounds it was detected with, which is what
    /// a reset has to restore.
    pub(crate) fn has_original_bounds(conn: &Connection, section_id: &str) -> bool {
        conn.query_row(
            "SELECT original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
            params![section_id],
            |row| row.get(0),
        )
        .unwrap_or(false)
    }

    /// Every section as a list row, with the corridor names handed in.
    pub(crate) fn section_summaries_filtered(
        conn: &Connection,
        section_type: Option<SectionType>,
        visible_only: bool,
        names: &BTreeMap<String, String>,
    ) -> Vec<SectionSummary> {
        // Same junction-derived sport list the canonical summaries read uses.
        let section_sport_types: std::collections::HashMap<String, Vec<String>> = {
            let mut stmt = match conn.prepare(
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
                         is_user_defined, disabled, superseded_by, visit_count,
                         elevation_gain_m, avg_grade_percent,
                         elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score";
        let query = match (section_type, visible_only) {
            (Some(st), true) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}' AND {}",
                base_cols,
                st.as_str(),
                PersistentEngine::VISIBLE_FILTER
            ),
            (Some(st), false) => format!(
                "SELECT {} FROM sections WHERE section_type = '{}'",
                base_cols,
                st.as_str()
            ),
            (None, true) => format!(
                "SELECT {} FROM sections WHERE {}",
                base_cols,
                PersistentEngine::VISIBLE_FILTER
            ),
            (None, false) => format!("SELECT {} FROM sections", base_cols),
        };

        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;

            // Traversals off the denormalised column, outings from a DISTINCT.
            let visit_count: u32 = row.get::<_, Option<u32>>(16)?.unwrap_or(0);
            let activity_count = section_activity_count(conn, &id);

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
                elevation_gain_m: row.get(17)?,
                avg_grade_percent: row.get(18)?,
                elevation_loss_m: row.get(19)?,
                max_grade_percent: row.get(20)?,
                klass: row.get(22)?,
                is_lift: row.get::<_, Option<i32>>(23)?.unwrap_or(0) != 0,
                rank_score: row.get(24)?,
                sport_rank_score: row.get(25)?,
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
            apply_overlay_to_summary(summary, names);
        }
        results
    }

    /// How many distinct activities still count towards a section.
    pub(crate) fn section_activity_count(conn: &Connection, section_id: &str) -> u32 {
        conn.query_row(
            "SELECT COUNT(DISTINCT activity_id) FROM section_activities
             WHERE section_id = ? AND excluded = 0",
            params![section_id],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }

    /// The corridor name on a list row, on the same precedence the engine uses:
    /// a user-defined section keeps its own name, an auto one takes the
    /// corridor's when there is one.
    pub(crate) fn apply_overlay_to_summary(
        summary: &mut SectionSummary,
        names: &BTreeMap<String, String>,
    ) {
        if summary.is_user_defined || summary.section_type != "auto" {
            return;
        }
        if let Some(name) = names.get(&summary.id) {
            summary.name = Some(name.clone());
        }
    }

    /// One section as the row has it, with no overlay. What a cache stores, so
    /// a later overlay change never serves a baked stale name.
    pub(crate) fn section_raw(conn: &Connection, section_id: &str) -> Option<Section> {
        let query = format!("SELECT {} FROM sections WHERE id = ?", SECTION_COLUMNS);
        let mut stmt = conn.prepare(&query).ok()?;
        let mut section = stmt
            .query_row(params![section_id], |row| section_from_row(conn, row))
            .ok()?;
        section.visit_count = section_visit_count(conn, section_id);
        section.route_ids = Some(
            super::super::super::routes::pooled::route_ids_for_sections(
                conn,
                std::slice::from_ref(&section.id),
            )
            .remove(&section.id)
            .unwrap_or_default(),
        );
        Some(section)
    }

    /// The activities a section has been traversed in, excluded laps aside.
    pub(crate) fn section_activity_ids(conn: &Connection, section_id: &str) -> Vec<String> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ?1 AND excluded = 0",
        ) else {
            return Vec::new();
        };
        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Traversals, not activities: the trigger-maintained column, never a
    /// recount of its own.
    pub(crate) fn section_visit_count(conn: &Connection, section_id: &str) -> u32 {
        conn.query_row(
            "SELECT visit_count FROM sections WHERE id = ?",
            params![section_id],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }

    /// How many sections the catalogue shows.
    pub(crate) fn section_count(conn: &Connection) -> u32 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM sections WHERE {}", VISIBLE_FILTER),
            [],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::params;
    use tempfile::TempDir;

    use super::*;
    use crate::persistence::PersistentEngine;
    use crate::test_globals::serial_global_state;

    /// A catalogue with one auto section an activity traverses, which is what
    /// every screen that lists a section reads.
    ///
    /// File-backed rather than in-memory, and every caller serial, because a
    /// pooled read resolves its overlay through `read_cache`, whose
    /// invalidation stamp is one process-wide `PRAGMA data_version` against a
    /// path. An in-memory engine contributes no path, so it is measured against
    /// whatever database another test stamped: a rename made here never moves
    /// that `data_version`, the slot is never cleared, and the pooled reader
    /// answers with the other library's overlay. Held that way, the parity
    /// tests below passed on thread order rather than by construction.
    ///
    /// The bind is the half that makes the file-backed engine mean anything:
    /// only `persistent_engine_init` binds in the app, so a test that opens its
    /// own database leaves the stamp on whatever ran last. It clears the cache
    /// too, which is what a run following another test's fill needs.
    fn engine_with_a_section(tmp: &TempDir) -> PersistentEngine {
        let db = tmp.path().join("section_queries.db");
        let db_path = db.to_str().unwrap();
        crate::persistence::read_pool::bind(db_path);
        let mut engine = PersistentEngine::new(db_path).unwrap();
        let coords: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.001,
                longitude: 7.3,
                elevation: None,
            })
            .collect();
        engine
            .add_activity("a1".to_string(), coords.clone(), "Ride".to_string())
            .unwrap();
        let polyline = serde_json::to_string(
            &coords
                .iter()
                .map(|p| [p.latitude, p.longitude])
                .collect::<Vec<[f64; 2]>>(),
        )
        .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s0', 'auto', 'Climb 1', 'Ride', ?, 400.0, 0, 1,
                    '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                params![polyline],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters)
                 VALUES ('s0', 'a1', 'same', 1, 5, 400.0)",
                [],
            )
            .unwrap();
        engine
    }

    fn same(pooled: &[Section], locked: &[Section]) {
        let key = |sections: &[Section]| {
            sections
                .iter()
                .map(|s| {
                    (
                        s.id.clone(),
                        s.name.clone(),
                        s.sport_type.clone(),
                        s.visit_count,
                        s.activity_ids.clone(),
                        s.polyline.len(),
                        s.route_ids.clone(),
                        s.is_user_defined,
                        s.disabled,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(key(pooled), key(locked));
    }

    /// Scenario: the activity detail screen lists the sections a ride passes
    /// through, and the read is behind the engine write lock.
    ///
    /// Expected behaviour: a pooled reader, given the overlay, answers what the
    /// lock holder answers, row for row.
    #[test]
    fn pooled_sections_match_the_ones_a_lock_holder_gets() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let engine = engine_with_a_section(&tmp);
        let names = engine.named_overlay_cached_names();

        same(
            &pooled::sections_for_activity(&engine.db, "a1", &names),
            &engine.get_sections_for_activity("a1"),
        );
        same(
            &pooled::sections_by_type(&engine.db, None, &names),
            &engine.get_sections_by_type(None),
        );
        assert_eq!(
            pooled::section_count(&engine.db),
            engine.get_section_count()
        );
        assert_eq!(
            engine.get_sections_for_activity("a1").len(),
            1,
            "the ride traverses the section, so there is something to compare"
        );
    }

    /// The fixture's own guard: another database holding the overlay slot must
    /// not shadow a rename made here. Without the bind above this fails with
    /// the generated name, which is what the parity tests were passing on.
    #[test]
    fn another_databases_overlay_does_not_shadow_a_rename_made_here() {
        let _serial = serial_global_state();
        let other_dir = TempDir::new().unwrap();
        let other = other_dir.path().join("other.db");
        let kept = PersistentEngine::new(other.to_str().unwrap()).unwrap();
        crate::persistence::read_cache::bind(other.to_str().unwrap());
        let _ = super::super::named::pooled::overlay_names(&kept.db);

        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section(&tmp);
        engine
            .set_section_name("s0", Some("Col de la Forclaz"))
            .unwrap();

        let names = super::super::named::pooled::overlay_names(&engine.db);
        let through_the_pool = pooled::sections_for_activity(&engine.db, "a1", &names);

        assert_eq!(
            through_the_pool[0].name.as_deref(),
            Some("Col de la Forclaz"),
            "the pooled read answered from the other database's overlay"
        );
    }

    /// The corridor name an athlete gave an auto section is what the screens
    /// show, and it is not on the row: it is resolved from the intent. A reader
    /// that skipped the overlay would quietly show the generated name back.
    #[test]
    fn a_pooled_read_shows_the_name_the_athlete_gave_the_corridor() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section(&tmp);
        engine
            .set_section_name("s0", Some("Col de la Forclaz"))
            .unwrap();

        let through_the_lock = engine.get_sections_for_activity("a1");
        let names = super::super::named::pooled::overlay_names(&engine.db);
        let through_the_pool = pooled::sections_for_activity(&engine.db, "a1", &names);

        assert_eq!(
            through_the_lock[0].name.as_deref(),
            Some("Col de la Forclaz")
        );
        same(&through_the_pool, &through_the_lock);
    }

    /// A section nobody has ridden and an id that is not there answer the same
    /// nothing on both paths.
    #[test]
    fn pooled_reads_are_empty_for_what_is_not_there() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let engine = engine_with_a_section(&tmp);
        let names = engine.named_overlay_cached_names();

        assert!(pooled::sections_for_activity(&engine.db, "missing", &names).is_empty());
        assert!(pooled::section(&engine.db, "missing", &names).is_none());
        assert!(engine.get_sections_for_activity("missing").is_empty());
    }
}
