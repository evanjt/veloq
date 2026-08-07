//! Contract tests for the per-screen data bundles.
//!
//! Each bundle replaces a fan-out of individual engine reads, so every test
//! here asserts the bundle field-for-field against the calls it replaced on a
//! fixture dataset. A drift between the two is the failure mode these guard.
//!
//! Strategy follows `encounters.rs`: a real `PersistentRouteEngine` (so
//! migrations run) with fixtures written through a parallel rusqlite
//! connection, plus GPS tracks added through the engine API so trace
//! extraction has something to work on.
//!
//! Run: `cargo test --test screen_bundles -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentRouteEngine};

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();

    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");
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
        date,
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

// ============================================================================
// Activity detail
// ============================================================================

#[test]
fn activity_detail_matches_the_calls_it_replaces() {
    let mut s = populated();
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

    let custom: Vec<String> = s
        .engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .map(|sec| sec.id)
        .collect();
    let bundled_custom: Vec<String> = bundle
        .custom_sections
        .iter()
        .map(|sec| sec.id.clone())
        .collect();
    assert_eq!(bundled_custom, custom);

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

#[test]
fn activity_detail_traces_match_per_section_extraction() {
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
            veloqrs::coords::encode(&expected),
            "trace for {} drifted from per-section extraction",
            trace.section_id
        );
    }
}

#[test]
fn activity_detail_pr_sections_match_per_section_records() {
    let mut s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    let candidates = ["auto1", "cust1"];
    let expected: Vec<String> = candidates
        .iter()
        .filter(|id| {
            s.engine
                .get_section_performances(id)
                .best_record
                .as_ref()
                .is_some_and(|r| r.activity_id == "a1")
        })
        .map(|id| (*id).to_string())
        .collect();

    assert_eq!(bundle.pr_section_ids, expected);
    assert!(
        bundle.pr_section_ids.contains(&"auto1".to_string()),
        "a1 is the faster of the two auto1 traversals"
    );
}

#[test]
fn activity_detail_route_groups_honour_the_minimum() {
    let mut s = populated();
    let bundle = s.engine.activity_detail_data("a1", 2);

    let total = s.engine.get_groups().len() as u32;
    assert_eq!(bundle.total_route_group_count, total);
    assert!(
        bundle
            .route_groups
            .iter()
            .all(|g| g.activity_ids.len() >= 2),
        "groups below the minimum must not be returned"
    );

    let counts: Vec<usize> = bundle
        .route_groups
        .iter()
        .map(|g| g.activity_ids.len())
        .collect();
    assert!(
        counts.windows(2).all(|w| w[0] >= w[1]),
        "route groups must arrive sorted by attempt count"
    );
}

// ============================================================================
// Insights
// ============================================================================

fn insights_params() -> veloqrs::FfiInsightsParams {
    let now = 1_700_200_000;
    veloqrs::FfiInsightsParams {
        current_start: now - 7 * 86_400,
        current_end: now,
        prev_start: now - 14 * 86_400,
        prev_end: now - 7 * 86_400,
        chronic_start: now - 35 * 86_400,
        today_start: now - 86_400,
        include_sections: true,
        ranked_limit: 50,
        active_window_days: 90,
        efficiency_per_sport: 5,
        efficiency_limit: 2,
        efficiency_min_efforts: 3,
        strength_month: veloqrs::FfiTimestampRange {
            start_ts: now - 28 * 86_400,
            end_ts: now,
        },
        strength_weeks: vec![veloqrs::FfiTimestampRange {
            start_ts: now - 7 * 86_400,
            end_ts: now,
        }],
    }
}

#[test]
fn insights_matches_the_calls_it_replaces() {
    let mut s = populated();
    let p = insights_params();
    let bundle = s.engine.insights_data(&p);

    assert_eq!(
        bundle.current_week.count,
        s.engine
            .get_period_stats(p.current_start, p.current_end)
            .count
    );
    assert_eq!(
        bundle.previous_week.count,
        s.engine.get_period_stats(p.prev_start, p.prev_end).count
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

#[test]
fn insights_skips_sections_when_the_caller_opts_out() {
    let mut s = populated();
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
    let mut s = populated();
    let mut p = insights_params();
    p.efficiency_limit = 1;

    let bundle = s.engine.insights_data(&p);
    assert!(bundle.efficiency_trends.len() <= 1);
    for trend in &bundle.efficiency_trends {
        assert!(trend.is_improving);
        assert!(trend.effort_count >= p.efficiency_min_efforts);
    }
}

#[test]
fn insights_falls_back_to_the_engine_sport_types() {
    let mut s = populated();
    let bundle = s.engine.insights_data(&insights_params());

    // The fixture is too small for k-means to emit a pattern, so the sport
    // types must come from what the engine holds.
    assert!(bundle.all_patterns.is_empty());
    assert_eq!(bundle.sport_types, s.engine.get_available_sport_types());
}

// ============================================================================
// Section detail
// ============================================================================

#[test]
fn section_detail_matches_the_calls_it_replaces() {
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1", 500.0);

    assert_eq!(bundle.activity_count, s.engine.activity_count() as u32);
    assert_eq!(
        bundle.section.as_ref().map(|sec| sec.id.clone()),
        s.engine.get_section_by_id("auto1").map(|sec| sec.id)
    );
    assert_eq!(
        bundle.nearby.len(),
        s.engine.get_nearby_sections("auto1", 500.0).len()
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
fn section_detail_reports_the_streams_the_caller_must_fetch() {
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1", 500.0);

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
    let mut s = populated();
    let bundle = s.engine.section_detail_performance("auto1", 0, None);

    let calendar = s.engine.get_section_calendar_summary("auto1");
    assert_eq!(bundle.calendar_summary.is_some(), calendar.is_some());

    let direct = s.engine.get_section_performances_filtered("auto1", None);
    assert_eq!(bundle.performances.records.len(), direct.records.len());
    assert_eq!(
        bundle
            .performances
            .best_record
            .as_ref()
            .map(|r| r.best_time),
        direct.best_record.as_ref().map(|r| r.best_time)
    );

    let chart = s.engine.get_section_chart_data("auto1", 0, None);
    assert_eq!(bundle.chart_data.points.len(), chart.points.len());
    assert_eq!(bundle.chart_data.best_pace, chart.best_pace);
}

#[test]
fn section_performance_honours_the_sport_filter() {
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
    let mut s = populated();
    let bundle = s.engine.section_detail_data("nope", 500.0);

    assert!(bundle.section.is_none());
    assert!(bundle.activity_metrics.is_empty());
    assert!(bundle.map_signatures.is_empty());
    assert!(bundle.missing_time_stream_ids.is_empty());
    assert!(bundle.excluded_activity_ids.is_empty());
}

#[test]
fn activity_detail_is_empty_for_an_unknown_activity() {
    let mut s = populated();
    let bundle = s.engine.activity_detail_data("nope", 2);

    assert!(bundle.matched_sections.is_empty());
    assert!(bundle.encounters.is_empty());
    assert!(bundle.section_traces.is_empty());
    assert!(bundle.pr_section_ids.is_empty());
    // Engine-wide counts are unaffected by the activity being unknown.
    assert_eq!(bundle.activity_count, 2);
    assert_eq!(bundle.section_count, 2);
}
