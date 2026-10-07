//! Bounds editing, visibility state, and imports.
//!
//! This submodule covers everything that changes a section's geometry
//! (trim/expand/reset) or its visibility (disable/enable/supersede), plus the
//! AsyncStorage → SQLite migration imports. The schema itself is owned by
//! `migrations/`, never by this file.

use crate::persistence::PersistentEngine;
use crate::persistence::sections::geometry::locate_slice;
use rusqlite::{OptionalExtension, params};
use tracematch::GpsPoint;
use tracematch::matching::calculate_route_distance;

/// The reference triple a row stores for a line, with the provenance word that goes beside it.
/// A line with no triple is a consensus line: the blob is the only copy of it.
fn triple_columns(
    reference: Option<&(String, u32, u32)>,
) -> (Option<&str>, Option<u32>, Option<u32>, &'static str) {
    match reference {
        Some((id, start, end)) => (
            Some(id.as_str()),
            Some(*start),
            Some(*end),
            crate::persistence::sections::SOURCE_EXACT,
        ),
        None => (
            None,
            None,
            None,
            crate::persistence::sections::SOURCE_CONSENSUS,
        ),
    }
}

impl PersistentEngine {
    /// The reference triple a section stores, when it is whole and its range is exactly as long
    /// as the line the row holds now.
    fn section_reference_of_length(
        &self,
        section_id: &str,
        line_len: usize,
    ) -> Option<(String, u32, u32)> {
        let (activity_id, start, end): (Option<String>, Option<u32>, Option<u32>) = self
            .db
            .query_row(
                "SELECT representative_activity_id, rep_start_index, rep_end_index
                 FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok()?;
        let (activity_id, start, end) =
            crate::persistence::sections::geometry::reference(activity_id.as_deref(), start, end)?;
        (end > start && (end - start) as usize == line_len)
            .then(|| (activity_id.to_string(), start, end))
    }

    /// Append the ledger row for an athlete's edit, inside the edit's own transaction.
    /// `version` links the geometry version the edit left, when it moved the line.
    pub(super) fn record_edit_event(
        &mut self,
        section_id: &str,
        kind: &str,
        details: serde_json::Value,
        version: Option<i64>,
    ) -> Result<(), String> {
        self.append_section_history(section_id, kind, Some(&details.to_string()), version)
            .map(|_| ())
            .map_err(|e| format!("Failed to record the {kind} edit: {e}"))
    }

    /// Store the line the section holds now as a geometry version with the triple that
    /// describes it, then append the edit's ledger row linked to that version.
    pub(super) fn record_edit_with_line(
        &mut self,
        section_id: &str,
        kind: &str,
        details: serde_json::Value,
    ) -> Result<(), String> {
        let line = self.stored_section_polyline(section_id)?;
        let reference = self.section_reference_of_length(section_id, line.len());
        let version = self
            .record_section_geometry(
                section_id,
                &line,
                false,
                reference.as_ref().map(|(id, s, e)| (id.as_str(), *s, *e)),
            )
            .map_err(|e| format!("Failed to record the edited line: {e}"))?;
        self.record_edit_event(section_id, kind, details, Some(version))
    }

    /// Keep the triple of the line an edit is about to back up, so a reset can say where the
    /// restored line came from. The backup column holds the points and nothing else.
    pub(super) fn remember_original_reference(&mut self, section_id: &str, line: &[GpsPoint]) {
        let Some((id, start, end)) = self.section_reference_of_length(section_id, line.len())
        else {
            return;
        };
        if let Err(e) =
            self.record_section_geometry(section_id, line, false, Some((&id, start, end)))
        {
            log::warn!(
                "veloqrs: [section edit] could not record the original line of {section_id}: {e}"
            );
        }
    }

    /// Back up the line a section has before its first edit, the one a reset puts back. A
    /// section already holding a backup keeps it, so a later edit never replaces the line the
    /// athlete started from.
    pub(super) fn back_up_original_line(
        &mut self,
        section_id: &str,
        line: &[GpsPoint],
    ) -> Result<(), String> {
        if self.has_original_bounds(section_id) {
            return Ok(());
        }
        self.remember_original_reference(section_id, line);
        self.db
            .execute(
                "UPDATE sections SET original_polyline_blob = ?, original_polyline_json = NULL
                 WHERE id = ?",
                params![
                    crate::persistence::codec::serialize_track_points(line),
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to backup original polyline: {}", e))?;
        Ok(())
    }

    /// The triple that describes `original`, a line a reset puts back. The geometry versions
    /// remember the triple each line was cut with, so one that holds this line says where it
    /// came from; failing that, the line is located on the rides the row names.
    fn reference_of_line(
        &self,
        section_id: &str,
        original: &[GpsPoint],
    ) -> Option<(String, u32, u32)> {
        let same = |a: &[GpsPoint], b: &[GpsPoint]| {
            a.len() == b.len()
                && a.iter().zip(b).all(|(x, y)| {
                    (x.latitude - y.latitude).abs() < 1e-6
                        && (x.longitude - y.longitude).abs() < 1e-6
                })
        };
        let mut versions = self.section_geometry_versions(section_id);
        versions.reverse();
        for v in versions {
            if let Some((line, Some(reference))) =
                self.section_geometry_version(section_id, v.version)
                && same(&line, original)
            {
                return Some(reference);
            }
        }
        let named: (Option<String>, Option<String>) = self
            .db
            .query_row(
                "SELECT representative_activity_id, source_activity_id FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok()?;
        [named.0, named.1]
            .into_iter()
            .flatten()
            .find_map(|activity_id| {
                let track = self.get_gps_track(&activity_id)?;
                let (start, end) = locate_slice(&track, original)?;
                Some((activity_id, start, end + 1))
            })
    }

    /// The activity range a section's polyline is a slice of, when the section carries one.
    fn section_anchor(&self, section_id: &str) -> Option<(String, u32, u32)> {
        let (activity_id, start, end): (Option<String>, Option<u32>, Option<u32>) = self
            .db
            .query_row(
                "SELECT source_activity_id, start_index, end_index FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok()?;
        Some((activity_id?, start?, end?))
    }

    /// The activity a section's source columns name, whether or not its indices are set.
    fn section_source_activity(&self, section_id: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT source_activity_id FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .ok()
            .flatten()
    }

    /// The activity a section's representative triple names, set for a
    /// detected section and for a custom one.
    fn section_representative(&self, section_id: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT representative_activity_id FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .ok()
            .flatten()
    }

    /// Trim a section's bounds by slicing its polyline to the given index range.
    /// Backs up the original polyline on first trim (preserves true original across multiple trims).
    /// Re-matches all activities against the new trimmed polyline.
    pub fn trim_section(
        &mut self,
        section_id: &str,
        start_index: u32,
        end_index: u32,
    ) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| e.write_trim_section(section_id, start_index, end_index));
        self.resync_section_after_edit(section_id, done.is_err());
        done
    }

    fn write_trim_section(
        &mut self,
        section_id: &str,
        start_index: u32,
        end_index: u32,
    ) -> Result<Vec<String>, String> {
        // Load current polyline (blob authoritative, JSON fallback)
        let polyline: Vec<GpsPoint> = self.stored_section_polyline(section_id)?;

        // Validate indices
        let start = start_index as usize;
        let end = end_index as usize;
        if start >= end {
            return Err("Start index must be less than end index".to_string());
        }
        if end >= polyline.len() {
            return Err(format!(
                "End index {} out of bounds (polyline has {} points)",
                end,
                polyline.len()
            ));
        }
        if end - start + 1 < 5 {
            return Err("Trimmed section must have at least 5 points".to_string());
        }

        // Slice the polyline
        let trimmed: Vec<GpsPoint> = polyline[start..=end].to_vec();

        // The anchor names a range of the source activity, so a trim shifts it by the slice offset.
        let anchor = self
            .section_anchor(section_id)
            .filter(|(_, a_start, a_end)| {
                a_end >= a_start && (a_end - a_start) as usize + 1 == polyline.len()
            })
            .map(|(activity_id, a_start, _)| {
                (activity_id, a_start + start_index, a_start + end_index)
            });

        let reference = self
            .section_reference_of_length(section_id, polyline.len())
            .map(|(id, r_start, _)| (id, r_start + start_index, r_start + end_index + 1));

        // Check minimum distance (50m)
        let distance = calculate_route_distance(&trimmed);
        if distance < 50.0 {
            return Err("Trimmed section must be at least 50 meters".to_string());
        }

        self.back_up_original_line(section_id, &polyline)?;

        // Compute new bounds and distance
        let bounds = tracematch::geo_utils::compute_bounds(&trimmed);
        let trimmed_blob = crate::persistence::codec::serialize_track_points(&trimmed);
        let updated_at = chrono::Utc::now().to_rfc3339();

        // The trim promotes the row to user-defined, which hides it from
        // corridor resolution, so a resolved name lands on the row first.
        self.adopt_corridor_name(section_id);

        let (rep_id, rep_start, rep_end, source) = triple_columns(reference.as_ref());

        // Update section
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    polyline_blob = ?,
                    distance_meters = ?,
                    is_user_defined = 1,
                    updated_at = ?,
                    source_activity_id = ?,
                    start_index = ?,
                    end_index = ?,
                    representative_activity_id = COALESCE(?, representative_activity_id),
                    rep_start_index = ?,
                    rep_end_index = ?,
                    geometry_source = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    trimmed_blob,
                    distance,
                    updated_at,
                    anchor.as_ref().map(|(id, _, _)| id.as_str()),
                    anchor.as_ref().map(|(_, s, _)| *s),
                    anchor.as_ref().map(|(_, _, e)| *e),
                    rep_id,
                    rep_start,
                    rep_end,
                    source,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to update section: {}", e))?;

        // Re-match activities against the new polyline; a custom section
        // rescans the library, an auto one re-cuts the rides it holds.
        let departed = self.rebuild_section_junctions(section_id, &trimmed)?;

        // Invalidate caches, the performance one included: the laps a
        // section holds follow its line.
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();
        self.refresh_section_in_memory(section_id);

        // Trim promotes to user-defined (durable, backed-up); relinquish from the
        // registry so detection stops re-emitting its ground and colliding on it.
        self.section_identity_relinquish(section_id);
        self.drop_section_pin(section_id);

        self.record_edit_with_line(
            section_id,
            super::history::KIND_TRIMMED,
            serde_json::json!({ "start_index": start_index, "end_index": end_index }),
        )?;

        Ok(departed)
    }

    /// Put the in-memory copy of a section back in step with the database.
    ///
    /// An editor's caches are invalidated inside its transaction, so a rollback
    /// would otherwise leave the catalogue holding the edit the database no
    /// longer has.
    pub(super) fn resync_section_after_edit(&mut self, section_id: &str, rolled_back: bool) {
        if rolled_back {
            self.invalidate_section_cache(section_id);
            self.invalidate_perf_cache();
            self.refresh_section_in_memory(section_id);
            return;
        }
        // An editor deletes and re-matches the section's junction rows, so the
        // badges the old line earned belong to laps the section no longer has.
        // Scoped to this section: the whole-table pass costs 31 to 39 ms on a
        // 589-activity library and nothing outside this section moved.
        if let Err(e) = self.recompute_indicators_for_section(section_id) {
            log::warn!(
                "veloqrs: [section edit] indicator recompute for {} failed: {}",
                section_id,
                e
            );
        }
    }

    /// Reset a section's bounds to the original (pre-trim) polyline.
    /// Restores the backed-up original line and re-matches activities.
    /// For auto sections, clears is_user_defined. For custom sections, preserves it.
    pub fn reset_section_bounds(&mut self, section_id: &str) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| e.write_reset_section_bounds(section_id));
        self.resync_section_after_edit(section_id, done.is_err());
        if done.is_ok() {
            self.section_identity_admit(section_id);
        }
        done
    }

    fn write_reset_section_bounds(&mut self, section_id: &str) -> Result<Vec<String>, String> {
        // Load original polyline and section type
        type OriginalRow = (Option<Vec<u8>>, Option<String>, String);
        let (original_blob, original_json, section_type): OriginalRow = self
            .db
            .query_row(
                "SELECT original_polyline_blob, original_polyline_json, section_type
                 FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        if original_blob.is_none() && original_json.is_none() {
            return Err("Section has no original bounds to restore".to_string());
        }
        let original: Vec<GpsPoint> = crate::persistence::codec::decode_polyline_row(
            original_blob.as_deref(),
            original_json.as_deref(),
        )
        .map_err(|e| format!("Failed to parse original polyline: {}", e))?;

        // The restored geometry needs the anchor that describes it, not the edited one
        let anchor = self
            .section_anchor(section_id)
            .and_then(|(activity_id, _, _)| {
                let track = self.get_gps_track(&activity_id)?;
                let (start, end) = locate_slice(&track, &original)?;
                Some((activity_id, start, end))
            });

        // Recompute distance and bounds
        let distance = calculate_route_distance(&original);
        let bounds = tracematch::geo_utils::compute_bounds(&original);
        let updated_at = chrono::Utc::now().to_rfc3339();

        // Custom sections are always user-defined; auto sections revert to algorithm-defined
        let is_user_defined = if section_type == "custom" { 1 } else { 0 };

        let original_blob = crate::persistence::codec::serialize_track_points(&original);
        let reference = self.reference_of_line(section_id, &original);
        let (rep_id, rep_start, rep_end, source) = triple_columns(reference.as_ref());

        // Restore polyline and clear original backup
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    polyline_blob = ?,
                    original_polyline_blob = NULL,
                    original_polyline_json = NULL,
                    distance_meters = ?,
                    is_user_defined = ?,
                    updated_at = ?,
                    source_activity_id = ?,
                    start_index = ?,
                    end_index = ?,
                    representative_activity_id = COALESCE(?, representative_activity_id),
                    rep_start_index = ?,
                    rep_end_index = ?,
                    geometry_source = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    original_blob,
                    distance,
                    is_user_defined,
                    updated_at,
                    anchor.as_ref().map(|(id, _, _)| id.as_str()),
                    anchor.as_ref().map(|(_, s, _)| *s),
                    anchor.as_ref().map(|(_, _, e)| *e),
                    rep_id,
                    rep_start,
                    rep_end,
                    source,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to restore section bounds: {}", e))?;

        if is_user_defined == 0 {
            self.return_row_name_to_intent(section_id)?;
        }

        // Re-match activities against the restored polyline.
        let departed = self.rebuild_section_junctions(section_id, &original)?;

        // Invalidate caches, the performance one included: the laps a
        // section holds follow its line.
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();
        self.refresh_section_in_memory(section_id);
        self.drop_section_pin(section_id);

        self.record_edit_with_line(
            section_id,
            super::history::KIND_BOUNDS_RESET,
            serde_json::json!({}),
        )?;

        Ok(departed)
    }

    /// A row handed back to detection holds no typed name, because the next
    /// detect deletes derived rows. The name the trim moved onto it goes back
    /// into a named intent over the restored line.
    pub(crate) fn return_row_name_to_intent(&mut self, section_id: &str) -> Result<(), String> {
        let name: Option<String> = self
            .db
            .query_row(
                "SELECT name FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let Some(name) = name.filter(|n| !super::named::is_section_handle(n)) else {
            return Ok(());
        };
        self.upsert_named_intent_for(section_id, &name)?;
        self.db
            .execute(
                "UPDATE sections SET name = NULL WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Put a stored geometry version back as the section's live line and pin
    /// the section there, so the next re-cut holds it. The row takes the
    /// version's polyline and reference triple, the junction rows are
    /// re-matched against it with exclusions carried, and the ledger gets a
    /// `reverted` event linking the version. Fails when the version is
    /// absent or pruned: a revert must land on a line the user was shown.
    pub fn revert_section_to_version(
        &mut self,
        section_id: &str,
        version: i64,
    ) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| e.write_revert_section_to_version(section_id, version));
        self.resync_section_after_edit(section_id, done.is_err());
        done
    }

    fn write_revert_section_to_version(
        &mut self,
        section_id: &str,
        version: i64,
    ) -> Result<Vec<String>, String> {
        self.adopt_pending_archived_state(section_id, version)?;
        let (polyline, reference) = self
            .section_geometry_version(section_id, version)
            .ok_or_else(|| format!("Section {section_id} has no stored version {version}"))?;
        if polyline.len() < 2 {
            return Err("Stored version is too short to revert to".to_string());
        }
        let live: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sections WHERE id = ?)",
                params![section_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to read the section: {e}"))?;
        if !live {
            self.recreate_retired_section(section_id, version, &polyline, reference.as_ref())?;
        }

        let distance = calculate_route_distance(&polyline);
        let bounds = tracematch::geo_utils::compute_bounds(&polyline);
        let blob = crate::persistence::codec::serialize_track_points(&polyline);
        let updated_at = chrono::Utc::now().to_rfc3339();
        // A version whose range cannot rebuild it carries its own line, and
        // the row says so, or the line reads as a cache of a slice it is not.
        let orphaned: bool = self
            .db
            .query_row(
                "SELECT source IS 'orphaned' FROM section_geometry
                 WHERE section_id = ? AND version = ?",
                params![section_id, version],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to read the stored version: {e}"))?;
        let source = match (orphaned, reference.is_some()) {
            (true, _) => crate::persistence::sections::SOURCE_ORPHANED,
            (false, true) => crate::persistence::sections::SOURCE_EXACT,
            (false, false) => crate::persistence::sections::SOURCE_CONSENSUS,
        };
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    polyline_blob = ?,
                    distance_meters = ?,
                    updated_at = ?,
                    representative_activity_id = COALESCE(?, representative_activity_id),
                    rep_start_index = ?,
                    rep_end_index = ?,
                    geometry_source = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    blob,
                    distance,
                    updated_at,
                    reference.as_ref().map(|(id, _, _)| id.as_str()),
                    reference.as_ref().map(|(_, s, _)| *s),
                    reference.as_ref().map(|(_, _, e)| *e),
                    source,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to revert section: {}", e))?;

        let departed = self.rebuild_section_junctions(section_id, &polyline)?;

        let pinned = self
            .pin_section_geometry(section_id, version)
            .map_err(|e| format!("Failed to pin section: {}", e))?;
        if !pinned {
            return Err(format!(
                "Section {section_id} lost version {version} during the revert"
            ));
        }
        let details = serde_json::json!({ "version": version }).to_string();
        let kind = if live {
            crate::persistence::sections::KIND_REVERTED
        } else {
            crate::persistence::sections::KIND_RESTORED
        };
        self.append_section_history(section_id, kind, Some(&details), Some(version))
            .map_err(|e| format!("Failed to record the revert: {}", e))?;

        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);
        self.invalidate_perf_cache();
        Ok(departed)
    }

    /// Give a section the cutover retired a row again, under its own id so the
    /// ledger stays attached. Only an archived state carries what the row
    /// needs (name and sport), so a version no archived row names is refused.
    /// The row is custom and user-defined: a detect re-derives auto rows and
    /// would delete it. The caller's revert then writes the line, junctions,
    /// pin and ledger row.
    fn recreate_retired_section(
        &mut self,
        section_id: &str,
        version: i64,
        polyline: &[GpsPoint],
        reference: Option<&(String, u32, u32)>,
    ) -> Result<(), String> {
        let details: Option<String> = self
            .db
            .query_row(
                "SELECT details FROM section_history
                 WHERE section_id = ? AND kind = ? AND geometry_version = ?
                 ORDER BY id DESC LIMIT 1",
                params![
                    section_id,
                    crate::persistence::sections::KIND_ARCHIVED,
                    version
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read the archived state: {e}"))?
            .ok_or_else(|| format!("Section not found: {}", section_id))?;
        let details: serde_json::Value = details
            .as_deref()
            .and_then(|d| serde_json::from_str(d).ok())
            .unwrap_or(serde_json::Value::Null);
        let sport_type = details
            .get("sport_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Archived state of {section_id} names no sport"))?;
        let name = details.get("name").and_then(|v| v.as_str());
        let created_at = chrono::Utc::now().to_rfc3339();
        self.db
            .execute(
                "INSERT INTO sections (
                    id, section_type, name, sport_type, polyline_json, polyline_blob,
                    distance_meters, source_activity_id, start_index, end_index,
                    created_at, is_user_defined
                 ) VALUES (?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                params![
                    section_id,
                    name,
                    sport_type,
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    crate::persistence::codec::serialize_track_points(polyline),
                    calculate_route_distance(polyline),
                    reference.map(|(id, _, _)| id.as_str()),
                    reference.map(|(_, start, _)| *start),
                    reference.map(|(_, _, end)| *end),
                    created_at,
                ],
            )
            .map_err(|e| format!("Failed to recreate section: {e}"))?;
        Ok(())
    }

    /// Expand section bounds to the given range of an activity's GPS track.
    /// Backs up the original polyline on first edit (preserves true original across multiple edits).
    /// Re-matches all activities against the new polyline.
    pub fn expand_section_bounds(
        &mut self,
        section_id: &str,
        activity_id: &str,
        start_index: u32,
        end_index: u32,
    ) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| {
            e.write_expand_section_bounds(section_id, activity_id, start_index, end_index)
        });
        self.resync_section_after_edit(section_id, done.is_err());
        done
    }

    fn write_expand_section_bounds(
        &mut self,
        section_id: &str,
        activity_id: &str,
        start_index: u32,
        end_index: u32,
    ) -> Result<Vec<String>, String> {
        let track = self
            .get_gps_track(activity_id)
            .ok_or_else(|| format!("GPS track not found for activity: {}", activity_id))?;

        let start = start_index as usize;
        let end = end_index as usize;
        if start >= end {
            return Err("Start index must be less than end index".to_string());
        }
        if end >= track.len() {
            return Err(format!(
                "End index {} out of bounds (track has {} points)",
                end,
                track.len()
            ));
        }

        let new_polyline: Vec<GpsPoint> = track[start..=end].to_vec();
        if new_polyline.len() < 5 {
            return Err("Expanded section must have at least 5 points".to_string());
        }

        // Check minimum distance (50m)
        let distance = calculate_route_distance(&new_polyline);
        if distance < 50.0 {
            return Err("Expanded section must be at least 50 meters".to_string());
        }

        if !self.has_original_bounds(section_id) {
            let current = self.stored_section_polyline(section_id)?;
            self.back_up_original_line(section_id, &current)?;
        }

        // Compute new bounds and distance
        let bounds = tracematch::geo_utils::compute_bounds(&new_polyline);
        let updated_at = chrono::Utc::now().to_rfc3339();
        let polyline_blob = crate::persistence::codec::serialize_track_points(&new_polyline);

        // The same promotion as a trim, so the same handoff of the name.
        self.adopt_corridor_name(section_id);

        // Update section
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    polyline_blob = ?,
                    distance_meters = ?,
                    is_user_defined = 1,
                    updated_at = ?,
                    source_activity_id = ?,
                    start_index = ?,
                    end_index = ?,
                    representative_activity_id = COALESCE(?, representative_activity_id),
                    rep_start_index = ?,
                    rep_end_index = ?,
                    geometry_source = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    polyline_blob,
                    distance,
                    updated_at,
                    activity_id,
                    start_index,
                    end_index,
                    activity_id,
                    start_index,
                    end_index + 1,
                    crate::persistence::sections::SOURCE_EXACT,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to update section: {}", e))?;

        // Re-match activities against new polyline
        let departed = self.rebuild_section_junctions(section_id, &new_polyline)?;

        // Invalidate caches, the performance one included: the laps a
        // section holds follow its line.
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();
        self.refresh_section_in_memory(section_id);

        // The flag flip above makes the row user-owned: it leaves the registry
        // and any pin on an older line goes with the edit.
        self.section_identity_relinquish(section_id);
        self.drop_section_pin(section_id);

        self.record_edit_with_line(
            section_id,
            super::history::KIND_EXPANDED,
            serde_json::json!({
                "activity_id": activity_id,
                "start_index": start_index,
                "end_index": end_index,
            }),
        )?;

        Ok(departed)
    }

    // -----------------------------------------------------------------------
    // Section visibility operations
    // -----------------------------------------------------------------------

    /// Disable a section (hide from all queries except restore UI).
    ///
    /// The DB row is kept (disabled = 1) so enable can restore it with members
    /// intact, but it is dropped from the in-memory cache and the identity
    /// registry, and a durable suppression intent is recorded. Together these
    /// stop the corridor from re-emerging on the next detect (invariant 6) and
    /// close the in-mem/DB seam: the visible view already hides a disabled
    /// section, so the in-memory cache must too, or detection keeps matching on
    /// a corridor the user hid.
    pub fn disable_section(&mut self, section_id: &str) -> Result<(), String> {
        let rows = self
            .db
            .execute(
                "UPDATE sections SET disabled = 1 WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to disable section: {}", e))?;
        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }
        self.record_section_intent(section_id, "disabled");
        self.invalidate_section_cache(section_id);
        self.remove_section_from_memory(section_id);
        self.section_identity_relinquish(section_id);
        self.drop_section_pin(section_id);
        Ok(())
    }

    /// Re-enable a previously disabled section: clear its suppression intent,
    /// unhide the row, and restore it to the in-memory cache so the seam stays
    /// coherent and the corridor can be detected again.
    pub fn enable_section(&mut self, section_id: &str) -> Result<(), String> {
        let rows = self
            .db
            .execute(
                "UPDATE sections SET disabled = 0, superseded_by = NULL WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to enable section: {}", e))?;
        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }
        self.clear_section_intent(section_id);
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);
        self.refresh_superseded_ids();
        self.section_identity_admit(section_id);
        Ok(())
    }

    /// Move a section's reference to another member, because the activity its
    /// line was sliced from has left intervals.icu.
    ///
    /// A section's line is a triple into one stored stream, so an anchor whose
    /// activity is about to be deleted leaves geometry that cannot be read.
    /// The replacement is a lookup rather than a match: `section_activities`
    /// already holds every member's own start and end, so the new line is that
    /// member's own slice of its own track. Among the members the section
    /// counts, the one whose pass is closest in length wins, with the activity
    /// id as a total tie-break so the choice is deterministic.
    ///
    /// **Call this before the delete.** `section_activities` cascades on
    /// `activities(id)`, so removing the activity first takes the candidate
    /// list with it.
    ///
    /// Returns the activity the section now points at, or `None` when no other
    /// member can carry it, after every one has been tried, in which case nothing is touched and the caller
    /// protects the row.
    pub fn reanchor_section_reference(
        &mut self,
        section_id: &str,
        vanished_activity_id: &str,
    ) -> rusqlite::Result<Option<String>> {
        let done = self
            .in_write_txn(|e| e.write_reanchor_section_reference(section_id, vanished_activity_id));
        self.resync_section_after_edit(section_id, done.is_err());
        done.map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))
    }

    fn write_reanchor_section_reference(
        &mut self,
        section_id: &str,
        vanished_activity_id: &str,
    ) -> Result<Option<String>, String> {
        self.reanchor_rows(section_id, vanished_activity_id)
            .map_err(|e| e.to_string())
    }

    fn reanchor_rows(
        &mut self,
        section_id: &str,
        vanished_activity_id: &str,
    ) -> rusqlite::Result<Option<String>> {
        let anchored_here = self
            .section_source_activity(section_id)
            .is_some_and(|activity_id| activity_id == vanished_activity_id)
            || self
                .section_representative(section_id)
                .is_some_and(|activity_id| activity_id == vanished_activity_id);
        if !anchored_here {
            return Ok(None);
        }

        let section_distance: f64 = self
            .db
            .query_row(
                "SELECT distance_meters FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0.0);

        let members: Vec<(String, u32, u32)> = {
            let mut stmt = self.db.prepare(
                "SELECT activity_id, start_index, end_index
                 FROM section_activities
                 WHERE section_id = ? AND activity_id <> ? AND excluded = 0
                 ORDER BY abs(COALESCE(distance_meters, 0) - ?) ASC, activity_id ASC",
            )?;
            stmt.query_map(
                params![section_id, vanished_activity_id, section_distance],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?
            .collect::<rusqlite::Result<_>>()?
        };

        // Each member in order is tried, so a closest member with no stored
        // track or a slice past its end does not strand a section another
        // member can carry. A member's own slice wins; failing that, the line
        // the row holds is located in a member's track, which covers a member
        // whose stored range is unusable.
        let mut tracks: Vec<(String, Vec<GpsPoint>)> = Vec::new();
        for (member_id, _, _) in &members {
            if let Some(track) = self.get_gps_track(member_id) {
                tracks.push((member_id.clone(), track));
            }
        }
        let from_slice = members.iter().find_map(|(member_id, start, end)| {
            let (_, track) = tracks.iter().find(|(id, _)| id == member_id)?;
            let (lo, hi) = (*start as usize, *end as usize);
            (lo <= hi && hi < track.len()).then(|| (member_id.clone(), *start, *end))
        });
        let located = || {
            let line = self.stored_section_polyline(section_id).ok()?;
            tracks.iter().find_map(|(member_id, track)| {
                let (start, end) = locate_slice(track, &line)?;
                Some((member_id.clone(), start, end))
            })
        };
        let Some((new_id, start, end)) = from_slice.or_else(located) else {
            return Ok(None);
        };
        let Some(track) = tracks
            .iter()
            .find(|(id, _)| *id == new_id)
            .map(|(_, track)| track)
        else {
            return Ok(None);
        };
        let polyline = track[start as usize..=end as usize].to_vec();

        // The outgoing line is kept as stored points before the row moves,
        // because the stream it was cut from is deleted straight after and a
        // version that only names that stream could never be rebuilt.
        let outgoing = self.stored_section_polyline(section_id).ok();
        if let Some(prior) =
            super::history::milestone_prior_geometry_on(&self.db, section_id, outgoing.as_deref())?
            && let Some(line) = outgoing.as_deref().filter(|line| !line.is_empty())
        {
            self.db.execute(
                "UPDATE section_geometry SET blob = ?
                 WHERE section_id = ? AND version = ? AND length(blob) = 0",
                params![
                    crate::persistence::codec::encode_polyline(line),
                    section_id,
                    prior
                ],
            )?;
        }

        // The reference's end is half-open where the member's slice is inclusive.
        let version = self.record_section_geometry(
            section_id,
            &polyline,
            true,
            Some((new_id.as_str(), start, end + 1)),
        )?;

        let bounds = tracematch::geo_utils::compute_bounds(&polyline);
        let blob = crate::persistence::codec::serialize_track_points(&polyline);
        let distance = calculate_route_distance(&polyline);
        self.db.execute(
            "UPDATE sections SET
                 polyline_json = ?, polyline_blob = ?, distance_meters = ?,
                 updated_at = ?, source_activity_id = ?, start_index = ?, end_index = ?,
                 representative_activity_id = ?, rep_start_index = ?, rep_end_index = ?,
                 geometry_source = 'exact',
                 bounds_min_lat = ?, bounds_max_lat = ?, bounds_min_lng = ?, bounds_max_lng = ?
             WHERE id = ?",
            params![
                crate::persistence::codec::NO_POLYLINE_JSON,
                blob,
                distance,
                chrono::Utc::now().to_rfc3339(),
                new_id,
                start,
                end,
                new_id,
                start,
                end + 1,
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng,
                section_id
            ],
        )?;

        // A detected section carries only the representative triple, so the
        // move has to reach it or the row keeps naming the deleted stream.
        self.db.execute(
            "UPDATE sections SET
                 representative_activity_id = ?, rep_start_index = ?, rep_end_index = ?
             WHERE id = ? AND representative_activity_id = ?",
            params![new_id, start, end, section_id, vanished_activity_id],
        )?;

        let details = serde_json::json!({
            "from": vanished_activity_id,
            "to": new_id,
            "cause": super::history::REANCHOR_CAUSE_ACTIVITY_REMOVED,
        })
        .to_string();
        super::history::append_history_on(
            &self.db,
            section_id,
            super::history::KIND_REFERENCE_REANCHORED,
            Some(&details),
            Some(version),
            None,
        )?;

        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);

        Ok(Some(new_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::codec;
    use crate::persistence::sections::history::{
        KIND_ABSORBED, KIND_ACCEPTED, KIND_BOUNDS_RESET, KIND_EXPANDED, KIND_REFERENCE_RESET,
        KIND_REFERENCE_SET, KIND_RENAMED, KIND_TRIMMED,
    };

    fn line(n: usize) -> Vec<GpsPoint> {
        (0..n)
            .map(|i| GpsPoint {
                latitude: 46.0 + i as f64 * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// An engine holding one section of `n` points and one traversal of it.
    fn engine_with_section(n: usize, section_type: &str) -> (PersistentEngine, Vec<GpsPoint>) {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let polyline = line(n);
        engine
            .add_activity("a1".to_string(), polyline.clone(), "Ride".to_string())
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections
                 (id, section_type, sport_type, polyline_json, polyline_blob, distance_meters)
                 VALUES ('s1', ?, 'Ride', '[]', ?, 100.0)",
                params![section_type, codec::serialize_track_points(&polyline)],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities
                 (section_id, activity_id, direction, start_index, end_index, distance_meters)
                 VALUES ('s1', 'a1', 'same', 0, ?, 100.0)",
                params![n as i64 - 1],
            )
            .unwrap();
        (engine, polyline)
    }

    fn traversals(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    /// Scenario: the editors took no transaction at all. `trim_section` wrote
    /// the new polyline, deleted the junction rows, then re-matched, so a
    /// failure in the re-match left the section holding its new line with zero
    /// traversals, and nothing said so.
    ///
    /// Expected behaviour: the whole edit lands or none of it does.
    #[test]
    fn a_trim_that_fails_partway_leaves_the_section_as_it_was() {
        // Custom, so the trim clears the junction rows itself rather than
        // handing that to the re-match, which is the write that fails here.
        let (mut engine, original) = engine_with_section(10, "custom");
        engine
            .db
            .execute_batch("DROP TABLE section_activities")
            .unwrap();

        let failed = engine.trim_section("s1", 2, 7);

        assert!(failed.is_err(), "there were no junction rows to clear");
        assert_eq!(
            engine.stored_section_polyline("s1").unwrap().len(),
            original.len(),
            "the section kept the line it had, rather than the new one with nothing attached"
        );
        assert!(
            engine.db.is_autocommit(),
            "the rollback ran, so the next writer can begin its own"
        );
    }

    #[test]
    fn a_trim_that_lands_shortens_the_section_and_commits() {
        let (mut engine, original) = engine_with_section(10, "auto");

        engine.trim_section("s1", 2, 7).unwrap();

        let trimmed = engine.stored_section_polyline("s1").unwrap();
        assert_eq!(trimmed.len(), 6, "points 2 through 7 inclusive");
        assert!(trimmed.len() < original.len());
        assert_eq!(traversals(&engine), 1, "the one traversal was re-matched");
        assert!(engine.db.is_autocommit());
    }

    fn events_of(
        engine: &PersistentEngine,
        kind: &str,
    ) -> Vec<crate::persistence::sections::SectionHistoryEvent> {
        engine
            .section_history("s1")
            .into_iter()
            .filter(|e| e.kind == kind)
            .collect()
    }

    /// Scenario: the athlete trims a section to a clean climb, then reverts to
    /// an earlier version to compare. Expected behaviour: the trim is a ledger
    /// event linked to the trimmed line, and reverting past it and back to it
    /// restores the trimmed line.
    #[test]
    fn a_trim_is_a_ledger_event_whose_version_a_revert_restores() {
        let (mut engine, _) = engine_with_section(10, "auto");

        engine.trim_section("s1", 2, 7).unwrap();

        let trims = events_of(&engine, KIND_TRIMMED);
        assert_eq!(trims.len(), 1);
        let version = trims[0].geometry_version.expect("a trim stores its line");
        let details: serde_json::Value =
            serde_json::from_str(trims[0].details.as_deref().unwrap()).unwrap();
        assert_eq!(details["start_index"], 2);
        assert_eq!(details["end_index"], 7);
        assert_eq!(
            engine
                .section_geometry_polyline("s1", version)
                .unwrap()
                .len(),
            6
        );

        engine.reset_section_bounds("s1").unwrap();
        assert_eq!(engine.stored_section_polyline("s1").unwrap().len(), 10);
        engine.revert_section_to_version("s1", version).unwrap();
        assert_eq!(engine.stored_section_polyline("s1").unwrap().len(), 6);
    }

    #[test]
    fn a_failed_trim_leaves_no_ledger_event_or_version() {
        let (mut engine, _) = engine_with_section(10, "custom");
        let versions = engine.section_geometry_versions("s1").len();
        engine
            .db
            .execute_batch("DROP TABLE section_activities")
            .unwrap();

        assert!(engine.trim_section("s1", 2, 7).is_err());

        assert!(events_of(&engine, KIND_TRIMMED).is_empty());
        assert_eq!(engine.section_geometry_versions("s1").len(), versions);
    }

    #[test]
    fn a_bounds_reset_is_a_ledger_event_linked_to_the_restored_line() {
        let (mut engine, _) = engine_with_section(10, "auto");
        engine.trim_section("s1", 2, 7).unwrap();

        engine.reset_section_bounds("s1").unwrap();

        let resets = events_of(&engine, KIND_BOUNDS_RESET);
        assert_eq!(resets.len(), 1);
        let version = resets[0].geometry_version.expect("a reset stores its line");
        assert_eq!(
            engine
                .section_geometry_polyline("s1", version)
                .unwrap()
                .len(),
            10
        );
    }

    #[test]
    fn an_expand_is_a_ledger_event_linked_to_the_new_line() {
        let (mut engine, _) = engine_with_section(10, "auto");

        engine.expand_section_bounds("s1", "a1", 1, 8).unwrap();

        let expands = events_of(&engine, KIND_EXPANDED);
        assert_eq!(expands.len(), 1);
        let version = expands[0]
            .geometry_version
            .expect("an expand stores its line");
        assert_eq!(
            engine
                .section_geometry_polyline("s1", version)
                .unwrap()
                .len(),
            8
        );
        let details: serde_json::Value =
            serde_json::from_str(expands[0].details.as_deref().unwrap()).unwrap();
        assert_eq!(details["activity_id"], "a1");
    }

    #[test]
    fn accepting_a_section_is_a_ledger_event() {
        let (mut engine, _) = engine_with_section(10, "auto");

        engine.accept_section("s1").unwrap();

        assert_eq!(events_of(&engine, KIND_ACCEPTED).len(), 1);
    }

    #[test]
    fn accepting_all_sections_writes_one_event_per_section() {
        let (mut engine, _) = engine_with_section(10, "auto");
        engine
            .db
            .execute(
                "INSERT INTO sections
                 (id, section_type, sport_type, polyline_json, polyline_blob, distance_meters)
                 VALUES ('s2', 'auto', 'Ride', '[]', ?, 100.0)",
                params![codec::serialize_track_points(&line(10))],
            )
            .unwrap();

        assert_eq!(engine.accept_all_sections().unwrap(), 2);

        assert_eq!(events_of(&engine, KIND_ACCEPTED).len(), 1);
        let s2 = engine.section_history("s2");
        assert_eq!(s2.iter().filter(|e| e.kind == KIND_ACCEPTED).count(), 1);
    }

    #[test]
    fn a_rename_records_the_name_before_and_after() {
        let (mut engine, _) = engine_with_section(10, "custom");
        engine.set_section_name("s1", Some("Hill")).unwrap();

        engine.set_section_name("s1", Some("Climb")).unwrap();

        let renames = events_of(&engine, KIND_RENAMED);
        assert_eq!(renames.len(), 2);
        let last: serde_json::Value =
            serde_json::from_str(renames[1].details.as_deref().unwrap()).unwrap();
        assert_eq!(last["from"], "Hill");
        assert_eq!(last["to"], "Climb");
    }

    #[test]
    fn setting_the_reference_is_a_ledger_event_linked_to_the_new_line() {
        let (mut engine, polyline) = engine_with_section(10, "auto");
        engine
            .add_activity("a2".to_string(), polyline, "Ride".to_string())
            .unwrap();

        engine.set_section_reference("s1", "a2").unwrap();

        let sets = events_of(&engine, KIND_REFERENCE_SET);
        assert_eq!(sets.len(), 1);
        assert!(sets[0].geometry_version.is_some());
    }

    #[test]
    fn resetting_the_reference_is_a_ledger_event() {
        let (mut engine, _) = engine_with_section(10, "auto");
        engine.trim_section("s1", 2, 7).unwrap();

        engine.reset_section_reference("s1").unwrap();

        assert_eq!(events_of(&engine, KIND_REFERENCE_RESET).len(), 1);
        assert_eq!(events_of(&engine, KIND_BOUNDS_RESET).len(), 1);
    }

    #[test]
    fn a_merge_is_a_ledger_event_on_the_survivor_naming_the_absorbed_id() {
        let (mut engine, polyline) = engine_with_section(10, "custom");
        engine
            .db
            .execute(
                "INSERT INTO sections
                 (id, section_type, sport_type, polyline_json, polyline_blob, distance_meters)
                 VALUES ('s2', 'custom', 'Ride', '[]', ?, 100.0)",
                params![codec::serialize_track_points(&polyline)],
            )
            .unwrap();

        engine.merge_user_sections("s1", "s2").unwrap();

        let merges = events_of(&engine, KIND_ABSORBED);
        assert_eq!(merges.len(), 1);
        let details: serde_json::Value =
            serde_json::from_str(merges[0].details.as_deref().unwrap()).unwrap();
        assert_eq!(details["absorbed"], serde_json::json!(["s2"]));
        let retired = engine.section_history("s2");
        let last = retired
            .last()
            .expect("the absorbed section keeps its ledger");
        assert_eq!(last.kind, "merged");
        let into: serde_json::Value =
            serde_json::from_str(last.details.as_deref().unwrap()).unwrap();
        assert_eq!(into["into"], "s1");
    }
}
