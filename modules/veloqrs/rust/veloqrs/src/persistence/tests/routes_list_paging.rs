//! Scenario: the routes screen asks for a page of groups and a page of sections
//! in an order a stored column answers, and the engine reads that page through
//! the order's index and the stored counts rather than walking the catalogue.
//!
//! Expected behaviour: for every such order, filter set, minimum and offset, the
//! page, the totals, `has_more` and the counters equal what walking the whole
//! catalogue gives, ties and removed rows included. A list that searches,
//! filters by sport, or orders by name, by the representative's distance or by
//! nearness is not paged in SQL and is walked.

use rusqlite::params;

use crate::persistence::PersistentEngine;
use crate::{FfiGroupSort, FfiRoutesScreenQuery, FfiSectionFilters, FfiSectionSort};

/// Sections of every kind, with ties in each order so the tie rule decides,
/// and ids that do not follow the insert order.
fn seed_sections(engine: &PersistentEngine) {
    for i in 0..15usize {
        let id = format!("s{:02}", (i * 7) % 15);
        let section_type = if i % 4 == 0 { "custom" } else { "auto" };
        let user_defined: Option<i32> = match i % 3 {
            0 => Some(1),
            1 => Some(0),
            _ => None,
        };
        let disabled = i32::from(i % 5 == 0);
        let rank: Option<f64> = (i % 4 != 1).then(|| ((i * 3) % 5) as f64 / 10.0);
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, is_user_defined, disabled,
                                       visit_count, rank_score)
                 VALUES (?1, ?2, ?3, 'Ride', '[]', ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    section_type,
                    format!("Hill {i}"),
                    1_000.0 + (i % 3) as f64 * 100.0,
                    user_defined,
                    disabled,
                    ((i * 7) % 4) as i64,
                    rank,
                ],
            )
            .unwrap();
    }
    engine
        .db
        .execute_batch("UPDATE sections SET superseded_by = 's01' WHERE id IN ('s04', 's09');")
        .unwrap();
}

/// Groups whose counts tie, inserted so the rowid order is not the id order.
fn seed_groups(engine: &PersistentEngine) {
    for (i, count) in [3u32, 1, 4, 3, 2, 4, 1, 3, 5].into_iter().enumerate() {
        let ids: Vec<String> = (0..count).map(|n| format!("a{i}_{n}")).collect();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                           activity_count)
                 VALUES (?1, ?2, ?3, 'Ride', ?4)",
                params![
                    format!("g{}", 8 - i),
                    ids[0],
                    serde_json::to_string(&ids).unwrap(),
                    count
                ],
            )
            .unwrap();
    }
}

fn library() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    seed_sections(&engine);
    seed_groups(&engine);
    engine
}

fn base() -> FfiRoutesScreenQuery {
    FfiRoutesScreenQuery {
        user_lat: f64::NAN,
        user_lng: f64::NAN,
        ..Default::default()
    }
}

fn all_filters() -> Vec<FfiSectionFilters> {
    (0..16u8)
        .map(|bits| FfiSectionFilters {
            hide_custom: bits & 1 != 0,
            hide_auto: bits & 2 != 0,
            hide_disabled: bits & 4 != 0,
            hide_unaccepted: bits & 8 != 0,
        })
        .collect()
}

type SectionView = (Vec<String>, u32, u32, bool, [u32; 4]);

fn section_view(page: &super::PooledSectionPage) -> SectionView {
    (
        page.sections.iter().map(|s| s.id.clone()).collect(),
        page.total_count,
        page.filtered_count,
        page.has_more,
        [
            page.unaccepted_auto_count,
            page.accepted_auto_count,
            page.custom_count,
            page.retired_count,
        ],
    )
}

type GroupView = (Vec<String>, u32, u32, bool);

fn group_view(page: &super::PooledGroupPage) -> GroupView {
    (
        page.groups.iter().map(|g| g.group_id.clone()).collect(),
        page.total_count,
        page.filtered_count,
        page.has_more,
    )
}

