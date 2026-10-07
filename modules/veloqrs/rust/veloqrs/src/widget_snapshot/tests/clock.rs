use super::super::*;
use crate::{FfiActivityMetrics, FfiWellnessSparklines, FfiWidgetSnapshotData};

const DAY: i64 = 86_400;

// 2026-09-12 10:00, a Saturday, on the device's wall clock.
const LOCAL_NOW: i64 = 1_789_207_200;

// 2026-09-12 09:00 on the same wall clock: a ride an hour ago.
const RIDE: i64 = 1_789_203_600;

fn series(last: i32) -> Vec<i32> {
    vec![last - 2, last - 1, last]
}

fn ride(date: i64) -> FfiActivityMetrics {
    FfiActivityMetrics {
        activity_id: "i1".to_string(),
        name: "Morning Ride".to_string(),
        date: date as f64,
        distance: 42_100.0,
        moving_time: 5660,
        training_load: Some(62.0),
        sport_type: "Ride".to_string(),
        ..Default::default()
    }
}

fn data(ride_date: i64) -> FfiWidgetSnapshotData {
    FfiWidgetSnapshotData {
        sparklines: Some(FfiWellnessSparklines {
            fitness: series(50),
            fatigue: series(40),
            form: series(10),
            ..Default::default()
        }),
        latest: Some(ride(ride_date)),
        ..Default::default()
    }
}

fn context() -> WidgetContext {
    WidgetContext {
        locale: "en-AU".to_string(),
        is_metric: true,
        ..Default::default()
    }
}

// The true instant behind the same local wall clock, seen `offset_hours` east of Greenwich.
fn clock(offset_hours: i64) -> Clock {
    Clock {
        now_seconds: LOCAL_NOW - offset_hours * 3600,
        now_wall_seconds: LOCAL_NOW,
    }
}

fn at_wall(now_wall_seconds: i64) -> Clock {
    Clock {
        now_seconds: now_wall_seconds,
        now_wall_seconds,
    }
}

#[test]
fn shows_the_impact_of_a_ride_an_hour_ago_east_of_greenwich() {
    assert!(compose(&data(RIDE), &context(), clock(2)).impact.is_some());
}

#[test]
fn shows_the_impact_of_a_ride_an_hour_ago_west_of_greenwich_too() {
    assert!(compose(&data(RIDE), &context(), clock(-8)).impact.is_some());
}

#[test]
fn still_refuses_a_ride_older_than_the_impact_window() {
    assert!(
        compose(&data(RIDE - 5 * DAY), &context(), clock(2))
            .impact
            .is_none()
    );
}

#[test]
fn a_ride_taken_today_reads_as_today_whatever_the_offset() {
    for offset in [-8, 0, 2] {
        let s = compose(&data(RIDE), &context(), clock(offset));
        assert_eq!(
            s.latest.unwrap().date_label,
            "time.today",
            "offset {offset}"
        );
        assert_eq!(
            s.impact.unwrap().date_label,
            "time.today",
            "offset {offset}"
        );
    }
}

#[test]
fn a_ride_today_pairs_the_last_sparkline_day_with_the_one_before() {
    let impact = compose(&data(RIDE), &context(), clock(2)).impact.unwrap();
    assert_eq!((impact.form_before, impact.form_after), (9.0, 10.0));
    assert_eq!((impact.ctl_delta, impact.atl_delta), (1.0, 1.0));
    assert_eq!(impact.tss_added, Some(62.0));
}

#[test]
fn a_ride_late_yesterday_pairs_its_own_day_with_the_day_before_it() {
    // 2026-09-11 23:00 seen from 01:00 the next morning: two hours, but another calendar day.
    let s = compose(&data(1_789_167_600), &context(), at_wall(1_789_174_800));
    let impact = s.impact.unwrap();
    assert_eq!((impact.form_before, impact.form_after), (8.0, 9.0));
    assert_eq!((impact.ctl_delta, impact.atl_delta), (1.0, 1.0));
    assert_eq!(impact.date_label, "time.yesterday");
}

#[test]
fn a_ride_whose_day_before_is_outside_the_sparkline_has_no_impact() {
    // 2026-09-10 12:00 is inside two days of 2026-09-12 10:00, but the series starts on its own day.
    assert!(
        compose(&data(1_789_041_600), &context(), at_wall(LOCAL_NOW))
            .impact
            .is_none()
    );
}

