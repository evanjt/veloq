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
//! The engine marks every activity "processed" after a full detect and never
//! evicts that mark (`processed_activities` is INSERT OR IGNORE, and neither
//! `add_activity` nor `remove_activity` prunes it). `detect_sections_background`
//! then short-circuits whenever no UNPROCESSED activity remains. So once the cold
//! set is seen, every later mutation of a seen activity is a no-op on the
//! catalogue. That freeze is the mechanism these tests measure. Call it NEW-R4
//! (processed-set has no eviction path); it is distinct from the known R1
//! wipe/threshold/convergence root even though both live in the same
//! orchestration.
//!
//! Snapshots read the user-visible DB view. Idempotency and freeze are
//! method-agnostic persistence behaviours, so the re-ingest tests run the fast
//! Control arm; the drip-order test measures both arms and gates the Battery.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test suite2_order_idempotency \
//!     -- --nocapture --include-ignored

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
/// every add (the daily-drip path). Returns the final visible catalogue. A crash
/// mid-drip is itself a finding and is surfaced, not swallowed.
fn drip(arm: Arm, pool: &[&LifecycleActivity], order: &[usize]) -> SectionSnapshot {
    let (mut engine, _dir) = fresh_engine_for(arm);
    for &i in order {
        try_ingest_step(&mut engine, "drip", &[pool[i]]).expect("drip step must not crash");
    }
    snapshot(&mut engine)
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
            .map(|p| GpsPoint::with_elevation(p.latitude + dlat_deg, p.longitude, p.elevation.unwrap_or(300.0)))
            .collect(),
    }
}

// ============================================================================
// Curiosity 1 — DRIP ORDER (forward / reversed / shuffle)
// ============================================================================

/// Measurement: drip the SAME cold set in three arrival orders and print each
/// final catalogue signature, per arm. Invariant 4 says all three must be equal;
/// this only reports whether they are.
#[test]
fn drip_order_permutations_measured() {
    let corpus = cold_only_corpus(DRIP_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let n = pool.len();

    let forward: Vec<usize> = (0..n).collect();
    let reversed: Vec<usize> = (0..n).rev().collect();
    let shuffled = deterministic_shuffle(n);

    for arm in [Arm::Control, Arm::Battery] {
        // Batch reference: the from-scratch answer the drip should converge to.
        let (mut eb, _db) = fresh_engine_for(arm);
        let batch = ingest_step(&mut eb, "batch", &pool).snapshot;

        let fwd = drip(arm, &pool, &forward);
        let rev = drip(arm, &pool, &reversed);
        let shuf = drip(arm, &pool, &shuffled);
        // Determinism probe: the SAME order on a second fresh engine. If this
        // already differs, the catalogue is not even a function of (set, order)
        // — it varies with the engine's per-instance HashMap seed — which is a
        // stronger invariant-4 violation than arrival-order sensitivity alone.
        let fwd2 = drip(arm, &pool, &forward);

        let sig_f = fwd.catalogue_signature();
        let sig_r = rev.catalogue_signature();
        let sig_s = shuf.catalogue_signature();

        println!(
            "\n[{}] drip-order over {n} activities  (batch = {} sections)",
            arm.label(),
            batch.count(),
        );
        println!(
            "  forward  = {:>2} sections   reversed = {:>2} sections   shuffle = {:>2} sections",
            fwd.count(),
            rev.count(),
            shuf.count(),
        );
        println!(
            "  fwd==rev {}   fwd==shuf {}   rev==shuf {}   ALL EQUAL: {}",
            sig_f == sig_r,
            sig_f == sig_s,
            sig_r == sig_s,
            sig_f == sig_r && sig_r == sig_s,
        );
        println!(
            "  same-order determinism (forward on two fresh engines): {}",
            if sig_f == fwd2.catalogue_signature() { "DETERMINISTIC" } else { "NON-DETERMINISTIC (HashMap-seed)" },
        );
        println!(
            "  forward-drip vs batch: ground recovered={:.0}%  catalogue identical={}",
            ground_survival(&batch, &fwd) * 100.0,
            batch.catalogue_signature() == sig_f,
        );
        println!("  sig[forward ]: {sig_f}");
        println!("  sig[reversed]: {sig_r}");
        println!("  sig[shuffle ]: {sig_s}");
    }
}

/// Target gate (B1 order-free incremental): the one-at-a-time drip must land on
/// the same catalogue regardless of arrival order. Green under B1 — the Unified
/// incremental re-batches the full accumulated pool on every add, so the final
/// catalogue is a pure function of the activity SET, not of arrival order.
/// Battery is the gated arm (mirrors `order_free_cold_batch`); Control is
/// measured above.
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

/// Measurement: cold detect, then re-add one contributing activity verbatim
/// (same id, same GPS, same sport) and re-detect. Print whether the catalogue,
/// the section's visit_count, and its activity_ids moved at all.
#[test]
fn reingest_same_id_measured() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id, before) = busiest_section(&cold).expect("cold detect produced a section");
    let victim = activity_by_id(&pool, before.activity_ids.iter().next().expect("a contributor"));

    let after = try_ingest_step(&mut engine, "reingest", &[victim])
        .expect("re-ingesting an identical activity must not crash")
        .snapshot;

    let after_sec = after.sections.get(&id);
    println!("\n[control] re-ingest same id, same track — activity {}", victim.id);
    println!(
        "  sections {} -> {}   catalogue identical: {}",
        cold.count(),
        after.count(),
        cold.catalogue_signature() == after.catalogue_signature(),
    );
    println!(
        "  busiest section {id}: visit_count {} -> {}   activity_ids {} -> {}",
        before.visit_count,
        after_sec.map(|s| s.visit_count).unwrap_or(0),
        before.activity_ids.len(),
        after_sec.map(|s| s.activity_ids.len()).unwrap_or(0),
    );
}

