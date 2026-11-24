//! The pace text rule is written in Rust, and the app prints the text the
//! engine sends rather than formatting a speed itself. The shared case table
//! is the check on the rule.

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
fn a_missing_speed_has_no_compact_pace() {
    for speed in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(format_pace_compact(speed, true), "--:--");
        assert_eq!(format_pace_compact(speed, false), "--:--");
    }
}

fn parts(minutes: u32, seconds: u32) -> Option<crate::FfiPaceParts> {
    Some(crate::FfiPaceParts { minutes, seconds })
}

/// Expected behaviour: the parts are the figures the compact text prints, in
/// every case of the shared table, and absent exactly where the text is.
#[test]
fn the_pace_parts_match_the_compact_text_in_every_case() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("pace_compact_cases.json")).unwrap();
    for case in cases {
        let got = sport_pace_parts(case.speed, false, case.is_metric);
        let printed = got.map(|p| format!("{}:{:02}", p.minutes, p.seconds));
        let absent = case.expected == "--:--";
        assert_eq!(printed.is_none(), absent, "{}", case.name);
        if let Some(printed) = printed {
            assert_eq!(printed, case.expected, "{}", case.name);
        }
    }
}

#[test]
fn a_stopped_or_missing_speed_has_no_pace_parts() {
    for speed in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        for (is_swim, is_metric) in [(false, true), (false, false), (true, true), (true, false)] {
            assert_eq!(sport_pace_parts(speed, is_swim, is_metric), None);
        }
    }
}

#[test]
fn a_pace_at_the_hundred_hour_cap_keeps_its_parts_and_one_past_it_has_none() {
    let at_cap = 1000.0 / (100.0 * 3600.0);
    assert_eq!(sport_pace_parts(at_cap, false, true), parts(6000, 0));
    assert_eq!(sport_pace_parts(at_cap * 0.999, false, true), None);
}

#[test]
fn a_swim_pace_carries_a_rounded_sixty_into_the_minutes() {
    // 79.6 s per 100 m rounds to 80 s: 1 minute 20 seconds.
    assert_eq!(sport_pace_parts(100.0 / 79.6, true, true), parts(1, 20));
    // 119.6 s rounds to 120 s: 2 minutes, not 1 minute 60 seconds.
    assert_eq!(sport_pace_parts(100.0 / 119.6, true, true), parts(2, 0));
    // A mile of imperial running at 8:56 per mile.
    assert_eq!(sport_pace_parts(3.0, false, false), parts(8, 56));
}

/// Scenario: a speed is read for a run, a swim and a ride.
///
/// Expected behaviour: foot and water sports give pace text in both unit
/// systems, a ride gives none because it reads a speed, and a speed with no
/// pace gives none.
#[test]
fn a_pace_sport_speed_reads_as_text_in_both_unit_systems() {
    let text = |speed, sport| sport_pace_text(speed, sport);
    assert_eq!(
        text(3.0, "Run"),
        Some(("5:33".to_string(), "8:56".to_string()))
    );
    assert_eq!(
        text(3.0, "Hike").map(|t| t.0),
        Some("5:33".to_string()),
        "a walking sport reads pace"
    );
    assert_eq!(
        text(1.25, "Swim"),
        Some(("1:20".to_string(), "1:13".to_string()))
    );
    assert_eq!(text(9.0, "Ride"), None);
    assert_eq!(text(0.0, "Run"), None);
    assert_eq!(text(f64::NAN, "Swim"), None);
}

/// Scenario: a swim speed far outside what a swimmer holds.
///
/// Expected behaviour: a very fast speed still reads, a very slow one reads in
/// minutes past the hour, and one slow enough to overflow the pace cap, or a
/// negative one, has no pace text.
#[test]
fn a_swim_speed_far_outside_the_usual_range_reads_or_gives_none() {
    let text = |speed| sport_pace_text(speed, "Swim");
    assert_eq!(text(100.0), Some(("0:01".to_string(), "0:01".to_string())));
    assert_eq!(
        text(0.01),
        Some(("166:40".to_string(), "152:24".to_string()))
    );
    assert_eq!(text(-1.0), None);
    assert_eq!(text(5e-324), None);
    assert_eq!(text(1e-300), None);
}
