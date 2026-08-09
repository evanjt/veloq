//! Suite #2 — engine-side evidence-cache coherence (B1 Phase 2).
//!
//! Phase 2 makes the engine USE tracematch's cached cluster-recompute
//! incremental: `PersistentRouteEngine` holds a per-(sport, cluster) evidence
//! cache in memory and folds only the activities a sync newly sees, recomputing
//! just the touched cluster(s). tracematch proves the cached fold equals the
//! batch; THIS suite proves the ENGINE never desyncs that cache from the DB it
//! applies. An engine-side cache bug silently corrupts the catalogue, so the
//! contract here is strict and checked at EVERY step:
//!
//!   the engine-cached drip == the from-scratch batch over the same set.
//!
//! Driven through the real full-stack path (`ingest_step`: SQLite ingest ->
//! `detect_sections_background` -> cache-aware `apply_sections` -> DB snapshot),
//! on the Battery arm (`DetectionMethod::Unified`) because only Unified uses the
//! cache. Two corpora: a SINGLE home cluster (every add recomputes the one
//! cluster) and a MULTI-cluster two-geography drip (each add bounces between
//! disjoint clusters, so the cache must recompute only the touched one and reuse
//! the other verbatim — the desync that Phase 2's whole point is to get right).
//!
//! Also: a restart (cold cache, catalogue in the DB) must cold-rebatch the full
//! pool, and an apply failure must drop the cache so the next detect rebuilds
//! from the real DB state.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_engine_cache`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

/// Bidirectional ground overlap bar: the cached-drip catalogue and the batch
/// catalogue must each cover >= 95% of the other's ground. tracematch's own
/// convergence gate scores at this bar; the engine must not do worse.
const GROUND_BAR: f64 = 0.95;

/// A cold-only corpus at a chosen origin/seed. The default deltas are huge
/// (bucket_e = 396), so zero them — every drip here uses bucket A only.
fn cold_corpus(origin_lat: f64, seed: u64, n: usize) -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        origin: GpsPoint::with_elevation(origin_lat, 8.55, 410.0),
        seed,
        bucket_a_count: n,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        ..LifecycleConfig::default()
    })
}

/// Clone activities under an id namespace so a second geography (same id scheme)
/// ingests beside the first without an `add_activity` collision. Mirrors
/// `suite2_multigeo_sport::namespaced` (the harness is read-only, so this is
/// private to the suite).
fn namespaced(prefix: &str, acts: &[&LifecycleActivity]) -> Vec<LifecycleActivity> {
    acts.iter()
        .map(|a| {
            let mut c = (*a).clone();
            c.id = format!("{prefix}{}", c.id);
            c
        })
        .collect()
}

/// The from-scratch batch catalogue over `activities`: a fresh Battery engine,
/// one batch ingest, the RAW detection catalogue. This is the B1 convergence
/// ground truth the cached drip must match at every step.
///
/// Reads the raw (pre-hysteresis) catalogue, not the damped visible view: this
/// suite is the B1 evidence-cache parity contract (detection == batch), and since
/// B2 the damped view legitimately lags the raw batch by up to `k` steps while a
/// dissolve debounces (a drip that has seen a section dissolve holds it a few more
/// detects, so its DAMPED count can exceed the batch's — that is B2 working, not a
/// cache desync). DETECTION stays order-free every step, so both sides compare the
/// raw catalogue. B2 identity stability is gated separately (suite2_battery et al.,
/// on the visible view). A one-step batch from empty has no lag, so its raw and
/// damped views are identical anyway.
fn batch_snapshot(activities: &[&LifecycleActivity]) -> SectionSnapshot {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "batch", activities);
    raw_snapshot(&engine)
}

/// Assert the cached-drip catalogue and the batch catalogue describe the same
/// ground in BOTH directions (neither invents nor drops a section's ground).
/// Empty-vs-empty is a match (early prefixes before any section forms), so this
/// only bites once real sections exist.
fn assert_ground_match(step: usize, batch: &SectionSnapshot, drip: &SectionSnapshot) {
    let batch_in_drip = ground_survival(batch, drip);
    let drip_in_batch = ground_survival(drip, batch);
    assert!(
        batch_in_drip >= GROUND_BAR && drip_in_batch >= GROUND_BAR,
        "step {step}: engine-cached drip desynced from batch — batch ground in drip {:.0}%, \
         drip ground in batch {:.0}% (want >= {:.0}% both ways); {} batch sections vs {} drip sections",
        batch_in_drip * 100.0,
        drip_in_batch * 100.0,
        GROUND_BAR * 100.0,
        batch.count(),
        drip.count(),
    );
}