/// Guard: re-ingesting an unchanged activity is idempotent — the catalogue is
/// byte-identical. Holds today via the empty-new short-circuit (the re-added id
/// is already processed, so detection returns the existing sections untouched).
/// Kept `#[ignore]` so the suite stays green-by-default and uniform with the
/// target gates; the redesign must preserve this.
#[test]
#[ignore = "guard — idempotent re-ingest holds today via the empty-new short-circuit; kept ignored until the suite gates CI"]
fn reingest_same_id_is_idempotent() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let victim = activity_by_id(
        &pool,
        busiest_section(&cold).expect("a section").1.activity_ids.iter().next().expect("a contributor"),
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

/// Measurement: cold detect, then re-add one contributing activity under the
/// SAME id but a track shifted onto entirely different ground. Print whether the
/// catalogue reacts and whether the fed section still describes the old corridor.
#[test]
fn reingest_different_track_measured() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id, before) = busiest_section(&cold).expect("cold detect produced a section");
    let original = activity_by_id(&pool, before.activity_ids.iter().next().expect("a contributor"));
    let mutated = with_shifted_track(original, 0.02);

    let after = try_ingest_step(&mut engine, "reingest-moved", &[&mutated])
        .expect("re-ingesting a moved track must not crash")
        .snapshot;

    let still_old_ground = after
        .sections
        .get(&id)
        .is_some_and(|s| ground_matches(&before, s));
    println!("\n[control] re-ingest same id, track moved ~2.2km — activity {}", original.id);
    println!(
        "  catalogue changed: {}   fed section still on the OLD corridor: {}",
        cold.catalogue_signature() != after.catalogue_signature(),
        still_old_ground,
    );
    println!(
        "  sections {} -> {}  (the moved track is in the DB but the section never re-derived)",
        cold.count(),
        after.count(),
    );
}

/// Target gate: replacing a seen activity's track with different ground must
/// perturb the catalogue (the section it fed can no longer describe the old
/// corridor unchanged). Green under B1 — `add_activity` compares the incoming
/// track against the stored one and evicts the id from the processed set on a
/// genuine change, so the next detect re-derives the touched sections instead of
/// short-circuiting. A verbatim re-ingest is unchanged and stays idempotent
/// (`reingest_same_id_is_idempotent`).
#[test]
fn reingest_different_track_updates_catalogue() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let original = activity_by_id(
        &pool,
        busiest_section(&cold).expect("a section").1.activity_ids.iter().next().expect("a contributor"),
    );
    let mutated = with_shifted_track(original, 0.02);

    let after = try_ingest_step(&mut engine, "reingest-moved", &[&mutated])
        .expect("re-ingest must not crash")
        .snapshot;

    assert_ne!(
        cold.catalogue_signature(),
        after.catalogue_signature(),
        "moving a contributing activity's track left the catalogue unchanged (mutation ignored)",
    );
}

// ============================================================================
// Curiosity 4 — REMOVE-THEN-RE-ADD ROUND TRIP
// ============================================================================

/// Measurement: cold detect (S0), remove a contributor and re-detect (S1),
/// re-add it verbatim and re-detect (S2). Print all three counts, whether the
/// victim is still referenced at each stage, and the pairwise equalities. The
/// interesting reveal is S1 == S0 — removal never reaches the catalogue.
#[test]
fn remove_readd_roundtrip_measured() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let s0 = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (_id, before) = busiest_section(&s0).expect("cold detect produced a section");
    let victim = activity_by_id(&pool, before.activity_ids.iter().next().expect("a contributor"));

    engine.remove_activity(&victim.id).expect("remove_activity");
    let s1 = try_ingest_step(&mut engine, "after-remove", &[])
        .expect("detect after remove must not crash")
        .snapshot;

    let s2 = try_ingest_step(&mut engine, "after-readd", &[victim])
        .expect("detect after re-add must not crash")
        .snapshot;

    let refs_victim = |snap: &SectionSnapshot| snap.sections.values().any(|s| s.activity_ids.contains(&victim.id));
    println!("\n[control] remove -> re-add round trip — activity {}", victim.id);
    println!(
        "  S0 cold={} sections (refs victim {})",
        s0.count(),
        refs_victim(&s0)
    );
    println!(
        "  S1 after-remove={} sections (refs victim {})  S1==S0: {}",
        s1.count(),
        refs_victim(&s1),
        s0.catalogue_signature() == s1.catalogue_signature(),
    );
    println!(
        "  S2 after-readd ={} sections (refs victim {})  S2==S0: {}",
        s2.count(),
        refs_victim(&s2),
        s0.catalogue_signature() == s2.catalogue_signature(),
    );
}

