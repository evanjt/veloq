//! Contract suite for named corridors (D1): a section name is permanent user
//! data attached to ground, not to a catalogue row. Naming an auto section
//! must survive every event that legitimately rebuilds the catalogue (resync,
//! restart, cache clear, re-cut), must never suppress or freeze the corridor
//! it names, and must lose display precedence to a user-defined row name.
//! On a split, the piece covering the largest share of the named ground keeps
//! the name.
//!
//! The no-freeze gate was written here as D1's forward contract and stayed
//! red until D2 landed geometry adoption in the registry; it is live now.

mod lifecycle_support;

use lifecycle_support::*;
use rusqlite::params;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// Distinctive name that can never collide with the generated
/// "<section_word> N" pattern.
const NAME: &str = "Col des Planches";
/// A second user name for precedence scenarios.
const ROW_NAME: &str = "Evening loop";

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// The one name read used everywhere: today the DB row, after D1 the
/// resolution overlay behind the same call.
fn section_name(engine: &PersistentEngine, id: &str) -> Option<String> {
    engine.get_section(id).and_then(|s| s.name)
}

/// Name as the list UI reads it, via the summaries path.
fn summary_name(engine: &PersistentEngine, id: &str) -> Option<String> {
    engine
        .get_section_summaries()
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name)
}

/// Ids of visible sections currently carrying `name`.
fn sections_named(engine: &PersistentEngine, snap: &SectionSnapshot, name: &str) -> Vec<String> {
    snap.sections
        .keys()
        .filter(|id| section_name(engine, id).as_deref() == Some(name))
        .cloned()
        .collect()
}

/// Exactly one visible section carries `NAME`, and it sits on `fp`'s ground.
fn assert_single_carrier(
    engine: &PersistentEngine,
    snap: &SectionSnapshot,
    fp: &SectionFingerprint,
    ctx: &str,
) {
    let named = sections_named(engine, snap, NAME);
    assert_eq!(
        named.len(),
        1,
        "{ctx}: expected exactly one section named {NAME:?}, found {named:?}"
    );
    let carrier = snap.sections.get(&named[0]).expect("named id in snapshot");
    assert!(
        ground_matches(fp, carrier),
        "{ctx}: the section named {NAME:?} ({}) does not sit on the named ground",
        named[0]
    );
    assert_eq!(
        summary_name(engine, &named[0]).as_deref(),
        Some(NAME),
        "{ctx}: summaries read path disagrees with get_section on the name"
    );
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

/// Fraction of `samples` within `GROUND_TOL_M` of `line`. Mirrors the harness
/// coverage, which is private.
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

/// Worse of the two endpoint gaps between two polylines, orientation-tolerant.
fn endpoint_distance(a: &[GpsPoint], b: &[GpsPoint]) -> f64 {
    let (Some(a0), Some(a1), Some(b0), Some(b1)) = (a.first(), a.last(), b.first(), b.last())
    else {
        return f64::INFINITY;
    };
    let forward = haversine_m(a0, b0).max(haversine_m(a1, b1));
    let reversed = haversine_m(a0, b1).max(haversine_m(a1, b0));
    forward.min(reversed)
}

// ============================================================================
// Hand-built junction geometry for the split rule. A 2 km trunk ridden end to
// end, then later traffic that peels east at 45% and 60% of its length. The
// batch cut gives trunk pieces with 45/15/40 shares of the named ground, so
// the largest-share rule and an arc-length-midpoint rule disagree here on
// purpose: the midpoint (50%) falls inside the SMALLEST piece.
// ============================================================================

const TRUNK_LEN_M: f64 = 2_000.0;
const STEP_M: f64 = 10.0;
const BASE_LAT: f64 = 46.0;
const BASE_LON: f64 = 7.10;
const DAY: i64 = 86_400;
const T0: i64 = 1_700_000_000;

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

/// Trunk from 0 to `to_m` north, then optionally east for `spur_m` from there.
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

/// 21 full-trunk outings, then 13 peeling east at 45% and 6 peeling east at
/// 60%, as post-naming chunks so the hysteresis sees several steps.
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

/// Cold-ingest the trunk, name its section, then feed the branch chunks.
/// Returns the engine and the final snapshot.
fn run_junction_scenario() -> (
    PersistentEngine,
    tempfile::TempDir,
    SectionSnapshot,
    Vec<GpsPoint>,
) {
    let jc = junction_corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&jc.trunk_outings));
    let (id, _fp) = busiest_section(&cold.snapshot).expect("trunk section detected");
    engine
        .set_section_name(&id, Some(NAME))
        .expect("set_section_name");
    let mut snap = cold.snapshot;
    for (i, chunk) in jc.branch_chunks.iter().enumerate() {
        snap = ingest_step(&mut engine, &format!("branch_{i}"), &refs(chunk)).snapshot;
    }
    // The upper branch lands late in the corpus, so its re-cut is still mid
    // debounce at the last chunk. Far-away hold steps let every debounce
    // sustain k detects and fire before the scenario's asserts.
    for i in 0..3 {
        let filler = act(
            format!("far_{i}"),
            60 + i,
            vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
        );
        snap = ingest_step(&mut engine, &format!("hold_{i}"), &[&filler]).snapshot;
    }
    (engine, dir, snap, jc.trunk_ground)
}

