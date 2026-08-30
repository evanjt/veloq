//! Suite #2, route grouping/matching lifecycle.
//!
//! Routes are a SEPARATE pipeline from section detection. The harness
//! `ingest_step` only drives `detect_sections_background`; route grouping is
//! lazy behind `get_groups()` (recomputes when `groups_dirty`, which
//! `add_activity` sets). So every route step here is: ingest via the harness,
//! then call `get_groups()` to force grouping and snapshot the result.
//!
//! Unlike sections, grouping keys off group MEMBERSHIP (`already_grouped`), not
//! `processed_activity_ids`, and the incremental path seeds Union-Find with the
//! existing group structure and threads `existing_reps` through. These tests pin
//! what that has to deliver: a deterministic byte-stable catalogue, an opaque id
//! that survives a resync, and a chosen representative, custom name, and
//! membership that survive with it. The one remaining red is the in-memory
//! custom name (`#[ignore]`d, B4 owes the re-hydrate).
//!
//! Method-agnostic persistence behaviour, run on the fast Control arm.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test suite2_routes_lifecycle \
//!     -- --include-ignored

mod lifecycle_support;

use std::collections::{BTreeMap, BTreeSet};

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::{ActivityMetrics, PersistentRouteEngine};

/// Cold set for the route lifecycle. Route grouping is O(N^2); this is enough
/// repeats to form groups without a slow cold grouping in debug.
const COLD_N: usize = 40;

fn route_corpus(bucket_a_count: usize) -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0, // ignored by the generator (bucket D is a fixed 3), zeroed for clarity
        bucket_e_delta_count: 0,
        ..LifecycleConfig::default()
    })
}

// ============================================================================
// Route fingerprint, the identity + membership view the app renders
// ============================================================================

#[derive(Clone, PartialEq)]
struct RouteFingerprint {
    representative_id: String,
    activity_ids: BTreeSet<String>,
    sport_type: String,
    /// In-memory custom name on the group (NOT the `route_names` DB table).
    custom_name: Option<String>,
}

struct RouteSnapshot {
    groups: BTreeMap<String, RouteFingerprint>,
}

impl RouteSnapshot {
    fn count(&self) -> usize {
        self.groups.len()
    }

    /// Order-free, keyed by group_id + representative + members.
    fn catalogue_signature(&self) -> String {
        let mut rows: Vec<String> = self
            .groups
            .iter()
            .map(|(id, g)| {
                format!(
                    "{}|{}|rep={}|[{}]",
                    id,
                    g.sport_type,
                    g.representative_id,
                    g.activity_ids.iter().cloned().collect::<Vec<_>>().join(","),
                )
            })
            .collect();
        rows.sort();
        rows.join("\n")
    }
}

/// Trigger grouping and snapshot the visible route catalogue. `get_groups()`
/// recomputes when dirty, so this is the route analogue of `snapshot`.
fn route_snapshot(engine: &mut PersistentRouteEngine) -> RouteSnapshot {
    let groups = engine.get_groups().to_vec();
    RouteSnapshot {
        groups: groups
            .into_iter()
            .map(|g| {
                (
                    g.group_id.clone(),
                    RouteFingerprint {
                        representative_id: g.representative_id,
                        activity_ids: g.activity_ids.into_iter().collect(),
                        sport_type: g.sport_type,
                        custom_name: g.custom_name,
                    },
                )
            })
            .collect(),
    }
}

/// The most-travelled multi-member group (a real, editable route). None when the
/// corpus produced only singletons, itself a finding.
fn busiest_route(snap: &RouteSnapshot) -> Option<(String, RouteFingerprint)> {
    snap.groups
        .iter()
        .filter(|(_, g)| g.activity_ids.len() > 1)
        .max_by_key(|(_, g)| g.activity_ids.len())
        .map(|(id, g)| (id.clone(), g.clone()))
}

/// The group in `snap` that best carries `members` (largest intersection).
/// Membership is deterministic even when group_id is not, so this is the stable
/// way to follow "the same route" across a regroup.
fn group_carrying(
    snap: &RouteSnapshot,
    members: &BTreeSet<String>,
) -> Option<(String, RouteFingerprint)> {
    snap.groups
        .iter()
        .max_by_key(|(_, g)| g.activity_ids.intersection(members).count())
        .filter(|(_, g)| g.activity_ids.intersection(members).count() > 0)
        .map(|(id, g)| (id.clone(), g.clone()))
}

/// Synthetic metrics so `get_activity_route_highlights` has timed attempts to
/// compare. Distance/date come from the activity; moving_time is supplied so we
/// control the speed ordering.
fn metrics_for(a: &LifecycleActivity, moving_time: u32) -> ActivityMetrics {
    // Distance from the raw track length is not needed; a fixed positive
    // distance keeps speed = distance/moving_time well-defined and monotone in
    // 1/moving_time, which is all the trend maths needs.
    ActivityMetrics {
        activity_id: a.id.clone(),
        name: a.id.clone(),
        date: a.start_date_unix,
        distance: 10_000.0,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: a.sport_type.clone(),
    }
}

