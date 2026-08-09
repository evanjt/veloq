//! Suite #2: merge, near-duplicate/cross-sport, evolution, and delete.
//!
//! The auto-morph-vs-identity question (invariants 1, 2, 6, 7, 8). A user
//! merge, a near-duplicate corridor, a cross-sport shared corridor, an
//! evolving unpinned section, and a hard delete each probe whether the engine
//! keeps a stable, honest catalogue across resyncs. Persistence-layer
//! behaviour, method-agnostic, so it runs on the fast Control arm. Snapshots
//! read the user-visible DB view (`get_sections_by_type(None)`).
//!
//! Cross-sport merge is not a separate call here: `apply_sections` runs it in
//! its finalize tail, so every `ingest_step` already exercises it.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_merge_evolution -- --include-ignored`

mod lifecycle_support;

use lifecycle_support::*;
use rusqlite::Connection;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

/// Corpus generator constant, mirrored so the parallel-street ground can be
/// reconstructed exactly (the generator offsets in latitude only).
const METERS_PER_DEG_LAT: f64 = 111_320.0;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// A fingerprint carrying only ground, for `ground_matches` against a corridor
/// truth polyline. The match reads `polyline` alone; the rest is inert.
fn ground_fp(polyline: Vec<GpsPoint>) -> SectionFingerprint {
    SectionFingerprint {
        activity_ids: BTreeSet::new(),
        visit_count: 0,
        polyline_point_count: polyline.len(),
        distance_meters: 0.0,
        polyline,
        sport_type: String::new(),
        is_user_defined: false,
    }
}

/// The parallel-street ground: the ride corridor shifted north by `offset_m`,
/// exactly as the corpus seeds its near-miss activities. Lets us ask whether a
/// single section bridges the primary corridor and its 60 m neighbour.
fn parallel_ground(ride_main: &[GpsPoint], offset_m: f64) -> Vec<GpsPoint> {
    ride_main
        .iter()
        .map(|p| {
            GpsPoint::with_elevation(
                p.latitude + offset_m / METERS_PER_DEG_LAT,
                p.longitude,
                p.elevation.unwrap_or(300.0),
            )
        })
        .collect()
}

/// Distinct true sports among a section's members, per the corpus sport map. A
/// set of size > 1 is a cross-sport-collapsed section: a Run filed under a
/// Ride heading (or vice versa), whose per-sport performance view is lost.
fn member_sports(sport_map: &HashMap<String, String>, ids: &BTreeSet<String>) -> BTreeSet<String> {
    ids.iter()
        .filter_map(|id| sport_map.get(id).cloned())
        .collect()
}