/// Visible sections covering a meaningful share of the trunk ground, with
/// their share, largest first.
fn trunk_pieces(snap: &SectionSnapshot, trunk: &[GpsPoint]) -> Vec<(String, f64)> {
    let mut pieces: Vec<(String, f64)> = snap
        .sections
        .iter()
        .map(|(id, f)| (id.clone(), coverage_frac(trunk, &f.polyline)))
        .filter(|(_, share)| *share > 0.15)
        .collect();
    pieces.sort_by(|a, b| b.1.total_cmp(&a.1));
    pieces
}

// ============================================================================
// GUARDS, green before D1, load-bearing after it. Never ignored.
// ============================================================================

#[test]
fn naming_roundtrip_and_unname() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    assert_eq!(section_name(&engine, &id).as_deref(), Some(NAME));
    assert_eq!(summary_name(&engine, &id).as_deref(), Some(NAME));
    assert_eq!(
        engine.get_all_section_names().get(&id).map(String::as_str),
        Some(NAME)
    );

    // Unname must clear the user's name. Not asserted against None: after D1
    // an unnamed auto row legitimately reads back its generated name.
    engine.set_section_name(&id, None).expect("clear name");
    assert_ne!(section_name(&engine, &id).as_deref(), Some(NAME));
    assert_ne!(summary_name(&engine, &id).as_deref(), Some(NAME));
}

/// The restore list reads `get_all_section_summaries`, a different code path
/// from `get_section_summaries`. Both must resolve the corridor name, or the
/// hidden-sections sheet shows the generated "Section N" for a named corridor.
#[test]
fn restore_list_shows_the_corridor_name() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    assert_eq!(summary_name(&engine, &id).as_deref(), Some(NAME));

    let all_name = engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name);
    assert_eq!(
        all_name.as_deref(),
        Some(NAME),
        "get_all_section_summaries does not resolve the corridor name"
    );

    let typed_name = engine
        .get_section_summaries_by_type(None)
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name);
    assert_eq!(
        typed_name.as_deref(),
        Some(NAME),
        "get_section_summaries_by_type does not resolve the corridor name"
    );
}

/// The restore list exists to show disabled rows, so a named-then-disabled
/// corridor must keep its name there: the overlay resolves only against
/// visible rows, and a disabled row is exactly the row that list shows.
#[test]
fn restore_list_names_a_disabled_corridor() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    engine.disable_section(&id).expect("disable_section");

    let all_name = engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name);
    assert_eq!(
        all_name.as_deref(),
        Some(NAME),
        "a named corridor must not lose its name in the restore list when disabled"
    );
}

/// The suppression-trap regression. After D1 a name becomes a
/// `section_intents` row, and `durable_intent_rows` treats every intent row
/// as a suppression ground unless it filters by kind, under which bug this
/// corridor would never re-emerge. Green today because naming writes no
/// intent; must stay green forever.
#[test]
fn naming_never_suppresses_corridor() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    engine
        .clear_routes_and_sections()
        .expect("clear_routes_and_sections");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;

    let reemerged = after.sections.values().any(|s| ground_matches(&fp, s));
    assert!(
        reemerged,
        "named corridor failed to re-emerge after a cache clear: naming must never suppress detection"
    );
}

/// Converse guard: a disabled intent must keep suppressing even when the
/// section also carries a name. Mirrors `disabled_corridor_stays_hidden` with
/// one inert rename added.
#[test]
fn disable_still_suppresses_a_named_corridor() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    engine.disable_section(&id).expect("disable_section");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;

    let reemerged = after.sections.values().any(|s| ground_matches(&fp, s));
    assert!(
        !reemerged,
        "disabled corridor {id} re-emerged as a visible section despite the intent record"
    );
}

