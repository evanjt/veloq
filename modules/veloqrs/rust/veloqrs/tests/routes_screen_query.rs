//! The routes screen orders, filters and counts before it pages.
//!
//! Scenario: a library with more groups and sections than one page holds, and
//! a screen that asks for the first page under a name order, a search and a
//! filter set.
//!
//! Expected behaviour: the page is the first page of the whole library under
//! that order, not the first page of the catalogue re-ordered afterwards, and
//! the two review counters are taken over the unfiltered catalogue.
//!
//! Run: `cargo test --test routes_screen_query -p veloqrs`

use tempfile::TempDir;
use tracematch::{Direction, FrequentSection, GpsPoint, SectionPortion};
use veloqrs::sections::CreateSectionParams;
use veloqrs::{
    FfiGroupSort, FfiRoutesScreenQuery, FfiSectionFilters, FfiSectionSort, PersistentEngine,
};

const NOW: i64 = 1_750_000_000;
const DAY: i64 = 86_400;
const POINTS_PER_TRACK: usize = 40;
const ACTIVITIES: usize = 24;

/// One short line per activity, each in its own place so the groups do not
/// collapse into one.
fn track(seed: usize) -> Vec<GpsPoint> {
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

/// Names run Z down to A as the index rises, so an order taken over the whole
/// library and an order taken over the first page disagree on every row.
fn name_for(i: usize) -> String {
    format!("{} route", (b'Z' - (i % 26) as u8) as char)
}

/// A detected section, which is what the two review counters and the auto
/// filters are about. `is_user_defined` is the accept.
fn auto_section(id: &str, seed: usize) -> FrequentSection {
    FrequentSection {
        id: id.to_string(),
        name: Some(name_for(seed)),
        sport_type: "Ride".to_string(),
        // Its own ground, away from the custom sections, or the save drops it
        // as dominated by one of them and the catalogue has no auto at all.
        polyline: track(seed + 1_000),
        representative_activity_id: format!("a{seed}"),
        representative_range: None,
        activity_ids: vec![format!("a{seed}")],
        activity_portions: vec![SectionPortion {
            activity_id: format!("a{seed}"),
            start_index: 0,
            end_index: POINTS_PER_TRACK as u32 - 1,
            distance_meters: 900.0 + seed as f64,
            direction: Direction::Same,
        }],
        visit_count: (seed + 1) as u32,
        distance_meters: 900.0 + seed as f64,
        activity_traces: Default::default(),
        confidence: 0.9,
        observation_count: 1,
        average_spread: 5.0,
        point_density: Vec::new(),
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        enrichment: Default::default(),
        rank: None,
        version: 1,
        updated_at: None,
        created_at: None,
        consensus_state: None,
    }
}

fn seeded(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine");
    for i in 0..ACTIVITIES {
        let id = format!("a{i}");
        engine
            .add_activity(id.clone(), track(i), "Ride".into())
            .expect("add activity");
        engine
            .update_activity_metadata(
                &id,
                Some(NOW - (i as i64) * DAY),
                Some("ride"),
                Some(1_000.0 + i as f64 * 100.0),
                Some(3_600),
            )
            .expect("metadata");
        engine
            .create_section(CreateSectionParams {
                sport_type: "Ride".into(),
                polyline: track(i),
                distance_meters: 1_100.0 + i as f64,
                name: Some(name_for(i)),
                source_activity_id: Some(id.clone()),
                start_index: Some(0),
                end_index: Some(POINTS_PER_TRACK as u32 - 1),
            })
            .expect("create section");
    }
    let detected: Vec<FrequentSection> = (0..ACTIVITIES)
        .map(|i| auto_section(&format!("auto_{i}"), i))
        .collect();
    engine.apply_sections(detected).expect("apply sections");
    // A third of them accepted, the way the athlete accepts one, so the two
    // counters are different numbers and a test cannot pass on nothing.
    let to_accept: Vec<String> = engine
        .get_section_summaries()
        .iter()
        .filter(|s| s.section_type == "auto")
        .enumerate()
        .filter(|(i, _)| i % 3 == 0)
        .map(|(_, s)| s.id.clone())
        .collect();
    for id in &to_accept {
        engine.accept_section(id).expect("accept section");
    }
    engine.load().expect("load");
    engine
}

fn query() -> FfiRoutesScreenQuery {
    FfiRoutesScreenQuery {
        group_limit: 3,
        group_offset: 0,
        section_limit: 3,
        section_offset: 0,
        min_group_activity_count: 0,
        group_sort: FfiGroupSort::Activities,
        group_search: String::new(),
        section_sort: FfiSectionSort::Visits,
        section_search: String::new(),
        section_filters: FfiSectionFilters {
            hide_custom: false,
            hide_auto: false,
            hide_disabled: false,
            hide_unaccepted: false,
        },
        section_sport_type: None,
        user_lat: f64::NAN,
        user_lng: f64::NAN,
    }
}

#[test]
fn name_order_takes_the_first_page_of_the_library_not_of_a_page() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);

    let all = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        section_sort: FfiSectionSort::Name,
        ..query()
    });
    let mut every_name: Vec<String> = all
        .sections
        .iter()
        .map(|s| s.name.clone().unwrap_or_default())
        .collect();
    assert!(
        every_name.len() > 3,
        "the fixture needs more sections than one page"
    );
    every_name.sort();

    let page = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_sort: FfiSectionSort::Name,
        ..query()
    });
    let paged: Vec<String> = page
        .sections
        .iter()
        .map(|s| s.name.clone().unwrap_or_default())
        .collect();

    assert_eq!(
        paged,
        every_name[..3],
        "the page is the library's first three"
    );
}

