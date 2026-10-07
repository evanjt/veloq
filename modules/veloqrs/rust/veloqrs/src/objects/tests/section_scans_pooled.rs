//! The activity-to-section scan and the extension track answer from committed
//! rows, so a sync page or a detection apply holding the engine does not hold
//! them, and the matching they do runs outside the engine lock.

use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
use tracematch::GpsPoint;

const POINTS: usize = 200;
const STEP_DEG: f64 = 0.0001;
const LAT: f64 = 46.2;
const LNG: f64 = 7.3;

/// Ground north from point `from` to `to`, one point every 11 m, in the order given.
fn leg(from: i64, to: i64) -> Vec<GpsPoint> {
    let step = if to >= from { 1 } else { -1 };
    let mut points = Vec::new();
    let mut i = from;
    loop {
        points.push(GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG));
        if i == to {
            break;
        }
        i += step;
    }
    points
}

fn the_line() -> Vec<GpsPoint> {
    leg(0, POINTS as i64 - 1)
}

/// North along the line with ground either side, then back south.
fn out_and_back() -> Vec<GpsPoint> {
    let mut points = leg(-40, POINTS as i64 + 40);
    points.extend(leg(POINTS as i64 + 39, -40));
    points
}

/// A custom section cut from `source`, a ride along the line.
fn seed_section_from_source() -> String {
    crate::with_persistent_engine(|engine| {
        engine
            .add_activity("source".into(), the_line(), "Ride".into())
            .expect("source ride");
        engine
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".into(),
                polyline: the_line(),
                distance_meters: tracematch::matching::calculate_route_distance(&the_line()),
                name: Some("Long straight".into()),
                source_activity_id: Some("source".into()),
                start_index: Some(0),
                end_index: Some(POINTS as u32 - 1),
            })
            .expect("section")
    })
    .expect("engine")
}

fn seed_ride(id: &str, track: Vec<GpsPoint>) {
    crate::with_persistent_engine(|engine| {
        engine
            .add_activity(id.into(), track, "Ride".into())
            .expect("ride");
    })
    .expect("engine");
}

#[test]
fn test_match_activity_to_sections_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_scan_under_writer.db");
    let section_id = seed_section_from_source();
    seed_ride("twice", out_and_back());

    let sections = SectionManager::new();
    let offered = read_while_writer_holds(|| {
        sections
            .match_activity_to_sections("twice".into())
            .expect("the scan reads while a writer holds the engine")
    });

    assert!(offered.iter().any(|m| m.section_id == section_id));
}

#[test]
fn test_get_extension_track_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_extension_under_writer.db");
    let section_id = seed_section_from_source();

    let sections = SectionManager::new();
    let track = read_while_writer_holds(|| {
        sections
            .get_extension_track(section_id.clone())
            .expect("the track reads while a writer holds the engine")
    });

    assert_eq!(track.section_start_idx, 0);
    assert_eq!(track.section_end_idx, POINTS as u32 - 1);
}

#[test]
fn test_scan_offers_a_forward_and_a_reverse_pass_like_the_engine() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_scan_parity.db");
    let section_id = seed_section_from_source();
    seed_ride("twice", out_and_back());

    let offered = SectionManager::new()
        .match_activity_to_sections("twice".into())
        .unwrap();
    let engine_offered =
        crate::with_persistent_engine(|e| e.match_activity_to_sections("twice")).expect("engine");

    let ours: Vec<_> = offered
        .iter()
        .filter(|m| m.section_id == section_id)
        .collect();
    assert_eq!(ours.len(), 2, "one pass each way: {offered:?}");
    assert!(ours.iter().any(|m| m.same_direction));
    assert!(ours.iter().any(|m| !m.same_direction));
    assert!(
        ours.iter()
            .all(|m| m.section_name.as_deref() == Some("Long straight"))
    );
    assert_eq!(offered.len(), engine_offered.len());
    for (a, b) in offered.iter().zip(&engine_offered) {
        assert_eq!(
            (&a.section_id, a.start_index, a.end_index, a.same_direction),
            (&b.section_id, b.start_index, b.end_index, b.same_direction)
        );
    }
}

#[test]
fn test_scan_answers_nothing_for_a_short_track_an_empty_catalogue_or_no_track() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_scan_empty.db");
    let sections = SectionManager::new();

    seed_ride("no_sections", out_and_back());
    assert!(
        sections
            .match_activity_to_sections("no_sections".into())
            .unwrap()
            .is_empty()
    );

    seed_section_from_source();
    seed_ride("short", leg(0, 1));
    assert!(
        sections
            .match_activity_to_sections("short".into())
            .unwrap()
            .is_empty()
    );
    assert!(
        sections
            .match_activity_to_sections("absent".into())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn test_extension_track_refuses_a_missing_section_and_one_with_no_representative() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_extension_refusals.db");
    let sections = SectionManager::new();
    assert!(sections.get_extension_track("absent".into()).is_err());

    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version)
                 VALUES ('orphan', 'auto', 'Orphan', 'Ride', '[]', 1000.0, 0, 1)",
                [],
            )
            .expect("section");
    })
    .expect("engine");
    assert!(sections.get_extension_track("orphan".into()).is_err());
}

#[test]
fn test_extension_track_reports_the_stored_range_not_the_proximity_span() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_extension_anchor_range.db");
    let lead = 40usize;
    let ride = leg(-(lead as i64), POINTS as i64 + lead as i64 - 1);
    let section_id = crate::with_persistent_engine(|engine| {
        engine
            .add_activity("source".into(), ride.clone(), "Ride".into())
            .expect("source ride");
        let line = ride[lead..lead + POINTS].to_vec();
        engine
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".into(),
                distance_meters: tracematch::matching::calculate_route_distance(&line),
                polyline: line,
                name: Some("Cut with lead-in".into()),
                source_activity_id: Some("source".into()),
                start_index: Some(lead as u32),
                end_index: Some((lead + POINTS) as u32 - 1),
            })
            .expect("section")
    })
    .expect("engine");

    let track = SectionManager::new()
        .get_extension_track(section_id)
        .expect("extension track");

    assert_eq!(track.section_start_idx, lead as u32);
    assert_eq!(track.section_end_idx, (lead + POINTS) as u32 - 1);
}
