//! Detector cutover: one-time re-cut of a catalogue an older build produced.
//!
//! A database carries the method that cut its catalogue in `schema_info`. One
//! cut by a build before this detector is archived, re-cut cold, and diffed,
//! resumably, driven by a persisted token.
//!
//! Sequence: archive, commit token, cold detect, diff, promote.
//!
//! The archive is the diff's snapshot of the outgoing catalogue and nothing
//! else: promotion trims its lines, and only its ids, names and counts stay,
//! for the change card and the id-mint guard. A section's own history and
//! revert live in the ledger (`section_history`, `section_geometry`,
//! `section_pins`), so a revert pins a stored version and never reads the
//! archive. There is no other detector to go back to, so the config stays as
//! it is.

use crate::persistence::sections::geometry;
use crate::persistence::{
    PersistentEngine, codec, settings_keys, suspend_detection, with_persistent_engine,
};
use log::info;
use rusqlite::params;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tracematch::sections::SectionConfig;

/// The id of the current cutover. Absent in settings means never cut over.
/// Equal means done. Anything else means a future or reverted cutover.
const CUTOVER_ID: &str = "unified-1";

/// Settings key for the cutover token.
pub(super) const CUTOVER_KEY: &str = "__detector_cutover";

/// Settings key for the serialised diff payload (JSON).
pub(super) const CUTOVER_DIFF_KEY: &str = "__detector_cutover_diff";

/// The section config the switch replaced, kept until the token is promoted
/// so a resumed run can still name it in the diff.
pub(super) const CUTOVER_PREVIOUS_CONFIG_KEY: &str = "__detector_cutover_previous_config";

/// Sentinel written on revert, so the cutover does not re-fire.
const CUTOVER_REVERTED: &str = "reverted";

/// Written before the detect and promoted to `CUTOVER_ID` only once the diff
/// is durable. A token found in this state means a previous run died partway:
/// the config already says Unified, so the method check cannot detect it, and
/// without this the install would sit on a half-finished migration forever.
const CUTOVER_INFLIGHT: &str = "unified-1-inflight";

static CUTOVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Whether section ids derive from the ground rather than the clock. Until
/// they do, two devices cut the same library into the same sections under
/// different ids, and the card must not claim otherwise.
pub const CONTENT_DERIVED_IDS: bool = true;

/// Digest of the configuration this build's corpus figures were measured at.
/// The parameters are per device and no server holds them, so two devices
/// only cut a library the same way while both sit on this one.
fn validated_config_digest() -> String {
    super::sections::section_config_digest(&tracematch::sections::SectionConfig::default())
}

/// The claims the change card is allowed to make on this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangeCardSupport {
    pub deterministic: bool,
    pub same_result_drip_or_batch: bool,
    pub ledger: bool,
    pub revert: bool,
    pub retired: bool,
    pub pinned_survive: bool,
    pub same_on_every_device: bool,
}

/// Where a run has got to, for the settings status line. Terminal phases are
/// set before the guard drops, so a reader never sees `running = false` beside
/// a phase that is still mid-flight.
pub const PHASE_IDLE: &str = "idle";
pub const PHASE_DRAINING: &str = "draining";
pub const PHASE_ARCHIVING: &str = "archiving";
pub const PHASE_DETECTING: &str = "detecting";
pub const PHASE_DIFFING: &str = "diffing";
pub const PHASE_COMPLETE: &str = "complete";
pub const PHASE_FAILED: &str = "failed";

static CUTOVER_PHASE: Mutex<&'static str> = Mutex::new(PHASE_IDLE);

fn set_phase(phase: &'static str) {
    *CUTOVER_PHASE.lock().unwrap_or_else(|e| e.into_inner()) = phase;
}

/// The current phase, for the status surface.
pub fn cutover_phase() -> &'static str {
    *CUTOVER_PHASE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Moves the phase and times each one on the way past.
///
/// A cutover is a run the user waits through at launch, and a field report of a
/// slow one names no phase. Timing rides on the transition rather than on a
/// wrapper around each step so a phase added later is timed by construction,
/// and the drop closes the open phase when a run fails partway, which is the
/// run whose duration matters most.
struct PhaseClock {
    phase: &'static str,
    started: std::time::Instant,
    run_started: std::time::Instant,
}

