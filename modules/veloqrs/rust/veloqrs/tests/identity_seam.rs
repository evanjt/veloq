//! Registry seam contracts: the stateful section identity registry
//! (`persistence/sections/identity.rs`) against the pure hysteresis layer it
//! mirrors (`tracematch::sections::identity`).
//!
//! Five contracts, all driven through the full engine path (SQLite ingest ->
//! `detect_sections_background` -> `apply_sections_with_cache`):
//! - a no-new-data apply is a byte-level no-op on the DB and the registry,
//! - the registry's graves track the pure layer's tombstones after every
//!   apply, across restart, and through a restore,
//! - every promoting mutation relinquishes the real id and leaves no phantom
//!   carry, pending debounce, or UNIQUE collision behind,
//! - every registry row's payload polyline equals the pure layer's held
//!   ground (frozen rows hold prior geometry, adopted rows the batch's),
//! - one engine holding all durable ownership kinds at once survives repeat
//!   applies with the durable rows byte-unchanged.
//!
//! Synthetic geometry only; distinct corridors sit >100 m apart so the 50 m
//! ground metric never bridges them.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test identity_seam

mod lifecycle_support;

use std::collections::BTreeSet;

use lifecycle_support::*;
use rusqlite::types::ValueRef;
use tracematch::matching::calculate_route_distance;
use tracematch::scenarios::LifecycleActivity;
use tracematch::{GpsPoint, shares_ground};
use veloqrs::PersistentRouteEngine;
use veloqrs::sections::CreateSectionParams;

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

/// A full north-heading ride of the corridor at `east_m`, offset laterally by
/// `jitter_m` so consensus has real spread to average.
fn corridor_ride(east_m: f64, jitter_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= TRUNK_LEN_M {
        pts.push(pt(d, east_m + jitter_m));
        d += STEP_M;
    }
    pts
}

fn corridor_ground(east_m: f64) -> Vec<GpsPoint> {
    corridor_ride(east_m, 0.0)
}

fn act(id: String, day: i64, pts: Vec<GpsPoint>) -> LifecycleActivity {
    LifecycleActivity {
        id,
        sport_type: "Ride".to_string(),
        start_date_unix: T0 + day * DAY,
        gps_points: pts,
    }
}

/// `count` laterally jittered rides of one corridor, every second day —
/// wide enough that even a short corpus spans past the occasion floor's
/// one-stay window (these scenarios exercise durable ownership, not
/// occasion support).
fn corridor_rides(prefix: &str, east_m: f64, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(
                format!("{prefix}_{i:02}"),
                day0 + 2 * i as i64,
                corridor_ride(east_m, jitter),
            )
        })
        .collect()
}

/// A far-away two-point activity that forms no section: forces a fresh
/// detect+apply without perturbing any corridor.
fn filler_act(tag: &str, day: i64) -> LifecycleActivity {
    act(
        format!("filler_{tag}_{day}"),
        day,
        vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
    )
}

/// Ids of visible sections sharing ground with `ground`, sorted (BTreeMap
/// iteration order).
fn sections_on(snap: &SectionSnapshot, ground: &[GpsPoint]) -> Vec<String> {
    snap.sections
        .iter()
        .filter(|(_, f)| shares_ground(&f.polyline, ground))
        .map(|(id, _)| id.clone())
        .collect()
}

/// The busiest visible section on `ground`, so a small satellite cut never
/// masquerades as the corridor's carrier.
fn section_on(snap: &SectionSnapshot, ground: &[GpsPoint]) -> Option<(String, SectionFingerprint)> {
    snap.sections
        .iter()
        .filter(|(_, f)| shares_ground(&f.polyline, ground))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
}

/// Columns the engine re-derives on every rank: caches, not content, so a
/// durable row keeping its content while these fill is unchanged.
const DERIVED_COLUMNS: [&str; 7] = [
    "elevation_loss_m",
    "max_grade_percent",
    "straightness",
    "klass",
    "is_lift",
    "rank_score",
    "sport_rank_score",
];

