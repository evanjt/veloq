//! The pace-second gap an attempt stands off the record, and the gain a new
//! record made, as the section performance read carries them.

use super::pace_gap;
use crate::FfiPaceGap;

fn gap_of(slower: f64, faster: f64, sport: &str) -> Option<FfiPaceGap> {
    pace_gap(slower, faster, sport)
}

#[test]
fn a_run_gap_is_seconds_per_kilometre_and_per_mile() {
    // 5:00 and 4:00 per kilometre.
    let gap = gap_of(1000.0 / 300.0, 1000.0 / 240.0, "Run").expect("a gap");
    assert!((gap.metric - 60.0).abs() < 1e-9, "{gap:?}");
    assert!((gap.imperial - 60.0 / 0.621371).abs() < 1e-9, "{gap:?}");
}

#[test]
fn a_walk_reads_as_a_pace_like_a_run() {
    assert!(gap_of(1.0, 1.25, "Walk").is_some());
}

#[test]
fn a_swim_gap_is_seconds_per_hundred_metres_and_per_hundred_yards() {
    // 1:30 and 1:20 per 100 m, each rounded to a whole second first.
    let gap = gap_of(100.0 / 90.0, 100.0 / 80.0, "Swim").expect("a gap");
    assert_eq!(gap.metric, 10.0);
    // 91.44 / v is 82.296 and 73.152 s per 100 yd, which round to 82 and 73.
    assert_eq!(gap.imperial, 9.0);
}

#[test]
fn a_sport_that_is_not_a_pace_has_no_pace_gap() {
    assert_eq!(gap_of(8.0, 9.0, "Ride"), None);
    assert_eq!(gap_of(8.0, 9.0, "Rowing"), None);
}

#[test]
fn a_speed_with_no_pace_has_no_gap() {
    assert_eq!(gap_of(0.0, 3.0, "Run"), None);
    assert_eq!(gap_of(3.0, 0.0, "Run"), None);
    assert_eq!(gap_of(-1.0, 3.0, "Run"), None);
    assert_eq!(gap_of(f64::NAN, 3.0, "Run"), None);
    assert_eq!(gap_of(3.0, f64::INFINITY, "Swim"), None);
    // A tiny speed overflows to an absurd pace, which has no pace.
    assert_eq!(gap_of(1e-9, 3.0, "Run"), None);
}

#[test]
fn the_record_holder_has_a_gap_of_nought() {
    let gap = gap_of(3.0, 3.0, "Run").expect("a gap");
    assert_eq!((gap.metric, gap.imperial), (0.0, 0.0));
}
