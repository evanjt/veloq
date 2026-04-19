//! Lifecycle scenarios A–G.
//!
//! End-to-end tests of the real-app pipeline: SQLite ingest → background
//! section detection → `apply_sections` → snapshot. Each scenario simulates
//! one user-visible step (cold start, expand timerange, add one activity,
//! add a small batch, year expansion, full-rebuild convergence,
//! cold-after-wipe).
//!
//! Test naming convention:
//! - `scenario_*_baseline` — default-on. Prints perf + behaviour metrics for
//!   the perf doc, asserts only weak invariants (no section disappears
//!   entirely, sport types stay stable, ingestion succeeds). Captures
//!   current behaviour without gating future work.
//! - `scenario_*_stable` — `#[ignore]`. Strict invariants the codebase
//!   should satisfy after Tier 2.1's incremental-consensus rewrite ships.
//!   These are the explicit success gate for that work.
//!
//! Two purposes:
//! 1. **Performance baseline** — every step prints its timing to stdout. The
//!    perf doc is regenerated from the captured output.
//! 2. **Correctness regression net** — the `_stable` tests document the
//!    behaviour we want; the `_baseline` tests document what we have. The
//!    delta between them is the work Tier 2.1 must close.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

// ============================================================================
// Snapshot types — what we record per step
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
struct SectionFingerprint {
    activity_ids: BTreeSet<String>,
    visit_count: u32,
    polyline_point_count: usize,
    sport_type: String,
}

#[derive(Debug, Clone, PartialEq)]
struct SectionSnapshot {
    sections: BTreeMap<String, SectionFingerprint>,
}

impl SectionSnapshot {
    fn count(&self) -> usize {
        self.sections.len()
    }
}

fn snapshot(engine: &mut PersistentRouteEngine) -> SectionSnapshot {
    let sections = engine.get_sections();
    SectionSnapshot {
        sections: sections
            .into_iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        sport_type: s.sport_type.clone(),
                    },
                )
            })
            .collect(),
    }
}

#[derive(Debug)]
struct StepMeasurement {
    label: String,
    activity_count: usize,
    new_activities_in_step: usize,
    section_count: usize,
    ingest_ms: u128,
    detection_ms: u128,
    apply_ms: u128,
    total_ms: u128,
    snapshot: SectionSnapshot,
}

impl StepMeasurement {
    fn print(&self) {
        println!(
            "[lifecycle/{}] activities={:>4} (+{:<3}) sections={:>3} | ingest={:>5}ms detect={:>6}ms apply={:>5}ms total={:>6}ms",
            self.label,
            self.activity_count,
            self.new_activities_in_step,
            self.section_count,
            self.ingest_ms,
            self.detection_ms,
            self.apply_ms,
            self.total_ms,
        );
    }
}

// ============================================================================
// Engine helpers
// ============================================================================

fn fresh_engine() -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("lifecycle.db");
    let engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    (engine, dir)
}

fn ingest_step(
    engine: &mut PersistentRouteEngine,
    label: &str,
    activities: &[&LifecycleActivity],
) -> StepMeasurement {
    let new_activities_in_step = activities.len();

    let ingest_start = Instant::now();
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
    let ingest_ms = ingest_start.elapsed().as_millis();

    let detect_start = Instant::now();
    let handle = engine.detect_sections_background(None);
    let (sections, processed_ids) = handle.recv().unwrap_or_default();
    let detection_ms = detect_start.elapsed().as_millis();

    let apply_start = Instant::now();
    engine.apply_sections(sections).expect("apply_sections");
    // Mirror the production poll path (objects/detection.rs:62-64): record
    // which activity IDs the just-finished detection covered so the next
    // run's "new vs total" check correctly enters incremental mode. Without
    // this, processed_activity_ids stays empty and every step looks like a
    // cold-start to the trigger logic.
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save_processed_activity_ids");
    let apply_ms = apply_start.elapsed().as_millis();

    let total_ms = ingest_start.elapsed().as_millis();

    let snap = snapshot(engine);
    StepMeasurement {
        label: label.to_string(),
        activity_count: engine.get_activity_ids().len(),
        new_activities_in_step,
        section_count: snap.count(),
        ingest_ms,
        detection_ms,
        apply_ms,
        total_ms,
        snapshot: snap,
    }
}

