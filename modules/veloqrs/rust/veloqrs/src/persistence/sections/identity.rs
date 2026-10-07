//! Assign-once section identity: the stateful half of the identity layer.
//!
//! tracematch emits GROUND (sections with throwaway positional ids that
//! renumber on every detect). This layer owns the id over time: an
//! content id from the sport and heart cell, assigned once and carried forward
//! (or a clock `s_<ts>__<seq>` id for a section with no line),
//! plus the hysteresis debounce that stops a single add flipping the visible
//! catalogue while it still converges to the batch. It generalises the one thing
//! that already survives resync today, a custom section's non-positional id
//! excluded from the detection wipe, to every auto section.
//!
//! The pure decision + debounce machinery lives in
//! `tracematch::sections::identity` ([`HysteresisState`]); this is the engine
//! registry on top. Two things the pure layer cannot hold:
//!
//! - REAL IDS. The pure layer mints deterministic `s_<n>` placeholders so its
//!   plans are byte-stable; those must never reach the DB. The registry owns the
//!   content id with the next free ordinal, or a clock id for a line-free
//!   section, and joins it onto the pure plan by the
//!   `s_<n>` key returned from [`HysteresisState::step_assign`].
//! - THE VELOQRS PAYLOAD. A section is more than a polyline: members, portions,
//!   name. The payload mirrors the pure layer's held ground through the
//!   [`CandidateFate`] on each carry: a FROZEN carry (mid re-cut debounce) keeps
//!   the prior payload and folds in only the genuinely-new activities that
//!   traverse it; an ADOPTED carry (extents agreed, or a sustained re-cut fired)
//!   takes the batch payload wholesale, polyline, portions, and consensus
//!   family are one coherent unit, under the carried identity (real id, name,
//!   created_at, version), grafting back any prior member the non-monotone
//!   batch re-clustering dropped whose track still matches the new geometry.
//!   A mint/restore takes the fresh batch payload under the same identity rule.
//!
//! INTENT SUPPRESSION generalises the custom-section rule that already dodges
//! the id collision: before the plan runs, any candidate whose ground is owned
//! by a durable-intent DB row (accepted / trimmed / renamed / set-ref / merged /
//! custom, the rows the detection wipe spares) is dropped, and any registry row
//! whose id has passed to such a durable row is relinquished. So auto detection
//! never re-emits, and never collides on `UNIQUE sections.id` with, a section the
//! user has frozen. That is what flips accept/trim/merge survival by construction.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use crate::persistence::sections::geometry;
use tracematch::{
    CandidateFate, CandidateSection, FrequentSection, GpsPoint, HysteresisParams, HysteresisState,
    SectionConfig, shares_ground,
};

/// Sets each row's sport to the dominant sport of its members. A row none of
/// whose members has a known sport keeps its label.
fn relabel_by_member_sport(
    rows: &mut BTreeMap<String, IdentityRow>,
    sports: &HashMap<String, String>,
) {
    for row in rows.values_mut() {
        if row
            .section
            .activity_ids
            .iter()
            .any(|id| sports.contains_key(id))
        {
            row.section.sport_type = tracematch::dominant_sport(&row.section.activity_ids, sports);
        }
    }
}

/// Position a split piece on the line that existed before the split. A nearest
/// point on the new parent piece would lose the line's original start.
fn split_piece_progress(parent: &[GpsPoint], piece: &[GpsPoint]) -> Option<f64> {
    let target = piece.get(piece.len() / 2)?;
    let mut travelled = 0.0;
    let mut best: Option<(f64, f64)> = None;
    for pair in parent.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        let lon_scale = a.latitude.to_radians().cos().abs().max(0.01);
        let dx = (b.longitude - a.longitude) * lon_scale;
        let dy = b.latitude - a.latitude;
        let tx = (target.longitude - a.longitude) * lon_scale;
        let ty = target.latitude - a.latitude;
        let length_sq = dx * dx + dy * dy;
        let fraction = if length_sq > 0.0 {
            ((tx * dx + ty * dy) / length_sq).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let gap_sq = (tx - fraction * dx).powi(2) + (ty - fraction * dy).powi(2);
        let length = tracematch::geo_utils::haversine_distance(a, b);
        let progress = travelled + fraction * length;
        if best.is_none_or(|(gap, along)| gap_sq < gap || (gap_sq == gap && progress < along)) {
            best = Some((gap_sq, progress));
        }
        travelled += length;
    }
    best.map(|(_, progress)| progress)
}

/// `identity_state.key` for the section registry blob.
pub(crate) const SECTION_IDENTITY_KEY: &str = "section_identity";

/// Write what was around a change into an event's details: `around` is the
/// activities that arrived while the change was pending, `fork_around` the
/// activities a fork at the line's end collected. Empty lists are omitted,
/// so a reader never renders an empty claim. Neither is a cause.
fn attribute(
    details: &mut serde_json::Map<String, serde_json::Value>,
    around: &[String],
    fork_around: &[String],
) {
    if !around.is_empty() {
        details.insert("around".into(), serde_json::json!(around));
    }
    if !fork_around.is_empty() {
        details.insert("fork_around".into(), serde_json::json!(fork_around));
    }
}

/// The activities every fork record within one evidence cell of either end
/// of `line` collected, sorted and unique. A fork explains the cut at the
/// end it sits on, so a line whose end moved to a junction can name the
/// traffic that made it one.
fn fork_around(
    records: &[tracematch::BoundaryRecord],
    line: &[GpsPoint],
    cell_m: f64,
) -> Vec<String> {
    let (Some(first), Some(last)) = (line.first(), line.last()) else {
        return Vec::new();
    };
    let mut ids = BTreeSet::new();
    for r in records {
        let tracematch::BoundaryReason::Fork {
            branch_activity_ids,
            ..
        } = &r.reason
        else {
            continue;
        };
        let at = GpsPoint::new(r.latitude, r.longitude);
        let near = tracematch::geo_utils::haversine_distance(&at, first) <= cell_m
            || tracematch::geo_utils::haversine_distance(&at, last) <= cell_m;
        if near {
            ids.extend(branch_activity_ids.iter().cloned());
        }
    }
    ids.into_iter().collect()
}

/// A section's geometry provenance, when its line is a real slice.
fn reference_of(section: &FrequentSection) -> Option<(String, u32, u32)> {
    let (start, end) = section.representative_range?;
    if section.representative_activity_id.is_empty() {
        return None;
    }
    Some((section.representative_activity_id.clone(), start, end))
}

/// What one apply did to the catalogue, in the three words the last-run line
/// uses. A split's children arrive as `formed` events, so they count as added.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SectionChangeCounts {
    pub added: u32,
    pub changed: u32,
    pub retired: u32,
}

impl SectionChangeCounts {
    pub(crate) fn from_events(events: &[SectionLifecycleEvent]) -> Self {
        let mut counts = Self::default();
        for event in events {
            match event.kind {
                "formed" | "restored" => counts.added += 1,
                "recut" | "split" => counts.changed += 1,
                "merged" | "dissolved" => counts.retired += 1,
                _ => {}
            }
        }
        counts
    }
}

/// One fired lifecycle change, keyed by real id, produced by the identity
/// apply (the one emitter) and written to `section_history` /
/// `section_geometry` inside the catalogue-save transaction. `kind` is the
/// durable event vocabulary: formed, split, merged, dissolved, restored,
/// recut. `details` is a JSON object (era snapshot, lineage links);
/// `geometry` is versioned by the save when present and linked from the
/// event row.
pub(crate) struct SectionLifecycleEvent {
    pub real_id: String,
    pub kind: &'static str,
    pub details: Option<String>,
    pub geometry: Option<Vec<GpsPoint>>,
    /// Where `geometry` was sliced from, when it is a slice of one activity.
    pub reference: Option<(String, u32, u32)>,
}

/// What arrives with one replay step.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Arrival {
    /// Every pooled activity the registry has not seen yet: a detect that cut
    /// one catalogue for its whole batch.
    Unseen,
    /// The one activity the step's catalogue was cut after. Nothing arrives
    /// when the pool does not hold it or the registry has already seen it.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "a per-arrival detect is the first to build one")
    )]
    Activity(String),
}

/// One arrival and the raw catalogue detection cut after it, carried as the
/// blocks of that catalogue that changed against the step before. A block
/// mapped to `None` left the catalogue.
pub(crate) struct ReplayStep<K> {
    pub arrival: Arrival,
    pub changed: Vec<(K, Option<Vec<FrequentSection>>)>,
}

/// The arrivals of one ingest in the order the debounce counts them, each with
/// the raw catalogue cut after it. A step's catalogue is every block live after
/// its changes, concatenated in key order, so a step carries only what its
/// arrival changed and memory grows with the changes, not with the ingest
/// times the catalogue. Raw section ids carry no meaning to the apply.
pub(crate) struct SectionReplay<K> {
    steps: Vec<ReplayStep<K>>,
}

impl<K: Ord> SectionReplay<K> {
    pub(crate) fn new(steps: Vec<ReplayStep<K>>) -> Self {
        Self { steps }
    }
}

impl SectionReplay<()> {
    /// One step under one catalogue, with every unseen activity arriving at
    /// once.
    pub(crate) fn whole(raw: Vec<FrequentSection>) -> Self {
        Self::new(vec![ReplayStep {
            arrival: Arrival::Unseen,
            changed: vec![((), Some(raw))],
        }])
    }
}

/// What a replay applied: the visible catalogue after its last step, every
/// lifecycle event its steps fired in step order, and the raw catalogue of the
/// last step, which is `None` for a replay with no step.
pub(crate) struct ReplayApplied {
    pub visible: Vec<FrequentSection>,
    pub events: Vec<SectionLifecycleEvent>,
    pub raw: Option<Vec<FrequentSection>>,
}

/// What every step of one replay reads and none of them moves.
struct ReplayContext {
    config: SectionConfig,
    /// The durable-intent grounds and ids (see `durable_intent_rows`).
    intent_grounds: Vec<Vec<GpsPoint>>,
    intent_ids: BTreeSet<String>,
    accepted_bounds: Vec<AcceptedBounds>,
    /// Every id a mint must avoid, from one scan of the database.
    stored_ids: BTreeSet<String>,
    /// The pooled activity ids.
    pool: BTreeSet<String>,
    /// Member sports for the pooled relabel, when sports are pooled.
    sports: Option<HashMap<String, String>>,
}

/// Version byte on the persisted section-registry blob. Bump on any
/// serialisation-breaking change to [`SectionIdentity`]; an old byte then reseeds
/// gracefully instead of misparsing. Version 2 moved to rmp encoding: the
/// payload carries [`FrequentSection`]s whose trailing skip-if-None fields
/// (`GpsPoint.elevation`, `consensus_state`) desync postcard's positional
/// stream, so a v1 postcard blob never decoded and always fell back to a
/// reseed, dropping graves, tombstones, and debounce streaks on every
/// restart. rmp's length-prefixed arrays recover a skipped trailing field
/// through its serde default. Version 3 reshaped the hysteresis debounce
/// record (the streak ledger holds both directions' streaks in place of
/// one kind + one streak), which rmp encodes positionally, so a v2 blob
/// reseeds rather than misreading a kind byte as a streak. Version 5 names the
/// fields: the payload carries [`FrequentSection`], which skips
/// `elevation_gain_m` and `avg_grade_percent` when they are None, so a
/// positional encoding wrote a short array for every section in a library that
/// pre-dates the elevation backfill and the blob could never be read back.
///
/// Bump on any serialisation-breaking change to [`SectionIdentity`] **or to any
/// type it reaches**, tracematch's included: the encoding is one graph and a
/// field added three types down moves everything after it.
pub(super) const SECTION_IDENTITY_BLOB_VERSION: u8 = 5;

/// Merge-candidacy mutual-overlap floor for the registry's hysteresis. SHIPS AT
/// 0.0 (the pure-layer default): a prior competes for a candidate's merge
/// nomination on same-corridor coverage alone, seniority deciding.
///
/// A non-zero floor was trialled to tame the synthetic marginal-capture
/// pathology, a short senior prior with marginal one-sided overlap capturing or
/// blocking a dominant candidate (`tracematch/tests/inheritance_stress.rs`),
/// which at defaults can mint a duplicate every detect on an unchanged catalogue.
/// But 0.4 failed to generalise: on GeoLife dense-urban data (204 trajectories)
/// it broke ~7 legitimate low-overlap carries into mints/merges and worsened
/// churn, WITHOUT reducing the real duplication. Constants discipline: a value
/// that fails generalisation does not ship. The duplication family, visible-
/// catalogue inflation from the re-cut debounce holding stale covered geometry
/// (see the seam note in `section_identity_step`), was a FOLD-level fix in
/// the pure layer, landed, not a merge floor. Kept as an explicit knob so a
/// revisit can carry a TARGETED trigger, not a blanket floor.
const MERGE_MUTUAL_FLOOR: f64 = 0.0;

