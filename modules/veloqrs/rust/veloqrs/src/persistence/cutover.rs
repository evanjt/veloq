//! Detector cutover: one-time migration from Corridor to Unified.
//!
//! The compiled default is meaningless for existing users: `load()` restores
//! the whole `__section_config_json` blob including `detection_method`, so a
//! change to `#[default]` never reaches a device that has saved its config.
//! This module bridges that gap with a resumable, reversible cutover driven
//! by a persisted token.
//!
//! Sequence: archive → commit switch + token → cold detect → diff.
//! Revert: restore archive as pinned sections, config back to Corridor.

use crate::persistence::{
    PersistentRouteEngine, codec, settings_keys, suspend_detection, with_persistent_engine,
};
use log::info;
use rusqlite::params;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tracematch::sections::DetectionMethod;

/// The id of the current cutover. Absent in settings means never cut over.
/// Equal means done. Anything else means a future or reverted cutover.
const CUTOVER_ID: &str = "unified-1";

/// Settings key for the cutover token.
const CUTOVER_KEY: &str = "__detector_cutover";

/// Settings key for the serialised diff payload (JSON).
const CUTOVER_DIFF_KEY: &str = "__detector_cutover_diff";

/// Sentinel written on revert, so the cutover does not re-fire.
const CUTOVER_REVERTED: &str = "reverted";

/// Written before the detect and promoted to `CUTOVER_ID` only once the diff
/// is durable. A token found in this state means a previous run died partway:
/// the config already says Unified, so the method check cannot detect it, and
/// without this the install would sit on a half-finished migration forever.
const CUTOVER_INFLIGHT: &str = "unified-1-inflight";

static CUTOVER_RUNNING: AtomicBool = AtomicBool::new(false);
static CUTOVER_PENDING: Mutex<Option<bool>> = Mutex::new(None);

// ───────────────────────────────────────────────────────────────────
// State queries
// ───────────────────────────────────────────────────────────────────

/// Whether the cutover has not yet completed. Populated by `load()`.
pub fn cutover_pending() -> bool {
    CUTOVER_PENDING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .unwrap_or(false)
}

