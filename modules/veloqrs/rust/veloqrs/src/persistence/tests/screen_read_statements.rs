//! Scenario: a screen read that was flat in the library starts issuing a query
//! per activity or per section, which blocks the JavaScript thread for longer
//! as the library grows and fails no other test.
//!
//! Expected behaviour: each read issues the same number of statements against a
//! library three times the size, or, for the read that returns the whole
//! catalogue, a count that grows no faster than the catalogue it returns. The
//! count reads no clock, so it holds on every machine. The virtual machine
//! steps each read takes are held to a ceiling in the same way. Neither sees a
//! Rust loop over an in-memory catalogue, which a bench would measure.

use std::hint::black_box;
use std::sync::Mutex;

use tracematch::GpsPoint;

use crate::sections::CreateSectionParams;
use crate::{FfiInsightsParams, FfiTimestampRange, PersistentEngine};

const SMALL: usize = 60;
const LARGE: usize = 180;
const ACTIVITIES_PER_SECTION: usize = 4;
const POINTS_PER_TRACK: usize = 100;
const DAY: i64 = 86_400;
const NOW: i64 = 1_757_000_000;

static STATEMENTS: Mutex<usize> = Mutex::new(0);

fn count(_sql: &str) {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) += 1;
}

fn statements_in(engine: &mut PersistentEngine, read: impl FnOnce(&mut PersistentEngine)) -> usize {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) = 0;
    crate::test_trace::trace_statements!(engine.db, count);
    read(engine);
    crate::test_trace::untrace(&engine.db);
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner())
}

fn track(seed: usize) -> Vec<GpsPoint> {
    let seed = seed - seed % ACTIVITIES_PER_SECTION;
    let base_lat = 46.0 + (seed % 20) as f64 * 0.05;
    let base_lng = 7.0 + (seed / 20) as f64 * 0.05;
    (0..POINTS_PER_TRACK)
        .map(|i| GpsPoint {
            latitude: base_lat + i as f64 * 0.0001,
            longitude: base_lng,
            elevation: Some(500.0 + i as f64),
        })
        .collect()
}

fn seeded(activities: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..activities {
        let id = format!("a{i}");
        engine
            .add_activity(id.clone(), track(i), "Ride".into())
            .expect("add activity");
        engine
            .update_activity_metadata(
                &id,
                Some(NOW - (i as i64) * DAY),
                Some("ride"),
                Some(12_345.0),
                Some(3_600),
            )
            .expect("metadata");
        if i % ACTIVITIES_PER_SECTION == 0 {
            engine
                .create_section(CreateSectionParams {
                    sport_type: "Ride".into(),
                    polyline: track(i),
                    distance_meters: 1_100.0,
                    name: Some(format!("Section {i}")),
                    source_activity_id: Some(id.clone()),
                    start_index: Some(0),
                    end_index: Some(POINTS_PER_TRACK as u32 - 1),
                })
                .expect("create section");
        }
    }
    // Grouping is lazy, and `load` reads back only what was stored.
    assert!(
        !engine.get_groups().is_empty(),
        "the seed has no route groups"
    );
    engine.load().expect("load");
    engine
}

#[derive(Clone, Copy)]
enum Side {
    Small,
    Large,
}

/// The first section and the first route group of a seeded library, which
/// differ between the two libraries.
struct Ids {
    section: String,
    group: String,
}

fn ids(engine: &mut PersistentEngine) -> Ids {
    Ids {
        section: engine.get_section_summaries()[0].id.clone(),
        group: engine.get_groups()[0].group_id.clone(),
    }
}

