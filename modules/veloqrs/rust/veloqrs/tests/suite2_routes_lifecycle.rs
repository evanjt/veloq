//! Suite #2 — route grouping/matching lifecycle.
//!
//! Routes are a SEPARATE pipeline from section detection. The harness
//! `ingest_step` only drives `detect_sections_background`; route grouping is
//! lazy behind `get_groups()` (recomputes when `groups_dirty`, which
//! `add_activity` sets). So every route step here is: ingest via the harness,
//! then call `get_groups()` to force grouping and snapshot the result.
//!
//! Unlike sections, grouping keys off group MEMBERSHIP (`already_grouped`), not
//! `processed_activity_ids`, and the incremental path seeds Union-Find with the
//! existing group structure and threads `existing_reps` through — so routes may
//! be far more stable across a resync than sections. These tests measure whether
//! that holds: identity, chosen representative, custom name, and whether the
//! processed-set freeze (NEW-R4) reaches routes at all.
//!
//! Method-agnostic persistence behaviour, run on the fast Control arm.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test suite2_routes_lifecycle \
//!     -- --nocapture --include-ignored

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
// Route fingerprint — the identity + membership view the app renders
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
    fn multi_member(&self) -> usize {
        self.groups
            .values()
            .filter(|g| g.activity_ids.len() > 1)
            .count()
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

    /// Id-free AND representative-free: pure membership (which activities
    /// co-group). Two catalogues with the same grouping but different group_ids
    /// or representatives produce the SAME string, so this isolates "same ground"
    /// from "same identity".
    fn membership_signature(&self) -> String {
        let mut rows: Vec<String> = self
            .groups
            .values()
            .map(|g| {
                format!(
                    "[{}]",
                    g.activity_ids.iter().cloned().collect::<Vec<_>>().join(",")
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
/// corpus produced only singletons — itself a finding.
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

/// Fraction of `before` group ids still present in `after` (exact id survival).
fn route_id_survival(before: &RouteSnapshot, after: &RouteSnapshot) -> f64 {
    if before.groups.is_empty() {
        return 1.0;
    }
    let kept = before
        .groups
        .keys()
        .filter(|id| after.groups.contains_key(*id))
        .count();
    kept as f64 / before.groups.len() as f64
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
// Curiosity 0 — does the shared corpus even form route groups?
// ============================================================================

/// Measurement: cold-ingest through_a, force grouping, and report how many route
/// groups form and how many have more than one member. Route matching compares
/// whole-route endpoints, while the corpus is built for corridor (section)
/// overlap with random approach/departure segments — so multi-member routes are
/// not guaranteed. This test says plainly whether the route lifecycle is even
/// exercisable on the shared corpus.
#[test]
fn route_formation_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let routes = route_snapshot(&mut engine);

    let largest = routes
        .groups
        .values()
        .map(|g| g.activity_ids.len())
        .max()
        .unwrap_or(0);
    println!(
        "\n[control] route formation over {} activities",
        corpus.through_a().len()
    );
    println!(
        "  route groups={}  multi-member={}  largest group={} members",
        routes.count(),
        routes.multi_member(),
        largest,
    );
    if let Some((id, f)) = busiest_route(&routes) {
        println!(
            "  busiest route {id}: {} members, rep={}, sport={}",
            f.activity_ids.len(),
            f.representative_id,
            f.sport_type,
        );
    } else {
        println!(
            "  NO multi-member route groups — corpus is section-oriented; route CRUD gates cannot target a real route"
        );
    }
}

/// Measurement: cold-group the SAME set on two fresh engines and compare both
/// the full catalogue (with group_ids + representatives) and the id-free
/// membership. `recompute_groups` iterates a std HashMap and the Union-Find root
/// becomes the group_id, so identity may be seed-non-deterministic even when the
/// grouping (membership) is stable.
#[test]
fn route_grouping_determinism_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut e1, _d1) = fresh_engine_for(Arm::Control);
    ingest_step(&mut e1, "cold", &corpus.through_a());
    let a = route_snapshot(&mut e1);
    let (mut e2, _d2) = fresh_engine_for(Arm::Control);
    ingest_step(&mut e2, "cold", &corpus.through_a());
    let b = route_snapshot(&mut e2);

    println!("\n[control] route grouping determinism (same set, two fresh engines)");
    println!(
        "  groups {} vs {}   full catalogue (ids+reps) identical: {}   membership identical: {}",
        a.count(),
        b.count(),
        a.catalogue_signature() == b.catalogue_signature(),
        a.membership_signature() == b.membership_signature(),
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
// Curiosity 1 — ROUTE IDENTITY STABILITY across a resync
// ============================================================================

/// Measurement: cold-group, then resync bucket_d_delta and regroup. Report route
/// id survival and how the busiest route's membership drifts. Sections renumber
/// wholesale on a resync (positional ids); this asks whether routes do too.
#[test]
fn route_identity_across_resync_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    // Membership-anchored: which group now carries the cold route's members?
    let anchored = group_carrying(&after, &busiest.activity_ids);
    let min_member = busiest
        .activity_ids
        .iter()
        .min()
        .cloned()
        .unwrap_or_default();
    println!(
        "\n[control] route identity across resync (+{} activities)",
        corpus.bucket_d_delta.len()
    );
    println!(
        "  groups {} -> {}   id survival = {:.0}%",
        before.count(),
        after.count(),
        route_id_survival(&before, &after) * 100.0,
    );
    println!("  busiest cold id={busiest_id}  min-member={min_member}",);
    println!(
        "  cold id still addresses the route: {}   membership-anchored new id: {:?}   new id == min-member: {}",
        after.groups.contains_key(&busiest_id),
        anchored.as_ref().map(|(id, _)| id.clone()),
        anchored
            .as_ref()
            .map(|(id, _)| *id == min_member)
            .unwrap_or(false),
    );
}

/// Target gate: a multi-member route has a STABLE, OPAQUE identity across a
/// resync — an id that does not move with its membership. Fails today, and this
/// is R2 reaching routes: the group_id is the Union-Find ROOT, which the cold
/// FULL path and the incremental RESYNC path assign by different rules. The cold
/// full path roots at a hash-seed dependent member; the incremental resync path
/// deterministically re-roots to the group's MIN member id. So after any resync
/// the id is positional (== min member), a value that changes whenever the
/// full/incremental paths disagree (the cold id then vanishes) or a lower-id
/// member joins — orphaning anything keyed to it (see the representative and name
/// gates). Deterministic: post-resync the id is the min member. Green when routes
/// carry an assign-once opaque id (B2).
#[test]
#[ignore = "R2 reaches routes — group_id is a positional Union-Find root (min member after an incremental resync), not a stable identity, so it moves on resync"]
fn route_identity_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (_busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    // The route still exists by membership; the defect is that its id is now the
    // positional min-member, not a stable opaque identity.
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
        "route identity is positional (the min-member id) after a resync — it is not a stable id (R2 reaches routes)",
    );
}

// ============================================================================
// Curiosity 2 — REPRESENTATIVE SURVIVAL across a resync
// ============================================================================

/// Measurement: promote a non-default member to representative, resync, regroup.
/// Report the representative BOTH by the old id and membership-anchored (the old
/// id vanishes on resync per curiosity 1, so the honest question is what the
/// route — followed by its members — now calls its representative).
#[test]
fn route_representative_survival_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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

    let anchored = group_carrying(&after, &busiest.activity_ids);
    println!("\n[control] representative survival — route {busiest_id}");
    println!("  chose rep {chosen} (was {})", busiest.representative_id,);
    println!(
        "  after resync: by old id rep={:?}   membership-anchored rep={:?}   stuck={}",
        after
            .groups
            .get(&busiest_id)
            .map(|g| g.representative_id.clone()),
        anchored.as_ref().map(|(_, g)| g.representative_id.clone()),
        anchored
            .as_ref()
            .map(|(_, g)| g.representative_id == chosen)
            .unwrap_or(false),
    );
    println!(
        "  => the re-keyed group misses existing_reps (keyed by the vanished cold id) and falls back to the min-member medoid"
    );
}

/// Target gate: a user-chosen route representative survives a resync. Fails on
/// most seeds — a corollary of the identity defect. The incremental path threads
/// `existing_reps` keyed by group_id, but the resync re-keys the route to the
/// min-member id (curiosity 1), so the lookup MISSES and the representative falls
/// back to the fresh min-member medoid, discarding the user's pick. Membership-
/// anchored so it follows the route past the id churn. SEED-CONDITIONAL: green
/// only on the ~1-in-5 hash seed where the cold Union-Find root already equals the
/// min-member (so identity does not churn and `existing_reps` hits); red
/// otherwise. Green unconditionally once identity is a stable assign-once id (B2)
/// or the representative is stored against a stable key.
#[test]
#[ignore = "route representative lost on resync (seed-conditional) — existing_reps is keyed by the group_id, which the resync re-roots, so the user's pick is discarded unless the cold root happens to equal the min-member; depends on B2 identity"]
fn route_representative_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
// Curiosity 3 — NAME SURVIVAL across a resync
// ============================================================================

/// Measurement: name a route, resync, regroup. Report the name from BOTH query
/// surfaces — `get_route_name` (in-memory group) and `get_all_route_names` (the
/// `route_names` DB table) — because `recompute_groups` rebuilds the in-memory
/// groups with `custom_name = None` and never re-hydrates from the table.
#[test]
fn route_name_survival_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let before = route_snapshot(&mut engine);
    let (busiest_id, busiest) = busiest_route(&before).expect("a multi-member route");

    engine
        .set_route_name(&busiest_id, Some("My Climb"))
        .expect("set_route_name");
    println!("\n[control] name survival — route {busiest_id} named \"My Climb\"");
    println!(
        "  before resync: get_route_name = {:?}",
        engine.get_route_name(&busiest_id)
    );

    ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta));
    let after = route_snapshot(&mut engine);

    let in_memory = engine.get_route_name(&busiest_id);
    let in_db = engine.get_all_route_names().get(&busiest_id).cloned();
    let anchored_name = group_carrying(&after, &busiest.activity_ids)
        .and_then(|(id, _)| engine.get_all_route_names().get(&id).cloned());
    println!(
        "  after resync:  get_route_name (in-memory)={:?}   get_all_route_names[old id] (DB)={:?}   name under the re-keyed route={:?}",
        in_memory, in_db, anchored_name,
    );
    println!(
        "  => the name was stored against the cold id, which the resync re-keys; the route_names row is orphaned AND recompute never re-hydrates custom_name, so the name is gone from every surface"
    );
}