#[test]
fn the_impact_window_holds_exactly_two_days_and_not_a_second_more() {
    let mut d = data(LOCAL_NOW - 2 * DAY);
    d.sparklines = Some(FfiWellnessSparklines {
        fitness: vec![47, 48, 49, 50],
        fatigue: vec![37, 38, 39, 40],
        form: vec![7, 8, 9, 10],
        ..Default::default()
    });
    let impact = compose(&d, &context(), at_wall(LOCAL_NOW)).impact.unwrap();
    assert_eq!((impact.form_before, impact.form_after), (7.0, 8.0));

    d.latest = Some(ride(LOCAL_NOW - 2 * DAY - 1));
    assert!(compose(&d, &context(), at_wall(LOCAL_NOW)).impact.is_none());
}

#[test]
fn a_ride_dated_after_now_has_no_impact() {
    assert!(
        compose(&data(LOCAL_NOW + 1), &context(), at_wall(LOCAL_NOW))
            .impact
            .is_none()
    );
}

fn english() -> WidgetContext {
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let part = |kind: &str, value: &str| DatePart {
        kind: kind.to_string(),
        value: value.to_string(),
    };
    let month_day = vec![part("month", ""), part("literal", " "), part("day", "")];
    let mut month_day_year = month_day.clone();
    month_day_year.extend([part("literal", ", "), part("year", "")]);
    WidgetContext {
        strings: [("time.today", "Today"), ("time.yesterday", "Yesterday")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        dates: DateWords {
            weekdays: [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            month_day: DatePattern {
                parts: month_day,
                months: months.iter().map(|s| s.to_string()).collect(),
            },
            month_day_year: DatePattern {
                parts: month_day_year,
                months: months.iter().map(|s| s.to_string()).collect(),
            },
        },
        ..context()
    }
}

fn label(ctx: &WidgetContext, ride_date: i64, now_wall_seconds: i64) -> String {
    compose(&data(ride_date), ctx, at_wall(now_wall_seconds))
        .latest
        .unwrap()
        .date_label
}

#[test]
fn the_date_label_counts_calendar_days_on_the_wall_clock() {
    // 2026-09-11 16:00 seen from 08:00 the next day is sixteen hours, and yesterday.
    assert_eq!(label(&english(), 1_789_142_400, 1_789_200_000), "Yesterday");
    assert_eq!(label(&english(), RIDE, LOCAL_NOW), "Today");
}

#[test]
fn the_date_label_names_the_weekday_within_the_week() {
    // 2026-09-08 is a Tuesday and 2026-09-06 a Sunday, four and six days back.
    assert_eq!(label(&english(), 1_788_861_600, LOCAL_NOW), "Tuesday");
    assert_eq!(label(&english(), 1_788_688_800, LOCAL_NOW), "Sunday");
}

#[test]
fn the_date_label_writes_a_short_date_from_a_week_back() {
    // 2026-09-05, seven days back.
    assert_eq!(label(&english(), 1_788_602_400, LOCAL_NOW), "Sep 5");
}

#[test]
fn the_date_label_carries_the_year_once_it_is_not_this_one() {
    // 2025-12-31.
    assert_eq!(label(&english(), 1_767_175_200, LOCAL_NOW), "Dec 31, 2025");
}

#[test]
fn the_date_label_falls_back_to_an_iso_date_without_the_locale_words() {
    assert_eq!(label(&context(), 1_788_861_600, LOCAL_NOW), "2026-09-08");
    assert_eq!(label(&context(), 1_767_175_200, LOCAL_NOW), "2025-12-31");
}

// Expected values are worked from the calendar: 2026-09-14 and 2026-09-07 are Mondays.
const MONDAY_14TH: i64 = 1_789_344_000;
const MONDAY_7TH: i64 = 1_788_739_200;

#[test]
fn week_bounds_on_a_monday_start_at_its_own_midnight() {
    // 2026-09-14 08:15.
    let now = MONDAY_14TH + 8 * 3600 + 15 * 60;
    assert_eq!(now, 1_789_373_700);
    assert_eq!(
        week_bounds(now),
        (MONDAY_14TH, now, MONDAY_7TH, MONDAY_14TH - 1)
    );
}

#[test]
fn week_bounds_at_monday_midnight_put_that_instant_in_the_new_week() {
    assert_eq!(
        week_bounds(MONDAY_14TH),
        (MONDAY_14TH, MONDAY_14TH, MONDAY_7TH, 1_789_343_999)
    );
}

#[test]
fn week_bounds_on_a_sunday_reach_back_to_the_monday_before() {
    // 2026-09-20 23:59:59, the last second of the week.
    let now = 1_789_948_799;
    assert_eq!(
        week_bounds(now),
        (MONDAY_14TH, now, MONDAY_7TH, 1_789_343_999)
    );
}

#[test]
fn week_bounds_mid_week_start_on_the_monday() {
    // 2026-09-16 13:30, a Wednesday.
    let now = 1_789_565_400;
    assert_eq!(
        week_bounds(now),
        (MONDAY_14TH, now, MONDAY_7TH, 1_789_343_999)
    );
}