impl PhaseClock {
    fn new() -> Self {
        let now = std::time::Instant::now();
        Self {
            phase: PHASE_IDLE,
            started: now,
            run_started: now,
        }
    }

    /// Close the phase in progress and open `next`.
    fn enter(&mut self, next: &'static str) {
        self.close();
        self.phase = next;
        self.started = std::time::Instant::now();
        set_phase(next);
    }

    /// Close the phase in progress and settle on a terminal phase, which has no
    /// duration of its own.
    fn finish(mut self, terminal: &'static str) {
        self.close();
        self.phase = PHASE_IDLE;
        set_phase(terminal);
    }

    fn close(&mut self) {
        if self.phase == PHASE_IDLE {
            return;
        }
        info!(
            "veloqrs: [cutover] Phase {} took {}ms",
            self.phase,
            crate::elapsed_ms(self.started)
        );
    }

    fn run_ms(&self) -> u64 {
        crate::elapsed_ms(self.run_started)
    }
}

impl Drop for PhaseClock {
    fn drop(&mut self) {
        self.close();
        // The only code that runs on every abnormal exit. `enter` erased the
        // marker `run_cutover_claimed` set up front, and `finish` settles the
        // phase to idle before dropping, so a clock still inside a phase here
        // is a run that died in it.
        if self.phase != PHASE_IDLE {
            set_phase(PHASE_FAILED);
        }
    }
}

/// What a run did. `NotOwed` is a success with nothing to do, which a bare
/// string return cannot express: the caller needs to tell it apart from a
/// completed migration and from a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CutoverOutcome {
    NotOwed,
    Completed(String),
}

/// Start a cutover on a detached thread.
///
/// Returns false when there is no engine, when the migration is not owed, or
/// when a run is already in flight, so a caller can fire this at every launch
/// and let it decide. The running flag is claimed here rather than inside the
/// run, so a caller that polls immediately never reads `false` against a run
/// it just started.
pub fn start_cutover() -> bool {
    let owed = with_persistent_engine(|e| e.cutover_is_owed()).unwrap_or(false);
    if !owed {
        return false;
    }
    if CUTOVER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return false;
    }
    std::thread::spawn(|| {
        // The flag is already claimed, so the run adopts it rather than
        // taking it again.
        let outcome = run_cutover_claimed();
        if let Err(ref e) = outcome {
            log::warn!("veloqrs: [cutover] Run failed: {}", e);
        }
    });
    true
}

// ───────────────────────────────────────────────────────────────────
// State queries
// ───────────────────────────────────────────────────────────────────