#[test]
fn a_section_page_read_through_its_index_equals_the_walk() {
    let engine = library();
    let mut compared = 0;
    for section_sort in [
        FfiSectionSort::Visits,
        FfiSectionSort::Distance,
        FfiSectionSort::Signature,
        FfiSectionSort::Nearby,
    ] {
        for section_filters in all_filters() {
            for (section_offset, section_limit) in [(0, 4), (3, 4), (0, 50), (13, 4), (20, 4)] {
                let query = FfiRoutesScreenQuery {
                    section_sort,
                    section_filters: section_filters.clone(),
                    section_offset,
                    section_limit,
                    ..base()
                };
                let paged = super::paged_section_page(&engine.db, &query)
                    .unwrap_or_else(|| panic!("{section_sort:?} was not paged in SQL"));
                let walked = super::walked_section_page(&engine.db, &query);
                assert_eq!(
                    section_view(&paged),
                    section_view(&walked),
                    "{section_sort:?} {section_filters:?} at {section_offset}+{section_limit}"
                );
                compared += usize::from(!walked.sections.is_empty());
            }
        }
    }
    assert!(compared > 100, "only {compared} comparisons had rows");
}

#[test]
fn a_group_page_read_through_its_index_equals_the_walk() {
    let engine = library();
    for group_sort in [FfiGroupSort::Activities, FfiGroupSort::Nearby] {
        for min_group_activity_count in [0, 2, 3, 6] {
            for (group_offset, group_limit) in [(0, 3), (2, 3), (0, 50), (8, 3), (20, 3)] {
                let query = FfiRoutesScreenQuery {
                    group_sort,
                    min_group_activity_count,
                    group_offset,
                    group_limit,
                    ..base()
                };
                let paged = super::paged_group_page(&engine.db, &query)
                    .unwrap_or_else(|| panic!("{group_sort:?} was not paged in SQL"));
                let walked = super::walked_group_page(&engine.db, &query);
                assert_eq!(
                    group_view(&paged),
                    group_view(&walked),
                    "{group_sort:?} min {min_group_activity_count} at {group_offset}+{group_limit}"
                );
            }
        }
    }
}

#[test]
fn a_list_no_stored_column_orders_is_walked() {
    let engine = library();
    let located = FfiRoutesScreenQuery {
        user_lat: 46.0,
        user_lng: 7.0,
        ..base()
    };
    let walked_sections = [
        FfiRoutesScreenQuery {
            section_search: "hill".into(),
            ..base()
        },
        FfiRoutesScreenQuery {
            section_sort: FfiSectionSort::Name,
            ..base()
        },
        FfiRoutesScreenQuery {
            section_sport_type: Some("Ride".into()),
            ..base()
        },
        FfiRoutesScreenQuery {
            section_sort: FfiSectionSort::Nearby,
            ..located.clone()
        },
    ];
    for query in &walked_sections {
        assert!(super::paged_section_page(&engine.db, query).is_none());
    }
    let walked_groups = [
        FfiRoutesScreenQuery {
            group_search: "loop".into(),
            ..base()
        },
        FfiRoutesScreenQuery {
            group_sort: FfiGroupSort::Name,
            ..base()
        },
        FfiRoutesScreenQuery {
            group_sort: FfiGroupSort::Distance,
            ..base()
        },
        FfiRoutesScreenQuery {
            group_sport_type: Some("Ride".into()),
            ..base()
        },
        FfiRoutesScreenQuery {
            group_sort: FfiGroupSort::Nearby,
            ..located
        },
    ];
    for query in &walked_groups {
        assert!(super::paged_group_page(&engine.db, query).is_none());
    }
}

/// A group written before the count was stored has none, so the count index
/// cannot place it. The list walks rather than leave it out or misplace it.
#[test]
fn a_group_with_no_stored_count_sends_the_list_to_the_walk() {
    let engine = library();
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('g_old', 'b0', '[\"b0\",\"b1\",\"b2\",\"b3\",\"b4\",\"b5\"]', 'Ride')",
            [],
        )
        .unwrap();
    let query = FfiRoutesScreenQuery {
        min_group_activity_count: 2,
        ..base()
    };

    assert!(super::paged_group_page(&engine.db, &query).is_none());
    let page = super::pooled_route_group_page(&engine.db, &query);
    assert_eq!(page.groups[0].group_id, "g_old");
    assert_eq!(page.total_count, 10);
    assert_eq!(
        group_view(&page),
        group_view(&super::walked_group_page(&engine.db, &query))
    );
}
