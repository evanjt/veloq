//! Contract suite for the registry adoption seam (D2): the visible registry
//! mirrors the pure hysteresis layer's held ground. An agreement carry adopts
//! the batch payload immediately; a material re-cut keeps the prior geometry
//! for the debounce window and adopts when it fires. Adoption takes the
//! batch's coherent geometry family (polyline, distance, consensus state,
//! portions) while carrying the row's identity: id, created_at, name.
//!
//! The gates were written first and red-baselined against the frozen
//! registry, then ungated when adoption landed.
//! Membership monotonicity across adoption is carried by the lifecycle
//! stability gates, not duplicated here. The pure layer's own adoption
//! behaviour (agreement threshold, k-streak firing) is covered by tracematch
//! unit tests; this suite tests only the registry mirroring and its
//! persistence.

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::GpsPoint;
use tracematch::scenarios::LifecycleActivity;
use veloqrs::PersistentEngine;

const DAY: i64 = 86_400;
const T0: i64 = 1_700_000_000;
const TRUNK_LEN_M: f64 = 2_000.0;
const STEP_M: f64 = 10.0;
const BASE_LAT: f64 = 46.0;
const BASE_LON: f64 = 7.10;

fn deg_lat(m: f64) -> f64 {
    m / 111_320.0
}

fn deg_lon(m: f64) -> f64 {
    m / (111_320.0 * BASE_LAT.to_radians().cos())
}

fn pt(north_m: f64, east_m: f64) -> GpsPoint {
    GpsPoint {
        latitude: BASE_LAT + deg_lat(north_m),
        longitude: BASE_LON + deg_lon(east_m),
        elevation: Some(500.0),
    }
}

/// Trunk from 0 to `to_m` north, then optionally east for `spur_m`.
fn trunk_then_spur(to_m: f64, spur_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= to_m {
        pts.push(pt(d, 0.0));
        d += STEP_M;
    }
    let mut e = STEP_M;
    while e <= spur_m {
        pts.push(pt(to_m, e));
        e += STEP_M;
    }
    pts
}

fn act(id: String, day: i64, pts: Vec<GpsPoint>) -> LifecycleActivity {
    LifecycleActivity {
        id,
        sport_type: "Ride".to_string(),
        start_date_unix: T0 + day * DAY,
        gps_points: pts,
    }
}

fn haversine_m(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let r = 6_371_000.0_f64;
    let (la1, lo1) = (a.latitude.to_radians(), a.longitude.to_radians());
    let (la2, lo2) = (b.latitude.to_radians(), b.longitude.to_radians());
    let dla = la2 - la1;
    let dlo = lo2 - lo1;
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().asin()
}

/// Fraction of `samples` within `GROUND_TOL_M` of `line`.
fn coverage_frac(samples: &[GpsPoint], line: &[GpsPoint]) -> f64 {
    if samples.is_empty() || line.is_empty() {
        return 0.0;
    }
    let covered = samples
        .iter()
        .filter(|s| {
            line.iter()
                .map(|p| haversine_m(s, p))
                .fold(f64::INFINITY, f64::min)
                <= GROUND_TOL_M
        })
        .count();
    covered as f64 / samples.len() as f64
}

/// Visible sections covering a meaningful share of `ground`, largest first.
fn ground_pieces(snap: &SectionSnapshot, ground: &[GpsPoint]) -> Vec<(String, f64)> {
    let mut pieces: Vec<(String, f64)> = snap
        .sections
        .iter()
        .map(|(id, f)| (id.clone(), coverage_frac(ground, &f.polyline)))
        .filter(|(_, share)| *share > 0.15)
        .collect();
    pieces.sort_by(|a, b| b.1.total_cmp(&a.1));
    pieces
}

