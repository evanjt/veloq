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

#[derive(Debug, Clone)]
pub enum CutoverState {
    /// Token absent or unrecognised: never cut over, owed now.
    Pending,
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
        let state = self.cutover_state_from_db();
        let pending = matches!(state, CutoverState::Pending);
        *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(pending);
        if pending {
            info!("tracematch: [cutover] Cutover to Unified is pending");
        }
    }

    fn cutover_state_from_db(&self) -> CutoverState {
        match self.get_setting(CUTOVER_KEY) {
            Ok(Some(ref v)) if v == CUTOVER_ID => CutoverState::Done,
            Ok(Some(ref v)) if v == CUTOVER_REVERTED => CutoverState::Reverted,
            _ => CutoverState::Pending,
        }
    }

    /// True when the cutover token is absent or unrecognised AND the live
    /// config is still on Corridor. A user who has already manually selected
    /// Unified does not need the migration.
    pub fn cutover_is_owed(&self) -> bool {
        matches!(self.cutover_state_from_db(), CutoverState::Pending)
            && self.section_config.detection_method != DetectionMethod::Unified
    }
}

// ───────────────────────────────────────────────────────────────────
// Archive
// ───────────────────────────────────────────────────────────────────

impl PersistentRouteEngine {
    /// Step 1: snapshot every auto section about to be wiped into the
    /// archive table. The same predicate as `write_catalogue`'s DELETE.
    fn archive_current_catalogue(&self) -> rusqlite::Result<u32> {
        let tx = self.db.unchecked_transaction()?;

        // Wipe any prior archive for the same cutover.
        tx.execute(
            "DELETE FROM section_catalogue_archive WHERE token = ?",
            params![CUTOVER_ID],
        )?;

        let count = tx.execute(
            "INSERT INTO section_catalogue_archive
                 (token, section_id, name, sport_type, polyline_blob,
                  polyline_json, distance_meters, visit_count, created_at,
                  member_ids_json)
             SELECT ?, id, name, sport_type, polyline_blob,
                    polyline_json, distance_meters, visit_count, created_at,
                    (SELECT json_group_array(DISTINCT activity_id)
                     FROM section_activities
                     WHERE section_id = sections.id AND excluded = 0)
             FROM sections
             WHERE section_type = 'auto'
               AND original_polyline_json IS NULL
               AND is_user_defined = 0
               AND disabled = 0",
            params![CUTOVER_ID],
        )?;

        tx.commit()?;
        info!(
            "tracematch: [cutover] Archived {} auto sections under token '{}'",
            count, CUTOVER_ID
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
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_ID],
        )?;
        tx.commit()?;

        self.section_config = config;
        info!(
            "tracematch: [cutover] Committed switch to Unified, token '{}'",
            CUTOVER_ID
        );
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
        if archived.is_empty() {
            return Ok(0);
        }

        let tx = self.db.unchecked_transaction()?;

        // An id the Unified detect reused through identity carry already sits
        // in the table. UPDATE rather than re-insert: the row keeps its
        // junction links, and the user gets their old geometry back with the
        // pinned flag that makes it survive future detects.
        let mut upsert = tx.prepare(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json,
                  polyline_blob, distance_meters, visit_count, is_user_defined,
                  created_at, updated_at)
             VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                 polyline_json = excluded.polyline_json,
                 polyline_blob = excluded.polyline_blob,
                 distance_meters = excluded.distance_meters,
                 is_user_defined = 1,
                 updated_at = datetime('now')",
        )?;

        let mut restored = 0u32;
        for s in &archived {
            let json = serde_json::to_string(&s.polyline).unwrap_or_else(|_| "[]".into());
            let blob = codec::encode_polyline(&s.polyline);
            let affected = upsert.execute(params![
                s.id,
                s.name,
                s.sport_type,
                json,
                blob,
                s.distance_meters,
                s.visit_count,
                s.created_at,
            ])?;
            restored += affected as u32;
        }
        drop(upsert);

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
            "tracematch: [cutover] Restored {} sections from archive, config back to Corridor",
            restored
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

    let _suspend = suspend_detection();

    // Step 1: archive.
    let archived = with_persistent_engine(|e| e.archive_current_catalogue())
        .ok_or("no engine")?
        .map_err(|e| format!("archive failed: {}", e))?;
    info!("tracematch: [cutover] Archived {} sections", archived);

    // Step 2: commit the switch.
    with_persistent_engine(|e| e.commit_switch())
        .ok_or("no engine")?
        .map_err(|e| format!("switch failed: {}", e))?;

    // Step 3: cold detect. Clear processed ids so everything is re-evaluated
    // under Unified, then run one detect through the unchecked path (the
    // suspension guard is still held).
    with_persistent_engine(|e| {
        e.clear_processed_activity_ids();
    })
    .ok_or("no engine")?;

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

    // Step 4: diff.
    let diff = with_persistent_engine(|e| e.build_cutover_diff())
        .ok_or("no engine")?
        .map_err(|e| format!("diff failed: {}", e))?;

    *CUTOVER_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(false);

    info!("tracematch: [cutover] Cutover complete");
    Ok(diff)
}