/// Least share of a candidate's metres a CONTAINED prior must carry to stay its
/// merge successor. Below it the prior drops to the bare same-corridor tier, so
/// a short senior cannot take a much longer candidate's ground and leave its
/// own name, birth date and PR era sitting on it.
///
/// Unlike [`MERGE_MUTUAL_FLOOR`] this demotes rather than filters: a dwarfed
/// prior still competes, so it keeps its own ground wherever that ground is
/// detected. Sweep it in `unified_lab` with `--hyst-ratio` before moving it.
///
/// Swept 2026-09-06 on the 1,203-file private corpus at floor 0.0. Small-senior
/// captures fall 11 at 0.00 to 7 at 0.25 and 6 at 0.30, and 0.50 buys nothing
/// over 0.30: same captures, same 343 visible sections, same 67 overlaps, same
/// 95% id retention. 0.75 reaches 4 and costs an extra visible section, two more
/// overlaps and three merges given up. This value is the knee. Moving off it
/// moves detector output, so the bitwise golden report is owed before it moves.
const MERGE_SIZE_RATIO: f64 = 0.3;

/// One visible or tombstoned section the registry manages: the durable opaque id
/// the DB carries, and the full payload persisted under it. Keyed elsewhere by
/// the pure layer's `s_<n>` join id.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct IdentityRow {
    /// The content or clock id written to `sections.id`, or a seeded existing id.
    real_id: String,
    /// The section persisted under `real_id`. `section.id == real_id` always.
    section: FrequentSection,
}

/// The engine-held section identity registry: the pure churn brain plus the
/// veloqrs payloads it carries. The whole blob is persisted so a debounce
/// survives an app kill, and it reseeds from the DB rows when there is none.
/// Serde-derived so that migration is a straight `serde` of this type.
/// `Default` is hand written (below) so the hysteresis tunables, the merge
/// floor especially, are an explicit knob at the one construction site, not a
/// buried derive.
///
/// `#[serde(default)]` so a field added in a later version deserialises from an
/// older blob (paired with the version tag on the persisted bytes, which reseeds
/// on a hard shape change since postcard is positional, not self-describing).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct SectionIdentity {
    /// Pure churn damping over grounds. Its internal `s_<n>` ids are the join key
    /// into [`rows`](Self::rows)/[`graves`](Self::graves), never persisted.
    hysteresis: HysteresisState,
    /// Visible sections: pure `s_<n>` id -> payload.
    rows: BTreeMap<String, IdentityRow>,
    /// Tombstoned (sustained-dissolve) sections, retained so a re-emerged ground
    /// returns under its OLD real id rather than a fresh one. Pure `s_<n>` id ->
    /// payload, matching the pure layer's own tombstones.
    graves: BTreeMap<String, IdentityRow>,
    /// Activity ids already folded into the catalogue. A detect folds only ids
    /// not in here into carried sections (append-only), so re-clustering of an
    /// already-seen activity never moves it between sections in the visible view.
    seen: BTreeSet<String>,
    /// Monotonic salt guaranteeing a fresh real id is unique even for many mints
    /// inside one millisecond. Only grows within a session.
    mint_seq: u64,
    /// Activities that arrived while a change was pending, per pure id. A
    /// fired change reports them as what was around it; a decisive
    /// continuation drops them with the debounce. Trails the struct so an
    /// older blob restores with it empty.
    around: BTreeMap<String, BTreeSet<String>>,
}

impl Default for SectionIdentity {
    fn default() -> Self {
        Self {
            // The one place the registry's hysteresis is tuned. k and the
            // dissolve/re-cut thresholds ride the pure-layer defaults. Both
            // merge guards are stated EXPLICITLY, [`MERGE_MUTUAL_FLOOR`] at
            // 0.0 and [`MERGE_SIZE_RATIO`] at 0.3, so changing one is a
            // one-line edit here, not a hunt through derives.
            hysteresis: HysteresisState::new(HysteresisParams {
                merge_mutual_floor: MERGE_MUTUAL_FLOOR,
                merge_size_ratio: MERGE_SIZE_RATIO,
                ..HysteresisParams::default()
            }),
            rows: BTreeMap::new(),
            graves: BTreeMap::new(),
            seen: BTreeSet::new(),
            mint_seq: 0,
            around: BTreeMap::new(),
        }
    }
}

impl PersistentEngine {
    /// Every id the database holds or has held: the live rows, the rows the
    /// view hides, and every id the ledger, the geometry versions or the pins
    /// name, the cutover's archived states among them. A content id retired by
    /// a merge or a delete never comes back for the same ground, or its history
    /// would read as one section. The ledger and the pins outlive the
    /// `sections` wipe, so a mint that skipped them could re-issue an id a dead
    /// pin still claims.
    fn stored_section_ids(&self) -> BTreeSet<String> {
        self.db
            .prepare(
                "SELECT id FROM sections
                 UNION SELECT section_id FROM section_history
                 UNION SELECT section_id FROM section_geometry
                 UNION SELECT section_id FROM section_pins",
            )
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
    }

    /// Read accessor for tests: every id a mint has to avoid.
    #[doc(hidden)]
    pub fn section_ids_a_mint_must_avoid(&self) -> BTreeSet<String> {
        self.stored_section_ids()
    }

    /// Read accessor for tests/measurement: the number of visible registry rows.
    #[doc(hidden)]
    pub fn section_identity_visible_len(&self) -> usize {
        self.identity.rows.len()
    }

    /// The payload the registry holds for a real id, whichever pure id it sits under.
    #[cfg(test)]
    pub(crate) fn section_identity_payload(&self, real_id: &str) -> Option<&FrequentSection> {
        self.identity
            .rows
            .values()
            .find(|r| r.real_id == real_id)
            .map(|r| &r.section)
    }

    /// The last RAW detection catalogue applied, before the identity/hysteresis
    /// remap. This is the convergence truth, order-free and tracking the
    /// batch every step, as opposed to the DAMPED `get_sections()` view, which
    /// can lag it by up to `k` steps while a dissolve debounces. The parity
    /// gates compare this so a legitimate hysteresis lag is not read as a
    /// detection desync.
    #[doc(hidden)]
    pub fn raw_detection_catalogue(&self) -> &[FrequentSection] {
        self.raw_sections.as_deref().unwrap_or(&[])
    }

    /// Test-only fingerprint of the full section registry state (visible ids,
    /// tombstones, debounce, seen, ordinal), for asserting a restart restores it
    /// exactly. Behind `synthetic` so it never reaches the shipped API.
    #[cfg(feature = "synthetic")]
    pub fn section_identity_fingerprint(&self) -> Vec<u8> {
        codec::serialize_gps_composite(&self.identity).unwrap_or_default()
    }

    /// Test-only view of the graves as (pure join id, real id) pairs. The seam
    /// tests assert these track the pure layer's tombstones exactly, which no
    /// public read exposes.
    #[cfg(feature = "synthetic")]
    #[doc(hidden)]
    pub fn section_identity_grave_rows(&self) -> Vec<(String, String)> {
        self.identity
            .graves
            .iter()
            .map(|(pid, r)| (pid.clone(), r.real_id.clone()))
            .collect()
    }

    /// Test-only view of the pure layer's tombstoned join ids, sorted.
    #[cfg(feature = "synthetic")]
    #[doc(hidden)]
    pub fn section_identity_tombstone_ids(&self) -> Vec<String> {
        self.identity.hysteresis.tombstone_ids()
    }

    /// Test-only view of the pure layer's visible join ids, sorted.
    #[cfg(feature = "synthetic")]
    #[doc(hidden)]
    pub fn section_identity_pure_visible_ids(&self) -> Vec<String> {
        self.identity.hysteresis.visible_ids()
    }

    /// Test-only count of pure-layer ids with an active debounce.
    #[cfg(feature = "synthetic")]
    #[doc(hidden)]
    pub fn section_identity_pending_len(&self) -> usize {
        self.identity.hysteresis.pending_len()
    }

    /// Test-only mirror view, one tuple per visible registry row: the pure join
    /// id, the real DB id, the ground the pure layer holds under that join id
    /// (empty when it holds none, itself a seam breach), and the payload
    /// polyline persisted under the real id. The seam tests assert the two
    /// geometries are equal after every apply.
    #[cfg(feature = "synthetic")]
    #[doc(hidden)]
    pub fn section_identity_mirror_rows(
        &self,
    ) -> Vec<(String, String, Vec<GpsPoint>, Vec<GpsPoint>)> {
        self.identity
            .rows
            .iter()
            .map(|(pid, r)| {
                let pure_ground = self
                    .identity
                    .hysteresis
                    .ground_of(pid)
                    .map(<[GpsPoint]>::to_vec)
                    .unwrap_or_default();
                (
                    pid.clone(),
                    r.real_id.clone(),
                    pure_ground,
                    r.section.polyline.clone(),
                )
            })
            .collect()
    }

    /// The whole section registry as a version-tagged serde blob, or None if
    /// serialisation fails. Written INSIDE the `save_sections` transaction (via
    /// `write_identity_state`) so the registry and the catalogue it describes
    /// commit atomically, a crash cannot leave the blob ahead of the DB. The
    /// leading byte is [`SECTION_IDENTITY_BLOB_VERSION`]; a mismatch on restore
    /// reseeds rather than misparsing. rmp-encoded, not postcard: the payload
    /// carries GpsPoint composites (see the version-constant note).
    pub(crate) fn section_identity_blob(&self) -> Option<Vec<u8>> {
        identity_blob_for(&self.identity)
    }

    /// Restore the section registry from its persisted blob. Returns false, so
    /// the caller reseeds from the DB rows, when there is no blob (a fresh
    /// install), the version byte does not match, or it fails to decode.
    /// Treating an UNREADABLE blob exactly like a missing one is crash-consistency
    /// healing, not just the migration path: a torn or stale blob self-heals to a
    /// reseed, never a failed load. On a clean restore the exact debounce +
    /// tombstone state is back, so a pending dissolve resumes its streak and a
    /// tombstoned ground still re-emerges under its old id.
    pub(crate) fn section_identity_restore(&mut self) -> bool {
        let bytes: Option<Vec<u8>> = self
            .db
            .query_row(
                "SELECT blob FROM identity_state WHERE key = ?",
                rusqlite::params![SECTION_IDENTITY_KEY],
                |row| row.get(0),
            )
            .ok();
        let Some(bytes) = bytes else {
            return false;
        };
        let Some(body) = codec::untag_blob(SECTION_IDENTITY_BLOB_VERSION, &bytes) else {
            log::warn!("veloqrs: [section_identity_restore] blob version mismatch, reseeding");
            return false;
        };
        match codec::deserialize_gps_composite::<SectionIdentity>(body) {
            Ok(state) => {
                self.identity = state;
                // Stored ids seed `taken` before minting, so a stale blob cannot
                // mint a duplicate content id for a section saved after the blob.
                true
            }
            Err(e) => {
                log::error!(
                    "identity_state {SECTION_IDENTITY_KEY}: blob decode failed, reseeding: {e}"
                );
                false
            }
        }
    }

    /// Write the registry blob on its own, outside the catalogue save.
    ///
    /// The registry also moves on events that write no catalogue: a relinquish,
    /// an activity purge, a reseed. Each of those follows a DB change that is
    /// already committed, so the blob has to follow it at once. Otherwise a kill
    /// before the next detect restores a registry describing rows the DB no
    /// longer holds, and the outcome of the next detect depends on when the
    /// process died. Best-effort: a failed write leaves the older blob, which the
    /// next apply's ground remap heals.
    pub(crate) fn section_identity_persist(&self) {
        let Some(blob) = self.section_identity_blob() else {
            log::warn!("veloqrs: [section_identity_persist] serialisation failed");
            return;
        };
        if let Err(e) = self.db.execute(
            "INSERT INTO identity_state (key, blob, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
            rusqlite::params![SECTION_IDENTITY_KEY, blob],
        ) {
            log::warn!("veloqrs: [section_identity_persist] {e}");
        }
    }

    /// Ids of the sections the user has pinned. A pin is durable intent that the
    /// drawn line does not move, so the detector receives them as
    /// [`tracematch::SectionUpdatePolicy::pinned_ids`] and freezes them through
    /// the fold. Sorted, so the policy carries no read order.
    pub(crate) fn pinned_section_ids(&self) -> Vec<String> {
        super::pooled::pinned_section_ids(&self.db)
    }

