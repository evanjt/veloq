//! Every section writer that changes which laps a section holds, or whether a
//! section is shown at all, leaves `activity_indicators` as a full recompute
//! would write it. The feed and the activity highlights read that table raw,
//! so a writer that skips the refresh shows a record chip for a section that
//! is gone or hidden, and misses the ride that now holds the record.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::sections::CreateSectionParams;

const POINTS: usize = 200;
const STEP_DEG: f64 = 0.0001;
const LAT: f64 = 46.2;
const LNG: f64 = 7.3;

/// The three timed rides, oldest first, with the seconds each takes per point.
const RIDES: [(&str, u32, i64); 3] = [
    ("steady", 3, 1_700_000_000),
    ("tempo", 2, 1_700_500_000),
    ("sprint", 1, 1_701_000_000),
];

/// A straight line north, about 2.2 km, one point every 11 m.
fn line() -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

/// The points a ride covers before it reaches the line.
const LEAD_IN: u32 = 40;

/// One pass along the whole line, with ground before and after it.
fn ride() -> Vec<GpsPoint> {
    let lead_in = i64::from(LEAD_IN);
    (-lead_in..POINTS as i64 + lead_in)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

/// An auto section on the line holding the source and the timed rides, the
/// way a detection apply writes it.
fn detected_line() -> tracematch::FrequentSection {
    let polyline = line();
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    let portion = |id: &str, start: u32| tracematch::SectionPortion {
        activity_id: id.into(),
        start_index: start,
        end_index: start + POINTS as u32 - 1,
        distance_meters: distance,
        direction: tracematch::Direction::Same,
    };
    let mut activity_portions = vec![portion("source", 0)];
    activity_portions.extend(RIDES.iter().map(|(id, _, _)| portion(id, LEAD_IN)));
    tracematch::FrequentSection {
        id: "auto-line".into(),
        name: None,
        sport_type: "Ride".into(),
        polyline: polyline.clone(),
        representative_activity_id: "source".into(),
        representative_range: None,
        activity_ids: activity_portions
            .iter()
            .map(|p| p.activity_id.clone())
            .collect(),
        activity_portions,
        visit_count: 4,
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

/// A library of the source ride and the three timed rides, with the line as
/// an auto section first when `detected`, and badges computed from scratch.
fn library(detected: bool) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activity("source".into(), line(), "Ride".into())
        .unwrap();
    let track = ride();
    let mut ids = Vec::new();
    let mut times = Vec::new();
    let mut offsets = Vec::new();
    for (id, seconds_per_point, date) in RIDES {
        engine
            .add_activity(id.into(), track.clone(), "Ride".into())
            .unwrap();
        engine
            .db
            .execute(
                "UPDATE activities SET start_date = ? WHERE id = ?",
                params![date, id],
            )
            .unwrap();
        ids.push(id.to_string());
        offsets.push(times.len() as u32);
        times.extend((0..track.len() as u32).map(|i| i * seconds_per_point));
    }
    engine.set_time_streams_flat(&ids, &times, &offsets);
    if detected {
        engine.sections.retain(|s| s.is_user_defined);
        engine.sections.push(detected_line().into());
        engine.save_sections_with_events(&[]).unwrap();
    }
    engine.recompute_activity_indicators().unwrap();
    engine
}

fn custom(engine: &mut PersistentEngine, name: &str, start: usize, end: usize) -> String {
    let polyline = line()[start..=end].to_vec();
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some(name.into()),
            source_activity_id: Some("source".into()),
            start_index: Some(start as u32),
            end_index: Some(end as u32),
        })
        .unwrap()
}

fn detach(engine: &mut PersistentEngine, section_id: &str, activity_id: &str) {
    engine
        .db
        .execute(
            "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
            params![section_id, activity_id],
        )
        .unwrap();
    engine.recompute_activity_indicators().unwrap();
}

type Badge = (String, String, String, String, String, i64, i64);

