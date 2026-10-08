//! The strength block: the body the strength tab draws, over the trailing 30
//! days and the calendar month, shaded, ranked and worded as the strength
//! screen read does it, so a native picks a window and draws.

use super::super::*;
use crate::fit::FitExerciseSet;
use crate::objects::strength::strength_screen_from;
use crate::persistence::FitOutcome;
use crate::test_globals::{init_global_engine, serial_global_state};

const DAY: i64 = 86_400;

/// 2024-12-20 10:00 on the wall clock: the 1st of the month is 19 days back,
/// so the month and the trailing 30 days differ.
const NOW: i64 = 1_734_688_800;

const CLOCK: Clock = Clock {
    now_seconds: NOW,
    now_wall_seconds: NOW,
};

/// Midnight starting the clock's day.
const TODAY: i64 = NOW - NOW % DAY;

/// 2024-12-01 00:00, the start of the clock's month.
const FIRST_OF_MONTH: i64 = TODAY - 19 * DAY;

const BENCH_PRESS: u16 = 0;
const CURL: u16 = 7;
const SHRUG: u16 = 26;
const SQUAT: u16 = 28;

fn sets(category: u16, count: u32, weight_kg: f64) -> Vec<FitExerciseSet> {
    (0..count)
        .map(|order| FitExerciseSet {
            set_order: order,
            exercise_category: category,
            exercise_name: None,
            set_type: 0,
            repetitions: Some(8),
            weight_kg: Some(weight_kg),
            duration_secs: None,
            start_time: None,
        })
        .collect()
}

fn store_session(id: &str, date: i64, sets: Option<Vec<FitExerciseSet>>) {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: id.to_string(),
                name: "Gym".to_string(),
                date,
                distance: 0.0,
                moving_time: 3_600,
                elapsed_time: 3_600,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "WeightTraining".to_string(),
                training_load: Some(40.0),
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("the metrics");
        // A session with no sets has no FIT outcome yet: its file is still owed.
        if let Some(sets) = sets {
            engine.store_exercise_sets(id, &sets).expect("the sets");
            engine
                .mark_fit_outcome(id, FitOutcome::Parsed)
                .expect("the outcome");
        }
    })
    .expect("the engine");
}

fn set_profile(json: &str) {
    crate::persistence::with_persistent_engine(|engine| {
        engine.set_athlete_profile(json).expect("the profile");
    })
    .expect("the engine");
}

/// Bench today, squats on the 1st, curls 29 days back, the edge of the
/// trailing window, and shrugs 30 days back, just outside it. Nothing else
/// works the trapezius.
fn seed_month() {
    store_session("today", TODAY + 9 * 3_600, Some(sets(BENCH_PRESS, 4, 60.0)));
    store_session(
        "first",
        FIRST_OF_MONTH + 8 * 3_600,
        Some(sets(SQUAT, 5, 80.0)),
    );
    store_session("day29", TODAY - 29 * DAY, Some(sets(CURL, 3, 15.0)));
    store_session(
        "day30",
        TODAY - 30 * DAY + 12 * 3_600,
        Some(sets(SHRUG, 6, 40.0)),
    );
}