/// User-defined row names stay row-local: accept promotes the row, the row is
/// spared from the save-time wipe, and name plus flag survive a restart.
/// Restart only, no resync: a resync after accept crashes today on a UNIQUE
/// sections.id collision, a separate defect this test must not inherit.
#[test]
fn accepted_section_name_stays_row_local_across_restart() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine.accept_section(&id).expect("accept_section");
    engine
        .set_section_name(&id, Some(ROW_NAME))
        .expect("set name");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    let section = engine
        .get_section(&id)
        .expect("accepted section survives restart");
    assert_eq!(section.name.as_deref(), Some(ROW_NAME));
    assert!(section.is_user_defined, "accept flag lost across restart");
    let _ = snapshot(&mut engine);
}

/// A user-defined row name outranks everything else on the same section: name
/// the auto section first (a corridor name after D1), accept the row, rename
/// it. The row name must win, today and after D1's resolution overlay exists.
#[test]
fn row_name_beats_corridor_name_on_same_section() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine
        .set_section_name(&id, Some(NAME))
        .expect("corridor name");
    engine.accept_section(&id).expect("accept_section");
    engine
        .set_section_name(&id, Some(ROW_NAME))
        .expect("row name");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    assert_eq!(
        section_name(&engine, &id).as_deref(),
        Some(ROW_NAME),
        "the user-defined row name must outrank the corridor name"
    );
    assert_eq!(summary_name(&engine, &id).as_deref(), Some(ROW_NAME));
}

/// Names must be readable straight after a restart, before any sync. Green
/// today (the row is read from the DB); after D1 this catches a resolution
/// cache that only fills on detection apply.
#[test]
fn name_readable_after_restart_without_sync() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    assert_eq!(
        section_name(&engine, &id).as_deref(),
        Some(NAME),
        "name unreadable after restart with no sync"
    );
    assert_eq!(summary_name(&engine, &id).as_deref(), Some(NAME));
    let _ = snapshot(&mut engine);
}

/// When a named corridor genuinely dissolves (its evidence is deleted), the
/// name must not wander onto surviving foreign ground. Green today; after D1
/// this is the no-migration half of the resolution offset ceiling.
#[test]
fn dissolved_named_corridor_leaves_other_ground_unnamed() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    // Deleting evidence is the one legitimate way a corridor dies, and
    // ALL of it must go: partial traversers outside the section's visit
    // list leave evidence that honestly re-forms a low-visit corridor
    // now that orphaned ground re-queues.
    for aid in corpus
        .bucket_a
        .iter()
        .filter(|a| lends_ground(&fp, &a.gps_points))
        .map(|a| a.id.as_str())
    {
        engine.remove_activity(aid).expect("remove_activity");
    }
    // The debounced dissolve needs a few steps to retire the visible row.
    // Drain only with activities that lend the footprint no ground,
    // orphaned ground re-queues, so any lingering passes over the
    // corridor are an honest low-visit section and it would never
    // dissolve. Empty steps keep the re-detect cadence.
    let drains: Vec<&LifecycleActivity> = std::iter::once(&corpus.bucket_c_single)
        .chain(corpus.bucket_d_delta.iter())
        .chain(corpus.bucket_b_delta.iter())
        .chain(corpus.bucket_e_delta.iter())
        .filter(|a| !lends_ground(&fp, &a.gps_points))
        .take(4)
        .collect();
    assert!(drains.len() >= 3, "not enough off-ground drain activities");
    let mut snap = cold.snapshot;
    for (i, a) in drains.iter().enumerate() {
        snap = ingest_step(&mut engine, &format!("drain_{i}"), &[a]).snapshot;
    }

    let ground_alive = snap.sections.values().any(|s| ground_matches(&fp, s));
    assert!(
        !ground_alive,
        "scenario failed to dissolve the named corridor; the no-migration assertion would be vacuous"
    );
    let named = sections_named(&engine, &snap, NAME);
    assert!(
        named.is_empty(),
        "the name migrated onto foreign ground after its corridor dissolved: {named:?}"
    );
}

// ============================================================================
// Durability contracts, the reason names are intents, not row data.
// ============================================================================

