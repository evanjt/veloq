//! Assign-once route identity: the route half of B2 (design 2.3 / Part 4 step 3).
//!
//! A route group's `group_id` was the Union-Find ROOT of its member set, which
//! the full and incremental grouping paths pick differently, so the first
//! incremental resync re-keys a group to its MIN member, orphaning anything keyed
//! to the old id (the representative via `existing_reps`, the name via
//! `route_names`). That is R2 reaching routes. This layer mirrors the section
//! registry: it owns a stable id per route over time, carried forward by MEMBER
//! overlap rather than re-derived from the churning root.
//!
//! Two deliberate differences from the section registry:
//!
//! - MATCH METRIC. A route IS its member set, so identity is carried by Jaccard of
//!   `activity_ids` (local set math here, no geometry, no tracematch round-trip),
//!   not ground coverage. Mutual-best pairing with total tie-breaks, so the plan
//!   is a deterministic function of the two member-set families (no HashMap-order
//!   leak into the persisted id).
//! - ID SCHEME. Routes mint a DETERMINISTIC ordinal `r_<n>`, not the sections'
//!   `s_<ts>__<rand>`. The route snapshot's signature is id-INCLUDED (a cold
//!   group's representative is already the deterministic sorted-min member), so a
//!   deterministic id makes the whole route catalogue byte-stable across two runs
//!  , the double-run determinism routes are held to. A ts+rand id could not.
//!   Minted in sorted-member order so the assignment does not depend on the
//!   grouping HashMap's iteration order. Per-device ids need no global uniqueness;
//!   reseed adopts existing ids and continues the counter past them.
//!
//! Scope is identity + keying only (no hysteresis debounce, a route has no
//! non-monotone reform to damp). The custom-name re-hydration on recompute stays
//! B4; this layer only stops the `route_names` row being orphaned by keying it to
//! the surviving stable id.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::persistence::PersistentRouteEngine;
use crate::persistence::codec;
use tracematch::RouteGroup;

/// `identity_state.key` for the route registry blob (B4 migration 013).
pub(crate) const ROUTE_IDENTITY_KEY: &str = "route_identity";

/// Version byte on the persisted route-registry blob. Bump on any
/// serialisation-breaking change to [`RouteIdentity`]; an old byte then reseeds.
pub(crate) const ROUTE_IDENTITY_BLOB_VERSION: u8 = 1;

/// Per-route identity state: the seniority ordinal of each live stable id plus
/// the monotonic counter that both mints `r_<n>` ids and stamps `first_seen`.
/// In-memory pre-B4 (reseeded from the DB groups on open); serde-ready so B4 can
/// persist it as one blob. `#[serde(default)]` + the blob version tag keep an
/// older persisted blob readable (or gracefully reseeding) across a field change.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct RouteIdentity {
    /// Stable route id -> seniority ordinal (lower = more senior, wins a merge).
    /// Holds exactly the currently-live ids; a dropped route's id is pruned (no
    /// tombstone, routes carry no re-emergence machinery).
    first_seen: BTreeMap<String, u64>,
    /// Monotonic: the source of both a fresh `r_<n>` id and a fresh `first_seen`.
    /// Only grows within a session; reseed lifts it past any adopted `r_<n>`.
    ordinal: u64,
}

impl PersistentRouteEngine {
    /// Test-only fingerprint of the route registry state (first_seen + ordinal),
    /// for asserting a restart restores it exactly. Behind `synthetic`.
    #[cfg(feature = "synthetic")]
    pub fn route_identity_fingerprint(&self) -> Vec<u8> {
        codec::serialize(&self.route_identity).unwrap_or_default()
    }

    /// The route registry as a version-tagged serde blob, or None on failure.
    /// Written INSIDE the `save_groups` transaction so the registry commits
    /// atomically with the groups it describes.
    pub(crate) fn route_identity_blob(&self) -> Option<Vec<u8>> {
        codec::serialize(&self.route_identity)
            .map(|body| codec::tag_blob(ROUTE_IDENTITY_BLOB_VERSION, body))
            .ok()
    }