/// The visible section holding the same geometry as `poly`, if any. Adoption
/// is a wholesale clone of the batch section, but the visible snapshot has
/// been through the sections table's JSON read path, whose float parse is up
/// to one ULP off (serde_json without `float_roundtrip`). So counterpart
/// matching requires the same point count with every coordinate within
/// ~0.1 mm, still orders of magnitude tighter than any genuine geometry
/// change, which moves whole points and extents.
fn exact_counterpart<'a>(snap: &'a SectionSnapshot, poly: &[GpsPoint]) -> Option<&'a String> {
    const ULP_TOL_DEG: f64 = 1.0e-9;
    snap.sections
        .iter()
        .find(|(_, f)| {
            f.polyline.len() == poly.len()
                && f.polyline.iter().zip(poly).all(|(a, b)| {
                    (a.latitude - b.latitude).abs() <= ULP_TOL_DEG
                        && (a.longitude - b.longitude).abs() <= ULP_TOL_DEG
                })
        })
        .map(|(id, _)| id)
}

fn created_at_of(engine: &mut PersistentEngine, id: &str) -> Option<String> {
    engine.get_section_by_id(id).and_then(|s| s.created_at)
}

// ============================================================================
// Corpora. The agreement corpus produces an AGREEMENT-level change through a
// reference re-pick: cold rides spread laterally across the corridor, the
// later wave clusters a few metres east of their centre, so the medoid of the
// grown set re-picks to a wave ride and the reference polyline moves by
// metres while the extent stays put (mutual overlap ~1.0, far above the 0.85
// agreement threshold, adopts with no debounce). The junction corpus
// produces a MATERIAL re-cut: branches peeling at 45% and 60% split the
// trunk into pieces (mutual overlap of any piece against the full trunk is
// well below 0.85), so the pure layer debounces and fires at k = 3.
// ============================================================================

/// Full trunk ridden at a constant lateral offset east of the base line.
fn jittered_trunk(offset_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= TRUNK_LEN_M {
        pts.push(pt(d, offset_m));
        d += STEP_M;
    }
    pts
}

struct AgreementCorpus {
    cold: Vec<LifecycleActivity>,
    wave: Vec<LifecycleActivity>,
    trunk_ground: Vec<GpsPoint>,
}

fn agreement_corpus() -> AgreementCorpus {
    let cold = (0..9)
        .map(|i| {
            let offset = (i as f64 - 4.0) * 1.5;
            act(format!("cold_{i:02}"), i, jittered_trunk(offset))
        })
        .collect();
    let wave = (0..15)
        .map(|i| {
            let offset = 4.0 + 0.2 * (i % 3) as f64;
            act(format!("wave_{i:02}"), 9 + i, jittered_trunk(offset))
        })
        .collect();
    AgreementCorpus {
        cold,
        wave,
        trunk_ground: trunk_then_spur(TRUNK_LEN_M, 0.0),
    }
}

/// Whether two polylines differ by more than serialisation noise anywhere: a
/// point count change, or any coordinate moving over ~0.1 m.
fn geometry_differs(a: &[GpsPoint], b: &[GpsPoint]) -> bool {
    a.len() != b.len()
        || a.iter().zip(b).any(|(x, y)| {
            (x.latitude - y.latitude).abs() > 1.0e-6 || (x.longitude - y.longitude).abs() > 1.0e-6
        })
}

struct JunctionCorpus {
    trunk_outings: Vec<LifecycleActivity>,
    branch_chunks: Vec<Vec<LifecycleActivity>>,
    trunk_ground: Vec<GpsPoint>,
}

fn junction_corpus() -> JunctionCorpus {
    let trunk_ground = trunk_then_spur(TRUNK_LEN_M, 0.0);
    let trunk_outings = (0..21)
        .map(|i| {
            act(
                format!("trunk_{i:02}"),
                i,
                trunk_then_spur(TRUNK_LEN_M, 0.0),
            )
        })
        .collect();
    let lower: Vec<LifecycleActivity> = (0..13)
        .map(|i| {
            act(
                format!("lower_{i:02}"),
                21 + i,
                trunk_then_spur(0.45 * TRUNK_LEN_M, 800.0),
            )
        })
        .collect();
    let upper: Vec<LifecycleActivity> = (0..6)
        .map(|i| {
            act(
                format!("upper_{i:02}"),
                34 + i,
                trunk_then_spur(0.60 * TRUNK_LEN_M, 800.0),
            )
        })
        .collect();
    let branch_chunks = vec![
        lower[0..5].to_vec(),
        lower[5..9].to_vec(),
        lower[9..13].to_vec(),
        upper[0..3].to_vec(),
        upper[3..6].to_vec(),
    ];
    JunctionCorpus {
        trunk_outings,
        branch_chunks,
        trunk_ground,
    }
}