/// Whether the cutover has not yet completed.
///
/// Computed live. A cached answer goes stale the moment the catalogue changes,
/// and the catalogue routinely arrives after `load()`: a first sync detects,
/// and a quarantined reopen swaps the database underneath. Both would leave a
/// cached `false` on an install that is owed a migration. The read is one
/// EXISTS against a small table, on a path that runs at launch and on a status
/// poll, so the cache was never buying anything.
pub fn cutover_pending() -> bool {
    with_persistent_engine(|e| e.cutover_is_owed()).unwrap_or(false)
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

impl PersistentEngine {
    /// Called from `load()`. Reads the cutover token and sets the
    /// process-global pending flag. Nothing slow, nothing fallible beyond
    /// a missing settings table (which returns None).
    pub(super) fn check_cutover_state(&self) {
        if self.cutover_is_owed() {
            info!("veloqrs: [cutover] Cutover to Unified is owed");
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
    /// it died mid-run. A never-seen token is owed only while the stored
    /// catalogue was cut by another detector, so a catalogue this build cut
    /// is left alone.
    pub fn cutover_is_owed(&self) -> bool {
        match self.cutover_state_from_db() {
            CutoverState::InFlight => true,
            CutoverState::Never => {
                self.catalogue_detection_method().as_deref()
                    != Some(super::sections::DETECTOR_METHOD)
                    && self.has_archivable_catalogue()
            }
            CutoverState::Done | CutoverState::Reverted => false,
        }
    }

    /// Whether there is a Corridor-era catalogue to migrate. A fresh install
    /// has none, and burning the one-shot token on an empty archive would
    /// leave the change card with nothing to show.
    fn has_archivable_catalogue(&self) -> bool {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sections
                 WHERE section_type = 'auto'
                   AND original_polyline_json IS NULL
                   AND is_user_defined = 0
                   AND disabled = 0)",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n == 1)
            .unwrap_or(false)
    }
}

// ───────────────────────────────────────────────────────────────────
// Archive
// ───────────────────────────────────────────────────────────────────

/// One section the archive is about to snapshot, read before its line is
/// resolved.
struct ArchivableSection {
    id: String,
    name: Option<String>,
    sport_type: String,
    blob: Option<Vec<u8>>,
    json: Option<String>,
    distance_meters: f64,
    visit_count: Option<u32>,
    created_at: Option<String>,
    bounds: (Option<f64>, Option<f64>, Option<f64>, Option<f64>),
    rep_activity_id: Option<String>,
    rep_start: Option<u32>,
    rep_end: Option<u32>,
}

impl PersistentEngine {
    /// Step 1: snapshot every auto section about to be wiped, and its
    /// members. The row predicate is `write_catalogue`'s DELETE predicate:
    /// exactly the rows the coming detect destroys, no more.
    ///
    /// Members ride along because the wipe cascades `section_activities`
    /// away, and their ids feed the mint guard. The lines feed the diff and
    /// are trimmed once it is stored; the bounds columns are 017's DDL and
    /// have no reader.
    fn archive_current_catalogue(&self) -> rusqlite::Result<u32> {
        let tx = self.db.unchecked_transaction()?;

        // Write-once per token. A run that died after the switch and before
        // the diff may retry with a Unified catalogue already on disk, and
        // re-archiving would bury the Corridor snapshot the diff needs.
        let already: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM section_catalogue_archive WHERE token = ?)",
            params![CUTOVER_ID],
            |row| row.get(0),
        )?;
        if already == 1 {
            let kept: u32 = tx.query_row(
                "SELECT COUNT(*) FROM section_catalogue_archive WHERE token = ?",
                params![CUTOVER_ID],
                |row| row.get(0),
            )?;
            info!("veloqrs: [cutover] Reusing archive of {} sections", kept);
            return Ok(kept);
        }

        // Row by row rather than INSERT..SELECT, so each line is resolved the
        // way a read resolves it. The archive carries no reference triple of
        // its own, so a copied-across empty blob is the diff's old line gone
        // and nothing in the archive can rebuild it.
        let mut stmt = tx.prepare(
            "SELECT id, name, sport_type, polyline_blob, polyline_json,
                    distance_meters, visit_count, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    representative_activity_id, rep_start_index, rep_end_index
             FROM sections
             WHERE section_type = 'auto'
               AND original_polyline_json IS NULL
               AND is_user_defined = 0
               AND disabled = 0",
        )?;
        let archivable: Vec<ArchivableSection> = stmt
            .query_map([], |row| {
                Ok(ArchivableSection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    blob: row.get(3)?,
                    json: row.get(4)?,
                    distance_meters: row.get(5)?,
                    visit_count: row.get(6)?,
                    created_at: row.get(7)?,
                    bounds: (row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?),
                    rep_activity_id: row.get(12)?,
                    rep_start: row.get(13)?,
                    rep_end: row.get(14)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        let mut count = 0u32;
        for section in archivable {
            let reference = geometry::reference(
                section.rep_activity_id.as_deref(),
                section.rep_start,
                section.rep_end,
            );
            let line = geometry::line(
                &tx,
                section.blob.as_deref(),
                section.json.as_deref(),
                reference,
            )
            .unwrap_or_default();
            let blob = (!line.is_empty())
                .then(|| codec::serialize_track_points(&line))
                .or(section.blob);
            count += tx.execute(
                "INSERT INTO section_catalogue_archive
                     (token, section_id, name, sport_type, polyline_blob,
                      polyline_json, distance_meters, visit_count, created_at,
                      bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    CUTOVER_ID,
                    section.id,
                    section.name,
                    section.sport_type,
                    blob,
                    section.distance_meters,
                    section.visit_count,
                    section.created_at,
                    section.bounds.0,
                    section.bounds.1,
                    section.bounds.2,
                    section.bounds.3,
                ],
            )? as u32;
        }

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
            "veloqrs: [cutover] Archived {} auto sections and {} members under token '{}'",
            count, members, CUTOVER_ID
        );
        Ok(count)
    }

    /// Step 2: persist the canonical config and write the token, atomically
    /// with the archive.
    fn commit_switch(&mut self) -> rusqlite::Result<()> {
        // The detector is validated at its defaults, which are UNIFIED_CONFIG
        // on the TS side. A slider an older build let the athlete move is
        // reset here and reported on the change card.
        let config = SectionConfig::default();
        let to_json = |c: &SectionConfig| {
            serde_json::to_string(c).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
            })
        };
        let json = to_json(&config)?;

        let tx = self.db.unchecked_transaction()?;
        // Write-once: a resumed run already holds the defaults, and the
        // values worth reporting are the ones the first run replaced.
        if self.section_config != config {
            tx.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                params![CUTOVER_PREVIOUS_CONFIG_KEY, to_json(&self.section_config)?],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![settings_keys::SECTION_CONFIG_JSON, json],
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

        self.section_config = config;
        self.processed_activity_ids.clear();
        // The processed set and the evidence cache are two shadows of the same
        // state, so they clear in lockstep and the detect below cold-rebatches
        // under the new detector.
        self.invalidate_evidence_cache();
        // The debounce absorbs detector noise over k detects, and a detector
        // generation change is not noise. Left armed, a section whose Unified
        // extents disagree with its Corridor ones is a material re-cut and
        // carries frozen, which keeps the Corridor averaged line and its NULL
        // reference alive under a Unified label. Ids still carry; the first
        // Unified batch is simply believed.
        self.section_identity_reseed_decisive();
        info!("veloqrs: [cutover] Committed switch to Unified, token in flight");
        Ok(())
    }

    /// Promote the in-flight token once the diff is stored. Until this runs,
    /// the cutover is owed and re-runs from the top on the next launch.
    ///
    /// The stored diff was the archive's only reader, so the archived lines
    /// go in the same transaction. The rows keep their id, name and count for
    /// the change card and the mint guard, and a member stays re-derivable
    /// from its triple.
    fn finish_cutover(&self) -> rusqlite::Result<()> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_ID],
        )?;
        let trimmed = tx.execute(
            "UPDATE section_catalogue_archive
             SET polyline_blob = NULL, polyline_json = NULL
             WHERE token = ? AND (polyline_blob IS NOT NULL OR polyline_json IS NOT NULL)",
            params![CUTOVER_ID],
        )?;
        // The diff carries the old values from here on.
        tx.execute(
            "DELETE FROM settings WHERE key = ?",
            params![CUTOVER_PREVIOUS_CONFIG_KEY],
        )?;
        tx.commit()?;
        info!(
            "veloqrs: [cutover] Token promoted to '{}', {} archived lines trimmed",
            CUTOVER_ID, trimmed
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
            // `is_user_defined` is the whole test. Ids are minted by the
            // identity registry, so no prefix identifies an auto section.
            // `is_user_defined` is the whole test. Ids are minted by the
            // identity registry, so no prefix identifies an auto section.
            .filter(|s| !s.is_user_defined)
            .collect();

        // Reuse diff_catalogues with archive = old, live = new. Only the
        // counts are stored: a section is a reference activity and the
        // indices of a pass over it, and the rows carry an encoded line for
        // every section on both sides. Keeping them put both catalogues'
        // geometry in a settings row for the life of the install. The rows
        // are the preview's, which is the function's other caller.
        let (counts, _rows) = super::sections::preview::diff_catalogues_public(&live, &archived);

        let payload = serde_json::json!({
            "token": CUTOVER_ID,
            "counts": counts,
            "settings_reset": self.settings_reset()?,
        });
        let json = serde_json::to_string(&payload).unwrap_or_default();

        self.set_setting(CUTOVER_DIFF_KEY, &json)
            .unwrap_or_else(|e| {
                log::warn!("veloqrs: [cutover] Failed to persist diff: {}", e);
            });

        info!(
            "veloqrs: [cutover] Diff stored: {} current, {} new, {} changed, {} gone",
            counts.current, counts.new, counts.changed, counts.gone
        );
        Ok(json)
    }

    /// The config the switch replaced beside the one it wrote, or null when
    /// the library was already at the validated values.
    fn settings_reset(&self) -> rusqlite::Result<serde_json::Value> {
        let Some(json) = self.get_setting(CUTOVER_PREVIOUS_CONFIG_KEY)? else {
            return Ok(serde_json::Value::Null);
        };
        let previous: SectionConfig = match serde_json::from_str(&json) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("veloqrs: [cutover] Unreadable previous config: {}", e);
                return Ok(serde_json::Value::Null);
            }
        };
        Ok(serde_json::json!({
            "previous": previous,
            "current": self.section_config,
        }))
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
                enrichment: Default::default(),
                rank: None,
                consensus_state: None,
            })
        })?;
        rows.collect()
    }

    /// Which claims the change card may make, each backed by the tables and
    /// code that deliver it. A flag is false until its feature ships, so the
    /// card never says more than the build can show.
    pub fn change_card_support(&self) -> ChangeCardSupport {
        let unified = self
            .catalogue_detection_method()
            .as_deref()
            .map(|m| m == super::sections::DETECTOR_METHOD)
            .unwrap_or(false);
        ChangeCardSupport {
            deterministic: unified,
            same_result_drip_or_batch: unified,
            ledger: true,
            revert: true,
            retired: true,
            pinned_survive: true,
            // Reproducible ids are half of it. The other half is the config,
            // which the user's own sliders move and nothing syncs.
            same_on_every_device: CONTENT_DERIVED_IDS
                && super::sections::section_config_digest(&self.section_config)
                    == validated_config_digest(),
        }
    }

    /// The stored diff payload, if any. None before the cutover has run.
    pub fn cutover_diff(&self) -> Option<String> {
        let stored = self.get_setting(CUTOVER_DIFF_KEY).ok().flatten()?;
        Some(self.trim_stored_diff(stored))
    }

    /// Drop the section rows an older build wrote, and rewrite the row.
    ///
    /// The key is written once at promotion and deleted only by the sign-out
    /// wipe, so an install that migrated before this change never runs the
    /// new build path and would carry both catalogues' geometry for good.
    /// The read is the only place left to catch it.
    fn trim_stored_diff(&self, stored: String) -> String {
        let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&stored) else {
            return stored;
        };
        let carried_rows = payload
            .as_object_mut()
            .is_some_and(|map| map.remove("sections").is_some());
        if !carried_rows {
            return stored;
        }
        let Ok(trimmed) = serde_json::to_string(&payload) else {
            return stored;
        };
        if let Err(e) = self.set_setting(CUTOVER_DIFF_KEY, &trimmed) {
            // The caller still gets the trimmed copy; the row is retried on
            // the next read.
            log::warn!("veloqrs: [cutover] Failed to trim the stored diff: {}", e);
        }
        trimmed
    }
}

