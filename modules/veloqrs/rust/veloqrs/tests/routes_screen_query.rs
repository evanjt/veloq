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
//! Run: `cargo test --test app -p veloqrs -- routes_screen_query::`

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
        representative_range: Some((0, POINTS_PER_TRACK as u32)),
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
        group_sport_type: None,
        section_sport_type: None,
        user_lat: f64::NAN,
        user_lng: f64::NAN,
    }
}

#[test]
fn name_order_takes_the_first_page_of_the_library_not_of_a_page() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);

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
fn test_route_screen_name_sort_uses_displayed_name_and_id_fallback() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let conn = rusqlite::Connection::open(dir.path().join("routes.db")).unwrap();
    conn.execute_batch(
        "DELETE FROM route_groups;
         DELETE FROM route_names;
         INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
           VALUES ('r_1', 'a1', '[]', ''), ('r_2', 'a2', '[]', ''), ('r_3', 'a3', '[]', '');
         INSERT INTO route_names (route_id, custom_name)
           VALUES ('r_1', 'Zulu'), ('r_2', 'alpha');",
    )
    .unwrap();

    let page = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        group_sort: FfiGroupSort::Name,
        group_limit: 1_000,
        ..query()
    });
    assert_eq!(
        page.groups.first().map(|group| group.group_id.as_str()),
        Some("r_2")
    );
    let unnamed = page
        .groups
        .iter()
        .position(|group| group.group_id == "r_3")
        .unwrap();
    let zulu = page
        .groups
        .iter()
        .position(|group| group.group_id == "r_1")
        .unwrap();
    assert!(unnamed < zulu);
}

#[test]
fn test_section_screen_name_sort_uses_displayed_name_and_id_fallback() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);
    let mut ids: Vec<_> = engine
        .get_section_summaries()
        .into_iter()
        .filter(|section| section.section_type == "custom")
        .map(|section| section.id)
        .collect();
    ids.sort();
    assert!(ids.len() > 2);
    engine.set_section_name(&ids[0], Some("Zulu")).unwrap();
    engine.set_section_name(&ids[1], Some("alpha")).unwrap();
    engine.set_section_name(&ids[2], None).unwrap();

    let page = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_sort: FfiSectionSort::Name,
        section_limit: 1_000,
        ..query()
    });
    let alpha = page
        .sections
        .iter()
        .position(|section| section.id == ids[1])
        .unwrap();
    let unnamed = page
        .sections
        .iter()
        .position(|section| section.id == ids[2])
        .unwrap();
    let zulu = page
        .sections
        .iter()
        .position(|section| section.id == ids[0])
        .unwrap();
    assert!(alpha < unnamed);
    assert!(unnamed < zulu);
}

#[test]
fn a_search_reaches_past_the_first_page() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);

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

/// The two chips beside the review counters say how many sections the athlete
/// can filter to. A page-sized tally is a lower bound nothing labels as one,
/// and the retired tally taken after `hide_disabled` reads zero by default.
#[test]
fn the_custom_and_retired_counters_cover_the_catalogue_not_the_page() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);
    let retired: Vec<String> = engine
        .get_section_summaries()
        .iter()
        .filter(|s| s.section_type == "auto")
        .take(4)
        .map(|s| s.id.clone())
        .collect();
    for id in &retired {
        engine.disable_section(id).expect("disable section");
    }
    engine.load().expect("load");

    let page = engine.get_routes_screen_data(query());
    let whole = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });

    assert!(
        whole.custom_count > page.sections.len() as u32,
        "the custom counter has to exceed one page or the page could carry it"
    );
    assert_eq!(
        page.custom_count, whole.custom_count,
        "custom moved with the page size"
    );
    assert_eq!(
        page.retired_count,
        retired.len() as u32,
        "retired moved with the page size"
    );
    assert_eq!(page.retired_count, whole.retired_count);

    // The chip's own filter is what its figure has to survive: hiding the
    // retired rows is the default, and the figure is what would come back.
    let hidden = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_filters: FfiSectionFilters {
            hide_disabled: true,
            ..query().section_filters
        },
        ..query()
    });

    assert_eq!(hidden.retired_count, retired.len() as u32);
    assert_eq!(hidden.custom_count, whole.custom_count);
}