// ============================================================================
// Curiosity 0, route grouping determinism
// ============================================================================

/// Gate (determinism): the WHOLE route catalogue, group ids and representatives
/// included, is byte-stable across two fresh engines over the same set. Unlike
/// sections (whose signature is id-free), the route snapshot's signature carries
/// the id, so identity has to be deterministic, not merely stable: B2 mints an
/// ORDINAL `r_<n>` in sorted-member order (no HashMap-seed leak into the id) and
/// a cold group's representative is already the sorted-min member, so the two
/// catalogues match to the byte. A red is a seed-dependent value (the Union-Find
/// root) leaking back into the id.
#[test]
fn route_snapshot_is_byte_stable_across_engines() {
    let corpus = route_corpus(COLD_N);
    let (mut e1, _d1) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut e1, "cold", &corpus.through_a());
    let a = route_snapshot(&mut e1);
    let (mut e2, _d2) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut e2, "cold", &corpus.through_a());
    let b = route_snapshot(&mut e2);

    assert!(a.count() > 0, "expected route groups to form");
    assert_eq!(
        a.catalogue_signature(),
        b.catalogue_signature(),
        "route catalogue (ids + representatives) is not byte-stable across two fresh engines",
    );
}

/// Find a corpus activity by id (its GPS is what we clone / re-travel).
fn corpus_activity<'a>(corpus: &'a LifecycleCorpus, id: &str) -> &'a LifecycleActivity {
    corpus
        .through_a()
        .into_iter()
        .find(|a| a.id == id)
        .expect("route member id must be in the ingested pool")
}

// ============================================================================
// Curiosity 1. ROUTE IDENTITY STABILITY across a resync
// ============================================================================

/// A multi-member route has a STABLE, OPAQUE identity across a resync, an id
/// that does not move with its membership. B2 mints an ordinal `r_<n>` rather
/// than reusing the Union-Find root, so the id is never the group's MIN member
/// id. A positional id would be re-keyed whenever a lower-id member joins,
/// orphaning everything stored against it (the representative and name below).
#[test]
fn route_identity_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (_busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    // Follow the route by membership, then check its id is opaque rather than
    // the positional min-member value a re-key would produce.
    let (new_id, _f) =
        group_carrying(&after, &busiest.activity_ids).expect("route survives by membership");
    let min_member = busiest
        .activity_ids
        .iter()
        .min()
        .cloned()
        .unwrap_or_default();
    assert_ne!(
        new_id, min_member,
        "route identity is positional (the min-member id) after a resync, it is not a stable opaque id",
    );
}

// ============================================================================
// Curiosity 2. REPRESENTATIVE SURVIVAL across a resync
// ============================================================================

/// A user-chosen route representative survives a resync. The incremental path
/// threads `existing_reps` keyed by group_id, so this only holds because the id
/// is stable across the regroup (curiosity 1). A red here means the lookup
/// missed and the representative fell back to the fresh min-member medoid,
/// discarding the user's pick. Membership-anchored, so it follows the route even
/// if the id does churn.
#[test]
fn route_representative_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    let chosen = busiest
        .activity_ids
        .iter()
        .find(|m| **m != busiest.representative_id)
        .expect("a second member to promote")
        .clone();
    engine
        .set_route_representative(&busiest_id, &chosen)
        .expect("set_route_representative");

    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    let rep_after = group_carrying(&after, &busiest.activity_ids).map(|(_, g)| g.representative_id);
    assert_eq!(
        rep_after.as_deref(),
        Some(chosen.as_str()),
        "chosen representative {chosen} did not survive the resync (route rep is now {rep_after:?})",
    );
}

// ============================================================================
// Curiosity 3. NAME SURVIVAL across a resync
// ============================================================================

/// The `route_names` row survives a resync under the SAME id, and that id still
/// addresses the route by membership. This is the durable half of route naming:
/// the name is keyed by group_id, so a re-keyed group would orphan the row and
/// lose the name from every surface. Stable identity (B2) is what keeps the two
/// lookups agreeing. The in-memory surface is gated separately below.
#[test]
fn route_name_row_survives_resync_under_the_stable_id() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    engine
        .set_route_name(&busiest_id, Some("My Climb"))
        .expect("set_route_name");
    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    assert_eq!(
        engine
            .get_all_route_names()
            .get(&busiest_id)
            .map(|s| s.as_str()),
        Some("My Climb"),
        "the route_names row was orphaned by the resync, the name is keyed to an id the regroup discarded",
    );
    let (anchored_id, _) = group_carrying(&after, &busiest.activity_ids)
        .expect("the named route survives by membership");
    assert_eq!(
        anchored_id, busiest_id,
        "the named route came back under {anchored_id}, so the name row at {busiest_id} no longer addresses it",
    );
}

