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
//! Run: `cargo test --test screen_bundles -p veloqrs`

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
// Map tab
// ============================================================================

#[test]
fn map_screen_matches_the_calls_it_replaces() {
    let s = populated();
    let start = 1_600_000_000;
    let end = 1_800_000_000;
    let bundle = s.engine.map_screen_data(start, end, Vec::new());

    assert_eq!(bundle.activity_count, s.engine.activity_count() as u32);
    assert_eq!(
        bundle.available_sport_types,
        s.engine.get_available_sport_types()
    );

    let direct = s.engine.map_activities_filtered(start, end, Vec::new());
    assert_eq!(bundle.activities.len(), direct.len());
    assert_eq!(bundle.activities.len(), 2);
}

#[test]
fn map_screen_honours_the_sport_filter() {
    let s = populated();
    let start = 1_600_000_000;
    let end = 1_800_000_000;

    let rides = s
        .engine
        .map_screen_data(start, end, vec!["Ride".to_string()]);
    assert_eq!(rides.activities.len(), 2);

    let runs = s
        .engine
        .map_screen_data(start, end, vec!["Run".to_string()]);
    assert!(runs.activities.is_empty());
    // The unfiltered total is still reported so the chips can show it.
    assert_eq!(runs.activity_count, 2);
}

// ============================================================================
// Widget snapshot
// ============================================================================

