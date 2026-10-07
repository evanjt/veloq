//! Contract tests for the per-screen data bundles.
//!
//! Each bundle replaces a fan-out of individual engine reads, so every test
//! here asserts the bundle field-for-field against the calls it replaced on a
//! fixture dataset. A drift between the two is the failure mode these guard.
//!
//! Strategy follows `encounters.rs`: a real `PersistentEngine` (so
//! migrations run) with fixtures written through a parallel rusqlite
//! connection, plus GPS tracks added through the engine API so trace
//! extraction has something to work on.
//!
//! Run: `cargo test --test app -p veloqrs -- screen_bundles::`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();

    let engine = PersistentEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");

    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

/// A straight west-to-east line of `count` points, one every ~11m.
fn line(start_lat: f64, start_lng: f64, count: usize) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| GpsPoint::new(start_lat, start_lng + (i as f64) * 0.0001))
        .collect()
}

fn insert_section(
    db: &Connection,
    id: &str,
    section_type: &str,
    name: &str,
    polyline: &[GpsPoint],
    source_activity_id: Option<&str>,
) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version, source_activity_id)
         VALUES (?1, ?2, ?3, 'Ride', ?4, 800.0, 0, 1, ?5)",
        params![
            id,
            section_type,
            name,
            serde_json::to_string(polyline).expect("encode polyline"),
            source_activity_id
        ],
    )
    .expect("insert section");
}

fn insert_traversal(db: &Connection, section_id: &str, activity_id: &str, lap_time_s: f64) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, 'same', 0, 40, 800.0, ?3, ?4, 0)",
        params![section_id, activity_id, lap_time_s, 800.0 / lap_time_s],
    )
    .expect("insert traversal");
}

fn metrics(id: &str, date: i64) -> veloqrs::FfiActivityMetrics {
    veloqrs::FfiActivityMetrics {
        activity_id: id.to_string(),
        name: format!("Fixture {}", id),
        date: date as f64,
        distance: 1000.0,
        moving_time: 300,
        elapsed_time: 300,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

/// Two activities over the same line, one auto section and one custom section
/// on top of it, with a faster and a slower traversal of each.
fn populated() -> Setup {
    let mut s = setup();
    let track = line(46.2, 7.35, 60);

    s.engine
        .add_activity("a1".to_string(), track.clone(), "Ride".to_string())
        .expect("add a1");
    s.engine
        .add_activity("a2".to_string(), track.clone(), "Ride".to_string())
        .expect("add a2");
    s.engine
        .set_activity_metrics_extended(vec![
            metrics("a1", 1_700_000_000),
            metrics("a2", 1_700_086_400),
        ])
        .expect("set metrics");

    let polyline = line(46.2, 7.35, 30);
    insert_section(&s.raw, "auto1", "auto", "Auto Climb", &polyline, None);
    insert_section(
        &s.raw,
        "cust1",
        "custom",
        "My Portion",
        &polyline,
        Some("a1"),
    );

    insert_traversal(&s.raw, "auto1", "a1", 200.0);
    insert_traversal(&s.raw, "auto1", "a2", 240.0);
    insert_traversal(&s.raw, "cust1", "a1", 210.0);

    s
}

#[test]
fn insights_trend_rows_outlive_the_ranked_display_limit() {
    let _serial_state = crate::serial_state();
    let mut s = setup();
    let track = line(46.2, 7.35, 60);
    let now = 1_700_200_000;
    let ages = [40, 39, 38, 3, 2, 1];
    for (index, age) in ages.into_iter().enumerate() {
        let id = format!("effort-{index}");
        s.engine
            .add_activity(id.clone(), track.clone(), "Ride".to_string())
            .expect("add activity");
        s.engine
            .set_activity_metrics_extended(vec![metrics(&id, now - age * 86_400)])
            .expect("set metrics");
    }
    let polyline = line(46.2, 7.35, 30);
    for index in 0..7 {
        let id = format!("climb-{index}");
        insert_section(&s.raw, &id, "custom", &id, &polyline, None);
        let times = if index < 5 {
            [100.0, 200.0, 190.0, 150.0, 140.0, 160.0]
        } else {
            [100.0, 140.0, 150.0, 190.0, 200.0, 210.0]
        };
        for (effort, time) in times.into_iter().enumerate() {
            insert_traversal(&s.raw, &id, &format!("effort-{effort}"), time);
        }
    }

    let mut p = insights_params();
    p.ranked_limit = 2;
    p.active_window_days = u32::MAX;
    p.current_end = now as f64;
    p.current_start = (now - 7 * 86_400) as f64;
    p.today_start = (now - 86_400) as f64;
    let bundle = s.engine.insights_data(&p);
    let rows: Vec<_> = bundle
        .trend_sections
        .iter()
        .flat_map(|batch| &batch.sections)
        .filter(|section| section.section_id.starts_with("climb-"))
        .collect();
    assert_eq!(rows.len(), 7);
    assert_eq!(rows.iter().filter(|row| row.trend > 0).count(), 5);
    assert_eq!(rows.iter().filter(|row| row.trend < 0).count(), 2);
    assert!(
        bundle
            .ranked_sections
            .iter()
            .all(|batch| batch.sections.len() <= 2)
    );
    assert_eq!(bundle.trend_faster_count + bundle.trend_slower_count, 7);
}

// ============================================================================
// Activity detail
// ============================================================================

#[test]
fn activity_detail_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    assert_eq!(bundle.activity_count, s.engine.activity_count() as u32);
    assert_eq!(bundle.section_count, s.engine.get_section_count());

    let matched: Vec<String> = s
        .engine
        .get_sections_for_activity("a1")
        .into_iter()
        .map(|sec| sec.id)
        .collect();
    let bundled_matched: Vec<String> = bundle
        .matched_sections
        .iter()
        .map(|sec| sec.id.clone())
        .collect();
    assert_eq!(bundled_matched, matched);
    assert!(matched.contains(&"auto1".to_string()));

    // The bundle carries the custom sections that name this activity and are
    // not already in `matched_sections`, not the whole custom catalogue. That
    // is the filter the screen ran on the far side of the FFI call, and it is
    // what stops the payload growing with the library.
    let bundled_custom: Vec<String> = bundle
        .custom_sections
        .iter()
        .map(|sec| sec.id.clone())
        .collect();
    let expected_custom: Vec<String> = s
        .engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .filter(|sec| {
            sec.source_activity_id.as_deref() == Some("a1")
                || sec.activity_ids.iter().any(|a| a == "a1")
        })
        .map(|sec| sec.id)
        .filter(|id| !matched.contains(id))
        .collect();
    assert_eq!(bundled_custom, expected_custom);
    assert!(
        bundle.custom_sections.iter().all(|sec| {
            sec.source_activity_id.as_deref() == Some("a1")
                || sec.activity_ids.iter().any(|a| a == "a1")
        }),
        "a custom section that does not name this activity reached the screen"
    );

    let encounters = s.engine.get_activity_section_encounters("a1");
    assert_eq!(bundle.encounters.len(), encounters.len());
    for (bundled, direct) in bundle.encounters.iter().zip(encounters.iter()) {
        assert_eq!(bundled.section_id, direct.section_id);
        assert_eq!(bundled.lap_time, direct.lap_time);
        assert_eq!(bundled.is_pr, direct.is_pr);
    }

    let ids = ["a1".to_string()];
    assert_eq!(
        bundle.highlights.indicators.len(),
        s.engine.get_activity_indicators(&ids).len()
    );
    assert_eq!(
        bundle.highlights.route_highlights.len(),
        s.engine.get_activity_route_highlights(&ids).len()
    );
}

/// Scenario: the detail screen opens on an activity that traverses a section
/// with members.
///
/// Expected behaviour: the record carries the member count and the line, not
/// the member list. The screen never reads the ids, and an activity crossing
/// thirty sections lifted several hundred id strings across JSI on the mount.
#[test]
fn activity_detail_sends_the_member_count_and_not_the_member_list() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    let auto = bundle
        .matched_sections
        .iter()
        .find(|sec| sec.id == "auto1")
        .expect("auto1 is matched");
    let members = s
        .engine
        .get_section_by_id("auto1")
        .expect("section")
        .activity_ids
        .len() as u32;

    assert!(members > 0, "the fixture section has members to count");
    assert_eq!(auto.activity_count, members);
    assert!(!auto.encoded_polyline.is_empty(), "the line still rides");
    assert_eq!(auto.sport_types, vec!["Ride"]);
    assert!(auto.bounds.is_some(), "the line's own extent");
}

#[test]
fn activity_detail_traces_match_per_section_extraction() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    // Both sections lie on a1's track, so both must produce a trace.
    let traced: Vec<&str> = bundle
        .section_traces
        .iter()
        .map(|t| t.section_id.as_str())
        .collect();
    assert!(traced.contains(&"auto1"));
    assert!(traced.contains(&"cust1"));

    let track = s.engine.get_gps_track("a1").expect("track");
    for trace in &bundle.section_traces {
        let polyline = s
            .engine
            .get_section_by_id(&trace.section_id)
            .expect("section")
            .polyline;
        let tree = tracematch::sections::build_rtree(&polyline);
        let expected = tracematch::sections::extract_activity_trace(&track, &polyline, &tree);
        assert_eq!(
            trace.encoded_coords,
            veloqrs::persistence::codec::encode_polyline(&expected),
            "trace for {} drifted from per-section extraction",
            trace.section_id
        );
    }
}

#[test]
fn test_activity_detail_pr_sections_require_a_rival() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);
    assert_eq!(bundle.pr_section_ids, vec!["auto1"]);
    assert!(!bundle.pr_section_ids.contains(&"cust1".to_string()));
}

#[test]
fn test_activity_detail_first_reverse_section_outing_has_no_pr() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    s.raw
        .execute(
            "UPDATE section_activities SET direction = 'reverse', lap_time = 150.0 WHERE section_id = 'auto1' AND activity_id = 'a3'",
            [],
        )
        .unwrap();
    let bundle = s.engine.activity_detail_data("a3", 2);
    assert!(!bundle.pr_section_ids.contains(&"auto1".to_string()));
    let forward = s.engine.activity_detail_data("a1", 2);
    assert!(forward.pr_section_ids.contains(&"auto1".to_string()));
}

