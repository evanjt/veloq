//! Suite #2 — arrival order & re-ingest idempotency.
//!
//! Invariant 4: the catalogue is a pure function of the activity SET, never of
//! arrival order or how many times a member was ingested. `order_free_cold_batch`
//! (suite2_battery) already covers the single cold BATCH; this file isolates the
//! two dimensions it does not:
//!   1. one-at-a-time DRIP order (forward vs reversed vs a fixed shuffle),
//!   2. RE-INGEST of an already-seen activity (same id same track, same id new
//!      track, remove-then-re-add, and a duplicate id inside one batch).
//!
//! The engine marks every activity "processed" after a full detect, and
//! `detect_sections_background` short-circuits whenever no UNPROCESSED activity
//! remains. The processed set therefore has to have eviction paths, or a mutated
//! or removed activity would freeze out of the catalogue forever: `add_activity`
//! evicts an id whose track genuinely changed, and `remove_activity` clears the
//! set outright. These tests pin both halves — inert when nothing changed,
//! re-derived when something did.
//!
//! Idempotency is a method-agnostic persistence behaviour, so the re-ingest
//! tests run the fast Control arm. The two gates asserting exact catalogue
//! EQUALITY run the Battery arm, because Control is run-to-run
//! non-deterministic.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test suite2_order_idempotency

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

/// Drip is O(N) detections in debug, so keep the one-at-a-time corpus small.
/// 20 still forms real corridors under the 0.7 ride overlap and min_activities=2.
const DRIP_N: usize = 20;
/// Cold set for the re-ingest tests: one batch detect, then a couple of steps.
const COLD_N: usize = 30;

/// A reduced cold-only corpus. The default `bucket_e_delta_count` is 396, which
/// would generate a huge corpus we never use, so the deltas are explicitly zeroed
/// (bucket A is emitted first, so its content is unaffected by the other counts).
fn cold_only_corpus(bucket_a_count: usize) -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        ..LifecycleConfig::default()
    })
}

/// A fixed, RNG-free permutation of `0..n`. `i -> (37*i + 11) mod n` is a
/// bijection whenever gcd(37, n) == 1; 37 is prime and coprime to our even
/// counts (20, 30). The self-check makes an accidentally non-coprime `n` fail
/// loudly rather than silently drop indices.
fn deterministic_shuffle(n: usize) -> Vec<usize> {
    let perm: Vec<usize> = (0..n).map(|i| (37 * i + 11) % n).collect();
    let mut sorted = perm.clone();
    sorted.sort_unstable();
    assert!(
        sorted.into_iter().eq(0..n),
        "(37*i+11) mod {n} is not a permutation — pick a multiplier coprime to n"
    );
    perm
}

/// Ingest `pool` one activity at a time in `order`, detecting + persisting after
/// every add (the daily-drip path). Returns the final RAW detection catalogue. A
/// crash mid-drip is itself a finding and is surfaced, not swallowed.
///
/// Reads the raw (pre-hysteresis) catalogue: invariant 4 (order-free) is a
/// property of DETECTION, which the raw catalogue is. Since B2 the damped visible
/// view is deliberately path-dependent — the debounce state at the end of a drip
/// depends on the arrival order, so its final catalogue can differ fwd-vs-rev even
/// though detection converged to the same set. Comparing the damped view here
/// would gate B2's intentional path-dependence as a B1 order violation.
fn drip(arm: Arm, pool: &[&LifecycleActivity], order: &[usize]) -> SectionSnapshot {
    let (mut engine, _dir) = fresh_engine_for(arm);
    for &i in order {
        try_ingest_step(&mut engine, "drip", &[pool[i]]).expect("drip step must not crash");
    }
    raw_snapshot(&engine)
}

/// The activity in `pool` with the given id (its GPS is what we re-ingest).
fn activity_by_id<'a>(pool: &[&'a LifecycleActivity], id: &str) -> &'a LifecycleActivity {
    pool.iter()
        .copied()
        .find(|a| a.id == id)
        .expect("section activity id must be in the ingested pool")
}