/// A full cache clear plus re-detect loses every auto row and its name today.
/// After D1 the name is an intent row that resolves onto the re-detected
/// corridor.
#[test]
fn name_survives_cache_clear_and_redetect() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    engine
        .clear_routes_and_sections()
        .expect("clear_routes_and_sections");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;
    assert_single_carrier(&engine, &after, &fp, "after cache clear + re-detect");
}

/// An ordinary incremental resync wipes non-durable auto rows before names
/// are re-read, so the name dies today. After D1 it follows the ground.
#[test]
fn name_survives_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;
    assert_single_carrier(&engine, &after, &fp, "after one resync");
}

/// Restart drops all in-memory state; the following resync rebuilds the
/// catalogue from the DB plus a cold evidence cache. The name must ride
/// through both.
#[test]
fn name_survives_restart_and_resync() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;
    assert_single_carrier(&engine, &after, &fp, "after restart + resync");
}

/// The name rides the ground through the growth buckets, sitting on exactly
/// one visible section at every step even as the cut evolves.
#[test]
fn name_follows_ground_through_recut() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    let snap = ingest_step(&mut engine, "b", &refs(&corpus.bucket_b_delta)).snapshot;
    assert_single_carrier(&engine, &snap, &fp, "after bucket b");
    let snap = ingest_step(&mut engine, "c", &[&corpus.bucket_c_single]).snapshot;
    assert_single_carrier(&engine, &snap, &fp, "after bucket c");
    for (i, a) in corpus.bucket_d_delta.iter().enumerate() {
        let snap = ingest_step(&mut engine, &format!("d_{i}"), &[a]).snapshot;
        assert_single_carrier(&engine, &snap, &fp, &format!("after d single {i}"));
    }
    let snap = ingest_step(&mut engine, "e", &refs(&corpus.bucket_e_delta)).snapshot;
    assert_single_carrier(&engine, &snap, &fp, "after bucket e");
}

/// The user ruling on splits: when later traffic cuts the named trunk into
/// pieces, the piece covering the LARGEST share of the named ground keeps the
/// name, and no other piece carries it. The junction geometry puts the trunk
/// midpoint inside the smallest piece, so a midpoint rule fails here.
#[test]
fn split_gives_name_to_largest_share_piece() {
    let (engine, _dir, snap, trunk) = run_junction_scenario();

    let pieces = trunk_pieces(&snap, &trunk);
    assert!(
        pieces.len() >= 2,
        "scenario failed to split the trunk (pieces: {pieces:?}); the ruling is not exercised"
    );

    let named = sections_named(&engine, &snap, NAME);
    assert_eq!(
        named.len(),
        1,
        "expected exactly one piece named {NAME:?}, found {named:?}"
    );
    assert_eq!(
        named[0],
        pieces[0].0,
        "the name must sit on the largest-share piece ({} at {:.0}%), not on {}",
        pieces[0].0,
        pieces[0].1 * 100.0,
        named[0]
    );
}

/// Naming must not freeze geometry: after the junction re-cut settles, the
/// visible pieces on the named ground must match the raw catalogue's pieces.
/// Frozen for every section on current main because the registry keeps its
/// prior polyline on every carry and never adopts the re-cut.
#[test]
fn naming_does_not_freeze_geometry() {
    let (engine, _dir, snap, trunk) = run_junction_scenario();

    let raw = raw_snapshot(&engine);
    let raw_pieces = trunk_pieces(&raw, &trunk);
    assert!(
        raw_pieces.len() >= 2,
        "scenario failed to split the trunk in the raw catalogue (pieces: {raw_pieces:?})"
    );

    let visible_pieces = trunk_pieces(&snap, &trunk);
    assert_eq!(
        visible_pieces.len(),
        raw_pieces.len(),
        "visible catalogue holds a different cut of the named ground than the raw catalogue"
    );
    for (raw_id, _) in &raw_pieces {
        let raw_line = &raw.sections[raw_id].polyline;
        let adopted = visible_pieces.iter().any(|(vid, _)| {
            endpoint_distance(raw_line, &snap.sections[vid].polyline) <= GROUND_TOL_M
        });
        assert!(
            adopted,
            "raw piece {raw_id} has no visible counterpart within {GROUND_TOL_M} m: geometry is frozen"
        );
    }
}

// ============================================================================
// Corridor listing, dormancy, migration, and raw-row contracts.
// ============================================================================