/// Target gate: a user's custom route name survives a resync. Fails today, and
/// worse than expected — the name is lost from EVERY surface. Two compounding
/// causes: (1) the name is stored in `route_names` keyed by the group_id, which
/// the resync re-keys (curiosity 1), orphaning the row; (2) `recompute_groups`
/// rebuilds groups with `custom_name = None` and never re-hydrates from
/// `route_names`, so even the re-keyed route shows no name. Green needs a stable
/// route identity (B2) plus a re-hydrate on recompute.
#[test]
#[ignore = "route name lost on resync from every surface — stored against a re-keyed group_id (orphaned) and recompute never re-hydrates custom_name (depends on B2 identity)"]
fn route_name_survives_resync() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
// Curiosity 4 — DOES THE PROCESSED-SET FREEZE (NEW-R4) REACH ROUTES?
// ============================================================================

/// Measurement: add a NEW activity whose GPS is identical to an existing route
/// member (guaranteed same ground/endpoints), regroup, and report whether the
/// route's membership grows. Sections FREEZE here (a new activity on seen ground
/// is a no-op via the processed-set short-circuit). Routes key off group
/// membership instead, so they should NOT freeze.
#[test]
fn route_membership_update_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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

    // Membership-anchored (the group_id re-keys on regroup, curiosity 1).
    let anchored = group_carrying(&after, &busiest.activity_ids);
    println!(
        "\n[control] does the freeze reach routes — added an identical-GPS repeat of {}",
        member.id
    );
    println!(
        "  route carrying the cold members: {} -> {} members   contains the repeat = {}",
        busiest.activity_ids.len(),
        anchored
            .as_ref()
            .map(|(_, g)| g.activity_ids.len())
            .unwrap_or(0),
        anchored
            .as_ref()
            .map(|(_, g)| g.activity_ids.contains("route_repeat_clone"))
            .unwrap_or(false),
    );
    println!(
        "  => route grouping keys off membership, not processed_activity_ids, so NEW-R4 does not freeze it"
    );
}