/// Whether a cutover run is in flight.
pub fn cutover_running() -> bool {
    CUTOVER_RUNNING.load(Ordering::SeqCst)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CutoverState {
    /// Token absent or unrecognised: never cut over.
    Never,
    /// A previous run committed the switch and died before finishing.
    InFlight,
    /// Token matches CUTOVER_ID: already done.
    Done,
    /// Token is the reverted sentinel: user rolled back.
    Reverted,
}

impl PersistentRouteEngine {
    /// Called from `load()`. Reads the cutover token and sets the
    /// process-global pending flag. Nothing slow, nothing fallible beyond
    /// a missing settings table (which returns None).
    pub(super) fn check_cutover_state(&self) {
        // Recomputed per engine, not accumulated: an engine re-initialised
        // onto another database file (a restore, a quarantine) must not
        // inherit the previous file's answer.
        let owed = self.cutover_is_owed();
        *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(owed);
        if owed {
            info!("tracematch: [cutover] Cutover to Unified is owed");
        }
    }

    fn cutover_state_from_db(&self) -> CutoverState {
        match self.get_setting(CUTOVER_KEY) {
            Ok(Some(ref v)) if v == CUTOVER_ID => CutoverState::Done,
            Ok(Some(ref v)) if v == CUTOVER_REVERTED => CutoverState::Reverted,
            Ok(Some(ref v)) if v == CUTOVER_INFLIGHT => CutoverState::InFlight,
            _ => CutoverState::Never,
        }
    }

    /// Whether the migration still has work to do.
    ///
    /// An in-flight token is always owed: its config already reads Unified, so
    /// the method check below would wave it through as finished when in fact
    /// it died mid-run. A never-seen token is owed only while the live config
    /// is still Corridor, so a user who chose Unified by hand is left alone.
    pub fn cutover_is_owed(&self) -> bool {
        match self.cutover_state_from_db() {
            CutoverState::InFlight => true,
            CutoverState::Never => self.section_config.detection_method != DetectionMethod::Unified,
            CutoverState::Done | CutoverState::Reverted => false,
        }
    }
}

/// (min_lat, max_lat, min_lng, max_lng) over a polyline. None on an empty one,
/// which leaves the columns NULL exactly as an undrawable section has them.
fn bounds_of(points: &[tracematch::GpsPoint]) -> Option<(f64, f64, f64, f64)> {
    let first = points.first()?;
    let mut bounds = (
        first.latitude,
        first.latitude,
        first.longitude,
        first.longitude,
    );
    for p in points.iter().skip(1) {
        bounds.0 = bounds.0.min(p.latitude);
        bounds.1 = bounds.1.max(p.latitude);
        bounds.2 = bounds.2.min(p.longitude);
        bounds.3 = bounds.3.max(p.longitude);
    }
    Some(bounds)
}

// ───────────────────────────────────────────────────────────────────
// Archive
// ───────────────────────────────────────────────────────────────────

impl PersistentRouteEngine {
    /// Step 1: snapshot every auto section about to be wiped, and its
    /// members. The row predicate is `write_catalogue`'s DELETE predicate:
    /// exactly the rows the coming detect destroys, no more.
    ///
    /// Members ride along because the wipe cascades `section_activities`
    /// away. Bounds ride along because the restore needs them: the accepted
    /// dedup in `write_catalogue` keys on `bounds_min_lat IS NOT NULL`, and
    /// that dedup is the mechanism that stops a restored catalogue being
    /// re-detected alongside itself.
    fn archive_current_catalogue(&self) -> rusqlite::Result<u32> {
        let tx = self.db.unchecked_transaction()?;

        // A re-run replaces its own snapshot rather than appending to it.
        tx.execute(
            "DELETE FROM section_catalogue_archive WHERE token = ?",
            params![CUTOVER_ID],
        )?;
        tx.execute(
            "DELETE FROM section_catalogue_archive_members WHERE token = ?",
            params![CUTOVER_ID],
        )?;

        let count = tx.execute(
            "INSERT INTO section_catalogue_archive
                 (token, section_id, name, sport_type, polyline_blob,
                  polyline_json, distance_meters, visit_count, created_at,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             SELECT ?, id, name, sport_type, polyline_blob,
                    polyline_json, distance_meters, visit_count, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
             FROM sections
             WHERE section_type = 'auto'
               AND original_polyline_json IS NULL
               AND is_user_defined = 0
               AND disabled = 0",
            params![CUTOVER_ID],
        )?;

        // Every portion, excluded ones included: an exclusion is a user
        // decision and restoring without it would silently re-admit a
        // traversal the user threw out.
        let members = tx.execute(
            "INSERT INTO section_catalogue_archive_members
                 (token, section_id, activity_id, direction, start_index,
                  end_index, distance_meters, lap_time, lap_pace, excluded, avg_hr)
             SELECT ?, sa.section_id, sa.activity_id, sa.direction, sa.start_index,
                    sa.end_index, sa.distance_meters, sa.lap_time, sa.lap_pace,
                    sa.excluded, sa.avg_hr
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE s.section_type = 'auto'
               AND s.original_polyline_json IS NULL
               AND s.is_user_defined = 0
               AND s.disabled = 0",
            params![CUTOVER_ID],
        )?;

        tx.commit()?;
        info!(
            "tracematch: [cutover] Archived {} auto sections and {} members under token '{}'",
            count, members, CUTOVER_ID
        );
        Ok(count as u32)
    }

    /// Step 2: switch the persisted config to Unified and write the token,
    /// atomically with the archive.
    fn commit_switch(&mut self) -> rusqlite::Result<()> {
        let mut config = self.section_config.clone();
        config.detection_method = DetectionMethod::Unified;
        // Adopt the canonical Unified field values. These must match
        // UNIFIED_CONFIG on the TS side.
        config.pool_sports = true;

        let json = serde_json::to_string(&config).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
        })?;

        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![settings_keys::SECTION_CONFIG_JSON, json],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![
                settings_keys::SECTION_DETECTION_METHOD,
                config.detection_method.as_str()
            ],
        )?;
        // In-flight, not done: the detect and the diff have not happened yet.
        // Promoted by `finish_cutover` once the diff is durable.
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_INFLIGHT],
        )?;
        // Cleared inside the switch, so a crash before the detect cannot leave
        // a full processed set that would short-circuit the next detect into
        // re-emitting the Corridor catalogue under a Unified label.
        tx.execute("DELETE FROM processed_activities", [])?;
        tx.commit()?;

        self.processed_activity_ids.clear();
        // The processed set and the evidence cache are two shadows of the same
        // state, so they clear in lockstep and the detect below cold-rebatches
        // under the new detector.
        self.invalidate_evidence_cache();
        self.section_config = config;
        info!("tracematch: [cutover] Committed switch to Unified, token in flight");
        Ok(())
    }

    /// Promote the in-flight token once the diff is stored. Until this runs,
    /// the cutover is owed and re-runs from the top on the next launch.
    fn finish_cutover(&self) -> rusqlite::Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_ID],
        )?;
        info!("tracematch: [cutover] Token promoted to '{}'", CUTOVER_ID);
        Ok(())
    }

    /// Build the diff payload comparing archive (old catalogue) to the
    /// current live catalogue. Serialised as JSON into the settings table
    /// so the card can show it across restarts.
    fn build_cutover_diff(&self) -> rusqlite::Result<String> {
        // Load the archive as FrequentSection stand-ins (polyline + id + name +
        // sport + visits + distance). We only need the fields `diff_catalogues`
        // reads.
        let archived = self.load_archived_sections(CUTOVER_ID)?;
        let live: Vec<&tracematch::sections::FrequentSection> = self
            .sections
            .iter()
            .filter(|s| s.id.starts_with("sec_") && !s.is_user_defined)
            .collect();

        // Reuse diff_catalogues with archive = old, live = new.
        let (counts, sections) = super::sections::preview::diff_catalogues_public(&live, &archived);

        let payload = serde_json::json!({
            "token": CUTOVER_ID,
            "counts": counts,
            "sections": sections,
        });
        let json = serde_json::to_string(&payload).unwrap_or_default();

        self.set_setting(CUTOVER_DIFF_KEY, &json)
            .unwrap_or_else(|e| {
                log::warn!("tracematch: [cutover] Failed to persist diff: {}", e);
            });

        info!(
            "tracematch: [cutover] Diff stored: {} current, {} new, {} changed, {} gone",
            counts.current, counts.new, counts.changed, counts.gone
        );
        Ok(json)
    }

    fn load_archived_sections(
        &self,
        token: &str,
    ) -> rusqlite::Result<Vec<tracematch::sections::FrequentSection>> {
        let mut stmt = self.db.prepare(
            "SELECT section_id, name, sport_type, polyline_blob, polyline_json,
                    distance_meters, visit_count, created_at
             FROM section_catalogue_archive
             WHERE token = ?
             ORDER BY section_id",
        )?;
        let rows = stmt.query_map(params![token], |row| {
            let id: String = row.get(0)?;
            let polyline_blob: Option<Vec<u8>> = row.get(3)?;
            let polyline_json: Option<String> = row.get(4)?;
            let polyline =
                codec::decode_polyline_row(polyline_blob.as_deref(), polyline_json.as_deref())
                    .unwrap_or_default();
            Ok(tracematch::sections::FrequentSection {
                id,
                name: row.get(1)?,
                sport_type: row.get(2)?,
                polyline,
                distance_meters: row.get(5)?,
                visit_count: row.get::<_, Option<u32>>(6)?.unwrap_or(0),
                created_at: row.get(7)?,
                representative_activity_id: String::new(),
                representative_range: None,
                activity_ids: Vec::new(),
                activity_portions: Vec::new(),
                route_ids: Vec::new(),
                activity_traces: std::collections::HashMap::new(),
                confidence: 0.0,
                observation_count: 0,
                average_spread: 0.0,
                point_density: Vec::new(),
                scale: None,
                is_user_defined: false,
                stability: 0.0,
                elevation_gain_m: None,
                avg_grade_percent: None,
                version: 1,
                updated_at: None,
                consensus_state: None,
            })
        })?;
        rows.collect()
    }

    /// Restore the archived catalogue as pinned (accepted) sections and
    /// switch the config back to Corridor. The token becomes `reverted` so
    /// the cutover does not re-fire.
    pub fn restore_from_archive(&mut self) -> rusqlite::Result<u32> {
        let archived = self.load_archived_sections(CUTOVER_ID)?;

        let tx = self.db.unchecked_transaction()?;

        // Take the Unified catalogue out first. Without this both catalogues
        // stand at once: the ids do not collide (pooled Unified mints
        // `sec_all_*`, the archive holds `sec_ride_*`), so every uncarried
        // Unified row would survive beside the restored one over the same
        // ground. The predicate is `write_catalogue`'s, so a custom, accepted
        // or disabled row is spared exactly as it is by a detect.
        tx.execute(
            "DELETE FROM sections
             WHERE section_type = 'auto' AND original_polyline_json IS NULL
               AND is_user_defined = 0 AND disabled = 0",
            [],
        )?;

        // A carried id can survive the delete as a pinned row the user
        // accepted after the cutover. Its geometry and its portions belong to
        // the Unified cut, so replacing the row wholesale is what puts the
        // archived state back; the cascade takes its stale portions with it.
        let mut clear_one = tx.prepare("DELETE FROM sections WHERE id = ?")?;
        for s in &archived {
            clear_one.execute(params![s.id])?;
        }
        drop(clear_one);

        // Bounds come back with the row. `write_catalogue` dedupes fresh auto
        // detections against accepted bounds and skips any row whose
        // `bounds_min_lat` is NULL, so a restore without them switches off the
        // very guard that stops the next detect re-cutting this ground.
        let mut insert = tx.prepare(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json,
                  polyline_blob, distance_meters, visit_count, is_user_defined,
                  created_at, updated_at,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), ?, ?, ?, ?)",
        )?;

        let mut restored = 0u32;
        for s in &archived {
            let json = serde_json::to_string(&s.polyline).unwrap_or_else(|_| "[]".into());
            let blob = codec::serialize_points(&s.polyline)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
            let bounds = bounds_of(&s.polyline);
            let affected = insert.execute(params![
                s.id,
                s.name,
                s.sport_type,
                json,
                blob,
                s.distance_meters,
                s.visit_count,
                s.created_at,
                bounds.map(|b| b.0),
                bounds.map(|b| b.1),
                bounds.map(|b| b.2),
                bounds.map(|b| b.3),
            ])?;
            restored += affected as u32;
        }
        drop(insert);

        // The members, or the restored rows are geometry with no traversals:
        // a card claiming visits over a detail screen listing none.
        let restored_members = tx.execute(
            "INSERT OR REPLACE INTO section_activities
                 (section_id, activity_id, direction, start_index, end_index,
                  distance_meters, lap_time, lap_pace, excluded, avg_hr)
             SELECT m.section_id, m.activity_id, m.direction, m.start_index,
                    m.end_index, m.distance_meters, m.lap_time, m.lap_pace,
                    m.excluded, m.avg_hr
             FROM section_catalogue_archive_members m
             WHERE m.token = ?
               AND m.section_id IN (SELECT id FROM sections)
               AND m.activity_id IN (SELECT id FROM activities)",
            params![CUTOVER_ID],
        )?;

        // The processed set still names every activity the Unified detect
        // folded. Left alone, the next detect short-circuits and re-emits that
        // catalogue instead of cutting a Corridor one.
        tx.execute("DELETE FROM processed_activities", [])?;

        // Switch config back to Corridor.
        let mut config = self.section_config.clone();
        config.detection_method = DetectionMethod::Corridor;
        let config_json = serde_json::to_string(&config).unwrap_or_default();
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![settings_keys::SECTION_CONFIG_JSON, config_json],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![
                settings_keys::SECTION_DETECTION_METHOD,
                config.detection_method.as_str()
            ],
        )?;
        // Mark as reverted so the cutover does not re-fire.
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_REVERTED],
        )?;

        tx.commit()?;

        self.section_config = config;
        *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(false);

        // Reload so in-memory state sees the restored, pinned sections.
        if let Err(e) = self.load_sections() {
            log::warn!(
                "tracematch: [cutover] Failed to reload sections after restore: {}",
                e
            );
        }

        info!(
            "tracematch: [cutover] Restored {} sections and {} members from archive, config back to Corridor",
            restored, restored_members
        );
        Ok(restored)
    }

    /// The stored diff payload, if any. None before the cutover has run.
    pub fn cutover_diff(&self) -> Option<String> {
        self.get_setting(CUTOVER_DIFF_KEY).ok().flatten()
    }
}

