//! Suite #2 — edit-teardown / cache-coherence matrix + custom-section lifecycle.
//!
//! The definitive B4 invalidation spec: for every mutation, what does it leave
//! COHERENT vs STALE across the four caches a section spans?
//!   PERF     — lap_time/lap_pace served by get_section_performances
//!   SEAM     — in-memory get_sections() vs the DB get_sections_by_type(None) view
//!   JUNCTION — section_activities membership (phantom / orphan rows)
//!   BACKUP   — original_polyline_json (left set when it should be cleared)
//!
//! reset_section_bounds is the known-good template: it restores geometry, clears
//! the backup, keeps the seam consistent, and (being deletable again) survives
//! resync. Every other op is measured against it. Method-agnostic persistence,
//! so the fast Control arm.
//!
//! Headline findings (observed on Control, default corpus):
//!   - PERF is invalidated ONLY by delete_section and merge_user_sections (plus
//!     detection). Every direct geometry/membership/visibility edit leaves it
//!     stale; harmful where the edit changes membership or geometry.
//!   - remove_activity leaves a PHANTOM member: the activity and its GPS track
//!     are gone, but the section still counts it (junction FK is on section_id,
//!     not activity_id).
//!   - Hiding is consistent across the SEAM: disabled sections leave the
//!     in-memory catalogue, and superseded ones stay (they are still detection
//!     priors) but are dropped by the visible readers.
//!   - Foreign keys ARE enforced on the engine connection, so delete_section's
//!     CASCADE genuinely purges the junction (no orphan rows). Guarded green.
//!   - Custom sections SURVIVE resync intact (timestamp id, never positional,
//!     never wiped) and reach the in-memory matcher (index_new_activity).
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_cache_coherence \
//!       -- --nocapture --include-ignored`

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
    let (mut engine, dir) = fresh_engine_for(Arm::Control);
    let step = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&step.snapshot).expect("cold detect produced a section");
    (engine, dir, id)
}

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

/// The four caches, read for one section id through public methods only.
struct Probe {
    in_mem: Option<i64>,  // distance in get_sections() (in-memory auto cache)
    visible: Option<i64>, // distance in get_sections_by_type(None) (DB visible view)
    members: usize,       // junction membership from get_section().activity_ids
    backup: bool,         // original_polyline_json present
}

fn probe(engine: &mut PersistentRouteEngine, id: &str) -> Probe {
    let in_mem = engine
        .get_sections()
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.distance_meters.round() as i64);
    let visible = engine
        .get_sections_by_type(None)
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.distance_meters.round() as i64);
    let members = engine
        .get_section(id)
        .map(|s| s.activity_ids.len())
        .unwrap_or(0);
    Probe {
        in_mem,
        visible,
        members,
        backup: engine.has_original_bounds(id),
    }
}

/// SEAM verdict from a probe: do the in-memory cache and the DB visible view
/// agree on presence and distance?
fn seam(p: &Probe) -> String {
    match (p.in_mem, p.visible) {
        (Some(a), Some(b)) if a == b => "coherent".to_string(),
        (Some(a), Some(b)) => format!("DIST-DIVERGENT(mem={a},view={b})"),
        (None, None) => "coherent(absent)".to_string(),
        (a, b) => format!(
            "PRESENCE-DIVERGENT(mem={},view={})",
            a.is_some(),
            b.is_some()
        ),
    }
}

