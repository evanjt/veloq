//! Scenario: a sport key's curves are asked for every window in one request,
//! and the answer is filed as one body per window.
//!
//! Expected behaviour: over the same recorded answers, the seven bodies filed
//! from the one multi-window answer read exactly what the seven single-window
//! answers read: the same points and models on the curve screens, the same
//! Best Efforts, and the same window end for the edge test. A window the
//! multi-window answer leaves out is stored as what a single request for it
//! returns. The activity list of a window keeps every activity the single
//! answer listed, and nothing dated outside the window.
//!
//! The fixtures are answers recorded from intervals.icu for one athlete,
//! reduced to the points the screens read and with every id, name and weight
//! replaced. Each holds the multi-window answer and the seven single-window
//! answers taken in the same minute.

use std::collections::BTreeMap;

use super::stored_curve_frame;
use crate::net::offline_prefetch::{CURVE_DAYS, curve_window, split_curve_windows};
use crate::persistence::PersistentEngine;
use crate::persistence::bodies::CurveKind;
use crate::persistence::curves::pooled::{pace_curve, power_curve};
use crate::persistence::screens::pooled::best_efforts_data;

/// What a single-window request returns for a window with no data.
const EMPTY_WINDOW: &str = r#"{"list":[],"activities":{}}"#;

const NOW: i64 = 1_760_000_000;

struct Key {
    fixture: &'static str,
    kind: CurveKind,
    sport: &'static str,
    gap: bool,
}

const KEYS: [Key; 4] = [
    Key {
        fixture: "ride_power.json",
        kind: CurveKind::Power,
        sport: "Ride",
        gap: false,
    },
    Key {
        fixture: "run_pace.json",
        kind: CurveKind::Pace,
        sport: "Run",
        gap: false,
    },
    Key {
        fixture: "run_gap_pace.json",
        kind: CurveKind::Pace,
        sport: "Run",
        gap: true,
    },
    Key {
        fixture: "swim_pace.json",
        kind: CurveKind::Pace,
        sport: "Swim",
        gap: false,
    },
];

fn fixture(name: &str) -> serde_json::Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/curve_windows")
        .join(name);
    let text = std::fs::read_to_string(&path).expect("curve fixture");
    serde_json::from_str(&text).expect("fixture json")
}

/// One engine holding the single-window answers as they are stored today,
/// and one holding the bodies filed from the multi-window answer.
fn stored_both_ways() -> (PersistentEngine, PersistentEngine) {
    let single = PersistentEngine::in_memory().expect("engine");
    let split = PersistentEngine::in_memory().expect("engine");
    for key in &KEYS {
        let recorded = fixture(key.fixture);
        for &days in CURVE_DAYS {
            let answer = recorded["single"][curve_window(days)].to_string();
            single
                .set_curve_body(key.kind, key.sport, days, key.gap, &answer)
                .expect("store single");
        }
        let windows = split_curve_windows(&recorded["batch"].to_string()).expect("split");
        assert_eq!(windows.len(), CURVE_DAYS.len());
        for (days, body) in windows {
            split
                .set_curve_body(key.kind, key.sport, days, key.gap, &body)
                .expect("store split");
        }
    }
    (single, split)
}

fn raw(engine: &PersistentEngine, key: &Key, days: i64) -> String {
    engine
        .get_stored_curve(key.kind, key.sport, days, key.gap)
        .expect("read")
        .expect("stored")
        .raw
}

