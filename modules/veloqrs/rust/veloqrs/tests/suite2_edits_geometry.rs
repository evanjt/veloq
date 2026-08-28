//! Suite #2 — geometry & metadata edit survival + side effects.
//!
//! The believability core beyond accept/hide (`suite2_edits.rs`): when a user
//! renames, re-references, trims, resets, or recalculates a section, the edit
//! must survive later resyncs and must not corrupt geometry or the performance
//! view. These behaviours live in the persistence layer and are method-agnostic,
//! so they run on the fast Control arm.
//!
//! What this suite pins down (all on the Control arm, default corpus):
//! - A bare rename stays metadata only, and an edited (trimmed) section survives
//!   the next resync with its edited extent intact.
//! - set_section_reference honours the real-trace invariant: the new polyline is
//!   a contiguous slice of ONE reference activity, never the whole track.
//! - reset_section_bounds is the complete reset: it restores the original
//!   geometry, clears the backup, and leaves the row deletable so the resync
//!   wipe-rebuild proceeds.
//! - recalculate_section_polyline keeps the remnant on real corridor, but is
//!   still non-idempotent (gated `#[ignore]`).
//! - reset_section_reference clears the backup but does not restore the replaced
//!   geometry, so it is still a half-reset (gated `#[ignore]`).
//! - Geometry edits still do not invalidate the performance cache, so
//!   get_section_performances serves pre-edit laps until an unrelated event
//!   clears it (gated `#[ignore]`).
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_edits_geometry \
//!       -- --include-ignored`

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
    engine
        .set_activity_metrics(metrics)
        .expect("set_activity_metrics");
    engine.set_time_streams_flat(&ids, &times, &offsets);
}

// ============================================================================
// Live invariants
// ============================================================================

/// A rename is metadata only: it must NOT promote the auto section to
/// user-defined, so the section stays in the ordinary detection flow and the
/// following resync completes. A promote-on-rename path would park the row
/// under an id fresh detection can re-mint and crash the next resync on INSERT.
#[test]
fn rename_stays_metadata_only_and_resync_survives() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine
        .set_section_name(&id, Some("My Climb"))
        .expect("set_section_name");
    let renamed = engine.get_section(&id).expect("get_section after rename");
    assert!(
        !renamed.is_user_defined,
        "a bare rename must not promote the section to user-defined"
    );

    let step = try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after a bare rename must not crash");
    println!(
        "[rename] resync OK sections={} name_now={:?}",
        step.snapshot.count(),
        engine.get_section(&id).and_then(|s| s.name),
    );
}

/// reset_section_bounds is the complete reset: it restores the ORIGINAL polyline
/// from the backup, so a trim is genuinely undone rather than merely unflagged.
/// The distance is the observable proxy for the restored shape. A red here means
/// the reset is cosmetic and the user's "revert" silently keeps the trim.
#[test]
fn reset_bounds_restores_the_original_geometry() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    let trimmed_dist = engine.get_section(&id).unwrap().distance_meters;
    assert!(
        trimmed_dist < before.distance_meters,
        "the trim did not shorten the section ({trimmed_dist:.0}m vs {:.0}m), so the reset below would prove nothing",
        before.distance_meters,
    );

    engine
        .reset_section_bounds(&id)
        .expect("reset_section_bounds");
    let reset = engine.get_section(&id).expect("get_section after reset");

    assert!(
        (reset.distance_meters - before.distance_meters).abs() < 1.0,
        "reset_section_bounds did not restore the original geometry: {:.0}m after reset, {:.0}m originally, {trimmed_dist:.0}m trimmed",
        reset.distance_meters,
        before.distance_meters,
    );
    assert!(
        !reset.is_user_defined,
        "reset_section_bounds left the section flagged user-defined, so detection can no longer own it"
    );
}

/// recalculate_section_polyline rebuilds a section's consensus from its traces.
/// It is a weighted average, so the extent can move (idempotence is gated
/// `#[ignore]` below), but whatever survives must still lie on real corridor:
/// nearly every point within tolerance of ONE contributing activity's track. A
/// red here is a recalculated section drawn across ground nobody travelled.
#[test]
fn recalculate_polyline_stays_on_real_corridor() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let one_act = engine
        .get_gps_track(before.activity_ids.iter().next().unwrap())
        .expect("a contributing activity's track");

    engine
        .recalculate_section_polyline(&id)
        .expect("recalculate_section_polyline");
    let after = engine.get_section(&id).expect("get_section after recalc");

    assert!(
        after.polyline.len() >= 2,
        "recalculate collapsed the section to {} point(s)",
        after.polyline.len()
    );
    let cov = coverage(&after.polyline, &one_act, 50.0);
    assert!(
        cov >= 0.9,
        "recalculated polyline is only {:.0}% covered by a contributing activity — it drifted off the corridor",
        cov * 100.0,
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

/// Real-trace invariant: set_section_reference must replace the polyline with a
/// contiguous slice of the ONE reference activity,
/// never the whole track and never a stitch across activities. Verified by full
/// coverage of the source track plus a length bounded by it.
#[test]
fn set_reference_polyline_stays_within_one_source_activity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();
    let track = engine.get_gps_track(&new_ref).expect("reference track");

    engine
        .set_section_reference(&id, &new_ref)
        .expect("set_section_reference");
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

/// The complete-reset path clears both spare conditions (is_user_defined and the
/// backup), so detection can wipe-rebuild the row and the following resync
/// completes. This is the working contrast to reset_section_reference, which
/// clears the backup but not the geometry (gated red below).
#[test]
fn reset_bounds_disarms_the_resync_crash() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let (start, end) = middle_trim(before.polyline_point_count);

    engine.trim_section(&id, start, end).expect("trim_section");
    engine
        .reset_section_bounds(&id)
        .expect("reset_section_bounds");
    assert!(
        !engine.has_original_bounds(&id),
        "reset_section_bounds left the backup in place"
    );

    try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after a full bounds reset must not crash");
}

/// A user-edited (here: trimmed) section survives a later resync with its
/// trimmed extent intact. The edit promotes the row to user-defined, sparing it
/// from the wipe, and stable identity (B2) stops fresh detection re-minting the
/// same id for other ground — so `apply_sections` neither collides nor snaps the
/// extent back.
#[test]
fn gate_edited_section_survives_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
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

/// reset_section_reference must fully reset like reset_section_bounds: restore
/// the original geometry AND clear the backup. Only the backup half holds today,
/// so the section is deletable again (the resync is disarmed) but still renders
/// the user-replaced polyline. Green when the two reset paths are unified.
#[test]
fn gate_reset_reference_fully_resets_like_reset_bounds() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, before) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    let new_ref = before.activity_ids.iter().next().unwrap().clone();

    engine
        .set_section_reference(&id, &new_ref)
        .expect("set_section_reference");
    engine
        .reset_section_reference(&id)
        .expect("reset_section_reference");
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
fn gate_recalculate_polyline_is_idempotent() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
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
/// invalidate_perf_cache (delete, merge, exclusion edits and detection do), so
/// get_section_performances serves the pre-edit laps. Proven by comparing the
/// straight-after-trim read against a forced-fresh read.
#[test]
fn gate_geometry_edit_invalidates_perf_cache() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
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