/// Same activity, track shifted ~2.2 km north — clearly different ground that
/// cannot ground-match the original corridor (50 m tolerance).
fn with_shifted_track(a: &LifecycleActivity, dlat_deg: f64) -> LifecycleActivity {
    LifecycleActivity {
        id: a.id.clone(),
        sport_type: a.sport_type.clone(),
        start_date_unix: a.start_date_unix,
        gps_points: a
            .gps_points
            .iter()
            .map(|p| {
                GpsPoint::with_elevation(
                    p.latitude + dlat_deg,
                    p.longitude,
                    p.elevation.unwrap_or(300.0),
                )
            })
            .collect(),
    }
}

// ============================================================================
// Curiosity 1 — DRIP ORDER (forward / reversed / shuffle)
// ============================================================================

/// Invariant 4 (order-free incremental): the one-at-a-time drip lands on the
/// same catalogue regardless of arrival order. The Unified incremental
/// re-batches the full accumulated pool on every add, so the final catalogue is
/// a pure function of the activity SET. Battery is the gated arm (mirrors
/// `order_free_cold_batch`); Control is order-sensitive by construction.
#[test]
fn drip_order_is_set_invariant() {
    let corpus = cold_only_corpus(DRIP_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let n = pool.len();

    let fwd = drip(Arm::Battery, &pool, &(0..n).collect::<Vec<_>>());
    let rev = drip(Arm::Battery, &pool, &(0..n).rev().collect::<Vec<_>>());
    let shuf = drip(Arm::Battery, &pool, &deterministic_shuffle(n));

    let sig_f = fwd.catalogue_signature();
    let sig_r = rev.catalogue_signature();
    let sig_s = shuf.catalogue_signature();

    assert!(
        sig_f == sig_r && sig_r == sig_s,
        "drip catalogue is arrival-order dependent (fwd {} / rev {} / shuf {} sections)",
        fwd.count(),
        rev.count(),
        shuf.count(),
    );
}

// ============================================================================
// Curiosity 2 — RE-INGEST SAME ID, SAME TRACK (idempotency)
// ============================================================================

/// Guard: re-ingesting an unchanged activity is idempotent — the catalogue is
/// byte-identical. The re-added id is already processed and its track compares
/// equal, so detection short-circuits and returns the existing sections
/// untouched. Paired with `reingest_different_track_updates_catalogue`: a
/// verbatim re-ingest must be inert, a genuine change must not be.
#[test]
fn reingest_same_id_is_idempotent() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let victim = activity_by_id(
        &pool,
        busiest_section(&cold)
            .expect("a section")
            .1
            .activity_ids
            .iter()
            .next()
            .expect("a contributor"),
    );

    let after = try_ingest_step(&mut engine, "reingest", &[victim])
        .expect("re-ingest must not crash")
        .snapshot;

    assert_eq!(
        cold.catalogue_signature(),
        after.catalogue_signature(),
        "re-ingesting an identical activity changed the catalogue (not idempotent)",
    );
}

// ============================================================================
// Curiosity 3 — SAME ID, DIFFERENT TRACK (mutation is ignored)
// ============================================================================

/// Replacing a seen activity's track with different ground perturbs the
/// catalogue: the section it fed can no longer describe the old corridor
/// unchanged. `add_activity` compares the incoming track against the stored one
/// and evicts the id from the processed set on a genuine change, so the next
/// detect re-derives the touched sections instead of short-circuiting.
#[test]
fn reingest_different_track_updates_catalogue() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &pool);
    // Freshness is a DETECTION property, so compare the RAW catalogue: an
    // append-only damped fold never drops the moved contributor from the section
    // it fed, so the visible view legitimately would not change on a single move
    // (that member-level purge is B4). Detection re-derives immediately.
    let cold = raw_snapshot(&engine);
    let original = activity_by_id(
        &pool,
        busiest_section(&cold)
            .expect("a section")
            .1
            .activity_ids
            .iter()
            .next()
            .expect("a contributor"),
    );
    let mutated = with_shifted_track(original, 0.02);

    try_ingest_step(&mut engine, "reingest-moved", &[&mutated]).expect("re-ingest must not crash");
    let after = raw_snapshot(&engine);

    assert_ne!(
        cold.catalogue_signature(),
        after.catalogue_signature(),
        "moving a contributing activity's track left the catalogue unchanged (mutation ignored)",
    );
}

