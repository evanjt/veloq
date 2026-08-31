//! Section management: loading, queries, detection, save/apply, names.

pub mod conditioning;
mod detection;
pub(crate) mod geometry;
pub(super) mod history;
mod identity;
mod interest;
mod merging;
mod named;
mod naming;
pub(crate) mod preview;
mod ranking;
pub(crate) mod track_pool;

pub use history::{
    DetectorGeneration, KIND_REVERTED, RetiredSection, SOURCE_CONSENSUS, SOURCE_EXACT,
    SalvageCounts, SectionChange, SectionGeometryVersion, SectionHistoryEvent, SectionLineage,
};
pub(crate) use identity::SECTION_IDENTITY_KEY;
pub(crate) use identity::SectionIdentity;
pub use identity::content_id_for;
pub(crate) use named::looks_generated;
pub use named::{NamedCorridor, NamedOverlay};

pub(crate) use detection::DETECTION_PHASE_SUSPENDED;
pub use detection::detection_workers_started;

use crate::sections::assign_carried_exclusions;
use crate::{FrequentSection, GpsPoint, SectionPortion};
use chrono::Utc;
use rusqlite::{Result as SqlResult, params, types::Type};
use std::collections::{HashMap, HashSet};

use super::{PersistentEngine, SectionSummary, codec, get_section_word};

/// `schema_info` key naming the detection method that cut the stored catalogue.
pub const CATALOGUE_METHOD_KEY: &str = "catalogue_detection_method";

/// The one detector this build ships. Stored beside every catalogue so a
/// database cut by an older build reads as owed a cutover.
pub const DETECTOR_METHOD: &str = "unified";

/// `schema_info` key holding [`section_config_digest`] of the config the stored
/// catalogue ran under.
pub const CATALOGUE_CONFIG_DIGEST_KEY: &str = "catalogue_config_digest";

/// Stable fingerprint of a detection config, as 16 lowercase hex digits.
///
/// Two devices holding the same config agree on this string. The input is the
/// serde form, ordered by struct declaration rather than by map iteration, and
/// the hash is FNV-1a, whose output is fixed across processes and releases.
pub fn section_config_digest(config: &tracematch::sections::SectionConfig) -> String {
    let Ok(canonical) = serde_json::to_string(config) else {
        return "unserialisable".to_string();
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in canonical.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Haversine distance between two lat/lng points in meters.
pub(super) use crate::persistence::haversine_distance_meters as haversine_distance;

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

/// Exclusion rows the auto-section wipe is about to cascade away:
/// `None` fate for a fully excluded activity, `Some(start_indices)` for
/// per-lap state, keyed by the excluded rows' own `start_index` values.
type CarriedExclusions = Vec<(String, String, Option<Vec<u32>>)>;

fn capture_auto_exclusions(tx: &rusqlite::Transaction) -> SqlResult<CarriedExclusions> {
    // The common save carries no exclusions at all; one early-exit probe
    // spares the correlated scan below on every detection apply.
    let any: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM section_activities WHERE excluded = 1)",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !any {
        return Ok(CarriedExclusions::new());
    }
    let mut stmt = tx.prepare(
        "SELECT sa.section_id, sa.activity_id, sa.excluded, sa.start_index
         FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE s.section_type = 'auto' AND s.original_polyline_json IS NULL
           AND s.is_user_defined = 0 AND s.disabled = 0
           AND EXISTS (SELECT 1 FROM section_activities e
                       WHERE e.section_id = sa.section_id
                         AND e.activity_id = sa.activity_id AND e.excluded = 1)
         ORDER BY sa.section_id, sa.activity_id, sa.start_index",
    )?;
    let rows: Vec<(String, String, bool, u32)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get(3)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();
    let mut carried = CarriedExclusions::new();
    let mut i = 0;
    while i < rows.len() {
        let (sid, aid) = (rows[i].0.clone(), rows[i].1.clone());
        let mut starts = Vec::new();
        let mut count = 0usize;
        while i < rows.len() && rows[i].0 == sid && rows[i].1 == aid {
            if rows[i].2 {
                starts.push(rows[i].3);
            }
            count += 1;
            i += 1;
        }
        if starts.len() == count {
            carried.push((sid, aid, None));
        } else {
            carried.push((sid, aid, Some(starts)));
        }
    }
    Ok(carried)
}

/// Put carried exclusions back after the junction re-insert. Same rules
/// as the CRUD-side reapply: full activities flag every new row; per-lap
/// state carries onto the nearest rebuilt row by `start_index`.
fn reapply_auto_exclusions(
    tx: &rusqlite::Transaction,
    carried: &CarriedExclusions,
) -> SqlResult<()> {
    for (sid, aid, fate) in carried {
        match fate {
            None => {
                tx.execute(
                    "UPDATE section_activities SET excluded = 1
                     WHERE section_id = ? AND activity_id = ?",
                    params![sid, aid],
                )?;
            }
            Some(carried_starts) => {
                let rebuilt: Vec<u32> = {
                    let mut stmt = tx.prepare(
                        "SELECT start_index FROM section_activities
                         WHERE section_id = ? AND activity_id = ? ORDER BY start_index",
                    )?;
                    stmt.query_map(params![sid, aid], |row| row.get(0))?
                        .filter_map(|r| r.ok())
                        .collect()
                };
                for start in assign_carried_exclusions(carried_starts, &rebuilt) {
                    tx.execute(
                        "UPDATE section_activities SET excluded = 1
                         WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                        params![sid, aid, start],
                    )?;
                }
            }
        }
    }
    Ok(())
}

/// Sport words that can prefix a stored section name.
const NAME_SPORT_WORDS: [&str; 7] = [
    "Ride",
    "Run",
    "Hike",
    "Walk",
    "Swim",
    "VirtualRide",
    "VirtualRun",
];

/// Reads the number out of "Section N" or "{Sport} Section N".
fn section_name_number(name: &str, section_word: &str) -> Option<u32> {
    if let Some(rest) = name.strip_prefix(&format!("{} ", section_word)) {
        return rest.parse::<u32>().ok();
    }
    for sport in NAME_SPORT_WORDS {
        if let Some(rest) = name.strip_prefix(&format!("{} {} ", sport, section_word)) {
            return rest.parse::<u32>().ok();
        }
    }
    None
}

/// Every number `names` already spends, so minting cannot reuse one.
fn taken_section_numbers<'a>(
    names: impl Iterator<Item = &'a str>,
    section_word: &str,
) -> HashSet<u32> {
    names
        .filter_map(|name| section_name_number(name, section_word))
        .collect()
}

/// Next free number in the shared sequence, marked taken.
fn next_section_number(taken: &mut HashSet<u32>, counter: &mut u32) -> u32 {
    loop {
        *counter += 1;
        if taken.insert(*counter) {
            return *counter;
        }
    }
}

impl PersistentEngine {
    /// Load sections from database.
    pub(super) fn load_sections(&mut self) -> SqlResult<()> {
        self.sections.clear();

        // First check how many rows are in the table
        let count: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0);
        log::info!(
            "veloqrs: [PersistentEngine] Loading sections: {} rows in DB",
            count
        );