#[test]
fn test_section_record_out_and_back_keeps_each_direction() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.raw
        .execute(
            "INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
             VALUES ('auto1', 'a1', 'reverse', 41, 59, 800.0, 150.0, 5.333333, 0)",
            [],
        )
        .unwrap();
    let result = s.engine.get_section_performances("auto1");
    let out_and_back = result
        .records
        .iter()
        .find(|r| r.activity_id == "a1")
        .unwrap();
    assert_eq!(out_and_back.best_time, 200.0);
    assert_eq!(out_and_back.direction, "same");
    assert_eq!(
        result.best_reverse_record.as_ref().unwrap().best_time,
        150.0
    );
}

#[test]
fn activity_detail_route_groups_honour_the_minimum() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    assert!(
        bundle
            .route_groups
            .iter()
            .all(|g| g.activity_ids.len() >= 2),
        "groups below the minimum must not be returned"
    );
}

/// The screen asks one question of this list, which group holds this activity,
/// so the catalogue is what it had to search rather than what it needed. A
/// bundle that hands over the whole of it grows with the library on the mount
/// path of every activity opened.
#[test]
fn activity_detail_carries_only_the_group_this_activity_is_in() {
    let _serial_state = crate::serial_state();
    let s = populated();
    for (id, rep, members) in [
        ("g_with_a1", "a1", r#"["a1","a2"]"#),
        ("g_without_a1", "x1", r#"["x1","x2","x3"]"#),
    ] {
        s.raw
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES (?1, ?2, ?3, 'Ride')",
                params![id, rep, members],
            )
            .expect("insert group");
    }
    // A minimum of one, so every group in the fixture qualifies and the
    // narrowing is what removes the one this activity is not in.
    let bundle = s.engine.activity_detail_data("a1", 1);

    assert_eq!(
        bundle
            .route_groups
            .iter()
            .map(|g| g.group_id.as_str())
            .collect::<Vec<_>>(),
        vec!["g_with_a1"],
        "only the group holding this activity reaches the screen"
    );
}

/// An activity in no group at all, which is the case the narrowing could turn
/// into a group picked by position rather than by membership.
#[test]
fn activity_detail_carries_no_group_for_an_activity_in_none() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.activity_detail_data("a1", 1_000);

    assert!(
        bundle.route_groups.is_empty(),
        "no group meets the minimum, so none may be returned"
    );
}

// ============================================================================
// Map tab
// ============================================================================

#[test]
fn map_screen_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let start = 1_600_000_000;
    let end = 1_800_000_000;
    let bundle = s.engine.map_screen_data(
        start,
        end,
        Vec::new(),
        veloqrs::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );

    assert_eq!(bundle.activity_count, 2, "the library counts metrics rows");
    assert_eq!(
        bundle.available_sport_types,
        s.engine.get_available_sport_types()
    );

    let direct = s.engine.map_activities_filtered(start, end);
    assert_eq!(bundle.activities.len(), direct.len());
    assert_eq!(bundle.activities.len(), 2);
}

/// The marker wants the start of the ride, and the page used to place every
/// marker on its bounds centre and then move all of them once the signatures
/// finished loading. Carrying the start here is what removes the second upload.
#[test]
fn map_screen_carries_the_start_point_for_each_marker() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.map_screen_data(
        1_600_000_000,
        1_800_000_000,
        Vec::new(),
        veloqrs::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );

    assert_eq!(bundle.activities.len(), 2);
    for activity in &bundle.activities {
        let lat = activity
            .start_lat
            .unwrap_or_else(|| panic!("{} has no start latitude", activity.activity_id));
        let lng = activity
            .start_lng
            .unwrap_or_else(|| panic!("{} has no start longitude", activity.activity_id));
        // `line(46.2, 7.35, 60)` starts where it says it does.
        assert!((lat - 46.2).abs() < 1e-6, "start latitude was {lat}");
        assert!((lng - 7.35).abs() < 1e-6, "start longitude was {lng}");
        // The fixture runs due east, so longitude is the axis on which the start
        // and the bounding box centre differ. Without this the test would pass
        // just as well against the centre it is meant to replace.
        let centre_lng = (activity.bounds.min_lng + activity.bounds.max_lng) / 2.0;
        assert!(
            (lng - centre_lng).abs() > 1e-9,
            "the start must not be the bounds centre, or the test proves nothing"
        );
    }
}

/// A GPS activity with no metrics has no date or library row yet.
#[test]
fn map_screen_excludes_an_activity_with_no_metrics_from_library_total() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .add_activity("a3".to_string(), line(46.3, 7.4, 60), "Ride".to_string())
        .expect("add a3");

    let bundle = s.engine.map_screen_data(
        1_600_000_000,
        1_800_000_000,
        Vec::new(),
        veloqrs::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );

    assert_eq!(bundle.activity_count, 2, "the library counts metrics rows");
    assert!(
        !bundle.activities.iter().any(|a| a.activity_id == "a3"),
        "an activity with no metrics row has no date and cannot be in the window"
    );
}

/// The window comes back newest first and in one order every time, so the map
/// draws the same stack on every read rather than whichever order a hash gave.
#[test]
fn map_screen_returns_the_window_newest_first() {
    let _serial_state = crate::serial_state();
    let s = populated();

    let dates: Vec<f64> = s
        .engine
        .map_screen_data(
            1_600_000_000,
            1_800_000_000,
            Vec::new(),
            veloqrs::MapDistanceBand::All,
            true,
            false,
            false,
            String::new(),
        )
        .activities
        .iter()
        .map(|a| a.date)
        .collect();

    assert_eq!(dates, vec![1_700_086_400.0, 1_700_000_000.0]);
}

/// An activity with no signature yet has no start to give, and says so rather
/// than answering with a coordinate nothing measured.
#[test]
fn map_screen_leaves_the_start_absent_when_there_is_no_signature() {
    let _serial_state = crate::serial_state();
    let mut s = setup();
    s.engine
        .add_activity("no_gps".to_string(), Vec::new(), "Ride".to_string())
        .ok();
    s.engine
        .set_activity_metrics_extended(vec![metrics("no_gps", 1_700_000_000)])
        .expect("set metrics");

    for activity in s
        .engine
        .map_screen_data(
            1_600_000_000,
            1_800_000_000,
            Vec::new(),
            veloqrs::MapDistanceBand::All,
            true,
            false,
            false,
            String::new(),
        )
        .activities
    {
        if activity.activity_id == "no_gps" {
            assert!(activity.start_lat.is_none());
            assert!(activity.start_lng.is_none());
        }
    }
}

#[test]
fn map_screen_honours_the_sport_filter() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let start = 1_600_000_000;
    let end = 1_800_000_000;

    let rides = s.engine.map_screen_data(
        start,
        end,
        vec!["Ride".to_string()],
        veloqrs::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );
    assert_eq!(rides.activities.len(), 2);

    let runs = s.engine.map_screen_data(
        start,
        end,
        vec!["Run".to_string()],
        veloqrs::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );
    assert!(runs.activities.is_empty());
    // The unfiltered total is still reported so the chips can show it.
    assert_eq!(runs.activity_count, 2);
}

#[test]
fn map_screen_name_needle_narrows_the_activities_but_not_the_chip_counts() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let read = |needle: &str| {
        s.engine.map_screen_data(
            1_600_000_000,
            1_800_000_000,
            Vec::new(),
            veloqrs::MapDistanceBand::All,
            true,
            false,
            false,
            needle.to_string(),
        )
    };

    let one = read("  FIXTURE A2 ");
    let ids: Vec<&str> = one
        .activities
        .iter()
        .map(|a| a.activity_id.as_str())
        .collect();
    assert_eq!(ids, vec!["a2"], "case and surrounding space do not matter");
    assert_eq!(one.activity_count, 2);
    let whole: u32 = read("").category_counts.iter().map(|c| c.count).sum();
    let counted: u32 = one.category_counts.iter().map(|c| c.count).sum();
    assert_eq!(counted, whole, "chips count the window, before the needle");

    assert_eq!(read("fixture").activities.len(), 2);
    assert_eq!(
        read("   ").activities.len(),
        2,
        "a blank needle matches all"
    );
    assert!(read("no such ride").activities.is_empty());
}

// ============================================================================
// Map sections
// ============================================================================

/// The regional map reads six fields and draws a line. Its old read carried the
/// activity ids, one portion record per traversal and the point density for
/// every section, and threw all of it away.
#[test]
fn map_sections_carry_the_line_and_the_six_fields_the_map_draws_with() {
    let _serial_state = crate::serial_state();
    let s = populated();

    let sections = s.engine.get_map_sections(None, None);

    assert_eq!(sections.len(), 2, "both fixture sections are visible");
    for section in &sections {
        assert!(!section.id.is_empty());
        assert_eq!(section.sport_types, vec!["Ride"]);
        assert!(section.distance_meters >= 0.0);
        assert!(
            !section.encoded_polyline.is_empty(),
            "{} came back with no line to draw",
            section.id
        );
    }
    // The custom section's own name is carried rather than looked up again.
    assert!(
        sections
            .iter()
            .any(|x| x.name.as_deref() == Some("My Portion")),
        "the named section kept its name"
    );
}

#[test]
fn map_sections_honour_the_sport_and_visit_filters() {
    let _serial_state = crate::serial_state();
    let s = populated();

    assert_eq!(s.engine.get_map_sections(Some("Ride"), None).len(), 2);
    assert!(s.engine.get_map_sections(Some("Run"), None).is_empty());
    // Both fixture sections are traversed fewer than a hundred times.
    assert!(s.engine.get_map_sections(None, Some(100)).is_empty());
}

/// Scenario: detection left `auto1` labelled Run, but every outing that takes
/// it is a ride.
/// Expected behaviour: no read lists it under Run, and every read lists it
/// under Ride. The sports that took the ground decide, never the label.
#[test]
fn a_section_is_listed_under_the_sports_that_took_it_and_not_its_label() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "UPDATE sections SET sport_type = 'Run' WHERE id = 'auto1'",
            [],
        )
        .expect("relabel");

    let has_auto1 = |ids: Vec<String>| ids.iter().any(|id| id == "auto1");
    let map = |sport| {
        s.engine
            .get_map_sections(Some(sport), None)
            .into_iter()
            .map(|x| x.id)
            .collect::<Vec<_>>()
    };
    let catalogue = |sport| {
        s.engine
            .get_sections_filtered(Some(sport), None)
            .into_iter()
            .map(|x| x.id)
            .collect::<Vec<_>>()
    };
    let summaries = |sport| {
        s.engine
            .get_section_summaries_for_sport(sport)
            .into_iter()
            .map(|x| x.id)
            .collect::<Vec<_>>()
    };

    assert!(
        !has_auto1(map("Run")),
        "the map listed a ride-only section under Run"
    );
    assert!(
        !has_auto1(catalogue("Run")),
        "the catalogue listed it under Run"
    );
    assert!(
        !has_auto1(summaries("Run")),
        "the summaries listed it under Run"
    );
    assert!(has_auto1(map("Ride")));
    assert!(has_auto1(catalogue("Ride")));
    assert!(has_auto1(summaries("Ride")));
}