/// Full-table dump with every content column rendered to text (blobs as raw
/// byte debug), so equality means byte-unchanged rows.
fn dump_table(db_path: &std::path::Path, table: &str, order_by: &str) -> Vec<String> {
    let conn = rusqlite::Connection::open(db_path).expect("open db for dump");
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY {order_by}"))
        .expect("prepare dump");
    let ncols = stmt.column_count();
    let content: Vec<usize> = (0..ncols)
        .filter(|&i| !DERIVED_COLUMNS.contains(&stmt.column_name(i).expect("column name")))
        .collect();
    let rows = stmt
        .query_map([], |row| {
            let mut cells = Vec::with_capacity(content.len());
            for &i in &content {
                cells.push(match row.get_ref(i)? {
                    ValueRef::Null => "NULL".to_string(),
                    ValueRef::Integer(v) => v.to_string(),
                    ValueRef::Real(v) => format!("{v:?}"),
                    ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
                    ValueRef::Blob(b) => format!("{b:?}"),
                });
            }
            Ok(cells.join("|"))
        })
        .expect("query dump");
    rows.filter_map(|r| r.ok()).collect()
}

fn sections_dump(db_path: &std::path::Path) -> Vec<String> {
    dump_table(db_path, "sections", "id")
}

fn junction_dump(db_path: &std::path::Path) -> Vec<String> {
    dump_table(
        db_path,
        "section_activities",
        "section_id, activity_id, start_index",
    )
}

/// The dump rows whose first (id) column is one of `ids`.
fn rows_for(dump: &[String], ids: &[String]) -> Vec<String> {
    dump.iter()
        .filter(|row| ids.iter().any(|id| row.starts_with(&format!("{id}|"))))
        .cloned()
        .collect()
}

fn assert_graves_eq_tombstones(engine: &PersistentRouteEngine, ctx: &str) {
    let mut graves: Vec<String> = engine
        .section_identity_grave_rows()
        .into_iter()
        .map(|(pid, _)| pid)
        .collect();
    graves.sort();
    assert_eq!(
        graves,
        engine.section_identity_tombstone_ids(),
        "{ctx}: the registry's graves diverged from the pure layer's tombstones"
    );
}

/// The mechanical mirror invariant: the registry rows and the pure visible ids
/// are the same set, and each row's payload polyline is exactly the ground the
/// pure layer holds under its join id. Frozen rows hold the prior geometry on
/// both sides, adopted rows the batch candidate's, so the equality covers every
/// carry fate without naming them.
fn assert_registry_mirrors_pure(engine: &PersistentRouteEngine, ctx: &str) {
    let rows = engine.section_identity_mirror_rows();
    let mut pids: Vec<String> = rows.iter().map(|(pid, _, _, _)| pid.clone()).collect();
    pids.sort();
    assert_eq!(
        pids,
        engine.section_identity_pure_visible_ids(),
        "{ctx}: registry rows and pure visible ids diverged"
    );
    for (pid, real_id, pure_ground, payload) in rows {
        assert!(
            !pure_ground.is_empty(),
            "{ctx}: the pure layer holds no ground for registry row {real_id} ({pid})"
        );
        assert_eq!(
            payload, pure_ground,
            "{ctx}: registry row {real_id} ({pid}) holds different geometry than the pure layer's ground"
        );
    }
}

// ============================================================================
// 1. Back-to-back identical applies
// ============================================================================

/// Scenario: the detect+apply cycle runs twice more over an unchanged activity
/// set (the resync path), after a successful cold detect.
/// Expected behaviour: byte-level no-op. The visible id set, every sections
/// row (created_at included), every junction row (the seen-set guard), and the
/// serialised registry state are all identical after each pass.
#[test]
fn double_apply_is_a_no_op() {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("cold", 0.0, 9, 0);
    let cold = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    assert!(
        !sections_on(&cold, &corridor_ground(0.0)).is_empty(),
        "corpus fault: the cold detect produced no corridor section"
    );

    let db = dir.path().join("lifecycle.db");
    let sections0 = sections_dump(&db);
    let junction0 = junction_dump(&db);
    let registry0 = engine.section_identity_fingerprint();
    let ids0: BTreeSet<String> = cold.sections.keys().cloned().collect();

    for pass in 1..=2 {
        let step = try_ingest_step(&mut engine, "noop", &[])
            .unwrap_or_else(|e| panic!("no-new-data apply {pass} failed: {e}"));
        let ids: BTreeSet<String> = step.snapshot.sections.keys().cloned().collect();
        assert_eq!(
            ids, ids0,
            "apply {pass} changed the visible id set (a mint or a drop on unchanged data)"
        );
        assert_eq!(
            sections_dump(&db),
            sections0,
            "apply {pass} rewrote a sections row (created_at, name, or payload drifted)"
        );
        assert_eq!(
            junction_dump(&db),
            junction0,
            "apply {pass} rewrote junction rows on an unchanged activity set"
        );
        assert_eq!(
            engine.section_identity_fingerprint(),
            registry0,
            "apply {pass} advanced the registry state on unchanged data"
        );
    }
}