    /// A loaded section with the traversals the athlete excluded put back. The
    /// loaded catalogue leaves them out, but the registry is what a detect
    /// writes the section from when it carries it unchanged, and a member the
    /// registry lacks is written with no row for the exclusion to sit on.
    fn with_excluded_members(&self, section: &FrequentSection) -> FrequentSection {
        let mut whole = section.clone();
        let Ok(mut stmt) = self.db.prepare_cached(
            "SELECT activity_id, direction, start_index, end_index, distance_meters
             FROM section_activities
             WHERE section_id = ? AND excluded = 1
             ORDER BY activity_id, start_index",
        ) else {
            return whole;
        };
        let rows = stmt.query_map(rusqlite::params![section.id], |row| {
            let direction: String = row.get(1)?;
            Ok(tracematch::SectionPortion {
                activity_id: row.get(0)?,
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
                direction: direction.parse().unwrap_or(tracematch::Direction::Same),
            })
        });
        for portion in rows.into_iter().flatten().flatten() {
            if !whole.activity_ids.contains(&portion.activity_id) {
                whole.activity_ids.push(portion.activity_id.clone());
            }
            whole.visit_count += 1;
            whole.activity_portions.push(portion);
        }
        whole
    }

    /// Seed the registry from the sections already loaded from the DB, adopting
    /// each existing id as a stable seed. Called once after `load_sections` so an
    /// existing install keeps its ids (positional, custom, or previously minted)
    /// and simply stops re-deriving them from that point, no migration, no id
    /// rewrite, user data intact.
    ///
    /// Only the wipe-managed auto sections (not user-defined) enter the registry;
    /// the durable-intent rows are owned by the DB directly and reach detection
    /// through suppression, never the registry. `seen` is primed with the whole
    /// current activity set so the first post-open detect folds nothing spuriously
    /// (the seeded sections already hold their DB members).
    ///
    /// In-memory only. The blob is derivable from the catalogue that seeded it,
    /// so the caller decides whether to persist it (see
    /// [`section_identity_reseed_decisive`](Self::section_identity_reseed_decisive)).
    pub(crate) fn section_identity_reseed(&mut self) {
        let managed: Vec<FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .map(|s| self.with_excluded_members(s))
            .collect();

        let mut identity = SectionIdentity::default();
        let candidates: Vec<CandidateSection> =
            managed.iter().map(CandidateSection::from_section).collect();
        // A fresh state mints one pure id per seed; join the real DB id onto each.
        let (_out, resolutions) = identity.hysteresis.step_assign(&candidates);
        for (j, section) in managed.into_iter().enumerate() {
            let real_id = section.id.clone();
            identity
                .rows
                .insert(resolutions[j].id.clone(), IdentityRow { real_id, section });
        }
        identity.seen = self.activity_metadata.keys().cloned().collect();
        self.identity = identity;
    }

    /// Reseed for a config change: the ids carry, and the next fold applies its
    /// dissolves and re-cuts without a streak.
    ///
    /// The debounce absorbs detector noise, and a config change is not noise:
    /// the user asked for different ground and the first batch under the new
    /// params is the answer. Without the arm, ground the new config no longer
    /// finds stays visible for `k` detects, which on a weekly-syncing library is
    /// weeks. The arm rides the registry blob, so it survives a kill and is
    /// still spent by the first fold rather than the first fold after a restart.
    pub(crate) fn section_identity_reseed_decisive(&mut self) {
        self.section_identity_reseed();
        self.identity.hysteresis.arm_decisive();
        self.section_identity_persist();
    }

    /// Run a replay of detection catalogues through the identity + hysteresis
    /// layer, one hysteresis step per arrival, returning the VISIBLE catalogue
    /// to persist plus the lifecycle events the steps fired: stable ids carried
    /// onto surviving ground, fresh ids minted for new ground, dissolves and
    /// re-cuts debounced. The debounce counts arrivals, so a replay of `n`
    /// steps lands where `n` applies of one step each land. Operates on
    /// `identity` (a clone the caller commits only on a durable save) so a
    /// failed save never advances the registry past the DB; the events become
    /// durable in the same save transaction, so a rolled-back save also drops
    /// them. A replay with no step moves nothing and fires nothing.
    pub(crate) fn section_identity_apply_into<K: Ord>(
        &self,
        identity: &mut SectionIdentity,
        replay: SectionReplay<K>,
    ) -> ReplayApplied {
        let mut events: Vec<SectionLifecycleEvent> = Vec::new();
        if replay.steps.is_empty() {
            return ReplayApplied {
                visible: identity.rows.values().map(|r| r.section.clone()).collect(),
                events,
                raw: None,
            };
        }
        let config = self.section_config.clone();
        // Durable-intent grounds + ids: exactly the rows the detection wipe
        // spares (custom, trimmed/backed-up, or accepted/user-defined). Their
        // ground must not be re-emitted (that is the UNIQUE-id collision that
        // crashes the save), and any registry id that has passed to one is
        // relinquished.
        let (intent_grounds, intent_ids) = self.durable_intent_rows();
        let sports = config.pool_sports.then(|| {
            self.activity_metadata
                .iter()
                .map(|(id, m)| (id.clone(), m.sport_type.clone()))
                .collect()
        });
        let ctx = ReplayContext {
            config,
            intent_grounds,
            intent_ids,
            accepted_bounds: self.accepted_section_bounds(),
            // One scan for the whole replay. This reads six tables, and every
            // mint of every step reads the result.
            stored_ids: self.stored_section_ids(),
            pool: self.activity_metadata.keys().cloned().collect(),
            sports,
        };

        let mut blocks: BTreeMap<K, Vec<FrequentSection>> = BTreeMap::new();
        for step in replay.steps {
            for (key, block) in step.changed {
                match block {
                    Some(sections) => {
                        blocks.insert(key, sections);
                    }
                    None => {
                        blocks.remove(&key);
                    }
                }
            }
            let raw: Vec<&FrequentSection> = blocks.values().flatten().collect();
            self.section_identity_step(identity, &ctx, &raw, &step.arrival, &mut events);
        }

        ReplayApplied {
            visible: identity.rows.values().map(|r| r.section.clone()).collect(),
            events,
            raw: Some(blocks.into_values().flatten().collect()),
        }
    }

