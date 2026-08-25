//! Assign-once section identity: the stateful half of B2.
//!
//! tracematch emits GROUND (sections with throwaway positional ids that
//! renumber on every detect — root R2). This layer owns the id over time: an
//! opaque `s_<ts>__<rand>` id assigned once and carried forward with its ground,
//! plus the hysteresis debounce that stops a single add flipping the visible
//! catalogue while it still converges to the batch. It generalises the one thing
//! that already survives resync today — a custom section's non-positional id
//! excluded from the detection wipe — to every auto section.
//!
//! The pure decision + debounce machinery lives in
//! `tracematch::sections::identity` ([`HysteresisState`]); this is the engine
//! registry on top. Two things the pure layer cannot hold:
//!
//! - REAL IDS. The pure layer mints deterministic `s_<n>` placeholders so its
//!   plans are byte-stable; those must never reach the DB. The registry owns the
//!   real opaque id (`s_<ts>__<rand>`) and joins it onto the pure plan by the
//!   `s_<n>` key returned from [`HysteresisState::step_assign`].
//! - THE VELOQRS PAYLOAD. A section is more than a polyline: members, portions,
//!   name. The payload mirrors the pure layer's held ground through the
//!   [`CandidateFate`] on each carry: a FROZEN carry (mid re-cut debounce) keeps
//!   the prior payload and folds in only the genuinely-new activities that
//!   traverse it; an ADOPTED carry (extents agreed, or a sustained re-cut fired)
//!   takes the batch payload wholesale — polyline, portions, and consensus
//!   family are one coherent unit — under the carried identity (real id, name,
//!   created_at, version), grafting back any prior member the non-monotone
//!   batch re-clustering dropped whose track still matches the new geometry.
//!   A mint/restore takes the fresh batch payload under the same identity rule.
//!
//! INTENT SUPPRESSION generalises the custom-section rule that already dodges the
//! R2 crash: before the plan runs, any candidate whose ground is owned by a
//! durable-intent DB row (accepted / trimmed / renamed / set-ref / merged /
//! custom — the rows the detection wipe spares) is dropped, and any registry row
//! whose id has passed to such a durable row is relinquished. So auto detection
//! never re-emits, and never collides on `UNIQUE sections.id` with, a section the
//! user has frozen. That is what flips accept/trim/merge survival by construction.
//!
//! Design: `~/.claude/plans/b2-identity-hysteresis-design.md` (Part 4 step 2,
//! and Part 5 for the four as-built deviations from the pure layer).

use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::persistence::PersistentRouteEngine;
use crate::persistence::codec;
use crate::sections::crud::compute_section_portions;
use tracematch::{
    CandidateFate, CandidateSection, FrequentSection, GpsPoint, HysteresisParams, HysteresisState,
    shares_ground,
};

/// `identity_state.key` for the section registry blob (B4 migration 013).
pub(super) const SECTION_IDENTITY_KEY: &str = "section_identity";