/// Guard: a new activity on an existing route's ground joins that route on
/// regroup — routes are NOT frozen by the processed-set short-circuit that
/// freezes sections (NEW-R4). This bounds the freeze's blast radius: it stops at
/// the section pipeline. Membership-anchored (the group re-keys on regroup).
/// Holds today; kept `#[ignore]` for uniformity. Red would mean the freeze has
/// spread to routes.
#[test]
#[ignore = "guard — routes update membership for a new activity on seen ground (freeze/NEW-R4 does not reach routes); holds today, kept ignored until the suite gates CI"]
fn route_membership_not_frozen() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
        "an identical-GPS repeat did NOT join the route on regroup — routes have frozen like sections",
    );
}

// ============================================================================
// Curiosity 5 — FIRST / SINGLE ATTEMPT SAFETY of route highlights
// ============================================================================

/// Measurement: give the busiest route timed attempts and read
/// `get_activity_route_highlights`. Print the per-attempt trend/is_pr, and probe
/// a first attempt and a single-attempt (singleton) route. The moving_times are
/// chosen so the third attempt is UP versus the running average yet is NOT the
/// PR — the case that distinguishes trend (running average) from delta (PR).
#[test]
fn route_highlights_first_attempt_measured() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let routes = route_snapshot(&mut engine);
    let (_id, busiest) = busiest_route(&routes).expect("a multi-member route");

    // Order members by date and assign moving_times so speeds go slow, fast (PR),
    // then medium (above the running average of the first two, but not a PR).
    let mut members: Vec<&String> = busiest.activity_ids.iter().collect();
    members.sort_by_key(|id| corpus_activity(&corpus, id).start_date_unix);
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

    println!(
        "\n[control] route highlights — {} timed attempts on the busiest route",
        ids.len()
    );
    for h in &highlights {
        println!(
            "  {} trend={:>2} is_pr={} time_delta={:?} pr_improvement={:?}",
            h.activity_id, h.trend, h.is_pr, h.time_delta_seconds, h.pr_improvement_seconds,
        );
    }

    // First (earliest) attempt.
    let first = &ids[0];
    let first_h = highlights.iter().find(|h| &h.activity_id == first);
    println!(
        "  first attempt {first}: trend = {:?} (expect 0)",
        first_h.map(|h| h.trend)
    );

    // Single-attempt route: any singleton group.
    if let Some((sid, sfp)) = routes
        .groups
        .iter()
        .find(|(_, g)| g.activity_ids.len() == 1)
    {
        let only = sfp.activity_ids.iter().next().unwrap().clone();
        engine
            .set_activity_metrics(vec![metrics_for(corpus_activity(&corpus, &only), 900)])
            .expect("metrics");
        let sh = engine.get_activity_route_highlights(&[only.clone()]);
        println!(
            "  single-attempt route {sid}: {} highlight(s), trend={:?}, is_pr={:?} (no crash / NaN)",
            sh.len(),
            sh.first().map(|h| h.trend),
            sh.first().map(|h| h.is_pr),
        );
    }
}

/// Guard: route-highlight trend/delta are first/single-attempt safe and the
/// trend is decoupled from the PR.
///   - every trend is one of {-1, 0, 1} (never NaN — the field is an i8);
///   - the earliest attempt yields trend 0 (the n == 0 branch, no divide-by-n);
///   - a PR attempt (is_pr) can have trend != 1, i.e. being the fastest does NOT
///     force "up" — proof that trend reads the running average of preceding
///     attempts (derivations.rs `avg = sum/n`, `speed > avg*1.01`) while is_pr
///     reads best moving time. The intentional split (see the activity-card note
///     in CLAUDE.md), verified here rather than a fixed third-attempt value,
///     which the direction-bucket split inside the function makes brittle.
/// Holds today; kept `#[ignore]` for uniformity with the target gates.
#[test]
#[ignore = "guard — route highlight trend is first/single-attempt safe and decoupled from the PR (running average); holds today, kept ignored until the suite gates CI"]
fn route_highlights_trend_is_running_average_safe() {
    let corpus = route_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
        "a PR attempt should be able to have trend != 1 — trend must not be derived from the PR",
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
