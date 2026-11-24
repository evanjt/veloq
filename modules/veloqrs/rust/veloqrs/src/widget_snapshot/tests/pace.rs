//! The pace rule is written in Rust here and in TypeScript in the app's
//! shared formatters. Both are held to one case table, so a change to either
//! rule fails the other language's test until the table moves.

use super::super::*;

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    speed: f64,
    #[serde(rename = "isMetric")]
    is_metric: bool,
    expected: String,
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_compact_pace_matches_the_shared_case_table() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("pace_compact_cases.json")).unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        assert_eq!(
            format_pace_compact(case.speed, case.is_metric),
            case.expected,
            "{}",
            case.name
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_missing_speed_has_no_compact_pace() {
    for speed in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(format_pace_compact(speed, true), "--:--");
        assert_eq!(format_pace_compact(speed, false), "--:--");
    }
}