#[test]
fn retired_auto_sections_follow_the_removed_filter_and_sort_after_visible_rows() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);
    let before = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    let retired = engine
        .get_section_summaries()
        .iter()
        .find(|s| s.section_type == "auto" && !s.is_user_defined)
        .expect("auto section")
        .id
        .clone();
    engine.disable_section(&retired).expect("disable section");

    for section_sort in [FfiSectionSort::Visits, FfiSectionSort::Name] {
        let shown = engine.get_routes_screen_data(FfiRoutesScreenQuery {
            section_limit: 1_000,
            section_sort,
            ..query()
        });
        let hidden = engine.get_routes_screen_data(FfiRoutesScreenQuery {
            section_limit: 1_000,
            section_sort,
            section_filters: FfiSectionFilters {
                hide_disabled: true,
                ..query().section_filters
            },
            ..query()
        });

        assert_eq!(shown.section_count, before.section_count - 1);
        assert_eq!(hidden.section_count, shown.section_count);
        assert_eq!(shown.accepted_auto_count, before.accepted_auto_count);
        assert_eq!(
            shown.unaccepted_auto_count,
            before.unaccepted_auto_count - 1
        );
        assert_eq!(shown.retired_count, 1);
        assert_eq!(shown.sections.last().map(|s| &s.id), Some(&retired));
        assert!(shown.sections.last().expect("last").disabled);
        assert!(!hidden.sections.iter().any(|s| s.id == retired));
        assert_eq!(
            hidden.filtered_section_count + 1,
            shown.filtered_section_count
        );
    }
}

#[test]
fn disabled_custom_sections_follow_the_removed_filter_too() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = seeded(&dir);
    let custom = engine
        .get_section_summaries()
        .iter()
        .find(|s| s.section_type == "custom")
        .expect("custom section")
        .id
        .clone();
    let before = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    engine.disable_section(&custom).expect("disable section");

    let shown = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    let hidden = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        section_filters: FfiSectionFilters {
            hide_disabled: true,
            ..query().section_filters
        },
        ..query()
    });

    assert_eq!(shown.sections.last().map(|s| &s.id), Some(&custom));
    assert!(!hidden.sections.iter().any(|s| s.id == custom));
    assert_eq!(
        shown.filtered_section_count,
        hidden.filtered_section_count + 1
    );
    assert_eq!(shown.section_count, before.section_count - 1);
    assert_eq!(hidden.section_count, shown.section_count);
}

#[test]
fn the_review_counters_cover_the_catalogue_not_the_page() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);

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
    let engine = seeded(&dir);

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

// ============================================================================
// The record mark the sections list draws
// ============================================================================
//
// The feed card marks the activity that set a section record and the activity
// plot marks the encounter. The list row had nothing, so the row record carries
// the same fact keyed by section: the record holder is also the latest activity
// to travel it.

/// A second connection on the same file, the way the indicator tests reach
/// rows the engine has no setter for.
fn raw(dir: &TempDir) -> rusqlite::Connection {
    rusqlite::Connection::open(dir.path().join("routes.db")).expect("raw open")
}

/// A section `activity_id` travels, by the junction the engine wrote.
fn section_travelled_by(db: &rusqlite::Connection, activity_id: &str) -> String {
    db.query_row(
        "SELECT section_id FROM section_activities WHERE activity_id = ?1 LIMIT 1",
        rusqlite::params![activity_id],
        |r| r.get(0),
    )
    .expect("a section the activity travels")
}

/// The record row the indicator pass writes, placed by hand so the test says
/// which activity holds the record rather than depending on the pass.
fn set_record(db: &rusqlite::Connection, section_id: &str, activity_id: &str) {
    db.execute(
        "INSERT OR REPLACE INTO activity_indicators
         (activity_id, indicator_type, target_id, target_name, direction,
          lap_time, trend, computed_at)
         VALUES (?1, 'section_pr', ?2, '', 'same', 100.0, 0, 0)",
        rusqlite::params![activity_id, section_id],
    )
    .expect("insert indicator");
}

fn row_flag(engine: &PersistentEngine, section_id: &str) -> bool {
    let page = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    page.sections
        .iter()
        .find(|s| s.id == section_id)
        .unwrap_or_else(|| panic!("{section_id} is on the page"))
        .latest_is_record
}

#[test]
fn a_section_whose_latest_outing_holds_its_record_is_flagged() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let db = raw(&dir);

    // `a0` is the newest activity in the fixture: the dates run backwards from
    // NOW as the index rises.
    let newest = section_travelled_by(&db, "a0");
    set_record(&db, &newest, "a0");

    assert!(
        row_flag(&engine, &newest),
        "the record is held by the section's most recent outing"
    );
}