// ============================================================================
// 2. Graves track tombstones
// ============================================================================

/// The graves corpus: corridors A and B, A's evidence removed after the cold
/// detect, three drain applies so A's dissolve debounce runs to its tombstone.
/// Returns everything the graves contracts assert against.
struct GravesRun {
    engine: PersistentRouteEngine,
    dir: tempfile::TempDir,
    ground_a: Vec<GpsPoint>,
    rides_a: Vec<LifecycleActivity>,
    id_a: String,
    fp_a: SectionFingerprint,
    born_a: String,
}

fn run_graves_scenario(check_each_apply: bool) -> GravesRun {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let ground_a = corridor_ground(0.0);
    let ground_b = corridor_ground(1_500.0);
    let rides_a = corridor_rides("a", 0.0, 9, 0);
    let rides_b = corridor_rides("b", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, fp_a) = section_on(&cold, &ground_a).expect("corpus fault: corridor A section");
    let (id_b, _) = section_on(&cold, &ground_b).expect("corpus fault: corridor B section");
    let born_a = engine
        .get_section_by_id(&id_a)
        .and_then(|s| s.created_at)
        .expect("created_at stamped on first save");
    if check_each_apply {
        assert_graves_eq_tombstones(&engine, "cold");
    }

    for aid in &fp_a.activity_ids {
        engine.remove_activity(aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        let snap = ingest_step(&mut engine, "drain", &[&filler]).snapshot;
        if check_each_apply {
            assert_graves_eq_tombstones(&engine, &format!("drain {i}"));
        }
        if i == 2 {
            assert!(
                !engine.section_identity_tombstone_ids().is_empty(),
                "scenario fault: the sustained dissolve did not fire at k"
            );
            assert!(
                sections_on(&snap, &ground_a).is_empty(),
                "scenario fault: corridor A is still visible after its dissolve fired"
            );
            assert!(
                sections_on(&snap, &ground_b).contains(&id_b),
                "corridor B lost its id during A's dissolve"
            );
        }
    }
    GravesRun {
        engine,
        dir,
        ground_a,
        rides_a,
        id_a,
        fp_a,
        born_a,
    }
}

/// Scenario: corridor A's evidence is removed, its dissolve debounce runs to
/// the tombstone, then the evidence returns, all in one session.
/// Expected behaviour: after every apply the registry's grave keys equal the
/// pure layer's tombstone ids; the fired tombstone holds A's real id; the
/// re-emerged ground returns under its old real id and birth date, clearing
/// the pair on both sides.
#[test]
fn graves_track_tombstones_exactly() {
    let mut run = run_graves_scenario(true);
    assert!(
        run.engine
            .section_identity_grave_rows()
            .iter()
            .any(|(_, real)| real == &run.id_a),
        "the grave does not hold corridor A's real id"
    );

    let restore: Vec<&LifecycleActivity> = run
        .rides_a
        .iter()
        .filter(|a| run.fp_a.activity_ids.contains(&a.id))
        .collect();
    assert!(!restore.is_empty());
    let snap = ingest_step(&mut run.engine, "restore", &restore).snapshot;
    let returned = sections_on(&snap, &run.ground_a);
    assert_eq!(
        returned,
        vec![run.id_a.clone()],
        "the re-emerged ground did not come back as exactly its old real id"
    );
    assert_eq!(
        run.engine
            .get_section_by_id(&run.id_a)
            .and_then(|s| s.created_at)
            .as_deref(),
        Some(run.born_a.as_str()),
        "the restored section lost its birth date"
    );
    assert_graves_eq_tombstones(&run.engine, "after restore");
    assert!(
        run.engine.section_identity_tombstone_ids().is_empty(),
        "the restore left a stale tombstone behind"
    );
}

/// Scenario: the app restarts while corridor A sits in its grave, then A's
/// evidence returns.
/// Expected behaviour: the identity_state blob restores the registry exactly
/// (graves and tombstones included), so the ground still re-emerges under its
/// old real id and birth date. This is the gate a reseed cannot pass: a
/// reseed sees only the DB rows, so graves, tombstones, and debounce streaks
/// would be lost and the re-emerged ground would mint a fresh id. The green
/// `identity_registries_survive_restart` gate never catches a broken decode
/// because its grave-free growth state is one a reseed reproduces
/// byte-for-byte; this one holds the blob to a real round-trip.
#[test]
fn grave_restore_survives_restart() {
    let run = run_graves_scenario(false);
    let registry_before = run.engine.section_identity_fingerprint();
    let path = run.dir.path().join("lifecycle.db");
    let GravesRun {
        engine,
        rides_a,
        fp_a,
        id_a,
        born_a,
        ground_a,
        ..
    } = run;
    drop(engine);

    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    assert_eq!(
        engine.section_identity_fingerprint(),
        registry_before,
        "restart did not restore the registry blob exactly"
    );
    assert_graves_eq_tombstones(&engine, "after restart");
    assert!(
        engine
            .section_identity_grave_rows()
            .iter()
            .any(|(_, real)| real == &id_a),
        "the grave lost corridor A's real id across the restart"
    );

    let restore: Vec<&LifecycleActivity> = rides_a
        .iter()
        .filter(|a| fp_a.activity_ids.contains(&a.id))
        .collect();
    let snap = ingest_step(&mut engine, "restore", &restore).snapshot;
    assert_eq!(
        sections_on(&snap, &ground_a),
        vec![id_a.clone()],
        "the ground did not re-emerge under its old real id after the restart"
    );
    assert_eq!(
        engine
            .get_section_by_id(&id_a)
            .and_then(|s| s.created_at)
            .as_deref(),
        Some(born_a.as_str()),
        "the restored section lost its birth date across the restart"
    );
}

/// Scenario: corridor A is tombstoned, then a durable custom claim lands on
/// its ground (the only public relinquish trigger once the DB row is gone).
/// Expected behaviour: identity ownership has passed to the durable row, so
/// the next apply clears both the grave and the pure tombstone. Relinquish by
/// real id cannot reach a grave (the claim minted its own DB id), so the
/// apply sweeps tombstoned ground against the durable-intent grounds; with
/// the corridor suppressed no restore could ever have drained the pair.
#[test]
fn durable_claim_mid_tombstone_clears_the_grave() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let ground_a = corridor_ground(0.0);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (_, fp_a) = section_on(&cold, &ground_a).expect("corpus fault: corridor A section");

    for aid in &fp_a.activity_ids {
        engine.remove_activity(aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }
    assert!(
        !engine.section_identity_tombstone_ids().is_empty(),
        "scenario fault: corridor A never tombstoned"
    );

    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: ground_a.clone(),
            distance_meters: calculate_route_distance(&ground_a),
            name: Some("Claimed corridor".to_string()),
            source_activity_id: Some(rides_b[0].id.clone()),
            start_index: Some(0),
            end_index: Some((ground_a.len() - 1) as u32),
        })
        .expect("create_section");

    let filler = filler_act("claim", 60);
    ingest_step(&mut engine, "claim", &[&filler]);
    assert!(
        engine.section_identity_grave_rows().is_empty()
            && engine.section_identity_tombstone_ids().is_empty(),
        "a durable claim on a tombstoned ground must clear the grave and the tombstone"
    );
}