/// Scenario: `auto1` is ridden twice and run once, and detection labelled it
/// Run. `cust1` beside it is only ridden.
/// Expected behaviour: every record that crosses to the screens carries both
/// sports, and the ridden neighbour finds it as nearby and as a merge
/// candidate whatever its label says.
#[test]
fn every_section_record_carries_each_sport_that_took_it() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .add_activity("a3".to_string(), line(46.2, 7.35, 60), "Run".to_string())
        .expect("add a3");
    s.engine
        .set_activity_metrics_extended(vec![veloqrs::FfiActivityMetrics {
            sport_type: "Run".to_string(),
            ..metrics("a3", 1_700_172_800)
        }])
        .expect("set metrics");
    insert_traversal(&s.raw, "auto1", "a3", 300.0);
    s.raw
        .execute_batch(
            "UPDATE sections SET sport_type = 'Run' WHERE id = 'auto1';
             UPDATE sections SET bounds_min_lat = 46.2, bounds_max_lat = 46.2,
                    bounds_min_lng = 7.35, bounds_max_lng = 7.36
             WHERE id IN ('auto1', 'cust1');",
        )
        .expect("label and bounds");
    let both = vec!["Ride".to_string(), "Run".to_string()];

    let map = s.engine.get_map_sections(None, None);
    let on_map = map.iter().find(|x| x.id == "auto1").expect("on the map");
    assert_eq!(on_map.sport_types, both);

    let record = veloqrs::FfiSection::from(s.engine.get_section("auto1").expect("by id"));
    assert_eq!(record.sport_types, both);

    let summary = s.engine.get_section_summaries();
    let listed = summary.iter().find(|x| x.id == "auto1").expect("listed");
    assert_eq!(listed.sport_types, both);

    let candidates = s.engine.get_merge_candidates("cust1");
    let candidate = candidates
        .iter()
        .find(|x| x.section_id == "auto1")
        .expect("a merge candidate");
    assert_eq!(candidate.sport_types, both);
}

/// The light read answers from the `sections` table, so its fields are compared
/// against the summaries read of that same table. `get_sections_filtered`, the
/// call the map used to make, answers from the in-memory catalogue, which these
/// fixtures never populate: they are written through a parallel connection.
#[test]
fn map_sections_agree_with_the_summaries_of_the_same_rows() {
    let _serial_state = crate::serial_state();
    let s = populated();

    let light = s.engine.get_map_sections(None, None);
    let summaries = s.engine.get_section_summaries();

    assert_eq!(light.len(), summaries.len());
    for section in &light {
        let same = summaries
            .iter()
            .find(|x| x.id == section.id)
            .unwrap_or_else(|| panic!("{} is missing from the summaries", section.id));
        assert_eq!(section.sport_types, same.sport_types);
        assert_eq!(section.visit_count, same.visit_count);
        assert_eq!(section.klass, same.klass);
        assert_eq!(section.max_grade_percent, same.max_grade_percent);
        assert!((section.distance_meters - same.distance_meters).abs() < 1e-9);
    }
}

/// The floor counts outings and a pin exempts it, which is the rule
/// `get_sections_filtered` applies. Counting traversals instead would admit a
/// road ridden ten times in one outing to a list with a floor of two.
#[test]
fn map_sections_count_outings_for_the_floor_not_passes() {
    let _serial_state = crate::serial_state();
    let s = populated();

    // `cust1` is traversed once by a1; `auto1` by a1 and a2.
    let two_outings = s.engine.get_map_sections(None, Some(2));

    assert!(two_outings.iter().any(|x| x.id == "auto1"));
    assert!(
        !two_outings.iter().any(|x| x.id == "cust1"),
        "one outing cannot meet a floor of two"
    );
}

#[test]
fn map_sections_are_nothing_at_all_for_an_empty_catalogue() {
    let _serial_state = crate::serial_state();
    let s = setup();
    assert!(s.engine.get_map_sections(None, None).is_empty());
}

// ============================================================================
// Widget snapshot
// ============================================================================

#[test]
fn widget_snapshot_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let now = 1_700_200_000;
    let bundle = s.engine.widget_snapshot_data(
        now - 7 * 86_400,
        now,
        now - 14 * 86_400,
        now - 7 * 86_400,
        30,
        // The widget's own point budget, so the track crosses at the cap.
        150,
    );

    assert_eq!(
        bundle.summary.current_week.count,
        s.engine.get_period_stats(now - 7 * 86_400, now).count
    );
    assert_eq!(
        bundle.summary.ftp_trend.latest_ftp,
        s.engine.get_ftp_trend().latest_ftp
    );

    // a2 is the newer of the two fixture activities.
    let latest = bundle.latest.expect("a latest activity");
    assert_eq!(latest.activity_id, "a2");

    let expected_gps: Vec<(f64, f64)> = s
        .engine
        .get_gps_track("a2")
        .unwrap_or_default()
        .iter()
        .map(|p| (p.latitude, p.longitude))
        .collect();
    let bundled_gps: Vec<(f64, f64)> = bundle
        .latest_gps
        .iter()
        .map(|p| (p.latitude, p.longitude))
        .collect();
    assert_eq!(bundled_gps, expected_gps);
}

#[test]
fn widget_snapshot_latest_includes_an_activity_with_metrics_and_no_track() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .set_activity_metrics_extended(vec![metrics("indoor", 1_700_172_800)])
        .expect("set indoor metrics");
    let now = 1_700_200_000;
    let bundle = s.engine.widget_snapshot_data(
        now - 7 * 86_400,
        now,
        now - 14 * 86_400,
        now - 7 * 86_400,
        30,
        150,
    );

    let latest = bundle.latest.expect("a latest activity");
    assert_eq!(latest.activity_id, "indoor");
    assert!(bundle.latest_gps.is_empty());
}

#[test]
fn widget_snapshot_is_empty_without_activities() {
    let _serial_state = crate::serial_state();
    let s = setup();
    let now = 1_700_200_000;
    let bundle = s.engine.widget_snapshot_data(
        now - 7 * 86_400,
        now,
        now - 14 * 86_400,
        now - 7 * 86_400,
        30,
        // The widget's own point budget, so the track crosses at the cap.
        150,
    );

    assert!(bundle.latest.is_none());
    assert!(bundle.latest_gps.is_empty());
    assert!(!bundle.latest_is_pr);
    assert_eq!(bundle.summary.current_week.count, 0);
}

// ============================================================================
// Route detail
// ============================================================================

#[test]
fn route_detail_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    // Any group the engine holds; an unknown ID exercises the empty path below.
    let group_id = s
        .engine
        .get_groups()
        .first()
        .map(|g| g.group_id.clone())
        .unwrap_or_else(|| "no-group".to_string());

    let bundle = s.engine.route_detail_data(&group_id, None, 1);

    assert_eq!(bundle.activity_count, s.engine.activity_count() as u32);
    assert_eq!(bundle.route_names, s.engine.get_all_route_names());
    assert_eq!(
        bundle.excluded_activity_ids,
        s.engine.get_excluded_route_activity_ids(&group_id)
    );
    assert_eq!(
        bundle.group.as_ref().map(|g| g.group_id.clone()),
        Some(group_id.clone())
    );

    let direct = s.engine.get_route_performances(&group_id, None, None);
    assert_eq!(
        bundle.performances.performances.len(),
        direct.performances.len()
    );

    let expected_representative = s
        .engine
        .get_representative_route(&group_id)
        .map(|points| veloqrs::persistence::codec::encode_polyline(points.as_slice()))
        .unwrap_or_default();
    assert_eq!(bundle.encoded_representative, expected_representative);
}

#[test]
fn route_detail_honours_the_group_minimum() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.route_detail_data("no-group", None, 3);

    assert!(bundle.group.is_none());
    assert!(bundle.map_signatures.is_empty());
    assert!(bundle.groups.iter().all(|g| g.activity_ids.len() >= 3));
}

// ============================================================================
// Insights
// ============================================================================

fn insights_params() -> veloqrs::FfiInsightsParams {
    let now = 1_700_200_000;
    veloqrs::FfiInsightsParams {
        history_limit: 20,
        current_start: (now - 7 * 86_400) as f64,
        current_end: now as f64,
        prev_start: (now - 14 * 86_400) as f64,
        prev_end: (now - 7 * 86_400) as f64,
        chronic_start: (now - 35 * 86_400) as f64,
        today_start: (now - 86_400) as f64,
        include_sections: true,
        ranked_limit: 50,
        active_window_days: 90,
        efficiency_per_sport: 5,
        efficiency_min_hr_change_bpm: 1,
        efficiency_limit: 2,
        efficiency_min_efforts: 3,
        efficiency_declining_min_efforts: 5,
        strength_month: veloqrs::FfiTimestampRange {
            start_ts: (now - 28 * 86_400) as f64,
            end_ts: now as f64,
        },
        strength_weeks: vec![veloqrs::FfiTimestampRange {
            start_ts: (now - 7 * 86_400) as f64,
            end_ts: now as f64,
        }],
        wellness_oldest: "2026-01-01".to_string(),
        wellness_newest: "2026-12-31".to_string(),
        hrv_window_days: 7,
        section_change_window_days: 14,
        stale_threshold_days: 30,
        stale_min_gain_percent: 3.0,
        stale_max_opportunities: 3,
        stale_min_traversals: 1,
        recent_pr_window_days: 7,
        recent_pr_min_outings: 3,
    }
}