/// Every stored badge, without the moment it was computed.
fn badges(engine: &PersistentEngine) -> Vec<Badge> {
    engine
        .db
        .prepare(
            "SELECT activity_id, indicator_type, target_id, target_name, direction,
                    CAST(ROUND(lap_time * 1000) AS INTEGER), trend
             FROM activity_indicators
             ORDER BY activity_id, indicator_type, target_id, direction",
        )
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn badges_on(engine: &PersistentEngine, section_id: &str) -> Vec<Badge> {
    badges(engine)
        .into_iter()
        .filter(|b| b.2 == section_id)
        .collect()
}

fn record_holder(engine: &PersistentEngine, section_id: &str) -> Vec<String> {
    badges_on(engine, section_id)
        .into_iter()
        .filter(|b| b.1 == "section_pr")
        .map(|b| b.0)
        .collect()
}

/// The table as the writer left it is the table a full recompute writes.
fn assert_current(engine: &PersistentEngine, after: &str) {
    let left = badges(engine);
    engine.recompute_activity_indicators().unwrap();
    assert_eq!(left, badges(engine), "stale badges after {after}");
}

#[test]
fn a_merge_moves_the_record_onto_the_kept_section_and_drops_the_donors_badges() {
    let mut engine = library(false);
    let kept = custom(&mut engine, "Long straight", 0, POINTS - 1);
    let donor = custom(&mut engine, "Middle", 20, 179);
    detach(&mut engine, &kept, "sprint");
    assert_eq!(record_holder(&engine, &kept), vec!["tempo"]);
    assert_eq!(record_holder(&engine, &donor), vec!["sprint"]);

    engine.merge_user_sections(&kept, &donor).unwrap();

    assert!(badges_on(&engine, &donor).is_empty());
    assert_eq!(record_holder(&engine, &kept), vec!["sprint"]);
    assert_current(&engine, "a merge");
}

#[test]
fn a_merge_gives_back_the_badges_of_a_section_the_donor_had_superseded() {
    let mut engine = library(true);
    let donor = custom(&mut engine, "Long straight", 0, POINTS - 1);
    let kept = custom(&mut engine, "Short middle", 60, 140);
    assert!(badges_on(&engine, "auto-line").is_empty());

    engine.merge_user_sections(&kept, &donor).unwrap();

    assert_eq!(record_holder(&engine, "auto-line"), vec!["sprint"]);
    assert_current(&engine, "a merge that frees a superseded section");
}

#[test]
fn disabling_a_section_drops_its_badges_and_enabling_it_brings_them_back() {
    let mut engine = library(false);
    let sid = custom(&mut engine, "Long straight", 0, POINTS - 1);
    let earned = badges_on(&engine, &sid);
    assert!(!earned.is_empty());

    engine.disable_section(&sid).unwrap();

    assert!(badges_on(&engine, &sid).is_empty());
    assert_current(&engine, "a disable");

    engine.enable_section(&sid).unwrap();

    assert_eq!(badges_on(&engine, &sid), earned);
    assert_current(&engine, "an enable");
}

#[test]
fn a_forced_rematch_of_a_faster_ride_takes_the_record() {
    let mut engine = library(false);
    let sid = custom(&mut engine, "Long straight", 0, POINTS - 1);
    detach(&mut engine, &sid, "sprint");
    assert_eq!(record_holder(&engine, &sid), vec!["tempo"]);

    assert!(engine.rematch_activity_to_section("sprint", &sid).unwrap());

    assert_eq!(record_holder(&engine, &sid), vec!["sprint"]);
    assert_current(&engine, "a forced rematch");
}

#[test]
fn a_custom_section_that_supersedes_an_auto_one_takes_its_badges_until_deleted() {
    let mut engine = library(true);
    let earned = badges_on(&engine, "auto-line");
    assert!(!earned.is_empty());

    let sid = custom(&mut engine, "Long straight", 0, POINTS - 1);

    assert!(badges_on(&engine, "auto-line").is_empty());
    assert_current(&engine, "a create that supersedes");

    engine.delete_section(&sid).unwrap();

    assert_eq!(badges_on(&engine, "auto-line"), earned);
    assert_current(&engine, "a delete that restores");
}