/// A user's custom route name survives a resync on the in-memory surface too.
/// `recompute_groups` rebuilds the groups with `custom_name = None` and never
/// re-hydrates from `route_names`, so `get_route_name` returns None even though
/// the DB row is intact (asserted above). Green when the re-hydrate lands.
#[test]
fn route_name_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (busiest_id, _busiest) = busiest_route(&before).expect("a multi-member route");

    engine
        .set_route_name(&busiest_id, Some("My Climb"))
        .expect("set_route_name");
    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let _after = route_snapshot(&mut engine);

    assert_eq!(
        engine.get_route_name(&busiest_id).as_deref(),
        Some("My Climb"),
        "custom route name did not survive the resync on the in-memory surface",
    );
}

// ============================================================================
// Curiosity 4, does the processed-set short-circuit reach routes?
// ============================================================================

/// Guard: a new activity on an existing route's ground joins that route on
/// regroup. Route grouping keys off group MEMBERSHIP, not
/// `processed_activity_ids`, so the section pipeline's short-circuit cannot
/// freeze it. Membership-anchored, so it follows the route across the regroup.
#[test]
fn route_membership_not_frozen() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (_busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    let member = corpus_activity(&corpus, busiest.representative_id.as_str());
    let clone = LifecycleActivity {
        id: "route_repeat_clone".to_string(),
        sport_type: member.sport_type.clone(),
        start_date_unix: member.start_date_unix + 100_000,
        gps_points: member.gps_points.clone(),
    };
    ingest_step(&mut engine, "repeat", &[&clone]);
    let after = route_snapshot(&mut engine);

    let grew = group_carrying(&after, &busiest.activity_ids)
        .map(|(_, g)| g.activity_ids.contains("route_repeat_clone"))
        .unwrap_or(false);
    assert!(
        grew,
        "an identical-GPS repeat did NOT join the route on regroup, routes have frozen like sections",
    );
}

// ============================================================================
// Curiosity 5. FIRST / SINGLE ATTEMPT SAFETY of route highlights
// ============================================================================

/// Guard: route-highlight trend/delta are first/single-attempt safe and the
/// trend is decoupled from the PR.
///   - every trend is one of {-1, 0, 1} (never NaN, the field is an i8);
///   - the earliest attempt yields trend 0 (the n == 0 branch, no divide-by-n);
///   - a PR attempt (is_pr) can have trend != 1, i.e. being the fastest does NOT
///     force "up", proof that trend reads the running average of preceding
///     attempts (derivations.rs `avg = sum/n`, `speed > avg*1.01`) while is_pr
///     reads best moving time. The intentional split (see the activity-card note
///     in CLAUDE.md), verified here rather than a fixed third-attempt value,
///     which the direction-bucket split inside the function makes brittle.
#[test]
fn route_highlights_trend_is_running_average_safe() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let routes = route_snapshot(&mut engine);
    let (_id, busiest) = busiest_route(&routes).expect("a multi-member route");

    let mut members: Vec<&String> = busiest.activity_ids.iter().collect();
    members.sort_by_key(|id| corpus_activity(&corpus, id).start_date_unix);

    // Speeds slow -> fast (PR) -> medium, so the PR is not the earliest and the
    // trend/PR split is observable across the attempts.
    let times = [1000u32, 500, 600, 700, 800];
    let metrics: Vec<ActivityMetrics> = members
        .iter()
        .enumerate()
        .map(|(i, id)| metrics_for(corpus_activity(&corpus, id), times[i.min(times.len() - 1)]))
        .collect();
    engine
        .set_activity_metrics(metrics)
        .expect("set_activity_metrics");

    let ids: Vec<String> = members.iter().map(|s| (*s).clone()).collect();
    let highlights = engine.get_activity_route_highlights(&ids);
    assert!(
        !highlights.is_empty(),
        "expected highlights for a timed multi-member route"
    );

    for h in &highlights {
        assert!(
            (-1..=1).contains(&h.trend),
            "trend {} out of range for {}",
            h.trend,
            h.activity_id
        );
    }
    let first = highlights
        .iter()
        .find(|h| h.activity_id == ids[0])
        .expect("first attempt highlight");
    assert_eq!(
        first.trend, 0,
        "earliest attempt must be trend 0 (n == 0 branch), got {}",
        first.trend
    );
    assert!(
        highlights.iter().any(|h| h.is_pr && h.trend != 1),
        "a PR attempt should be able to have trend != 1, trend must not be derived from the PR",
    );

    // Single-attempt (singleton) route: exercised safely, trend 0, is_pr true.
    let single = routes
        .groups
        .values()
        .find(|g| g.activity_ids.len() == 1)
        .expect("a singleton route");
    let only = single.activity_ids.iter().next().unwrap().clone();
    engine
        .set_activity_metrics(vec![metrics_for(corpus_activity(&corpus, &only), 900)])
        .expect("metrics");
    let sh = engine.get_activity_route_highlights(&[only.clone()]);
    if let Some(h) = sh.first() {
        assert_eq!(h.trend, 0, "single attempt must be trend 0");
        assert!(h.is_pr, "single attempt is trivially its own PR");
        assert_eq!(
            h.pr_improvement_seconds, None,
            "single attempt has no previous best to improve on"
        );
    }
}