    /// Restore the route registry from its persisted blob. Returns false, so the
    /// caller reseeds from the DB groups, when there is no blob, the version byte
    /// mismatches, or it fails to decode. An unreadable blob heals to a reseed,
    /// never a failed load. On a clean restore the mint counter and seniority
    /// survive, so a group minted after the restart cannot re-use a live ordinal.
    pub(crate) fn route_identity_restore(&mut self) -> bool {
        let bytes: Option<Vec<u8>> = self
            .db
            .query_row(
                "SELECT blob FROM identity_state WHERE key = ?",
                rusqlite::params![ROUTE_IDENTITY_KEY],
                |row| row.get(0),
            )
            .ok();
        let Some(bytes) = bytes else {
            return false;
        };
        let Some(body) = codec::untag_blob(ROUTE_IDENTITY_BLOB_VERSION, &bytes) else {
            log::warn!("tracematch: [route_identity_restore] blob version mismatch, reseeding");
            return false;
        };
        match codec::deserialize::<RouteIdentity>(body) {
            Ok(state) => {
                self.route_identity = state;
                // Crash-window reconcile. The blob can lag `route_groups` by one
                // save generation: a crash (or a torn write) between the group
                // commit and the registry write leaves a stale blob whose ordinal
                // sits BELOW an `r_<n>` already persisted as a group PK. Restore
                // then succeeds, so reseed's counter-lift never runs, and the next
                // mint would collide with that live id. Lift the counter past the
                // max adopted id here, the same scan reseed does, so a stale blob
                // heals to a safe counter rather than a duplicate-PK save.
                let floor = self.max_adopted_route_ordinal();
                if self.route_identity.ordinal < floor {
                    self.route_identity.ordinal = floor;
                }
                true
            }
            Err(e) => {
                log::warn!("tracematch: [route_identity_restore] decode failed, reseeding: {e}");
                false
            }
        }
    }

    /// The highest ordinal already baked into a loaded `r_<n>` group id, or 0.
    /// Both reseed (fresh adoption) and restore (crash-window reconcile) lift the
    /// mint counter past this so a later mint cannot collide with an id already
    /// persisted in `route_groups`, whose PK is `group_id`.
    fn max_adopted_route_ordinal(&self) -> u64 {
        self.groups
            .iter()
            .filter_map(|g| g.group_id.strip_prefix("r_").and_then(|n| n.parse().ok()))
            .max()
            .unwrap_or(0)
    }

    /// Seed the registry from the groups already loaded from the DB, adopting each
    /// existing `group_id` as its stable id so an install keeps its route ids and
    /// simply stops re-deriving them, no migration. Seniority is assigned in
    /// sorted-id order (a deterministic proxy for age at adoption time); the mint
    /// counter is lifted past any adopted `r_<n>` so a later mint cannot collide.
    pub(crate) fn route_identity_reseed(&mut self) {
        let mut ids: Vec<String> = self.groups.iter().map(|g| g.group_id.clone()).collect();
        ids.sort();

        let mut ri = RouteIdentity::default();
        for id in &ids {
            ri.ordinal += 1;
            ri.first_seen.insert(id.clone(), ri.ordinal);
        }
        ri.ordinal = ri.ordinal.max(self.max_adopted_route_ordinal());
        self.route_identity = ri;
    }