#[test]
fn a_record_set_on_an_older_outing_is_not_flagged() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let db = raw(&dir);

    // A section both `a0` and an older activity travel, with the record on the
    // older one: the athlete's last time here was not their best.
    let shared = section_travelled_by(&db, "a0");
    db.execute(
        "INSERT OR REPLACE INTO section_activities
         (section_id, activity_id, direction, start_index, end_index,
          distance_meters, lap_time, excluded)
         VALUES (?1, 'a5', 'same', 0, 39, 900.0, 200.0, 0)",
        rusqlite::params![shared],
    )
    .expect("add an older traversal");
    set_record(&db, &shared, "a5");

    assert!(
        !row_flag(&engine, &shared),
        "the record is older than the latest outing, so the row claims nothing"
    );
}

#[test]
fn a_section_with_no_record_row_is_not_flagged() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);

    let page = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });

    assert!(
        page.sections.iter().all(|s| !s.latest_is_record),
        "nothing holds a record until the indicator pass writes one"
    );
}

#[test]
fn a_page_shows_the_same_names_as_a_read_that_names_the_whole_catalogue() {
    let dir = TempDir::new().expect("temp dir");
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
                Some(1_000.0),
                Some(3_600),
            )
            .expect("metadata");
    }
    let detected: Vec<FrequentSection> = (0..ACTIVITIES)
        .map(|i| FrequentSection {
            name: None,
            ..auto_section(&format!("auto_{i}"), i)
        })
        .collect();
    engine.apply_sections(detected).expect("apply sections");
    // Grouping is lazy, and `load` reads back only what was stored.
    assert!(
        !engine.get_groups().is_empty(),
        "the seed has no route groups"
    );
    engine.load().expect("load");

    let names_under = |sort: FfiSectionSort, group_sort: FfiGroupSort| {
        let screen = engine.get_routes_screen_data(FfiRoutesScreenQuery {
            group_limit: 100,
            section_limit: 100,
            section_sort: sort,
            group_sort,
            ..query()
        });
        let mut sections: Vec<_> = screen
            .sections
            .into_iter()
            .map(|s| (s.id, s.name))
            .collect();
        let mut groups: Vec<_> = screen
            .groups
            .into_iter()
            .map(|g| (g.group_id, g.custom_name))
            .collect();
        sections.sort();
        groups.sort();
        (sections, groups)
    };
    let paged = names_under(FfiSectionSort::Visits, FfiGroupSort::Activities);
    let whole = names_under(FfiSectionSort::Name, FfiGroupSort::Name);

    assert!(!paged.0.is_empty() && !paged.1.is_empty());
    assert!(
        paged.0.iter().all(|(_, name)| name.is_some()),
        "{:?}",
        paged.0
    );
    assert!(
        paged.1.iter().all(|(_, name)| name.is_some()),
        "{:?}",
        paged.1
    );
    assert_eq!(paged, whole);
}

fn relevance_order(engine: &PersistentEngine, sport: Option<&str>) -> Vec<String> {
    engine
        .get_routes_screen_data(FfiRoutesScreenQuery {
            section_sort: FfiSectionSort::Signature,
            section_limit: 1_000,
            section_sport_type: sport.map(String::from),
            ..query()
        })
        .sections
        .into_iter()
        .map(|s| s.id)
        .collect()
}

fn seed_scores(dir: &TempDir, scores: &[(&str, Option<f64>, Option<f64>)]) {
    let conn = rusqlite::Connection::open(dir.path().join("routes.db")).unwrap();
    conn.execute(
        "UPDATE sections SET rank_score = NULL, sport_rank_score = NULL",
        [],
    )
    .unwrap();
    for (id, pooled, sport) in scores {
        conn.execute(
            "UPDATE sections SET rank_score = ?1, sport_rank_score = ?2 WHERE id = ?3",
            rusqlite::params![pooled, sport, id],
        )
        .unwrap();
    }
}

