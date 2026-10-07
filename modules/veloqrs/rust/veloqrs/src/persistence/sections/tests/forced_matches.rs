//! A ride the athlete attaches to a section by hand is cut at the relaxed bar,
//! every traversal it makes is written, and the attachment is a record the
//! junction rebuilds honour: a trim, a reset or a merge re-cuts it at the same
//! relaxed bar instead of dropping it at the strict one. A ride the relaxed bar
//! no longer reaches leaves, and the edit names it.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::sections::CreateSectionParams;

const POINTS: usize = 200;
const STEP_DEG: f64 = 0.0001;
const LAT: f64 = 46.2;
const LNG: f64 = 7.3;

/// Metres to degrees of longitude at the test latitude.
fn east(metres: f64) -> f64 {
    metres / (111_320.0 * LAT.to_radians().cos())
}

/// A straight line north, about 2.2 km, one point every 11 m.
fn line() -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

/// Ground north of the line's start from point `from` to `to`, `offset` metres
/// east of it, with points in the order given.
fn leg(from: i64, to: i64, offset: f64) -> Vec<GpsPoint> {
    let step = if to >= from { 1 } else { -1 };
    let mut points = Vec::new();
    let mut i = from;
    loop {
        points.push(GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG + east(offset)));
        if i == to {
            break;
        }
        i += step;
    }
    points
}

/// One pass along the whole line, with ground before and after it.
fn ride(offset: f64) -> Vec<GpsPoint> {
    leg(-40, POINTS as i64 + 40, offset)
}

fn out_and_back(offset: f64) -> Vec<GpsPoint> {
    let mut points = ride(offset);
    points.extend(leg(POINTS as i64 + 39, -40, offset));
    points
}

/// An engine holding the line as a section, custom (cut from a source ride) or
/// detected, and nothing else attached to it.
fn engine_with_section(custom: bool) -> (PersistentEngine, String) {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let polyline = line();
    if custom {
        engine
            .add_activity("source".into(), polyline.clone(), "Ride".into())
            .unwrap();
    }
    let id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some("Long straight".into()),
            source_activity_id: custom.then(|| "source".to_string()),
            start_index: custom.then_some(0),
            end_index: custom.then_some(POINTS as u32 - 1),
        })
        .unwrap();
    (engine, id)
}

fn add_ride(engine: &mut PersistentEngine, id: &str, track: Vec<GpsPoint>) {
    engine
        .add_activity(id.into(), track, "Ride".into())
        .unwrap();
}

/// Drop what the strict scan attached on adding the ride, so the force-match
/// is what writes the pair.
fn detach(engine: &PersistentEngine, section_id: &str, activity_id: &str) {
    engine
        .db
        .execute(
            "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
            params![section_id, activity_id],
        )
        .unwrap();
}

fn rows(engine: &PersistentEngine, section_id: &str, activity_id: &str) -> Vec<(u32, u32)> {
    let mut stmt = engine
        .db
        .prepare(
            "SELECT start_index, end_index FROM section_activities
             WHERE section_id = ? AND activity_id = ? ORDER BY start_index",
        )
        .unwrap();
    stmt.query_map(params![section_id, activity_id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn insert_metrics(engine: &PersistentEngine, id: &str, name: &str, date: i64) {
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
             VALUES (?, ?, ?, 0, 0, 0, 0, 'Ride')",
            params![id, name, date],
        )
        .unwrap();
}

fn is_forced(engine: &PersistentEngine, section_id: &str, activity_id: &str) -> bool {
    engine
        .db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM section_forced_matches
             WHERE section_id = ? AND activity_id = ?)",
            params![section_id, activity_id],
            |r| r.get(0),
        )
        .expect("the force-match record is readable")
}

/// The strict matcher keeps nothing past about 60 m off the line; the relaxed
/// bar is 2.5 times the 200 m proximity threshold.
const PAST_STRICT: f64 = 300.0;
const PAST_RELAXED: f64 = 800.0;