#[test]
fn insights_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let p = insights_params();
    let bundle = s.engine.insights_data(&p);

    assert_eq!(
        bundle.current_week.count,
        s.engine
            .get_period_stats(p.current_start as i64, p.current_end as i64)
            .count
    );
    assert_eq!(
        bundle.previous_week.count,
        s.engine
            .get_period_stats(p.prev_start as i64, p.prev_end as i64)
            .count
    );
    assert_eq!(bundle.section_count, s.engine.get_section_count());
    assert_eq!(
        bundle.ftp_trend.latest_ftp,
        s.engine.get_ftp_trend().latest_ftp
    );
    assert_eq!(
        bundle.has_strength_data,
        s.engine.get_strength_activity_count().unwrap_or(0) > 0
    );

    for batch in &bundle.ranked_sections {
        let direct = s
            .engine
            .get_ranked_sections(&batch.sport_type, p.ranked_limit);
        let bundled: Vec<&str> = batch
            .sections
            .iter()
            .map(|r| r.section_id.as_str())
            .collect();
        let expected: Vec<&str> = direct.iter().map(|r| r.section_id.as_str()).collect();
        assert_eq!(bundled, expected);
    }
}

/// Scenario: every insight card draws a graphic of its own history, and the
/// bundle carried a series for two of eight generators. The rest carried
/// summary numbers, so a card either drew nothing or the sheet behind it read
/// the engine again per open, which on eight cards at mount is eight reads on
/// the JS thread beside the heaviest screen read in the tree.
///
/// Expected behaviour: the series a card draws travels with the thing it
/// describes, oldest first and capped.
#[test]
fn insights_carries_a_history_series_for_each_card_that_draws_one() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let p = insights_params();
    let bundle = s.engine.insights_data(&p);

    // The ranked sections are the cards with the most to draw: the ranker
    // already holds every traversal to take its medians from.
    let ranked: Vec<&veloqrs::FfiRankedSection> = bundle
        .ranked_sections
        .iter()
        .flat_map(|batch| batch.sections.iter())
        .collect();
    assert!(!ranked.is_empty(), "the fixture holds ranked sections");
    for section in &ranked {
        assert!(
            !section.recent_efforts.is_empty(),
            "{} carries no efforts to draw",
            section.section_id
        );
        assert!(
            section
                .recent_efforts
                .windows(2)
                .all(|w| w[0].date <= w[1].date),
            "{} is not oldest first",
            section.section_id
        );
        assert!(
            section.recent_efforts.len() <= section.traversal_count as usize,
            "more points than traversals"
        );
    }

    // The chronic window one week at a time. Four totals that sum back to the
    // one the card names, because four weeks that fell steadily and four that
    // jumped once sum the same.
    assert_eq!(
        bundle.weekly_totals.len(),
        5,
        "four chronic weeks and the compared one"
    );
    let weekly: f64 = bundle.weekly_totals[..4]
        .iter()
        .map(|w| w.stats.total_duration)
        .sum();
    assert!(
        (weekly - bundle.chronic_period.total_duration).abs() < 1.0,
        "{weekly} over four weeks against {} over the window",
        bundle.chronic_period.total_duration
    );
}

/// The cap is the caller's, and it is honoured rather than advisory: the
/// graphic is a strip a few dozen pixels wide and the bridge is not free.
#[test]
fn insights_caps_the_history_a_card_carries() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let mut p = insights_params();
    p.history_limit = 1;

    let bundle = s.engine.insights_data(&p);

    for pr in &bundle.recent_prs {
        assert!(pr.recent_efforts.len() <= 1, "{}", pr.section_id);
    }
}

#[test]
fn insights_skips_sections_when_the_caller_opts_out() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let mut p = insights_params();
    p.include_sections = false;

    let bundle = s.engine.insights_data(&p);
    assert!(bundle.ranked_sections.is_empty());
    assert!(bundle.efficiency_trends.is_empty());
    // The count is still reported, so the caller can tell sections exist.
    assert_eq!(bundle.section_count, s.engine.get_section_count());
}

#[test]
fn insights_caps_the_efficiency_trends() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let mut p = insights_params();
    p.efficiency_limit = 1;

    let bundle = s.engine.insights_data(&p);
    assert!(bundle.efficiency_trends.len() <= 1);
    for trend in &bundle.efficiency_trends {
        assert_eq!(trend.direction, veloqrs::EfficiencyDirection::Improving);
        assert!(trend.effort_count >= p.efficiency_min_efforts);
    }
}

#[test]
fn insights_falls_back_to_the_engine_sport_types() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.insights_data(&insights_params());

    assert_eq!(bundle.sport_types, s.engine.get_available_sport_types());
}

/// `populated()` plus a third outing over the same line. A section earns a PR
/// slot only once three activities have travelled it.
fn populated_with_pr_candidate(third_date: i64) -> Setup {
    let mut s = populated();
    s.engine
        .add_activity("a3".to_string(), line(46.2, 7.35, 60), "Ride".to_string())
        .expect("add a3");
    s.engine
        .set_activity_metrics_extended(vec![metrics("a3", third_date)])
        .expect("set metrics a3");
    insert_traversal(&s.raw, "auto1", "a3", 190.0);
    s
}

/// Move the whole window so `end` is the call's present.
fn insights_params_ending(end: i64) -> veloqrs::FfiInsightsParams {
    let mut p = insights_params();
    p.current_end = end as f64;
    p.current_start = (end - 7 * 86_400) as f64;
    p.prev_start = (end - 14 * 86_400) as f64;
    p.prev_end = (end - 7 * 86_400) as f64;
    p.chronic_start = (end - 35 * 86_400) as f64;
    p.today_start = (end - 86_400) as f64;
    p
}

#[test]
fn insights_computes_no_performances_when_nothing_is_recent() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_100_000);
    let p = insights_params_ending(1_700_200_000 + 400 * 86_400);

    let bundle = s.engine.insights_data(&p);

    assert!(bundle.recent_prs.is_empty());
    assert_eq!(s.engine.performance_computations(), 0);
}

#[test]
fn insights_computes_performances_for_a_section_visited_this_week() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    let p = insights_params_ending(1_700_200_000);

    let bundle = s.engine.insights_data(&p);

    assert!(s.engine.performance_computations() > 0);
    assert_eq!(
        bundle
            .recent_prs
            .iter()
            .map(|pr| pr.section_id.as_str())
            .collect::<Vec<_>>(),
        vec!["auto1"]
    );
}

#[test]
fn test_insights_partial_laps_have_no_recent_record() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    s.raw
        .execute(
            "UPDATE section_activities SET direction = 'partial' WHERE section_id = 'auto1'",
            [],
        )
        .unwrap();
    let bundle = s
        .engine
        .insights_data(&insights_params_ending(1_700_200_000));
    assert!(bundle.recent_prs.is_empty());
}

#[test]
fn test_insights_first_reverse_outing_has_no_recent_record() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_850_000);
    s.raw
        .execute(
            "UPDATE section_activities SET direction = 'reverse', lap_time = 150.0 WHERE section_id = 'auto1' AND activity_id = 'a3'",
            [],
        )
        .unwrap();
    let bundle = s
        .engine
        .insights_data(&insights_params_ending(1_700_900_000));
    assert!(bundle.recent_prs.is_empty());
}

#[test]
fn test_insights_tied_best_has_no_recent_record() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    s.raw
        .execute(
            "UPDATE section_activities SET lap_time = 200.0 WHERE section_id = 'auto1' AND activity_id = 'a3'",
            [],
        )
        .unwrap();
    let bundle = s
        .engine
        .insights_data(&insights_params_ending(1_700_200_000));
    assert!(bundle.recent_prs.is_empty());
}

#[test]
fn insights_computes_performances_for_a_section_visited_on_the_window_edge() {
    let _serial_state = crate::serial_state();
    let end = 1_700_200_000;
    // The oldest date the seven-day window still holds.
    let s = populated_with_pr_candidate(end - 7 * 86_400);
    let p = insights_params_ending(end);

    let bundle = s.engine.insights_data(&p);

    assert!(s.engine.performance_computations() > 0);
    assert_eq!(bundle.recent_prs.len(), 1);
}

/// Scenario: a record set over three outings and one set over fifty are the
/// same claim to the insight ranker, because the row carries no count.
///
/// Expected behaviour: the PR carries the section's traversals, so the ranker
/// can weigh what the record stands on.
#[test]
fn a_recent_pr_carries_the_traversals_it_stands_on() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    let p = insights_params_ending(1_700_200_000);

    let bundle = s.engine.insights_data(&p);

    let pr = bundle
        .recent_prs
        .iter()
        .find(|pr| pr.section_id == "auto1")
        .expect("the section holds a recent record");
    assert!(
        pr.traversal_count >= 3,
        "a PR slot is earned by returning, so the count is at least the three \
         outings that earned it: {}",
        pr.traversal_count
    );
}

/// Scenario: the PR card names a section and draws nothing of it, so an
/// athlete reading a record on "section 6" has no picture of which stretch of
/// road that is without leaving the card.
///
/// Expected behaviour: the row carries the section's line, thinned to what a
/// thumbnail can draw, from the summary the loop already holds.
#[test]
fn a_recent_pr_carries_the_section_line_the_card_draws() {
    let _serial_state = crate::serial_state();
    let s = populated_with_pr_candidate(1_700_150_000);
    let p = insights_params_ending(1_700_200_000);

    let bundle = s.engine.insights_data(&p);

    let pr = bundle
        .recent_prs
        .iter()
        .find(|pr| pr.section_id == "auto1")
        .expect("the section holds a recent record");
    let points = veloqrs::persistence::codec::decode_polyline(&pr.encoded_polyline).unwrap();
    assert_eq!(points.len(), 30, "the section's own line, as inserted");
    assert!((points[0].latitude - 46.2).abs() < 1e-6, "{:?}", points[0]);
}