// ============================================================================
// Gate 1 — SINGLE-CLUSTER drip == batch at every step
//
// One home geography: every add touches the single cluster, so the cache
// recomputes the whole cluster each time. This is the tightest test of the
// cache producing the same catalogue as a fresh batch as the pool grows one at
// a time. (Single-cluster adds stay O(N) — sub-linear is B1b — so keep N small.)
// ============================================================================

#[test]
#[ignore = "red: step 1 detects 0 sections on BOTH arms, so this compared two \
            empty catalogues. It passed only because the ground-overlap metric \
            returned 1.0 for empty-vs-empty; that now returns 0.0. Unignore when \
            the drip corpus yields sections at step 1."]
fn single_cluster_drip_matches_batch_every_step() {
    let corpus = cold_corpus(47.37, 0xC0FFEE, 14);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();

    let (mut drip_engine, _dir) = fresh_engine_for(Arm::Battery);
    let mut seen: Vec<&LifecycleActivity> = Vec::new();

    for (i, a) in pool.iter().copied().enumerate() {
        ingest_step(&mut drip_engine, "drip", &[a]);
        seen.push(a);

        let drip = raw_snapshot(&drip_engine);
        let batch = batch_snapshot(&seen);
        assert_ground_match(i + 1, &batch, &drip);
    }
}

// ============================================================================
// Gate 2 — MULTI-CLUSTER interleaved drip == batch at every step
//
// Two geographies ~220 km apart (disjoint clusters). The drip ALTERNATES
// between them, so consecutive adds land in different clusters. This is the
// Phase-2 correctness contract: folding a geo-2 activity must recompute ONLY
// geo 2's cluster and reuse geo 1's verbatim — never disturb the untouched
// cluster, never double-fold, never let the cache drift from the batch. At
// every interleaved step the accumulated set's from-scratch batch must match.
// ============================================================================

#[test]
#[ignore = "red: same root as single_cluster_drip_matches_batch_every_step, \
            0 sections on both arms at step 1."]
fn multi_cluster_interleaved_drip_matches_batch_every_step() {
    let geo1 = cold_corpus(47.37, 0xC0FFEE, 7);
    let geo2_raw = cold_corpus(45.30, 0xBEEF, 7); // ~2 deg south => a distinct cluster
    let geo1_acts: Vec<&LifecycleActivity> = geo1.bucket_a.iter().collect();
    let geo2_acts_owned = namespaced("g2_", &geo2_raw.bucket_a.iter().collect::<Vec<_>>());
    let geo2_acts: Vec<&LifecycleActivity> = geo2_acts_owned.iter().collect();

    // Interleave: g1[0], g2[0], g1[1], g2[1], ... so each add flips clusters.
    let mut order: Vec<&LifecycleActivity> = Vec::new();
    let max = geo1_acts.len().max(geo2_acts.len());
    for i in 0..max {
        if let Some(a) = geo1_acts.get(i) {
            order.push(a);
        }
        if let Some(a) = geo2_acts.get(i) {
            order.push(a);
        }
    }

    let (mut drip_engine, _dir) = fresh_engine_for(Arm::Battery);
    let mut seen: Vec<&LifecycleActivity> = Vec::new();

    for (i, a) in order.iter().copied().enumerate() {
        ingest_step(&mut drip_engine, "drip", &[a]);
        seen.push(a);

        let drip = raw_snapshot(&drip_engine);
        let batch = batch_snapshot(&seen);
        assert_ground_match(i + 1, &batch, &drip);
    }
}

// ============================================================================
// Gate 3 — RESTART cold-rebatches the full pool
//
// The cache is in-memory only (B4 owns persistence), so a fresh engine after a
// restart starts cold while the catalogue lives in the DB. The risk: a cold
// cache plus one new activity must fold the WHOLE pool (cold-rebatch = batch),
// not just the one new id onto an empty cache (which would collapse the
// catalogue). Drip, drop, reopen + load, add one more, detect — the result must
// match the batch over the full post-add set.
// ============================================================================