fn row(op: &str, before: &Probe, after: &Probe, perf: &str, note: &str) {
    println!(
        "{op:<24} | perf {perf:<9} | seam {:<28} | members {}->{} | backup {}->{} | {note}",
        seam(after),
        before.members,
        after.members,
        before.backup,
        after.backup,
    );
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

// ============================================================================
// Headline — the coherence matrix. Never fails; prints one row per op.
// ============================================================================

/// The B4 invalidation contract as observed today. PERF verdicts come from the
/// invalidate_perf_cache caller set (only delete/merge/detection call it);
/// SEAM/JUNCTION/BACKUP are observed live. "stale" in the perf column means the
/// op does not invalidate the cache, harmful only when it also moves
/// membership/geometry.
#[test]
fn cache_coherence_matrix() {
    println!("\n=== EDIT-TEARDOWN CACHE-COHERENCE MATRIX (Control) ===");
    println!(
        "op                       | perf      | seam                         | members       | backup        | note"
    );

    // add_activity — defers to detection; nothing on the existing section moves.
    {
        let corpus = corpus();
        let (mut e, _d) = fresh_engine_for(Arm::Control);
        let step = ingest_step(&mut e, "cold", &corpus.through_a());
        let (id, _f) = busiest_section(&step.snapshot).unwrap();
        let b = probe(&mut e, &id);
        e.add_activity(
            corpus.bucket_c_single.id.clone(),
            corpus.bucket_c_single.gps_points.clone(),
            corpus.bucket_c_single.sport_type.clone(),
        )
        .expect("add_activity");
        row(
            "add_activity",
            &b,
            &probe(&mut e, &id),
            "n/a",
            "defers to detection",
        );
    }

    // remove_activity — phantom member (junction FK is on section_id only).
    {
        let (mut e, _d, id) = cold();
        let b = probe(&mut e, &id);
        let victim = e.get_section(&id).unwrap().activity_ids[0].clone();
        e.remove_activity(&victim).expect("remove_activity");
        let still = e.get_section(&id).unwrap().activity_ids.contains(&victim);
        row(
            "remove_activity",
            &b,
            &probe(&mut e, &id),
            "STALE",
            &format!("phantom member kept={still}"),
        );
    }

    macro_rules! op_row {
        ($name:expr, $perf:expr, $note:expr, $body:expr) => {{
            let (mut e, _d, id) = cold();
            let b = probe(&mut e, &id);
            let f: &dyn Fn(&mut PersistentRouteEngine, &str) = &$body;
            f(&mut e, &id);
            row($name, &b, &probe(&mut e, &id), $perf, $note);
        }};
    }

    op_row!(
        "trim_section",
        "STALE",
        "geometry edit",
        |e: &mut PersistentRouteEngine, id: &str| {
            let n = e.get_section(id).unwrap().polyline.len();
            e.trim_section(id, (n / 5) as u32, (n * 4 / 5) as u32)
                .expect("trim");
        }
    );
    op_row!(
        "set_section_reference",
        "STALE",
        "geometry edit",
        |e: &mut PersistentRouteEngine, id: &str| {
            let a = e.get_section(id).unwrap().activity_ids[0].clone();
            e.set_section_reference(id, &a).expect("set_ref");
        }
    );
    op_row!(
        "reset_section_reference",
        "STALE",
        "HALF-RESET (see suite2_edits_geometry)",
        |e: &mut PersistentRouteEngine, id: &str| {
            let a = e.get_section(id).unwrap().activity_ids[0].clone();
            e.set_section_reference(id, &a).expect("set_ref");
            e.reset_section_reference(id).expect("reset_ref");
        }
    );
    op_row!(
        "reset_section_bounds",
        "STALE",
        "KNOWN-GOOD template",
        |e: &mut PersistentRouteEngine, id: &str| {
            let n = e.get_section(id).unwrap().polyline.len();
            e.trim_section(id, (n / 5) as u32, (n * 4 / 5) as u32)
                .expect("trim");
            e.reset_section_bounds(id).expect("reset_bounds");
        }
    );
    op_row!(
        "set_section_name",
        "stale(harmless)",
        "metadata only",
        |e: &mut PersistentRouteEngine, id: &str| {
            e.set_section_name(id, Some("Renamed")).expect("rename");
        }
    );
    op_row!(
        "disable_section",
        "stale(harmless)",
        "SEAM DIVERGES",
        |e: &mut PersistentRouteEngine, id: &str| {
            e.disable_section(id).expect("disable");
        }
    );
    op_row!(
        "enable_section",
        "stale(harmless)",
        "restores seam",
        |e: &mut PersistentRouteEngine, id: &str| {
            e.disable_section(id).expect("disable");
            e.enable_section(id).expect("enable");
        }
    );
    op_row!(
        "recalculate_polyline",
        "STALE",
        "non-idempotent (see suite2_edits_geometry)",
        |e: &mut PersistentRouteEngine, id: &str| {
            e.recalculate_section_polyline(id);
        }
    );

    // merge_user_sections — invalidates perf, repoints junction, drops secondary.
    {
        let corpus = corpus();
        let (mut e, _d) = fresh_engine_for(Arm::Control);
        let step = ingest_step(&mut e, "cold", &corpus.through_a());
        let mut ids: Vec<String> = step.snapshot.ids().into_iter().cloned().collect();
        ids.sort();
        let b = probe(&mut e, &ids[0]);
        e.merge_user_sections(&ids[0], &ids[1]).expect("merge");
        row(
            "merge_user_sections",
            &b,
            &probe(&mut e, &ids[0]),
            "invalidates",
            "primary absorbs secondary",
        );
    }

    // delete_section — invalidates perf, CASCADE purges junction (FK enforced).
    {
        let (mut e, _d, id) = cold();
        let b = probe(&mut e, &id);
        e.delete_section(&id).expect("delete");
        row(
            "delete_section",
            &b,
            &probe(&mut e, &id),
            "invalidates",
            "CASCADE purges junction",
        );
    }

    // custom create — visible in DB, never in the in-memory cache (seam).
    {
        let corpus = corpus();
        let (mut e, _d) = fresh_engine_for(Arm::Control);
        ingest_step(&mut e, "cold", &corpus.through_a());
        let cid = create_custom(&mut e, &corpus);
        let p = probe(&mut e, &cid);
        row(
            "create_section(custom)",
            &p,
            &p,
            "n/a",
            "custom reaches the in-mem matcher",
        );
    }
    println!("=== end matrix ===\n");
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
// PART B — custom section lifecycle measurement.
// ============================================================================

/// A user-drawn custom section over corpus ground: does it match activities, show
/// in the visible view, and survive a resync? Prints the full lifecycle.
#[test]
fn custom_section_creation_and_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let auto_ids: Vec<String> = cold.snapshot.ids().into_iter().cloned().collect();

    let cid = create_custom(&mut engine, &corpus);
    let created = engine.get_section(&cid).expect("custom present");
    println!(
        "[create] id={cid} user_defined={} members={} dist={:.0}m visible={} in_mem={} collides_with_auto={}",
        created.is_user_defined,
        created.activity_ids.len(),
        created.distance_meters,
        engine
            .get_sections_by_type(None)
            .iter()
            .any(|s| s.id == cid),
        engine.get_sections().iter().any(|s| s.id == cid),
        auto_ids.contains(&cid),
    );

    match try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta)) {
        Ok(step) => {
            let after = engine.get_section(&cid);
            println!(
                "[resync] OK sections={} survived={} dist={:?} members={:?}",
                step.snapshot.count(),
                after.is_some(),
                after.as_ref().map(|s| s.distance_meters.round()),
                after.as_ref().map(|s| s.activity_ids.len()),
            );
        }
        Err(e) => println!("[resync] CRASH: {e}"),
    }
}