/// A thumbnail is 48 by 36 points, so a thousand-point line is a thousand
/// coordinates crossing the FFI on the slowest screen read to draw the same
/// forty pixels.
#[test]
fn a_long_section_line_is_thinned_to_what_a_thumbnail_draws() {
    let _serial_state = crate::serial_state();
    let mut s = setup();
    let track = line(46.2, 7.35, 600);
    for (id, date) in [
        ("a1", 1_700_000_000),
        ("a2", 1_700_086_400),
        ("a3", 1_700_150_000),
    ] {
        s.engine
            .add_activity(id.to_string(), track.clone(), "Ride".to_string())
            .expect("add activity");
        s.engine
            .set_activity_metrics_extended(vec![metrics(id, date)])
            .expect("set metrics");
    }
    insert_section(&s.raw, "auto1", "auto", "Long Climb", &track, None);
    insert_traversal(&s.raw, "auto1", "a1", 200.0);
    insert_traversal(&s.raw, "auto1", "a2", 240.0);
    insert_traversal(&s.raw, "auto1", "a3", 190.0);

    let bundle = s
        .engine
        .insights_data(&insights_params_ending(1_700_200_000));

    let pr = bundle
        .recent_prs
        .iter()
        .find(|pr| pr.section_id == "auto1")
        .expect("the section holds a recent record");
    let points = veloqrs::persistence::codec::decode_polyline(&pr.encoded_polyline).unwrap();
    assert!(
        (2..=64).contains(&points.len()),
        "thinned to a drawable count, got {}",
        points.len()
    );
    // The ends are what the start and finish markers sit on, so neither is
    // allowed to fall out of the thinning.
    let full = veloqrs::persistence::codec::decode_polyline(
        &veloqrs::persistence::codec::encode_polyline(&track),
    )
    .unwrap();
    assert!((points[0].latitude - full[0].latitude).abs() < 1e-6);
    assert!((points[points.len() - 1].latitude - full[full.len() - 1].latitude).abs() < 1e-6);
}

/// Scenario: a section ridden forty times and run three times. A run record
/// produces a card whose confidence stands on every sport's traversals and
/// whose icon is a bicycle, and the row names no sport at all.
///
/// Expected behaviour: the row carries the sport the record was set in, and
/// counts that sport's traversals rather than the section's.
#[test]
fn a_recent_pr_counts_its_own_sport_and_says_which() {
    let _serial_state = crate::serial_state();
    let mut s = setup();
    let track = line(46.2, 7.35, 60);
    // Four rides, then three runs, the newest of them inside the window so the
    // row kept for this section is the run's.
    let library = [
        ("r1", 1_699_000_000, "Ride"),
        ("r2", 1_699_100_000, "Ride"),
        ("r3", 1_699_200_000, "Ride"),
        ("r4", 1_699_300_000, "Ride"),
        ("n1", 1_700_000_000, "Run"),
        ("n2", 1_700_086_400, "Run"),
        ("n3", 1_700_150_000, "Run"),
    ];
    for (id, date, sport) in library {
        s.engine
            .add_activity(id.to_string(), track.clone(), sport.to_string())
            .expect("add activity");
        let mut m = metrics(id, date);
        m.sport_type = sport.to_string();
        s.engine
            .set_activity_metrics_extended(vec![m])
            .expect("set metrics");
    }
    insert_section(&s.raw, "auto1", "auto", "Shared Climb", &track, None);
    for (id, _, _) in library {
        insert_traversal(
            &s.raw,
            "auto1",
            id,
            if id == "n3" {
                290.0
            } else if id.starts_with('n') {
                300.0
            } else {
                200.0
            },
        );
    }

    let bundle = s
        .engine
        .insights_data(&insights_params_ending(1_700_200_000));

    let pr = bundle
        .recent_prs
        .iter()
        .find(|pr| pr.section_id == "auto1")
        .expect("the section holds a recent record");
    assert_eq!(pr.sport_type, "Run", "the sport the record was set in");
    assert_eq!(
        pr.traversal_count, 3,
        "the three runs the record stands on, not the seven outings on the section"
    );
}

#[test]
fn insights_computes_no_performances_on_an_empty_library() {
    let _serial_state = crate::serial_state();
    let s = setup();

    let bundle = s.engine.insights_data(&insights_params());

    assert!(bundle.recent_prs.is_empty());
    assert_eq!(s.engine.performance_computations(), 0);
}

// ============================================================================
// Insights: sport types
// ============================================================================

#[test]
fn insights_sport_types_match_across_repeated_reads() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let params = insights_params();

    let first = s.engine.insights_data(&params);
    let second = s.engine.insights_data(&params);

    assert_eq!(first.sport_types, s.engine.get_available_sport_types());
    assert_eq!(second.sport_types, first.sport_types);
}

// ============================================================================
// Startup
// ============================================================================

#[test]
fn startup_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let p = insights_params();
    let ids = vec!["a1".to_string(), "a2".to_string()];

    // Destructured exhaustively: the bundle carries these three fields and
    // nothing the feed does not paint.
    let veloqrs::FfiStartupData {
        summary_card,
        preview_tracks,
        sparklines,
        new_activity_ids,
    } = s.engine.startup_data(
        p.current_start as i64,
        p.current_end as i64,
        p.prev_start as i64,
        p.prev_end as i64,
        &ids,
        0,
    );

    assert!(new_activity_ids.is_empty(), "no marker, nothing rings");
    assert_eq!(
        sparklines.map(|s| s.fitness),
        s.engine
            .get_wellness_sparklines(30)
            .unwrap()
            .map(|s| s.fitness),
        "the bundled line is the one the second call used to fetch"
    );

    assert_eq!(
        summary_card.current_week.count,
        s.engine
            .get_period_stats(p.current_start as i64, p.current_end as i64)
            .count
    );
    assert_eq!(
        summary_card.prev_week.count,
        s.engine
            .get_period_stats(p.prev_start as i64, p.prev_end as i64)
            .count
    );
    assert_eq!(
        summary_card.ftp_trend.latest_ftp,
        s.engine.get_ftp_trend().latest_ftp
    );
    assert_eq!(
        summary_card.run_pace_trend.latest_pace,
        s.engine.get_pace_trend("Run").latest_pace
    );
    assert_eq!(
        summary_card.swim_pace_trend.latest_pace,
        s.engine.get_pace_trend("Swim").latest_pace
    );

    let bundled: Vec<&str> = preview_tracks
        .iter()
        .map(|t| t.activity_id.as_str())
        .collect();
    assert_eq!(bundled, vec!["a1", "a2"]);

    for track in &preview_tracks {
        let expected = s
            .engine
            .get_signature(&track.activity_id)
            .expect("signature");
        assert_eq!(
            veloqrs::persistence::codec::decode_polyline(&track.encoded_coords)
                .unwrap()
                .len(),
            expected.points.len()
        );
    }
}

#[test]
fn startup_skips_ids_with_no_signature() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let p = insights_params();
    let ids = vec!["nope".to_string(), "a1".to_string()];

    let bundle = s.engine.startup_data(
        p.current_start as i64,
        p.current_end as i64,
        p.prev_start as i64,
        p.prev_end as i64,
        &ids,
        0,
    );

    let bundled: Vec<&str> = bundle
        .preview_tracks
        .iter()
        .map(|t| t.activity_id.as_str())
        .collect();
    assert_eq!(bundled, vec!["a1"]);
}

#[test]
fn startup_still_answers_with_no_preview_ids() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let p = insights_params();

    let bundle = s.engine.startup_data(
        p.current_start as i64,
        p.current_end as i64,
        p.prev_start as i64,
        p.prev_end as i64,
        &[],
        0,
    );

    assert!(bundle.preview_tracks.is_empty());
    assert_eq!(
        bundle.summary_card.current_week.count,
        s.engine
            .get_period_stats(p.current_start as i64, p.current_end as i64)
            .count
    );
}

// ============================================================================
// Launch
// ============================================================================

#[test]
fn launch_writes_the_athlete_id_and_answers_with_the_stats() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let tiles = s._tmp.path().join("heatmap-tiles");

    let stats = s.engine.launch_data(
        Some("12345".to_string()),
        Some(tiles.to_str().unwrap().to_string()),
    );

    assert_eq!(
        s.engine.get_setting("__athlete_id").expect("read setting"),
        Some("12345".to_string())
    );
    assert_eq!(stats.activity_count, s.engine.stats().activity_count);
    assert_eq!(stats.oldest_date, s.engine.stats().oldest_date);
    assert_eq!(stats.newest_date, s.engine.stats().newest_date);
    assert!(s.engine.heatmap_tiles_path().is_some());
}

/// A launch with no credentials athlete id must not blank the one on disk: the
/// backup's cross-athlete guard reads it and an empty value passes anything.
#[test]
fn launch_leaves_the_stored_athlete_id_alone_when_given_none() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .set_setting("__athlete_id", "12345")
        .expect("seed setting");

    s.engine.launch_data(None, None);

    assert_eq!(
        s.engine.get_setting("__athlete_id").expect("read setting"),
        Some("12345".to_string())
    );
}

/// The athlete turned the heatmap off, so launch has to clear the path rather
/// than leave whatever the last run set.
#[test]
fn launch_clears_the_tiles_path_when_the_heatmap_is_off() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let tiles = s._tmp.path().join("heatmap-tiles");
    s.engine
        .set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());

    s.engine.launch_data(None, None);

    assert!(s.engine.heatmap_tiles_path().is_none());
    let parked = veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    if let Some(handle) = parked {
        let _ = handle.recv_blocking();
    }
}

// ============================================================================
// Section detail
// ============================================================================

#[test]
fn section_detail_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1");

    assert_eq!(bundle.activity_count, s.engine.activity_count() as u32);
    assert_eq!(
        bundle.section.as_ref().map(|sec| sec.id.clone()),
        s.engine.get_section_by_id("auto1").map(|sec| sec.id)
    );
    assert_eq!(
        bundle.merge_candidates.len(),
        s.engine.get_merge_candidates("auto1").len()
    );
    assert_eq!(
        bundle.excluded_activity_ids,
        s.engine.get_excluded_activity_ids("auto1")
    );
    assert_eq!(
        bundle.has_original_bounds,
        s.engine.has_original_bounds("auto1")
    );

    let activity_ids = s
        .engine
        .get_section_by_id("auto1")
        .map(|sec| sec.activity_ids)
        .unwrap_or_default();
    assert_eq!(
        bundle.map_signatures.len(),
        s.engine.get_map_signatures_for_ids(&activity_ids).len()
    );
    let bundled_metric_ids: Vec<String> = bundle
        .activity_metrics
        .iter()
        .map(|m| m.activity_id.clone())
        .collect();
    assert_eq!(bundled_metric_ids, activity_ids);
}

#[test]
fn section_detail_uses_the_stored_section_type() {
    let s = populated();

    let custom = s.engine.section_detail_data("cust1");
    assert_eq!(
        custom.section.expect("custom section").section_type,
        "custom"
    );

    let auto = s.engine.section_detail_data("auto1");
    assert_eq!(auto.section.expect("auto section").section_type, "auto");
}