// ───────────────────────────────────────────────────────────────────
// The run
// ───────────────────────────────────────────────────────────────────

/// Run the full cutover: archive, switch, cold detect, diff.
/// Shaped on `run_elevation_backfill`: suspends detection, holds the
/// guard across the whole pass, fires one terminal re-cut.
pub fn run_cutover() -> Result<CutoverOutcome, String> {
    if CUTOVER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("cutover already running".into());
    }
    run_cutover_claimed()
}

/// The run itself, with [`CUTOVER_RUNNING`] already claimed by the caller.
fn run_cutover_claimed() -> Result<CutoverOutcome, String> {
    // Clears the flag and announces the settle on every exit path, so a failure
    // partway is heard as well as a completion. Declared first, so it drops
    // after the phase clock and the suspension and nothing holds the engine
    // lock by then: the observer blocks this thread until JavaScript returns.
    // `announce` is armed only once the run is owed, since a not-owed run
    // rebuilt nothing to report.
    struct RunGuard {
        announce: bool,
    }
    impl Drop for RunGuard {
        fn drop(&mut self) {
            CUTOVER_RUNNING.store(false, Ordering::SeqCst);
            if self.announce {
                crate::objects::observer::notify(|o| o.cutover_settled());
            }
        }
    }
    let mut guard = RunGuard { announce: false };

    // A failure anywhere below leaves the phase saying so: this covers a
    // failure before the clock enters its first phase, and `PhaseClock::drop`
    // covers every failure after it.
    set_phase(PHASE_FAILED);
    let mut clock = PhaseClock::new();

    // Check whether the cutover is actually owed.
    let owed = with_persistent_engine(|e| e.cutover_is_owed()).ok_or("no engine")?;
    if !owed {
        set_phase(PHASE_IDLE);
        return Ok(CutoverOutcome::NotOwed);
    }
    guard.announce = true;

    // Refuses every NEW start. A worker already in the slot is untouched by
    // it, which is what the drain below is for.
    let _suspend = suspend_detection();

    // A Corridor run started before the suspension is still live, and
    // `poll_detection_once` applies whatever it returns. Left alone it lands
    // its Corridor catalogue after the cutover has finished, over a config
    // and a token that both say Unified. Drive it to its end first; the
    // suspension keeps the slot empty once it drains.
    clock.enter(PHASE_DRAINING);
    drain_detection_slot()?;

    // Step 1: archive. Additive and idempotent per token, so a crash here
    // leaves the user on Corridor with an intact catalogue and the cutover
    // still owed.
    clock.enter(PHASE_ARCHIVING);
    let archived = with_persistent_engine(|e| e.archive_current_catalogue())
        .ok_or("no engine")?
        .map_err(|e| format!("archive failed: {}", e))?;
    info!("veloqrs: [cutover] Archived {} sections", archived);

    // Step 2: commit the switch. Config, in-flight token and the cleared
    // processed set land together, so a crash after this point resumes rather
    // than stranding the install on a half-migrated catalogue.
    with_persistent_engine(|e| e.commit_switch())
        .ok_or("no engine")?
        .map_err(|e| format!("switch failed: {}", e))?;

    // Step 3: cold detect through the unchecked path, since the guard we hold
    // would otherwise refuse our own run.
    clock.enter(PHASE_DETECTING);
    // The pool as it stood when the detect was spawned. A sync running
    // alongside a multi-minute cut adds activities the detect never saw, and
    // the apply below clears `sections_dirty` for all of them.
    let pool_at_spawn =
        with_persistent_engine(|e| e.get_activity_ids().len()).ok_or("no engine")?;
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
        // Anything that arrived mid-cut is neither processed nor dirty
        // otherwise, so the next launch would never section it.
        if e.get_activity_ids().len() > pool_at_spawn {
            e.mark_sections_dirty();
        }
        Ok::<(), String>(())
    })
    .ok_or("no engine")?
    .map_err(|e| format!("apply: {}", e))?;

    // Step 4: diff, then promote the token. The promotion is last, so any
    // failure above leaves the token in flight and the whole run is retried
    // from the top on the next launch.
    clock.enter(PHASE_DIFFING);
    let diff = with_persistent_engine(|e| e.build_cutover_diff())
        .ok_or("no engine")?
        .map_err(|e| format!("diff failed: {}", e))?;

    with_persistent_engine(|e| e.finish_cutover())
        .ok_or("no engine")?
        .map_err(|e| format!("token promotion failed: {}", e))?;

    let run_ms = clock.run_ms();
    clock.finish(PHASE_COMPLETE);
    info!("veloqrs: [cutover] Cutover complete in {}ms", run_ms);
    Ok(CutoverOutcome::Completed(diff))
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