/// Drive the junction scenario chunk by chunk, recording per step whether the
/// raw catalogue has split the trunk and what the visible catalogue holds.
struct JunctionRun {
    engine: PersistentEngine,
    _dir: tempfile::TempDir,
    /// Polyline of the visible trunk section before any branch chunk.
    cold_trunk_polyline: Vec<GpsPoint>,
    /// Chunk index at which the raw catalogue first held >= 2 trunk pieces.
    first_split_step: Option<usize>,
    /// Visible snapshot after each chunk.
    visible_per_step: Vec<SectionSnapshot>,
    /// Raw snapshot after each chunk.
    raw_per_step: Vec<SectionSnapshot>,
    trunk_ground: Vec<GpsPoint>,
}

fn run_junction() -> JunctionRun {
    let jc = junction_corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&jc.trunk_outings));
    let (_, cold_fp) =
        busiest_section(&cold.snapshot).expect("cold detect produced a trunk section");
    let cold_trunk_polyline = cold_fp.polyline.clone();

    let mut first_split_step = None;
    let mut visible_per_step = Vec::new();
    let mut raw_per_step = Vec::new();
    for (i, chunk) in jc.branch_chunks.iter().enumerate() {
        let step = ingest_step(&mut engine, &format!("branch_{i}"), &refs(chunk));
        let raw = raw_snapshot(&engine);
        if first_split_step.is_none() && ground_pieces(&raw, &jc.trunk_ground).len() >= 2 {
            first_split_step = Some(i);
        }
        visible_per_step.push(step.snapshot);
        raw_per_step.push(raw);
    }
    // The upper branch lands late in the corpus, so its re-cut is still mid
    // debounce at the last chunk. Far-away hold steps let every debounce
    // sustain k detects and fire; the convergence gates assert after these.
    for i in 0..3 {
        let filler = act(
            format!("hold_{i}"),
            40 + i,
            vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
        );
        let step = ingest_step(&mut engine, &format!("hold_{i}"), &[&filler]);
        visible_per_step.push(step.snapshot);
        raw_per_step.push(raw_snapshot(&engine));
    }
    JunctionRun {
        engine,
        _dir: dir,
        cold_trunk_polyline,
        first_split_step,
        visible_per_step,
        raw_per_step,
        trunk_ground: jc.trunk_ground,
    }
}

/// Raw trunk pieces at the final step, with the exact-match requirement the
/// adoption gates assert against.
fn final_raw_pieces(run: &JunctionRun) -> Vec<(String, Vec<GpsPoint>)> {
    let raw = run.raw_per_step.last().expect("at least one chunk ran");
    ground_pieces(raw, &run.trunk_ground)
        .into_iter()
        .map(|(id, _)| {
            let poly = raw
                .sections
                .get(&id)
                .expect("raw id in snapshot")
                .polyline
                .clone();
            (id, poly)
        })
        .collect()
}

// ============================================================================
// GUARDS: green before D2, load-bearing after it. Never ignored.
// ============================================================================

/// Scenario: a material re-cut appears in the raw catalogue.
/// Expected behaviour: for the first two steps of the debounce (streak < k)
/// the visible carrier still holds its prior geometry, exactly. The debounce
/// is a freeze while it lasts; only firing may move the drawn line.
#[test]
fn recut_debounce_keeps_prior_geometry() {
    let run = run_junction();
    let s = run
        .first_split_step
        .expect("corpus never split the trunk in the raw catalogue");
    assert!(
        s + 1 < run.visible_per_step.len(),
        "split appeared too late ({s}) to observe the debounce window"
    );
    for step in [s, s + 1] {
        assert!(
            exact_counterpart(&run.visible_per_step[step], &run.cold_trunk_polyline).is_some(),
            "step {step}: the visible carrier moved during the re-cut debounce \
             (streak below k must keep the prior geometry)"
        );
    }
}