// ============================================================================
// 3. Promotion always relinquishes
// ============================================================================

/// Drive one promoting mutation on a freshly detected corridor section, then
/// prove the registry gave the ground up cleanly: the real id leaves the
/// registry at once, the first resync neither collides on UNIQUE sections.id
/// nor re-carries the ground, no debounce or grave lingers, and the read path
/// shows exactly the durable row (or nothing, for disable/delete).
fn run_promotion_case<M>(label: &str, visible_after: bool, mutate: M)
where
    M: FnOnce(&mut PersistentRouteEngine, &str, &SectionFingerprint) -> Result<(), String>,
{
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let ground = corridor_ground(0.0);
    let rides = corridor_rides(label, 0.0, 9, 0);
    let cold = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let on_ground = sections_on(&cold, &ground);
    assert_eq!(
        on_ground.len(),
        1,
        "{label}: corpus fault: expected exactly one cold section, got {on_ground:?}"
    );
    let id = on_ground[0].clone();
    let fp = cold.sections[&id].clone();

    mutate(&mut engine, &id, &fp).unwrap_or_else(|e| panic!("{label}: mutation failed: {e}"));
    assert!(
        engine
            .section_identity_mirror_rows()
            .iter()
            .all(|(_, real, _, _)| real != &id),
        "{label}: the promoted real id is still carried by the registry"
    );

    let filler = filler_act(label, 90);
    let step = try_ingest_step(&mut engine, "resync", &[&filler]).unwrap_or_else(|e| {
        panic!(
            "{label}: the first resync after promotion failed (the R2 UNIQUE-collision class): {e}"
        )
    });

    assert!(
        engine
            .section_identity_mirror_rows()
            .iter()
            .all(|(_, _, _, payload)| !shares_ground(payload, &ground)),
        "{label}: the registry re-carried the promoted ground (phantom carry)"
    );
    assert_eq!(
        engine.section_identity_pending_len(),
        0,
        "{label}: a debounce is still pending against the promoted ground"
    );
    assert!(
        engine.section_identity_grave_rows().is_empty(),
        "{label}: the promoted ground left a grave behind"
    );

    let on_ground = sections_on(&step.snapshot, &ground);
    if visible_after {
        assert_eq!(
            on_ground,
            vec![id.clone()],
            "{label}: the durable row must be the only visible section on its ground"
        );
        assert!(
            step.snapshot.sections[&id].is_user_defined,
            "{label}: the promoted row lost its user-defined flag"
        );
    } else {
        assert!(
            on_ground.is_empty(),
            "{label}: a suppressed corridor re-emerged: {on_ground:?}"
        );
    }
}