/// Junction rows whose section no longer exists. The honest orphan count: a
/// leaked `section_activities` row keeps counting toward nothing and silently
/// bloats the table. Read raw because the visible view cannot see orphans.
fn orphan_junction_rows(db_path: &Path) -> i64 {
    let db = Connection::open(db_path).expect("open raw db for orphan check");
    db.query_row(
        "SELECT COUNT(*) FROM section_activities WHERE section_id NOT IN (SELECT id FROM sections)",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Sport map over the whole corpus, for cross-referencing member sports.
fn sport_map(corpus: &LifecycleCorpus) -> HashMap<String, String> {
    corpus
        .through_e()
        .iter()
        .map(|a| (a.id.clone(), a.sport_type.clone()))
        .collect()
}

// ============================================================================
// Curiosity 1: MERGE (merge_user_sections)
// ============================================================================

/// Gate: a merge must not leak junction rows for the consumed section.
/// `merge_user_sections` moves the rows then deletes the donor's remainder, so
/// no `section_activities` row points at a deleted section.
#[test]
fn merge_leaves_no_orphaned_junction_rows() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let (primary_id, primary) = busiest_section(&cold).expect("a primary section");
    let (secondary_id, _) = cold
        .sections
        .iter()
        .filter(|(id, f)| **id != primary_id && !ground_matches(&primary, f))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
        .expect("a distinct section to consume");

    engine
        .merge_user_sections(&primary_id, &secondary_id)
        .expect("merge_user_sections");

    let orphans = orphan_junction_rows(&dir.path().join("lifecycle.db"));
    assert_eq!(
        orphans, 0,
        "merge leaked {orphans} junction rows pointing at the deleted donor section"
    );
}

/// A user merge survives a later resync as the merge, a durable user-defined
/// fact, not as a coincidence. A naive id-present check would pass even if the
/// id merely reappeared as a fresh auto section, so this asserts the honest
/// signal: the surviving section must be user-defined and still hold the union
/// of both members. That is the merge being recorded as durable user intent and
/// stable identity (B2) stopping the wipe from undoing it.
#[test]
fn merge_survives_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let (primary_id, primary) = busiest_section(&cold).expect("a primary section");
    let (secondary_id, secondary) = cold
        .sections
        .iter()
        .filter(|(id, f)| **id != primary_id && !ground_matches(&primary, f))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
        .expect("a distinct section to merge");
    let want_union: BTreeSet<String> = primary
        .activity_ids
        .union(&secondary.activity_ids)
        .cloned()
        .collect();

    let merged_id = engine
        .merge_user_sections(&primary_id, &secondary_id)
        .expect("merge_user_sections");

    let after = try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after a merge must not crash")
        .snapshot;

    match after.sections.get(&merged_id) {
        None => panic!("merged section {merged_id} was wiped by the resync (merge undone)"),
        Some(kept) => assert!(
            kept.is_user_defined && want_union.is_subset(&kept.activity_ids),
            "merge not durable: id {merged_id} reappeared as a fresh auto section \
             (is_user_defined={}, union_preserved={}). The merge was undone, not honoured",
            kept.is_user_defined,
            want_union.is_subset(&kept.activity_ids),
        ),
    }
}

// ============================================================================
// Curiosity 2: NEAR-DUPLICATE / CROSS-SPORT
// ============================================================================

/// Target gate: a section must never span a corridor and its near-duplicate
/// (invariant 8, under-represent never merge). Red if the consensus method
/// welds the ride corridor and its 60 m parallel into one midline blob; green
/// if it keeps them disjoint or drops the thinner one. The ignore reason is the
/// v1 failure the redesign targets; flip to a live guard if Control already
/// holds.
#[test]
#[ignore = "invariant 8 (near-duplicate merge): consensus method can weld a corridor to its parallel neighbour; Unified corridor-disjointness is the fix"]
fn near_duplicate_corridors_stay_disjoint() {
    let corpus = corpus();
    let ride_main = ground_fp(corpus.corridors[0].polyline.clone());
    let parallel = ground_fp(parallel_ground(&corpus.corridors[0].polyline, 60.0));

    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let bridging: Vec<String> = cold
        .sections
        .iter()
        .filter(|(_, f)| ground_matches(f, &ride_main) && ground_matches(f, &parallel))
        .map(|(id, _)| id.clone())
        .collect();
    assert!(
        bridging.is_empty(),
        "sections {bridging:?} bridge the ride corridor and its 60m parallel (invariant 8)"
    );
}

/// Target gate: a cross-sport corridor must keep a per-sport view: no visible
/// section may pool a Ride and a Run under one heading. Red today: the auto
/// `merge_cross_sport_sections` in the apply tail collapses same-ground
/// Ride/Run sections into one, so a running effort lands under a Ride section
/// with a nonsensical pace PR. Invariant 2 is pooled DETECTION, not collapsed
/// STORAGE; the Battery arm keeps the split.
#[test]
#[ignore = "invariant 2: merge_cross_sport_sections collapses same-ground per-sport sections, losing the per-sport performance view"]
fn cross_sport_corridor_keeps_per_sport_view() {
    let corpus = corpus();
    let smap = sport_map(&corpus);

    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let mixed: Vec<(String, BTreeSet<String>)> = cold
        .sections
        .iter()
        .filter_map(|(id, f)| {
            let sports = member_sports(&smap, &f.activity_ids);
            (sports.len() > 1).then(|| (id.clone(), sports))
        })
        .collect();
    assert!(
        mixed.is_empty(),
        "cross-sport collapse: section(s) {mixed:?} pool multiple true sports (invariant 2)"
    );
}