fn insights_params() -> FfiInsightsParams {
    let week = 7 * DAY;
    FfiInsightsParams {
        history_limit: 20,
        current_start: (NOW - week) as f64,
        current_end: NOW as f64,
        prev_start: (NOW - 2 * week) as f64,
        prev_end: (NOW - week) as f64,
        chronic_start: (NOW - 4 * week) as f64,
        today_start: (NOW - DAY) as f64,
        include_sections: true,
        ranked_limit: 20,
        active_window_days: 180,
        efficiency_per_sport: 5,
        efficiency_min_hr_change_bpm: 1,
        efficiency_limit: 10,
        efficiency_min_efforts: 3,
        efficiency_declining_min_efforts: 5,
        strength_month: FfiTimestampRange {
            start_ts: (NOW - 30 * DAY) as f64,
            end_ts: NOW as f64,
        },
        strength_weeks: vec![FfiTimestampRange {
            start_ts: (NOW - week) as f64,
            end_ts: NOW as f64,
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

/// Keeps a read's result alive so the optimiser cannot drop the read.
fn consume<T>(value: T) {
    black_box(value);
}

type Read = Box<dyn Fn(Side, &mut PersistentEngine)>;

fn reads(small: Ids, large: Ids) -> Vec<(&'static str, Read)> {
    let params = insights_params();
    let week = 7 * DAY;
    let pick = std::rc::Rc::new(move |side: Side| match side {
        Side::Small => (small.section.clone(), small.group.clone()),
        Side::Large => (large.section.clone(), large.group.clone()),
    });
    let (for_section, for_performance, for_route, for_route_performance) =
        (pick.clone(), pick.clone(), pick.clone(), pick);
    vec![
        ("stats", Box::new(|_, e| consume(e.stats()))),
        (
            "activity_count",
            Box::new(|_, e| {
                consume(e.activity_count());
            }),
        ),
        (
            "get_section_summaries",
            Box::new(|_, e| consume(e.get_section_summaries())),
        ),
        (
            "map_screen_data",
            Box::new(|_, e| {
                consume(e.map_screen_data(
                    NOW - 365 * DAY,
                    NOW,
                    vec![],
                    crate::MapDistanceBand::All,
                    true,
                    false,
                    false,
                    String::new(),
                ))
            }),
        ),
        (
            "map_screen_data_with_route_lines",
            Box::new(|_, e| {
                consume(e.map_screen_data(
                    NOW - 365 * DAY,
                    NOW,
                    vec![],
                    crate::MapDistanceBand::All,
                    true,
                    true,
                    false,
                    String::new(),
                ))
            }),
        ),
        (
            "map_screen_data_with_sections",
            Box::new(|_, e| {
                consume(e.map_screen_data(
                    NOW - 365 * DAY,
                    NOW,
                    vec![],
                    crate::MapDistanceBand::All,
                    true,
                    false,
                    true,
                    String::new(),
                ))
            }),
        ),
        (
            "routes_screen_data",
            Box::new(|_, e| {
                // A page smaller than the smaller library's lists, so the
                // page is the same size in both and only a scan can grow.
                consume(e.get_routes_screen_data(crate::FfiRoutesScreenQuery {
                    group_limit: 10,
                    section_limit: 10,
                    min_group_activity_count: 2,
                    ..Default::default()
                }))
            }),
        ),
        (
            "startup_data",
            Box::new(move |_, e| {
                consume(e.startup_data(NOW - week, NOW, NOW - 2 * week, NOW - week, &[]))
            }),
        ),
        (
            "activity_detail_data",
            Box::new(|_, e| consume(e.activity_detail_data("a0", 2))),
        ),
        (
            "insights_data",
            Box::new(move |_, e| consume(e.insights_data(&params))),
        ),
        (
            "section_detail_data",
            Box::new(move |side, e| consume(e.section_detail_data(&for_section(side).0))),
        ),
        (
            "section_detail_performance",
            Box::new(move |side, e| {
                consume(e.section_detail_performance(&for_performance(side).0, 365, None))
            }),
        ),
        (
            "route_detail_data",
            Box::new(move |side, e| {
                consume(e.route_detail_data(&for_route(side).1, Some("a1"), 2))
            }),
        ),
        (
            "route_detail_performance",
            Box::new(move |side, e| {
                consume(e.route_detail_performance(&for_route_performance(side).1, 365, None))
            }),
        ),
        (
            "best_efforts_data",
            Box::new(|_, e| consume(e.best_efforts_data(0, NOW))),
        ),
        (
            "training_screen_data",
            Box::new(|_, e| {
                let span = |days: i64| FfiTimestampRange {
                    start_ts: (NOW - days * DAY) as f64,
                    end_ts: NOW as f64,
                };
                consume(e.training_screen_data(&crate::FfiTrainingScreenWindows {
                    heatmap_first_day: "2024-09-01".into(),
                    heatmap_last_day: "2025-09-04".into(),
                    months: span(730),
                    year_current: span(365),
                    year_previous: span(730),
                    month_current: span(30),
                    month_previous: span(60),
                }))
            }),
        ),
        (
            "fitness_screen_data",
            Box::new(|_, e| consume(e.fitness_screen_data("2025-09-04"))),
        ),
        (
            "widget_snapshot_data",
            Box::new(move |_, e| {
                consume(e.widget_snapshot_data(
                    NOW - week,
                    NOW,
                    NOW - 2 * week,
                    NOW - week,
                    14,
                    100,
                ))
            }),
        ),
    ]
}

#[test]
fn no_screen_read_issues_more_statements_for_a_larger_library() {
    let mut small = seeded(SMALL);
    let mut large = seeded(LARGE);

    for (name, read) in reads(ids(&mut small), ids(&mut large)) {
        let a = statements_in(&mut small, |e| read(Side::Small, e));
        let b = statements_in(&mut large, |e| read(Side::Large, e));
        assert!(
            b <= a,
            "{name} ran {b} statements against {LARGE} activities and {a} against {SMALL}, \
             more than the {a} it is allowed. It is querying per row rather than \
             looking up, and it blocks the JavaScript thread for every statement."
        );
    }
}

static STEPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn count_step() -> bool {
    STEPS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    false
}

/// The SQLite virtual machine steps `read` costs on `engine`'s connection.
fn steps_in(engine: &mut PersistentEngine, read: impl FnOnce(&mut PersistentEngine)) -> usize {
    STEPS.store(0, std::sync::atomic::Ordering::SeqCst);
    engine.db.progress_handler(1, Some(count_step)).unwrap();
    read(engine);
    engine.db.progress_handler(1, None::<fn() -> bool>).unwrap();
    STEPS.load(std::sync::atomic::Ordering::SeqCst)
}

/// How many times dearer, in virtual machine steps, a read may get for three
/// times the library. Steps are counted, not timed, so the same library gives
/// the same count on every machine and the ceilings sit close to what each
/// read costs.
///
/// A read that pages, windows or looks up returns what does not grow with the
/// library, so its steps stay level. A read that returns a row per catalogue
/// entry grows with the catalogue, and a loop over it inside a loop over the
/// activities would be nine times dearer. The three reads between them grow
/// with the data they assemble but stay under linear, and their ceiling holds
/// them there.
fn step_ceiling(name: &str) -> f64 {
    match name {
        "stats"
        | "activity_count"
        | "map_screen_data"
        | "startup_data"
        | "fitness_screen_data"
        | "section_detail_performance"
        | "route_detail_performance"
        | "widget_snapshot_data" => 1.0,
        // Both lists page through their order indexes and the totals come
        // from stored counts, so it stays level; the page's own groups differ
        // between the two libraries by a step.
        "routes_screen_data" => 1.01,
        // All time ranks and counts every climbing activity, so it grows with
        // the library and no faster.
        "best_efforts_data" => 3.0,
        // Two years of monthly rows and totals sum every activity in them, so
        // it grows with the library and no faster.
        "training_screen_data" => 3.0,
        "get_section_summaries" | "map_screen_data_with_sections" => 3.5,
        // The layer names every route it draws and counts its activities, a
        // lookup per route, so it grows with the routes and no faster.
        "map_screen_data_with_route_lines" => 3.0,
        "insights_data" => 1.62,
        "activity_detail_data" | "section_detail_data" | "route_detail_data" => 2.6,
        other => panic!("{other} has no step ceiling"),
    }
}

#[test]
fn no_screen_read_takes_more_steps_than_its_ceiling_for_a_larger_library() {
    let mut small = seeded(SMALL);
    let mut large = seeded(LARGE);

    for (name, read) in reads(ids(&mut small), ids(&mut large)) {
        let a = steps_in(&mut small, |e| read(Side::Small, e));
        let b = steps_in(&mut large, |e| read(Side::Large, e));
        let ceiling = step_ceiling(name);
        assert!(
            b as f64 <= a as f64 * ceiling,
            "{name} took {b} steps against {LARGE} activities and {a} against {SMALL}, \
             over its ceiling of {ceiling:.1}x for three times the library. It is scanning \
             rather than looking up, and it blocks the JavaScript thread for every step."
        );
    }
}

#[test]
fn map_screen_data_carries_the_route_count_and_the_lines_only_when_asked() {
    let mut engine = seeded(LARGE);
    let routes = engine
        .get_groups()
        .iter()
        .filter(|group| group.activity_ids.len() >= 2)
        .count() as u32;
    assert!(routes > 0, "the seed has no route a map would draw");

    let plain = engine.map_screen_data(
        NOW - 365 * DAY,
        NOW,
        vec![],
        crate::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );
    assert_eq!(plain.route_count, routes);
    assert!(plain.route_lines.is_none());

    let with_lines = engine.map_screen_data(
        NOW - 365 * DAY,
        NOW,
        vec![],
        crate::MapDistanceBand::All,
        true,
        true,
        false,
        String::new(),
    );
    assert_eq!(with_lines.route_count, routes);
    let layer = with_lines.route_lines.expect("the layer is on");
    // The write connection is not one the read cache vouches for, so nothing
    // read on it can be held and passed back.
    assert!(layer.stamp.is_none());
    let lines = layer.routes.expect("an unstamped read ships the lines");
    assert_eq!(lines.len() as u32, routes);
    assert!(lines.iter().all(|line| !line.polyline.is_empty()));
}

#[test]
fn map_screen_data_names_each_route_line_and_counts_its_activities() {
    let mut engine = seeded(SMALL);
    let sizes: std::collections::HashMap<String, u32> = engine
        .get_groups()
        .iter()
        .map(|group| (group.group_id.clone(), group.activity_ids.len() as u32))
        .collect();
    let read = |engine: &mut PersistentEngine| {
        engine
            .map_screen_data(
                NOW - 365 * DAY,
                NOW,
                vec![],
                crate::MapDistanceBand::All,
                true,
                true,
                false,
                String::new(),
            )
            .route_lines
            .expect("the layer is on")
            .routes
            .expect("an unstamped read ships the lines")
    };
    let lines = read(&mut engine);
    let typed = lines
        .first()
        .expect("the seed draws a route")
        .route_id
        .clone();
    engine
        .set_route_name(&typed, Some("Harbour loop"))
        .expect("rename");

    let lines = read(&mut engine);
    let shown = engine.get_all_route_names();
    for line in &lines {
        assert_eq!(Some(&line.activity_count), sizes.get(&line.route_id));
        assert_eq!(Some(&line.name), shown.get(&line.route_id));
    }
    let renamed = lines
        .iter()
        .find(|line| line.route_id == typed)
        .expect("still drawn");
    assert_eq!(renamed.name, "Harbour loop");
}

#[test]
fn map_screen_data_gives_each_route_line_the_route_list_distance() {
    let mut engine = seeded(SMALL);
    // Each activity's distance differs, so a line carrying another route's
    // figure, or none, reads wrong.
    let metrics = (0..SMALL)
        .map(|i| crate::ActivityMetrics {
            activity_id: format!("a{i}"),
            date: NOW - (i as i64) * DAY,
            distance: 10_000.0 + i as f64 * 37.0,
            ..Default::default()
        })
        .collect();
    engine.set_activity_metrics(metrics).expect("metrics");
    let listed: std::collections::HashMap<String, f64> =
        crate::persistence::routes::pooled::group_summaries(&engine.db)
            .into_iter()
            .map(|group| (group.group_id, group.distance_meters))
            .collect();

    let lines = engine
        .map_screen_data(
            NOW - 365 * DAY,
            NOW,
            vec![],
            crate::MapDistanceBand::All,
            true,
            true,
            false,
            String::new(),
        )
        .route_lines
        .expect("the layer is on")
        .routes
        .expect("an unstamped read ships the lines");
    assert!(!lines.is_empty(), "the seed draws no route");
    for line in &lines {
        let distance = listed.get(&line.route_id).copied().expect("a listed route");
        assert!(distance > 0.0);
        assert_eq!(line.distance_meters, distance, "{}", line.route_id);
    }
}

#[test]
fn test_map_screen_data_section_overlay_gate() {
    let engine = seeded(SMALL);
    let count = engine.get_section_count();
    assert!(count > 0);

    let plain = engine.map_screen_data(
        NOW - 365 * DAY,
        NOW,
        vec![],
        crate::MapDistanceBand::All,
        true,
        false,
        false,
        String::new(),
    );
    assert_eq!(plain.section_count, count);
    assert!(plain.sections.is_none());

    let with_sections = engine.map_screen_data(
        NOW - 365 * DAY,
        NOW,
        vec![],
        crate::MapDistanceBand::All,
        true,
        false,
        true,
        String::new(),
    );
    assert_eq!(with_sections.section_count, count);
    let overlay = with_sections.sections.expect("sections on");
    assert!(overlay.stamp.is_none());
    assert_eq!(
        overlay
            .sections
            .expect("an unstamped read ships the overlay")
            .len() as u32,
        count
    );
}
