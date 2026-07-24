//! Suite #2 — geometry & metadata edit survival + side effects.
//!
//! The believability core beyond accept/hide (`suite2_edits.rs`): when a user
//! renames, re-references, trims, resets, or recalculates a section, the edit
//! must survive later resyncs and must not corrupt geometry or the performance
//! view. These behaviours live in the persistence layer and are method-agnostic,
//! so they run on the fast Control arm.
//!
//! What this suite pins down (all observed on the Control arm, default corpus):
//! - Geometry edits (rename/trim/set_reference) auto-promote to user-defined and
//!   therefore inherit the R2 positional-id crash on the next resync. Documented
//!   here per op; the survival gate lives below. Root R2 is already reported by
//!   `suite2_edits.rs::accept_survives_resync`, so it is noted, not re-raised.
//! - set_section_reference honours the real-trace invariant: the new polyline is
//!   a contiguous slice of ONE reference activity, never the whole track (Bug 1
//!   stays fixed). Guarded live.
//! - The two reset paths disagree: reset_section_bounds fully restores and
//!   disarms the crash; reset_section_reference is a half-reset that keeps the
//!   replaced geometry and the backup, so it neither restores nor disarms.
//! - recalculate_section_polyline is non-idempotent and can collapse the extent.
//! - Geometry edits do not invalidate the performance cache, so
//!   get_section_performances serves pre-edit laps until an unrelated event
//!   clears it.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_edits_geometry \
//!       -- --nocapture --include-ignored`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::{ActivityMetrics, PersistentRouteEngine};

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Haversine metres. Local so we can measure a polyline's length and its overlap
/// with a source track without reaching into tracematch or the harness privates.
fn haversine_m(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let r = 6_371_000.0_f64;
    let (la1, lo1) = (a.latitude.to_radians(), a.longitude.to_radians());
    let (la2, lo2) = (b.latitude.to_radians(), b.longitude.to_radians());
    let dla = la2 - la1;
    let dlo = lo2 - lo1;
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().asin()
}

fn polyline_len_m(line: &[GpsPoint]) -> f64 {
    line.windows(2).map(|w| haversine_m(&w[0], &w[1])).sum()
}

/// Fraction of `line` points within `tol_m` of any point on `reference`. Near
/// 1.0 means every point of `line` sits on `reference` (one real activity).
fn coverage(line: &[GpsPoint], reference: &[GpsPoint], tol_m: f64) -> f64 {
    if line.is_empty() || reference.is_empty() {
        return 0.0;
    }
    let covered = line
        .iter()
        .filter(|p| {
            reference
                .iter()
                .map(|r| haversine_m(p, r))
                .fold(f64::INFINITY, f64::min)
                <= tol_m
        })
        .count();
    covered as f64 / line.len() as f64
}

/// Trim indices for the middle 60% of an `n`-point polyline. A generous inner
/// slice that stays well above the 5-point / 50 m minimums.
fn middle_trim(n: usize) -> (u32, u32) {
    ((n / 5) as u32, (n * 4 / 5) as u32)
}

/// Give every activity metrics + a 1 s-per-point time stream so
/// `get_section_performances` can name, date, and time each traversal. Without
/// this the perf query returns no records (the synthetic corpus ships neither
/// `activity_metrics` rows nor time streams).
fn seed_metrics_and_streams(engine: &mut PersistentRouteEngine, activities: &[&LifecycleActivity]) {
    let mut metrics = Vec::new();
    let mut ids = Vec::new();
    let mut times: Vec<u32> = Vec::new();
    let mut offsets = Vec::new();
    for a in activities {
        let n = a.gps_points.len() as u32;
        offsets.push(times.len() as u32);
        times.extend(0..n);
        ids.push(a.id.clone());
        metrics.push(ActivityMetrics {
            activity_id: a.id.clone(),
            name: a.id.clone(),
            date: a.start_date_unix,
            distance: polyline_len_m(&a.gps_points),
            moving_time: n,
            elapsed_time: n,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: a.sport_type.clone(),
        });
    }
    offsets.push(times.len() as u32);
    engine.set_activity_metrics(metrics).expect("set_activity_metrics");
    engine.set_time_streams_flat(&ids, &times, &offsets);
}

// ============================================================================
// Measurements — never fail, document today's reality.
// ============================================================================