#[test]
fn accept_relinquishes_and_survives_resync() {
    run_promotion_case("accept", true, |e, id, _| e.accept_section(id));
}

#[test]
fn trim_relinquishes_and_survives_resync() {
    run_promotion_case("trim", true, |e, id, fp| {
        let len = fp.polyline_point_count as u32;
        e.trim_section(id, len / 4, len * 3 / 4)
    });
}

#[test]
fn set_reference_relinquishes_and_survives_resync() {
    run_promotion_case("setref", true, |e, id, fp| {
        let aid = fp
            .activity_ids
            .iter()
            .next()
            .expect("a contributing activity")
            .clone();
        e.set_section_reference(id, &aid)
    });
}

#[test]
fn disable_relinquishes_and_survives_resync() {
    run_promotion_case("disable", false, |e, id, _| e.disable_section(id));
}

#[test]
fn delete_relinquishes_and_survives_resync() {
    run_promotion_case("delete", false, |e, id, _| e.delete_section(id));
}

/// Scenario: two detected corridors are merged; the primary polyline stays on
/// its own corridor, so the secondary's ground is released back to detection.
/// Expected behaviour: both real ids leave the registry, the resync neither
/// collides nor resurrects the secondary id, and the primary is the only
/// section on its ground.
#[test]
fn merge_relinquishes_both_identities() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let ground_a = corridor_ground(0.0);
    let ground_b = corridor_ground(1_500.0);
    let rides_a = corridor_rides("ma", 0.0, 9, 0);
    let rides_b = corridor_rides("mb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&cold, &ground_a).expect("corpus fault: corridor A section");
    let (id_b, _) = section_on(&cold, &ground_b).expect("corpus fault: corridor B section");

    engine
        .merge_user_sections(&id_a, &id_b)
        .expect("merge_user_sections");
    assert!(
        engine
            .section_identity_mirror_rows()
            .iter()
            .all(|(_, real, _, _)| real != &id_a && real != &id_b),
        "merge left a merged real id in the registry"
    );

    let filler = filler_act("merge", 90);
    let step = try_ingest_step(&mut engine, "resync", &[&filler]).unwrap_or_else(|e| {
        panic!("the first resync after merge failed (the R2 UNIQUE-collision class): {e}")
    });

    let snap = step.snapshot;
    assert!(
        snap.sections.contains_key(&id_a),
        "the merged primary left the read path"
    );
    assert!(
        snap.sections[&id_a].is_user_defined,
        "the merged primary lost its user-defined flag"
    );
    assert!(
        !snap.sections.contains_key(&id_b),
        "the merged secondary re-appeared under its retired id"
    );
    assert_eq!(
        sections_on(&snap, &ground_a),
        vec![id_a.clone()],
        "the merged primary must be the only section on its ground"
    );
    assert!(
        !sections_on(&snap, &ground_b).contains(&id_b),
        "the released secondary ground came back under the retired id"
    );
}