#[test]
fn widget_snapshot_matches_the_calls_it_replaces() {
    let mut s = populated();
    let now = 1_700_200_000;
    let bundle = s.engine.widget_snapshot_data(
        now - 7 * 86_400,
        now,
        now - 14 * 86_400,
        now - 7 * 86_400,
        30,
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
fn widget_snapshot_is_empty_without_activities() {
    let mut s = setup();
    let now = 1_700_200_000;
    let bundle = s.engine.widget_snapshot_data(
        now - 7 * 86_400,
        now,
        now - 14 * 86_400,
        now - 7 * 86_400,
        30,
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
        s.engine.get_group_by_id(&group_id).map(|g| g.group_id)
    );

    let direct = s.engine.get_route_performances(&group_id, None, None);
    assert_eq!(
        bundle.performances.performances.len(),
        direct.performances.len()
    );

    let expected_consensus = s
        .engine
        .get_consensus_route(&group_id)
        .map(|points| veloqrs::coords::encode(points.as_slice()))
        .unwrap_or_default();
    assert_eq!(bundle.encoded_consensus, expected_consensus);
}

#[test]
fn route_detail_honours_the_group_minimum() {
    let mut s = populated();
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
    p.current_end = end;
    p.current_start = end - 7 * 86_400;
    p.prev_start = end - 14 * 86_400;
    p.prev_end = end - 7 * 86_400;
    p.chronic_start = end - 35 * 86_400;
    p.today_start = end - 86_400;
    p
}

#[test]
fn insights_computes_no_performances_when_nothing_is_recent() {
    let mut s = populated_with_pr_candidate(1_700_100_000);
    let p = insights_params_ending(1_700_200_000 + 400 * 86_400);

    let bundle = s.engine.insights_data(&p);

    assert!(bundle.recent_prs.is_empty());
    assert_eq!(s.engine.performance_computations(), 0);
}

#[test]
fn insights_computes_performances_for_a_section_visited_this_week() {
    let mut s = populated_with_pr_candidate(1_700_150_000);
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
fn insights_computes_performances_for_a_section_visited_on_the_window_edge() {
    let end = 1_700_200_000;
    // The oldest date the seven-day window still holds.
    let mut s = populated_with_pr_candidate(end - 7 * 86_400);
    let p = insights_params_ending(end);

    let bundle = s.engine.insights_data(&p);

    assert!(s.engine.performance_computations() > 0);
    assert_eq!(bundle.recent_prs.len(), 1);
}

#[test]
fn insights_computes_no_performances_on_an_empty_library() {
    let mut s = setup();

    let bundle = s.engine.insights_data(&insights_params());

    assert!(bundle.recent_prs.is_empty());
    assert_eq!(s.engine.performance_computations(), 0);
}

// ============================================================================
// Insights: activity patterns
// ============================================================================

fn pattern_metrics(
    id: &str,
    date: i64,
    moving_time: u32,
    distance: f64,
) -> veloqrs::FfiActivityMetrics {
    veloqrs::FfiActivityMetrics {
        activity_id: id.to_string(),
        name: format!("Fixture {}", id),
        date,
        distance,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: Some(distance / 500.0),
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

const WEEK: i64 = 7 * 86_400;
/// A Tuesday, so the two groups sit on different days of the week.
const PATTERN_EPOCH: i64 = 1_672_704_000;

/// A year of riding in two shapes: a short midweek ride and a long weekend
/// one. Big enough for k-means to emit patterns, which an empty library is
/// not, so the memo is tested against a real answer.
fn pattern_library() -> Setup {
    let mut s = setup();
    let mut rows = Vec::new();
    for week in 0..52i64 {
        rows.push(pattern_metrics(
            &format!("short{}", week),
            PATTERN_EPOCH + week * WEEK,
            3_600,
            30_000.0,
        ));
        rows.push(pattern_metrics(
            &format!("long{}", week),
            PATTERN_EPOCH + week * WEEK + 5 * 86_400,
            10_800,
            90_000.0,
        ));
    }
    s.engine
        .set_activity_metrics_extended(rows)
        .expect("set pattern metrics");
    s
}

/// Every field of every pattern, ordered by the day the pattern sits on.
fn pattern_shape(patterns: &[veloqrs::FfiActivityPattern]) -> Vec<String> {
    let mut shaped: Vec<String> = patterns
        .iter()
        .map(|p| {
            format!(
                "{}/{}/{}/{}/{}/{}/{}/{}/{}/{}/{:?}",
                p.sport_type,
                p.cluster_id,
                p.primary_day,
                p.season_label,
                p.activity_count,
                p.avg_duration_secs,
                p.avg_tss,
                p.avg_distance_meters,
                p.confidence,
                p.days_since_last,
                p.common_sections
            )
        })
        .collect();
    shaped.sort();
    shaped
}

#[test]
fn insights_clusters_once_per_call_and_reuses_it_while_metrics_hold() {
    let mut s = pattern_library();
    let p = insights_params_ending(PATTERN_EPOCH + 52 * WEEK);

    let first = s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 1);
    assert!(!first.all_patterns.is_empty());

    let second = s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 1);
    assert_eq!(
        pattern_shape(&second.all_patterns),
        pattern_shape(&first.all_patterns)
    );
}

#[test]
fn insights_memoised_patterns_match_a_cold_engine() {
    let p = insights_params_ending(PATTERN_EPOCH + 52 * WEEK);

    let mut warm = pattern_library();
    warm.engine.insights_data(&p);
    let memoised = warm.engine.insights_data(&p);

    let mut cold = pattern_library();
    let computed = cold.engine.insights_data(&p);

    assert!(!computed.all_patterns.is_empty());
    assert_eq!(
        pattern_shape(&memoised.all_patterns),
        pattern_shape(&computed.all_patterns)
    );
    assert_eq!(
        pattern_shape(memoised.today_pattern.as_slice()),
        pattern_shape(computed.today_pattern.as_slice())
    );
}

#[test]
fn insights_clusters_again_once_the_newest_activity_moves() {
    let mut s = pattern_library();
    let p = insights_params_ending(PATTERN_EPOCH + 53 * WEEK);

    s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 1);

    // Same row count, newer date: the clusters can move, so the memo must not
    // answer this one.
    s.engine
        .set_activity_metrics_extended(vec![pattern_metrics(
            "long51",
            PATTERN_EPOCH + 52 * WEEK + 5 * 86_400,
            10_800,
            90_000.0,
        )])
        .expect("re-date long51");
    s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 2);
}

#[test]
fn insights_clusters_again_once_the_day_turns_over() {
    let mut s = pattern_library();
    let end = PATTERN_EPOCH + 53 * WEEK;

    s.engine.insights_data(&insights_params_ending(end));
    assert_eq!(s.engine.pattern_computations(), 1);

    // Same rows, next day. A pattern reports how long since it was last
    // ridden, so yesterday's answer is not today's.
    s.engine
        .insights_data(&insights_params_ending(end + 86_400));
    assert_eq!(s.engine.pattern_computations(), 2);
}

#[test]
fn insights_reuses_the_clustering_across_calls_on_the_same_day() {
    let mut s = pattern_library();
    let end = PATTERN_EPOCH + 53 * WEEK;

    s.engine.insights_data(&insights_params_ending(end));
    s.engine.insights_data(&insights_params_ending(end + 3_600));
    assert_eq!(s.engine.pattern_computations(), 1);
}

#[test]
fn insights_clusters_again_once_an_activity_is_added() {
    let mut s = pattern_library();
    let p = insights_params_ending(PATTERN_EPOCH + 53 * WEEK);

    s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 1);

    s.engine
        .set_activity_metrics_extended(vec![pattern_metrics(
            "short52",
            PATTERN_EPOCH + 52 * WEEK,
            3_600,
            30_000.0,
        )])
        .expect("add short52");
    s.engine.insights_data(&p);
    assert_eq!(s.engine.pattern_computations(), 2);
}