#[cfg(test)]
mod tests {
    use crate::persistence::{PersistentEngine, codec};
    use tempfile::TempDir;
    use tracematch::GpsPoint;

    fn track() -> Vec<GpsPoint> {
        (0..40)
            .map(|i| GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.000_1,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// An engine holding one stored stream and one archivable auto section
    /// whose line is a real slice of it.
    fn engine_with_archivable_section(dir: &TempDir) -> PersistentEngine {
        let path = dir.path().join("archive.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .add_activity("a1".into(), track(), "Ride".into())
            .expect("add_activity");
        let line = track()[0..12].to_vec();
        engine
            .db
            .execute(
                "INSERT INTO sections
                     (id, section_type, name, sport_type, polyline_json, polyline_blob,
                      distance_meters, representative_activity_id, rep_start_index,
                      rep_end_index, geometry_source, created_at, is_user_defined,
                      bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s_auto', 'auto', 'Auto', 'Ride', NULL, ?, 1200.0,
                         'a1', 0, 12, 'exact', '2026-01-01T00:00:00Z', 0,
                         46.0, 46.1, 7.0, 7.1)",
                rusqlite::params![codec::serialize_track_points(&line)],
            )
            .expect("insert the section");
        engine
    }

    fn archived_line(engine: &PersistentEngine) -> Vec<GpsPoint> {
        let blob: Option<Vec<u8>> = engine
            .db
            .query_row(
                "SELECT polyline_blob FROM section_catalogue_archive WHERE section_id = 's_auto'",
                [],
                |row| row.get(0),
            )
            .expect("archived row");
        codec::decode_polyline_row(blob.as_deref(), None).unwrap_or_default()
    }

    /// Scenario: the cutover archives the outgoing catalogue after a clear.
    /// Expected behaviour: the archive holds a real line, rebuilt from the
    /// triple. An empty one is the diff's old line gone, and no triple in the
    /// archive can undo it.
    #[test]
    fn the_archive_keeps_a_line_the_cache_no_longer_holds() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL",
                [],
            )
            .expect("clear the cached geometry");

        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

        assert_eq!(
            archived_line(&engine).len(),
            12,
            "the archive has to snapshot the rebuilt line, not the cleared blob"
        );
    }

    /// The cached blob is still what the archive copies when it is there.
    #[test]
    fn the_archive_copies_the_cached_line_when_it_is_there() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);

        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