// ============================================================================
// 4. The mirror invariant across every carry fate
// ============================================================================

/// Trunk from 0 to `to_m` north, then east for `spur_m` (the junction shape).
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

/// Scenario: an agreement-level reference re-pick (adopts immediately), then a
/// junction corpus that splits the trunk (frozen through the re-cut debounce,
/// adopted when it fires at k), with hold steps so every debounce resolves.
/// Expected behaviour: after EVERY apply, each registry row's payload polyline
/// equals the pure layer's held ground for its join id, and the row set equals
/// the pure visible set. This is the mechanical mirror the adoption seam
/// promises, checked at every step rather than scenario endpoints.
#[test]
fn mirror_rows_equal_pure_grounds() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = corridor_rides("agree_cold", 0.0, 9, 0);
    ingest_step(&mut engine, "cold", &refs(&cold));
    assert_registry_mirrors_pure(&engine, "agreement cold");
    // The wave clusters east of the cold spread, re-picking the reference
    // while the extent holds: an agreement carry, adopted with no debounce.
    let wave: Vec<LifecycleActivity> = (0..15)
        .map(|i| {
            act(
                format!("agree_wave_{i:02}"),
                9 + i as i64,
                corridor_ride(0.0, 4.0 + 0.2 * (i % 3) as f64),
            )
        })
        .collect();
    ingest_step(&mut engine, "wave", &refs(&wave));
    assert_registry_mirrors_pure(&engine, "agreement wave");

    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let trunk: Vec<LifecycleActivity> = (0..21)
        .map(|i| {
            act(
                format!("trunk_{i:02}"),
                i as i64,
                trunk_then_spur(TRUNK_LEN_M, 0.0),
            )
        })
        .collect();
    ingest_step(&mut engine, "trunk", &refs(&trunk));
    assert_registry_mirrors_pure(&engine, "junction cold");

    let lower: Vec<LifecycleActivity> = (0..13)
        .map(|i| {
            act(
                format!("lower_{i:02}"),
                21 + i as i64,
                trunk_then_spur(0.45 * TRUNK_LEN_M, 800.0),
            )
        })
        .collect();
    let upper: Vec<LifecycleActivity> = (0..6)
        .map(|i| {
            act(
                format!("upper_{i:02}"),
                34 + i as i64,
                trunk_then_spur(0.60 * TRUNK_LEN_M, 800.0),
            )
        })
        .collect();
    let chunks: Vec<Vec<LifecycleActivity>> = vec![
        lower[0..5].to_vec(),
        lower[5..9].to_vec(),
        lower[9..13].to_vec(),
        upper[0..3].to_vec(),
        upper[3..6].to_vec(),
    ];
    for (i, chunk) in chunks.iter().enumerate() {
        ingest_step(&mut engine, &format!("branch_{i}"), &refs(chunk));
        assert_registry_mirrors_pure(&engine, &format!("junction branch {i}"));
    }
    for i in 0..3 {
        let filler = filler_act("hold", 40 + i);
        ingest_step(&mut engine, "hold", &[&filler]);
        assert_registry_mirrors_pure(&engine, &format!("junction hold {i}"));
    }
}