#[test]
fn a_ride_forced_past_the_strict_bar_keeps_its_row_through_a_trim() {
    for custom in [true, false] {
        let (mut engine, sid) = engine_with_section(custom);
        add_ride(&mut engine, "wide", ride(PAST_STRICT));
        assert!(
            rows(&engine, &sid, "wide").is_empty(),
            "the strict scan does not reach a ride {PAST_STRICT} m off"
        );

        assert!(engine.rematch_activity_to_section("wide", &sid).unwrap());
        assert_eq!(rows(&engine, &sid, "wide").len(), 1);
        assert!(is_forced(&engine, &sid, "wide"));

        let departed = engine.trim_section(&sid, 20, 180).unwrap();

        assert!(departed.is_empty(), "custom {custom}: {departed:?}");
        assert_eq!(
            rows(&engine, &sid, "wide").len(),
            1,
            "custom {custom}: the forced ride lost its row to the strict rebuild"
        );
        assert!(is_forced(&engine, &sid, "wide"));
    }
}

#[test]
fn a_forced_ride_keeps_its_row_through_a_reset_of_the_bounds() {
    let (mut engine, sid) = engine_with_section(false);
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    assert!(engine.rematch_activity_to_section("wide", &sid).unwrap());
    engine.trim_section(&sid, 20, 180).unwrap();

    let departed = engine.reset_section_bounds(&sid).unwrap();

    assert!(departed.is_empty(), "{departed:?}");
    assert_eq!(rows(&engine, &sid, "wide").len(), 1);
}

#[test]
fn a_ride_twenty_metres_off_keeps_its_row_through_a_rebuild() {
    for custom in [true, false] {
        let (mut engine, sid) = engine_with_section(custom);
        add_ride(&mut engine, "near", ride(20.0));
        detach(&engine, &sid, "near");
        assert!(engine.rematch_activity_to_section("near", &sid).unwrap());

        engine.trim_section(&sid, 20, 180).unwrap();

        assert_eq!(rows(&engine, &sid, "near").len(), 1, "custom {custom}");
    }
}

#[test]
fn a_forced_out_and_back_writes_a_row_for_each_pass() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "twice", out_and_back(PAST_STRICT));

    assert!(engine.rematch_activity_to_section("twice", &sid).unwrap());
    assert_eq!(rows(&engine, &sid, "twice").len(), 2, "one row per pass");

    engine.trim_section(&sid, 20, 180).unwrap();
    assert_eq!(rows(&engine, &sid, "twice").len(), 2, "one row per pass");
}

/// A forced ride the strict pass also catches is cut once: the strict rows and
/// the forced rows start at different indices, so writing both would count
/// one pass twice.
#[test]
fn a_forced_ride_the_strict_pass_also_matches_writes_one_row_per_pass() {
    for custom in [true, false] {
        let (mut engine, sid) = engine_with_section(custom);
        add_ride(&mut engine, "on", out_and_back(0.0));
        detach(&engine, &sid, "on");
        assert!(engine.rematch_activity_to_section("on", &sid).unwrap());
        assert_eq!(rows(&engine, &sid, "on").len(), 2);

        engine.trim_section(&sid, 20, 180).unwrap();

        assert_eq!(rows(&engine, &sid, "on").len(), 2, "custom {custom}");
    }
}

#[test]
fn a_ride_beyond_the_relaxed_bar_is_not_attached() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "far", ride(PAST_RELAXED));

    assert!(!engine.rematch_activity_to_section("far", &sid).unwrap());

    assert!(rows(&engine, &sid, "far").is_empty());
    assert!(!is_forced(&engine, &sid, "far"));
}

#[test]
fn a_forced_ride_the_trim_leaves_behind_is_named_and_dropped() {
    for custom in [true, false] {
        let (mut engine, sid) = engine_with_section(custom);
        // Over the southern 60% of the line only.
        add_ride(&mut engine, "short", leg(-40, 120, PAST_STRICT));
        assert!(engine.rematch_activity_to_section("short", &sid).unwrap());

        // The northern 30 points start 555 m along from where the ride ends.
        let departed = engine.trim_section(&sid, 170, 199).unwrap();

        assert_eq!(departed, vec!["short".to_string()], "custom {custom}");
        assert!(rows(&engine, &sid, "short").is_empty());
        assert!(!is_forced(&engine, &sid, "short"));
    }
}