/// Target gate: a remove-then-re-add round trip must pass THROUGH an effective
/// removal — after removing a contributor the catalogue must stop referencing it
/// (S1) before the re-add restores S0. Green under B1: `remove_activity` now
/// evicts the processed set, so the after-remove detect re-derives the catalogue
/// without the victim (S1 drops it) instead of short-circuiting on the stale
/// processed mark. The S2 == S0 round-trip asserts catalogue-signature EQUALITY,
/// so it gates the Battery (Unified) arm — mirroring `drip_order_is_set_invariant`
/// — because the Control/Corridor detector is run-to-run non-deterministic (see
/// `duplicate_in_batch_measured`: two identical Control batches already differ),
/// which would make an exact-catalogue round-trip flaky for reasons orthogonal to
/// removal freshness. (The evidence-purge view of the same stale rows is
/// `remove_activity_purges_evidence` in suite2_lifecycle, still red pending the B4
/// junction-FK fix.)
#[test]
fn remove_readd_roundtrips_through_effective_removal() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let s0 = ingest_step(&mut engine, "cold", &pool).snapshot;
    let victim = activity_by_id(
        &pool,
        busiest_section(&s0).expect("a section").1.activity_ids.iter().next().expect("a contributor"),
    );

    engine.remove_activity(&victim.id).expect("remove_activity");
    let s1 = try_ingest_step(&mut engine, "after-remove", &[])
        .expect("detect after remove must not crash")
        .snapshot;

    let still_referenced = s1.sections.values().any(|s| s.activity_ids.contains(&victim.id));
    assert!(
        !still_referenced,
        "removed activity {} still contributes to the catalogue — removal never reached it",
        victim.id,
    );

    let s2 = try_ingest_step(&mut engine, "after-readd", &[victim])
        .expect("detect after re-add must not crash")
        .snapshot;
    assert_eq!(
        s0.catalogue_signature(),
        s2.catalogue_signature(),
        "re-adding the removed activity did not restore the original catalogue",
    );
}

// ============================================================================
// Curiosity 5 — DUPLICATE ID INSIDE ONE BATCH
// ============================================================================

/// Measurement: ingest the SAME set three ways — a clean batch, a second clean
/// batch (determinism control), and a batch with one activity listed twice.
/// Print distinct-activity counts and the catalogue equalities. INSERT OR REPLACE
/// should collapse the duplicate; the second clean batch isolates whether any
/// catalogue difference is the duplicate or just Control's HashMap-seed batch
/// order-sensitivity (`activity_metadata` is a std HashMap; see
/// `order_free_cold_batch`).
#[test]
fn duplicate_in_batch_measured() {
    let corpus = cold_only_corpus(COLD_N);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();

    let (mut e_single, _d1) = fresh_engine_for(Arm::Control);
    let single = ingest_step(&mut e_single, "single", &pool);
    let (mut e_single2, _d3) = fresh_engine_for(Arm::Control);
    let single2 = ingest_step(&mut e_single2, "single2", &pool);

    // Same set, but the first activity is listed twice in the one batch.
    let mut doubled: Vec<&LifecycleActivity> = pool.clone();
    doubled.insert(0, pool[0]);
    let (mut e_dup, _d2) = fresh_engine_for(Arm::Control);
    let dup = try_ingest_step(&mut e_dup, "dup", &doubled)
        .expect("a duplicate id in one batch must not crash");

    println!("\n[control] duplicate id inside one batch — {} listed twice", pool[0].id);
    println!(
        "  batch slice len: single={} dup={}   distinct activities stored: single={} dup={}",
        pool.len(),
        doubled.len(),
        single.activity_count,
        dup.activity_count,
    );
    println!(
        "  catalogue single==dup: {}   single==single2 (clean, same input): {}",
        single.snapshot.catalogue_signature() == dup.snapshot.catalogue_signature(),
        single.snapshot.catalogue_signature() == single2.snapshot.catalogue_signature(),
    );
    println!(
        "  => the duplicate collapses storage (distinct {}=={}); any catalogue diff is the seed-order confound above, not the duplicate",
        single.activity_count,
        dup.activity_count,
    );
}

/// Guard: a duplicate id inside one batch collapses to a single stored activity
/// (INSERT OR REPLACE) and never crashes — the direct, unconfounded effect of the
/// duplicate. Catalogue equality is deliberately NOT asserted here: two fresh
/// Control engines iterate a differently-seeded `activity_metadata` HashMap, so
/// their catalogues can differ with no duplicate involved (the known Control
/// batch order-sensitivity — see `order_free_cold_batch`). Holds today; kept
/// `#[ignore]` to keep the suite green-by-default and uniform with the target
/// gates.
#[test]
#[ignore = "guard — a duplicate id in one batch collapses to one stored activity via INSERT OR REPLACE; holds today, kept ignored until the suite gates CI"]
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