// ============================================================================
// 5. Every durable ownership kind at once
// ============================================================================

/// Scenario: one engine simultaneously holds an accepted row, a trimmed row, a
/// custom row, and a disabled row on distinct corridors, plus one live auto
/// corridor, then runs two full detect+apply cycles (the R2 crash class: the
/// ownership predicates drifting apart).
/// Expected behaviour: no UNIQUE collision, every durable row and its junction
/// rows byte-unchanged, custom and accepted still on the read path, the
/// disabled corridor absent, and the live corridor keeping its id.
#[test]
fn durable_rows_never_collide() {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let east = [0.0, 1_500.0, 3_000.0, 4_500.0, 6_000.0];
    let rides: Vec<Vec<LifecycleActivity>> = east
        .iter()
        .enumerate()
        .map(|(c, &e)| corridor_rides(&format!("c{c}"), e, 7, (c as i64) * 10))
        .collect();
    let pool: Vec<&LifecycleActivity> = rides.iter().flatten().collect();
    let cold = ingest_step(&mut engine, "cold", &pool).snapshot;
    let ids: Vec<String> = east
        .iter()
        .enumerate()
        .map(|(c, &e)| {
            section_on(&cold, &corridor_ground(e))
                .unwrap_or_else(|| panic!("corpus fault: no section on corridor {c}"))
                .0
        })
        .collect();

    engine.accept_section(&ids[0]).expect("accept_section");
    let trim_len = cold.sections[&ids[1]].polyline_point_count as u32;
    engine
        .trim_section(&ids[1], trim_len / 4, trim_len * 3 / 4)
        .expect("trim_section");
    // The custom row is cut from a real ride of its corridor, the shape the
    // suppression rule was generalised from.
    let src = &rides[2][0];
    let custom_poly: Vec<GpsPoint> = src.gps_points[50..=150].to_vec();
    let custom_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: custom_poly.clone(),
            distance_meters: calculate_route_distance(&custom_poly),
            name: Some("Custom corridor".to_string()),
            source_activity_id: Some(src.id.clone()),
            start_index: Some(50),
            end_index: Some(150),
        })
        .expect("create_section");
    engine.disable_section(&ids[3]).expect("disable_section");

    let db = dir.path().join("lifecycle.db");
    let durable = [
        ids[0].clone(),
        ids[1].clone(),
        custom_id.clone(),
        ids[3].clone(),
    ];
    let durable_rows0 = rows_for(&sections_dump(&db), &durable);
    assert_eq!(
        durable_rows0.len(),
        4,
        "all four durable rows must exist before the resyncs"
    );
    let durable_junction0 = rows_for(&junction_dump(&db), &durable);

    for pass in 1..=2 {
        let filler = filler_act("durable", 90 + pass);
        let step = try_ingest_step(&mut engine, "resync", &[&filler]).unwrap_or_else(|e| {
            panic!(
                "resync {pass} with all durable kinds failed (the R2 UNIQUE-collision class): {e}"
            )
        });
        assert_eq!(
            rows_for(&sections_dump(&db), &durable),
            durable_rows0,
            "resync {pass} rewrote a durable row"
        );
        assert_eq!(
            rows_for(&junction_dump(&db), &durable),
            durable_junction0,
            "resync {pass} rewrote a durable row's junction rows"
        );

        let snap = step.snapshot;
        assert!(
            snap.sections.contains_key(&ids[0]),
            "resync {pass}: the accepted row left the read path"
        );
        assert!(
            snap.sections.contains_key(&ids[1]),
            "resync {pass}: the trimmed row left the read path"
        );
        assert!(
            snap.sections.contains_key(&custom_id),
            "resync {pass}: the custom row left the read path"
        );
        assert!(
            !snap.sections.contains_key(&ids[3]),
            "resync {pass}: the disabled row is visible"
        );
        assert!(
            sections_on(&snap, &corridor_ground(east[3])).is_empty(),
            "resync {pass}: the disabled corridor re-emerged"
        );
        assert!(
            sections_on(&snap, &corridor_ground(east[4])).contains(&ids[4]),
            "resync {pass}: the live auto corridor lost its id"
        );
    }
}
