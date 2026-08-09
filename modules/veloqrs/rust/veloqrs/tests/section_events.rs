//! The D5 emitter: the identity apply turns fired lifecycle changes into
//! `section_history` and `section_geometry` rows, written inside the same
//! transaction as the catalogue save. Contracts:
//! - a mint writes one `formed` event with the birth geometry as version 1,
//! - repeat applies of an unchanged pool write nothing (no event spam from
//!   agreement refinements),
//! - a sustained dissolve writes one `dissolved` event carrying the era
//!   snapshot of the section as it was (visits per month at fire time),
//! - a re-emergence writes one `restored` event with a fresh geometry
//!   version, onto the same real id.
//!
//! Synthetic geometry only; corridors sit >100 m apart so the 50 m ground
//! metric never bridges them.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test section_events

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::LifecycleActivity;
use tracematch::{GpsPoint, shares_ground};

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

/// `count` laterally jittered rides of one corridor, one per day.
fn corridor_rides(prefix: &str, east_m: f64, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(
                format!("{prefix}_{i:02}"),
                day0 + i as i64,
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

/// The busiest visible section on `ground`.
fn section_on(snap: &SectionSnapshot, ground: &[GpsPoint]) -> Option<(String, SectionFingerprint)> {
    snap.sections
        .iter()
        .filter(|(_, f)| shares_ground(&f.polyline, ground))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
}

fn kinds(engine: &veloqrs::PersistentRouteEngine, id: &str) -> Vec<String> {
    engine
        .section_history(id)
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

#[test]
fn cold_ingest_writes_one_formed_event_with_birth_geometry() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, fp) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    assert_eq!(kinds(&engine, &id), vec!["formed"]);
    let event = &engine.section_history(&id)[0];
    assert_eq!(event.geometry_version, Some(1));
    let birth = engine
        .section_geometry_polyline(&id, 1)
        .expect("birth geometry stored");
    assert!(
        shares_ground(&birth, &fp.polyline),
        "version 1 must be the section's ground at birth"
    );
}

#[test]
fn unchanged_pool_applies_write_no_events() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    for i in 0..4 {
        let filler = filler_act("steady", 20 + i);
        ingest_step(&mut engine, "steady", &[&filler]);
    }
    assert_eq!(
        kinds(&engine, &id),
        vec!["formed"],
        "an unchanged corridor must accumulate no history"
    );
    assert_eq!(
        engine.section_geometry_versions(&id).len(),
        1,
        "agreement refinements must not stack geometry versions"
    );
}

#[test]
fn sustained_dissolve_writes_one_event_with_an_era_snapshot() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");

    for aid in rides_a.iter().map(|r| r.id.clone()).collect::<Vec<_>>() {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }

    let history = engine.section_history(&id_a);
    assert_eq!(
        history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
        vec!["formed", "dissolved"],
        "exactly one dissolve fires, on the k-th sustained detect"
    );
    let details: serde_json::Value = serde_json::from_str(
        history[1]
            .details
            .as_deref()
            .expect("a dissolve carries its era snapshot"),
    )
    .expect("snapshot is JSON");
    for key in ["pr_activity_id", "pr_time", "avg_time", "visits_per_month"] {
        assert!(details.get(key).is_some(), "snapshot must carry {key}");
    }
}

#[test]
fn re_emerged_ground_writes_a_restored_event_on_the_same_id() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");

    for aid in rides_a.iter().map(|r| r.id.clone()).collect::<Vec<_>>() {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }

    let revived = corridor_rides("cr", 0.0, 9, 60);
    let snap = ingest_step(&mut engine, "revive", &refs(&revived)).snapshot;
    let (id_now, _) = section_on(&snap, &corridor_ground(0.0)).expect("corridor A re-emerges");
    assert_eq!(id_now, id_a, "re-emerged ground restores its real id");

    let history_kinds = kinds(&engine, &id_a);
    assert_eq!(
        history_kinds,
        vec!["formed", "dissolved", "restored"],
        "the full arc reads from one id's history"
    );
    let restored = &engine.section_history(&id_a)[2];
    let version = restored
        .geometry_version
        .expect("a restore records the re-emerged geometry");
    assert!(version > 1, "the restore geometry is a fresh version");
    assert!(engine.section_geometry_polyline(&id_a, version).is_some());
}