#[test]
fn restart_then_add_cold_rebatches_to_batch() {
    let corpus = cold_corpus(47.37, 0xC0FFEE, 12);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (first, rest) = pool.split_at(10);

    let (mut e1, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut e1, "cold", first);
    let db_before = snapshot(&mut e1).catalogue_signature();
    drop(e1);

    // Production restart: new() + load() hydrates the catalogue from the DB but
    // comes up with an EMPTY evidence cache.
    let path = dir.path().join("lifecycle.db");
    let mut e2 = veloqrs::PersistentRouteEngine::new(path.to_str().unwrap()).expect("reopen");
    e2.load().expect("load after reopen");
    assert_eq!(
        snapshot(&mut e2).catalogue_signature(),
        db_before,
        "catalogue did not survive the reopen (durability, not the cache)"
    );

    // One new activity onto the cold cache. `new_activity_ids` (from the persisted
    // processed set) is just this one, so detection runs; but the cache is cold,
    // so it must cold-rebatch every prior activity too.
    let new_id = rest[0];
    ingest_step(&mut e2, "post-restart-add", &[new_id]);

    let mut full = first.to_vec();
    full.push(new_id);
    let drip = raw_snapshot(&e2);
    let batch = batch_snapshot(&full);
    assert_ground_match(full.len(), &batch, &drip);
}

// ============================================================================
// Gate 4 — APPLY FAILURE drops the cache, next detect recovers
//
// The consistency rule: the cache must never get ahead of the applied DB. If
// `apply_sections` fails, the sections roll back and the cache is dropped, so
// the next detect cold-rebatches from the real DB state. Force a real apply
// error by making the DB file read-only around the save, then verify the next
// detect reproduces the batch catalogue. Written to assert correctness whether
// or not the platform enforces the read-only (root ignores file perms): both
// branches must land on the batch answer, so the test is meaningful and never
// flakes.
// ============================================================================

#[test]
fn apply_failure_drops_cache_then_recovers() {
    let corpus = cold_corpus(47.37, 0xC0FFEE, 12);
    let pool: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (warm, rest) = pool.split_at(10);

    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "warm", warm); // cache now warm over `warm`

    // A genuinely new activity so the next detect does real work (no
    // short-circuit), plus a fresh detection result + cache update to apply.
    let new_id = rest[0];
    engine
        .add_activity(
            new_id.id.clone(),
            new_id.gps_points.clone(),
            new_id.sport_type.clone(),
        )
        .expect("add_activity");
    engine
        .update_activity_metadata(&new_id.id, Some(new_id.start_date_unix), None, None, None)
        .expect("update_metadata");

    let handle = engine.detect_sections_background(None);
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, _processed) = main.unwrap_or_default();
    assert!(
        cache_update.is_some(),
        "Unified detect produced no cache update to apply"
    );

    // Force the save to fail: make the DB file read-only.
    let path = dir.path().join("lifecycle.db");
    let readonly = std::fs::metadata(&path)
        .and_then(|m| {
            let mut p = m.permissions();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                p.set_mode(0o444);
            }
            #[cfg(not(unix))]
            p.set_readonly(true);
            std::fs::set_permissions(&path, p)
        })
        .is_ok();

    let apply_result = engine.apply_sections_with_cache(sections, cache_update);

    // Restore write access before any further engine work.
    if readonly {
        let mut p = std::fs::metadata(&path).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            p.set_mode(0o644);
        }
        #[cfg(not(unix))]
        p.set_readonly(false);
        std::fs::set_permissions(&path, p).expect("restore writable");
    }

    let mut full = warm.to_vec();
    full.push(new_id);
    let batch = batch_snapshot(&full);

    if apply_result.is_err() {
        // The intended path: apply failed, sections rolled back, cache dropped.
        // The next detect must cold-rebatch the whole pool to the batch answer.
        // processed was never advanced for `new_id`, so detection re-runs.
        ingest_step(&mut engine, "recover", &[]);
        let recovered = raw_snapshot(&engine);
        assert_ground_match(full.len(), &batch, &recovered);
    } else {
        // The platform ignored the read-only (e.g. running as root): the apply
        // succeeded and advanced the cache. Correctness must still hold — the
        // catalogue matches the batch over the full set.
        let drip = raw_snapshot(&engine);
        assert_ground_match(full.len(), &batch, &drip);
    }
}