// ============================================================================
// Live invariants — green today, kept as regression guards.
// ============================================================================

/// The standout positive: a custom section survives resync with its geometry and
/// membership intact. Its timestamp id never collides with a positional detected
/// id and section_type='custom' is never wiped, so it dodges the R2 crash that
/// accepted/edited auto sections hit. This is the behaviour stable identity (B2)
/// must give every user-honoured section.
#[test]
fn custom_section_survives_resync_intact() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
/// baseline the orphan gates are measured against.
#[test]
fn delete_section_cascade_is_enforced() {
    let (mut engine, _dir, _id) = cold();
    let ghost = engine.add_section_activity("ghost_section_xyz", "ghost_activity");
    assert!(
        ghost.is_err(),
        "a junction row was inserted for a non-existent section — FK not enforced, delete leaves orphans"
    );
}

// ============================================================================
// Target gates — #[ignore], red today.
// ============================================================================

/// remove_activity must purge the deleted activity from every section it was a
/// member of. Fails today: the junction FK is on section_id only, so the row
/// survives and the section keeps a phantom member (inflated visit_count, a
/// performance row for a GPS track that no longer exists). Green when
/// remove_activity also deletes the activity's section_activities rows.
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

/// A removed activity must vanish from section performances. Fails today, and
/// worse than a stale cache: because remove_activity leaves the phantom junction
/// row AND the activity_metrics row, even a forced-fresh recompute still builds a
/// performance record (a lap, a possible PR) for an activity whose GPS track is
/// gone. The perf cache invalidation is beside the point — the underlying
/// junction is never cleaned. Green when remove_activity purges the junction.
#[test]
fn gate_remove_activity_drops_performance_record() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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

/// A custom section must be reachable by the in-memory matcher so future
/// activities can join it. Fails today: custom sections are never held in
/// get_sections() (only auto sections are cached), so index_new_activity, which
/// scans that cache, can never add a new traversal to a custom section — its
/// membership is frozen at creation. Green when custom sections are visible to
/// the in-memory matcher.
#[test]
fn gate_custom_section_reaches_in_memory_matcher() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let cid = create_custom(&mut engine, &corpus);
    assert!(
        engine.get_sections().iter().any(|s| s.id == cid),
        "custom section {cid} is absent from the in-memory cache the matcher scans"
    );
}