/// A section's geometry provenance, when its line is a real slice.
fn reference_of(section: &FrequentSection) -> Option<(String, u32, u32)> {
    let (start, end) = section.representative_range?;
    if section.representative_activity_id.is_empty() {
        return None;
    }
    Some((section.representative_activity_id.clone(), start, end))
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

/// Version byte on the persisted section-registry blob. Bump on any
/// serialisation-breaking change to [`SectionIdentity`]; an old byte then reseeds
/// gracefully instead of misparsing. Version 2 moved to rmp encoding: the
/// payload carries [`FrequentSection`]s whose trailing skip-if-None fields
/// (`GpsPoint.elevation`, `consensus_state`) desync postcard's positional
/// stream, so a v1 postcard blob never decoded and always fell back to a
/// reseed — dropping graves, tombstones, and debounce streaks on every
/// restart. rmp's length-prefixed arrays recover a skipped trailing field
/// through its serde default. Version 3 reshaped the hysteresis debounce
/// record (the D5 streak ledger holds both directions' streaks in place of
/// one kind + one streak), which rmp encodes positionally, so a v2 blob
/// reseeds rather than misreading a kind byte as a streak.
pub(super) const SECTION_IDENTITY_BLOB_VERSION: u8 = 3;

/// Merge-candidacy mutual-overlap floor for the registry's hysteresis. SHIPS AT
/// 0.0 (the pure-layer default): a prior competes for a candidate's merge
/// nomination on same-corridor coverage alone, seniority deciding.
///
/// A non-zero floor was trialled to tame the synthetic marginal-capture
/// pathology — a short senior prior with marginal one-sided overlap capturing or
/// blocking a dominant candidate (`tracematch/tests/b2_inheritance_stress.rs`),
/// which at defaults can mint a duplicate every detect on an unchanged catalogue.
/// But 0.4 failed to generalise: on GeoLife dense-urban data (204 trajectories)
/// it broke ~7 legitimate low-overlap carries into mints/merges and worsened
/// churn, WITHOUT reducing the real duplication. Constants discipline: a value
/// that fails generalisation does not ship. The duplication family — visible-
/// catalogue inflation from the re-cut debounce holding stale covered geometry
/// (see the seam note in `section_identity_apply_into`) — is a FOLD-level fix in
/// the pure layer (task pending), not a merge floor. Kept as an explicit knob so
/// GATE-2 can revisit with a TARGETED trigger, not a blanket floor.
const MERGE_MUTUAL_FLOOR: f64 = 0.0;

/// One visible or tombstoned section the registry manages: the durable opaque id
/// the DB carries, and the full payload persisted under it. Keyed elsewhere by
/// the pure layer's `s_<n>` join id.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct IdentityRow {
    /// The opaque `s_<ts>__<rand>` id written to `sections.id`, or a seeded
    /// existing id adopted on first open. Never a positional `sec_<sport>_<n>`.
    real_id: String,
    /// The section persisted under `real_id`. `section.id == real_id` always.
    section: FrequentSection,
}

/// The engine-held section identity registry: the pure churn brain plus the
/// veloqrs payloads it carries. In-memory pre-B4 (reseeded from the DB on open);
/// B4 persists the whole blob so a debounce survives an app kill. Serde-derived
/// now so that migration is a straight `serde` of this type. `Default` is hand
/// written (below) so the hysteresis tunables — the merge floor especially — are
/// an explicit knob at the one construction site, not a buried derive.
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
}

impl Default for SectionIdentity {
    fn default() -> Self {
        Self {
            // The one place the registry's hysteresis is tuned. k and the
            // dissolve/re-cut thresholds ride the pure-layer defaults; the merge
            // floor is stated EXPLICITLY at [`MERGE_MUTUAL_FLOOR`] (0.0 today) so
            // a GATE-2 change is a one-line edit here, not a hunt through derives.
            hysteresis: HysteresisState::new(HysteresisParams {
                merge_mutual_floor: MERGE_MUTUAL_FLOOR,
                ..HysteresisParams::default()
            }),
            rows: BTreeMap::new(),
            graves: BTreeMap::new(),
            seen: BTreeSet::new(),
            mint_seq: 0,
        }
    }
}

impl PersistentRouteEngine {
    /// Read accessor for tests/measurement: the number of visible registry rows.
    pub fn section_identity_visible_len(&self) -> usize {
        self.identity.rows.len()
    }

    /// The last RAW detection catalogue applied, before the identity/hysteresis
    /// remap. This is the B1 convergence truth — order-free and tracking the
    /// batch every step — as opposed to the DAMPED `get_sections()` view, which
    /// can lag it by up to `k` steps while a dissolve debounces. The B1 parity
    /// gates compare this so a legitimate hysteresis lag is not read as a
    /// detection desync.
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
    pub fn section_identity_grave_rows(&self) -> Vec<(String, String)> {
        self.identity
            .graves
            .iter()
            .map(|(pid, r)| (pid.clone(), r.real_id.clone()))
            .collect()
    }

    /// Test-only view of the pure layer's tombstoned join ids, sorted.
    #[cfg(feature = "synthetic")]
    pub fn section_identity_tombstone_ids(&self) -> Vec<String> {
        self.identity.hysteresis.tombstone_ids()
    }