// ============================================================================
// Behaviour metrics — measured, not asserted (printed for the perf doc)
// ============================================================================

#[derive(Debug, Default)]
struct BehaviourDelta {
    sections_disappeared: usize,
    sections_appeared: usize,
    sections_with_lost_activities: usize,
    total_activities_lost: usize,
    sections_with_sport_type_change: usize,
}

fn measure_delta(before: &SectionSnapshot, after: &SectionSnapshot) -> BehaviourDelta {
    let mut d = BehaviourDelta::default();
    let after_ids: BTreeSet<&String> = after.sections.keys().collect();
    let before_ids: BTreeSet<&String> = before.sections.keys().collect();

    d.sections_disappeared = before_ids.difference(&after_ids).count();
    d.sections_appeared = after_ids.difference(&before_ids).count();

    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            if now.sport_type != prev.sport_type {
                d.sections_with_sport_type_change += 1;
            }
            let lost: BTreeSet<&String> =
                prev.activity_ids.difference(&now.activity_ids).collect();
            if !lost.is_empty() {
                d.sections_with_lost_activities += 1;
                d.total_activities_lost += lost.len();
            }
        }
    }
    d
}

fn print_delta(label: &str, delta: &BehaviourDelta) {
    println!(
        "[lifecycle/{}] delta: disappeared={} appeared={} sections_with_lost_activities={} total_activities_lost={} sport_type_changes={}",
        label,
        delta.sections_disappeared,
        delta.sections_appeared,
        delta.sections_with_lost_activities,
        delta.total_activities_lost,
        delta.sections_with_sport_type_change,
    );
}

// ============================================================================
// Strict stability assertions (used by `_stable` tests, gated `#[ignore]`)
// ============================================================================

fn assert_single_add_stability(
    before: &SectionSnapshot,
    after: &SectionSnapshot,
    new_activity_id: &str,
) {
    for (id, prev) in &before.sections {
        let now = after
            .sections
            .get(id)
            .unwrap_or_else(|| panic!("section {id} disappeared after a single add"));
        assert_eq!(
            now.sport_type, prev.sport_type,
            "section {id} sport_type changed across a single add"
        );

        let new_ids: BTreeSet<&String> =
            now.activity_ids.difference(&prev.activity_ids).collect();
        let removed_ids: BTreeSet<&String> =
            prev.activity_ids.difference(&now.activity_ids).collect();
        assert!(
            removed_ids.is_empty(),
            "section {id} lost activity_ids {removed_ids:?} on a single add"
        );

        if new_ids.is_empty() {
            assert_eq!(
                now.visit_count, prev.visit_count,
                "section {id}: activity_ids unchanged but visit_count moved"
            );
        } else {
            assert!(
                new_ids.iter().all(|s| s.as_str() == new_activity_id),
                "section {id} gained unexpected activities {new_ids:?} (only {new_activity_id} should appear)"
            );
        }
    }
}

fn assert_no_activity_removed(before: &SectionSnapshot, after: &SectionSnapshot) {
    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            let removed: BTreeSet<&String> =
                prev.activity_ids.difference(&now.activity_ids).collect();
            assert!(
                removed.is_empty(),
                "section {id} lost activities {removed:?}"
            );
        }
    }
}

// ============================================================================
// Weak invariants (always asserted)
// ============================================================================

/// Every section's sport_type must remain stable across an incremental add.
/// This is a baseline correctness property — even today, sport_type churn
/// would indicate a serious bug.
fn assert_sport_types_stable(before: &SectionSnapshot, after: &SectionSnapshot) {
    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            assert_eq!(
                now.sport_type, prev.sport_type,
                "section {id} sport_type changed: {} -> {}",
                prev.sport_type, now.sport_type
            );
        }
    }
}