// ============================================================================
// Startup
// ============================================================================

#[test]
fn startup_matches_the_calls_it_replaces() {
    let mut s = populated();
    let p = insights_params();
    let ids = vec!["a1".to_string(), "a2".to_string()];

    // Destructured exhaustively: the bundle carries these two fields and
    // nothing the feed does not paint.
    let veloqrs::FfiStartupData {
        summary_card,
        preview_tracks,
    } = s.engine.startup_data(
        p.current_start,
        p.current_end,
        p.prev_start,
        p.prev_end,
        &ids,
    );

    assert_eq!(
        summary_card.current_week.count,
        s.engine
            .get_period_stats(p.current_start, p.current_end)
            .count
    );
    assert_eq!(
        summary_card.prev_week.count,
        s.engine.get_period_stats(p.prev_start, p.prev_end).count
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
            veloqrs::coords::decode(&track.encoded_coords).len(),
            expected.points.len()
        );
    }
}

#[test]
fn startup_skips_ids_with_no_signature() {
    let mut s = populated();
    let p = insights_params();
    let ids = vec!["nope".to_string(), "a1".to_string()];

    let bundle = s.engine.startup_data(
        p.current_start,
        p.current_end,
        p.prev_start,
        p.prev_end,
        &ids,
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
    let mut s = populated();
    let p = insights_params();

    let bundle = s.engine.startup_data(
        p.current_start,
        p.current_end,
        p.prev_start,
        p.prev_end,
        &[],
    );

    assert!(bundle.preview_tracks.is_empty());
    assert_eq!(
        bundle.summary_card.current_week.count,
        s.engine
            .get_period_stats(p.current_start, p.current_end)
            .count
    );
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

/// The ledger, the excluded laps and the efficiency trend are keyed on the
/// section id alone, so a visit paid five more lock acquisitions for reads the
/// first bundle was already positioned to make.
#[test]
fn section_detail_carries_the_ledger_the_laps_and_the_trend() {
    let mut s = populated();
    let bundle = s.engine.section_detail_data("auto1", 500.0);

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
        s.engine.pinned_section_version("auto1")
    );
    assert_eq!(
        bundle.excluded_laps.len(),
        s.engine.get_excluded_section_laps("auto1").len()
    );
    assert_eq!(
        bundle.efficiency_trend.is_some(),
        s.engine.get_section_efficiency_trend("auto1").is_some()
    );
}

/// A pinned version has to read as pinned in the bundle, which is the one
/// field `get_geometry_versions` computed rather than read.
#[test]
fn a_pinned_version_reads_as_pinned_in_the_bundle() {
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

    let bundle = s.engine.section_detail_data("auto1", 500.0);

    assert_eq!(bundle.pinned_version, Some(version));
    let pinned: Vec<i64> = bundle
        .geometry_versions
        .iter()
        .filter(|v| v.pinned)
        .map(|v| v.version)
        .collect();
    assert_eq!(pinned, vec![version]);
}

/// An unknown id returns the empty bundle rather than failing, the way the
/// separate reads did.
#[test]
fn section_detail_for_an_unknown_id_carries_no_ledger() {
    let mut s = populated();
    let bundle = s.engine.section_detail_data("no-such-section", 500.0);

    assert!(bundle.section.is_none());
    assert!(bundle.history.is_empty());
    assert!(bundle.geometry_versions.is_empty());
    assert_eq!(bundle.pinned_version, None);
    assert!(bundle.excluded_laps.is_empty());
    assert!(bundle.efficiency_trend.is_none());
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

    let calendar = s.engine.get_section_calendar_summary("auto1", None);
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