// ───────────────────────────────────────────────────────────────────
// The run
// ───────────────────────────────────────────────────────────────────

/// Run the full cutover: archive, switch, cold detect, diff.
/// Shaped on `run_elevation_backfill`: suspends detection, holds the
/// guard across the whole pass, fires one terminal re-cut.
pub fn run_cutover() -> Result<String, String> {
    if CUTOVER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("cutover already running".into());
    }

    // Ensure we clear the flag on all exit paths.
    struct RunGuard;
    impl Drop for RunGuard {
        fn drop(&mut self) {
            CUTOVER_RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _guard = RunGuard;

    // Check whether the cutover is actually owed.
    let owed = with_persistent_engine(|e| e.cutover_is_owed()).ok_or("no engine")?;
    if !owed {
        *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(false);
        return Ok("not_owed".into());
    }

    // Refuses every NEW start. A worker already in the slot is untouched by
    // it, which is what the drain below is for.
    let _suspend = suspend_detection();

    // A Corridor run started before the suspension is still live, and
    // `poll_detection_once` applies whatever it returns. Left alone it lands
    // its Corridor catalogue after the cutover has finished, over a config
    // and a token that both say Unified. Drive it to its end first; the
    // suspension keeps the slot empty once it drains.
    drain_detection_slot()?;

    // Step 1: archive. Additive and idempotent per token, so a crash here
    // leaves the user on Corridor with an intact catalogue and the cutover
    // still owed.
    let archived = with_persistent_engine(|e| e.archive_current_catalogue())
        .ok_or("no engine")?
        .map_err(|e| format!("archive failed: {}", e))?;
    info!("tracematch: [cutover] Archived {} sections", archived);

    // Step 2: commit the switch. Config, in-flight token and the cleared
    // processed set land together, so a crash after this point resumes rather
    // than stranding the install on a half-migrated catalogue.
    with_persistent_engine(|e| e.commit_switch())
        .ok_or("no engine")?
        .map_err(|e| format!("switch failed: {}", e))?;

    // Step 3: cold detect through the unchecked path, since the guard we hold
    // would otherwise refuse our own run.
    let handle =
        with_persistent_engine(|e| e.detect_sections_background_unchecked()).ok_or("no engine")?;

    // Drive the detect to completion.
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.ok_or("detect failed")?;

    with_persistent_engine(|e| {
        e.apply_sections_with_cache(sections, cache_update)
            .map_err(|err| format!("apply failed: {}", err))?;
        e.save_processed_activity_ids(&processed_ids)
            .map_err(|err| format!("save processed ids failed: {}", err))?;
        Ok::<(), String>(())
    })
    .ok_or("no engine")?
    .map_err(|e| format!("apply: {}", e))?;

    // Step 4: diff, then promote the token. The promotion is last, so any
    // failure above leaves the token in flight and the whole run is retried
    // from the top on the next launch.
    let diff = with_persistent_engine(|e| e.build_cutover_diff())
        .ok_or("no engine")?
        .map_err(|e| format!("diff failed: {}", e))?;

    with_persistent_engine(|e| e.finish_cutover())
        .ok_or("no engine")?
        .map_err(|e| format!("token promotion failed: {}", e))?;

    *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(false);

    info!("tracematch: [cutover] Cutover complete");
    Ok(diff)
}

/// Drive any run already holding the detection slot to its end, applying its
/// result through the shared poll. Mirrors the backfill's drain: with the
/// suspension held, an emptied slot stays empty.
fn drain_detection_slot() -> Result<(), String> {
    use crate::objects::detection::{DetectionPoll, poll_detection_once};
    const POLL: std::time::Duration = std::time::Duration::from_millis(100);

    loop {
        match poll_detection_once() {
            Ok(DetectionPoll::Idle) => return Ok(()),
            Ok(DetectionPoll::Running) => std::thread::sleep(POLL),
            Ok(DetectionPoll::Applied) | Ok(DetectionPoll::Died) => continue,
            Err(e) => return Err(format!("could not drain the detection slot: {}", e)),
        }
    }
}
