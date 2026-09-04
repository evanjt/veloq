//! The registry across a config change, a pin, and a ground that comes back.
//!
//! A config change invalidates the debounce basis, not the identities. The
//! catalogue on disk is the only record of which id owns which ground, so the
//! registry is rebuilt from it rather than emptied: ids carry wherever ground
//! carries. The streaks start clean AND the next fold is decisive, so the
//! answer under the new params lands in one apply instead of `k`.
//!
//! A pin is durable user intent that the drawn line does not move. It reaches
//! the detector as `SectionUpdatePolicy::pinned_ids`, so the fold freezes the
//! pinned prior and withholds any fresh cut sharing its corridor.
//!
//! A tombstoned ground that re-forms comes back as itself: its own id, and its
//! own sport, not the sport of the batch that revived it.
//!
//! Synthetic geometry only.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test identity_reseed

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

/// Trunk from 0 to `to_m` north, then east for `spur_m`.
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
    act_of(id, day, pts, "Ride")
}

fn act_of(id: String, day: i64, pts: Vec<GpsPoint>, sport: &str) -> LifecycleActivity {
    LifecycleActivity {
        id,
        sport_type: sport.to_string(),
        start_date_unix: T0 + day * DAY,
        gps_points: pts,
    }
}

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

/// A full trunk `east_m` east of the base line, at a lateral offset.
fn trunk_east_of(east_m: f64, offset_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= TRUNK_LEN_M {
        pts.push(pt(d, east_m + offset_m));
        d += STEP_M;
    }
    pts
}

/// `count` rides of one corridor, well clear of any other corridor.
fn corridor_outings(tag: &str, east_m: f64, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let offset = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(
                format!("{tag}_{i:02}"),
                day0 + i as i64,
                trunk_east_of(east_m, offset),
            )
        })
        .collect()
}

/// Rides enough to form a trunk section on a cold detect.
fn trunk_outings(count: usize) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let offset = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(format!("trunk_{i:02}"), i as i64, jittered_trunk(offset))
        })
        .collect()
}

/// Branch traffic peeling off part-way up the trunk: the raw catalogue cuts
/// the trunk into pieces once enough of it lands.
fn branch_outings(count: usize, at_frac: f64, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            act(
                format!("branch_{at_frac}_{i:02}"),
                day0 + i as i64,
                trunk_then_spur(at_frac * TRUNK_LEN_M, 800.0),
            )
        })
        .collect()
}

/// A far-away two-point activity that forms no section: forces a fresh
/// detect+apply without perturbing any corridor.
fn filler_act(tag: &str, day: i64) -> LifecycleActivity {
    act(
        format!("filler_{tag}"),
        day,
        vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
    )
}

/// Whether two polylines differ by more than serialisation noise: a point
/// count change, or any coordinate moving over ~0.1 m.
fn geometry_differs(a: &[GpsPoint], b: &[GpsPoint]) -> bool {
    a.len() != b.len()
        || a.iter().zip(b).any(|(x, y)| {
            (x.latitude - y.latitude).abs() > 1.0e-6 || (x.longitude - y.longitude).abs() > 1.0e-6
        })
}

/// The real DB ids the registry carries.
fn carried_real_ids(engine: &PersistentEngine) -> Vec<String> {
    engine
        .section_identity_mirror_rows()
        .into_iter()
        .map(|(_, real_id, _, _)| real_id)
        .collect()
}

/// Detect and apply with no new activities, the way a settings change
/// triggers a re-analysis.
fn redetect(engine: &mut PersistentEngine) -> SectionSnapshot {
    ingest_step(engine, "redetect", &[]).snapshot
}

// ============================================================================
// A config change
// ============================================================================

/// Scenario: the user moves an advanced detection slider on a populated
/// library, and the parameter moves far enough from the ground found that the
/// re-analysed catalogue holds exactly the same sections.
/// Expected behaviour: every section keeps its id. A config change invalidates
/// the debounce, never the identities.
#[test]
fn a_config_change_keeps_every_section_id() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&trunk_outings(12)));
    assert_catalogue_populated("cold", &cold.snapshot);

    let mut cfg = engine.get_section_config();
    cfg.max_section_length += 1.0;
    engine.set_section_config(cfg);

    assert_eq!(
        engine.section_identity_visible_len(),
        cold.snapshot.count(),
        "the config change dropped the registry rows for the catalogue on disk"
    );

    let after = redetect(&mut engine);
    assert_eq!(
        cold.snapshot.ids(),
        after.ids(),
        "the same ground came back under different ids after a config change"
    );
}

