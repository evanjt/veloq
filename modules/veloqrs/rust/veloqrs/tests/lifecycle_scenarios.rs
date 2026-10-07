//! Lifecycle scenarios A to F.
//!
//! End-to-end tests of the real-app pipeline: SQLite ingest → background
//! section detection → `apply_sections` → snapshot. Each scenario simulates
//! one user-visible step (cold start, expand timerange, add one activity,
//! add a small batch, year expansion, full-rebuild convergence).
//!
//! Test naming convention:
//! - `scenario_*_baseline` prints perf and behaviour metrics for the perf
//!   doc and asserts only weak invariants (ingestion succeeds).
//! - `scenario_*_stable` asserts the strict invariants: an add never removes
//!   an activity from a visible section and the section count never regresses.
//!   They run by default, so a regression fails the suite.
//!
//! The year expansion step (scenario E) is the `lifecycle_year_expansion_cost`
//! bench. The whole file needs the `synthetic` feature, so a plain `cargo test`
//! never builds it.
//!
//! Two purposes:
//! 1. **Performance baseline**, every step prints its timing to stdout. The
//!    perf doc is regenerated from the captured output.
//! 2. **Correctness regression net**, the `_stable` tests pin the behaviour
//!    the visible catalogue guarantees.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

// ============================================================================
// Snapshot types, what we record per step
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
struct SectionFingerprint {
    activity_ids: BTreeSet<String>,
    visit_count: u32,
    polyline_point_count: usize,
    polyline: Vec<tracematch::GpsPoint>,
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

fn snapshot(engine: &mut PersistentEngine) -> SectionSnapshot {
    let sections = engine.get_sections();
    SectionSnapshot {
        sections: sections
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        polyline: s.polyline.clone(),
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

fn fresh_engine() -> (PersistentEngine, TempDir) {
    // RUST_LOG=info on the test command line activates the timing
    // breakdown log lines from tracematch + veloqrs (no-op when unset
    // because the global init is gated). is_test=true keeps the output
    // legible inside `cargo test --nocapture`.
    let _ = env_logger::builder().is_test(true).try_init();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("lifecycle.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    (engine, dir)
}

fn ingest_step(
    engine: &mut PersistentEngine,
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
    let handle = engine.detect_sections_background();
    let (sections, processed_ids) = handle.recv().expect("the detect ran");
    let detection_ms = detect_start.elapsed().as_millis();

    let apply_start = Instant::now();
    engine.apply_sections(sections).expect("apply_sections");
    // Mirror the production poll path, `poll_detection_once`: record
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
// Behaviour metrics, measured, not asserted (printed for the perf doc)
// ============================================================================

#[derive(Debug, Default)]
struct BehaviourDelta {
    sections_disappeared: usize,
    sections_appeared: usize,
    sections_with_lost_activities: usize,
    total_activities_lost: usize,
}

fn measure_delta(before: &SectionSnapshot, after: &SectionSnapshot) -> BehaviourDelta {
    let mut d = BehaviourDelta::default();
    let after_ids: BTreeSet<&String> = after.sections.keys().collect();
    let before_ids: BTreeSet<&String> = before.sections.keys().collect();

    d.sections_disappeared = before_ids.difference(&after_ids).count();
    d.sections_appeared = after_ids.difference(&before_ids).count();

    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            let lost: BTreeSet<&String> = prev.activity_ids.difference(&now.activity_ids).collect();
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
        "[lifecycle/{}] delta: disappeared={} appeared={} sections_with_lost_activities={} total_activities_lost={}",
        label,
        delta.sections_disappeared,
        delta.sections_appeared,
        delta.sections_with_lost_activities,
        delta.total_activities_lost,
    );
}

// ============================================================================
// Strict stability assertions, used by the `_stable` tests
// ============================================================================

fn assert_single_add_stability(
    engine: &mut PersistentEngine,
    before: &SectionSnapshot,
    after: &SectionSnapshot,
    new_activity_id: &str,
) {
    for (id, prev) in &before.sections {
        let now = after
            .sections
            .get(id)
            .unwrap_or_else(|| panic!("section {id} disappeared after a single add"));

        let new_ids: BTreeSet<&String> = now.activity_ids.difference(&prev.activity_ids).collect();
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
        } else if now.polyline == prev.polyline {
            assert!(
                new_ids.iter().all(|s| s.as_str() == new_activity_id),
                "section {id} gained unexpected activities {new_ids:?} (only {new_activity_id} should appear)"
            );
        } else {
            // An agreeing extent adopts the batch line at once, and members
            // follow the drawn line, so a redrawn line may take in rides the
            // old one missed. Each must hold a real pass over the new line.
            let held = engine.get_section_by_id(id).expect("the section is stored");
            for gained in new_ids.iter().filter(|g| g.as_str() != new_activity_id) {
                assert!(
                    held.activity_portions
                        .iter()
                        .any(|p| &p.activity_id == *gained),
                    "section {id} was redrawn and took in {gained} with no pass over the new line"
                );
            }
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

// ============================================================================
// Scenario A, cold start (no comparisons; just baseline)
// ============================================================================

#[test]
fn scenario_a_cold_start_90d_baseline() {
    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
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
// Scenario B, expand 90d → 1y
// ============================================================================

#[test]
fn scenario_b_expand_to_1y_baseline() {
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
    let step_a = ingest_step(&mut engine, "B_step1_A", &corpus.through_a());
    step_a.print();

    let bucket_b: Vec<&LifecycleActivity> = corpus.bucket_b_delta.iter().collect();
    let step_b = ingest_step(&mut engine, "B_step2_expand", &bucket_b);
    step_b.print();

    let delta = measure_delta(&step_a.snapshot, &step_b.snapshot);
    print_delta("B_step2_expand", &delta);

    assert_eq!(step_b.activity_count, 150);
}

// The order-free batch is non-monotone (a full re-detect on the expand can
// reshuffle raw sections). Hysteresis damps that: the visible catalogue
// `get_sections()` reads carries stable ids, holds a debounced dissolve, and
// only ever appends members on an add, so the expand no longer removes an
// activity or regresses the count.
#[test]
fn scenario_b_expand_to_1y_stable() {
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
// Scenario C, single-activity add
// ============================================================================

#[test]
fn scenario_c_single_add_baseline() {
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
}

// The single add re-runs full order-free detection, whose raw batch is
// non-monotone (an add can dissolve a section). Hysteresis is exactly what
// makes the VISIBLE view stable across that: a debounce (streak 1 < k=3) never
// dissolves on one add, and the append-only fold only adds the new activity to
// the corridors it traverses. `assert_single_add_stability` holds on the damped
// `get_sections()` view.
#[test]
fn scenario_c_single_add_stable() {
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
    let _ = ingest_step(&mut engine, "C_strict_A", &corpus.through_a());
    let step_b = ingest_step(
        &mut engine,
        "C_strict_B",
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    let new = &corpus.bucket_c_single;
    let step_c = ingest_step(&mut engine, "C_strict_add1", &[new]);
    assert_single_add_stability(&mut engine, &step_b.snapshot, &step_c.snapshot, &new.id);
}

// ============================================================================
// Scenario D, small batch (3 activities)
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
}

// A 3-activity batch is one detect. The hysteresis layer lets a section
// change only through a debounced, fired event (a sustained re-cut,
// dissolve or merge), so the only way a section may lose members across
// the batch is through an event the ledger recorded for it this step. A
// member dropped from a section whose line did not move is a silent loss.
#[test]
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
    let events_before: BTreeMap<String, usize> = step_c
        .snapshot
        .sections
        .keys()
        .map(|id| (id.clone(), engine.section_history(id).len()))
        .collect();
    let step_d = ingest_step(
        &mut engine,
        "D_strict_add3",
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );
    assert_losses_are_fired_events(&engine, &step_c.snapshot, &step_d.snapshot, &events_before);
}

/// Every member a section lost across a step is explained by a lifecycle
/// event the ledger fired for that section during the step.
fn assert_losses_are_fired_events(
    engine: &PersistentEngine,
    before: &SectionSnapshot,
    after: &SectionSnapshot,
    events_before: &BTreeMap<String, usize>,
) {
    for (id, prev) in &before.sections {
        let fired: Vec<String> = engine
            .section_history(id)
            .into_iter()
            .skip(events_before.get(id).copied().unwrap_or(0))
            .map(|e| e.kind)
            .collect();
        match after.sections.get(id) {
            None => assert!(
                fired.iter().any(|k| k == "dissolved" || k == "merged"),
                "section {id} left the catalogue without a fired retirement: {fired:?}"
            ),
            Some(now) => {
                let removed: BTreeSet<&String> =
                    prev.activity_ids.difference(&now.activity_ids).collect();
                if !removed.is_empty() {
                    assert!(
                        fired.iter().any(|k| k == "recut"),
                        "section {id} lost activities {removed:?} with no fired re-cut: {fired:?}"
                    );
                }
            }
        }
    }
}

// ============================================================================
// Ground diff, for comparing two catalogues that minted their own ids
// ============================================================================

/// What a section in one catalogue turned out to be in the other.
///
/// Section ids are minted per engine, so two catalogues built from the same
/// corpus share none. The activities are the ground: both paths ingested the
/// same rides under the same ids, so a section is identified by the set of
/// activities that traverse it however it was numbered.
#[derive(Debug, PartialEq, Eq)]
enum Ground {
    /// Some section of the other catalogue covers exactly these activities.
    Same,
    /// Every activity sits inside one section of the other catalogue, which
    /// drew one section where this one drew several: a cut the other side
    /// never made, or a fold this side never healed.
    Inside(String),
    /// The activities are spread over more than one section of the other, so
    /// the two catalogues cut the same road in different places.
    Across(usize),
    /// No section of the other catalogue holds any of these activities. This
    /// piece of road exists on one side only.
    Alone,
}

fn ground_of(mine: &SectionFingerprint, other: &SectionSnapshot) -> Ground {
    let mut covering = 0usize;
    let mut container: Option<String> = None;
    for (id, theirs) in &other.sections {
        if theirs.activity_ids == mine.activity_ids {
            return Ground::Same;
        }
        if !theirs.activity_ids.is_disjoint(&mine.activity_ids) {
            covering += 1;
            if mine.activity_ids.is_subset(&theirs.activity_ids) {
                container = Some(id.clone());
            }
        }
    }
    match (covering, container) {
        (0, _) => Ground::Alone,
        (_, Some(id)) => Ground::Inside(id),
        (n, None) => Ground::Across(n),
    }
}

/// Name every section one catalogue holds that the other does not, by what it
/// is over there. The counts alone say nine sections differ; this says what
/// the nine are.
fn print_ground_diff(label: &str, mine: &SectionSnapshot, other: &SectionSnapshot) {
    let mut same = 0usize;
    let mut inside = Vec::new();
    let mut across = Vec::new();
    let mut alone = Vec::new();

    for (id, section) in &mine.sections {
        let size = (section.activity_ids.len(), section.polyline_point_count);
        match ground_of(section, other) {
            Ground::Same => same += 1,
            Ground::Inside(container) => inside.push((id, size, container)),
            Ground::Across(n) => across.push((id, size, n)),
            Ground::Alone => alone.push((id, size)),
        }
    }

    println!(
        "[lifecycle/{}] ground: {} identical, {} inside one of theirs, {} across several, {} on this side only",
        label,
        same,
        inside.len(),
        across.len(),
        alone.len()
    );
    for (id, (visits, points), container) in &inside {
        println!(
            "[lifecycle/{label}]   inside: {id} over {visits} activities, {points} points, inside their {container}"
        );
    }
    for (id, (visits, points), n) in &across {
        println!(
            "[lifecycle/{label}]   across: {id} over {visits} activities, {points} points, touching {n} of theirs"
        );
    }
    for (id, (visits, points)) in &alone {
        println!("[lifecycle/{label}]   alone: {id} over {visits} activities, {points} points");
    }
}

/// The ground of a catalogue: one sorted activity-id set per section, sorted.
///
/// Ids are minted per engine and share nothing between the two paths, so the
/// activities that traverse a section are the only thing the two catalogues can
/// be compared on. Equality here is the convergence gate stated exactly: the same
/// rides played one at a time and played in one batch draw the same library.
fn ground(snapshot: &SectionSnapshot) -> Vec<Vec<String>> {
    let mut all: Vec<Vec<String>> = snapshot
        .sections
        .values()
        .map(|s| s.activity_ids.iter().cloned().collect())
        .collect();
    all.sort();
    all
}

/// The catalogue the detector last emitted, before the identity registry's
/// k-step debounce damps it into the view. `get_sections` can lag this while a
/// dissolve is still pressing through, so a drift measured on the view alone
/// cannot say which layer moved.
fn raw_snapshot(engine: &PersistentEngine) -> SectionSnapshot {
    SectionSnapshot {
        sections: engine
            .raw_detection_catalogue()
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        polyline: s.polyline.clone(),
                        sport_type: s.sport_type.clone(),
                    },
                )
            })
            .collect(),
    }
}

/// Re-detect with no new activities until the view stops moving, or `limit`
/// rounds have passed. Each round is one decisive step for the debounce, so a
/// dissolve armed on the last ingest needs `k` of them before the view can
/// agree with the detector. Returns the rounds actually run.
fn settle(engine: &mut PersistentEngine, limit: usize) -> usize {
    let mut previous = snapshot(engine);
    for round in 1..=limit {
        let handle = engine.detect_sections_background();
        let (sections, processed_ids) = handle.recv().expect("the detect ran");
        engine.apply_sections(sections).expect("apply_sections");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save_processed_activity_ids");
        let now = snapshot(engine);
        if now == previous {
            return round;
        }
        previous = now;
    }
    limit
}

// ============================================================================
// Scenario F, full-rebuild convergence (incremental sequence vs single-shot)
// ============================================================================

// Not `#[ignore]`d: an assertion behind an ignore gates nothing. The whole
// file is behind `required-features = ["synthetic"]`, so a plain `cargo test`
// still never builds it; the suite runs in 19 s in release, measured
// 2026-09-13 on a busy machine.
#[test]
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
    let step_d = ingest_step(
        &mut e_inc,
        "F_inc_D",
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );
    let events_before: BTreeMap<String, usize> = step_d
        .snapshot
        .sections
        .keys()
        .map(|id| (id.clone(), e_inc.section_history(id).len()))
        .collect();
    let inc_step = ingest_step(
        &mut e_inc,
        "F_inc_E",
        &corpus.bucket_e_delta.iter().collect::<Vec<_>>(),
    );
    inc_step.print();
    assert_losses_are_fired_events(&e_inc, &step_d.snapshot, &inc_step.snapshot, &events_before);

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

    // The counts say the two catalogues differ. These say what the difference
    // is made of, which is what a gate on the drift has to be chosen against.
    print_ground_diff("F_inc", &inc_step.snapshot, &full_step.snapshot);
    print_ground_diff("F_full", &full_step.snapshot, &inc_step.snapshot);

    // The same comparison one layer down. `get_sections` above is the DAMPED
    // view: the identity registry holds a section the detector has stopped
    // emitting until k consecutive decisive steps have passed, and the
    // incremental path spent its last step ingesting 396 activities, so any
    // dissolve that step armed cannot have applied. The raw catalogue is what
    // the detector actually emitted, and it is the one a detector defect moves.
    let inc_raw = raw_snapshot(&e_inc);
    let full_raw = raw_snapshot(&e_full);
    println!(
        "[lifecycle/F_raw] incremental={} full={}",
        inc_raw.sections.len(),
        full_raw.sections.len()
    );
    print_ground_diff("F_raw_inc", &inc_raw, &full_raw);
    print_ground_diff("F_raw_full", &full_raw, &inc_raw);

    // And the view once the debounce has run out. Neither engine gains an
    // activity here, so every round is the same detection against the same
    // pool: what still differs after this is a difference the athlete keeps.
    let inc_rounds = settle(&mut e_inc, 8);
    let full_rounds = settle(&mut e_full, 8);
    let inc_settled = snapshot(&mut e_inc);
    let full_settled = snapshot(&mut e_full);
    println!(
        "[lifecycle/F_settled] incremental={} (after {} rounds) full={} (after {} rounds)",
        inc_settled.sections.len(),
        inc_rounds,
        full_settled.sections.len(),
        full_rounds
    );
    print_ground_diff("F_settled_inc", &inc_settled, &full_settled);
    print_ground_diff("F_settled_full", &full_settled, &inc_settled);

    // The owner's rule: "the same activities played one by one since a year, vs
    // 1 batch of the exact same, should end up with the same library". Asserted
    // on the two catalogues that can carry that claim, and not on the damped
    // view above, which is read one step after a 396-activity ingest and is
    // still pressing ten dissolves through the k-step debounce.
    assert_eq!(
        ground(&inc_raw),
        ground(&full_raw),
        "the detector's own catalogues differ: incremental {} sections, full {}",
        inc_raw.sections.len(),
        full_raw.sections.len()
    );
    assert_eq!(
        ground(&inc_settled),
        ground(&full_settled),
        "the settled views differ: incremental {} sections after {} rounds, full {} after {}",
        inc_settled.sections.len(),
        inc_rounds,
        full_settled.sections.len(),
        full_rounds
    );
    // A view that was still moving when `settle` gave up proves nothing: the
    // equality above would then be between two arbitrary intermediate states.
    assert!(
        inc_rounds < 8 && full_rounds < 8,
        "a view was still moving when settle gave up: incremental {inc_rounds}, full {full_rounds}"
    );
}