fn strings() -> std::collections::BTreeMap<String, String> {
    [
        ("period.long.1m", "1 month"),
        (
            "strength.noWorkouts",
            "No strength workouts in the last {{period}}",
        ),
        (
            "strength.noWorkoutsThisMonth",
            "No strength workouts this month",
        ),
        (
            "strength.notDownloaded",
            "Strength workouts not downloaded yet",
        ),
        ("strength.setsCount_one", "{{count}} set"),
        ("strength.setsCount_other", "{{count}} sets"),
        ("strength.muscles.chest", "Chest"),
        ("strength.muscles.triceps", "Triceps"),
        ("strength.muscles.quadriceps", "Quadriceps"),
        ("strength.muscles.gluteal", "Glutes"),
        ("strength.muscles.lowerBack", "Lower back"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn context() -> WidgetContext {
    let months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    WidgetContext {
        locale: "en-GB".to_string(),
        is_metric: true,
        strings: strings(),
        dates: DateWords {
            months: months.map(String::from).to_vec(),
            ..DateWords::default()
        },
        ..WidgetContext::default()
    }
}

fn compose_at(clock: Clock) -> serde_json::Value {
    let json = crate::persistence::read_pool::with_read_conn(|conn| {
        snapshot_json(conn, &context(), clock)
    })
    .expect("an open engine");
    serde_json::from_str(&json).expect("a snapshot that parses")
}

/// Every muscle's slug and shade, by slug.
fn shades(muscles: &serde_json::Value) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = muscles
        .as_array()
        .expect("muscles")
        .iter()
        .map(|m| {
            (
                m["slug"].as_str().expect("a slug").to_string(),
                m["shade"].as_u64().expect("a shade"),
            )
        })
        .collect();
    out.sort();
    out
}

/// The strength tab's read over the same days, on the same engine.
fn screen(start: i64, end: i64) -> crate::FfiStrengthScreenData {
    crate::persistence::read_pool::with_read_conn(|conn| {
        strength_screen_from(conn, start, end, Vec::new())
    })
    .expect("an open engine")
    .expect("the strength screen read")
}

fn screen_shades(screen: &crate::FfiStrengthScreenData) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = screen
        .summary
        .muscle_volumes
        .iter()
        .map(|m| (m.slug.clone(), u64::from(m.shade)))
        .collect();
    out.sort();
    out
}

fn slugs(window: &serde_json::Value) -> Vec<String> {
    shades(&window["muscles"])
        .into_iter()
        .map(|(s, _)| s)
        .collect()
}

/// Scenario: strength work today, on the 1st, 29 days back and 30 days back,
/// composed on the 20th.
///
/// Expected behaviour: each window shades every muscle exactly as the strength
/// screen does over the same bounds, the trailing window runs from midnight 29
/// days back to the end of today, and the month from the 1st.
#[test]
fn each_window_shades_the_body_as_the_strength_screen_does_over_the_same_days() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_windows.db");
    seed_month();

    let snapshot = compose_at(CLOCK);
    let windows = &snapshot["strength"]["windows"];
    let end_of_today = TODAY + DAY - 1;

    for (window, start) in [
        (&windows["last30"], TODAY - 29 * DAY),
        (&windows["month"], FIRST_OF_MONTH),
    ] {
        let screen = screen(start, end_of_today);
        assert_eq!(shades(&window["muscles"]), screen_shades(&screen));
        assert_eq!(
            window["maxWeightedSets"].as_f64(),
            Some(screen.summary.max_weighted_sets)
        );
        assert_eq!(
            window["activityCount"].as_u64(),
            Some(u64::from(screen.summary.activity_count))
        );
        assert_eq!(
            window["totalSets"].as_u64(),
            Some(u64::from(screen.summary.total_sets))
        );
        assert_eq!(window["owedCount"], 0);
        assert_eq!(window["emptyText"], serde_json::Value::Null);
    }

    let last30 = slugs(&windows["last30"]);
    assert!(last30.contains(&"biceps".to_string()), "day 29 is inside");
    assert!(
        !last30.contains(&"trapezius".to_string()),
        "day 30 is outside"
    );
    assert_eq!(windows["last30"]["activityCount"], 3);

    let month = slugs(&windows["month"]);
    assert!(
        !month.contains(&"biceps".to_string()),
        "the 29th of last month is outside"
    );
    assert!(
        month.contains(&"quadriceps".to_string()),
        "the 1st is inside"
    );
    assert_eq!(windows["month"]["activityCount"], 2);

    crate::persistence::clear_persistent_engine();
}

/// Scenario: the trailing window and the month the widget offers at placement.
///
/// Expected behaviour: each carries its label, the block names the body and
/// the link that opens the strength tab on the same 30 days.
#[test]
fn the_block_names_its_windows_body_and_link() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_labels.db");
    seed_month();

    let strength = &compose_at(CLOCK)["strength"];

    assert_eq!(strength["windows"]["last30"]["label"], "1 month");
    assert_eq!(strength["windows"]["month"]["label"], "December");
    assert_eq!(strength["body"], "male");
    assert_eq!(strength["url"], "veloq://insights?tab=strength&period=1m");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the month's work is squats on the 1st and bench today.