#[test]
fn section_detail_does_not_guess_a_type_when_its_row_cannot_be_read() {
    let mut s = populated();
    assert!(s.engine.get_section_by_id("cust1").is_some());
    s.raw
        .execute("DROP TABLE sections", [])
        .expect("remove section table from fixture");

    let detail = s.engine.section_detail_data("cust1");
    assert!(detail.section.is_none());
}

#[test]
fn test_section_detail_preserves_disabled_auto_identity() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "UPDATE sections SET disabled = 1, superseded_by = 'cust1' WHERE id = 'auto1'",
            [],
        )
        .expect("retire auto section");

    let section = s
        .engine
        .section_detail_data("auto1")
        .section
        .expect("disabled section stays reachable by id");
    assert_eq!(section.section_type, "auto");
    assert!(section.disabled);
    assert_eq!(section.superseded_by.as_deref(), Some("cust1"));
    assert_eq!(section.route_ids, Some(Vec::new()));
    assert_eq!(section.activity_portions.len(), 2);
}

#[test]
fn section_detail_leaves_out_a_route_held_by_one_activity() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage,
                 direction, excluded) VALUES ('r1', 'a1', 100.0, 'same', 0)",
            [],
        )
        .expect("match source activity to route");
    s.raw
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                 activity_count) VALUES ('r1', 'a1', '[]', 'Ride', 1)",
            [],
        )
        .expect("route held by one activity");

    let section = s
        .engine
        .section_detail_data("cust1")
        .section
        .expect("custom section");
    assert_eq!(section.route_ids, Some(Vec::new()));
}

#[test]
fn test_section_detail_preserves_custom_source_slice() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "UPDATE sections SET start_index = 4, end_index = 24 WHERE id = 'cust1'",
            [],
        )
        .expect("set source slice");
    s.raw
        .execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage,
                 direction, excluded) VALUES ('r1', 'a1', 100.0, 'same', 0)",
            [],
        )
        .expect("match source activity to route");
    s.raw
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                 activity_count) VALUES ('r1', 'a1', '[]', 'Ride', 2)",
            [],
        )
        .expect("route held by two activities");

    let section = s
        .engine
        .section_detail_data("cust1")
        .section
        .expect("custom section");
    assert_eq!(section.section_type, "custom");
    assert_eq!(section.source_activity_id.as_deref(), Some("a1"));
    assert_eq!(section.start_index, Some(4));
    assert_eq!(section.end_index, Some(24));
    assert_eq!(section.route_ids, Some(vec!["r1".to_string()]));
    assert_eq!(section.activity_portions.len(), 1);

    s.raw
        .execute(
            "DELETE FROM section_activities WHERE section_id = 'cust1'",
            [],
        )
        .expect("leave custom section linked by its source activity");
    let from_activity = s
        .engine
        .activity_detail_data("a1", 2)
        .custom_sections
        .into_iter()
        .find(|item| item.id == "cust1")
        .expect("source custom section in activity detail");
    let from_detail = s
        .engine
        .section_detail_data("cust1")
        .section
        .expect("source custom section in section detail");
    assert_eq!(from_detail.section_type, from_activity.section_type);
    assert_eq!(
        from_detail.source_activity_id,
        from_activity.source_activity_id
    );
    assert_eq!(from_detail.start_index, from_activity.start_index);
    assert_eq!(from_detail.end_index, from_activity.end_index);
    assert_eq!(from_detail.route_ids, from_activity.route_ids);
    assert!(from_detail.activity_portions.is_empty());
}

#[test]
fn test_section_detail_skips_corrupt_point_density_blob() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "UPDATE sections SET point_density_blob = x'ff' WHERE id = 'auto1'",
            [],
        )
        .expect("corrupt point density");

    assert!(s.engine.section_detail_data("auto1").section.is_none());
}

#[test]
fn test_section_detail_skips_corrupt_point_density_json() {
    let _serial_state = crate::serial_state();
    let s = populated();
    s.raw
        .execute(
            "UPDATE sections SET point_density_json = 'broken' WHERE id = 'auto1'",
            [],
        )
        .expect("corrupt point density json");

    assert!(s.engine.section_detail_data("auto1").section.is_none());
}

/// The ledger, the excluded laps and the efficiency trend are keyed on the
/// section id alone, so a visit paid five more lock acquisitions for reads the
/// first bundle was already positioned to make.
#[test]
fn section_detail_carries_the_ledger_the_laps_and_the_trend() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1");

    assert_eq!(
        bundle.history.len(),
        s.engine.section_history("auto1").len()
    );
    assert_eq!(
        bundle.geometry_versions.len(),
        s.engine.section_geometry_versions("auto1").len()
    );
    assert_eq!(
        bundle.pinned_version,
        s.engine.pinned_section_version("auto1").map(|v| v as f64)
    );
    assert_eq!(
        bundle.efficiency_trend.is_some(),
        s.engine
            .get_section_efficiency_trend("auto1", "Ride")
            .is_some()
    );
}

/// Ledger rows for sections that left the catalogue, the way a fired
/// retirement writes them.
fn ledger(s: &Setup, rows: &[(&str, &str, &str)]) {
    for (id, kind, details) in rows {
        s.raw
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details)
                 VALUES (?1, '2026-08-01 00:00:00', ?2, ?3)",
                params![id, kind, details],
            )
            .expect("ledger row");
    }
}

#[test]
fn a_merged_away_section_names_the_survivor_that_took_its_ground() {
    let s = populated();
    ledger(&s, &[("gone1", "merged", "{\"into\":\"auto1\"}")]);

    let bundle = s.engine.section_detail_data("gone1");

    assert!(bundle.section.is_none());
    let retirement = bundle.retirement.expect("the ledger knows where it went");
    assert_eq!(retirement.kind, "merged");
    assert_eq!(retirement.into.as_deref(), Some("auto1"));
    assert_eq!(retirement.into_name.as_deref(), Some("Auto Climb"));
}

#[test]
fn a_dissolved_section_carries_its_departure_with_no_survivor() {
    let s = populated();
    ledger(&s, &[("gone1", "dissolved", "{}")]);

    let retirement = s
        .engine
        .section_detail_data("gone1")
        .retirement
        .expect("dissolved is a departure");

    assert_eq!(retirement.kind, "dissolved");
    assert!(retirement.into.is_none());
    assert!(retirement.into_name.is_none());
}

#[test]
fn a_retirement_follows_the_chain_to_its_live_end() {
    let s = populated();
    ledger(
        &s,
        &[
            ("gone1", "merged", "{\"into\":\"gone2\"}"),
            ("gone2", "merged", "{\"into\":\"auto1\"}"),
        ],
    );

    let retirement = s
        .engine
        .section_detail_data("gone1")
        .retirement
        .expect("retired");

    assert_eq!(retirement.into.as_deref(), Some("auto1"));
}

#[test]
fn a_chain_that_ends_in_no_live_section_links_nothing() {
    let s = populated();
    ledger(
        &s,
        &[
            ("gone1", "merged", "{\"into\":\"gone2\"}"),
            ("gone2", "dissolved", "{}"),
        ],
    );

    let retirement = s
        .engine
        .section_detail_data("gone1")
        .retirement
        .expect("retired");

    assert_eq!(retirement.kind, "merged");
    assert!(retirement.into.is_none());
}

#[test]
fn a_retirement_loop_ends_without_a_link() {
    let s = populated();
    ledger(
        &s,
        &[
            ("gone1", "merged", "{\"into\":\"gone2\"}"),
            ("gone2", "merged", "{\"into\":\"gone1\"}"),
        ],
    );

    let retirement = s
        .engine
        .section_detail_data("gone1")
        .retirement
        .expect("retired");

    assert!(retirement.into.is_none());
}

#[test]
fn an_id_the_ledger_never_saw_carries_no_retirement() {
    let s = populated();
    ledger(&s, &[("gone1", "dissolved", "{}")]);

    assert!(
        s.engine
            .section_detail_data("never-seen")
            .retirement
            .is_none()
    );
}

#[test]
fn a_restored_section_reads_as_the_normal_page() {
    let s = populated();
    ledger(&s, &[("auto1", "dissolved", "{}")]);

    let bundle = s.engine.section_detail_data("auto1");

    assert!(bundle.section.is_some());
    assert!(bundle.retirement.is_none());
}

#[test]
fn section_detail_links_split_events_to_available_sections() {
    let s = populated();
    let line = line(46.2, 7.35, 30);
    insert_section(&s.raw, "child1", "auto", "Child 1", &line, None);
    insert_section(&s.raw, "child2", "auto", "Child 2", &line, None);
    s.raw
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details) VALUES
             ('child1', '2026-08-01', 'formed', '{\"split_from\":\"auto1\"}'),
             ('child2', '2026-08-01', 'formed', '{\"split_from\":\"child1\"}'),
             ('auto1', '2026-08-02', 'split', '{\"siblings\":[\"child1\",\"child2\"]}')",
            [],
        )
        .expect("split history");

    let child = s.engine.section_detail_data("child1");
    let child_details: serde_json::Value = serde_json::from_str(
        child
            .history
            .first()
            .and_then(|e| e.details.as_deref())
            .expect("child event"),
    )
    .expect("child details");
    assert_eq!(child_details["split_from_link"]["id"], "auto1");
    assert_eq!(child_details["split_from_link"]["name"], "Auto Climb");
    assert_eq!(child_details["split_from_link"]["available"], true);

    let parent = s.engine.section_detail_data("auto1");
    let parent_details: serde_json::Value = serde_json::from_str(
        parent
            .history
            .first()
            .and_then(|e| e.details.as_deref())
            .expect("parent event"),
    )
    .expect("parent details");
    assert_eq!(parent_details["split_into_links"][0]["id"], "child1");
    assert_eq!(parent_details["split_into_links"][1]["id"], "child2");
    assert_eq!(parent_details["split_into_links"][0]["name"], "Child 1");
    assert_eq!(parent_details["split_into_links"][1]["name"], "Child 2");
}

#[test]
fn section_detail_marks_retired_or_missing_split_targets_unavailable() {
    let s = populated();
    s.raw
        .execute("UPDATE sections SET disabled = 1 WHERE id = 'auto1'", [])
        .expect("retire parent");
    s.raw
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details) VALUES
             ('cust1', '2026-08-01', 'formed', '{\"split_from\":\"auto1\"}'),
             ('cust1', '2026-08-02', 'split', '{\"siblings\":[\"missing\"]}')",
            [],
        )
        .expect("split history");

    let detail = s.engine.section_detail_data("cust1");
    let formed: serde_json::Value = serde_json::from_str(
        detail.history[0]
            .details
            .as_deref()
            .expect("formed details"),
    )
    .expect("formed JSON");
    let split: serde_json::Value =
        serde_json::from_str(detail.history[1].details.as_deref().expect("split details"))
            .expect("split JSON");
    assert_eq!(formed["split_from_link"]["available"], false);
    assert_eq!(split["split_into_links"][0]["id"], "missing");
    assert_eq!(split["split_into_links"][0]["available"], false);
}