    /// Test-only view of the pure layer's visible join ids, sorted.
    #[cfg(feature = "synthetic")]
    pub fn section_identity_pure_visible_ids(&self) -> Vec<String> {
        self.identity.hysteresis.visible_ids()
    }

    /// Test-only count of pure-layer ids with an active debounce.
    #[cfg(feature = "synthetic")]
    pub fn section_identity_pending_len(&self) -> usize {
        self.identity.hysteresis.pending_len()
    }

    /// Test-only mirror view, one tuple per visible registry row: the pure join
    /// id, the real DB id, the ground the pure layer holds under that join id
    /// (empty when it holds none, itself a seam breach), and the payload
    /// polyline persisted under the real id. The seam tests assert the two
    /// geometries are equal after every apply.
    #[cfg(feature = "synthetic")]
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
    /// commit atomically — a crash cannot leave the blob ahead of the DB. The
    /// leading byte is [`SECTION_IDENTITY_BLOB_VERSION`]; a mismatch on restore
    /// reseeds rather than misparsing. rmp-encoded, not postcard: the payload
    /// carries GpsPoint composites (see the version-constant note).
    pub(crate) fn section_identity_blob(&self) -> Option<Vec<u8>> {
        codec::serialize_gps_composite(&self.identity)
            .map(|body| codec::tag_blob(SECTION_IDENTITY_BLOB_VERSION, body))
            .ok()
    }