/// A curve as the screens read it, with the fetch time left out and the
/// activity list in a fixed order.
fn as_read(engine: &PersistentEngine, key: &Key, days: i64) -> (String, BTreeMap<String, String>) {
    match key.kind {
        CurveKind::Power => {
            let (_, curve) = power_curve(&engine.db, key.sport, days).expect("read");
            let mut curve = curve.expect("a stored body parses");
            curve.fetched_at = 0.0;
            let activities = std::mem::take(&mut curve.activities);
            (
                format!("{curve:?}"),
                activities
                    .into_iter()
                    .map(|(id, a)| (id, format!("{a:?}")))
                    .collect(),
            )
        }
        CurveKind::Pace => {
            let (_, curve) = pace_curve(&engine.db, key.sport, days, key.gap).expect("read");
            let mut curve = curve.expect("a stored body parses");
            curve.fetched_at = 0.0;
            let activities = std::mem::take(&mut curve.activities);
            (
                format!("{curve:?}"),
                activities
                    .into_iter()
                    .map(|(id, a)| (id, format!("{a:?}")))
                    .collect(),
            )
        }
    }
}

#[test]
fn every_window_reads_the_same_curve_from_one_answer_as_from_seven() {
    let (single, split) = stored_both_ways();
    for key in &KEYS {
        for &days in CURVE_DAYS {
            let (single_curve, single_listed) = as_read(&single, key, days);
            let (split_curve, split_listed) = as_read(&split, key, days);
            assert_eq!(
                single_curve, split_curve,
                "{} gap={} {days} days",
                key.sport, key.gap
            );
            for (id, activity) in &single_listed {
                assert_eq!(
                    split_listed.get(id),
                    Some(activity),
                    "{} gap={} {days} days keeps {id}",
                    key.sport,
                    key.gap
                );
            }
        }
    }
}

#[test]
fn best_efforts_read_the_same_from_one_answer_as_from_seven() {
    let (single, split) = stored_both_ways();
    for &days in CURVE_DAYS {
        assert_eq!(
            format!(
                "{:?}",
                best_efforts_data(&single.db, days, NOW).expect("read")
            ),
            format!(
                "{:?}",
                best_efforts_data(&split.db, days, NOW).expect("read")
            ),
            "{days} days"
        );
    }
}

#[test]
fn a_window_the_answer_leaves_out_is_stored_as_a_single_request_returns_it() {
    let (single, split) = stored_both_ways();
    let empty: serde_json::Value = serde_json::from_str(EMPTY_WINDOW).expect("json");
    let mut left_out = 0;
    for key in &KEYS {
        let batch = &fixture(key.fixture)["batch"];
        for &days in CURVE_DAYS {
            let answered = batch["list"]
                .as_array()
                .expect("list")
                .iter()
                .any(|entry| entry["id"] == curve_window(days).as_str());
            if answered {
                continue;
            }
            left_out += 1;
            let lone: serde_json::Value =
                serde_json::from_str(&raw(&single, key, days)).expect("json");
            assert_eq!(lone, empty, "the recorded single answer for no data");
            assert_eq!(raw(&split, key, days), EMPTY_WINDOW);
        }
    }
    assert!(left_out > 0, "the fixtures hold a window with no data");
}

#[test]
fn a_window_ends_where_its_single_answer_ends_and_lists_only_its_own_dates() {
    let (single, split) = stored_both_ways();
    for key in &KEYS {
        for &days in CURVE_DAYS {
            let (single_end, single_dates) =
                stored_curve_frame(&raw(&single, key, days), days, 0.0);
            let split_raw = raw(&split, key, days);
            let (split_end, split_dates) = stored_curve_frame(&split_raw, days, 0.0);
            let label = format!("{} gap={} {days} days", key.sport, key.gap);
            if split_raw == EMPTY_WINDOW {
                assert!(single_dates.is_empty() && split_dates.is_empty(), "{label}");
                continue;
            }
            assert_eq!(single_end, split_end, "{label}");
            for date in &single_dates {
                assert!(split_dates.contains(date), "{label} keeps {date}");
            }
            let body: serde_json::Value = serde_json::from_str(&split_raw).expect("json");
            let start = body["list"][0]["start_date_local"]
                .as_str()
                .and_then(|s| chrono::NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok())
                .expect("window start");
            for date in &split_dates {
                assert!(
                    *date >= start && *date <= split_end,
                    "{label} lists {date}, outside {start}..{split_end}"
                );
            }
        }
    }
}
