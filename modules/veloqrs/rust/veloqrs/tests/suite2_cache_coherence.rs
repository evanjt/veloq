//! Suite #2 — edit-teardown / cache coherence + custom-section lifecycle.
//!
//! The B4 invalidation spec: after a mutation, the caches a section spans must
//! agree.
//!   PERF     — lap_time/lap_pace served by get_section_performances
//!   SEAM     — in-memory get_sections() vs the DB get_sections_by_type(None) view
//!   JUNCTION — section_activities membership (phantom / orphan rows)
//!   BACKUP   — original_polyline_json (left set when it should be cleared)
//!
//! reset_section_bounds is the known-good template: it restores geometry, clears
//! the backup, keeps the seam consistent, and (being deletable again) survives
//! resync. Method-agnostic persistence, so the fast Control arm.
//!
//! What these gates lock (Control, default corpus):
//!   - remove_activity purges membership: the junction cascades on the
//!     activity_id foreign key, so no section keeps a phantom member and no
//!     performance record survives for a track that is gone.
//!   - Hiding is consistent across the SEAM: disabled sections leave the
//!     in-memory catalogue, and superseded ones stay (they are still detection
//!     priors) but are dropped by the visible readers.
//!   - Foreign keys ARE enforced on the engine connection, so delete_section's
//!     CASCADE genuinely purges the junction (no orphan rows).
//!   - Custom sections survive resync intact (timestamp id, never positional,
//!     never wiped) and reach the in-memory matcher (index_new_activity).
//!
//! Geometry edits are the one op that still leaves PERF stale; that gate lives
//! in `suite2_edits_geometry` and is `#[ignore]`d there.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_cache_coherence`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::sections::CreateSectionParams;
use veloqrs::{ActivityMetrics, PersistentRouteEngine};

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// A fresh engine cold-detected over bucket A, plus the busiest section id.
fn cold() -> (PersistentRouteEngine, tempfile::TempDir, String) {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let step = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&step.snapshot).expect("cold detect produced a section");
    (engine, dir, id)
}

/// Planar metres, good enough for a corpus-scale polyline length.
fn poly_len_m(line: &[GpsPoint]) -> f64 {
    line.windows(2)
        .map(|w| {
            let dlat = (w[1].latitude - w[0].latitude) * 111_320.0;
            let dlng =
                (w[1].longitude - w[0].longitude) * 111_320.0 * w[0].latitude.to_radians().cos();
            (dlat * dlat + dlng * dlng).sqrt()
        })
        .sum()
}

/// Seed metrics + a 1 s-per-point time stream for every activity so
/// get_section_performances returns populated records.
fn seed_perf(engine: &mut PersistentRouteEngine, activities: &[&LifecycleActivity]) {
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
            distance: poly_len_m(&a.gps_points),
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

/// Touch one unrelated activity's metrics purely for the invalidate_perf_cache
/// side effect, forcing the next perf read to recompute instead of serve cache.
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

/// Draw a custom section over the middle half of a ride activity's track.
fn create_custom(engine: &mut PersistentRouteEngine, corpus: &LifecycleCorpus) -> String {
    let src = corpus
        .through_a()
        .into_iter()
        .find(|a| a.sport_type == "Ride" && a.gps_points.len() > 400)
        .expect("a ride activity");
    let track = engine.get_gps_track(&src.id).expect("track");
    let n = track.len();
    let poly: Vec<GpsPoint> = track[n / 4..(n * 3 / 4)].to_vec();
    let dist = poly_len_m(&poly);
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: poly,
            distance_meters: dist,
            name: Some("My Custom Loop".to_string()),
            source_activity_id: Some(src.id.clone()),
            start_index: Some((n / 4) as u32),
            end_index: Some((n * 3 / 4) as u32),
        })
        .expect("create_section")
}

// ============================================================================
// Coherence invariants
// ============================================================================

/// A custom section survives resync with its geometry and membership intact. Its
/// timestamp id never collides with a detected id and section_type='custom' is
/// never wiped, so the wipe-rebuild cannot touch it. This is the behaviour stable
/// identity (B2) gives every user-honoured section.
#[test]
fn custom_section_survives_resync_intact() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let cid = create_custom(&mut engine, &corpus);
    let before = engine.get_section(&cid).expect("custom present");
    let (dist0, members0) = (before.distance_meters, before.activity_ids.len());

    try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync must not crash for a custom section");

    let after = engine
        .get_section(&cid)
        .unwrap_or_else(|| panic!("custom section {cid} was wiped by resync"));
    assert!(
        (after.distance_meters - dist0).abs() < 1.0,
        "custom geometry changed on resync: {:.0}m -> {:.0}m",
        dist0,
        after.distance_meters,
    );
    assert!(
        after.activity_ids.len() >= members0,
        "custom lost members on resync: {} -> {}",
        members0,
        after.activity_ids.len(),
    );
    assert!(
        after.is_user_defined,
        "custom lost its user-defined flag on resync"
    );
}