// ============================================================================
// Curiosity 4 — REMOVE-THEN-RE-ADD ROUND TRIP
// ============================================================================

/// A remove-then-re-add round trip passes THROUGH an effective removal: after
/// removing a contributor the catalogue stops referencing it (S1) before the
/// re-add restores S0. `remove_activity` clears the processed set, so the
/// after-remove detect re-derives the catalogue without the victim instead of
/// short-circuiting on a stale processed mark. The S2 == S0 half asserts
/// catalogue-signature EQUALITY, so it runs on the Battery (Unified) arm —
/// mirroring `drip_order_is_set_invariant` — because the Control/Corridor
/// detector is run-to-run non-deterministic, which would make an exact-catalogue
/// round-trip flaky for reasons orthogonal to removal freshness. (The
/// evidence-purge view of the same rows is `remove_activity_purges_evidence` in
/// suite2_lifecycle.)
#[test]
fn remove_readd_roundtrips_through_effective_removal() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &pool);
    // Detection-freshness gate, so read the RAW catalogue: the damped fold is
    // append-only and would keep the removed victim as a phantom member of a
    // surviving section (member-level purge on remove is the B4 junction-FK fix),
    // but DETECTION re-derives the catalogue without it immediately.
    let s0 = raw_snapshot(&engine);
    let victim = activity_by_id(
        &pool,
        busiest_section(&s0)
            .expect("a section")
            .1
            .activity_ids
            .iter()
            .next()
            .expect("a contributor"),
    );

    engine.remove_activity(&victim.id).expect("remove_activity");
    try_ingest_step(&mut engine, "after-remove", &[]).expect("detect after remove must not crash");
    let s1 = raw_snapshot(&engine);

    let still_referenced = s1
        .sections
        .values()
        .any(|s| s.activity_ids.contains(&victim.id));
    assert!(
        !still_referenced,
        "removed activity {} still contributes to the catalogue — removal never reached it",
        victim.id,
    );

    try_ingest_step(&mut engine, "after-readd", &[victim])
        .expect("detect after re-add must not crash");
    let s2 = raw_snapshot(&engine);
    assert_eq!(
        s0.catalogue_signature(),
        s2.catalogue_signature(),
        "re-adding the removed activity did not restore the original catalogue",
    );
}

// ============================================================================
// Curiosity 5 — DUPLICATE ID INSIDE ONE BATCH
// ============================================================================

/// Guard: a duplicate id inside one batch collapses to a single stored activity
/// (INSERT OR REPLACE) and never crashes — the direct, unconfounded effect of the
/// duplicate. Catalogue equality is deliberately NOT asserted here: two fresh
/// Control engines iterate a differently-seeded `activity_metadata` HashMap, so
/// their catalogues can differ with no duplicate involved (the known Control
/// batch order-sensitivity, see `order_free_cold_batch`).
#[test]
fn duplicate_in_batch_collapses_storage() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();

    let (mut e_single, _d1) = fresh_engine_for(Arm::Control);
    let single = ingest_step(&mut e_single, "single", &pool);

    let mut doubled: Vec<&LifecycleActivity> = pool.clone();
    doubled.insert(0, pool[0]);
    let (mut e_dup, _d2) = fresh_engine_for(Arm::Control);
    let dup = try_ingest_step(&mut e_dup, "dup", &doubled).expect("dup batch must not crash");

    assert_eq!(
        single.activity_count, dup.activity_count,
        "a duplicate id in one batch was stored as two activities (expected INSERT OR REPLACE collapse)",
    );
}