    /// One hysteresis step of a replay: the raw catalogue cut after `arrival`,
    /// its fired lifecycle events appended to `events`.
    fn section_identity_step(
        &self,
        identity: &mut SectionIdentity,
        ctx: &ReplayContext,
        raw: &[&FrequentSection],
        arrival: &Arrival,
        events: &mut Vec<SectionLifecycleEvent>,
    ) {
        let config = &ctx.config;
        let (intent_grounds, intent_ids) = (&ctx.intent_grounds, &ctx.intent_ids);

        // RELINQUISH: a row whose real id now belongs to a durable-intent DB row
        // has handed identity ownership to that row. Stop carrying it (and stop
        // debounce-dissolving it) so the registry and the spared DB row do not
        // both represent one ground.
        let relinquish: Vec<String> = identity
            .rows
            .iter()
            .filter(|(_, r)| intent_ids.contains(&r.real_id))
            .map(|(pid, _)| pid.clone())
            .collect();
        for pid in relinquish {
            identity.rows.remove(&pid);
            identity.graves.remove(&pid);
            identity.hysteresis.forget(&pid);
        }

        // A durable claim can also land on DEAD ground: the corridor
        // tombstoned, its payload moved to the graves, and the user then
        // claimed the ground with a custom or accepted row. Relinquish by
        // real id cannot reach it (the claim minted its own DB id), so sweep
        // by ground: any tombstone whose retained ground a durable-intent row
        // now owns is forgotten, grave included. Without this the grave pins
        // the dead id forever, and a later re-emergence would restore a
        // ground the DB row already represents, the same double-ownership
        // the live-row relinquish prevents.
        let claimed: Vec<String> = identity
            .hysteresis
            .tombstone_ids()
            .into_iter()
            .filter(|pid| {
                identity
                    .hysteresis
                    .tombstone_ground_of(pid)
                    .is_some_and(|g| ground_owned_by_intent(g, intent_grounds))
            })
            .collect();
        for pid in claimed {
            identity.graves.remove(&pid);
            identity.hysteresis.forget(&pid);
        }

        // SUPPRESS: drop any candidate whose ground a durable-intent row already
        // owns. The durable row represents that ground; a fresh auto section for
        // it is the collision. This is the custom-section rule generalised.
        let raw: Vec<&FrequentSection> = raw
            .iter()
            .copied()
            .filter(|s| {
                !s.is_user_defined
                    && !ground_owned_by_intent(&s.polyline, intent_grounds)
                    && !bbox_dominated(&s.polyline, &ctx.accepted_bounds)
            })
            .collect();

        // Step the pure hysteresis and learn which visible id each candidate
        // resolved to (carry/split/merge -> inherited id, new/restore -> fresh)
        // and whether the pure layer adopted the candidate's geometry.
        //
        // COMPETITION NOTE. A prior mid re-cut debounce competes in
        // `plan_identity` on the batch geometry it is re-cutting TO (its
        // pending target), not its frozen footprint: the FOLD-level fix the
        // [`MERGE_MUTUAL_FLOOR`] note points at. Two residual exposures, each
        // re-checked against the pure layer on 2026-08-31. CLOSED 2026-09-06:
        // the FIRST divergent step used to compete on the held footprint,
        // because a target is only written after the plan it would have fed.
        // The step now plans twice and competes a materially re-cutting prior
        // on the candidate the first pass matched it to. STILL OPEN: a
        // dissolve-pending prior with no re-cut behind it carries no target at
        // all, and seeding cannot reach it either, since it has no matched
        // candidate to seed from and its held footprint is the only geometry
        // it has, so it competes on its stale ground. ACCEPTED: a marginal
        // one-sided senior capture needs no debounce, the merge floor is its
        // only mitigation and ships at 0.0 (see [`MERGE_MUTUAL_FLOOR`]). The
        // streaks are NOT an exposure. Since the two-streak ledger, a re-cut
        // debounce carries the dissolve streak through and a dissolve debounce
        // carries the re-cut streak through, so no capture erases the absence
        // evidence a rotation accumulated.
        let candidates: Vec<CandidateSection> = raw
            .iter()
            .map(|s| CandidateSection::from_section(s))
            .collect();
        // Whether a cut counted a ride: membership is the cut's verdict
        // wherever the cut looked, and the held line judges only what it never
        // saw.
        let judged = |cut: &FrequentSection, aid: &str| {
            cut_judged(&self.activity_metadata, config.pool_sports, cut, aid)
        };
        // The registry's half of the agreement floor. The pure layer adopts an
        // agreeing extent only while the passes hold; members are this side's
        // evidence, and a prior member the cut left out would leave the section
        // silently on adoption. Reporting the loss makes it a debounced re-cut
        // the ledger narrates instead.
        let rows = &identity.rows;
        let loses_a_member = |pid: &str, j: usize| -> bool {
            let Some(row) = rows.get(pid) else {
                return false;
            };
            let cand = raw[j];
            row.section
                .activity_ids
                .iter()
                .any(|aid| !cand.activity_ids.contains(aid) && judged(cand, aid))
        };
        let (out, resolutions) = identity
            .hysteresis
            .step_assign_guarded(&candidates, &loses_a_member);

        // What arrived this step. A change that fires now was around these
        // and around whatever arrived while it was pending.
        let arrivals: BTreeSet<String> = match arrival {
            Arrival::Unseen => ctx.pool.difference(&identity.seen).cloned().collect(),
            Arrival::Activity(id) => (ctx.pool.contains(id) && !identity.seen.contains(id))
                .then(|| id.clone())
                .into_iter()
                .collect(),
        };
        // The seen set after this step: what the pool still holds of the
        // seen set before it, and this step's arrivals.
        let now_seen: BTreeSet<String> = identity
            .seen
            .intersection(&ctx.pool)
            .chain(&arrivals)
            .cloned()
            .collect();
        // The arrivals' tracks, for the fold. Read up front so the reconcile
        // below borrows nothing from `self`.
        let new_tracks: BTreeMap<String, Vec<GpsPoint>> = arrivals
            .iter()
            .filter_map(|id| self.get_gps_track(id).map(|t| (id.clone(), t)))
            .collect();
        let around_of = |pid: &str| -> Vec<String> {
            let mut ids: BTreeSet<String> = identity.around.get(pid).cloned().unwrap_or_default();
            ids.extend(arrivals.iter().cloned());
            ids.into_iter().collect()
        };
        let arrivals_list: Vec<String> = arrivals.iter().cloned().collect();
        let cell = tracematch::line_match_cell_m(config);
        let fork_around_of = |line: &[GpsPoint]| fork_around(&self.fork_records, line, cell);

        // Reconcile the payload map to the pure layer's post-step visible set.
        let old_rows = std::mem::take(&mut identity.rows);
        let old_graves = std::mem::take(&mut identity.graves);
        // Pure id -> real id of every pre-step visible row, captured before
        // the reconcile consumes the map: the emitter translates fired
        // retirements and re-cuts (which name pre-step pure ids) through it.
        let old_real: BTreeMap<String, String> = old_rows
            .iter()
            .map(|(pid, r)| (pid.clone(), r.real_id.clone()))
            .collect();
        let mut new_rows: BTreeMap<String, IdentityRow> = BTreeMap::new();

        // Candidates: the pure layer's per-candidate fate drives the branch, so
        // the registry mirrors what the pure layer decided rather than
        // re-deriving carry/restore/mint from its own map membership. A frozen
        // carry keeps the prior payload and folds new activities; an adopted
        // carry mirrors the pure layer's held ground by taking the batch payload
        // wholesale under the carried identity; a restore re-uses the grave's
        // real id; a mint takes a fresh one.
        //
        // The fate and the registry mirror must agree: a carry names a live row,
        // a restore names a grave (or, on a same-step dissolve-and-re-form
        // bounce, the still-live row), a mint names neither. The pure-side
        // `fate_membership_property` proves the fates are membership-honest, so a
        // disagreement here is a mirror desync (a dropped grave from a corrupt
        // identity blob is the known one, task #13). Loud in tests via
        // `debug_assert`, degraded to a safe mint in release so a corrupt blob
        // re-mints a fresh id rather than bricking the engine.
        for (j, section) in raw.into_iter().enumerate() {
            let pid = resolutions[j].id.clone();
            let membership_ok = match resolutions[j].fate {
                CandidateFate::CarriedFrozen | CandidateFate::CarriedAdopted => {
                    old_rows.contains_key(&pid)
                }
                // A restore normally names a grave. It names a still-live row
                // when the sustained dissolve fired and the ground re-formed
                // within the SAME step (the pure layer tombstones mid-step and
                // the mint pass matches that fresh tombstone) - the row
                // bounces without ever leaving the registry.
                CandidateFate::Restored => {
                    old_graves.contains_key(&pid) || old_rows.contains_key(&pid)
                }
                CandidateFate::Minted => {
                    !old_rows.contains_key(&pid) && !old_graves.contains_key(&pid)
                }
            };
            debug_assert!(
                membership_ok,
                "identity fate {:?} for {pid} disagrees with the registry mirror",
                resolutions[j].fate
            );

            let cut = section;
            // Moved into whichever branch consumes it (adopt, restore, or the
            // mint fallback); a divergence leaves it for the fallback.
            let mut payload = Some(section);
            let carried = match resolutions[j].fate {
                CandidateFate::CarriedFrozen => old_rows.get(&pid).cloned().map(|mut row| {
                    fold_new_activities(&mut row.section, Some(cut), &judged, &new_tracks, config);
                    row
                }),
                CandidateFate::CarriedAdopted => old_rows.get(&pid).cloned().map(|mut row| {
                    // The batch's polyline, portions, and consensus family are
                    // one coherent unit, so adoption is wholesale; identity
                    // fields carry, and prior members the non-monotone batch
                    // re-clustering dropped are grafted back against the NEW
                    // geometry so membership stays monotone across the adopt.
                    let prior =
                        std::mem::replace(&mut row.section, payload.take().unwrap().clone());
                    row.section.id = row.real_id.clone();
                    row.section.name = prior.name.clone();
                    row.section.created_at = prior.created_at.clone();
                    row.section.version = prior.version;
                    row.section.updated_at = prior.updated_at.clone();
                    // The sport is derived from the ground: pooled detection
                    // labels a cut by the traffic that runs it, so an adopted
                    // carry takes the cut's label and two libraries with the
                    // same ground agree whichever sport arrived first. A
                    // frozen carry keeps the prior payload, label included.
                    graft_prior_members(self, &mut row.section, cut, &prior, &judged, config);
                    // An adopted carry keeps learning new traffic exactly as a
                    // frozen one does: the batch candidate only carries its own
                    // sport's members, but a new activity of another sport on
                    // the same ground must still join the row this step, or the
                    // cross-sport merge's majority pick hands the corridor to a
                    // freshly minted id and identity breaks on a sport addition.
                    fold_new_activities(&mut row.section, Some(cut), &judged, &new_tracks, config);
                    row
                }),
                CandidateFate::Restored => old_graves
                    .get(&pid)
                    .or_else(|| old_rows.get(&pid))
                    .cloned()
                    .map(|mut row| {
                        // The ground re-emerged; adopt the batch geometry and
                        // members but keep the OLD real id and birth date
                        // (comes back as itself). The prior is the grave, or
                        // the live row on a same-step bounce.
                        let real_id = row.real_id.clone();
                        let prior =
                            std::mem::replace(&mut row.section, payload.take().unwrap().clone());
                        row.section.id = real_id;
                        row.section.name = prior.name.clone();
                        row.section.created_at = prior.created_at.clone();
                        row.section.version = prior.version;
                        row.section.updated_at = prior.updated_at.clone();
                        // Sport stays with the identity here for the same
                        // reason as an adopted carry: the ground may re-emerge
                        // in another sport's cut, and a section that comes back
                        // as itself must not come back as another sport.
                        row.section.sport_type = prior.sport_type.clone();
                        row
                    }),
                CandidateFate::Minted => None,
            };

            let row = carried.unwrap_or_else(|| {
                let mut section = payload.take().expect("payload consumed once").clone();
                // Every id the database holds or has held, the rows the
                // view hides (disabled, superseded, accepted) and the
                // retired included: a mint must never land on one of them.
                let mut taken: BTreeSet<String> = ctx.stored_ids.clone();
                taken.extend(self.sections.iter().map(|s| s.id.clone()));
                taken.extend(new_rows.values().map(|r| r.real_id.clone()));
                taken.extend(old_rows.values().map(|r| r.real_id.clone()));
                taken.extend(old_graves.values().map(|r| r.real_id.clone()));
                taken.extend(identity.graves.values().map(|r| r.real_id.clone()));
                let real_id = mint_content_id(&section, &taken, &mut identity.mint_seq);
                section.id = real_id.clone();
                // Birth is stamped on the payload at mint so it rides the
                // registry blob and the graves: created_at then survives
                // carries, dissolves, and restores instead of re-stamping at
                // every save.
                section.created_at = Some(chrono::Utc::now().to_rfc3339());
                IdentityRow { real_id, section }
            });
            new_rows.insert(pid, row);
        }

        // Pending-frozen visible ids (a debounced dissolve or re-cut with no
        // candidate this step): keep the prior payload, still folding new
        // activities into it so a held section stays live. No cut drew this
        // ground, so its held line is the only judge there is.
        for pid in identity.hysteresis.visible_ids() {
            if new_rows.contains_key(&pid) {
                continue;
            }
            if let Some(mut row) = old_rows.get(&pid).cloned() {
                fold_new_activities(&mut row.section, None, &judged, &new_tracks, config);
                new_rows.insert(pid, row);
            }
        }

        let split_parent_ids: BTreeSet<&str> = resolutions
            .iter()
            .filter_map(|resolution| resolution.split_from.as_deref())
            .collect();
        let old_parent_lines: BTreeMap<String, Vec<GpsPoint>> = old_rows
            .iter()
            .filter(|(pid, _)| split_parent_ids.contains(pid.as_str()))
            .map(|(pid, row)| (pid.clone(), row.section.polyline.clone()))
            .collect();

        // Newly tombstoned ids (a sustained dissolve fired this step): move their
        // payload into the graves so a later re-emergence restores the real id.
        for (pid, row) in old_rows.into_iter().chain(old_graves) {
            if new_rows.contains_key(&pid) {
                continue;
            }
            if identity.hysteresis.is_tombstoned(&pid) {
                identity.graves.insert(pid, row);
            }
        }

        // THE EMITTER: one place turns the step's fired changes into durable
        // lifecycle events, keyed by real id. Debounced-but-unfired changes
        // emit nothing (the view has not moved); agreement refinements emit
        // nothing (no visible change to narrate). Reasons and era snapshots
        // are taken at fire time: what was true when the change became
        // visible, not when its streak began.
        // Same-step bounces: restored pids that were still live rows (only a
        // pre-step row appears in old_real; a grave never does). The section
        // visibly never left, so neither the fired dissolve nor the restore
        // is narrated - like an adopted carry, there is no event.
        let bounced: BTreeSet<&String> = resolutions
            .iter()
            .filter(|r| r.fate == CandidateFate::Restored && old_real.contains_key(&r.id))
            .map(|r| &r.id)
            .collect();
        // Split lineage, aggregated parent-side so history reads "split into
        // X and Y": parent real id -> freshly minted sibling real ids.
        let mut split_children: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for res in &resolutions {
            let Some(row) = new_rows.get(&res.id) else {
                continue;
            };
            match res.fate {
                CandidateFate::Minted => {
                    // A split loser records its parent and a discriminator the
                    // read path renders in-locale: a cardinal when the two
                    // pieces separate cleanly, else its ordinal among the
                    // parent's siblings (the parent piece itself is 1).
                    let details = res.split_from.as_ref().and_then(|ppid| {
                        let parent_real = old_real.get(ppid)?;
                        let siblings = split_children.entry(parent_real.clone()).or_default();
                        siblings.push(row.real_id.clone());
                        let discriminator = new_rows
                            .get(ppid)
                            .and_then(|p| {
                                tracematch::sections::split_direction(
                                    &p.section.polyline,
                                    &row.section.polyline,
                                )
                            })
                            .map(str::to_string)
                            .unwrap_or_else(|| (siblings.len() + 1).to_string());
                        let mut details = serde_json::Map::new();
                        details.insert("split_from".into(), serde_json::json!(parent_real));
                        details.insert("discriminator".into(), serde_json::json!(discriminator));
                        attribute(
                            &mut details,
                            &arrivals_list,
                            &fork_around_of(&row.section.polyline),
                        );
                        Some(serde_json::Value::Object(details).to_string())
                    });
                    events.push(SectionLifecycleEvent {
                        real_id: row.real_id.clone(),
                        kind: "formed",
                        details,
                        geometry: Some(row.section.polyline.clone()),
                        reference: reference_of(&row.section),
                    });
                }
                CandidateFate::Restored => {
                    if !bounced.contains(&res.id) {
                        events.push(SectionLifecycleEvent {
                            real_id: row.real_id.clone(),
                            kind: "restored",
                            details: None,
                            geometry: Some(row.section.polyline.clone()),
                            reference: reference_of(&row.section),
                        });
                    }
                }
                CandidateFate::CarriedAdopted | CandidateFate::CarriedFrozen => {}
            }
        }
        for (parent_real, siblings) in split_children {
            let parent_pid = old_real
                .iter()
                .find(|(_, real)| *real == &parent_real)
                .map(|(pid, _)| pid);
            let parent_line = parent_pid
                .and_then(|pid| old_parent_lines.get(pid))
                .map(Vec::as_slice);
            let mut pieces = siblings.clone();
            if parent_pid
                .and_then(|pid| new_rows.get(pid))
                .is_some_and(|row| row.real_id == parent_real)
            {
                pieces.push(parent_real.clone());
            }
            let progress = |id: &String| {
                parent_line.and_then(|line| {
                    new_rows
                        .values()
                        .find(|row| &row.real_id == id)
                        .and_then(|row| split_piece_progress(line, &row.section.polyline))
                })
            };
            pieces.sort_by(|a, b| match (progress(a), progress(b)) {
                (Some(x), Some(y)) => x.total_cmp(&y).then_with(|| a.cmp(b)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.cmp(b),
            });
            for (index, child) in pieces.iter().enumerate() {
                if child == &parent_real {
                    continue;
                }
                if let Some(event) = events
                    .iter_mut()
                    .find(|event| event.kind == "formed" && &event.real_id == child)
                    && let Some(details) = event
                        .details
                        .as_deref()
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                {
                    let mut details = details.as_object().cloned().unwrap_or_default();
                    details.insert("line_order".into(), serde_json::json!(index + 1));
                    event.details = Some(serde_json::Value::Object(details).to_string());
                }
            }
            let ordered_siblings: Vec<String> =
                pieces.into_iter().filter(|id| id != &parent_real).collect();
            let mut details = self.section_era_snapshot(&parent_real);
            details.insert("siblings".into(), serde_json::json!(ordered_siblings));
            let fork = new_rows
                .values()
                .find(|r| r.real_id == parent_real)
                .map(|r| fork_around_of(&r.section.polyline))
                .unwrap_or_default();
            attribute(&mut details, &arrivals_list, &fork);
            events.push(SectionLifecycleEvent {
                real_id: parent_real,
                kind: "split",
                details: Some(serde_json::Value::Object(details).to_string()),
                geometry: None,
                reference: None,
            });
        }
        for pid in &out.recut_ids {
            let (Some(real_id), Some(row)) = (old_real.get(pid), new_rows.get(pid)) else {
                continue;
            };
            let mut details = self.section_era_snapshot(real_id);
            attribute(
                &mut details,
                &around_of(pid),
                &fork_around_of(&row.section.polyline),
            );
            events.push(SectionLifecycleEvent {
                real_id: real_id.clone(),
                kind: "recut",
                details: Some(serde_json::Value::Object(details).to_string()),
                geometry: Some(row.section.polyline.clone()),
                reference: reference_of(&row.section),
            });
        }
        for retirement in &out.retired {
            if bounced.contains(&retirement.id) {
                continue;
            }
            let Some(real_id) = old_real.get(&retirement.id) else {
                continue;
            };
            let mut details = self.section_era_snapshot(real_id);
            attribute(&mut details, &around_of(&retirement.id), &[]);
            let kind = match &retirement.reason {
                tracematch::RetireReason::Dissolved => "dissolved",
                tracematch::RetireReason::MergedInto { id } => {
                    if let Some(winner) = old_real.get(id) {
                        details.insert("into".into(), serde_json::json!(winner));
                    }
                    "merged"
                }
            };
            events.push(SectionLifecycleEvent {
                real_id: real_id.clone(),
                kind,
                details: Some(serde_json::Value::Object(details).to_string()),
                geometry: None,
                reference: None,
            });
        }

        // The ledger follows the debounce: every id still pending gains this
        // step's arrivals, every other id's accumulation is over.
        let pending = identity.hysteresis.pending_ids();
        identity.around.retain(|pid, _| pending.contains(pid));
        for pid in pending {
            identity
                .around
                .entry(pid)
                .or_default()
                .extend(arrivals.iter().cloned());
        }

        // Pooled detection labels a cut by the sport its members do. The
        // same rule runs over every carried row here, so the heading is a
        // function of the members and not of which sport arrived first.
        if let Some(sports) = &ctx.sports {
            relabel_by_member_sport(&mut new_rows, sports);
        }

        identity.rows = new_rows;
        identity.seen = now_seen;
    }

    /// The era snapshot of one section as it stands NOW, before the change
    /// this event narrates lands: each sport's record and its activity.
    /// Read from the junction cache the save has not yet rewritten, so a
    /// dissolved section's final era survives the cascade that removes its
    /// rows. Records are empty when the era had no cached times (lap times
    /// fill lazily on first performance read).
    pub(super) fn section_era_snapshot(
        &self,
        real_id: &str,
    ) -> serde_json::Map<String, serde_json::Value> {
        let mut snap = serde_json::Map::new();
        let prs = super::history::current_prs_on(&self.db, real_id);
        snap.insert("prs".into(), super::history::prs_json(&prs));
        snap
    }

    /// Relinquish a registry row whose ground has just passed to a durable intent
    /// row, so the next detect does not carry (or debounce-dissolve) a ground the
    /// DB row now owns. Called by the mutations (accept/trim/rename/set-ref/merge)
    /// after they promote a section to user-defined. Idempotent: a real id the
    /// registry does not manage is a no-op.
    pub(crate) fn section_identity_relinquish(&mut self, real_id: &str) {
        let pids: Vec<String> = self
            .identity
            .rows
            .iter()
            .filter(|(_, r)| r.real_id == real_id)
            .map(|(pid, _)| pid.clone())
            .collect();
        if pids.is_empty() {
            return;
        }
        for pid in pids {
            self.identity.rows.remove(&pid);
            self.identity.graves.remove(&pid);
            self.identity.hysteresis.forget(&pid);
        }
        self.section_identity_persist();
    }

    /// Re-admit an auto section to the registry under its real id, the one-row
    /// form of [`section_identity_reseed`](Self::section_identity_reseed).
    ///
    /// A reset or an enable hands a row back to the detection wipe after the
    /// registry let it go, so with no prior for its ground the next detect
    /// would mint it a new id and strand its exclusions on the old one. The
    /// rows already held are stepped as their own candidates, which carries
    /// each unchanged, and the one new candidate resolves to a fresh pure id
    /// that the real id is joined to. If a held row does not resolve to its own
    /// id the step is not a no-op, so the whole registry reseeds instead.
    /// Idempotent: a section already held, user-defined, disabled or absent
    /// from the catalogue is left alone.
    pub(crate) fn section_identity_admit(&mut self, real_id: &str) {
        if self.identity.rows.values().any(|r| r.real_id == real_id) {
            return;
        }
        let Some(section) = self
            .sections
            .iter()
            .find(|s| s.id == real_id && !s.is_user_defined)
            .map(|s| self.with_excluded_members(s))
        else {
            return;
        };

        let held: Vec<(String, FrequentSection)> = self
            .identity
            .rows
            .iter()
            .map(|(pid, r)| (pid.clone(), r.section.clone()))
            .collect();
        let mut candidates: Vec<CandidateSection> = held
            .iter()
            .map(|(_, s)| CandidateSection::from_section(s))
            .collect();
        candidates.push(CandidateSection::from_section(&section));

        let mut trial = self.identity.hysteresis.clone();
        let (_out, resolutions) = trial.step_assign(&candidates);
        let carried_whole = held
            .iter()
            .enumerate()
            .all(|(j, (pid, _))| resolutions[j].id == *pid);
        let new_pid = resolutions[held.len()].id.clone();
        if !carried_whole || self.identity.rows.contains_key(&new_pid) {
            self.section_identity_reseed();
        } else {
            self.identity.hysteresis = trial;
            self.identity.rows.insert(
                new_pid,
                IdentityRow {
                    real_id: real_id.to_string(),
                    section,
                },
            );
        }
        self.section_identity_persist();
    }

    /// Drop a removed activity from every section the registry carries (visible
    /// rows and tombstoned graves) and from the in-memory catalogue, and forget it
    /// as seen so a later re-add folds it back in. The append-only fold otherwise
    /// keeps a removed contributor as a phantom member, which the activity_id
    /// foreign key now (correctly) refuses to persist, aborting the whole
    /// detection apply. Ground is untouched: only the gone activity leaves;
    /// the section's geometry and other members stay.
    pub(crate) fn section_identity_purge_activity(&mut self, activity_id: &str) {
        if self.section_identity_purge_activity_in_memory(activity_id) {
            self.section_identity_persist();
        }
    }

    /// Update the registry and section tier without writing rows.
    pub(crate) fn section_identity_purge_activity_in_memory(&mut self, activity_id: &str) -> bool {
        purge_activity_from_tiers(&mut self.identity, &mut self.sections, activity_id)
    }
}

/// Encode a section registry for persistence.
pub(crate) fn identity_blob_for(identity: &SectionIdentity) -> Option<Vec<u8>> {
    codec::serialize_named(identity)
        .map(|body| codec::tag_blob(SECTION_IDENTITY_BLOB_VERSION, body))
        .ok()
}

/// Remove an activity from candidate registry and section tiers.
pub(crate) fn purge_activity_from_tiers(
    identity: &mut SectionIdentity,
    sections: &mut [FrequentSection],
    activity_id: &str,
) -> bool {
    /// Whether the section carried the activity at all, and how many
    /// passes left with it.
    fn drop_from(section: &mut FrequentSection, activity_id: &str) -> (bool, u32) {
        let ids_before = section.activity_ids.len();
        section.activity_ids.retain(|a| a != activity_id);
        let before = section.activity_portions.len();
        section
            .activity_portions
            .retain(|p| p.activity_id != activity_id);
        let dropped = (before - section.activity_portions.len()) as u32;
        section.visit_count = section.visit_count.saturating_sub(dropped);
        (
            dropped > 0 || section.activity_ids.len() != ids_before,
            dropped,
        )
    }
    let mut moved = false;
    // The pure layer holds its own count per visible id, and reads a
    // batch that counts fewer passes on an unchanged line as a re-cut.
    // Telling it what left keeps a deletion from narrating one.
    let mut dropped_by_pid: Vec<(String, u32)> = Vec::new();
    for (pid, row) in identity.rows.iter_mut() {
        let (touched, dropped) = drop_from(&mut row.section, activity_id);
        moved |= touched;
        if dropped > 0 {
            dropped_by_pid.push((pid.clone(), dropped));
        }
    }
    for (pid, dropped) in dropped_by_pid {
        identity.hysteresis.drop_visits(&pid, dropped);
    }
    for row in identity.graves.values_mut() {
        moved |= drop_from(&mut row.section, activity_id).0;
    }
    moved |= identity.seen.remove(activity_id);
    for section in sections {
        drop_from(section, activity_id);
    }
    // The blob is the whole catalogue, and a bulk delete is one call per
    // activity, so an untouched registry writes nothing.
    moved
}

impl PersistentEngine {
    /// Record a durable suppression intent for a corridor the user hid
    /// (`kind = "disabled"`) or removed (`kind = "deleted"`), capturing the
    /// section's current ground so the emitter never re-detects it (invariant 6).
    /// Best-effort: a missing section is a no-op (nothing to suppress) and a write
    /// failure logs rather than propagates, the worst case is the older
    /// behaviour where the corridor could re-emerge, never a crash. For a delete,
    /// call this BEFORE the row is gone.
    pub(crate) fn record_section_intent(&self, section_id: &str, kind: &str) {
        // A missing row is a no-op; a row whose geometry will not decode still
        // gets its intent, so suppression by id survives as it did before.
        let exists: bool = self
            .db
            .query_row(
                "SELECT 1 FROM sections WHERE id = ?",
                rusqlite::params![section_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            return;
        }
        // The intent keeps its own footprint, the section's decoded line.
        let polyline = self.stored_section_polyline(section_id).unwrap_or_default();
        if let Err(e) = self.db.execute(
            "INSERT INTO section_intents (id, kind, polyline_blob, polyline_json, created_at)
             VALUES (?, ?, ?, NULL, datetime('now'))
             ON CONFLICT(id, kind) DO UPDATE SET
                polyline_blob = excluded.polyline_blob,
                polyline_json = NULL,
                created_at = excluded.created_at",
            rusqlite::params![section_id, kind, codec::serialize_track_points(&polyline)],
        ) {
            log::warn!("veloqrs: [record_section_intent] {section_id} ({kind}): {e}");
        }
    }

    /// Clear a section's suppression intent (on enable), so its corridor can be
    /// detected again. Best-effort. Kind-scoped so an enable can never take a
    /// named intent with it.
    pub(crate) fn clear_section_intent(&self, section_id: &str) {
        if let Err(e) = self.db.execute(
            "DELETE FROM section_intents WHERE id = ? AND kind IN ('disabled', 'deleted')",
            rusqlite::params![section_id],
        ) {
            log::warn!("veloqrs: [clear_section_intent] {section_id}: {e}");
        }
    }

    /// Bounding boxes and ground of the accepted sections. A candidate mostly
    /// inside one of these boxes and lying along its ground is the same corridor
    /// drawn coarsely, so it is suppressed before the registry sees it rather
    /// than dropped at save, where it would leave a row behind with no
    /// catalogue entry.
    fn accepted_section_bounds(&self) -> Vec<AcceptedBounds> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index
             FROM sections WHERE is_user_defined = 1 AND bounds_min_lat IS NOT NULL",
        ) else {
            return Vec::new();
        };
        // Collected before resolving: the rebuild queries the same connection
        // this statement is still walking.
        let rows: Vec<_> = match stmt.query_map([], |row| {
            Ok((
                [row.get::<_, f64>(1)?, row.get(2)?, row.get(3)?, row.get(4)?],
                row.get::<_, Option<Vec<u8>>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<u32>>(8)?,
                row.get::<_, Option<u32>>(9)?,
            ))
        }) {
            Ok(iter) => iter.flatten().collect(),
            Err(_) => return Vec::new(),
        };
        drop(stmt);
        rows.into_iter()
            .filter_map(
                |([min_lat, max_lat, min_lng, max_lng], blob, json, rep_id, start, end)| {
                    let reference = geometry::reference(rep_id.as_deref(), start, end);
                    let ground =
                        geometry::line(&self.db, blob.as_deref(), json.as_deref(), reference)
                            .ok()
                            .filter(|pts| !pts.is_empty())?;
                    Some(AcceptedBounds {
                        min_lat,
                        max_lat,
                        min_lng,
                        max_lng,
                        ground,
                    })
                },
            )
            .collect()
    }