/// A pinned version has to read as pinned in the bundle, which is the one
/// field `get_geometry_versions` computed rather than read.
#[test]
fn a_pinned_version_reads_as_pinned_in_the_bundle() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let Some(version) = s
        .engine
        .section_geometry_versions("auto1")
        .first()
        .map(|v| v.version)
    else {
        return;
    };
    s.engine.pin_section_geometry("auto1", version).unwrap();

    let bundle = s.engine.section_detail_data("auto1");

    assert_eq!(bundle.pinned_version, Some(version as f64));
    let pinned: Vec<f64> = bundle
        .geometry_versions
        .iter()
        .filter(|v| v.pinned)
        .map(|v| v.version)
        .collect();
    assert_eq!(pinned, vec![version as f64]);
}

/// An unknown id returns the empty bundle rather than failing, the way the
/// separate reads did.
#[test]
fn section_detail_for_an_unknown_id_carries_no_ledger() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.section_detail_data("no-such-section");

    assert!(bundle.section.is_none());
    assert!(bundle.history.is_empty());
    assert!(bundle.geometry_versions.is_empty());
    assert_eq!(bundle.pinned_version, None);
    assert!(bundle.efficiency_trend.is_none());
}

#[test]
fn section_detail_reports_the_streams_the_caller_must_fetch() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1");

    let portion_ids: Vec<String> = s
        .engine
        .get_section_by_id("auto1")
        .map(|sec| {
            let mut seen = std::collections::HashSet::new();
            sec.activity_portions
                .into_iter()
                .filter(|p| seen.insert(p.activity_id.clone()))
                .map(|p| p.activity_id)
                .collect()
        })
        .unwrap_or_default();

    assert_eq!(
        bundle.missing_time_stream_ids,
        s.engine.get_activities_missing_time_streams(&portion_ids)
    );
}

#[test]
fn section_performance_matches_the_calls_it_replaces() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.section_detail_performance("auto1", 0, None);

    let calendar = s.engine.get_section_calendar_summary("auto1", None);
    assert_eq!(bundle.calendar_summary.is_some(), calendar.is_some());

    let direct = s.engine.get_section_performances_filtered("auto1", None);
    assert_eq!(bundle.performances.records.len(), direct.records.len());
    assert_eq!(
        bundle
            .performances
            .best_forward_record
            .as_ref()
            .map(|r| r.best_time),
        direct.best_forward_record.as_ref().map(|r| r.best_time)
    );
    assert_eq!(
        bundle
            .performances
            .best_reverse_record
            .as_ref()
            .map(|r| r.best_time),
        direct.best_reverse_record.as_ref().map(|r| r.best_time)
    );

    let chart = s.engine.get_section_chart_data("auto1", 0, None);
    assert_eq!(bundle.chart_data.points.len(), chart.points.len());
    assert_eq!(bundle.chart_data.best_time_secs, chart.best_time_secs);
}

#[test]
fn section_performance_honours_the_sport_filter() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let bundle = s.engine.section_detail_performance("auto1", 0, Some("Run"));

    let direct = s
        .engine
        .get_section_performances_filtered("auto1", Some("Run"));
    assert_eq!(bundle.performances.records.len(), direct.records.len());
    assert!(
        bundle.performances.records.is_empty(),
        "the fixture holds only rides, so a run filter must exclude everything"
    );
}

#[test]
fn section_detail_is_empty_for_an_unknown_section() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.section_detail_data("nope");

    assert!(bundle.section.is_none());
    assert!(bundle.activity_metrics.is_empty());
    assert!(bundle.map_signatures.is_empty());
    assert!(bundle.missing_time_stream_ids.is_empty());
    assert!(bundle.excluded_activity_ids.is_empty());
}

#[test]
fn activity_detail_is_empty_for_an_unknown_activity() {
    let _serial_state = crate::serial_state();
    let s = populated();
    let bundle = s.engine.activity_detail_data("nope", 2);

    assert!(bundle.matched_sections.is_empty());
    assert!(bundle.encounters.is_empty());
    assert!(bundle.section_traces.is_empty());
    assert!(bundle.pr_section_ids.is_empty());
    // Engine-wide counts are unaffected by the activity being unknown.
    assert_eq!(bundle.activity_count, 2);
    assert_eq!(bundle.section_count, 2);
}

/// Scenario: a feed card past the first five needs its preview track. It used
/// to ask for the full-resolution GPS track, one boxed record per point, and
/// decode the whole blob each time.
///
/// Expected behaviour: one card gets exactly what the startup bundle would
/// have given it, from the same cached signature.
#[test]
fn one_preview_track_matches_the_one_the_startup_bundle_carries() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    let p = insights_params();
    let ids = vec!["a1".to_string()];

    let bundle = s.engine.startup_data(
        p.current_start as i64,
        p.current_end as i64,
        p.prev_start as i64,
        p.prev_end as i64,
        &ids,
        0,
    );
    let bundled = bundle.preview_tracks.first().expect("a1 has a signature");

    let alone = s.engine.preview_track("a1").expect("a1 has a signature");

    assert_eq!(alone.activity_id, bundled.activity_id);
    assert_eq!(alone.encoded_coords, bundled.encoded_coords);
}

/// A preview track is the signature, not the stored track, so it is the
/// simplified line and never the four thousand points behind it.
#[test]
fn a_preview_track_is_the_signature_rather_than_the_whole_ride() {
    let _serial_state = crate::serial_state();
    let mut s = populated();

    let track = s.engine.preview_track("a1").expect("a1 has a signature");
    let points = veloqrs::persistence::codec::decode_polyline(&track.encoded_coords)
        .unwrap()
        .len();
    let signature = s
        .engine
        .get_signature("a1")
        .expect("signature")
        .points
        .len();
    let stored = s.engine.get_gps_track("a1").map(|t| t.len()).unwrap_or(0);

    assert_eq!(points, signature);
    assert!(
        points <= stored,
        "a signature is never longer than its track"
    );
}

#[test]
fn an_activity_with_no_signature_has_no_preview_track() {
    let _serial_state = crate::serial_state();
    let mut s = populated();

    assert!(s.engine.preview_track("nope").is_none());
}

// ============================================================================
// One bundle computes one section's performances once
// ============================================================================

/// Twelve sections all travelled inside the recent window, which is more than
/// the performance cache holds. Every one qualifies for a PR slot, so the
/// recent-PR loop asks about all twelve, and the efficiency loop asks again.
fn populated_with_many_recent_sections(latest: i64) -> Setup {
    const SECTIONS: usize = 12;
    let mut s = setup();
    let track = line(46.2, 7.35, 60);

    for n in 0..3 {
        let id = format!("act{n}");
        s.engine
            .add_activity(id.clone(), track.clone(), "Ride".to_string())
            .unwrap_or_else(|e| panic!("add {id}: {e}"));
        // An efficiency trend is heart rate against pace, so the outings carry
        // a falling heart rate as well as a falling lap time.
        let mut m = metrics(&id, latest - (n as i64) * 86_400);
        m.avg_hr = Some(150 + n as u16 * 6);
        s.engine
            .set_activity_metrics_extended(vec![m])
            .expect("set metrics");
    }

    let polyline = line(46.2, 7.35, 30);
    for i in 0..SECTIONS {
        let section = format!("auto{i}");
        insert_section(
            &s.raw,
            &section,
            "auto",
            &format!("Climb {i}"),
            &polyline,
            None,
        );
        // Getting faster each outing, so each section holds a recent record.
        for n in 0..3 {
            insert_traversal(
                &s.raw,
                &section,
                &format!("act{n}"),
                240.0 - (n as f64) * 10.0,
            );
        }
    }
    // The sections went in behind the engine, and the efficiency loop reads the
    // in-memory catalogue rather than the table.
    s.engine.load().expect("load the catalogue");
    s
}

#[test]
fn one_insights_bundle_computes_each_section_at_most_once() {
    let _serial_state = crate::serial_state();
    let s = populated_with_many_recent_sections(1_700_150_000);
    let p = insights_params_ending(1_700_200_000);

    let bundle = s.engine.insights_data(&p);

    // Twelve sections in one sport, so twelve is every computation the bundle
    // can honestly need. Above that a section was computed, evicted by its
    // neighbours, and computed again inside the one call.
    assert!(
        s.engine.performance_computations() > 0,
        "the fixture must reach the performance path at all"
    );
    assert!(
        s.engine.performance_computations() <= 12,
        "{} computations for 12 sections inside one bundle",
        s.engine.performance_computations()
    );
    assert!(
        !bundle.recent_prs.is_empty(),
        "the fixture must earn records"
    );
}

/// One wellness day, carrying only what form is read from.
fn wellness_day(
    date: &str,
    ctl: Option<f64>,
    atl: Option<f64>,
) -> veloqrs::persistence::wellness::WellnessRow {
    veloqrs::persistence::wellness::WellnessRow {
        date: date.to_string(),
        ctl,
        atl,
        ramp_rate: None,
        hrv: None,
        resting_hr: None,
        weight: None,
        sleep_secs: None,
        sleep_score: None,
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: None,
    }
}

/// Form is fitness, fatigue and the difference, which every caller was sorting
/// a month of rows to reach. The bundle carries the day it was read from, so a
/// stale reading can be named rather than passed off as today's.
#[test]
fn the_bundle_carries_the_newest_form_reading_in_its_window() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .upsert_wellness(&[
            wellness_day("2026-09-10", Some(40.0), Some(55.0)),
            wellness_day("2026-09-12", Some(42.0), Some(30.0)),
        ])
        .expect("store wellness");

    let mut p = insights_params();
    p.wellness_oldest = "2026-09-01".to_string();
    p.wellness_newest = "2026-09-30".to_string();

    let form = s.engine.insights_data(&p).form.expect("a window with rows");

    assert_eq!(
        form.date, "2026-09-12",
        "the newest day in the window is the reading"
    );
    assert_eq!(form.ctl, 42.0);
    assert_eq!(form.atl, 30.0);
}