/// A rename edits metadata only, yet it silently auto-promotes the auto section
/// to user-defined. That spares its row from the detection wipe but leaves its
/// positional id in place, so the next resync collides on INSERT (root R2). A
/// bare rename is therefore enough to break the following sync.
#[test]
fn rename_survives_locally_but_resync_crashes() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.rename_section(&id, "My Climb").expect("rename_section");
    let renamed = engine.get_section(&id).expect("get_section after rename");
    println!(
        "[rename] name={:?} user_defined={} (auto-promoted by a metadata-only edit)",
        renamed.name, renamed.is_user_defined,
    );

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => println!(
            "[resync] OK sections={} name_survived={:?}",
            step.snapshot.count(),
            engine.get_section(&id).and_then(|s| s.name),
        ),
        Err(e) => println!("[resync] CRASH (root R2): {e}"),
    }
}

/// set_section_reference on an auto section extracts the matching portion of the
/// new reference activity. The junction stays consistent (one row per traversal,
/// no duplicate explosion), but the edit promotes to user-defined and so also
/// hits R2 on resync.
#[test]
fn set_reference_keeps_junction_consistent_but_resync_crashes() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();

    engine.set_section_reference(&id, &new_ref).expect("set_section_reference");
    let after = engine.get_section(&id).expect("get_section");
    println!(
        "[set_ref] visits={} acts={} rep={:?} (visits >> acts would flag duplicate junction rows)",
        after.visit_count,
        after.activity_ids.len(),
        after.representative_activity_id,
    );

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => println!("[resync] OK sections={}", step.snapshot.count()),
        Err(e) => println!("[resync] CRASH (root R2): {e}"),
    }
}

/// reset_section_reference claims to restore automatic behaviour but only clears
/// the is_user_defined flag. It leaves the user-replaced polyline in place and
/// leaves the original_polyline_json backup, so (a) the geometry is not actually
/// reset and (b) the backup keeps the row spared, so the resync still crashes.
/// Contrast reset_section_bounds below, which does the full job.
#[test]
fn reset_reference_is_a_half_reset() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();

    engine.set_section_reference(&id, &new_ref).expect("set_section_reference");
    let replaced_dist = engine.get_section(&id).unwrap().distance_meters;

    engine.reset_section_reference(&id).expect("reset_section_reference");
    let reset = engine.get_section(&id).unwrap();
    println!(
        "[reset_ref] user_defined={} dist={:.0}m orig_dist={:.0}m geometry_restored={} backup_cleared={}",
        reset.is_user_defined,
        reset.distance_meters,
        before.distance_meters,
        (reset.distance_meters - before.distance_meters).abs() < 1.0,
        !engine.has_original_bounds(&id),
    );
    println!("       (still holds the replaced {replaced_dist:.0}m geometry, not the original)");

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => println!("[resync] OK sections={}", step.snapshot.count()),
        Err(e) => println!("[resync] CRASH (backup left in place keeps the row spared): {e}"),
    }
}

/// Trimming to the inner 60% rewrites the junction (some end-only traversals no
/// longer match) and promotes to user-defined, so the resync hits R2.
#[test]
fn trim_rewrites_junction_and_resync_crashes() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    let after = engine.get_section(&id).unwrap();
    println!(
        "[trim {start}..{end}] pts {}->{} dist {:.0}->{:.0}m acts {}->{} has_backup={}",
        before.polyline_point_count,
        after.polyline.len(),
        before.distance_meters,
        after.distance_meters,
        before.activity_ids.len(),
        after.activity_ids.len(),
        engine.has_original_bounds(&id),
    );

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => println!("[resync] OK sections={}", step.snapshot.count()),
        Err(e) => println!("[resync] CRASH (root R2): {e}"),
    }
}

/// reset_section_bounds is the complete reset: it restores the original polyline,
/// clears the backup, and clears is_user_defined. The section is therefore
/// deletable again, so the resync wipe-rebuild proceeds without colliding and the
/// corridor snaps back to fresh detection.
#[test]
fn reset_bounds_snaps_geometry_back() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    let trimmed_dist = engine.get_section(&id).unwrap().distance_meters;
    engine.reset_section_bounds(&id).expect("reset_section_bounds");
    let reset = engine.get_section(&id).unwrap();
    println!(
        "[reset_bounds] trimmed={:.0}m reset={:.0}m orig={:.0}m restored={} user_defined={} backup_cleared={}",
        trimmed_dist,
        reset.distance_meters,
        before.distance_meters,
        (reset.distance_meters - before.distance_meters).abs() < 1.0,
        reset.is_user_defined,
        !engine.has_original_bounds(&id),
    );

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => println!("[resync] OK sections={} (crash disarmed)", step.snapshot.count()),
        Err(e) => println!("[resync] CRASH: {e}"),
    }
}

