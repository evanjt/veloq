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
//!   name. On a CARRY the registry keeps the prior payload and folds in only the
//!   genuinely-new activities that traverse it (append-only — never adopts the
//!   batch's re-clustered membership, which the non-monotone B1 batch may shrink),
//!   so a carried section can never lose a member across an add. A mint/restore
//!   takes the fresh batch payload.
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
use crate::sections::crud::compute_section_portions;
use tracematch::{CandidateSection, FrequentSection, GpsPoint, HysteresisState, shares_ground};

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
/// now so that migration is a straight `serde` of this type.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
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
        &self.raw_sections
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
        let (_out, pure_ids) = identity.hysteresis.step_assign(&candidates);
        for (j, section) in managed.into_iter().enumerate() {
            let real_id = section.id.clone();
            identity.rows.insert(
                pure_ids[j].clone(),
                IdentityRow { real_id, section },
            );
        }
        identity.seen = self.activity_metadata.keys().cloned().collect();
        self.identity = identity;
    }

    /// Run a fresh detection catalogue through the identity + hysteresis layer,
    /// returning the VISIBLE catalogue to persist: stable ids carried onto
    /// surviving ground, fresh ids minted for new ground, dissolves and re-cuts
    /// debounced. Operates on `identity` (a clone the caller commits only on a
    /// durable save) so a failed save never advances the registry past the DB.
    pub(crate) fn section_identity_apply_into(
        &self,
        identity: &mut SectionIdentity,
        raw: Vec<FrequentSection>,
    ) -> Vec<FrequentSection> {
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

        // SUPPRESS: drop any candidate whose ground a durable-intent row already
        // owns. The durable row represents that ground; a fresh auto section for
        // it is the collision. This is the custom-section rule generalised.
        let raw: Vec<FrequentSection> = raw
            .into_iter()
            .filter(|s| {
                !s.is_user_defined && !ground_owned_by_intent(&s.polyline, &intent_grounds)
            })
            .collect();

        // Step the pure hysteresis and learn which visible id each candidate
        // resolved to (carry/split/merge -> inherited id, new/restore -> fresh).
        let candidates: Vec<CandidateSection> =
            raw.iter().map(CandidateSection::from_section).collect();
        let (_out, candidate_ids) = identity.hysteresis.step_assign(&candidates);

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
        let mut new_rows: BTreeMap<String, IdentityRow> = BTreeMap::new();

        // Candidates: a carry keeps the prior payload and folds new activities; a
        // mint/restore takes the batch payload under a fresh/restored real id.
        for (j, section) in raw.into_iter().enumerate() {
            let pid = &candidate_ids[j];
            if let Some(mut row) = old_rows.get(pid).cloned() {
                fold_new_activities(&mut row.section, &new_tracks);
                new_rows.insert(pid.clone(), row);
            } else if let Some(mut row) = old_graves.get(pid).cloned() {
                // Restore: the ground re-emerged; adopt the batch geometry and
                // members but keep the OLD real id (comes back as itself).
                let real_id = row.real_id.clone();
                row.section = section;
                row.section.id = real_id;
                new_rows.insert(pid.clone(), row);
            } else {
                let real_id = mint_real_id(&mut identity.mint_seq);
                let mut section = section;
                section.id = real_id.clone();
                new_rows.insert(pid.clone(), IdentityRow { real_id, section });
            }
        }

        // Pending-frozen visible ids (a debounced dissolve or re-cut with no
        // candidate this step): keep the prior payload, still folding new
        // activities into it so a held section stays live.
        for pid in identity.hysteresis.visible_ids() {
            if new_rows.contains_key(&pid) {
                continue;
            }
            if let Some(mut row) = old_rows.get(&pid).cloned() {
                fold_new_activities(&mut row.section, &new_tracks);
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

        identity.rows = new_rows;
        identity.seen = now_seen;

        identity
            .rows
            .values()
            .map(|r| r.section.clone())
            .collect()
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
        for pid in pids {
            self.identity.rows.remove(&pid);
            self.identity.graves.remove(&pid);
            self.identity.hysteresis.forget(&pid);
        }
    }

    /// Grounds (polylines) and ids of the durable-intent DB rows the detection
    /// wipe spares: custom, backed-up (trimmed/set-ref), or user-defined
    /// (accepted/renamed/merged). Read raw from the DB because these rows are the
    /// authority the registry defers to.
    fn durable_intent_rows(&self) -> (Vec<Vec<GpsPoint>>, BTreeSet<String>) {
        let mut grounds = Vec::new();
        let mut ids = BTreeSet::new();
        let mut stmt = match self.db.prepare(
            "SELECT id, polyline_json FROM sections
             WHERE section_type = 'custom'
                OR original_polyline_json IS NOT NULL
                OR is_user_defined = 1",
        ) {
            Ok(s) => s,
            Err(_) => return (grounds, ids),
        };
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
) {
    for (aid, track) in new_tracks {
        if section.activity_ids.iter().any(|x| x == aid) {
            continue;
        }
        let portions = compute_section_portions(aid, track, &section.polyline);
        if portions.is_empty() {
            continue;
        }
        section.activity_ids.push(aid.clone());
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