#[test]
fn a_window_with_no_wellness_row_carries_no_form() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .upsert_wellness(&[wellness_day("2026-08-01", Some(40.0), Some(20.0))])
        .expect("store wellness");

    let mut p = insights_params();
    p.wellness_oldest = "2026-09-01".to_string();
    p.wellness_newest = "2026-09-30".to_string();

    assert!(
        s.engine.insights_data(&p).form.is_none(),
        "a library synced a month ago has no reading for this window, and no zero either"
    );
}

/// A day the athlete logged without an upstream fitness figure is still the
/// newest day, and it reads as nothing rather than as a collapse to zero.
#[test]
fn a_newest_day_missing_its_figures_reads_as_zero_rather_than_reaching_back() {
    let _serial_state = crate::serial_state();
    let mut s = populated();
    s.engine
        .upsert_wellness(&[
            wellness_day("2026-09-10", Some(40.0), Some(20.0)),
            wellness_day("2026-09-12", None, None),
        ])
        .expect("store wellness");

    let mut p = insights_params();
    p.wellness_oldest = "2026-09-01".to_string();
    p.wellness_newest = "2026-09-30".to_string();

    let form = s
        .engine
        .insights_data(&p)
        .form
        .expect("the window has rows");
    assert_eq!(form.date, "2026-09-12");
    assert_eq!(form.ctl, 0.0);
    assert_eq!(form.atl, 0.0);
}

/// Three runs over one line, the newest the fastest, each inside the record
/// window of `insights_params`.
fn three_runs_over_one_line() -> Setup {
    let mut s = setup();
    let track = line(46.2, 7.35, 200);
    let now = 1_700_200_000;
    let mut rows = Vec::new();
    for (id, days_ago, moving_time) in [("r1", 5, 320), ("r2", 3, 310), ("r3", 1, 280)] {
        s.engine
            .add_activity(id.to_string(), track.clone(), "Run".to_string())
            .expect("add run");
        let mut row = metrics(id, now - days_ago * 86_400);
        row.sport_type = "Run".to_string();
        row.moving_time = moving_time;
        row.elapsed_time = moving_time;
        rows.push(row);
    }
    s.engine
        .set_activity_metrics_extended(rows)
        .expect("metrics");
    assert!(
        !s.engine.get_groups().is_empty(),
        "the runs share no route group"
    );
    s.engine.load().expect("load");
    s
}

#[test]
fn insights_names_the_route_whose_newest_run_holds_a_recent_record() {
    let s = three_runs_over_one_line();

    let bundle = s.engine.insights_data(&insights_params());

    assert_eq!(bundle.route_insights.len(), 1);
    let row = &bundle.route_insights[0];
    assert_eq!(row.sport_type, "Run");
    assert!(!row.is_reverse);
    assert!(row.is_recent_record);
    assert_eq!(row.best_time, 280.0);
    assert_eq!(row.attempt_count, 3);
    assert_eq!(row.recent_efforts.len(), 3);
    assert!(!row.route_name.is_empty());
    assert_eq!(bundle.route_record_count, 1);
    assert_eq!(bundle.route_faster_count, 0);
    assert_eq!(bundle.route_slower_count, 0);
}

#[test]
fn insights_leaves_an_excluded_run_out_of_the_route_record() {
    let s = three_runs_over_one_line();
    s.raw
        .execute(
            "UPDATE activity_matches SET excluded = 1 WHERE activity_id = 'r3'",
            [],
        )
        .expect("exclude");

    let bundle = s.engine.insights_data(&insights_params());

    assert_eq!(bundle.route_insights.len(), 1);
    assert_eq!(bundle.route_insights[0].best_time, 310.0);
    assert_eq!(bundle.route_insights[0].attempt_count, 2);
}

#[test]
fn insights_names_no_route_when_every_run_is_older_than_the_windows() {
    let s = three_runs_over_one_line();
    let mut p = insights_params();
    p.current_end += 400.0 * 86_400.0;

    assert!(s.engine.insights_data(&p).route_insights.is_empty());
}

/// One section ridden five times with the third the fastest, a fortnight of
/// HRV ending today, one recut section and six weeks of activities, all inside
/// the window `insights_params_ending(INSIGHTS_END)` reads.
const INSIGHTS_END: i64 = 1_700_200_000;

fn insights_with_history_to_mark() -> Setup {
    let mut s = populated();
    let track = line(46.2, 7.35, 60);
    let rides = [
        ("a3", INSIGHTS_END - 6 * 86_400, 190.0),
        ("a4", INSIGHTS_END - 5 * 86_400, 230.0),
        ("a5", INSIGHTS_END - 4 * 86_400, 250.0),
    ];
    for (id, date, lap) in rides {
        s.engine
            .add_activity(id.to_string(), track.clone(), "Ride".to_string())
            .expect("add ride");
        s.engine
            .set_activity_metrics_extended(vec![metrics(id, date)])
            .expect("ride metrics");
        insert_traversal(&s.raw, "auto1", id, lap);
    }
    // The fixture's first two rides are older than the window's start, so the
    // third in date order is the one the record is set on.
    s.raw
        .execute(
            "UPDATE activity_metrics SET date = ?1 WHERE activity_id = 'a1'",
            params![INSIGHTS_END - 9 * 86_400],
        )
        .expect("date a1");
    s.raw
        .execute(
            "UPDATE activity_metrics SET date = ?1 WHERE activity_id = 'a2'",
            params![INSIGHTS_END - 8 * 86_400],
        )
        .expect("date a2");

    let today = chrono::Local::now().date_naive();
    let days: Vec<_> = (0..14)
        .map(|back| {
            let mut day = wellness_day(
                &(today - chrono::Duration::days(13 - back)).to_string(),
                None,
                None,
            );
            day.hrv = Some(if back < 7 { 70.0 } else { 55.0 });
            day
        })
        .collect();
    s.engine.upsert_wellness(&days).expect("store hrv");

    s.raw
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES ('cust1', datetime('now'), 'recut', NULL)",
            [],
        )
        .expect("recut");

    let weeks: Vec<_> = (0..6)
        .map(|week| metrics(&format!("w{week}"), INSIGHTS_END - (week * 7 + 3) * 86_400))
        .collect();
    s.engine
        .set_activity_metrics_extended(weeks)
        .expect("weekly metrics");
    s
}

fn history_params() -> veloqrs::FfiInsightsParams {
    let mut p = insights_params_ending(INSIGHTS_END);
    p.hrv_window_days = 14;
    // Four whole weeks before the compared week, as the app asks for them.
    p.chronic_start = p.prev_start - 28.0 * 86_400.0;
    p
}

#[test]
fn a_recent_pr_and_its_efforts_name_the_activities_they_were_set_in() {
    let _serial_state = crate::serial_state();
    let s = insights_with_history_to_mark();

    let bundle = s.engine.insights_data(&history_params());

    let pr = bundle
        .recent_prs
        .iter()
        .find(|pr| pr.section_id == "auto1")
        .expect("the section holds a recent record");
    assert_eq!(pr.best_activity_id.as_deref(), Some("a3"));
    assert!(pr.recent_efforts.len() >= 5);
    assert!(
        pr.recent_efforts.iter().all(|e| e.activity_id.is_some()),
        "every effort names its activity: {:?}",
        pr.recent_efforts
    );
    assert_eq!(
        pr.recent_efforts
            .iter()
            .find(|e| e.value == 190.0)
            .and_then(|e| e.activity_id.as_deref()),
        Some("a3")
    );
}

#[test]
fn a_ranked_section_names_the_activity_of_its_best_effort() {
    let _serial_state = crate::serial_state();
    let s = insights_with_history_to_mark();

    let bundle = s.engine.insights_data(&history_params());

    let ranked = bundle
        .ranked_sections
        .iter()
        .flat_map(|batch| batch.sections.iter())
        .find(|section| section.section_id == "auto1")
        .expect("the section is ranked");
    assert_eq!(ranked.best_time_secs, 190.0);
    assert_eq!(ranked.best_activity_id.as_deref(), Some("a3"));
}

#[test]
fn the_hrv_window_is_dated_and_marks_where_its_later_half_starts() {
    let _serial_state = crate::serial_state();
    let s = insights_with_history_to_mark();

    let trend = s
        .engine
        .insights_data(&history_params())
        .hrv_trend
        .expect("a fortnight of readings");

    assert_eq!(trend.sparkline.len(), 14);
    assert!(trend.sparkline.windows(2).all(|w| w[0].date < w[1].date));
    let split = trend.window_split.expect("the halves rule decided it");
    assert_eq!(trend.reason, "halves");
    assert!(split > trend.sparkline[0].date);
    assert!(split <= trend.sparkline[13].date);
    assert_eq!(
        split, trend.sparkline[7].date,
        "the later half's first reading"
    );
}

#[test]
fn a_recut_section_change_carries_the_line_it_now_follows() {
    let _serial_state = crate::serial_state();
    let s = insights_with_history_to_mark();

    let bundle = s.engine.insights_data(&history_params());

    let change = bundle
        .recent_section_changes
        .iter()
        .find(|c| c.section_id == "cust1")
        .expect("the recut is listed");
    let points = veloqrs::persistence::codec::decode_polyline(&change.encoded_polyline).unwrap();
    assert!(points.len() >= 2, "{points:?}");
}

#[test]
fn the_weekly_totals_are_dated_a_week_apart_through_the_compared_week() {
    let _serial_state = crate::serial_state();
    let s = insights_with_history_to_mark();
    let p = history_params();

    let bundle = s.engine.insights_data(&p);

    let starts: Vec<f64> = bundle.weekly_totals.iter().map(|w| w.start).collect();
    assert_eq!(starts.len(), 5, "four chronic weeks and the compared week");
    assert!(
        starts.windows(2).all(|w| w[1] - w[0] == 7.0 * 86_400.0),
        "{starts:?}"
    );
    assert_eq!(starts[0], p.chronic_start);
    assert_eq!(starts[4], p.prev_start, "the last row is the compared week");
    let chronic: f64 = bundle.weekly_totals[..4]
        .iter()
        .map(|w| w.stats.total_duration)
        .sum();
    assert_eq!(chronic, bundle.chronic_period.total_duration);
    assert_eq!(
        bundle.weekly_totals[4].stats.total_duration,
        bundle.previous_week.total_duration
    );
}