/// recalculate_section_polyline rebuilds a section's consensus from its traces.
/// It is non-idempotent (a second call changes the shape again) and, being a
/// weighted average sensitive to rayon scheduling, non-deterministic across runs
/// with an extent that can collapse far below the original. The remnant still
/// lies on real corridor (high single-activity coverage), so the defect is
/// instability, not going off-track.
#[test]
fn recalculate_drifts_and_can_collapse() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let one_act = engine
        .get_gps_track(before.activity_ids.iter().next().unwrap())
        .unwrap_or_default();

    let first = engine.recalculate_section_polyline(&id);
    let second = engine.recalculate_section_polyline(&id);
    let after = engine.get_section(&id).expect("get_section after recalc");
    println!(
        "[recalc] cold={}pts/{:.0}m  #1={:?}  #2={:?}  idempotent={}",
        before.polyline_point_count,
        before.distance_meters,
        first.as_ref().map(|r| (r.polyline_point_count, r.distance_meters.round())),
        second.as_ref().map(|r| (r.polyline_point_count, r.distance_meters.round())),
        match (&first, &second) {
            (Some(a), Some(b)) => a.polyline_point_count == b.polyline_point_count,
            _ => false,
        },
    );
    println!(
        "       final pts={} dist={:.0}m coverage_of_one_activity={:.2}",
        after.polyline.len(),
        after.distance_meters,
        coverage(&after.polyline, &one_act, 50.0),
    );
}

/// Geometry edits do not invalidate the performance cache (keyed on section id;
/// only delete_section invalidates it). A read straight after a trim serves the
/// pre-trim laps and PRs. Proven by forcing the invalidation the edit skipped
/// (via set_activity_metrics) and re-reading: the numbers move.
#[test]
fn trim_leaves_a_stale_performance_cache() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    seed_metrics_and_streams(&mut engine, &corpus.through_a());

    let primed = engine.get_section_performances(&id);
    let (start, end) = middle_trim(before.polyline_point_count);
    engine.trim_section(&id, start, end).expect("trim_section");
    let stale = engine.get_section_performances(&id);

    // Force the invalidation the trim omitted, then read the true post-trim view.
    force_perf_invalidation(&mut engine, &corpus.bucket_c_single.id);
    let fresh = engine.get_section_performances(&id);

    println!(
        "[perf] primed={}rec/{:?}  after_trim_stale={}rec/{:?}  forced_fresh={}rec/{:?}  stale={}",
        primed.records.len(),
        primed.best_record.as_ref().map(|r| r.best_time),
        stale.records.len(),
        stale.best_record.as_ref().map(|r| r.best_time),
        fresh.records.len(),
        fresh.best_record.as_ref().map(|r| r.best_time),
        stale.records.len() != fresh.records.len(),
    );
}

/// Touch one unrelated activity's metrics purely for the invalidate_perf_cache
/// side effect, so the next perf read is recomputed rather than served stale.
fn force_perf_invalidation(engine: &mut PersistentRouteEngine, activity_id: &str) {
    engine
        .set_activity_metrics(vec![ActivityMetrics {
            activity_id: activity_id.to_string(),
            name: activity_id.to_string(),
            date: 0,
            distance: 0.0,
            moving_time: 1,
            elapsed_time: 1,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
        }])
        .expect("set_activity_metrics");
}

// ============================================================================
// Live invariants — green today, kept as regression guards.
// ============================================================================

/// Real-trace invariant (Bug 1, fixed 2026-02-02): set_section_reference must
/// replace the polyline with a contiguous slice of the ONE reference activity,
/// never the whole track and never a stitch across activities. Verified by full
/// coverage of the source track plus a length bounded by it.
#[test]
fn set_reference_polyline_stays_within_one_source_activity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();
    let track = engine.get_gps_track(&new_ref).expect("reference track");

    engine.set_section_reference(&id, &new_ref).expect("set_section_reference");
    let after = engine.get_section(&id).expect("get_section");

    let cov = coverage(&after.polyline, &track, 50.0);
    assert!(
        cov >= 0.9,
        "set_reference polyline only {:.0}% covered by its reference activity — it is not one contiguous real trace",
        cov * 100.0
    );
    assert!(
        after.distance_meters <= polyline_len_m(&track) + 1.0,
        "set_reference polyline ({:.0}m) is longer than its source activity ({:.0}m)",
        after.distance_meters,
        polyline_len_m(&track),
    );
}

/// The complete-reset path must disarm the resync crash: reset_section_bounds
/// clears both spare conditions (is_user_defined and the backup), so detection
/// can wipe-rebuild the row without an id collision. This is the working
/// contrast to reset_section_reference (gated red below).
#[test]
fn reset_bounds_disarms_the_resync_crash() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    engine.reset_section_bounds(&id).expect("reset_section_bounds");
    assert!(
        !engine.has_original_bounds(&id),
        "reset_section_bounds left the backup in place"
    );

    try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after a full bounds reset must not crash");
}