#[test]
fn an_excluded_forced_ride_stays_excluded_through_a_rebuild() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    assert!(engine.rematch_activity_to_section("wide", &sid).unwrap());
    engine.exclude_activity_from_section(&sid, "wide").unwrap();

    engine.trim_section(&sid, 20, 180).unwrap();

    let excluded: Vec<bool> = engine
        .db
        .prepare(
            "SELECT excluded FROM section_activities WHERE section_id = ? AND activity_id = 'wide'",
        )
        .unwrap()
        .query_map(params![sid], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(excluded, vec![true]);
}

#[test]
fn deleting_the_section_or_the_ride_deletes_the_record() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    add_ride(&mut engine, "other", ride(-PAST_STRICT));
    assert!(engine.rematch_activity_to_section("wide", &sid).unwrap());
    assert!(engine.rematch_activity_to_section("other", &sid).unwrap());

    engine.remove_activity("other").unwrap();
    assert!(!is_forced(&engine, &sid, "other"));
    assert!(is_forced(&engine, &sid, "wide"));

    engine.delete_section(&sid).unwrap();
    assert!(!is_forced(&engine, &sid, "wide"));
}

#[test]
fn a_merge_re_cuts_the_forced_rides_of_both_sections_onto_the_one_kept() {
    let (mut engine, primary) = engine_with_section(true);
    let donor_line = line()[20..180].to_vec();
    let donor = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: donor_line.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&donor_line),
            name: Some("Middle".into()),
            source_activity_id: Some("source".into()),
            start_index: Some(20),
            end_index: Some(179),
        })
        .unwrap();
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    assert!(engine.rematch_activity_to_section("wide", &donor).unwrap());

    engine.merge_user_sections(&primary, &donor).unwrap();

    assert_eq!(rows(&engine, &primary, "wide").len(), 1);
    assert!(is_forced(&engine, &primary, "wide"));
    assert!(!is_forced(&engine, &donor, "wide"));
}

#[test]
fn a_merge_names_the_forced_ride_that_has_no_pass_over_the_kept_line() {
    let (mut engine, donor) = engine_with_section(true);
    let kept_line = line()[160..190].to_vec();
    let primary = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: kept_line.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&kept_line),
            name: Some("Middle".into()),
            source_activity_id: Some("source".into()),
            start_index: Some(160),
            end_index: Some(189),
        })
        .unwrap();
    // Over the southern end only, a long way from the kept line.
    add_ride(&mut engine, "south", leg(-40, 110, PAST_STRICT));
    insert_metrics(&engine, "south", "South loop", 1_710_300_000);
    assert!(engine.rematch_activity_to_section("south", &donor).unwrap());

    let (kept, departed) = engine
        .merge_user_sections_reporting(&primary, &donor)
        .unwrap();

    assert_eq!(kept, primary);
    assert_eq!(departed, vec!["south".to_string()]);
    assert_eq!(
        engine.departed_rides(&departed),
        vec![("south".to_string(), "South loop".to_string(), 1_710_300_000)]
    );
    assert!(rows(&engine, &primary, "south").is_empty());
}

#[test]
fn departed_rides_carry_the_name_and_date_the_library_holds() {
    let (mut engine, _) = engine_with_section(false);
    add_ride(&mut engine, "gone", ride(0.0));
    insert_metrics(&engine, "gone", "Morning ride", 1_710_200_000);

    let rides = engine.departed_rides(&["gone".to_string(), "unknown".to_string()]);

    assert_eq!(
        rides,
        vec![(
            "gone".to_string(),
            "Morning ride".to_string(),
            1_710_200_000
        )]
    );
}

/// The scan offers what the force-match writes: one match per pass, at the
/// indices the attach stores.
#[test]
fn the_scan_offers_each_pass_the_force_match_writes() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "twice", out_and_back(PAST_STRICT));

    let offered: Vec<(u32, u32)> = engine
        .match_activity_to_sections("twice")
        .into_iter()
        .filter(|m| m.section_id == sid)
        .map(|m| (m.start_index, m.end_index))
        .collect();
    assert!(engine.rematch_activity_to_section("twice", &sid).unwrap());

    assert_eq!(offered, rows(&engine, &sid, "twice"));
}