/// Scenario: the user accepts the trunk section, then the junction traffic
/// arrives and the raw catalogue re-cuts.
/// Expected behaviour: an accepted (user-defined) row never adopts. Its
/// polyline is byte-identical through every re-cut and across restart; the
/// durable-intent suppression keeps the corridor's raw pieces out of the
/// visible catalogue entirely.
#[test]
fn accepted_section_never_adopts() {
    let jc = junction_corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&jc.trunk_outings));
    let (id, fp) = busiest_section(&cold.snapshot).expect("trunk section detected");
    engine.accept_section(&id).expect("accept_section");
    let accepted_polyline = engine
        .get_section(&id)
        .expect("accepted section readable")
        .polyline;
    assert!(
        !accepted_polyline.is_empty(),
        "accepted section must carry geometry"
    );
    assert!(coverage_frac(&fp.polyline, &accepted_polyline) > 0.9);

    let mut snap = cold.snapshot;
    for (i, chunk) in jc.branch_chunks.iter().enumerate() {
        snap = ingest_step(&mut engine, &format!("branch_{i}"), &refs(chunk)).snapshot;
    }
    let after = engine
        .get_section(&id)
        .expect("accepted section survives re-cuts");
    assert_eq!(
        after.polyline, accepted_polyline,
        "an accepted section's geometry moved under detection"
    );
    assert!(
        ground_pieces(&snap, &jc.trunk_ground)
            .iter()
            .all(|(pid, _)| pid == &id),
        "raw re-cut pieces of an accepted corridor leaked into the visible catalogue"
    );

    let path = dir.path().join("lifecycle.db");
    drop(engine);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    let after_restart = engine
        .get_section(&id)
        .expect("accepted section survives restart");
    assert_eq!(
        after_restart.polyline, accepted_polyline,
        "an accepted section's geometry moved across restart"
    );
}

// ============================================================================
// GATES: red until the registry adopts pure-layer geometry. Each documents
// the assertion it must fail at today; ungate when D2 lands.
// ============================================================================

/// Scenario: a wave of new rides re-picks the section's reference trace a
/// few metres east; the extent holds, so the change is agreement-level.
/// Expected behaviour: the visible section adopts the batch geometry on that
/// very step (agreement carries never debounce), under its existing id.
#[test]
fn agreement_carry_adopts_batch_geometry_immediately() {
    let c = agreement_corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &refs(&c.cold));
    let (id, cold_fp) = busiest_section(&cold.snapshot).expect("cold trunk section");

    let step = ingest_step(&mut engine, "wave", &refs(&c.wave));
    let raw = raw_snapshot(&engine);
    let raw_pieces = ground_pieces(&raw, &c.trunk_ground);
    assert_eq!(
        raw_pieces.len(),
        1,
        "corpus fault: the wave must stay one section in the raw catalogue, got {raw_pieces:?}"
    );
    let raw_poly = raw.sections[&raw_pieces[0].0].polyline.clone();
    assert!(
        geometry_differs(&raw_poly, &cold_fp.polyline),
        "corpus fault: the wave produced no genuine geometry change in the raw catalogue"
    );

    let visible = step.snapshot;
    let adopted = exact_counterpart(&visible, &raw_poly);
    assert!(
        adopted.is_some(),
        "agreement carry did not adopt: no visible section holds the raw geometry \
         (the batch extended the cut, the visible catalogue still shows the old line)"
    );
    assert_eq!(
        adopted.unwrap(),
        &id,
        "the adopted geometry landed under a different id than the carried section"
    );
}