// ============================================================================
// Target gates — #[ignore], red today, assert the desired behaviour.
// ============================================================================

/// A user-edited (here: trimmed) section must survive a later resync with its
/// trimmed extent intact. Fails today: the edit promotes to user-defined, sparing
/// its row while its positional id (`sec_ride_0`) is re-emitted by fresh
/// detection, so `apply_sections` dies with `UNIQUE constraint failed:
/// sections.id` (root R2, same as accept). Green when stable identity (B2) stops
/// ids colliding and/or persistence upserts (B4).
#[test]
#[ignore = "R2 positional-id collision — a trimmed section arms the same UNIQUE sections.id crash accept does; must also keep the trimmed extent (not snap back)"]
fn gate_edited_section_survives_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    let trimmed_dist = engine.get_section(&id).unwrap().distance_meters;

    let after = try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after trimming a section must not crash")
        .snapshot;

    let kept = after
        .sections
        .get(&id)
        .unwrap_or_else(|| panic!("trimmed section {id} was wiped by resync"));
    assert!(
        (kept.distance_meters - trimmed_dist).abs() <= trimmed_dist * 0.05,
        "trimmed section {id} snapped back: {:.0}m after resync vs {trimmed_dist:.0}m trimmed",
        kept.distance_meters,
    );
}

/// reset_section_reference must fully reset like reset_section_bounds: restore the
/// original geometry and clear the backup. Fails today: it clears only
/// is_user_defined, leaving the user-replaced polyline and the
/// original_polyline_json backup, so the "reset to automatic" is cosmetic and the
/// resync crash stays armed. Green when the two reset paths are unified.
#[test]
#[ignore = "reset_section_reference is a half-reset — leaves the replaced geometry and the backup, so it neither restores nor disarms (unlike reset_section_bounds)"]
fn gate_reset_reference_fully_resets_like_reset_bounds() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();

    engine.set_section_reference(&id, &new_ref).expect("set_section_reference");
    engine.reset_section_reference(&id).expect("reset_section_reference");
    let reset = engine.get_section(&id).expect("get_section");

    assert!(
        !engine.has_original_bounds(&id),
        "reset_section_reference left the original_polyline_json backup in place"
    );
    assert!(
        (reset.distance_meters - before.distance_meters).abs() < 1.0,
        "reset_section_reference did not restore original geometry: {:.0}m vs original {:.0}m",
        reset.distance_meters,
        before.distance_meters,
    );
}

/// recalculate_section_polyline must be idempotent: recomputing a section's
/// consensus a second time, with no new activities, must not move it. Fails
/// today: a second recalc changes the point count again (drift), and the extent
/// is non-deterministic across runs. Green when consensus regeneration converges
/// to a fixed point.
#[test]
#[ignore = "recalculate_section_polyline is non-idempotent (and non-deterministic) — a second recalc changes the shape instead of converging"]
fn gate_recalculate_polyline_is_idempotent() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    let first = engine.recalculate_section_polyline(&id).expect("recalc #1");
    let second = engine.recalculate_section_polyline(&id).expect("recalc #2");

    let drift = (first.polyline_point_count as i64 - second.polyline_point_count as i64).abs();
    assert!(
        drift <= 2,
        "recalculate drifted by {drift} points on a no-op re-run ({} -> {})",
        first.polyline_point_count,
        second.polyline_point_count,
    );
}

/// A geometry edit must invalidate the performance cache so the section detail
/// reflects the new shape. Fails today: trim/set_reference/reset_* never call
/// invalidate_perf_cache (only delete does), so get_section_performances serves
/// the pre-edit laps. Proven by comparing the straight-after-trim read against a
/// forced-fresh read.
#[test]
#[ignore = "geometry edits do not invalidate perf_cache — get_section_performances returns pre-edit laps/PRs until an unrelated event clears it"]
fn gate_geometry_edit_invalidates_perf_cache() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    seed_metrics_and_streams(&mut engine, &corpus.through_a());

    engine.get_section_performances(&id); // prime the cache
    let (start, end) = middle_trim(before.polyline_point_count);
    engine.trim_section(&id, start, end).expect("trim_section");
    let stale = engine.get_section_performances(&id);

    force_perf_invalidation(&mut engine, &corpus.bucket_c_single.id);
    let fresh = engine.get_section_performances(&id);

    assert_eq!(
        stale.records.len(),
        fresh.records.len(),
        "perf read straight after trim is stale ({} records) vs forced-fresh ({} records)",
        stale.records.len(),
        fresh.records.len(),
    );
}