/// Foreign keys are enforced on the engine connection, so delete_section's
/// ON DELETE CASCADE actually purges the junction. Verified by proving a junction
/// row cannot be inserted for a non-existent section. This is the coherent
/// baseline the membership gates are measured against.
#[test]
fn delete_section_cascade_is_enforced() {
    let (mut engine, _dir, _id) = cold();
    let ghost = engine.add_section_activity("ghost_section_xyz", "ghost_activity");
    assert!(
        ghost.is_err(),
        "a junction row was inserted for a non-existent section — FK not enforced, delete leaves orphans"
    );
}

/// remove_activity purges the deleted activity from every section it was a
/// member of. The junction rows cascade on the activity_id foreign key, so no
/// section keeps a phantom member with an inflated visit_count.
#[test]
fn gate_remove_activity_purges_section_membership() {
    let (mut engine, _dir, id) = cold();
    let victim = engine.get_section(&id).unwrap().activity_ids[0].clone();
    engine.remove_activity(&victim).expect("remove_activity");
    assert!(
        !engine
            .get_section(&id)
            .unwrap()
            .activity_ids
            .contains(&victim),
        "section {id} still lists removed activity {victim} as a member"
    );
}

/// A superseded section must be hidden wherever a disabled one is. Supersession
/// only hides: the ground stays a detection prior, so the section stays in the
/// in-memory catalogue and the visible readers are what must agree.
#[test]
fn gate_supersede_section_stays_consistent_across_caches() {
    let (mut engine, _dir, id) = cold();
    engine
        .set_superseded(&id, "custom-replacement")
        .expect("set_superseded");
    let in_mem = engine.get_visible_sections().iter().any(|s| s.id == id);
    let visible = engine.get_sections_by_type(None).iter().any(|s| s.id == id);
    assert_eq!(
        in_mem, visible,
        "seam divergence: in_mem view has superseded section {id} = {in_mem}, visible view = {visible}"
    );
    assert!(
        engine.get_sections().iter().any(|s| s.id == id),
        "the raw catalogue must keep {id} as a detection prior, or the next detect re-mints its ground"
    );
}

/// A disabled section must be consistently hidden across caches: in-memory
/// consumers must not act on a section the user hid.
#[test]
fn gate_disable_section_stays_consistent_across_caches() {
    let (mut engine, _dir, id) = cold();
    engine.disable_section(&id).expect("disable");
    let in_mem = engine.get_sections().iter().any(|s| s.id == id);
    let visible = engine.get_sections_by_type(None).iter().any(|s| s.id == id);
    assert_eq!(
        in_mem, visible,
        "seam divergence: in_mem cache has section {id} = {in_mem}, visible view = {visible}"
    );
}

/// A removed activity vanishes from section performances. Stronger than the
/// membership gate above: the read is forced to recompute, so a pass proves the
/// underlying junction is clean rather than that a cache happened to be stale.
/// A red here means a lap (and a possible PR) is still built for an activity
/// whose GPS track is gone.
#[test]
fn gate_remove_activity_drops_performance_record() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let step = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&step.snapshot).expect("cold detect produced a section");
    seed_perf(&mut engine, &corpus.through_a());

    let primed = engine.get_section_performances(&id);
    let victim = primed
        .records
        .first()
        .map(|r| r.activity_id.clone())
        .expect("busiest section has a performance record to remove");
    engine.remove_activity(&victim).expect("remove_activity");

    // Force a fresh recompute so the failure cannot be blamed on a stale cache.
    force_perf_invalidation(&mut engine, &corpus.bucket_c_single.id);
    let fresh = engine.get_section_performances(&id);

    assert!(
        !fresh.records.iter().any(|r| r.activity_id == victim),
        "get_section_performances still lists removed activity {victim} (phantom junction row)"
    );
}

/// A custom section is reachable by the in-memory matcher so future activities
/// can join it. `index_new_activity` scans `get_sections()`, so a custom section
/// missing from that cache would have its membership frozen at creation.
#[test]
fn gate_custom_section_reaches_in_memory_matcher() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let cid = create_custom(&mut engine, &corpus);
    assert!(
        engine.get_sections().iter().any(|s| s.id == cid),
        "custom section {cid} is absent from the in-memory cache the matcher scans"
    );
}