#[test]
fn a_search_reaches_past_the_first_page() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);

    // The name the default order puts last, so a page-sized search finds it
    // only if the search ran before the paging.
    let target = engine
        .get_routes_screen_data(FfiRoutesScreenQuery {
            section_limit: 1_000,
            ..query()
        })
        .sections
        .last()
        .expect("a section")
        .name
        .clone()
        .unwrap_or_default();

    let found = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_search: target.clone(),
        ..query()
    });

    assert!(
        found
            .sections
            .iter()
            .any(|s| s.name.as_deref() == Some(target.as_str())),
        "searching for {target:?} found {:?}",
        found.sections.iter().map(|s| &s.name).collect::<Vec<_>>()
    );
}

#[test]
fn the_review_counters_cover_the_catalogue_not_the_page() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);

    let page = engine.get_routes_screen_data(query());
    let whole = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });

    assert!(
        whole.accepted_auto_count > 0 && whole.unaccepted_auto_count > 0,
        "the fixture needs both an accepted and an unaccepted auto section, \
         or this test passes on nothing: {} accepted, {} unaccepted",
        whole.accepted_auto_count,
        whole.unaccepted_auto_count
    );
    assert!(
        whole.unaccepted_auto_count > page.sections.len() as u32,
        "the counter has to exceed one page or the page could carry it"
    );
    assert_eq!(
        page.accepted_auto_count, whole.accepted_auto_count,
        "the accepted counter moved with the page size"
    );
    assert_eq!(
        page.unaccepted_auto_count, whole.unaccepted_auto_count,
        "the unaccepted counter moved with the page size"
    );
}

#[test]
fn a_hidden_filter_narrows_the_page_and_its_total() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);

    let shown = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    assert!(
        !shown.sections.is_empty(),
        "the fixture needs sections to hide"
    );

    let hidden = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        section_filters: FfiSectionFilters {
            hide_custom: true,
            hide_auto: true,
            hide_disabled: true,
            hide_unaccepted: true,
        },
        ..query()
    });

    assert!(
        hidden.sections.is_empty(),
        "hiding every kind still returned {} sections",
        hidden.sections.len()
    );
    assert_eq!(hidden.filtered_section_count, 0);
    assert_eq!(
        hidden.section_count, shown.section_count,
        "the catalogue total is not the filtered total"
    );
}