    /// Grounds (polylines) and ids of the durable-intent DB rows the emitter must
    /// not re-emit. Two sources, both read raw from the DB because they are the
    /// authority the registry defers to:
    ///
    /// - The wipe-spared section rows, custom, backed-up (trimmed/set-ref), or
    ///   user-defined (accepted/renamed/merged), whose ground a fresh auto
    ///   section would collide with on `UNIQUE sections.id`.
    /// - The `section_intents` suppression records, user-disabled and
    ///   user-deleted corridors that must stay hidden across restart (invariant 6).
    ///   The disabled section's own row is is_user_defined=0 and the deleted row
    ///   is gone, so neither is caught by the first query; the retained intent
    ///   ground is what keeps the corridor from re-emerging.
    fn durable_intent_rows(&self) -> (Vec<Vec<GpsPoint>>, BTreeSet<String>) {
        let mut grounds = Vec::new();
        let mut ids = BTreeSet::new();
        {
            let mut stmt = match self.db.prepare(concat!(
                "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                        rep_start_index, rep_end_index
                 FROM sections
                 WHERE section_type = 'custom'
                    OR is_user_defined = 1
                    OR ",
                super::has_original_line!()
            )) {
                Ok(s) => s,
                Err(_) => return (grounds, ids),
            };
            // Collected before resolving: the rebuild queries the same
            // connection this statement is still walking.
            let rows: Vec<_> = match stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<u32>>(4)?,
                    row.get::<_, Option<u32>>(5)?,
                ))
            }) {
                Ok(iter) => iter.flatten().collect(),
                Err(_) => return (grounds, ids),
            };
            drop(stmt);
            for (id, blob, json, rep_id, start, end) in rows {
                ids.insert(id);
                // The blob is a cache. A cleared one still has to yield the
                // ground, or the corridor the user shaped is re-emitted under
                // a second id on the next detect.
                let reference = geometry::reference(rep_id.as_deref(), start, end);
                if let Ok(pts) =
                    geometry::line(&self.db, blob.as_deref(), json.as_deref(), reference)
                    && !pts.is_empty()
                {
                    grounds.push(pts);
                }
            }
        }
        // INVARIANT: suppression reads disabled/deleted rows ONLY. kind='named'
        // rows share this table but are the opposite of suppression, a named
        // corridor must keep detecting and evolving. Widening this query back to
        // all kinds would make naming a corridor silently hide it
        // (`naming_never_suppresses_corridor` is the regression gate).
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, polyline_blob, polyline_json FROM section_intents
             WHERE kind IN ('disabled', 'deleted')",
        ) {
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            });
            if let Ok(iter) = rows {
                for (id, blob, json) in iter.flatten() {
                    ids.insert(id);
                    if let Ok(pts) = codec::decode_polyline_row(blob.as_deref(), json.as_deref())
                        && !pts.is_empty()
                    {
                        grounds.push(pts);
                    }
                }
            }
        }
        (grounds, ids)
    }
}