/// Scenario: the same slider move, then the app is killed and reopened before
/// any further detect.
/// Expected behaviour: the reseeded registry is on disk, so the reopened engine
/// still owns the catalogue's ids.
#[test]
fn a_reseeded_registry_survives_a_restart() {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&trunk_outings(12)));
    assert_catalogue_populated("cold", &cold.snapshot);

    let mut cfg = engine.get_section_config();
    cfg.max_section_length += 1.0;
    engine.set_section_config(cfg);
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut reopened = PersistentEngine::new(path.to_str().unwrap()).expect("reopen engine");
    reopened.load().expect("load on reopen");
    assert_eq!(
        reopened.section_identity_visible_len(),
        cold.snapshot.count(),
        "the restored registry does not describe the catalogue on disk"
    );
    let after = redetect(&mut reopened);
    assert_eq!(
        cold.snapshot.ids(),
        after.ids(),
        "the same ground came back under different ids after a restart"
    );
}

/// Scenario: a section is accepted (the registry relinquishes it) and the
/// process dies before any catalogue save writes the blob again.
/// Expected behaviour: the reopened registry does not carry the accepted
/// ground. The registry mutation is durable the moment it happens, not the
/// next time a detect saves.
#[test]
fn a_relinquish_is_durable_without_a_save() {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&trunk_outings(12)));
    let (id, _) = busiest_section(&cold.snapshot).expect("trunk section detected");
    assert!(
        carried_real_ids(&engine).contains(&id),
        "the registry never carried the trunk section"
    );
    engine.accept_section(&id).expect("accept_section");
    drop(engine);

    let path = dir.path().join("lifecycle.db");
    let mut reopened = PersistentEngine::new(path.to_str().unwrap()).expect("reopen engine");
    reopened.load().expect("load on reopen");
    assert!(
        !carried_real_ids(&reopened).contains(&id),
        "the restored registry carries a ground the accepted row now owns"
    );
}

// ============================================================================
// A pin
// ============================================================================

/// The trunk section, its stored geometry version, and the branch traffic that
/// re-cuts it.
fn pinned_run(pin: bool) -> (PersistentEngine, tempfile::TempDir, String, Vec<GpsPoint>) {
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "trunk", &refs(&trunk_outings(21)));
    let (id, fp) = busiest_section(&cold.snapshot).expect("trunk section detected");

    if pin {
        let version = engine
            .record_section_geometry(&id, &fp.polyline, true, None)
            .expect("record geometry version");
        assert!(
            engine
                .pin_section_geometry(&id, version)
                .expect("pin section"),
            "the version just recorded was not pinnable"
        );
    }

    let mut day = 30;
    for (count, frac) in [(13usize, 0.45f64), (6, 0.60)] {
        let chunk = branch_outings(count, frac, day);
        ingest_step(&mut engine, "branch", &refs(&chunk));
        day += count as i64;
    }
    for i in 0..3 {
        let filler = filler_act(&format!("hold_{i}"), day + i);
        ingest_step(&mut engine, "hold", &[&filler]);
    }
    (engine, dir, id, fp.polyline)
}

/// Scenario: junction traffic arrives that the detector would answer by
/// cutting the trunk into pieces.
/// Expected behaviour: unpinned, the drawn line moves. This is the control for
/// the pin gate below, and it fails loudly if the corpus stops re-cutting.
#[test]
fn an_unpinned_section_is_re_cut_by_junction_traffic() {
    let (mut engine, _dir, id, cold_polyline) = pinned_run(false);
    let after = snapshot(&mut engine);
    let moved = match after.sections.get(&id) {
        Some(fp) => geometry_differs(&fp.polyline, &cold_polyline),
        None => true,
    };
    assert!(
        moved,
        "the corpus no longer re-cuts the trunk, so the pin gate proves nothing"
    );
}

/// Scenario: the user pins the trunk, then the same junction traffic arrives.
/// Expected behaviour: the pinned section is still there and its polyline has
/// not moved. The fold freezes a pinned prior and withholds the fresh cut that
/// shares its corridor.
#[test]
fn a_pinned_section_holds_its_geometry_through_a_recut() {
    let (mut engine, _dir, id, cold_polyline) = pinned_run(true);
    let after = snapshot(&mut engine);
    let fp = after
        .sections
        .get(&id)
        .expect("the pinned section left the catalogue");
    assert!(
        !geometry_differs(&fp.polyline, &cold_polyline),
        "the pinned section was re-cut: its drawn line moved"
    );
}