// ============================================================================
// Curiosity 3: EVOLUTION / AUTO-MORPH (the headline, invariant 7 / B2)
// ============================================================================

/// Track the section that best matches `corridor` in a snapshot: its id,
/// visit_count, and distance. `None` if the ground vanished.
fn track(snap: &SectionSnapshot, corridor: &SectionFingerprint) -> Option<(String, u32, f64)> {
    snap.sections
        .iter()
        .filter(|(_, f)| ground_matches(corridor, f))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.visit_count, f.distance_meters))
}

/// Auto-morph honesty: as a corridor accumulates traversals across two resyncs
/// it must never lose history. Its visit_count is monotone non-decreasing, and
/// the ground never vanishes from the catalogue while activities are only being
/// added. A red here is a section silently shedding traversals as it grows.
#[test]
fn unpinned_corridor_never_loses_visits_as_it_grows() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);

    let s_a = ingest_step(&mut engine, "a/cold", &corpus.through_a()).snapshot;
    let (busy_id, busy) = busiest_section(&s_a).expect("a busy corridor to follow");
    let corridor = ground_fp(busy.polyline.clone());

    let s_b = ingest_step(&mut engine, "b/expand", &refs(&corpus.bucket_b_delta)).snapshot;
    let s_c = ingest_step(&mut engine, "c/single", &[&corpus.bucket_c_single]).snapshot;

    let at = |snap: &SectionSnapshot, step: &str| {
        track(snap, &corridor)
            .unwrap_or_else(|| panic!("corridor {busy_id} vanished from the catalogue at {step}"))
    };
    let (_, va, _) = at(&s_a, "a/cold");
    let (_, vb, _) = at(&s_b, "b/expand");
    let (_, vc, _) = at(&s_c, "c/single");

    assert!(
        va <= vb && vb <= vc,
        "corridor {busy_id} lost traversals while activities were only added: visit_count {va} -> {vb} -> {vc}",
    );
}

/// Invariant 7 / B2 hysteresis: an unpinned section keeps its identity as its
/// extent evolves. Asserts `identity_retention >= 0.85` across both the big
/// expand (a->b) and the single add (b->c) — B2's assign-once identity layer
/// carries the id with the corridor, so a growing set adds sections instead of
/// reshuffling ids off their ground.
#[test]
fn unpinned_evolution_keeps_identity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);

    let s_a = ingest_step(&mut engine, "a/cold", &corpus.through_a()).snapshot;
    let s_b = ingest_step(&mut engine, "b/expand", &refs(&corpus.bucket_b_delta)).snapshot;
    let s_c = ingest_step(&mut engine, "c/single", &[&corpus.bucket_c_single]).snapshot;

    let ab = identity_retention(&s_a, &s_b);
    let bc = identity_retention(&s_b, &s_c);
    assert!(
        ab >= 0.85 && bc >= 0.85,
        "evolution renumbered sections: identity_retention a->b={ab:.2}, b->c={bc:.2} \
         (want >= 0.85, surviving ground kept its id)"
    );
}

// ============================================================================
// Curiosity 4: DELETE-THEN-RESYNC
// ============================================================================

/// A deleted corridor must not re-emerge on resync (invariant 6).
/// `delete_section` records a durable `section_intents` row before the row
/// delete, and the emitter suppresses that ground on every later detect.
#[test]
fn deleted_corridor_stays_deleted() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    let (id, deleted_ground) = busiest_section(&cold).expect("a busy corridor to delete");

    engine.delete_section(&id).expect("delete_section");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;

    let reemerged = after
        .sections
        .values()
        .any(|s| ground_matches(&deleted_ground, s));
    assert!(
        !reemerged,
        "deleted corridor {id} re-emerged as a visible section after resync (invariant 6)"
    );
}