// ============================================================================
// Scenario A — cold start (no comparisons; just baseline)
// ============================================================================

#[test]
fn scenario_a_cold_start_90d_baseline() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    let (mut engine, _tmp) = fresh_engine();
    let step = ingest_step(&mut engine, "A_cold_90d", &corpus.through_a());
    step.print();

    assert_eq!(step.activity_count, 60);
    assert!(
        step.section_count > 0,
        "expected at least one section to emerge from 60 activities with 70% corridor overlap"
    );
}

// ============================================================================
// Scenario B — expand 90d → 1y
// ============================================================================

#[test]
fn scenario_b_expand_to_1y_baseline() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    let (mut engine, _tmp) = fresh_engine();
    let step_a = ingest_step(&mut engine, "B_step1_A", &corpus.through_a());
    step_a.print();

    let bucket_b: Vec<&LifecycleActivity> = corpus.bucket_b_delta.iter().collect();
    let step_b = ingest_step(&mut engine, "B_step2_expand", &bucket_b);
    step_b.print();

    let delta = measure_delta(&step_a.snapshot, &step_b.snapshot);
    print_delta("B_step2_expand", &delta);

    assert_eq!(step_b.activity_count, 150);
    assert_sport_types_stable(&step_a.snapshot, &step_b.snapshot);
}

#[test]
#[ignore] // strict — B's 90/150 = 60% triggers FULL detection mode where
          // sections legitimately reshuffle. Stable activity_ids in FULL
          // mode is gated on Tier 2.1's incremental-consensus accumulator,
          // which would let FULL mode also reuse existing section IDs.
fn scenario_b_expand_to_1y_stable() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();
    let step_a = ingest_step(&mut engine, "B_strict_A", &corpus.through_a());
    let step_b = ingest_step(
        &mut engine,
        "B_strict_expand",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    assert_no_activity_removed(&step_a.snapshot, &step_b.snapshot);
    assert!(
        step_b.section_count >= step_a.section_count,
        "section count regressed across timerange expansion: {} -> {}",
        step_a.section_count,
        step_b.section_count
    );
}

// ============================================================================
// Scenario C — single-activity add
// ============================================================================

#[test]
fn scenario_c_single_add_baseline() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();
    let _ = ingest_step(&mut engine, "C_step1_A", &corpus.through_a());
    let step_b = ingest_step(
        &mut engine,
        "C_step2_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );

    let new = &corpus.bucket_c_single;
    let step_c = ingest_step(&mut engine, "C_step3_add1", &[new]);
    step_b.print();
    step_c.print();

    let delta = measure_delta(&step_b.snapshot, &step_c.snapshot);
    print_delta("C_step3_add1", &delta);

    assert_eq!(step_c.activity_count, 151);
    assert_sport_types_stable(&step_b.snapshot, &step_c.snapshot);
}

#[test]
// Promoted to default-on after Tier 1.3: with the bbox pre-filter in
// incremental detection plus correct processed_activity_ids tracking, a
// single overlapping add no longer drops pre-existing activities from
// other sections. This is the strict B1 invariant, locked in.
fn scenario_c_single_add_stable() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();
    let _ = ingest_step(&mut engine, "C_strict_A", &corpus.through_a());
    let step_b = ingest_step(
        &mut engine,
        "C_strict_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let new = &corpus.bucket_c_single;
    let step_c = ingest_step(&mut engine, "C_strict_add1", &[new]);
    assert_single_add_stability(&step_b.snapshot, &step_c.snapshot, &new.id);
}

// ============================================================================
// Scenario D — small batch (3 activities)
// ============================================================================

#[test]
fn scenario_d_small_batch_baseline() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();
    let _ = ingest_step(&mut engine, "D_step1_A", &corpus.through_a());
    let _ = ingest_step(
        &mut engine,
        "D_step2_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let step_c = ingest_step(&mut engine, "D_step3_C", &[&corpus.bucket_c_single]);

    let bucket_d: Vec<&LifecycleActivity> = corpus.bucket_d_delta.iter().collect();
    let step_d = ingest_step(&mut engine, "D_step4_add3", &bucket_d);
    step_c.print();
    step_d.print();

    let delta = measure_delta(&step_c.snapshot, &step_d.snapshot);
    print_delta("D_step4_add3", &delta);

    assert_eq!(step_d.activity_count, 154);
    assert_sport_types_stable(&step_c.snapshot, &step_d.snapshot);
}