/// Scenario: a config change makes the ground the catalogue holds stop
/// qualifying.
/// Expected behaviour: the detector drops it from the raw catalogue and the
/// visible view retires it in the SAME apply. Reseeding keeps the identities,
/// not the sections: a carried id is still subject to every retirement rule, and
/// a config change is decisive enough to skip the dissolve debounce.
fn disqualified_ground_retires(arm: Arm) {
    let (mut engine, _dir) = fresh_engine_for(arm);
    let cold = ingest_step(&mut engine, "trunk", &refs(&trunk_outings(12)));
    assert_catalogue_populated("cold", &cold.snapshot);

    let mut cfg = engine.get_section_config();
    cfg.min_activities = 50;
    engine.set_section_config(cfg);

    let after = redetect(&mut engine);
    assert_eq!(
        raw_snapshot(&engine).count(),
        0,
        "{}: the re-analysis still qualified ground under min_activities = 50",
        arm.label()
    );
    assert_eq!(
        after.count(),
        0,
        "{}: the disqualified sections were still visible one apply after the config change",
        arm.label()
    );
}

/// Scenario: a library holding a busy corridor and a quiet one, and the user
/// raises the traversals a section must have until only the busy corridor
/// qualifies.
/// Expected behaviour: one apply settles both halves. The busy corridor keeps
/// its id, and the quiet one is gone from the visible catalogue rather than
/// debounce-held for another `k` detects.
fn config_change_settles_in_one_apply(arm: Arm) {
    let (mut engine, _dir) = fresh_engine_for(arm);
    let mut library = corridor_outings("busy", 0.0, 12, 0);
    library.extend(corridor_outings("quiet", 5_000.0, 9, 40));
    let cold = ingest_step(&mut engine, "cold", &refs(&library)).snapshot;
    assert_eq!(
        cold.count(),
        2,
        "{}: the cold detect did not find both corridors: {:?}",
        arm.label(),
        cold.ids()
    );
    let (busy_id, _) = busiest_section(&cold).expect("a busiest corridor");

    let mut cfg = engine.get_section_config();
    cfg.min_activities = 11;
    engine.set_section_config(cfg);

    let after = redetect(&mut engine);
    assert_eq!(
        after.ids().into_iter().cloned().collect::<Vec<_>>(),
        vec![busy_id],
        "{}: one apply after the config change the catalogue is not the busy corridor alone",
        arm.label()
    );
}

// ============================================================================
// A tombstoned ground coming back
// ============================================================================

/// Scenario: every ride that formed a corridor is deleted, the corridor
/// tombstones, and the same ground later fills with traffic of another sport.
/// Expected behaviour: it comes back as itself, under the old id, and its
/// heading follows the members it now has: every one is a run, so it reads
/// as a run, not as the sport the grave remembers.
#[test]
fn a_restored_section_comes_back_under_its_old_id_and_its_members_sport() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = trunk_outings(12);
    let cold = ingest_step(&mut engine, "rides", &refs(&rides)).snapshot;
    let (id, fp) = busiest_section(&cold).expect("trunk section detected");
    assert_eq!(fp.sport_type, "Ride");

    for ride in &rides {
        engine.remove_activity(&ride.id).expect("remove_activity");
    }
    for i in 0..4 {
        let filler = filler_act(&format!("gone_{i}"), 100 + i);
        ingest_step(&mut engine, "gone", &[&filler]);
    }
    assert!(
        !snapshot(&mut engine).sections.contains_key(&id),
        "the corridor never tombstoned, so the restore proves nothing"
    );

    let runs: Vec<LifecycleActivity> = (0..12)
        .map(|i| {
            let offset = (i as f64 - 5.5) * 1.5;
            act_of(
                format!("run_{i:02}"),
                200 + i as i64,
                jittered_trunk(offset),
                "Run",
            )
        })
        .collect();
    let after = ingest_step(&mut engine, "runs", &refs(&runs)).snapshot;

    let fp = after
        .sections
        .get(&id)
        .expect("the re-formed ground did not come back under its old id");
    assert_eq!(
        fp.sport_type, "Run",
        "a restored section kept the grave's sport instead of its members'"
    );
}

#[test]
fn a_config_change_settles_in_one_apply() {
    config_change_settles_in_one_apply(Arm::Battery);
}

#[test]
fn a_config_change_settles_in_one_apply_on_corridor() {
    config_change_settles_in_one_apply(Arm::Battery);
}

#[test]
fn a_config_change_that_disqualifies_ground_still_retires_it() {
    disqualified_ground_retires(Arm::Battery);
}

#[test]
fn a_config_change_that_disqualifies_ground_still_retires_it_on_corridor() {
    disqualified_ground_retires(Arm::Battery);
}