/// Storing the ride again re-attaches it across the catalogue, and a section
/// it was attached to by hand keeps the rows the relaxed cut gave it rather
/// than the strict cut's, which start at other indices.
#[test]
fn re_attaching_a_forced_ride_keeps_its_forced_rows() {
    let (mut engine, sid) = engine_with_section(true);
    add_ride(&mut engine, "on", out_and_back(0.0));
    detach(&engine, &sid, "on");
    assert!(engine.rematch_activity_to_section("on", &sid).unwrap());
    let forced = rows(&engine, &sid, "on");

    engine.attach_stored_activity("on");

    assert_eq!(rows(&engine, &sid, "on"), forced);
}

/// An auto section on the line with the one ride that traced it, the way a
/// detection apply writes it.
fn detected_line() -> tracematch::FrequentSection {
    let polyline = line();
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    tracematch::FrequentSection {
        id: "auto-line".into(),
        name: None,
        sport_type: "Ride".into(),
        polyline: polyline.clone(),
        representative_activity_id: "source".into(),
        representative_range: None,
        activity_ids: vec!["source".into()],
        activity_portions: vec![tracematch::SectionPortion {
            activity_id: "source".into(),
            start_index: 0,
            end_index: POINTS as u32 - 1,
            distance_meters: distance,
            direction: tracematch::Direction::Same,
        }],
        visit_count: 1,
        distance_meters: distance,
        activity_traces: Default::default(),
        confidence: 0.8,
        observation_count: 1,
        average_spread: 10.0,
        point_density: vec![1; POINTS],
        scale: Some(tracematch::sections::ScaleName::Medium),
        is_user_defined: false,
        stability: 1.0,
        version: 1,
        updated_at: None,
        created_at: None,
        consensus_state: None,
        elevation_gain_m: None,
        avg_grade_percent: None,
        enrichment: Default::default(),
        rank: None,
    }
}

fn apply_detected_line(engine: &mut PersistentEngine) {
    engine.sections.retain(|s| s.is_user_defined);
    engine.sections.push(detected_line());
    engine.save_sections_with_events(&[]).unwrap();
}

#[test]
fn a_ride_forced_onto_an_auto_section_keeps_its_row_through_a_detection_apply() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    add_ride(&mut engine, "source", line());
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    apply_detected_line(&mut engine);
    assert!(rows(&engine, "auto-line", "wide").is_empty());
    assert!(
        engine
            .rematch_activity_to_section("wide", "auto-line")
            .unwrap()
    );
    let forced_rows = rows(&engine, "auto-line", "wide");
    assert_eq!(forced_rows.len(), 1);

    apply_detected_line(&mut engine);

    assert_eq!(rows(&engine, "auto-line", "wide"), forced_rows);
    assert!(is_forced(&engine, "auto-line", "wide"));
    assert_eq!(rows(&engine, "auto-line", "source").len(), 1);

    apply_detected_line(&mut engine);
    assert_eq!(rows(&engine, "auto-line", "wide"), forced_rows);
}

#[test]
fn an_excluded_forced_ride_stays_excluded_through_a_detection_apply() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    add_ride(&mut engine, "source", line());
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    apply_detected_line(&mut engine);
    assert!(
        engine
            .rematch_activity_to_section("wide", "auto-line")
            .unwrap()
    );
    engine
        .exclude_activity_from_section("auto-line", "wide")
        .unwrap();

    apply_detected_line(&mut engine);

    let excluded: Vec<bool> = engine
        .db
        .prepare("SELECT excluded FROM section_activities WHERE section_id = 'auto-line' AND activity_id = 'wide'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(excluded, vec![true]);
}

#[test]
fn a_force_match_on_a_section_the_apply_did_not_bring_back_waits() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    add_ride(&mut engine, "source", line());
    add_ride(&mut engine, "wide", ride(PAST_STRICT));
    apply_detected_line(&mut engine);
    assert!(
        engine
            .rematch_activity_to_section("wide", "auto-line")
            .unwrap()
    );

    engine.sections.retain(|s| s.is_user_defined);
    engine.save_sections_with_events(&[]).unwrap();
    assert!(is_forced(&engine, "auto-line", "wide"));

    apply_detected_line(&mut engine);
    assert_eq!(rows(&engine, "auto-line", "wide").len(), 1);
}