///
/// Expected behaviour: the top muscles come in the strength screen's
/// weighted-set order, at most four, each named and worded with its sets and
/// its volume in the athlete's unit.
#[test]
fn the_top_muscles_are_ranked_and_worded_by_the_engine() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_top.db");
    seed_month();

    let month = &compose_at(CLOCK)["strength"]["windows"]["month"];
    let screen = screen(FIRST_OF_MONTH, TODAY + DAY - 1);
    let top = month["top"].as_array().expect("the top muscles");

    assert_eq!(top.len(), 4);
    let ranked: Vec<&str> = screen
        .summary
        .muscle_volumes
        .iter()
        .take(4)
        .map(|m| m.slug.as_str())
        .collect();
    let shown: Vec<&str> = top
        .iter()
        .map(|m| m["slug"].as_str().expect("a slug"))
        .collect();
    assert_eq!(shown, ranked);

    // Five squats work the quadriceps primarily: five sets of 8 at 80 kg.
    let quads = top
        .iter()
        .find(|m| m["slug"] == "quadriceps")
        .expect("the quadriceps");
    assert_eq!(quads["name"], "Quadriceps");
    assert_eq!(quads["setsText"], "5 sets");
    assert_eq!(quads["volumeText"], "3200 kg");

    // A squat works the lower back secondarily, at half a set each.
    let lower_back = month["muscles"]
        .as_array()
        .expect("muscles")
        .iter()
        .any(|m| m["slug"] == "lower-back");
    assert!(lower_back);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the month's only work is on the 1st, and an imperial athlete reads it.
///
/// Expected behaviour: half sets keep their decimal, one set is singular, and
/// volume is in pounds.
#[test]
fn sets_and_volume_are_worded_in_the_athletes_language_and_unit() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_words.db");
    store_session(
        "first",
        FIRST_OF_MONTH + 8 * 3_600,
        Some(sets(SQUAT, 1, 100.0)),
    );
    store_session("second", FIRST_OF_MONTH + DAY, Some(sets(SQUAT, 2, 100.0)));

    let json = crate::persistence::read_pool::with_read_conn(|conn| {
        let mut ctx = context();
        ctx.is_metric = false;
        snapshot_json(conn, &ctx, CLOCK)
    })
    .expect("an open engine");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");
    let top = &snapshot["strength"]["windows"]["month"]["top"];
    let find = |slug: &str| {
        top.as_array()
            .expect("top")
            .iter()
            .find(|m| m["slug"] == slug)
            .cloned()
            .unwrap_or_else(|| panic!("no {slug}"))
    };

    // Three squats: three sets for the quadriceps, one and a half for the calves.
    assert_eq!(find("quadriceps")["setsText"], "3 sets");
    assert_eq!(find("calves")["setsText"], "1.5 sets");
    // 3 × 8 × 100 kg is 2400 kg, 5291 lbs.
    assert_eq!(find("quadriceps")["volumeText"], "5291 lbs");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: on the 5th of January the last sets were before the new year.
///
/// Expected behaviour: the month has no muscles and says so in its own words,
/// while the trailing window still draws December's work.
#[test]
fn an_empty_window_says_so_and_draws_no_muscles() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_empty.db");
    seed_month();
    // 2025-01-05, 16 days after the clock's day.
    let later = NOW + 16 * DAY;

    let windows = &compose_at(Clock {
        now_seconds: later,
        now_wall_seconds: later,
    })["strength"]["windows"];

    assert_eq!(windows["month"]["muscles"], serde_json::json!([]));
    assert_eq!(windows["month"]["top"], serde_json::json!([]));
    assert_eq!(windows["month"]["label"], "January");
    assert_eq!(
        windows["month"]["emptyText"],
        "No strength workouts this month"
    );
    assert_eq!(windows["month"]["maxWeightedSets"], 0.0);
    assert_eq!(windows["last30"]["emptyText"], serde_json::Value::Null);
    assert!(!slugs(&windows["last30"]).is_empty());
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the month's only strength session has not had its file downloaded.
///
/// Expected behaviour: the window counts it as owed and says the workouts are
/// not downloaded yet, rather than that there are none.
#[test]
fn a_window_whose_sessions_are_owed_says_they_are_not_downloaded() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_owed.db");
    store_session("owed", TODAY + 9 * 3_600, None);

    let windows = &compose_at(CLOCK)["strength"]["windows"];

    for window in [&windows["last30"], &windows["month"]] {
        assert_eq!(window["owedCount"], 1);
        assert_eq!(window["muscles"], serde_json::json!([]));
        assert_eq!(window["emptyText"], "Strength workouts not downloaded yet");
    }
    crate::persistence::clear_persistent_engine();
}

