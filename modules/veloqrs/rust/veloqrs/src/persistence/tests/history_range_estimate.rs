//! Scenario: the history range sheet proposes a start date earlier than the
//! oldest activity held, and says how many activities that widening
//! downloads.
//!
//! Expected behaviour: the figure counts the activities the remote history
//! lists inside the range that the library does not hold, so it changes with
//! the start date. With only per-year counts known it prorates by days and
//! says it is approximate.

use super::history_range_estimate;
use crate::net::types::ActivityCensusEntry;
use crate::persistence::PersistentEngine;
use rusqlite::params;

/// Ten activities on days 1 to 10 of each month, from November 2024 to
/// October 2026. The library holds August to October 2026.
fn two_years_with_three_months_held() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("in-memory engine");
    let mut entries = Vec::new();
    for (year, month) in (0..24).map(|i| (2024 + (10 + i) / 12, (10 + i) % 12 + 1)) {
        for day in 1..=10 {
            entries.push(ActivityCensusEntry {
                id: format!("i{year}{month:02}{day:02}"),
                start_date_local: Some(format!("{year}-{month:02}-{day:02}T07:00:00")),
                ..Default::default()
            });
        }
    }
    engine.record_activity_census("a1", &entries).unwrap();
    for entry in entries
        .iter()
        .filter(|e| e.start_date_local.as_deref() >= Some("2026-08-01"))
    {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?1, 'Ride', 0, 0, 0, 0, 1)",
                params![entry.id],
            )
            .unwrap();
    }
    engine
}

#[test]
fn the_figure_grows_with_each_month_the_start_moves_back() {
    let engine = two_years_with_three_months_held();
    let at = |from| history_range_estimate(&engine.db, from, "2026-08-01").unwrap();
    assert_eq!(at("2026-05-01").count, 30);
    assert_eq!(at("2026-02-01").count, 60);
    assert_eq!(at("2025-11-01").count, 90);
    assert!(!at("2025-11-01").approximate);
}

#[test]
fn a_range_the_library_already_holds_costs_nothing() {
    let engine = two_years_with_three_months_held();
    assert_eq!(
        history_range_estimate(&engine.db, "2026-08-01", "2026-10-31")
            .unwrap()
            .count,
        0
    );
}

#[test]
fn without_a_census_the_year_counts_are_prorated_by_days_and_marked_approximate() {
    let engine = PersistentEngine::in_memory().expect("in-memory engine");
    engine
        .set_setting("activity_year_counts", r#"{"2025":365,"2026":100}"#)
        .unwrap();
    let estimate = history_range_estimate(&engine.db, "2025-07-01", "2026-01-01").unwrap();
    assert!(estimate.approximate);
    assert_eq!(estimate.count, 184);
}

#[test]
fn nothing_is_known_reads_as_zero() {
    let engine = PersistentEngine::in_memory().expect("in-memory engine");
    let estimate = history_range_estimate(&engine.db, "2025-07-01", "2026-01-01").unwrap();
    assert_eq!((estimate.count, estimate.approximate), (0, true));
}