/// A named corridor whose evidence is deleted goes dormant, stays listed, and
/// resurfaces with no user action once its ground re-emerges.
#[test]
fn dormancy_roundtrip_resurfaces_name() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    engine.set_section_name(&id, Some(NAME)).expect("set name");

    let listed = engine.get_named_corridors();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, NAME);
    assert_eq!(listed[0].section_id.as_deref(), Some(id.as_str()));
    assert!(listed[0].primary);
    assert!(listed[0].coverage >= 0.6);

    // Deleting evidence is the one legitimate way ground dies, and ALL
    // of it must go: partial traversers outside the section's visit
    // list leave evidence that honestly re-forms a low-visit corridor
    // now that orphaned ground re-queues.
    let removed: Vec<String> = corpus
        .bucket_a
        .iter()
        .filter(|a| lends_ground(&fp, &a.gps_points))
        .map(|a| a.id.clone())
        .collect();
    for aid in &removed {
        engine.remove_activity(aid).expect("remove_activity");
    }
    // Drain only with activities that lend the footprint no ground:
    // orphaned ground re-queues, so any lingering passes over the
    // corridor are an honest low-visit section and it would never
    // dissolve. Empty steps keep the re-detect cadence.
    let drains: Vec<&LifecycleActivity> = std::iter::once(&corpus.bucket_c_single)
        .chain(corpus.bucket_d_delta.iter())
        .chain(corpus.bucket_b_delta.iter())
        .chain(corpus.bucket_e_delta.iter())
        .filter(|a| !lends_ground(&fp, &a.gps_points))
        .take(4)
        .collect();
    assert!(drains.len() >= 3, "not enough off-ground drain activities");
    let mut snap = cold.snapshot;
    for (i, a) in drains.iter().enumerate() {
        snap = ingest_step(&mut engine, &format!("drain_{i}"), &[a]).snapshot;
    }
    assert!(
        !snap.sections.values().any(|s| ground_matches(&fp, s)),
        "scenario failed to dissolve the named corridor"
    );
    let listed = engine.get_named_corridors();
    assert_eq!(listed.len(), 1, "a dormant intent must stay listed");
    assert_eq!(
        listed[0].section_id, None,
        "a dissolved corridor's name must be dormant, not attached"
    );

    let restore: Vec<&LifecycleActivity> = corpus
        .bucket_a
        .iter()
        .filter(|a| removed.contains(&a.id))
        .collect();
    assert!(
        !restore.is_empty(),
        "the removed evidence must exist in bucket a"
    );
    let mut snap = ingest_step(&mut engine, "restore", &restore).snapshot;
    // Re-emergence after a debounced dissolve is itself debounced (anti-flap),
    // so hold the returned evidence over the sustain window with far-away
    // filler steps that cannot touch this corridor.
    for i in 0..3 {
        let filler = act(
            format!("far_{i}"),
            60 + i,
            vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
        );
        snap = ingest_step(&mut engine, &format!("hold_{i}"), &[&filler]).snapshot;
    }
    assert_single_carrier(&engine, &snap, &fp, "after the evidence returns");
    let listed = engine.get_named_corridors();
    assert!(
        listed[0].section_id.is_some(),
        "the name must resurface once its ground re-emerges"
    );
}

/// Unnaming deletes the intent outright, and so does the explicit corridor
/// removal API.
#[test]
fn unname_and_remove_delete_the_intent() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    assert_eq!(engine.get_named_corridors().len(), 1);
    engine.set_section_name(&id, None).expect("unname");
    assert!(engine.get_named_corridors().is_empty());

    engine.set_section_name(&id, Some(NAME)).expect("re-name");
    let intent_id = engine.get_named_corridors()[0].intent_id.clone();
    engine
        .remove_named_corridor(&intent_id)
        .expect("remove_named_corridor");
    assert!(engine.get_named_corridors().is_empty());
    assert_ne!(section_name(&engine, &id).as_deref(), Some(NAME));
}

/// Renaming a section that already carries a named intent relabels the SAME
/// intent (the referent stays the originally named ground), rather than
/// stacking a second one.
#[test]
fn renaming_updates_the_existing_intent() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine
        .set_section_name(&id, Some(NAME))
        .expect("first name");
    let first = engine.get_named_corridors()[0].intent_id.clone();
    engine
        .set_section_name(&id, Some(ROW_NAME))
        .expect("second name");
    let listed = engine.get_named_corridors();
    assert_eq!(listed.len(), 1, "a rename must not stack a second intent");
    assert_eq!(listed[0].intent_id, first);
    assert_eq!(listed[0].name, ROW_NAME);
}