#[test]
// Promoted to default-on after Tier 1.3 (see scenario_c_single_add_stable
// for the same reasoning). A 3-activity incremental add must not perturb
// pre-existing activity_ids on any pre-existing section.
fn scenario_d_small_batch_stable() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();
    let _ = ingest_step(&mut engine, "D_strict_A", &corpus.through_a());
    let _ = ingest_step(
        &mut engine,
        "D_strict_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let step_c = ingest_step(&mut engine, "D_strict_C", &[&corpus.bucket_c_single]);
    let step_d = ingest_step(
        &mut engine,
        "D_strict_add3",
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );
    assert_no_activity_removed(&step_c.snapshot, &step_d.snapshot);
}

// ============================================================================
// Scenario E — year expansion (~550 activities, crosses BATCH_CAP=500)
// ============================================================================

#[test]
#[ignore] // ~15s in debug, ~3s in release. Run with --ignored --release.
fn scenario_e_year_expansion_baseline() {
    let cfg = LifecycleConfig::default();
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();

    let step_a = ingest_step(&mut engine, "E_step1_A", &corpus.through_a());
    let step_b = ingest_step(
        &mut engine,
        "E_step2_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let step_c = ingest_step(&mut engine, "E_step3_C", &[&corpus.bucket_c_single]);
    let step_d = ingest_step(
        &mut engine,
        "E_step4_D",
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );
    let step_e = ingest_step(
        &mut engine,
        "E_step5_E",
        &corpus.bucket_e_delta.iter().collect::<Vec<_>>(),
    );
    step_a.print();
    step_b.print();
    step_c.print();
    step_d.print();
    step_e.print();

    let delta = measure_delta(&step_d.snapshot, &step_e.snapshot);
    print_delta("E_step5_E", &delta);

    let total = cfg.bucket_a_count
        + cfg.bucket_b_delta_count
        + 1
        + cfg.bucket_d_delta_count
        + cfg.bucket_e_delta_count;
    assert_eq!(step_e.activity_count, total);
    assert_sport_types_stable(&step_d.snapshot, &step_e.snapshot);
}

// ============================================================================
// Scenario F — full-rebuild convergence (incremental sequence vs single-shot)
// ============================================================================

#[test]
#[ignore] // pairs with scenario E; ~30s combined
fn scenario_f_full_converges_to_incremental_baseline() {
    let cfg = LifecycleConfig::default();
    let corpus = LifecycleCorpus::generate(&cfg);

    // Path 1: incremental sequence A→B→C→D→E
    let (mut e_inc, _tmp1) = fresh_engine();
    let _ = ingest_step(&mut e_inc, "F_inc_A", &corpus.through_a());
    let _ = ingest_step(
        &mut e_inc,
        "F_inc_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let _ = ingest_step(&mut e_inc, "F_inc_C", &[&corpus.bucket_c_single]);
    let _ = ingest_step(
        &mut e_inc,
        "F_inc_D",
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );
    let inc_step = ingest_step(
        &mut e_inc,
        "F_inc_E",
        &corpus.bucket_e_delta.iter().collect::<Vec<_>>(),
    );
    inc_step.print();

    // Path 2: single-shot full ingest of every bucket.
    let (mut e_full, _tmp2) = fresh_engine();
    let full_step = ingest_step(&mut e_full, "F_full_all", &corpus.through_e());
    full_step.print();

    let inc_count = inc_step.section_count as f64;
    let full_count = full_step.section_count as f64;
    let drift = (inc_count - full_count).abs() / full_count.max(1.0);
    println!(
        "[lifecycle/F] incremental={} full={} drift={:.1}%",
        inc_step.section_count,
        full_step.section_count,
        drift * 100.0
    );
}