    /// Remap a freshly-grouped catalogue (`new_groups`, still carrying churning
    /// UF-root ids and fresh min-member representatives) onto stable ids, matching
    /// each group to a prior by member-set overlap. A carry inherits the prior's
    /// stable id AND its representative (so a user's pick survives the regroup); a
    /// group matching no prior mints a fresh deterministic id. `prior` is the
    /// previous `self.groups`, the source of the ids and reps being carried.
    ///
    /// Returns the remapped groups and the `old_group_id -> stable_id` map, so the
    /// caller can re-key anything the grouping keyed by the old UF-root id, chiefly
    /// `activity_matches`, whose per-member DIRECTION would otherwise be orphaned
    /// (leaving route highlights to read a wrong forward/back split).
    pub(crate) fn route_identity_remap(
        &mut self,
        prior: Vec<RouteGroup>,
        new_groups: Vec<RouteGroup>,
    ) -> (Vec<RouteGroup>, HashMap<String, String>) {
        let np = prior.len();
        let nc = new_groups.len();
        let prior_members: Vec<BTreeSet<String>> = prior
            .iter()
            .map(|g| g.activity_ids.iter().cloned().collect())
            .collect();
        let new_members: Vec<BTreeSet<String>> = new_groups
            .iter()
            .map(|g| g.activity_ids.iter().cloned().collect())
            .collect();

        // Jaccard overlap of every prior/candidate pair. Disjoint pairs score 0.
        let mut jac = vec![vec![0.0_f64; nc]; np];
        for i in 0..np {
            for j in 0..nc {
                let inter = prior_members[i].intersection(&new_members[j]).count();
                if inter == 0 {
                    continue;
                }
                let uni = prior_members[i].union(&new_members[j]).count();
                jac[i][j] = inter as f64 / uni as f64;
            }
        }

        // Each candidate nominates the SENIOR prior it best overlaps (merge rule):
        // more overlap, then earlier first_seen, then more members, then smaller id.
        let cand_pick: Vec<Option<usize>> = (0..nc)
            .map(|j| {
                let mut best: Option<usize> = None;
                for i in 0..np {
                    if jac[i][j] <= 0.0 {
                        continue;
                    }
                    let take = match best {
                        None => true,
                        Some(b) => self.senior_prior_wins(jac[i][j], i, jac[b][j], b, &prior),
                    };
                    if take {
                        best = Some(i);
                    }
                }
                best
            })
            .collect();

        // Each prior nominates the candidate it best overlaps (split rule): more
        // overlap, then more members, then the smaller member set, then index.
        let prior_pick: Vec<Option<usize>> = (0..np)
            .map(|i| {
                let mut best: Option<usize> = None;
                for j in 0..nc {
                    if jac[i][j] <= 0.0 {
                        continue;
                    }
                    let take = match best {
                        None => true,
                        Some(b) => better_candidate(
                            jac[i][j],
                            &new_members[j],
                            j,
                            jac[i][b],
                            &new_members[b],
                            b,
                        ),
                    };
                    if take {
                        best = Some(j);
                    }
                }
                best
            })
            .collect();

        // A carry is confirmed only where the two nominations agree.
        let mut carrier_of: Vec<Option<usize>> = vec![None; nc];
        for (i, &pick) in prior_pick.iter().enumerate() {
            if let Some(j) = pick {
                if cand_pick[j] == Some(i) {
                    carrier_of[j] = Some(i);
                }
            }
        }

        let mut out: Vec<Option<RouteGroup>> = vec![None; nc];
        let mut new_first_seen: BTreeMap<String, u64> = BTreeMap::new();
        let mut id_map: HashMap<String, String> = HashMap::with_capacity(nc);

        // Carries first: inherit the prior's stable id, seniority, and rep.
        for j in 0..nc {
            let Some(i) = carrier_of[j] else { continue };
            let stable_id = prior[i].group_id.clone();
            let mut g = new_groups[j].clone();
            g.representative_id = if new_members[j].contains(&prior[i].representative_id) {
                prior[i].representative_id.clone()
            } else {
                g.representative_id
            };
            id_map.insert(g.group_id.clone(), stable_id.clone());
            g.group_id = stable_id.clone();
            let fs = self
                .route_identity
                .first_seen
                .get(&stable_id)
                .copied()
                .unwrap_or_else(|| {
                    self.route_identity.ordinal += 1;
                    self.route_identity.ordinal
                });
            new_first_seen.insert(stable_id, fs);
            out[j] = Some(g);
        }

        // Mints, in sorted-member order so the id assignment is independent of the
        // grouping HashMap's iteration order.
        let mut mint_order: Vec<usize> = (0..nc).filter(|&j| carrier_of[j].is_none()).collect();
        mint_order.sort_by(|&a, &b| new_members[a].cmp(&new_members[b]));
        for j in mint_order {
            self.route_identity.ordinal += 1;
            let id = format!("r_{}", self.route_identity.ordinal);
            let mut g = new_groups[j].clone();
            id_map.insert(g.group_id.clone(), id.clone());
            g.group_id = id.clone();
            new_first_seen.insert(id, self.route_identity.ordinal);
            out[j] = Some(g);
        }

        self.route_identity.first_seen = new_first_seen;
        (out.into_iter().flatten().collect(), id_map)
    }

    /// Whether prior `i` beats prior `b` for a candidate's merge nomination: more
    /// overlap, then more senior (earlier first_seen), then more members, then a
    /// smaller id. Total, so the nomination never depends on iteration order.
    fn senior_prior_wins(
        &self,
        jac_i: f64,
        i: usize,
        jac_b: f64,
        b: usize,
        prior: &[RouteGroup],
    ) -> bool {
        match jac_i.total_cmp(&jac_b) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            std::cmp::Ordering::Equal => {
                let fi = self
                    .route_identity
                    .first_seen
                    .get(&prior[i].group_id)
                    .copied();
                let fb = self
                    .route_identity
                    .first_seen
                    .get(&prior[b].group_id)
                    .copied();
                match (fi, fb) {
                    (Some(a), Some(c)) if a != c => a < c,
                    _ => match prior[i]
                        .activity_ids
                        .len()
                        .cmp(&prior[b].activity_ids.len())
                    {
                        std::cmp::Ordering::Greater => true,
                        std::cmp::Ordering::Less => false,
                        std::cmp::Ordering::Equal => prior[i].group_id < prior[b].group_id,
                    },
                }
            }
        }
    }
}