/// The migration hook rebuilds an old-CHECK section_intents table in place,
/// preserving disabled/deleted rows, promoting legacy user names on auto rows
/// to named intents exactly once, and staying idempotent across reopens.
#[test]
fn migration_hook_rebuilds_old_intents_table_and_backfills() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    {
        let db = rusqlite::Connection::open(&path).expect("raw open");
        db.execute_batch(
            "DROP TABLE section_intents;
             CREATE TABLE section_intents (
                 id TEXT PRIMARY KEY,
                 kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted')),
                 polyline_json TEXT NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO section_intents (id, kind, polyline_json)
                 VALUES ('legacy_disabled', 'disabled', '[]');
             DELETE FROM schema_info WHERE key = 'named_backfill_done';",
        )
        .expect("downgrade to the old shape");
        db.execute(
            "UPDATE sections SET name = 'Morning Berg', is_user_defined = 0 WHERE id = ?",
            params![id],
        )
        .expect("seed a legacy user name");
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    let listed = engine.get_named_corridors();
    assert_eq!(
        listed.iter().filter(|c| c.name == "Morning Berg").count(),
        1,
        "the legacy name must be promoted to a named intent"
    );
    assert_eq!(section_name(&engine, &id).as_deref(), Some("Morning Berg"));
    engine
        .set_section_name(&id, Some(NAME))
        .expect("a kind='named' write must pass the rebuilt CHECK");
    drop(engine);

    let engine = {
        let mut e = PersistentEngine::new(path.to_str().unwrap()).expect("second reopen");
        e.load().expect("load again");
        e
    };
    let db = rusqlite::Connection::open(&path).expect("raw verify open");
    let disabled: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE id = 'legacy_disabled' AND kind = 'disabled'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(
        disabled, 1,
        "disabled rows must survive the rebuild and reopens"
    );
    let named: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'named'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(named, 1, "the backfill must not duplicate on later reopens");
    drop(engine);
}

/// The suppression kind filter, exercised on the raw row: a kind='named'
/// intent planted directly in the table must not stop its corridor from
/// being detected, while flipping the same row to 'disabled' must.
#[test]
fn raw_named_row_never_suppresses_but_disabled_does() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (_, fp) = busiest_section(&cold.snapshot).expect("cold detect produced a section");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let polyline_json = {
        let pts: Vec<serde_json::Value> = fp
            .polyline
            .iter()
            .map(|p| {
                serde_json::json!({
                    "latitude": p.latitude,
                    "longitude": p.longitude,
                    "elevation": p.elevation,
                })
            })
            .collect();
        serde_json::to_string(&pts).expect("encode footprint")
    };
    {
        let db = rusqlite::Connection::open(&path).expect("raw open");
        db.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name)
             VALUES ('ni_raw', 'named', ?, datetime('now'), ?)",
            params![polyline_json, NAME],
        )
        .expect("plant the named row");
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    engine
        .clear_routes_and_sections()
        .expect("clear_routes_and_sections");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;
    assert!(
        after.sections.values().any(|s| ground_matches(&fp, s)),
        "a named row must never suppress its corridor's detection"
    );
    drop(engine);

    {
        let db = rusqlite::Connection::open(&path).expect("raw open");
        db.execute(
            "UPDATE section_intents SET kind = 'disabled' WHERE id = 'ni_raw'",
            [],
        )
        .expect("flip to disabled");
    }
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    engine
        .clear_routes_and_sections()
        .expect("clear_routes_and_sections");
    // The raw flip never went through disable_section, so the registry row was
    // not relinquished: the suppression starves the carried row of candidates
    // and the debounced dissolve needs its sustain window before it retires.
    let mut after = SectionSnapshot {
        sections: std::collections::BTreeMap::new(),
    };
    for (i, a) in corpus.bucket_d_delta.iter().enumerate() {
        after = ingest_step(&mut engine, &format!("resync_2_{i}"), &[a]).snapshot;
    }
    assert!(
        !after.sections.values().any(|s| ground_matches(&fp, s)),
        "the same ground flipped to 'disabled' must be suppressed"
    );
}