/// Scenario: the junction corpus sustains a material re-cut past k = 3.
/// Expected behaviour: once fired, every raw trunk piece has a bit-identical
/// visible counterpart and the pre-split trunk geometry is gone from the
/// visible catalogue.
#[test]
fn fired_recut_adopts_batch_pieces() {
    let run = run_junction();
    let s = run.first_split_step.expect("corpus never split the trunk");
    assert!(
        s + 2 < run.visible_per_step.len(),
        "split appeared too late ({s}) for the k = 3 debounce to fire within the corpus"
    );
    let pieces = final_raw_pieces(&run);
    assert!(
        pieces.len() >= 2,
        "raw catalogue lost the split by the final step"
    );

    let visible = run.visible_per_step.last().expect("steps ran");
    for (raw_id, raw_poly) in &pieces {
        assert!(
            exact_counterpart(visible, raw_poly).is_some(),
            "raw piece {raw_id} has no bit-identical visible counterpart: \
             the fired re-cut did not adopt"
        );
    }
    assert!(
        exact_counterpart(visible, &run.cold_trunk_polyline).is_none(),
        "the pre-split trunk geometry is still visible after the re-cut fired"
    );
    assert_eq!(
        ground_pieces(visible, &run.trunk_ground).len(),
        pieces.len(),
        "visible catalogue holds a different cut of the ground than the raw catalogue"
    );
}

/// Scenario: adoption fired, then the app restarts and a no-new-data detect
/// runs (a resync).
/// Expected behaviour: the adopted geometry is persisted, survives the load
/// round-trip, and a detect over the unchanged activity set does not move it.
#[test]
fn adopted_geometry_survives_restart_and_resync() {
    let run = run_junction();
    let pieces = final_raw_pieces(&run);
    let visible = run.visible_per_step.last().expect("steps ran");
    for (raw_id, raw_poly) in &pieces {
        assert!(
            exact_counterpart(visible, raw_poly).is_some(),
            "precondition: raw piece {raw_id} not adopted (see fired_recut_adopts_batch_pieces)"
        );
    }

    let path = run._dir.path().join("lifecycle.db");
    let engine = run.engine;
    drop(engine);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    let after_restart = snapshot(&mut engine);
    for (raw_id, raw_poly) in &pieces {
        assert!(
            exact_counterpart(&after_restart, raw_poly).is_some(),
            "adopted geometry of raw piece {raw_id} did not survive restart"
        );
    }

    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("resync apply");
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save processed ids");
    let after_resync = snapshot(&mut engine);
    for (raw_id, raw_poly) in &pieces {
        assert!(
            exact_counterpart(&after_resync, raw_poly).is_some(),
            "a no-new-data resync moved the adopted geometry of raw piece {raw_id}"
        );
    }
}

/// Scenario: adoption fired; the section detail screen reads traversals.
/// Expected behaviour: every member's portion was recomputed against the NEW
/// polyline, so traversal distances agree with the adopted canonical
/// distance, and the junction rows round-trip a restart. Stale portions
/// (spans measured against the old geometry) would silently poison the PR
/// completeness filter and every pace readout.
#[test]
fn adoption_recomputes_portions_against_new_geometry() {
    let run = run_junction();
    let pieces = final_raw_pieces(&run);
    let visible = run.visible_per_step.last().expect("steps ran");
    let (largest_raw_id, largest_poly) = pieces
        .iter()
        .max_by(|a, b| {
            coverage_frac(&run.trunk_ground, &a.1)
                .total_cmp(&coverage_frac(&run.trunk_ground, &b.1))
        })
        .expect("raw pieces exist");
    let visible_id = exact_counterpart(visible, largest_poly)
        .unwrap_or_else(|| {
            panic!("precondition: raw piece {largest_raw_id} not adopted (see fired_recut_adopts_batch_pieces)")
        })
        .clone();

    let assert_portions = |engine: &mut PersistentEngine, ctx: &str| {
        let section = engine
            .get_section_by_id(&visible_id)
            .expect("adopted section readable");
        assert!(
            !section.activity_portions.is_empty(),
            "{ctx}: adopted section has no portions"
        );
        let mut distances: Vec<f64> = section
            .activity_portions
            .iter()
            .map(|p| p.distance_meters)
            .collect();
        distances.sort_by(f64::total_cmp);
        let median = distances[distances.len() / 2];
        let ratio = median / section.distance_meters;
        assert!(
            (0.7..=1.3).contains(&ratio),
            "{ctx}: median portion distance {median:.0} m disagrees with the adopted \
             canonical distance {:.0} m (ratio {ratio:.2}); portions were not recomputed \
             against the new geometry",
            section.distance_meters
        );
    };
    let mut engine = run.engine;
    assert_portions(&mut engine, "after adoption");

    let path = run._dir.path().join("lifecycle.db");
    drop(engine);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    assert_portions(&mut engine, "after restart");
}