/// Whether candidate `(jac_j, mj)` at index `j` beats `(jac_b, mb)` at index `b`
/// for a prior's split nomination: more overlap, then more members, then the
/// smaller member set (lexicographic), then a smaller index. Total.
fn better_candidate(
    jac_j: f64,
    mj: &BTreeSet<String>,
    j: usize,
    jac_b: f64,
    mb: &BTreeSet<String>,
    b: usize,
) -> bool {
    match jac_j.total_cmp(&jac_b) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match mj.len().cmp(&mb.len()) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            std::cmp::Ordering::Equal => match mj.cmp(mb) {
                std::cmp::Ordering::Less => true,
                std::cmp::Ordering::Greater => false,
                std::cmp::Ordering::Equal => j < b,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentRouteEngine;

    fn group(id: &str, members: &[&str]) -> RouteGroup {
        RouteGroup {
            group_id: id.to_string(),
            representative_id: members[0].to_string(),
            activity_ids: members.iter().map(|s| s.to_string()).collect(),
            sport_type: "Ride".to_string(),
            bounds: None,
            custom_name: None,
            best_time: None,
            avg_time: None,
            best_pace: None,
            best_activity_id: None,
        }
    }

    /// Crash between the group commit and the registry blob write: `route_groups`
    /// holds `r_5` but the surviving blob's counter is still at a pre-crash 2.
    /// Restore succeeds (skipping reseed's counter-lift), so without a reconcile
    /// the next mint would re-issue `r_5` and collide with a live group PK.
    #[test]
    fn restore_reconciles_ordinal_past_saved_groups() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // A group `r_5` survived the crash (in memory here it stands for the
        // committed route_groups row load() would have read before restore runs).
        engine.groups = vec![group("r_5", &["a1", "a2"])];

        // Persist a STALE blob: a pre-crash generation whose counter never learned
        // about the r_5 mint.
        engine.route_identity = RouteIdentity {
            first_seen: [("r_2".to_string(), 2u64)].into_iter().collect(),
            ordinal: 2,
        };
        let stale = engine.route_identity_blob().expect("blob serialises");
        engine
            .db
            .execute(
                "INSERT INTO identity_state (key, blob, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET blob = excluded.blob",
                rusqlite::params![ROUTE_IDENTITY_KEY, stale],
            )
            .unwrap();
        engine.route_identity = RouteIdentity::default();

        assert!(
            engine.route_identity_restore(),
            "a stale blob still decodes"
        );
        assert_eq!(
            engine.route_identity.ordinal, 5,
            "restore must lift the counter past the saved r_5, not trust the stale 2"
        );

        // A brand-new disjoint group must mint past the reconciled floor, never
        // re-issuing the live r_5.
        let prior = engine.groups.clone();
        let (remapped, _id_map) = engine.route_identity_remap(prior, vec![group("uf_x", &["b1"])]);
        assert_eq!(remapped.len(), 1);
        assert_ne!(
            remapped[0].group_id, "r_5",
            "a fresh mint must not collide with the live group id"
        );
        assert_eq!(remapped[0].group_id, "r_6");
    }

    /// A restored blob AHEAD of the loaded groups keeps its counter, the
    /// reconcile only lifts, never rewinds, so live seniority is preserved.
    #[test]
    fn restore_keeps_counter_when_blob_leads_groups() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine.groups = vec![group("r_3", &["a1"])];
        engine.route_identity = RouteIdentity {
            first_seen: [("r_3".to_string(), 3u64)].into_iter().collect(),
            ordinal: 9,
        };
        let blob = engine.route_identity_blob().expect("blob serialises");
        engine
            .db
            .execute(
                "INSERT INTO identity_state (key, blob, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET blob = excluded.blob",
                rusqlite::params![ROUTE_IDENTITY_KEY, blob],
            )
            .unwrap();
        engine.route_identity = RouteIdentity::default();

        assert!(engine.route_identity_restore());
        assert_eq!(
            engine.route_identity.ordinal, 9,
            "the counter must not rewind to the max adopted id when the blob leads"
        );
    }
}
