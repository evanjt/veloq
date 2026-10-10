//! Scenario: a library holds sections in two towns far apart, and a ride in
//! one of them is attached.
//!
//! Expected behaviour: only the sections the ride can reach are cut against
//! it, one a ride was attached to by hand reaches as far as its relaxed bar,
//! and the rows written are the rows cutting every section would write.

use rusqlite::params;
use tracematch::GpsPoint;

use super::attach_cuts;
use crate::persistence::PersistentEngine;
use crate::persistence::sections::{
    compute_section_portions, forced_portions, forced_reach_m, may_reach, strict_reach_m,
};

const POINTS: usize = 200;
const STEP_DEG: f64 = 0.0001;
const HOME_LAT: f64 = 46.2;
const AWAY_LAT: f64 = 47.2;
const LNG: f64 = 7.3;

/// Past the strict 200 m bar, inside the relaxed one.
const BESIDE_M: f64 = 300.0;

fn east(metres: f64) -> f64 {
    metres / (111_320.0 * HOME_LAT.to_radians().cos())
}

/// A straight line north from `lat`, `offset` metres east, about 2.2 km.
fn line(lat: f64, offset: f64, from: i64, to: i64) -> Vec<GpsPoint> {
    (from..to)
        .map(|i| GpsPoint::new(lat + i as f64 * STEP_DEG, LNG + east(offset)))
        .collect()
}

fn insert_section(engine: &PersistentEngine, id: &str, polyline: &[GpsPoint]) {
    let bounds = tracematch::Bounds::from_points(polyline).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, 'Ride', ?, 2200.0, 0, 1, '2026-01-01T00:00:00Z', ?, ?, ?, ?)",
            params![
                id,
                id,
                serde_json::to_string(polyline).unwrap(),
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng
            ],
        )
        .unwrap();
}

fn rows(engine: &PersistentEngine, section_id: &str) -> Vec<(u32, u32)> {
    let mut stmt = engine
        .db
        .prepare(
            "SELECT start_index, end_index FROM section_activities
             WHERE section_id = ? AND activity_id = 'ride' ORDER BY start_index",
        )
        .unwrap();
    stmt.query_map(params![section_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Ten sections under the ride, ten in the other town, one beside the ride
/// the athlete attached it to and one beside it that nobody did.
fn library() -> (PersistentEngine, Vec<GpsPoint>) {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let ride = line(HOME_LAT, 0.0, -40, POINTS as i64 + 40);
    engine
        .add_activity("ride".into(), ride.clone(), "Ride".into())
        .unwrap();
    for i in 0..10 {
        insert_section(
            &engine,
            &format!("home{i}"),
            &line(HOME_LAT, 0.0, 0, POINTS as i64),
        );
        insert_section(
            &engine,
            &format!("away{i}"),
            &line(AWAY_LAT, 0.0, 0, POINTS as i64),
        );
    }
    let beside = line(HOME_LAT, BESIDE_M, 0, POINTS as i64);
    insert_section(&engine, "forced", &beside);
    insert_section(&engine, "unforced", &beside);
    engine
        .db
        .execute(
            "INSERT INTO section_forced_matches (section_id, activity_id, forced_at)
             VALUES ('forced', 'ride', 1700000000)",
            [],
        )
        .unwrap();
    engine.load_sections().unwrap();
    (engine, ride)
}

#[test]
fn an_attach_cuts_only_the_sections_the_ride_can_reach() {
    let (mut engine, _) = library();
    let before = attach_cuts();

    engine.attach_activity_junctions("ride").unwrap();

    assert_eq!(attach_cuts() - before, 11);
    for i in 0..10 {
        assert_eq!(rows(&engine, &format!("home{i}")).len(), 1);
        assert!(rows(&engine, &format!("away{i}")).is_empty());
    }
    assert_eq!(rows(&engine, "forced").len(), 1);
    assert!(rows(&engine, "unforced").is_empty());
}

#[test]
fn an_attach_writes_the_rows_cutting_every_section_would() {
    let (mut engine, ride) = library();
    let config = engine.section_config.clone();
    let sections: Vec<_> = engine
        .get_sections()
        .iter()
        .map(|s| (s.id.clone(), s.polyline.clone()))
        .collect();

    engine.attach_activity_junctions("ride").unwrap();

    for (id, polyline) in sections {
        let cut = if id == "forced" {
            forced_portions
        } else {
            compute_section_portions
        };
        let expected: Vec<(u32, u32)> = cut("ride", &ride, &polyline, &config)
            .into_iter()
            .map(|p| (p.start_index, p.end_index))
            .collect();
        assert_eq!(rows(&engine, &id), expected, "section {id}");
    }
}

/// A ride that runs `east_m` east of a line north from `lat`, or past its far
/// end by `north_m`, steps out to where each cut stops finding it. Wherever a
/// cut finds a pass the reach test admits the ride, and a ride well past the
/// reach is refused.
#[test]
fn the_reach_test_admits_every_ride_a_cut_finds_a_pass_on() {
    let config = tracematch::SectionConfig::default();
    for lat in [-62.0, -33.9, 0.5, 46.2, 69.6] {
        let deg_east = |m: f64| m / (111_320.0 * f64::to_radians(lat).cos());
        let section: Vec<GpsPoint> = (0..POINTS as i64)
            .map(|i| GpsPoint::new(lat + i as f64 * STEP_DEG, LNG))
            .collect();
        for step in 0..=160 {
            let off = f64::from(step) * 5.0;
            let beside: Vec<GpsPoint> = (-40..POINTS as i64 + 40)
                .map(|i| GpsPoint::new(lat + i as f64 * STEP_DEG, LNG + deg_east(off)))
                .collect();
            let beyond: Vec<GpsPoint> = (0..POINTS as i64)
                .map(|i| {
                    let north = (POINTS as i64 - 1 + i) as f64 * STEP_DEG + off / 111_132.0;
                    GpsPoint::new(lat + north, LNG)
                })
                .collect();
            for ride in [beside, beyond] {
                let bounds = tracematch::Bounds::from_points(&ride).unwrap();
                for (cut, reach_m) in [
                    (
                        compute_section_portions as fn(_, _, _, _) -> _,
                        strict_reach_m(&config),
                    ),
                    (forced_portions, forced_reach_m(&config)),
                ] {
                    if !cut("ride", &ride, &section, &config).is_empty() {
                        assert!(
                            may_reach(&bounds, &section, reach_m),
                            "lat {lat}, {off} m off, reach {reach_m} m"
                        );
                    }
                }
            }
        }
        let far: Vec<GpsPoint> = (0..POINTS as i64)
            .map(|i| GpsPoint::new(lat + i as f64 * STEP_DEG, LNG + deg_east(2_000.0)))
            .collect();
        let far = tracematch::Bounds::from_points(&far).unwrap();
        assert!(
            !may_reach(&far, &section, forced_reach_m(&config)),
            "lat {lat}"
        );
    }
}