#[test]
fn relevance_order_ranks_high_first_ties_by_id_and_unranked_last() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let mut ids: Vec<String> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect();
    ids.sort();
    assert!(ids.len() >= 4);
    // Ids in sorted order: the unranked one is first by id, so only the
    // unranked-last rule can move it to the end.
    seed_scores(
        &dir,
        &[
            (&ids[1], Some(0.4), None),
            (&ids[2], Some(0.4), None),
            (&ids[3], Some(0.9), None),
        ],
    );
    drop(engine);
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine.load().unwrap();

    let order = relevance_order(&engine, None);
    assert_eq!(order[0], ids[3]);
    assert_eq!(order[1], ids[1]);
    assert_eq!(order[2], ids[2]);
    assert_eq!(order[3..].len(), order.len() - 3);
    assert!(order[3..].contains(&ids[0]));
}

#[test]
fn relevance_order_within_a_sport_follows_the_sport_score() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let mut ids: Vec<String> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect();
    ids.sort();
    // Pooled and sport scores disagree, and one section has only a pooled score.
    seed_scores(
        &dir,
        &[
            (&ids[0], Some(0.9), Some(0.1)),
            (&ids[1], Some(0.1), Some(0.8)),
            (&ids[2], Some(0.5), None),
        ],
    );
    drop(engine);
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine.load().unwrap();

    let order = relevance_order(&engine, Some("Ride"));
    assert_eq!(order[..3], [ids[1].clone(), ids[2].clone(), ids[0].clone()]);
}

fn reopened(dir: &TempDir) -> PersistentEngine {
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine.load().unwrap();
    engine
}

#[test]
fn a_sport_filter_narrows_sections_before_the_page_and_the_counts() {
    let dir = TempDir::new().expect("tempdir");
    let engine = seeded(&dir);
    let mut ids: Vec<String> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect();
    ids.sort();
    drop(engine);
    let conn = rusqlite::Connection::open(dir.path().join("routes.db")).unwrap();
    conn.execute("UPDATE sections SET sport_types = 'Ride'", [])
        .unwrap();
    for id in &ids[..4] {
        conn.execute(
            "UPDATE sections SET sport_types = 'Ride,Run' WHERE id = ?1",
            [id],
        )
        .unwrap();
    }
    conn.execute(
        "UPDATE sections SET sport_types = 'Run' WHERE id = ?1",
        [&ids[0]],
    )
    .unwrap();
    drop(conn);
    let engine = reopened(&dir);

    let runs = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_sport_type: Some("Run".into()),
        section_limit: 2,
        ..query()
    });
    assert_eq!(runs.section_count, 4, "the total is the sport's own");
    assert_eq!(runs.filtered_section_count, 4);
    assert_eq!(runs.sections.len(), 2);
    assert!(runs.has_more_sections);
    assert!(
        runs.sections
            .iter()
            .all(|s| s.sport_types.iter().any(|t| t == "Run"))
    );

    let walks = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_sport_type: Some("Walk".into()),
        ..query()
    });
    assert_eq!(walks.section_count, 0);
    assert!(walks.sections.is_empty());

    let everything = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        section_limit: 1_000,
        ..query()
    });
    assert_eq!(everything.section_count as usize, ids.len());
}

#[test]
fn a_sport_filter_keeps_the_groups_any_member_was_recorded_in() {
    let dir = TempDir::new().expect("tempdir");
    drop(seeded(&dir));
    let conn = rusqlite::Connection::open(dir.path().join("routes.db")).unwrap();
    for (group, members) in [("g_solo", r#"["a0"]"#), ("g_pair", r#"["a1","a2"]"#)] {
        conn.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES (?1, ?2, ?3, 'Ride')",
            rusqlite::params![group, if group == "g_solo" { "a0" } else { "a1" }, members],
        )
        .unwrap();
    }
    conn.execute(
        "UPDATE activities SET sport_type = 'Run' WHERE id IN ('a0', 'a2')",
        [],
    )
    .unwrap();
    drop(conn);
    let engine = reopened(&dir);
    let ids = |sport: &str| -> Vec<String> {
        let mut ids: Vec<String> = engine
            .get_routes_screen_data(FfiRoutesScreenQuery {
                group_sport_type: Some(sport.into()),
                group_limit: 1_000,
                ..query()
            })
            .groups
            .into_iter()
            .map(|g| g.group_id)
            .collect();
        ids.sort();
        ids
    };

    assert_eq!(ids("Run"), ["g_pair", "g_solo"]);
    assert_eq!(ids("Ride"), ["g_pair"]);
    assert!(ids("Walk").is_empty());
    let narrowed = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        group_sport_type: Some("Ride".into()),
        ..query()
    });
    assert_eq!(narrowed.group_count, 1);
}