/// Scenario: a library with no strength work at all.
///
/// Expected behaviour: the block is still there, both windows empty and worded,
/// so a native never words a window itself.
#[test]
fn a_library_with_no_strength_work_still_carries_both_windows_worded() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_none.db");

    let strength = &compose_at(CLOCK)["strength"];

    assert_eq!(strength["body"], "male");
    assert_eq!(
        strength["windows"]["last30"]["emptyText"],
        "No strength workouts in the last 1 month"
    );
    assert_eq!(
        strength["windows"]["month"]["emptyText"],
        "No strength workouts this month"
    );
    assert_eq!(strength["windows"]["last30"]["activityCount"], 0);
    assert_eq!(strength["windows"]["month"]["totalSets"], 0);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the intervals.icu profile says the athlete is female, then that
/// the field is something other than `F`.
///
/// Expected behaviour: the female body, then the male body the strength tab
/// falls back to.
#[test]
fn the_body_follows_the_profile_as_the_strength_tab_does() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_body.db");

    set_profile(r#"{"id":"i1","name":"A","sex":"F"}"#);
    assert_eq!(compose_at(CLOCK)["strength"]["body"], "female");

    set_profile(r#"{"id":"i1","name":"A","sex":"M"}"#);
    assert_eq!(compose_at(CLOCK)["strength"]["body"], "male");

    set_profile(r#"{"id":"i1","name":"A"}"#);
    assert_eq!(compose_at(CLOCK)["strength"]["body"], "male");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: an older stored context with no long month names, as a native
/// refresh reads before the app has run the new build.
///
/// Expected behaviour: the month's label falls back to the short name the
/// context does carry.
#[test]
fn the_month_label_falls_back_to_the_short_name() {
    let mut ctx = context();
    ctx.dates.months = Vec::new();
    ctx.dates.month_day.months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .map(String::from)
    .to_vec();

    let snapshot = compose(&FfiWidgetSnapshotData::default(), &ctx, CLOCK);

    assert_eq!(snapshot.strength.windows.month.label, "Dec");
}

/// The plural category i18next gives each count in the app's languages, read
/// from `Intl.PluralRules` for every supported locale.
#[test]
fn the_plural_category_is_the_one_the_app_picks() {
    let counts = [
        0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0, 11.0, 12.0, 13.0, 14.0, 21.0, 22.0, 25.0, 100.0,
        101.0, 102.0, 112.0, 122.0,
    ];
    let expected: [(&[&str], [&str; 20]); 7] = [
        (
            &[
                "en-GB", "en-AU", "en-US", "de-DE", "de-CH", "nl", "it", "es", "es-419", "es-ES",
            ],
            [
                "other", "one", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other", "other",
            ],
        ),
        (
            &["da"],
            [
                "one", "one", "one", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other",
            ],
        ),
        (
            &["fr"],
            [
                "one", "one", "one", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other",
            ],
        ),
        (
            &["pt", "pt-BR"],
            [
                "one", "one", "one", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other",
            ],
        ),
        (
            &["pl"],
            [
                "other", "one", "other", "few", "few", "few", "many", "many", "many", "many",
                "many", "many", "many", "few", "many", "many", "many", "few", "many", "few",
            ],
        ),
        (
            &["ja"],
            [
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other", "other",
            ],
        ),
        (
            &["zh-Hans"],
            [
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other", "other", "other", "other", "other", "other", "other", "other", "other",
                "other", "other",
            ],
        ),
    ];
    for (locales, categories) in expected {
        for locale in locales {
            let picked: Vec<&str> = counts
                .iter()
                .map(|&count| plural_category(locale, count))
                .collect();
            assert_eq!(picked, categories, "{locale}");
        }
    }
}