/// Bounding box of an accepted section, in degrees, with its ground.
struct AcceptedBounds {
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
    ground: Vec<GpsPoint>,
}

/// How far a candidate may sit from an accepted section's line and still be
/// that section drawn coarsely.
const COARSE_REDRAW_TOL_M: f64 = 150.0;

/// Fraction of `samples` within `tol_m` of the polyline `line`, measured to its
/// segments so a sparsely drawn line is not read as a row of isolated points.
fn fraction_near_line(samples: &[GpsPoint], line: &[GpsPoint], tol_m: f64) -> f64 {
    if samples.is_empty() || line.len() < 2 {
        return 0.0;
    }
    let lat0 = line[0].latitude.to_radians();
    let to_xy = |p: &GpsPoint| {
        (
            p.longitude.to_radians() * lat0.cos() * 6_371_000.0,
            p.latitude.to_radians() * 6_371_000.0,
        )
    };
    let segments: Vec<((f64, f64), (f64, f64))> = line
        .windows(2)
        .map(|w| (to_xy(&w[0]), to_xy(&w[1])))
        .collect();
    let near = samples
        .iter()
        .filter(|s| {
            let (sx, sy) = to_xy(s);
            segments.iter().any(|&((ax, ay), (bx, by))| {
                let (dx, dy) = (bx - ax, by - ay);
                let len2 = dx * dx + dy * dy;
                let t = if len2 > 0.0 {
                    (((sx - ax) * dx + (sy - ay) * dy) / len2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let (px, py) = (ax + t * dx - sx, ay + t * dy - sy);
                px * px + py * py <= tol_m * tol_m
            })
        })
        .count();
    near as f64 / samples.len() as f64
}

/// Whether a candidate is an accepted section's ground drawn coarsely: most of
/// its bounding box sits inside the accepted box, and a majority of its points
/// lie within [`COARSE_REDRAW_TOL_M`] of the accepted line. The box is only a
/// prefilter; a road through the interior of an accepted loop passes it and
/// fails the ground test.
fn bbox_dominated(polyline: &[GpsPoint], accepted: &[AcceptedBounds]) -> bool {
    if accepted.is_empty() || polyline.len() < 2 {
        return false;
    }
    let b = tracematch::geo_utils::compute_bounds(polyline);
    let area = (b.max_lat - b.min_lat) * (b.max_lng - b.min_lng);
    if area <= 0.0 {
        return false;
    }
    accepted.iter().any(|a| {
        let min_lat = b.min_lat.max(a.min_lat);
        let max_lat = b.max_lat.min(a.max_lat);
        let min_lng = b.min_lng.max(a.min_lng);
        let max_lng = b.max_lng.min(a.max_lng);
        if min_lat >= max_lat || min_lng >= max_lng {
            return false;
        }
        ((max_lat - min_lat) * (max_lng - min_lng)) / area > 0.45
            && fraction_near_line(polyline, &a.ground, COARSE_REDRAW_TOL_M)
                >= tracematch::sections::CARRY_COVERAGE
    })
}

/// Whether a candidate polyline is the same corridor as any durable-intent
/// ground (the harness ground metric: majority coverage either way at 50 m).
fn ground_owned_by_intent(polyline: &[GpsPoint], intent_grounds: &[Vec<GpsPoint>]) -> bool {
    intent_grounds.iter().any(|g| shares_ground(polyline, g))
}

/// Whether the detector's cut counted `activity_id` against the line it drew.
///
/// The cut counts every track of its partition, the whole pool under
/// `pool_sports` and one sport otherwise, so a track of the partition it leaves
/// out is one it rejected. The line it counted against can be longer than the
/// line it ships, since a chain meet or a seam clip shortens the drawn line
/// after the count, so the shipped line cannot stand in for that verdict.
fn cut_judged(
    metadata: &HashMap<String, crate::persistence::ActivityMetadata>,
    pooled: bool,
    cut: &FrequentSection,
    activity_id: &str,
) -> bool {
    metadata
        .get(activity_id)
        .is_some_and(|m| pooled || m.sport_type == cut.sport_type)
}

/// One arrival's passes over a carried section: the cut's own passes when the
/// cut counted the ride, which are the rows a batch of the same rides writes,
/// and the held line's when the cut never saw it.
fn arrival_portions<'a>(
    aid: &str,
    track: &[GpsPoint],
    cut: Option<&FrequentSection>,
    judged: &dyn Fn(&FrequentSection, &str) -> bool,
    line: &mut Option<Option<tracematch::PreparedLine<'a>>>,
    polyline: &'a [GpsPoint],
    config: &SectionConfig,
) -> Vec<tracematch::SectionPortion> {
    match cut {
        Some(cut) if judged(cut, aid) => cut
            .activity_portions
            .iter()
            .filter(|p| p.activity_id == aid)
            .cloned()
            .collect(),
        _ => line
            .get_or_insert_with(|| tracematch::PreparedLine::new(polyline, config))
            .as_ref()
            .map(|l| l.portions(aid, track))
            .unwrap_or_default(),
    }
}

/// Append-only fold: add each new activity the cut counts on this ground, and
/// only those. Never removes a member and never adopts the batch's
/// re-clustered set, so a carried section is monotone across an add, the
/// property the strict single-add gates assert. New laps bump `visit_count` in
/// step with the junction rows `save_sections` will write.
fn fold_new_activities(
    section: &mut FrequentSection,
    cut: Option<&FrequentSection>,
    judged: &dyn Fn(&FrequentSection, &str) -> bool,
    new_tracks: &BTreeMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) {
    // Cloned so the fold can keep pushing members while the matcher, built
    // at most once for the whole fold, still holds the line.
    let polyline = section.polyline.clone();
    let mut line = None;
    for (aid, track) in new_tracks {
        if section.activity_ids.iter().any(|x| x == aid) {
            continue;
        }
        let portions = arrival_portions(aid, track, cut, judged, &mut line, &polyline, config);
        if portions.is_empty() {
            continue;
        }
        section.activity_ids.push(aid.clone());
        section.visit_count += portions.len() as u32;
        section.activity_portions.extend(portions);
    }
}

/// Append `prior` members missing from an adopted batch payload that the cut
/// never counted, a member of another sport when sports are not pooled, whose
/// tracks still match the new polyline. A member the cut counted and left out
/// stays out: the member-loss guard has already held the adoption back as a
/// debounced re-cut, and a re-cut that fires is the cut's verdict holding.
/// Portions are computed against the NEW geometry so the junction rows
/// `save_sections` writes stay coherent; a member whose track genuinely left
/// the adopted ground stays dropped.
fn graft_prior_members(
    engine: &PersistentEngine,
    section: &mut FrequentSection,
    cut: &FrequentSection,
    prior: &FrequentSection,
    judged: &dyn Fn(&FrequentSection, &str) -> bool,
    config: &SectionConfig,
) {
    let have: BTreeSet<&str> = section.activity_ids.iter().map(String::as_str).collect();
    let missing: Vec<String> = prior
        .activity_ids
        .iter()
        .filter(|aid| !have.contains(aid.as_str()) && !judged(cut, aid))
        .cloned()
        .collect();
    if missing.is_empty() {
        return;
    }
    // Cloned so the fold can keep pushing members while the matcher, built
    // once for the whole fold, still holds the line.
    let polyline = section.polyline.clone();
    let Some(line) = tracematch::PreparedLine::new(&polyline, config) else {
        return;
    };
    for aid in missing {
        let Some(track) = engine.get_gps_track(&aid) else {
            continue;
        };
        let portions = line.portions(&aid, &track);
        if portions.is_empty() {
            continue;
        }
        section.activity_ids.push(aid);
        section.visit_count += portions.len() as u32;
        section.activity_portions.extend(portions);
    }
}

/// The id a section carries from birth: `s_<lat>_<lng>`, from the 100 m
/// earth cell its heart sits in. Ground has no sport, so the id names none.
/// A stable, readable name, unique within one library and reproducible for
/// the same activities arriving in the same order under the same config: a
/// carried id keeps the heart of its first cut, and the ordinal is chosen
/// against every id the library has held, so the id depends on the arrival
/// sequence as well as the pool. Ground, not the id, agrees across arrival
/// orders. It is not a cross-library key: two
/// cuts of one corridor seldom put the heart in the same cell, and matching
/// ground across cuts is [`tracematch::shares_ground`]'s job. A cell already
/// taken (a neighbour on the same block, or a grave) gets the next free
/// ordinal; a section with no line falls back to the clock, which never
/// collides. An id minted with a sport term before is kept, never re-keyed:
/// the record tables key on it.
pub fn content_id_for(polyline: &[GpsPoint], taken: &BTreeSet<String>) -> Option<String> {
    let heart = tracematch::section_heart(polyline)?;
    let (lat, lng) = tracematch::earth_cell(&heart);
    let base = format!("s_{lat}_{lng}");
    if !taken.contains(&base) {
        return Some(base);
    }
    (2u32..)
        .map(|n| format!("{base}_{n}"))
        .find(|id| !taken.contains(id))
}

fn mint_content_id(section: &FrequentSection, taken: &BTreeSet<String>, seq: &mut u64) -> String {
    if let Some(id) = content_id_for(&section.polyline, taken) {
        return id;
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("s_{}__{:06}", ts, *seq);
    *seq += 1;
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::codec;
    use tempfile::TempDir;
    use tracematch::{
        CandidateSection as PureCandidate, Decision, IdentityParams, PriorSection, RetireReason,
        Retirement, plan_identity_tuned,
    };

    /// Scenario: two sections have their hearts in one cell, one of them
    /// ridden and the other run.
    /// Expected behaviour: the first takes the cell's id and the second its
    /// next ordinal, and neither id names a sport.
    #[test]
    fn a_minted_id_names_the_cell_and_no_sport() {
        let line = track();
        let first = content_id_for(&line, &BTreeSet::new()).expect("a line has a heart");
        let second =
            content_id_for(&line, &BTreeSet::from([first.clone()])).expect("a free ordinal");

        assert_eq!(second, format!("{first}_2"));
        for id in [&first, &second] {
            assert!(
                !["ride", "run", "all"]
                    .iter()
                    .any(|sport| id.contains(sport)),
                "{id}"
            );
        }
    }

    /// Scenario: detection hands the registry a cut labelled Ride whose
    /// members are all stored as runs.
    ///
    /// Expected behaviour: the row the registry carries out is labelled Run,
    /// the sport its members do, and not the label it arrived with.
    #[test]
    fn a_carried_row_takes_its_members_dominant_sport() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine =
            PersistentEngine::new(dir.path().join("sport.db").to_str().unwrap()).expect("engine");
        for id in ["a1", "a2"] {
            engine
                .add_activity(id.into(), track(), "Run".into())
                .expect("add_activity");
        }
        assert!(engine.section_config.pool_sports);
        let cut = FrequentSection {
            polyline: track(),
            point_density: vec![2; track().len()],
            activity_ids: vec!["a1".to_string(), "a2".to_string()],
            visit_count: 2,
            sport_type: "Ride".to_string(),
            ..sample_registry_section()
        };

        let mut identity = SectionIdentity::default();
        let carried = engine
            .section_identity_apply_into(&mut identity, SectionReplay::whole(vec![cut]))
            .visible;

        assert_eq!(carried.len(), 1, "the cut is carried");
        assert_eq!(carried[0].sport_type, "Run");
    }

    /// A row none of whose members has a known sport keeps its label, and a
    /// row already matching its members is unchanged.
    #[test]
    fn relabelling_leaves_rows_without_known_member_sports_alone() {
        let row = |id: &str, sport: &str, members: &[&str]| {
            let section = FrequentSection {
                id: id.to_string(),
                sport_type: sport.to_string(),
                activity_ids: members.iter().map(|m| m.to_string()).collect(),
                ..sample_registry_section()
            };
            (
                id.to_string(),
                IdentityRow {
                    real_id: id.to_string(),
                    section,
                },
            )
        };
        let mut rows: BTreeMap<String, IdentityRow> = [
            row("a", "Ride", &["r1", "r2", "b1"]),
            row("b", "Ride", &["unknown1"]),
            row("c", "Run", &["r1"]),
        ]
        .into_iter()
        .collect();
        let sports: HashMap<String, String> = [("r1", "Run"), ("r2", "Run"), ("b1", "Ride")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        relabel_by_member_sport(&mut rows, &sports);

        assert_eq!(rows["a"].section.sport_type, "Run");
        assert_eq!(rows["b"].section.sport_type, "Ride");
        assert_eq!(rows["c"].section.sport_type, "Run");
    }

    #[test]
    fn split_piece_order_follows_the_parent_line_in_either_direction() {
        let parent: Vec<GpsPoint> = (0..5)
            .map(|i| GpsPoint::new(46.0, 7.0 + i as f64 * 0.001))
            .collect();
        let first = vec![GpsPoint::new(46.0, 7.0002), GpsPoint::new(46.0, 7.0012)];
        let last = vec![GpsPoint::new(46.0, 7.0028), GpsPoint::new(46.0, 7.0038)];
        let reverse: Vec<GpsPoint> = parent.iter().copied().rev().collect();

        assert!(
            split_piece_progress(&parent, &first).unwrap()
                < split_piece_progress(&parent, &last).unwrap()
        );
        assert!(
            split_piece_progress(&reverse, &first).unwrap()
                > split_piece_progress(&reverse, &last).unwrap()
        );
    }

    /// Scenario: a short senior prior sits inside a much longer candidate that
    /// a longer junior also covers. With the size ratio off the senior takes
    /// the candidate on age alone, so the catalogue's memory of a 1.3 km
    /// stretch, its name, birth date and PR era, lands on a 200 m one.
    ///
    /// Expected behaviour: the value this crate actually ships refuses that
    /// inherit, and 0.0 allows it. The pure layer covers the mechanism at
    /// hand-picked ratios; what is pinned here is that the number the engine
    /// hands it is one of the ones that works, since that constant is a single
    /// line nothing else guards.
    #[test]
    fn the_shipped_merge_size_ratio_refuses_the_small_senior_capture() {
        let long: Vec<GpsPoint> = (0..120)
            .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0001, 7.0))
            .collect();
        let prior_of = |id: &str, points: &[GpsPoint], created: u64, visits: u32| PriorSection {
            id: id.to_string(),
            polyline: points.to_vec(),
            first_seen: created,
            visit_count: visits,
        };
        let priors = vec![
            prior_of("s_A", &long[..20], 1, 3),
            prior_of("s_B", &long[..90], 2, 9),
        ];
        let next = vec![PureCandidate {
            polyline: long.clone(),
            visit_count: 12,
        }];

        let shipped = plan_identity_tuned(
            &priors,
            &next,
            &IdentityParams {
                merge_mutual_floor: MERGE_MUTUAL_FLOOR,
                merge_size_ratio: MERGE_SIZE_RATIO,
            },
        );
        assert_eq!(
            shipped.decisions,
            vec![Decision::MergeInherit { id: "s_B".into() }],
            "the shipped ratio must hand the corridor to the prior that covers it"
        );
        assert_eq!(
            shipped.retired,
            vec![Retirement {
                id: "s_A".into(),
                reason: RetireReason::MergedInto { id: "s_B".into() },
            }],
            "and the dwarfed senior retires into it rather than being dissolved"
        );

        let off = plan_identity_tuned(
            &priors,
            &next,
            &IdentityParams {
                merge_mutual_floor: MERGE_MUTUAL_FLOOR,
                merge_size_ratio: 0.0,
            },
        );
        assert_eq!(
            off.decisions,
            vec![Decision::MergeInherit { id: "s_A".into() }],
            "at 0.0 the capture is allowed, which is what makes the assertion above a test"
        );
    }

    fn event(kind: &'static str) -> SectionLifecycleEvent {
        SectionLifecycleEvent {
            real_id: "s".into(),
            kind,
            details: None,
            geometry: None,
            reference: None,
        }
    }

    #[test]
    fn lifecycle_events_count_as_added_changed_and_retired() {
        let events: Vec<_> = [
            "formed",
            "formed",
            "restored",
            "split",
            "recut",
            "merged",
            "dissolved",
            "dissolved",
        ]
        .into_iter()
        .map(event)
        .collect();
        assert_eq!(
            SectionChangeCounts::from_events(&events),
            SectionChangeCounts {
                added: 3,
                changed: 2,
                retired: 3
            }
        );
        assert_eq!(
            SectionChangeCounts::from_events(&[]),
            SectionChangeCounts::default()
        );
    }

    /// A section with no elevation, which is every section in a library that
    /// pre-dates the 0.4.0 elevation backfill.
    fn section_without_elevation() -> FrequentSection {
        FrequentSection {
            elevation_gain_m: None,
            avg_grade_percent: None,
            ..sample_registry_section()
        }
    }

    fn sample_registry_section() -> FrequentSection {
        FrequentSection {
            id: "s_1700000000000__ab12cd".to_string(),
            name: Some("The Wall".to_string()),
            sport_type: "Ride".to_string(),
            distance_meters: 1200.0,
            point_density: vec![2, 2],
            polyline: vec![
                GpsPoint::with_elevation(46.0, 7.0, 500.0),
                GpsPoint::with_elevation(46.001, 7.0, 510.0),
            ],
            representative_activity_id: "a1".to_string(),
            representative_range: Some((0, 12)),
            activity_ids: vec!["a1".to_string()],
            activity_portions: vec![],
            visit_count: 3,
            activity_traces: HashMap::new(),
            confidence: 0.9,
            observation_count: 3,
            average_spread: 4.0,
            scale: None,
            is_user_defined: false,
            stability: 1.0,
            elevation_gain_m: Some(12.0),
            avg_grade_percent: Some(1.5),
            version: 7,
            updated_at: None,
            created_at: None,
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        }
    }

    /// An engine whose in-memory registry holds one row, so the blob it writes
    /// is the one the launch restore reads.
    fn engine_holding(dir: &TempDir, section: FrequentSection) -> PersistentEngine {
        let path = dir.path().join("identity.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine.identity.rows.insert(
            "s_1".to_string(),
            IdentityRow {
                real_id: section.id.clone(),
                section,
            },
        );
        engine
    }

    /// Write the registry the way a catalogue save does, then read it the way
    /// the next launch does.
    fn round_trip(engine: &mut PersistentEngine) -> bool {
        engine.section_identity_persist();
        engine.identity = SectionIdentity::default();
        engine.section_identity_restore()
    }

    /// Scenario: the persisted registry carries `FrequentSection`s, and that
    /// type skips `elevation_gain_m` and `avg_grade_percent` when they are
    /// None. Every section in a library that pre-dates the elevation backfill
    /// has both.
    /// Expected behaviour: the blob reads back. A positional encoding writes a
    /// short array for such a section and every field after it decodes as the
    /// wrong type, which is a registry that can never be restored. The launch
    /// reseeds and re-persists through the same encoder, so the failure repeats
    /// on every launch rather than costing one.
    #[test]
    fn a_registry_holding_a_section_without_elevation_reads_back() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_holding(&dir, section_without_elevation());

        assert!(
            round_trip(&mut engine),
            "a registry has to survive its own encoding"
        );

        let row = engine.identity.rows.get("s_1").expect("the row");
        assert_eq!(row.section.elevation_gain_m, None);
        assert_eq!(row.section.version, 7);
        assert_eq!(row.section.name.as_deref(), Some("The Wall"));
    }

    #[test]
    fn a_registry_holding_an_elevated_section_reads_back() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_holding(&dir, sample_registry_section());

        assert!(round_trip(&mut engine));

        let row = engine.identity.rows.get("s_1").expect("the row");
        assert_eq!(row.section.elevation_gain_m, Some(12.0));
        assert_eq!(row.section.version, 7);
    }

    /// The tag is the only thing standing between a blob written by an older
    /// build and a misparse, so a blob carrying any other version reseeds.
    #[test]
    fn a_blob_from_an_older_version_is_refused() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_holding(&dir, sample_registry_section());
        let body = codec::serialize_named(&engine.identity).expect("encode");

        for stale in 0..SECTION_IDENTITY_BLOB_VERSION {
            let tagged = codec::tag_blob(stale, body.clone());
            assert!(
                codec::untag_blob(SECTION_IDENTITY_BLOB_VERSION, &tagged).is_none(),
                "version {stale} must not read as the current one"
            );
        }
    }

    /// What the version byte is now standing in front of: the encoding this
    /// replaced could not read its own output for such a section.
    #[test]
    fn the_positional_encoding_could_not_read_its_own_output() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_holding(&dir, section_without_elevation());
        let positional = codec::serialize_gps_composite(&engine.identity).expect("encode");

        assert!(codec::deserialize_gps_composite::<SectionIdentity>(&positional).is_err());
    }

    fn track() -> Vec<GpsPoint> {
        (0..40)
            .map(|i| GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.000_1,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// An engine holding one stored stream and one durable-intent row whose
    /// line is a real slice of it.
    fn engine_with_durable_row(dir: &TempDir) -> PersistentEngine {
        let path = dir.path().join("intent.db");
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
                      original_polyline_json)
                 VALUES ('s_trimmed', 'auto', 'Trimmed', 'Ride', NULL, ?, 1200.0,
                         'a1', 0, 12, 'exact', '2026-01-01T00:00:00Z', 0, '[]')",
                rusqlite::params![codec::serialize_track_points(&line)],
            )
            .expect("insert the durable row");
        engine
    }

    /// Scenario: a marginal senior and a dominant junior both merely contained
    /// in one corridor, driven through the registry's own default hysteresis.
    ///
    /// Expected behaviour: the short senior does not take the long corridor and
    /// the prior that described it is not tombstoned.
    #[test]
    fn the_shipped_merge_guards_deny_a_marginal_senior_the_corridor() {
        let long: Vec<GpsPoint> = (0..120)
            .map(|i| GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.000_1,
                longitude: 7.0,
                elevation: None,
            })
            .collect();
        let short = long[..20].to_vec();
        let most = long[..90].to_vec();
        let candidate = |polyline: Vec<GpsPoint>, visit_count: u32| CandidateSection {
            polyline,
            visit_count,
        };
        let id_on = |state: &HysteresisState, ground: &[GpsPoint]| {
            state
                .visible_grounds()
                .into_iter()
                .find(|(_, g)| tracematch::mutual_overlap(g, ground) >= 0.85)
                .map(|(id, _)| id)
        };

        let mut state = SectionIdentity::default().hysteresis;
        state.step(&[candidate(short.clone(), 3), candidate(most.clone(), 9)]);
        let a = id_on(&state, &short).expect("the marginal senior is visible");
        let b = id_on(&state, &most).expect("the dominant junior is visible");
        assert_ne!(a, b, "they are two sections");

        for _ in 0..(HysteresisParams::default().k + 2) {
            state.step(&[candidate(long.clone(), 12)]);
        }

        assert!(
            !state
                .ground_of(&a)
                .is_some_and(|g| tracematch::mutual_overlap(g, &long) >= 0.85),
            "the marginal senior must not end up holding the long corridor"
        );
        assert!(
            !state.is_tombstoned(&b),
            "and the section that described that ground must not be tombstoned"
        );
    }

    /// Scenario: a trimmed section keeps its ground through a detect, and the
    /// registry learns which ground that is by reading the row. A cleared
    /// cache is what the read has to survive.
    ///
    /// Expected behaviour: the ground comes back rebuilt from the triple. An
    /// empty one would let the detector re-emit the corridor the user already
    /// shaped, under a second id.
    #[test]
    fn a_durable_intent_ground_rebuilds_after_the_cache_is_cleared() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_durable_row(&dir);
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL",
                [],
            )
            .expect("clear the cached geometry");

        let (grounds, ids) = engine.durable_intent_rows();

        assert!(ids.contains("s_trimmed"), "the id is read from the row");
        assert_eq!(
            grounds.iter().map(|g| g.len()).collect::<Vec<_>>(),
            vec![12],
            "the ground has to be rebuilt from the triple, not dropped"
        );
    }

    /// The cached blob is still the first answer, so the ordinary read costs
    /// no rebuild.
    #[test]
    fn a_durable_intent_ground_reads_the_cache_when_it_is_there() {
        let dir = TempDir::new().expect("tempdir");
        let engine = engine_with_durable_row(&dir);

        let (grounds, _) = engine.durable_intent_rows();

        assert_eq!(
            grounds.iter().map(|g| g.len()).collect::<Vec<_>>(),
            vec![12]
        );
    }

    /// A line of `n` points running north from `lat`, about 11 m apart.
    fn line_at(lat: f64, n: u32) -> Vec<GpsPoint> {
        (0..n)
            .map(|i| GpsPoint::new(lat + f64::from(i) * 0.000_1, 7.0))
            .collect()
    }

    /// A raw detection cut on `line` whose members are `members`.
    fn raw_cut(line: Vec<GpsPoint>, members: &[&str]) -> FrequentSection {
        FrequentSection {
            id: "raw".to_string(),
            name: None,
            point_density: vec![2; line.len()],
            polyline: line,
            representative_activity_id: members[0].to_string(),
            activity_ids: members.iter().map(|m| m.to_string()).collect(),
            visit_count: members.len() as u32,
            version: 0,
            ..sample_registry_section()
        }
    }

    /// The ground the seed holds, which every later catalogue drops.
    fn hill() -> Vec<GpsPoint> {
        line_at(47.0, 40)
    }

    /// Ground first cut long, then cut to its first half.
    fn valley_long() -> Vec<GpsPoint> {
        line_at(46.0, 40)
    }

    fn valley_short() -> Vec<GpsPoint> {
        line_at(46.0, 20)
    }

    /// An engine holding one hill ride, its registry seeded by one apply of a
    /// catalogue holding the hill.
    fn seeded(dir: &TempDir) -> (PersistentEngine, SectionIdentity) {
        let path = dir.path().join("replay.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .add_activity("hill-1".into(), hill(), "Ride".into())
            .expect("add_activity");
        let mut identity = SectionIdentity::default();
        let seed = engine.section_identity_apply_into(
            &mut identity,
            SectionReplay::whole(vec![raw_cut(hill(), &["hill-1"])]),
        );
        assert_eq!(seed.visible.len(), 1, "the seed holds the hill");
        (engine, identity)
    }

    fn add_valley_ride(engine: &mut PersistentEngine, id: &str) {
        engine
            .add_activity(id.into(), valley_long(), "Ride".into())
            .expect("add_activity");
    }

    const VALLEY_RIDES: [&str; 4] = ["valley-1", "valley-2", "valley-3", "valley-4"];

    /// The raw catalogue detection cut after each valley ride: the hill is gone
    /// from the first, the valley is cut long by the first and short after,
    /// and the fourth ride changes no cut.
    fn valley_catalogues() -> Vec<Vec<FrequentSection>> {
        vec![
            vec![raw_cut(valley_long(), &VALLEY_RIDES[..1])],
            vec![raw_cut(valley_short(), &VALLEY_RIDES[..2])],
            vec![raw_cut(valley_short(), &VALLEY_RIDES[..3])],
            vec![raw_cut(valley_short(), &VALLEY_RIDES[..3])],
        ]
    }

    /// The same catalogues as a replay of the blocks each ride changed.
    fn valley_replay() -> SectionReplay<&'static str> {
        let mut catalogues = valley_catalogues().into_iter();
        let mut next = || catalogues.next().expect("a catalogue per ride");
        let step = |ride: &str, changed| ReplayStep {
            arrival: Arrival::Activity(ride.to_string()),
            changed,
        };
        SectionReplay::new(vec![
            step(
                VALLEY_RIDES[0],
                vec![("hill", None), ("valley", Some(next()))],
            ),
            step(VALLEY_RIDES[1], vec![("valley", Some(next()))]),
            step(VALLEY_RIDES[2], vec![("valley", Some(next()))]),
            step(VALLEY_RIDES[3], Vec::new()),
        ])
    }

    /// The registry with the birth stamps cleared, which read the clock.
    fn registry_bytes(identity: &SectionIdentity) -> Vec<u8> {
        let mut identity = identity.clone();
        for row in identity
            .rows
            .values_mut()
            .chain(identity.graves.values_mut())
        {
            row.section.created_at = None;
        }
        codec::serialize_named(&identity).expect("encode")
    }

    fn catalogue_json(sections: &[FrequentSection]) -> serde_json::Value {
        let cleared: Vec<FrequentSection> = sections
            .iter()
            .cloned()
            .map(|mut s| {
                s.created_at = None;
                s
            })
            .collect();
        serde_json::to_value(cleared).expect("encode")
    }

    type EventRow = (
        String,
        &'static str,
        Option<String>,
        Option<Vec<GpsPoint>>,
        Option<(String, u32, u32)>,
    );

    fn event_rows(events: &[SectionLifecycleEvent]) -> Vec<EventRow> {
        events
            .iter()
            .map(|e| {
                (
                    e.real_id.clone(),
                    e.kind,
                    e.details.clone(),
                    e.geometry.clone(),
                    e.reference.clone(),
                )
            })
            .collect()
    }

    fn around_of(event: &EventRow) -> Vec<String> {
        event
            .2
            .as_deref()
            .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok())
            .and_then(|d| d.get("around").cloned())
            .map(|a| serde_json::from_value(a).expect("a list of ids"))
            .unwrap_or_default()
    }

    fn pure_id_of(identity: &SectionIdentity, real_id: &str) -> Option<String> {
        identity
            .rows
            .iter()
            .chain(identity.graves.iter())
            .find(|(_, r)| r.real_id == real_id)
            .map(|(pid, _)| pid.clone())
    }

    /// Scenario: four rides arrive after a seed that holds the hill, and the
    /// catalogue cut after each of them drops the hill and cuts the valley,
    /// long after the first and short after the rest. Once as one detect per
    /// ride, once as one detect for all four whose catalogues are replayed.
    /// Expected behaviour: both land on the same visible catalogue, ids,
    /// pending ledger, tombstones and events. The hill dissolves on the third
    /// arrival and its retirement names the three it was pending across; the
    /// valley minted at the first is re-cut at the fourth, a step whose
    /// catalogue is carried over unchanged.
    #[test]
    fn a_replay_of_arrivals_lands_where_one_apply_per_arrival_lands() {
        let one_by_one_dir = TempDir::new().expect("tempdir");
        let (mut one_by_one, mut one_by_one_identity) = seeded(&one_by_one_dir);
        let hill_id = one_by_one_identity
            .rows
            .values()
            .next()
            .expect("the hill row")
            .real_id
            .clone();
        let mut one_by_one_events = Vec::new();
        let mut one_by_one_visible = Vec::new();
        for (ride, catalogue) in VALLEY_RIDES.iter().zip(valley_catalogues()) {
            add_valley_ride(&mut one_by_one, ride);
            let applied = one_by_one.section_identity_apply_into(
                &mut one_by_one_identity,
                SectionReplay::whole(catalogue),
            );
            let rows = event_rows(&applied.events);
            let kinds: Vec<&str> = rows.iter().map(|e| e.1).collect();
            match *ride {
                "valley-1" => assert_eq!(kinds, ["formed"], "the valley is minted"),
                "valley-3" => {
                    assert_eq!(
                        kinds,
                        ["dissolved"],
                        "the hill dissolves on the third arrival"
                    );
                    assert_eq!(rows[0].0, hill_id);
                    assert_eq!(around_of(&rows[0]), VALLEY_RIDES[..3].to_vec());
                }
                "valley-4" => {
                    assert_eq!(kinds, ["recut"], "the short cut held for three arrivals");
                    assert_eq!(around_of(&rows[0]), VALLEY_RIDES[1..].to_vec());
                }
                _ => assert!(kinds.is_empty(), "{ride} fires nothing"),
            }
            one_by_one_events.extend(rows);
            one_by_one_visible = applied.visible;
        }

        let replay_dir = TempDir::new().expect("tempdir");
        let (mut replayed, mut replayed_identity) = seeded(&replay_dir);
        for ride in VALLEY_RIDES {
            add_valley_ride(&mut replayed, ride);
        }
        let applied = replayed.section_identity_apply_into(&mut replayed_identity, valley_replay());

        assert_eq!(
            catalogue_json(&applied.visible),
            catalogue_json(&one_by_one_visible)
        );
        assert_eq!(event_rows(&applied.events), one_by_one_events);
        assert_eq!(
            registry_bytes(&replayed_identity),
            registry_bytes(&one_by_one_identity),
            "ids, pending ledger, tombstones and seen set agree"
        );
        let hill_pid = pure_id_of(&replayed_identity, &hill_id).expect("the hill's grave");
        assert!(replayed_identity.hysteresis.is_tombstoned(&hill_pid));
        assert_eq!(
            catalogue_json(&applied.raw.expect("the last step's catalogue")),
            catalogue_json(&valley_catalogues()[3]),
            "the raw catalogue is the last step's"
        );
    }

    /// Scenario: the same four rides in one detect, with only the last
    /// catalogue applied, which is a detect that does not replay.
    /// Expected behaviour: the hill is still visible and pending after it.
    /// One step of absence is one step, however many rides it covered.
    #[test]
    fn one_apply_for_many_arrivals_steps_the_debounce_once() {
        let dir = TempDir::new().expect("tempdir");
        let (mut engine, mut identity) = seeded(&dir);
        let hill_id = identity
            .rows
            .values()
            .next()
            .expect("the hill")
            .real_id
            .clone();
        for ride in VALLEY_RIDES {
            add_valley_ride(&mut engine, ride);
        }

        let applied = engine.section_identity_apply_into(
            &mut identity,
            SectionReplay::whole(valley_catalogues().pop().expect("the last catalogue")),
        );

        assert!(applied.visible.iter().any(|s| s.id == hill_id));
        let hill_pid = pure_id_of(&identity, &hill_id).expect("the hill row");
        assert!(identity.hysteresis.pending_ids().contains(&hill_pid));
        assert!(!applied.events.iter().any(|e| e.kind == "dissolved"));
    }

    /// Scenario: one ride arrives, applied once as a one-step replay naming
    /// it and once as the whole-batch form.
    /// Expected behaviour: the two are the same apply.
    #[test]
    fn a_one_step_replay_is_the_whole_batch_apply() {
        let catalogue = valley_catalogues().remove(0);
        let whole_dir = TempDir::new().expect("tempdir");
        let (mut whole, mut whole_identity) = seeded(&whole_dir);
        add_valley_ride(&mut whole, VALLEY_RIDES[0]);
        let whole_applied = whole.section_identity_apply_into(
            &mut whole_identity,
            SectionReplay::whole(catalogue.clone()),
        );

        let step_dir = TempDir::new().expect("tempdir");
        let (mut step, mut step_identity) = seeded(&step_dir);
        add_valley_ride(&mut step, VALLEY_RIDES[0]);
        let step_applied = step.section_identity_apply_into(
            &mut step_identity,
            SectionReplay::new(vec![ReplayStep {
                arrival: Arrival::Activity(VALLEY_RIDES[0].to_string()),
                changed: vec![((), Some(catalogue))],
            }]),
        );

        assert_eq!(
            catalogue_json(&step_applied.visible),
            catalogue_json(&whole_applied.visible)
        );
        assert_eq!(
            event_rows(&step_applied.events),
            event_rows(&whole_applied.events)
        );
        assert_eq!(
            registry_bytes(&step_identity),
            registry_bytes(&whole_identity)
        );
    }

    /// Scenario: a detect with a ride stored but no step to replay.
    /// Expected behaviour: the registry does not move, nothing fires, the
    /// visible catalogue is the one the registry held, and there is no raw
    /// catalogue to store.
    #[test]
    fn an_empty_replay_steps_nothing() {
        let dir = TempDir::new().expect("tempdir");
        let (mut engine, mut identity) = seeded(&dir);
        add_valley_ride(&mut engine, VALLEY_RIDES[0]);
        let before = codec::serialize_named(&identity).expect("encode");
        let held: Vec<FrequentSection> =
            identity.rows.values().map(|r| r.section.clone()).collect();

        let applied =
            engine.section_identity_apply_into(&mut identity, SectionReplay::<()>::new(Vec::new()));

        assert_eq!(codec::serialize_named(&identity).expect("encode"), before);
        assert!(applied.events.is_empty());
        assert!(applied.raw.is_none());
        assert_eq!(catalogue_json(&applied.visible), catalogue_json(&held));
    }
}

#[cfg(test)]
#[path = "tests/registry_membership_judge.rs"]
mod registry_membership_judge;