    /// Restore the section registry from its persisted blob. Returns false — so
    /// the caller reseeds from the DB rows — when there is no blob (fresh or
    /// pre-B4 install), the version byte does not match, or it fails to decode.
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
            log::warn!("tracematch: [section_identity_restore] blob version mismatch, reseeding");
            return false;
        };
        match codec::deserialize_gps_composite::<SectionIdentity>(body) {
            Ok(state) => {
                self.identity = state;
                // No counter-reconcile equivalent to the route registry's. Section
                // ids are `s_<ts>__<rand>`, collision-free by construction, so the
                // same one-generation stale-blob window cannot mint a duplicate PK.
                // The window can leave a catalogue id unknown to the restored
                // registry (a section saved after the stale blob), but that section
                // is simply re-matched by ground on the next apply's step_assign —
                // it self-heals through remap, not a failed load.
                true
            }
            Err(e) => {
                log::warn!("tracematch: [section_identity_restore] decode failed, reseeding: {e}");
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
            log::warn!("tracematch: [section_identity_persist] serialisation failed");
            return;
        };
        if let Err(e) = self.db.execute(
            "INSERT INTO identity_state (key, blob, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
            rusqlite::params![SECTION_IDENTITY_KEY, blob],
        ) {
            log::warn!("tracematch: [section_identity_persist] {e}");
        }
    }

    /// Ids of the sections the user has pinned. A pin is durable intent that the
    /// drawn line does not move, so the detector receives them as
    /// [`tracematch::SectionUpdatePolicy::pinned_ids`] and freezes them through
    /// the fold. Sorted, so the policy carries no read order.
    pub(crate) fn pinned_section_ids(&self) -> Vec<String> {
        let Ok(mut stmt) = self
            .db
            .prepare("SELECT section_id FROM section_pins ORDER BY section_id")
        else {
            return Vec::new();
        };
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    /// Seed the registry from the sections already loaded from the DB, adopting
    /// each existing id as a stable seed. Called once after `load_sections` so an
    /// existing install keeps its ids (positional, custom, or previously minted)
    /// and simply stops re-deriving them from that point — no migration, no id
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
            .cloned()
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

    /// Run a fresh detection catalogue through the identity + hysteresis layer,
    /// returning the VISIBLE catalogue to persist plus the lifecycle events the
    /// step fired: stable ids carried onto surviving ground, fresh ids minted
    /// for new ground, dissolves and re-cuts debounced. Operates on `identity`
    /// (a clone the caller commits only on a durable save) so a failed save
    /// never advances the registry past the DB; the events become durable in
    /// the same save transaction, so a rolled-back save also drops them.
    pub(crate) fn section_identity_apply_into(
        &self,
        identity: &mut SectionIdentity,
        raw: Vec<FrequentSection>,
    ) -> (Vec<FrequentSection>, Vec<SectionLifecycleEvent>) {
        let proximity = self.section_config.proximity_threshold;
        // Durable-intent grounds + ids: exactly the rows the detection wipe
        // spares (custom, trimmed/backed-up, or accepted/user-defined). Their
        // ground must not be re-emitted (that is the UNIQUE-id collision the R2
        // crash rides), and any registry id that has passed to one is relinquished.
        let (intent_grounds, intent_ids) = self.durable_intent_rows();

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
        // ground the DB row already represents — the same double-ownership
        // the live-row relinquish prevents.
        let claimed: Vec<String> = identity
            .hysteresis
            .tombstone_ids()
            .into_iter()
            .filter(|pid| {
                identity
                    .hysteresis
                    .tombstone_ground_of(pid)
                    .is_some_and(|g| ground_owned_by_intent(g, &intent_grounds))
            })
            .collect();
        for pid in claimed {
            identity.graves.remove(&pid);
            identity.hysteresis.forget(&pid);
        }

        // SUPPRESS: drop any candidate whose ground a durable-intent row already
        // owns. The durable row represents that ground; a fresh auto section for
        // it is the collision. This is the custom-section rule generalised.
        let raw: Vec<FrequentSection> = raw
            .into_iter()
            .filter(|s| !s.is_user_defined && !ground_owned_by_intent(&s.polyline, &intent_grounds))
            .collect();

        // Step the pure hysteresis and learn which visible id each candidate
        // resolved to (carry/split/merge -> inherited id, new/restore -> fresh)
        // and whether the pure layer adopted the candidate's geometry.
        //
        // COMPETITION NOTE. A prior mid re-cut debounce competes in
        // `plan_identity` on the batch geometry it is re-cutting TO (its
        // pending target), not its frozen footprint — the FOLD-level fix an
        // older note here still called pending. Residual exposure, verified
        // and deliberately open: the FIRST divergent step competes on the held
        // footprint (the pending target only exists from the following step),
        // a dissolve-pending prior competes on its stale ground and a foreign
        // capture resets its dissolve streak, and a marginal one-sided senior
        // capture needs no debounce at all — the merge floor is that clause's
        // only mitigation and ships at 0.0 (see [`MERGE_MUTUAL_FLOOR`]).
        let candidates: Vec<CandidateSection> =
            raw.iter().map(CandidateSection::from_section).collect();
        let (out, resolutions) = identity.hysteresis.step_assign(&candidates);

        // Activities new since the last apply, and their tracks, for the fold.
        // Read up front so the reconcile below borrows nothing from `self`.
        let now_seen: BTreeSet<String> = self.activity_metadata.keys().cloned().collect();
        let new_tracks: BTreeMap<String, Vec<GpsPoint>> = now_seen
            .difference(&identity.seen)
            .filter_map(|id| self.get_gps_track(id).map(|t| (id.clone(), t)))
            .collect();

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

            // Moved into whichever branch consumes it (adopt, restore, or the
            // mint fallback); a divergence leaves it for the fallback.
            let mut payload = Some(section);
            let carried = match resolutions[j].fate {
                CandidateFate::CarriedFrozen => old_rows.get(&pid).cloned().map(|mut row| {
                    fold_new_activities(&mut row.section, &new_tracks, proximity);
                    row
                }),
                CandidateFate::CarriedAdopted => old_rows.get(&pid).cloned().map(|mut row| {
                    // The batch's polyline, portions, and consensus family are
                    // one coherent unit, so adoption is wholesale; identity
                    // fields carry, and prior members the non-monotone batch
                    // re-clustering dropped are grafted back against the NEW
                    // geometry so membership stays monotone across the adopt.
                    let prior = std::mem::replace(&mut row.section, payload.take().unwrap());
                    row.section.id = row.real_id.clone();
                    row.section.name = prior.name.clone();
                    row.section.created_at = prior.created_at.clone();
                    row.section.version = prior.version;
                    row.section.updated_at = prior.updated_at.clone();
                    // Sport stays with the identity, not the winning candidate:
                    // per-sport detection can hand a prior to another sport's
                    // cut of the same ground, and a single add must never flip
                    // a visible section's sport. Pooled detection does not
                    // retire the carry, it re-justifies it: the label is
                    // derived from the cut, so the carry is what freezes it
                    // against a later batch deriving a different one.
                    row.section.sport_type = prior.sport_type.clone();
                    graft_prior_members(self, &mut row.section, &prior, proximity);
                    // An adopted carry keeps learning new traffic exactly as a
                    // frozen one does: the batch candidate only carries its own
                    // sport's members, but a new activity of another sport on
                    // the same ground must still join the row this step, or the
                    // cross-sport merge's majority pick hands the corridor to a
                    // freshly minted id and identity breaks on a sport addition.
                    fold_new_activities(&mut row.section, &new_tracks, proximity);
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
                        let prior = std::mem::replace(&mut row.section, payload.take().unwrap());
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
                let real_id = mint_real_id(&mut identity.mint_seq);
                let mut section = payload.take().expect("payload consumed once");
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
        // activities into it so a held section stays live.
        for pid in identity.hysteresis.visible_ids() {
            if new_rows.contains_key(&pid) {
                continue;
            }
            if let Some(mut row) = old_rows.get(&pid).cloned() {
                fold_new_activities(&mut row.section, &new_tracks, proximity);
                new_rows.insert(pid, row);
            }
        }

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
        let mut events: Vec<SectionLifecycleEvent> = Vec::new();
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
                        Some(
                            serde_json::json!({
                                "split_from": parent_real,
                                "discriminator": discriminator,
                            })
                            .to_string(),
                        )
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
            let mut details = self.section_era_snapshot(&parent_real);
            details.insert("siblings".into(), serde_json::json!(siblings));
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
            events.push(SectionLifecycleEvent {
                real_id: real_id.clone(),
                kind: "recut",
                details: Some(
                    serde_json::Value::Object(self.section_era_snapshot(real_id)).to_string(),
                ),
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

        identity.rows = new_rows;
        identity.seen = now_seen;

        (
            identity.rows.values().map(|r| r.section.clone()).collect(),
            events,
        )
    }

    /// The era snapshot of one section as it stands NOW, before the change
    /// this event narrates lands: the PR and its activity, the mean time, and
    /// the visit cadence. Read from the junction cache and activity dates the
    /// save has not yet rewritten, so a dissolved section's final era survives
    /// the cascade that removes its rows. Fields are null when the era had no
    /// cached times (lap times fill lazily on first performance read).
    fn section_era_snapshot(&self, real_id: &str) -> serde_json::Map<String, serde_json::Value> {
        let mut snap = serde_json::Map::new();
        let pr: Option<(String, f64)> = self
            .db
            .query_row(
                "SELECT activity_id, lap_time FROM section_activities
                 WHERE section_id = ? AND excluded = 0 AND lap_time IS NOT NULL
                 ORDER BY lap_time ASC, activity_id ASC LIMIT 1",
                rusqlite::params![real_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let avg: Option<f64> = self
            .db
            .query_row(
                "SELECT AVG(lap_time) FROM section_activities
                 WHERE section_id = ? AND excluded = 0 AND lap_time IS NOT NULL",
                rusqlite::params![real_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        let cadence: Option<(i64, Option<i64>, Option<i64>)> = self
            .db
            .query_row(
                "SELECT COUNT(*), MIN(a.start_date), MAX(a.start_date)
                 FROM section_activities sa JOIN activities a ON a.id = sa.activity_id
                 WHERE sa.section_id = ? AND sa.excluded = 0",
                rusqlite::params![real_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let visits_per_month = cadence.and_then(|(count, min_d, max_d)| {
            if count == 0 {
                return None;
            }
            let span_days = (max_d? - min_d?) as f64 / 86_400.0;
            Some(count as f64 / (span_days / 30.44).max(1.0))
        });
        snap.insert(
            "pr_activity_id".into(),
            serde_json::json!(pr.as_ref().map(|p| &p.0)),
        );
        snap.insert(
            "pr_time".into(),
            serde_json::json!(pr.as_ref().map(|p| p.1)),
        );
        snap.insert("avg_time".into(), serde_json::json!(avg));
        snap.insert(
            "visits_per_month".into(),
            serde_json::json!(visits_per_month),
        );
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

    /// Drop a removed activity from every section the registry carries (visible
    /// rows and tombstoned graves) and from the in-memory catalogue, and forget it
    /// as seen so a later re-add folds it back in. The append-only fold otherwise
    /// keeps a removed contributor as a phantom member, which the activity_id
    /// foreign key now (correctly) refuses to persist — aborting the whole
    /// detection apply. Called by remove_activity. Ground is untouched: only the
    /// gone activity leaves; the section's geometry and other members stay.
    pub(crate) fn section_identity_purge_activity(&mut self, activity_id: &str) {
        /// Whether the section carried the activity at all.
        fn drop_from(section: &mut FrequentSection, activity_id: &str) -> bool {
            let ids_before = section.activity_ids.len();
            section.activity_ids.retain(|a| a != activity_id);
            let before = section.activity_portions.len();
            section
                .activity_portions
                .retain(|p| p.activity_id != activity_id);
            let dropped = (before - section.activity_portions.len()) as u32;
            section.visit_count = section.visit_count.saturating_sub(dropped);
            dropped > 0 || section.activity_ids.len() != ids_before
        }
        let mut moved = false;
        for row in self.identity.rows.values_mut() {
            moved |= drop_from(&mut row.section, activity_id);
        }
        for row in self.identity.graves.values_mut() {
            moved |= drop_from(&mut row.section, activity_id);
        }
        moved |= self.identity.seen.remove(activity_id);
        for section in &mut self.sections {
            drop_from(section, activity_id);
        }
        // The blob is the whole catalogue, and a bulk delete is one call per
        // activity, so an untouched registry writes nothing.
        if moved {
            self.section_identity_persist();
        }
    }

    /// Record a durable suppression intent for a corridor the user hid
    /// (`kind = "disabled"`) or removed (`kind = "deleted"`), capturing the
    /// section's current ground so the emitter never re-detects it (invariant 6).
    /// Best-effort: a missing section is a no-op (nothing to suppress) and a write
    /// failure logs rather than propagates — the worst case is the pre-B4
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
        // The intent keeps its own JSON footprint, so serialise the section's
        // decoded geometry rather than copying the now-placeholder column.
        let polyline = self.stored_section_polyline(section_id).unwrap_or_default();
        let Ok(polyline_json) = serde_json::to_string(&polyline) else {
            return;
        };
        if let Err(e) = self.db.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(id, kind) DO UPDATE SET
                polyline_json = excluded.polyline_json,
                created_at = excluded.created_at",
            rusqlite::params![section_id, kind, polyline_json],
        ) {
            log::warn!("tracematch: [record_section_intent] {section_id} ({kind}): {e}");
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
            log::warn!("tracematch: [clear_section_intent] {section_id}: {e}");
        }
    }

    /// Grounds (polylines) and ids of the durable-intent DB rows the emitter must
    /// not re-emit. Two sources, both read raw from the DB because they are the
    /// authority the registry defers to:
    ///
    /// - The wipe-spared section rows — custom, backed-up (trimmed/set-ref), or
    ///   user-defined (accepted/renamed/merged) — whose ground a fresh auto
    ///   section would collide with on `UNIQUE sections.id`.
    /// - The `section_intents` suppression records — user-disabled and
    ///   user-deleted corridors that must stay hidden across restart (invariant 6).
    ///   The disabled section's own row is is_user_defined=0 and the deleted row
    ///   is gone, so neither is caught by the first query; the retained intent
    ///   ground is what keeps the corridor from re-emerging.
    fn durable_intent_rows(&self) -> (Vec<Vec<GpsPoint>>, BTreeSet<String>) {
        let mut grounds = Vec::new();
        let mut ids = BTreeSet::new();
        {
            let mut stmt = match self.db.prepare(
                "SELECT id, polyline_blob, polyline_json FROM sections
                 WHERE section_type = 'custom'
                    OR original_polyline_json IS NOT NULL
                    OR is_user_defined = 1",
            ) {
                Ok(s) => s,
                Err(_) => return (grounds, ids),
            };
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
                    if let Ok(pts) = codec::decode_polyline_row(blob.as_deref(), json.as_deref()) {
                        if !pts.is_empty() {
                            grounds.push(pts);
                        }
                    }
                }
            }
        }
        // INVARIANT: suppression reads disabled/deleted rows ONLY. kind='named'
        // rows share this table but are the opposite of suppression — a named
        // corridor must keep detecting and evolving. Widening this query back to
        // all kinds would make naming a corridor silently hide it
        // (`naming_never_suppresses_corridor` is the regression gate).
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, polyline_json FROM section_intents
             WHERE kind IN ('disabled', 'deleted')",
        ) {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });
            if let Ok(iter) = rows {
                for (id, polyline_json) in iter.flatten() {
                    ids.insert(id);
                    if let Ok(pts) = serde_json::from_str::<Vec<GpsPoint>>(&polyline_json) {
                        if !pts.is_empty() {
                            grounds.push(pts);
                        }
                    }
                }
            }
        }
        (grounds, ids)
    }
}

/// Whether a candidate polyline is the same corridor as any durable-intent
/// ground (the harness ground metric: majority coverage either way at 50 m).
fn ground_owned_by_intent(polyline: &[GpsPoint], intent_grounds: &[Vec<GpsPoint>]) -> bool {
    intent_grounds.iter().any(|g| shares_ground(polyline, g))
}

/// Append-only fold: add each new activity that traverses `section`'s held
/// polyline, and only those. Never removes a member and never adopts the batch's
/// re-clustered set, so a carried section is monotone across an add — the
/// property the strict single-add gates assert. New laps bump `visit_count` in
/// step with the junction rows `save_sections` will write.
fn fold_new_activities(
    section: &mut FrequentSection,
    new_tracks: &BTreeMap<String, Vec<GpsPoint>>,
    proximity: f64,
) {
    for (aid, track) in new_tracks {
        if section.activity_ids.iter().any(|x| x == aid) {
            continue;
        }
        let portions = compute_section_portions(aid, track, &section.polyline, proximity);
        if portions.is_empty() {
            continue;
        }
        section.activity_ids.push(aid.clone());
        section.visit_count += portions.len() as u32;
        section.activity_portions.extend(portions);
    }
}

/// Append `prior` members missing from an adopted batch payload whose tracks
/// still match the new polyline. The batch re-clustering is not monotone: a
/// member can drop out of the fresh cut while its traversals still cover the
/// adopted ground, and losing it would break the single-add stability the
/// lifecycle gates assert. Portions are computed against the NEW geometry so
/// the junction rows `save_sections` writes stay coherent; a member whose
/// track genuinely left the adopted ground stays dropped.
fn graft_prior_members(
    engine: &PersistentRouteEngine,
    section: &mut FrequentSection,
    prior: &FrequentSection,
    proximity: f64,
) {
    let have: BTreeSet<&str> = section.activity_ids.iter().map(String::as_str).collect();
    let missing: Vec<String> = prior
        .activity_ids
        .iter()
        .filter(|aid| !have.contains(aid.as_str()))
        .cloned()
        .collect();
    for aid in missing {
        let Some(track) = engine.get_gps_track(&aid) else {
            continue;
        };
        let portions = compute_section_portions(&aid, &track, &section.polyline, proximity);
        if portions.is_empty() {
            continue;
        }
        section.activity_ids.push(aid);
        section.visit_count += portions.len() as u32;
        section.activity_portions.extend(portions);
    }
}

/// Mint a fresh opaque real id, mirroring the custom-section scheme
/// (`custom_<ts>__<rand>`) with a distinct `s_` prefix so registry and custom
/// ids never alias. The monotonic `seq` keeps ids unique even when a single
/// apply mints many sections in one millisecond.
fn mint_real_id(seq: &mut u64) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("s_{}__{:06}", ts, *seq);
    *seq += 1;
    id
}