        assert_eq!(archived_line(&engine).len(), 12);
    }

    fn previous_config(engine: &PersistentEngine) -> Option<String> {
        engine
            .get_setting(super::CUTOVER_PREVIOUS_CONFIG_KEY)
            .expect("read")
    }

    /// Scenario: a run dies between the switch and the promotion, so the
    /// resumed run switches again from a config that already reads Unified.
    /// Expected behaviour: the diff still names the values the first switch
    /// replaced, and the promotion drops them once the diff carries them.
    #[test]
    fn a_resumed_switch_keeps_the_values_the_first_one_replaced() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        let strict = tracematch::SectionConfig {
            proximity_threshold: 100.0,
            min_activities: 3,
            ..Default::default()
        };
        engine.set_section_config(strict);

        engine.commit_switch().expect("first switch");
        assert_eq!(
            engine.get_section_config(),
            tracematch::SectionConfig::default()
        );
        assert!(previous_config(&engine).is_some());

        engine.commit_switch().expect("resumed switch");
        let diff: serde_json::Value =
            serde_json::from_str(&engine.build_cutover_diff().expect("diff")).expect("json");
        assert_eq!(
            diff["settings_reset"]["previous"]["proximityThreshold"].as_f64(),
            Some(100.0),
            "the resumed switch lost the pre-reset values"
        );
        assert_eq!(
            diff["settings_reset"]["previous"]["minActivities"].as_u64(),
            Some(3)
        );
        assert_eq!(
            diff["settings_reset"]["current"]["minActivities"].as_u64(),
            Some(2)
        );

        engine.finish_cutover().expect("promote");
        assert!(
            previous_config(&engine).is_none(),
            "the promotion left the old values behind"
        );
    }

    /// A switch from the defaults keeps nothing, so the diff reports no reset.
    #[test]
    fn a_switch_from_the_defaults_reports_no_reset() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        engine.commit_switch().expect("switch");
        assert!(previous_config(&engine).is_none());
        let diff: serde_json::Value =
            serde_json::from_str(&engine.build_cutover_diff().expect("diff")).expect("json");
        assert!(diff["settings_reset"].is_null());
    }

    fn archived_blob(engine: &PersistentEngine) -> Vec<u8> {
        engine
            .db
            .query_row(
                "SELECT polyline_blob FROM section_catalogue_archive WHERE section_id = 's_auto'",
                [],
                |row| row.get::<_, Option<Vec<u8>>>(0),
            )
            .expect("archived row")
            .expect("archived blob")
    }

    /// Scenario: the archive is one of the stores the quantised codec covers,
    /// and it was still writing postcard after the tracks moved across.
    ///
    /// Expected behaviour: a line the archive rebuilds is written in the
    /// quantised container, and it still reads back as the same line, because
    /// the reader was never narrowed to one container.
    #[test]
    fn the_archive_writes_the_quantised_container() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL",
                [],
            )
            .expect("clear the cached geometry");

        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

        let blob = archived_blob(&engine);
        assert_eq!(blob[0], 0xC0, "the archived blob is not the polyline tag");
        assert!(
            blob.len()
                < codec::serialize_points(&archived_line(&engine))
                    .expect("postcard")
                    .len(),
            "the archived blob is no smaller than postcard for the same line"
        );
        assert_eq!(archived_line(&engine).len(), 12);
    }

    fn archived_row(engine: &PersistentEngine) -> (String, Option<Vec<u8>>, Option<String>, u32) {
        engine
            .db
            .query_row(
                "SELECT name, polyline_blob, polyline_json, visit_count
                 FROM section_catalogue_archive WHERE section_id = 's_auto'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get::<_, Option<u32>>(3)?.unwrap_or(0),
                    ))
                },
            )
            .expect("archived row")
    }

    /// Scenario: the token is promoted after the diff is stored, and the diff
    /// was the archive's only reader.
    /// Expected behaviour: the archived line goes with the promotion, the id,
    /// name and count stay for the change card and the mint guard.
    #[test]
    fn promoting_the_token_trims_the_archived_lines() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);
        engine
            .db
            .execute(
                "UPDATE sections SET visit_count = 7 WHERE id = 's_auto'",
                [],
            )
            .expect("set the count");
        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);
        assert_eq!(archived_line(&engine).len(), 12);

        engine.build_cutover_diff().expect("diff");
        engine.finish_cutover().expect("promote");

        let (name, blob, json, visits) = archived_row(&engine);
        assert!(blob.is_none(), "the blob outlived the promotion");
        assert!(json.is_none(), "the json line outlived the promotion");
        assert_eq!(name, "Auto");
        assert_eq!(visits, 7);
        assert_eq!(
            engine.get_setting(super::CUTOVER_KEY).expect("token"),
            Some(super::CUTOVER_ID.to_string())
        );
        assert!(
            engine.section_ids_a_mint_must_avoid().contains("s_auto"),
            "a trimmed archive row still claims its id"
        );
    }

    /// Scenario: the run dies between the diff and the promotion.
    /// Expected behaviour: the archive still holds its line, so the retry can
    /// see what left. Only the promotion trims those lines, and only the
    /// counts reach the card: the payload carries no geometry of its own.
    #[test]
    fn a_run_that_dies_before_promotion_keeps_the_lines_for_the_retry() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);
        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

        engine.build_cutover_diff().expect("first diff");
        assert_eq!(archived_line(&engine).len(), 12);

        let diff = engine.build_cutover_diff().expect("retried diff");
        let payload: serde_json::Value = serde_json::from_str(&diff).expect("json");
        assert!(
            payload.get("sections").is_none(),
            "the payload stores no rows: {payload}"
        );
        assert_eq!(
            payload["counts"]["gone"].as_u64(),
            Some(1),
            "the retry still sees the archived section leave: {payload}"
        );
        assert_eq!(
            archived_line(&engine).len(),
            12,
            "only the promotion trims the archived line"
        );
    }

    /// A second promotion, the shape a retried launch takes, finds nothing
    /// left to trim and does not fail.
    #[test]
    fn a_second_promotion_is_a_no_op() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_archivable_section(&dir);
        assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

        engine.finish_cutover().expect("promote");
        engine.finish_cutover().expect("promote again");

        let (_, blob, _, _) = archived_row(&engine);
        assert!(blob.is_none());
    }
}