/// Scenario: a section is detected, then later applies carry it (with or
/// without geometry movement).
/// Expected behaviour: created_at is the section's first-detection time and
/// never re-stamps while the id lives. Today the registry payload never
/// learns the stamped value, so every save re-stamps it.
#[test]
fn created_at_is_stable_across_applies() {
    let c = agreement_corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &refs(&c.cold));
    let (id, _fp) = busiest_section(&cold.snapshot).expect("cold trunk section");
    let born = created_at_of(&mut engine, &id).expect("created_at stamped on first save");

    let filler = act(
        "far_0".to_string(),
        40,
        vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
    );
    ingest_step(&mut engine, "carry", &[&filler]);
    assert_eq!(
        created_at_of(&mut engine, &id).as_deref(),
        Some(born.as_str()),
        "a plain carry re-stamped created_at"
    );

    ingest_step(&mut engine, "adopt", &refs(&c.wave));
    assert_eq!(
        created_at_of(&mut engine, &id).as_deref(),
        Some(born.as_str()),
        "an agreement adoption re-stamped created_at"
    );
}

/// Scenario: a section's evidence is deleted, the dissolve debounce fires,
/// and the evidence later returns.
/// Expected behaviour: the section comes back as itself, id AND birth date.
/// The grave payload is the only carrier of created_at once the row is gone.
#[test]
fn restored_section_keeps_created_at() {
    let c = agreement_corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &refs(&c.cold));
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold trunk section");
    let born = created_at_of(&mut engine, &id).expect("created_at stamped on first save");

    for aid in &fp.activity_ids {
        engine.remove_activity(aid).expect("remove_activity");
    }
    let mut snap = cold.snapshot;
    for i in 0..3 {
        let filler = act(
            format!("drain_{i}"),
            40 + i,
            vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
        );
        snap = ingest_step(&mut engine, &format!("drain_{i}"), &[&filler]).snapshot;
    }
    assert!(
        !snap
            .sections
            .values()
            .any(|s| coverage_frac(&c.trunk_ground, &s.polyline) > 0.5),
        "scenario failed to dissolve the section"
    );

    let restore: Vec<&LifecycleActivity> = c
        .cold
        .iter()
        .filter(|a| fp.activity_ids.contains(&a.id))
        .collect();
    assert!(!restore.is_empty());
    let mut snap = ingest_step(&mut engine, "restore", &restore).snapshot;
    for i in 0..3 {
        let filler = act(
            format!("hold_{i}"),
            50 + i,
            vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
        );
        snap = ingest_step(&mut engine, &format!("hold_{i}"), &[&filler]).snapshot;
    }
    let returned: Vec<&String> = snap
        .sections
        .iter()
        .filter(|(_, f)| coverage_frac(&c.trunk_ground, &f.polyline) > 0.5)
        .map(|(sid, _)| sid)
        .collect();
    assert_eq!(
        returned.len(),
        1,
        "the ground did not re-emerge as one section"
    );
    assert_eq!(
        returned[0], &id,
        "the section did not come back under its own id"
    );
    assert_eq!(
        created_at_of(&mut engine, &id).as_deref(),
        Some(born.as_str()),
        "the restored section lost its birth date"
    );
}