/// Two intents resolving to one section: the better-covering one displays,
/// both persist in the listing.
#[test]
fn two_names_one_section_keeps_both() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, fp) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");
    engine
        .set_section_name(&id, Some(NAME))
        .expect("first intent");
    drop(engine);

    // A second intent over a sub-stretch of the same corridor, planted raw:
    // its core covers the section fully but the first intent covers at least
    // as well, so the first stays primary.
    let path = dir.path().join("lifecycle.db");
    {
        let db = rusqlite::Connection::open(&path).expect("raw open");
        let sub: Vec<serde_json::Value> = fp
            .polyline
            .iter()
            .map(|p| {
                serde_json::json!({
                    "latitude": p.latitude,
                    "longitude": p.longitude,
                    "elevation": p.elevation,
                })
            })
            .collect();
        db.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name)
             VALUES ('ni_second', 'named', ?, datetime('now', '+1 hour'), ?)",
            params![serde_json::to_string(&sub).expect("encode"), ROW_NAME],
        )
        .expect("plant the second intent");
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    let listed = engine.get_named_corridors();
    assert_eq!(listed.len(), 2, "both intents must persist");
    let primaries: Vec<_> = listed.iter().filter(|c| c.primary).collect();
    assert_eq!(primaries.len(), 1, "exactly one primary per section");
    assert_eq!(
        primaries[0].name, NAME,
        "the older equally-covering intent keeps display"
    );
    assert_eq!(section_name(&engine, &id).as_deref(), Some(NAME));
}

/// The name-write routing reads is_user_defined from the DB ROW, not the
/// in-memory copy: with the row flipped user-defined behind the engine's
/// back, a rename must write the row, not an intent.
#[test]
fn set_name_routes_by_the_db_row_not_memory() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    let path = dir.path().join("lifecycle.db");
    {
        let db = rusqlite::Connection::open(&path).expect("raw open");
        db.execute(
            "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
            params![id],
        )
        .expect("flip the row behind the engine's back");
    }

    engine
        .set_section_name(&id, Some(ROW_NAME))
        .expect("rename");
    assert!(
        engine.get_named_corridors().is_empty(),
        "a user-defined ROW must take the name on the row, not as an intent"
    );
    let db = rusqlite::Connection::open(&path).expect("raw verify");
    let row_name: Option<String> = db
        .query_row("SELECT name FROM sections WHERE id = ?", params![id], |r| {
            r.get(0)
        })
        .expect("read row name");
    assert_eq!(row_name.as_deref(), Some(ROW_NAME));
}

/// Promotion handoff: accepting a named auto section moves the corridor
/// name onto the row (its permanent home) and retires the intent, so the
/// name survives the accept and every later restart.
#[test]
fn accepting_a_named_section_keeps_the_name() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine.set_section_name(&id, Some(NAME)).expect("set name");
    engine.accept_section(&id).expect("accept_section");
    assert_eq!(section_name(&engine, &id).as_deref(), Some(NAME));
    assert_eq!(summary_name(&engine, &id).as_deref(), Some(NAME));
    assert!(
        engine.get_named_corridors().is_empty(),
        "the intent must retire once the row owns the name"
    );
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load after reopen");
    assert_eq!(section_name(&engine, &id).as_deref(), Some(NAME));
    let _ = snapshot(&mut engine);
}

/// Generated-shaped names ("Section 7") are the engine's own labels, not
/// user data: writing one to an auto section stays row-local and must never
/// mint a durable intent, a backup restore replays every generated name
/// through this path.
#[test]
fn generated_shaped_names_stay_row_local() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    engine
        .set_section_name(&id, Some("Section 7"))
        .expect("set name");
    assert!(
        engine.get_named_corridors().is_empty(),
        "a generated-shaped name must not become a durable intent"
    );
    assert_eq!(section_name(&engine, &id).as_deref(), Some("Section 7"));
}

/// The rename originator's own detail screen must show the new name even
/// when a list read consumed the overlay refresh first: the section LRU
/// stores raw rows and overlays on the way out.
#[test]
fn rename_shows_fresh_name_after_list_and_detail_reads() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&snapshot(&mut engine)).expect("cold detect produced a section");

    let cached = engine
        .get_section_by_id(&id)
        .expect("detail read caches the row");
    assert_ne!(cached.name.as_deref(), Some(NAME));

    engine.set_section_name(&id, Some(NAME)).expect("rename");
    let _ = engine.get_section_summaries();
    let detail = engine.get_section_by_id(&id).expect("detail after rename");
    assert_eq!(
        detail.name.as_deref(),
        Some(NAME),
        "the cached detail row served a stale baked name"
    );
}