        // Load full activity portions from junction table (includes direction, indices, distance)
        // After cross-sport merge, sections can have activities from multiple sport types.
        // One row per pass: `portions.len()` IS the visit count, matching the
        // trigger-maintained column. Gating the count on lap_time made the
        // number DROP when one pass gained a time stream.
        let section_portions: HashMap<String, Vec<SectionPortion>> = {
            let mut stmt = self.db.prepare(
                "SELECT sa.section_id, sa.activity_id, sa.direction, sa.start_index, sa.end_index, sa.distance_meters
                 FROM section_activities sa
                 WHERE sa.excluded = 0
                 ORDER BY sa.section_id, sa.start_index"
            )?;
            let mut map: HashMap<String, Vec<SectionPortion>> = HashMap::new();
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
                ))
            })?;
            for row in rows {
                let row = match row {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!(
                            "veloqrs: [PersistentEngine] Skipping malformed section_activities row during loading: {:?}",
                            e
                        );
                        continue;
                    }
                };
                map.entry(row.0).or_default().push(row.1);
            }
            map
        };

        // Scope the statement to release the borrow before migrate_section_names
        {
            let mut stmt = self.db.prepare(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at, consensus_state_blob,
                        polyline_blob, point_density_blob,
                        elevation_gain_m, avg_grade_percent,
                        rep_start_index, rep_end_index,
                        elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score
                 FROM sections
                 WHERE (section_type = 'auto' OR section_type = 'custom') AND disabled = 0
                 ORDER BY id",
            )?;

            self.sections = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let polyline_json: Option<String> = row.get(4)?;
                    let point_density_json: Option<String> = row.get(10)?;
                    let representative_activity_id: Option<String> = row.get(6)?;
                    let consensus_state_blob: Option<Vec<u8>> = row.get(17)?;
                    let polyline_blob: Option<Vec<u8>> = row.get(18)?;
                    let point_density_blob: Option<Vec<u8>> = row.get(19)?;
                    let consensus_state = consensus_state_blob.and_then(|bytes| {
                        match codec::deserialize_gps_composite::<tracematch::sections::ConsensusAccumulator>(&bytes) {
                            Ok(acc) => Some(acc),
                            Err(e) => {
                                log::warn!(
                                    "veloqrs: [load_sections] failed to deserialize consensus_state blob for section {}: {}",
                                    id, e
                                );
                                None
                            }
                        }
                    });

                    // Both columns or neither: a half-range indexes nothing.
                    let rep_start: Option<u32> = row.get(22)?;
                    let rep_end: Option<u32> = row.get(23)?;
                    let polyline: Vec<GpsPoint> = geometry::line(
                        &self.db,
                        polyline_blob.as_deref(),
                        polyline_json.as_deref(),
                        geometry::reference(
                            representative_activity_id.as_deref(),
                            rep_start,
                            rep_end,
                        ),
                    )
                    .unwrap_or_else(|e| {
                        log::error!(
                            "load_sections: polyline decode failed for section {} ({}); section will load with an empty polyline",
                            id, e
                        );
                        Vec::new()
                    });
                    let point_density: Vec<u32> = point_density_blob
                        .and_then(|b| codec::deserialize(&b).ok())
                        .or_else(|| {
                            point_density_json.and_then(|j| serde_json::from_str(&j).ok())
                        })
                        .unwrap_or_default();

                    let portions = section_portions.get(&id)
                        .cloned()
                        .unwrap_or_default();
                    // Derive activity_ids from portions, unique and in id order
                    let activity_ids: Vec<String> = portions.iter()
                        .map(|p| p.activity_id.clone())
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .collect();
                    let visit_count = portions.len() as u32;

                    let representative_range = rep_start.zip(rep_end);

                    Ok(FrequentSection {
                        id,
                        name: row.get(2)?,
                        sport_type: row.get(3)?,
                        polyline,
                        representative_activity_id: representative_activity_id.unwrap_or_default(),
                        representative_range,
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
                        elevation_gain_m: row.get(20)?,
                        avg_grade_percent: row.get(21)?,
                        version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                        updated_at: row.get(16)?,
                        created_at: row.get(15)?,
                        enrichment: interest::enrichment_from_row(row, 20, 24)?,
                        rank: interest::rank_from_row(row, 29)?,
                        consensus_state,
                    })
                })?
                .filter_map(|r| match r {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::warn!("veloqrs: [PersistentEngine] Skipping malformed section row during loading: {:?}", e);
                        None
                    }
                })
                .filter(|s: &FrequentSection| !s.id.is_empty())
                .collect();
        }

        log::info!(
            "veloqrs: [PersistentEngine] Loaded {} sections into memory (from {} in DB)",
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
                "veloqrs: [PersistentEngine] First {} section IDs: {:?}",
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

        self.refresh_superseded_ids();

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
            "veloqrs: [PersistentEngine] Loaded {} processed activity IDs",
            self.processed_activity_ids.len()
        );
        Ok(())
    }

    /// Save processed activity IDs to database after section detection.
    /// Tier 5.5: rebuild a single section's consensus polyline from its
    /// current activity traces. Cheap, user-initiated alternative to a
    /// corpus-wide detection rerun. Returns the new polyline shape, or
    /// None if the section doesn't exist / is user-defined / has no
    /// activities to refine from.
    pub fn recalculate_section_polyline(
        &mut self,
        section_id: &str,
    ) -> Option<crate::FfiSectionRecalcResult> {
        let idx = self.sections.iter().position(|s| s.id == section_id)?;
        let mut section = self.sections[idx].clone();
        if section.is_user_defined || section.activity_ids.is_empty() {
            return None;
        }

        // A line sliced from one activity recalculates by re-slicing that
        // range: the same input gives the same line, so a second call is a
        // no-op. Only an averaged legacy line goes back through consensus.
        if let Some((start, end)) = section.representative_range
            && let Some(track) = self.load_gps_track_from_db(&section.representative_activity_id)
            && (start as usize) < (end as usize)
            && (end as usize) <= track.len()
        {
            let polyline = track[start as usize..end as usize].to_vec();
            let distance = tracematch::matching::calculate_route_distance(&polyline);
            let result = crate::FfiSectionRecalcResult {
                section_id: section.id.clone(),
                polyline_point_count: polyline.len() as u32,
                distance_meters: distance,
            };
            let unchanged = section.polyline == polyline;
            section.polyline = polyline;
            section.distance_meters = distance;
            self.sections[idx] = section;
            if !unchanged && let Err(err) = self.save_sections() {
                log::warn!(
                    "veloqrs: [recalculate_section_polyline] save_sections failed: {}",
                    err
                );
            }
            return Some(result);
        }

        let activity_ids: Vec<String> = section.activity_ids.clone();
        let track_pairs: Vec<(String, Vec<tracematch::GpsPoint>)> = activity_ids
            .iter()
            .filter_map(|aid| self.load_gps_track_from_db(aid).map(|t| (aid.clone(), t)))
            .collect();
        if track_pairs.is_empty() {
            return None;
        }
        let track_map: std::collections::HashMap<&str, &[tracematch::GpsPoint]> = track_pairs
            .iter()
            .map(|(id, pts)| (id.as_str(), pts.as_slice()))
            .collect();
        let traces = tracematch::sections::extract_all_activity_traces(
            &activity_ids,
            &section.polyline,
            &track_map,
        );
        for (aid, trace) in tracematch::sections::longest_pass_per_activity(traces) {
            section.activity_traces.insert(aid, trace);
        }

        let recalced =
            tracematch::sections::recalculate_section_polyline(&section, &self.section_config);

        let result = crate::FfiSectionRecalcResult {
            section_id: recalced.id.clone(),
            polyline_point_count: recalced.polyline.len() as u32,
            distance_meters: recalced.distance_meters,
        };

        let mut updated = recalced;
        updated.activity_traces.clear();
        updated.activity_traces.shrink_to_fit();
        self.sections[idx] = updated;
        if let Err(err) = self.save_sections() {
            log::warn!(
                "veloqrs: [recalculate_section_polyline] save_sections failed: {}",
                err
            );
        }
        Some(result)
    }

    pub fn save_processed_activity_ids(&mut self, activity_ids: &[String]) -> SqlResult<()> {
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
        // The evidence cache goes first and unconditionally. Its caller has
        // already persisted the config that provoked the clear, so a cache
        // folded under the old one is wrong from here on however the DELETE
        // goes; dropping it only costs a cold rebatch.
        self.invalidate_evidence_cache();
        // Only clear the in-memory set when the DB delete succeeds; otherwise
        // the rows reload on next start and memory would disagree with disk.
        match self.db.execute("DELETE FROM processed_activities", []) {
            Ok(_) => {
                self.processed_activity_ids.clear();
                self.pending_processed_clear = false;
                log::info!(
                    "veloqrs: [PersistentEngine] Cleared all processed activity IDs for forced re-detection"
                );
            }
            Err(e) => {
                // Leaving the set intact would short-circuit the next detect on
                // every activity it holds, under a config that no longer matches
                // them. Flag it so the next detect retries before it reads.
                self.pending_processed_clear = true;
                log::warn!("veloqrs: failed to clear processed activity IDs: {e:?}");
            }
        }
    }

    /// Whether a processed-set clear is still owed. Exposed so a test can see
    /// the flag without reaching into the engine's private state.
    #[doc(hidden)]
    pub fn processed_clear_pending(&self) -> bool {
        self.pending_processed_clear
    }

    /// Re-run a clear whose DELETE failed. Called at the head of every detect,
    /// which is the first moment the stale processed set would be read.
    pub(crate) fn retry_pending_processed_clear(&mut self) {
        if !self.pending_processed_clear {
            return;
        }
        log::info!("veloqrs: retrying the processed-activity clear owed from a failed DELETE");
        self.clear_processed_activity_ids();
    }

    /// Evict specific activity IDs from the processed set (DB + in memory) so a
    /// GPS mutation forces the next detect to re-analyse just those activities,
    /// leaving the rest processed. A no-op for IDs not currently processed (e.g.
    /// brand-new adds). Mirrors `clear_processed_activity_ids`: the in-memory set
    /// is only mutated when the DB delete commits, so memory can't disagree with
    /// disk after a failed write.
    pub(crate) fn evict_processed_activity_ids(&mut self, activity_ids: &[String]) {
        if activity_ids.is_empty() {
            return;
        }
        let tx = match self.db.unchecked_transaction() {
            Ok(tx) => tx,
            Err(e) => {
                log::warn!("veloqrs: processed-id eviction begin failed: {e:?}");
                return;
            }
        };
        let mut ok = true;
        match tx.prepare("DELETE FROM processed_activities WHERE activity_id = ?") {
            Ok(mut stmt) => {
                for id in activity_ids {
                    if stmt.execute(params![id]).is_err() {
                        ok = false;
                        break;
                    }
                }
            }
            Err(_) => ok = false,
        }
        if ok && tx.commit().is_ok() {
            for id in activity_ids {
                self.processed_activity_ids.remove(id);
            }
            // A mutated activity's cluster in the evidence cache is now stale and
            // the cache cannot drop one member surgically, so clear the whole
            // cache; the next detect cold-rebatches the correct pool.
            self.invalidate_evidence_cache();
        } else {
            log::warn!("veloqrs: processed-id eviction failed; in-memory set left intact");
        }
    }

    // Section name migration and management methods live in `naming.rs`.

    // ========================================================================
    // Sections (Background Detection)
    // ========================================================================

    /// Get sections (must call detect_sections first or load from DB). The whole
    /// catalogue, superseded entries included: they are still detection priors,
    /// so dropping them here would re-mint their ground under a new id. Reads
    /// that answer a user use [`get_visible_sections`](Self::get_visible_sections).
    pub fn get_sections(&self) -> &[FrequentSection] {
        &self.sections
    }

    /// Re-read which sections a custom section has replaced. Queries `self.db`,
    /// so it belongs to the WRITE-lock class of engine methods; every path that
    /// writes `superseded_by` calls it so the read-lock views stay pure memory.
    pub(crate) fn refresh_superseded_ids(&mut self) {
        let Ok(mut stmt) = self
            .db
            .prepare("SELECT id FROM sections WHERE superseded_by IS NOT NULL")
        else {
            return;
        };
        self.superseded_ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
    }

    /// The catalogue as a user should see it: superseded sections hidden, matching
    /// the DB visible view. Disabled sections are already absent (the loader
    /// filters them). Pure memory, so a read-lock caller may use it.
    pub fn get_visible_sections(&self) -> Vec<&FrequentSection> {
        self.sections
            .iter()
            .filter(|s| !self.superseded_ids.contains(&s.id))
            .collect()
    }

    /// Distinct activities crossing the drawn line, the population the DB view
    /// counts from junction rows. `activity_ids` holds cluster contributors,
    /// which the render trim can differ from, so flooring on it would hide a
    /// section the summaries show. Falls back when no portions exist, matching
    /// the detector's own guard on the drawn set.
    fn outings(s: &FrequentSection) -> u32 {
        if s.activity_portions.is_empty() {
            return s.activity_ids.len() as u32;
        }
        s.activity_portions
            .iter()
            .map(|p| &p.activity_id)
            .collect::<HashSet<_>>()
            .len() as u32
    }

    /// Whether a sport traverses this section. Ground is neutral: the section's
    /// own `sport_type` is only the dominant label of its traversals.
    /// Counts the same population as `outings`.
    pub(crate) fn covers_sport(&self, s: &FrequentSection, sport: &str) -> bool {
        if s.sport_type == sport {
            return true;
        }
        let mut traversers = s
            .activity_portions
            .iter()
            .map(|p| &p.activity_id)
            .peekable();
        if traversers.peek().is_some() {
            return traversers.any(|id| self.sport_of(id) == Some(sport));
        }
        s.activity_ids
            .iter()
            .any(|id| self.sport_of(id) == Some(sport))
    }

    /// The activity's sport, falling back to the `activities` row when the
    /// in-memory maps have not been loaded.
    pub(crate) fn sport_of_activity(&self, activity_id: &str) -> Option<String> {
        if let Some(sport) = self.sport_of(activity_id) {
            return Some(sport.to_string());
        }
        self.db
            .query_row(
                "SELECT sport_type FROM activities WHERE id = ?",
                rusqlite::params![activity_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    /// `activity_metadata` is the authority: it is written on ingest, while
    /// `activity_metrics` fills only once metrics load.
    pub(crate) fn sport_of(&self, activity_id: &str) -> Option<&str> {
        self.activity_metadata
            .get(activity_id)
            .map(|m| m.sport_type.as_str())
            .or_else(|| {
                self.activity_metrics
                    .get(activity_id)
                    .map(|m| m.sport_type.as_str())
            })
    }

    /// Get sections filtered by sport type and/or minimum outings.
    /// Filters in-memory sections to avoid FFI overhead for non-matching entries.
    pub fn get_sections_filtered(
        &self,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
    ) -> Vec<&FrequentSection> {
        let min = min_visits.unwrap_or(0);
        // Outings, not passes: laps show ground covered, not that the athlete
        // came back. Under a sport filter the floor counts that sport's
        // outings, so a road ridden weekly cannot admit itself to the Run list
        // on one run.
        self.sections
            .iter()
            .filter(|s| match sport_type {
                Some(st) => self.covers_sport(s, st) && self.outings_in_sport(s, st) >= min,
                None => Self::outings(s) >= min,
            })
            .filter(|s| !self.superseded_ids.contains(&s.id))
            .collect()
    }

    /// [`outings`](Self::outings) restricted to one sport's traversals.
    pub(crate) fn outings_in_sport(&self, s: &FrequentSection, sport: &str) -> u32 {
        let matches = |id: &String| self.sport_of(id) == Some(sport);
        if s.activity_portions.is_empty() {
            return s.activity_ids.iter().filter(|id| matches(id)).count() as u32;
        }
        s.activity_portions
            .iter()
            .map(|p| &p.activity_id)
            .filter(|id| matches(id))
            .collect::<HashSet<_>>()
            .len() as u32
    }

    pub fn mark_section_accepted_in_memory(&mut self, section_id: &str) {
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.is_user_defined = true;
        }
    }

    /// Refresh a section in memory from the database. Auto and custom
    /// sections are both cached in `self.sections`, so this applies to any
    /// row. Call it after modifying a section's polyline or activity list.
    pub fn refresh_section_in_memory(&mut self, section_id: &str) {
        let section_data: Option<(
            String,
            String,
            Option<String>,
            Option<String>,
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
            Option<Vec<u8>>,
            Option<Vec<u8>>,
            Option<f64>,
            Option<f64>,
            Option<u32>,
            Option<u32>,
        )> = {
            let mut stmt = match self.db.prepare(
                "SELECT section_type, sport_type, name, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at, polyline_blob, point_density_blob,
                        elevation_gain_m, avg_grade_percent,
                        rep_start_index, rep_end_index
                 FROM sections WHERE id = ?",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };

            stmt.query_row(params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,           // section_type
                    row.get::<_, String>(1)?,           // sport_type
                    row.get::<_, Option<String>>(2)?,   // name
                    row.get::<_, Option<String>>(3)?,   // polyline_json
                    row.get::<_, f64>(4)?,              // distance_meters
                    row.get::<_, Option<String>>(5)?,   // representative_activity_id
                    row.get::<_, Option<f64>>(6)?,      // confidence
                    row.get::<_, Option<u32>>(7)?,      // observation_count
                    row.get::<_, Option<f64>>(8)?,      // average_spread
                    row.get::<_, Option<String>>(9)?,   // point_density_json
                    row.get::<_, Option<String>>(10)?,  // scale
                    row.get::<_, Option<u32>>(11)?,     // version
                    row.get::<_, Option<i32>>(12)?,     // is_user_defined
                    row.get::<_, Option<f64>>(13)?,     // stability
                    row.get::<_, Option<String>>(14)?,  // created_at
                    row.get::<_, Option<String>>(15)?,  // updated_at
                    row.get::<_, Option<Vec<u8>>>(16)?, // polyline_blob
                    row.get::<_, Option<Vec<u8>>>(17)?, // point_density_blob
                    row.get::<_, Option<f64>>(18)?,     // elevation_gain_m
                    row.get::<_, Option<f64>>(19)?,     // avg_grade_percent
                    row.get::<_, Option<u32>>(20)?,     // rep_start_index
                    row.get::<_, Option<u32>>(21)?,     // rep_end_index
                ))
            })
            .ok()
        };

        let (
            _section_type,
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
            polyline_blob,
            point_density_blob,
            elevation_gain_m,
            avg_grade_percent,
            rep_start_index,
            rep_end_index,
        ) = match section_data {
            Some(data) => data,
            None => return, // Section not found
        };

        // Both auto and custom sections are cached in memory now: the in-memory
        // matcher (index_new_activity) scans get_sections(), so a custom section
        // must be there for a new activity to join it. save_sections skips
        // user-defined rows, so caching custom here cannot round-trip into an
        // 'auto' re-insert.

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

        // The cached blob first, then the reference triple, so a refresh after a
        // cleared cache reads the same line the load does.
        let polyline: Vec<GpsPoint> = match geometry::line(
            &self.db,
            polyline_blob.as_deref(),
            polyline_json.as_deref(),
            geometry::reference(
                representative_activity_id.as_deref(),
                rep_start_index,
                rep_end_index,
            ),
        ) {
            Ok(p) => p,
            Err(e) => {
                log::error!(
                    "veloqrs: [refresh_section_in_memory] Failed to decode polyline for {}: {}",
                    section_id,
                    e
                );
                return;
            }
        };
        let point_density: Vec<u32> = point_density_blob
            .and_then(|b| codec::deserialize(&b).ok())
            .or_else(|| point_density_json.and_then(|j| serde_json::from_str(&j).ok()))
            .unwrap_or_default();

        // The trigger-maintained column: one row per pass, no lap_time gate.
        let visit_count: u32 = self
            .db
            .query_row(
                "SELECT visit_count FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(activity_ids.len() as u32);

        let (enrichment, rank) = self.read_enrichment(section_id);
        let updated_section = FrequentSection {
            id: section_id.to_string(),
            name,
            sport_type,
            polyline,
            representative_activity_id: representative_activity_id.unwrap_or_default(),
            // Dropping this here would demote an exact section to consensus on
            // the next save, permanently.
            representative_range: rep_start_index.zip(rep_end_index),
            activity_ids,
            // From the junction table: `save_sections` writes junction rows
            // FROM this field, so a blank here turns the next save into a
            // wipe of the section's traversals.
            activity_portions: self.get_section_portions(section_id),
            route_ids: vec![], // Not stored in DB
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
                        "veloqrs: [refresh_section_in_memory] Failed to parse scale '{}' for {}",
                        s,
                        section_id
                    );
                    None
                }
            }),
            is_user_defined: is_user_defined.unwrap_or(0) != 0,
            stability: stability.unwrap_or(0.0),
            elevation_gain_m,
            avg_grade_percent,
            version: version.unwrap_or(1),
            updated_at,
            created_at,
            enrichment,
            rank,
            consensus_state: None,
        };

        // Find and update existing section, or append if new
        if let Some(existing) = self.sections.iter_mut().find(|s| s.id == section_id) {
            *existing = updated_section;
            log::debug!(
                "veloqrs: [refresh_section_in_memory] Updated section {} in memory",
                section_id
            );
        } else {
            self.sections.push(updated_section);
            log::debug!(
                "veloqrs: [refresh_section_in_memory] Added section {} to memory",
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
            "veloqrs: [remove_section_from_memory] Removed section {} from memory",
            section_id
        );
    }

    /// Get section count directly from SQLite (no data loading).
    /// This is O(1) and doesn't require loading sections into memory.
    ///
    /// Counts what the section views show, so it carries the same visibility
    /// predicate `get_section_summaries` and `get_sections_by_type` use. A
    /// disabled or superseded section reaches no list, and every caller here
    /// is asking whether the athlete has sections to look at.
    pub fn get_section_count(&self) -> u32 {
        self.db
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM sections WHERE {}",
                    Self::VISIBLE_FILTER
                ),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    /// Queries SQLite and extracts only summary fields, skipping heavy data like
    /// polylines, activityTraces, and pointDensity.
    pub fn get_section_summaries(&self) -> Vec<SectionSummary> {
        // `visit_count` is denormalised onto the row, kept correct by the
        // `section_activities` recompute triggers, so it needs no GROUP BY here.
        // One junction row is one pass, so it counts traversals; outings are a
        // separate DISTINCT.
        // `activity_count` and `sport_types` are denormalised onto the row and
        // kept by the junction triggers, so the list needs no GROUP BY.
        let mut stmt = match self.db.prepare(&format!(
            "SELECT id, name, sport_type, distance_meters, confidence, scale,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    section_type, representative_activity_id, created_at,
                    is_user_defined, disabled, superseded_by, visit_count,
                    elevation_gain_m, avg_grade_percent, activity_count, sport_types,
                    elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score
             FROM sections
             WHERE {}",
            Self::VISIBLE_FILTER
        )) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "veloqrs: [PersistentEngine] Failed to prepare section summaries query: {}",
                    e
                );
                return Vec::new();
            }
        };

        let mut results: Vec<SectionSummary> = stmt
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

                let visit_count: u32 = row.get::<_, Option<u32>>(16)?.unwrap_or(0);
                let activity_count: u32 = row.get::<_, Option<u32>>(19)?.unwrap_or(0);
                // GROUP_CONCAT order is undefined, so sort for a stable summary.
                let mut sport_types: Vec<String> = row
                    .get::<_, Option<String>>(20)?
                    .unwrap_or_default()
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect();
                sport_types.sort();

                Ok(SectionSummary {
                    id,
                    section_type: row
                        .get::<_, Option<String>>(10)?
                        .unwrap_or_else(|| "auto".to_string()),
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    distance_meters: row.get(3)?,
                    visit_count,
                    activity_count,
                    representative_activity_id: row.get(11)?,
                    confidence: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    scale: row.get(5)?,
                    bounds,
                    elevation_gain_m: row.get(17)?,
                    avg_grade_percent: row.get(18)?,
                    elevation_loss_m: row.get(21)?,
                    max_grade_percent: row.get(22)?,
                    straightness: row.get(23)?,
                    klass: row.get(24)?,
                    is_lift: row.get::<_, Option<i32>>(25)?.unwrap_or(0) != 0,
                    rank_score: row.get(26)?,
                    sport_rank_score: row.get(27)?,
                    created_at: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    sport_types,
                    is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                    disabled: row.get::<_, Option<i32>>(14)?.unwrap_or(0) != 0,
                    superseded_by: row.get(15)?,
                })
            })
            .ok()
            .map(|iter| {
                iter.filter_map(|r| {
                    r.map_err(|e| {
                        log::error!(
                            "veloqrs: [PersistentEngine] get_section_summaries row parse error: {}",
                            e
                        );
                        e
                    })
                    .ok()
                })
                .collect()
            })
            .unwrap_or_default();

        for summary in &mut results {
            self.apply_named_overlay_to_summary(summary);
        }

        // Log section type breakdown for debugging
        let auto_count = results
            .iter()
            .filter(|s| !s.id.starts_with("custom_"))
            .count();
        let custom_count = results.len() - auto_count;
        log::info!(
            "veloqrs: [PersistentEngine] get_section_summaries returned {} summaries ({} auto, {} custom)",
            results.len(),
            auto_count,
            custom_count
        );
        if custom_count > 0 {
            for s in results.iter().filter(|s| s.id.starts_with("custom_")) {
                log::info!(
                    "veloqrs: [PersistentEngine]   custom section: id={}, name={:?}, visits={}, distance={:.0}m",
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
            .filter(|s| Self::summary_covers_sport(s, sport_type))
            .collect()
    }

    /// [`covers_sport`](Self::covers_sport) over a summary, which already
    /// carries every sport its traversals hold in `sport_types`.
    pub(crate) fn summary_covers_sport(s: &SectionSummary, sport: &str) -> bool {
        s.sport_type == sport || s.sport_types.iter().any(|t| t == sport)
    }

    /// Get a single section by ID with LRU caching.
    /// Returns the full FrequentSection with polyline data.
    /// Uses LRU cache to avoid repeated SQLite queries for hot sections.
    ///
    /// Delegates to crud.rs get_section() which handles both auto and custom sections
    /// reliably, then loads activity portions from the junction table.
    pub fn get_section_by_id(&mut self, section_id: &str) -> Option<FrequentSection> {
        // Cached entries bake the named-corridor overlay of their read; drop
        // them whenever the overlay had to recompute.
        // The LRU stores RAW rows; the corridor-name overlay is applied on
        // the way out of every call, so an overlay change can never leave a
        // baked stale name behind in the cache.
        let cached = self.section_cache.get(&section_id.to_string()).cloned();
        if let Some(mut section) = cached {
            log::debug!(
                "veloqrs: [PersistentEngine] get_section_by_id cache hit for {}",
                section_id
            );
            self.apply_named_overlay_to_frequent(&mut section);
            return Some(section);
        }

        // Use crud.rs get_section_raw() which is proven to work for both auto and custom sections
        let section = match self.get_section_raw(section_id) {
            Some(s) => s,
            None => {
                log::info!(
                    "veloqrs: [PersistentEngine] get_section_by_id: section {} not found in DB",
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
            representative_range: None,
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
            elevation_gain_m: section.elevation_gain_m,
            avg_grade_percent: section.avg_grade_percent,
            version: section.version.unwrap_or(1),
            updated_at: section.updated_at,
            created_at: Some(section.created_at),
            enrichment: tracematch::Enrichment {
                elevation_gain_m: section.elevation_gain_m,
                avg_grade_percent: section.avg_grade_percent,
                elevation_loss_m: section.elevation_loss_m,
                max_grade_percent: section.max_grade_percent,
                straightness: section.straightness,
                klass: section
                    .klass
                    .as_deref()
                    .and_then(tracematch::SectionClass::parse),
                is_lift: section.is_lift,
            },
            rank: section.rank_score.map(|score| tracematch::RankFeatures {
                score,
                sport_score: section.sport_rank_score.unwrap_or(score),
                ..Default::default()
            }),
            consensus_state: None,
        };

        // Cache the raw row for future access; overlay applies per read.
        self.section_cache
            .put(section_id.to_string(), frequent.clone());
        log::info!(
            "veloqrs: [PersistentEngine] get_section_by_id found and cached section {} (type={:?})",
            section_id,
            frequent.is_user_defined
        );

        let mut out = frequent;
        self.apply_named_overlay_to_frequent(&mut out);
        Some(out)
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
                    "veloqrs: [PersistentEngine] get_section_portions query failed for {}: {}",
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

    pub fn invalidate_all_section_caches(&mut self) {
        self.section_cache.clear();
    }

    pub fn mark_all_auto_sections_accepted(&mut self) {
        for section in &mut self.sections {
            section.is_user_defined = true;
        }
    }

    /// Get section polyline only (flat coordinates for map rendering).
    /// Returns [lat1, lng1, lat2, lng2, ...] or empty vec if not found.
    pub fn get_section_polyline(&self, section_id: &str) -> Vec<f64> {
        match geometry::stored_line(&self.db, section_id) {
            Ok(points) => points
                .iter()
                .flat_map(|p| [p.latitude, p.longitude])
                .collect(),
            Err(e) => {
                log::error!("veloqrs: get_section_polyline decode error for {section_id}: {e}");
                Vec::new()
            }
        }
    }

    /// Batch-load section polylines for multiple section IDs in a single query.
    /// Returns a map of section_id → flat [lat, lng, lat, lng, ...] coordinates.
    pub(super) fn get_section_polylines_batch(
        &self,
        section_ids: &[&str],
    ) -> HashMap<String, Vec<u8>> {
        if section_ids.is_empty() {
            return HashMap::new();
        }

        let placeholders: Vec<&str> = section_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index
             FROM sections WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "veloqrs: [PersistentEngine] Failed to prepare batch section polyline query: {}",
                    e
                );
                return HashMap::new();
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let results: HashMap<String, Vec<u8>> = stmt
            .query_map(params.as_slice(), |row| {
                let section_id: String = row.get(0)?;
                let polyline_blob: Option<Vec<u8>> = row.get(1)?;
                let polyline_json: Option<String> = row.get(2)?;
                let rep: Option<String> = row.get(3)?;
                let rep_start: Option<u32> = row.get(4)?;
                let rep_end: Option<u32> = row.get(5)?;
                let points = geometry::line(
                    &self.db,
                    polyline_blob.as_deref(),
                    polyline_json.as_deref(),
                    geometry::reference(rep.as_deref(), rep_start, rep_end),
                )
                .unwrap_or_default();
                Ok((section_id, crate::coords::encode(&points)))
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
        let (lap_time, lap_pace) =
            self.load_lap_time(activity_id, start_index, end_index, distance_meters);

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
        let times = if let Some(ts) = self.time_streams.peek(activity_id) {
            Some(ts.clone())
        } else {
            self.db
                .query_row(
                    "SELECT times FROM time_streams WHERE activity_id = ?",
                    rusqlite::params![activity_id],
                    |row| {
                        let bytes: Vec<u8> = row.get(0)?;
                        codec::deserialize::<Vec<u32>>(&bytes)
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
                    s.visit_count,
                    (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0 as center_lat,
                    (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0 as center_lng,
                    s.polyline_json, s.polyline_blob,
                    s.representative_activity_id, s.rep_start_index, s.rep_end_index
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
                    row.get::<_, String>(0)?,          // id
                    row.get::<_, String>(1)?,          // section_type
                    row.get::<_, Option<String>>(2)?,  // name
                    row.get::<_, String>(3)?,          // sport_type
                    row.get::<_, f64>(4)?,             // distance_meters
                    row.get::<_, u32>(5)?,             // visit_count
                    row.get::<_, f64>(6)?,             // center_lat
                    row.get::<_, f64>(7)?,             // center_lng
                    row.get::<_, Option<String>>(8)?,  // polyline_json
                    row.get::<_, Option<Vec<u8>>>(9)?, // polyline_blob
                    row.get::<_, Option<String>>(10)?, // representative_activity_id
                    row.get::<_, Option<u32>>(11)?,    // rep_start_index
                    row.get::<_, Option<u32>>(12)?,    // rep_end_index
                ))
            })
            .ok();

        let mut results: Vec<crate::FfiNearbySectionSummary> = Vec::new();

        if let Some(rows) = rows {
            for row in rows.flatten() {
                let (
                    id,
                    section_type,
                    name,
                    sport_type,
                    distance_meters,
                    visit_count,
                    lat,
                    lng,
                    polyline_json,
                    polyline_blob,
                    rep,
                    rep_start,
                    rep_end,
                ) = row;
                let dist = haversine_distance(center_lat, center_lng, lat, lng);
                if dist > radius_meters {
                    continue;
                }

                let encoded_polyline = geometry::line(
                    &self.db,
                    polyline_blob.as_deref(),
                    polyline_json.as_deref(),
                    geometry::reference(rep.as_deref(), rep_start, rep_end),
                )
                .map(|points| crate::coords::encode(&points))
                .unwrap_or_default();

                results.push(crate::FfiNearbySectionSummary {
                    id,
                    section_type,
                    name,
                    sport_type,
                    distance_meters,
                    visit_count,
                    center_distance_meters: dist,
                    encoded_polyline,
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
        self.write_catalogue(&[], false)
    }

    /// [`save_sections`](Self::save_sections) plus the lifecycle events the
    /// identity apply fired this step: geometry versions and history rows land
    /// in the SAME transaction as the catalogue and the registry blob, so a
    /// rolled-back save leaves no orphan narrative behind.
    pub(super) fn save_sections_with_events(
        &self,
        events: &[identity::SectionLifecycleEvent],
    ) -> SqlResult<()> {
        self.write_catalogue(events, true)
    }

    /// `from_detect` separates a detection apply from the ordinary saves a
    /// mutation makes. Only a detect re-cuts geometry, so only a detect can
    /// carry the catalogue from one detector generation to the next.
    fn write_catalogue(
        &self,
        events: &[identity::SectionLifecycleEvent],
        from_detect: bool,
    ) -> SqlResult<()> {
        let tx = self.db.unchecked_transaction()?;

        // The detector that cut what is on disk no longer matches the live
        // one, so every shape it drew is about to be replaced by a different
        // algorithm's answer. Keep each one as a milestone and say so, before
        // the wipe below takes them. The row set is the wipe's own predicate:
        // a custom, accepted or disabled section keeps its line through a
        // detector change and has nothing to explain.
        if from_detect && let Some((from, to)) = self.detector_generation_change() {
            let mut stmt = tx.prepare(
                "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                        rep_start_index, rep_end_index
                 FROM sections
                 WHERE section_type = 'auto' AND original_polyline_json IS NULL
                   AND is_user_defined = 0 AND disabled = 0",
            )?;
            type Prior = (
                String,
                Option<Vec<u8>>,
                Option<String>,
                Option<String>,
                Option<u32>,
                Option<u32>,
            );
            let priors: Vec<Prior> = stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for (id, blob, json, rep_id, start, end) in priors {
                // The blob is a cache. The outgoing shape is the one thing the
                // milestone exists to keep, so a cleared cache is rebuilt from
                // the triple rather than milestoned as an empty line.
                let reference = geometry::reference(rep_id.as_deref(), start, end);
                let prior = geometry::line(&tx, blob.as_deref(), json.as_deref(), reference)
                    .unwrap_or_default();
                history::record_algorithm_change_on(&tx, &id, Some(&prior), Some(&from), &to)?;
            }
        }

        // Birth dates of every current row, read BEFORE the wipe. New payloads
        // stamp created_at at mint, but payloads persisted before that change
        // carry None forever (the registry blob round-trips it); without this
        // fallback such rows would re-stamp on every save.
        let existing_created: HashMap<String, String> = {
            let mut stmt =
                tx.prepare("SELECT id, created_at FROM sections WHERE created_at IS NOT NULL")?;
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // Exclusions are user decisions living on junction rows the wipe
        // below cascades away. Read them first so the re-insert can put
        // them back on the surviving section ids.
        let carried_exclusions = capture_auto_exclusions(&tx)?;

        // Clear existing auto sections (keep custom, trimmed, and accepted
        // sections, and disabled ones, whose row is retained so enable can
        // restore it with members intact; the disabled corridor is separately
        // suppressed via section_intents, so sparing the row cannot resurrect it).
        // Deleting the section cascades its section_activities rows (FK ON DELETE
        // CASCADE), so this needs no separate junction delete.
        tx.execute(
            "DELETE FROM sections WHERE section_type = 'auto' AND original_polyline_json IS NULL AND is_user_defined = 0 AND disabled = 0",
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

        // Names on the rows the wipe spared, plus names carried in memory,
        // which the loop below writes back unchanged.
        let mut taken_numbers = taken_section_numbers(
            existing_names
                .values()
                .map(String::as_str)
                .chain(self.sections.iter().filter_map(|s| s.name.as_deref())),
            &section_word,
        );

        // Insert auto-detected sections with new schema
        let mut section_stmt = tx.prepare(
            "INSERT INTO sections (
                id, section_type, name, sport_type, polyline_json, distance_meters,
                representative_activity_id, confidence, observation_count, average_spread,
                point_density_json, scale, version, is_user_defined, stability, created_at, updated_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                consensus_state_blob, polyline_blob, point_density_blob,
                elevation_gain_m, avg_grade_percent,
                rep_start_index, rep_end_index, geometry_source,
                elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score
            ) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )?;
        // OR REPLACE: two passes of one activity can share a `start_index` on a
        // short section, and a UNIQUE violation would abort the whole apply.
        let mut junction_stmt = tx
            .prepare("INSERT OR REPLACE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")?;

        // Persist only the auto (non-user-defined) catalogue. Custom and accepted
        // sections are durable rows the wipe above spares and are managed by their
        // own CRUD paths; since they now also live in the in-memory `self.sections`
        // (so the matcher and get_sections() see them), they must be filtered out
        // here or they would be re-inserted under 'auto', a UNIQUE-id collision.
        let mut sorted_sections: Vec<&FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .collect();
        // Section id closes the order: it is unique, so name minting below
        // assigns the same number to the same section on every run.
        sorted_sections.sort_by(|a, b| {
            a.sport_type
                .cmp(&b.sport_type)
                .then_with(|| b.activity_ids.len().cmp(&a.activity_ids.len()))
                .then_with(|| a.id.cmp(&b.id))
        });

        // Track next available number for each sport type (for sequential assignment)
        let mut sport_counters: HashMap<String, u32> = HashMap::new();

        // Pre-fetch all time streams the upcoming portion loop will need.
        // Replaces a per-portion `SELECT times FROM time_streams WHERE
        // activity_id = ?` (~0.1-0.2 ms each, ~hundreds of portions per
        // detection batch) with one `WHERE activity_id IN (...)` query.
        // Activities already in `self.time_streams` are skipped so we only
        // pay for cache misses.
        let db_time_streams: HashMap<String, Vec<u32>> = {
            let mut needed: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for section in &sorted_sections {
                for portion in &section.activity_portions {
                    if !self.time_streams.contains(&portion.activity_id) {
                        needed.insert(portion.activity_id.as_str());
                    }
                }
            }
            if needed.is_empty() {
                HashMap::new()
            } else {
                let mut map: HashMap<String, Vec<u32>> = HashMap::with_capacity(needed.len());
                let placeholders = std::iter::repeat("?")
                    .take(needed.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "SELECT activity_id, times FROM time_streams WHERE activity_id IN ({})",
                    placeholders
                );
                let ids: Vec<&str> = needed.iter().copied().collect();
                let params_vec: Vec<&dyn rusqlite::ToSql> =
                    ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                if let Ok(mut stmt) = tx.prepare(&sql) {
                    if let Ok(rows) = stmt.query_map(params_vec.as_slice(), |row| {
                        let id: String = row.get(0)?;
                        let bytes: Vec<u8> = row.get(1)?;
                        let stream = codec::deserialize::<Vec<u32>>(&bytes)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?;
                        Ok((id, stream))
                    }) {
                        for row in rows.flatten() {
                            map.insert(row.0, row.1);
                        }
                    }
                }
                map
            }
        };

        for section in sorted_sections {
            // The portions that will actually become junction rows. A
            // section with none of them takes zero rows, so no visit_count
            // trigger fires and the catalogue gains a "0 visits" card over an
            // empty detail screen. Skip the row entirely rather than persist it.
            // Detection prunes these before the save; this is the backstop for
            // any other caller.
            let surviving: Vec<&tracematch::SectionPortion> = section
                .activity_portions
                .iter()
                .filter(|p| self.activity_metadata.contains_key(&p.activity_id))
                .collect();
            if surviving.is_empty() {
                log::warn!(
                    "veloqrs: [save_sections] skipping section {} - {} activity_ids, {} \
                     portions, none of them pooled",
                    section.id,
                    section.activity_ids.len(),
                    section.activity_portions.len(),
                );
                continue;
            }

            // Blob is the authoritative geometry; only legacy rows carry real
            // JSON, which readers use as a fallback.
            let polyline_blob = codec::serialize_points(&section.polyline)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
            let point_density_blob = if section.point_density.is_empty() {
                None
            } else {
                Some(
                    codec::serialize(&section.point_density)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?,
                )
            };
            let created_at = section
                .created_at
                .clone()
                .or_else(|| existing_created.get(&section.id).cloned())
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
                    let number = next_section_number(&mut taken_numbers, counter);
                    Some(format!("{} {}", section_word, number))
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

            // Serialise the consensus accumulator if present, as a
            // MessagePack blob (smaller + faster than JSON; matches the
            // gps_tracks/signatures convention). None → NULL, letting the
            // next incremental touch lazily backfill from current traces.
            let consensus_state_blob = section
                .consensus_state
                .as_ref()
                .and_then(|acc| codec::serialize_gps_composite(acc).ok());

            // A range is only truth alongside the activity it indexes. Without
            // one the line is an average, which is a slice of nothing.
            let geometry_source = if section.representative_range.is_some()
                && !section.representative_activity_id.is_empty()
            {
                history::SOURCE_EXACT
            } else {
                history::SOURCE_CONSENSUS
            };
            section_stmt.execute(params![
                section.id,
                name_to_save,
                section.sport_type,
                codec::NO_POLYLINE_JSON,
                section.distance_meters,
                if section.representative_activity_id.is_empty() {
                    None
                } else {
                    Some(&section.representative_activity_id)
                },
                section.confidence,
                section.observation_count,
                section.average_spread,
                None::<String>, // point_density_json: legacy column, blob is authoritative
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
                consensus_state_blob,
                polyline_blob,
                point_density_blob,
                section.elevation_gain_m,
                section.avg_grade_percent,
                section.representative_range.map(|(start, _)| start),
                section.representative_range.map(|(_, end)| end),
                geometry_source,
                section.enrichment.elevation_loss_m,
                section.enrichment.max_grade_percent,
                section.enrichment.straightness,
                section
                    .enrichment
                    .klass
                    .map(tracematch::SectionClass::as_str),
                i32::from(section.enrichment.is_lift),
                section.rank.as_ref().map(|r| r.score),
                section.rank.as_ref().map(|r| r.sport_score),
            ])?;

            // Populate junction table with full portion details and cached performance metrics.
            // Time streams come from `self.time_streams` (warm cache) or
            // the pre-fetched `db_time_streams` batch above (cold).
            // `surviving` already dropped the portions whose activity the pool no
            // longer holds. The activity_id foreign key would reject those and
            // abort the entire apply, a single stale carried member bricking
            // detection for the session.
            for portion in &surviving {
                let times = self
                    .time_streams
                    .peek(&portion.activity_id)
                    .map(|v| v.as_slice())
                    .or_else(|| {
                        db_time_streams
                            .get(&portion.activity_id)
                            .map(|v| v.as_slice())
                    });

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

        // Sections whose id survived the re-detect get their exclusions
        // back; a section that died has no rows and the updates are no-ops.
        reapply_auto_exclusions(&tx, &carried_exclusions)?;

        // Write the identity-registry blob in THIS transaction so the
        // registry and the catalogue it describes commit (or roll back) together.
        if let Some(blob) = self.section_identity_blob() {
            tx.execute(
                "INSERT INTO identity_state (key, blob, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
                params![identity::SECTION_IDENTITY_KEY, blob],
            )?;
        }

        // The emitter's fired lifecycle events, durable with the
        // catalogue they narrate. A geometry-bearing event versions its
        // polyline first and the history row links the version.
        for event in events {
            let version = match &event.geometry {
                Some(polyline) => Some(history::record_geometry_on(
                    &tx,
                    &event.real_id,
                    polyline,
                    false,
                    event
                        .reference
                        .as_ref()
                        .map(|(id, start, end)| (id.as_str(), *start, *end)),
                )?),
                None => None,
            };
            history::append_history_on(
                &tx,
                &event.real_id,
                event.kind,
                event.details.as_deref(),
                version,
                None,
            )?;
            // A re-cut re-bases the PR on the new extent. When that moves
            // the record, the ledger says so beside the re-cut, labelled
            // against the current extent: the old time was over other ground.
            if event.kind == "recut" {
                history::record_pr_rebase_on(&tx, &event.real_id, event.details.as_deref())?;
            }
        }

        // Provenance of the catalogue this transaction stores: which detector
        // cut it, and under which parameters. Only a detect moves it. A
        // mutation save leaves the geometry of every other section alone, so
        // advancing the marker there would retire the one-shot capture above
        // without anything having been re-cut.
        if from_detect {
            for (key, value) in [
                (CATALOGUE_METHOD_KEY, DETECTOR_METHOD.to_string()),
                (
                    CATALOGUE_CONFIG_DIGEST_KEY,
                    section_config_digest(&self.section_config),
                ),
            ] {
                tx.execute(
                    "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                    params![key, value],
                )?;
            }
        }

        tx.commit()?;

        Ok(())
    }

    /// The detection method that cut the stored catalogue, absent until a save
    /// has run under a build that records it.
    pub fn catalogue_detection_method(&self) -> Option<String> {
        self.schema_info_value(CATALOGUE_METHOD_KEY)
    }

    /// [`section_config_digest`] of the config the stored catalogue ran under.
    pub fn catalogue_config_digest(&self) -> Option<String> {
        self.schema_info_value(CATALOGUE_CONFIG_DIGEST_KEY)
    }

    fn schema_info_value(&self, key: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT value FROM schema_info WHERE key = ?",
                params![key],
                |row| row.get(0),
            )
            .ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_number_reads_current_and_legacy_patterns() {
        assert_eq!(section_name_number("Section 7", "Section"), Some(7));
        assert_eq!(section_name_number("Ride Section 7", "Section"), Some(7));
        assert_eq!(section_name_number("Lakeside loop", "Section"), None);
        assert_eq!(section_name_number("Section", "Section"), None);
    }

    #[test]
    fn carried_names_are_taken_so_minting_skips_them() {
        let stored = ["Section 1"];
        let carried = ["Section 2", "Riverside"];
        let mut taken = taken_section_numbers(stored.into_iter().chain(carried), "Section");
        assert_eq!(taken, HashSet::from([1, 2]));

        let mut counter = 0;
        assert_eq!(next_section_number(&mut taken, &mut counter), 3);
        assert_eq!(next_section_number(&mut taken, &mut counter), 4);
    }

    /// Scenario: the DELETE behind a forced re-detect fails, after the config
    /// that provoked it has already been persisted.
    /// Expected behaviour: the evidence cache goes anyway, the processed set is
    /// left matching disk, and the clear is retried at the next detect.
    #[test]
    fn a_failed_processed_clear_drops_the_cache_and_is_retried() {
        let mut engine = crate::persistence::PersistentEngine::in_memory().unwrap();
        engine
            .save_processed_activity_ids(&["a".to_string(), "b".to_string()])
            .unwrap();
        engine.cache_folded_ids.insert("a".to_string());

        engine
            .db
            .execute("DROP TABLE processed_activities", [])
            .unwrap();
        engine.clear_processed_activity_ids();

        assert!(engine.processed_clear_pending());
        assert_eq!(engine.processed_activity_ids.len(), 2);
        assert_eq!(engine.evidence_cache_folded_count(), 0);

        engine
            .db
            .execute(
                "CREATE TABLE processed_activities (activity_id TEXT PRIMARY KEY)",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO processed_activities (activity_id) VALUES ('a'), ('b')",
                [],
            )
            .unwrap();

        engine.retry_pending_processed_clear();

        assert!(!engine.processed_clear_pending());
        assert!(engine.processed_activity_ids.is_empty());
        let remaining: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM processed_activities", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn retry_is_a_no_op_when_no_clear_is_owed() {
        let mut engine = crate::persistence::PersistentEngine::in_memory().unwrap();
        engine
            .save_processed_activity_ids(&["a".to_string()])
            .unwrap();

        engine.retry_pending_processed_clear();

        assert!(!engine.processed_clear_pending());
        assert_eq!(engine.processed_activity_ids.len(), 1);
    }
}
