//! The strength block: the body the strength tab draws over the trailing 30
//! days, shaded, ranked and worded as the strength screen read does it, so a
//! native draws it as it stands.

use super::super::*;
use crate::fit::FitExerciseSet;
use crate::objects::strength::strength_screen_from;
use crate::persistence::FitOutcome;
use crate::test_globals::{init_global_engine, serial_global_state};

const DAY: i64 = 86_400;

/// 2024-12-20 10:00 on the wall clock.
const NOW: i64 = 1_734_688_800;

const CLOCK: Clock = Clock {
    now_seconds: NOW,
    now_wall_seconds: NOW,
};

/// Midnight starting the clock's day.
const TODAY: i64 = NOW - NOW % DAY;

/// Midnight 19 days back, inside the trailing 30 days.
const SQUAT_DAY: i64 = TODAY - 19 * DAY;

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

/// Bench today, squats 19 days back, curls 29 days back, the edge of the
/// trailing window, and shrugs 30 days back, just outside it. Nothing else
/// works the trapezius.
fn seed() {
    store_session("today", TODAY + 9 * 3_600, Some(sets(BENCH_PRESS, 4, 60.0)));
    store_session("first", SQUAT_DAY + 8 * 3_600, Some(sets(SQUAT, 5, 80.0)));
    store_session("day29", TODAY - 29 * DAY, Some(sets(CURL, 3, 15.0)));
    store_session(
        "day30",
        TODAY - 30 * DAY + 12 * 3_600,
        Some(sets(SHRUG, 6, 40.0)),
    );
}

fn strings() -> std::collections::HashMap<String, String> {
    [
        ("period.long.1m", "1 month"),
        ("fitnessScreen.perWeek", "/wk"),
        (
            "strength.noWorkouts",
            "No strength workouts in the last {{period}}",
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

fn context() -> FfiWidgetContext {
    FfiWidgetContext {
        locale: "en-GB".to_string(),
        is_metric: true,
        strings: strings(),
        ..FfiWidgetContext::default()
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

/// Scenario: strength work today, 19 days back, 29 days back and 30 days back.
///
/// Expected behaviour: the window shades every muscle exactly as the strength
/// screen does over the same bounds, from midnight 29 days back to the end of
/// today.
#[test]
fn the_window_shades_the_body_as_the_strength_screen_does_over_the_same_days() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_windows.db");
    seed();

    let snapshot = compose_at(CLOCK);
    let window = &snapshot["strength"]["windows"]["last30"];
    let screen = screen(TODAY - 29 * DAY, TODAY + DAY - 1);

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

    let drawn = slugs(window);
    assert!(drawn.contains(&"biceps".to_string()), "day 29 is inside");
    assert!(
        drawn.contains(&"quadriceps".to_string()),
        "day 19 is inside"
    );
    assert!(
        !drawn.contains(&"trapezius".to_string()),
        "day 30 is outside"
    );
    assert_eq!(window["activityCount"], 3);

    crate::persistence::clear_persistent_engine();
}

/// Scenario: the widget is placed, with nothing for the athlete to choose.
///
/// Expected behaviour: the block carries the trailing 30 days and no other
/// window, labelled as the strength tab names it, with the body and the link
/// that opens the strength tab on the same 30 days.
#[test]
fn the_block_carries_the_trailing_month_alone() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_labels.db");
    seed();

    let strength = &compose_at(CLOCK)["strength"];

    let windows: Vec<&String> = strength["windows"]
        .as_object()
        .expect("the windows")
        .keys()
        .collect();
    assert_eq!(windows, ["last30"]);
    assert_eq!(strength["windows"]["last30"]["label"], "1 month");
    assert_eq!(strength["body"], "male");
    assert_eq!(strength["url"], "veloq://insights?tab=strength&period=1m");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the 30 days hold squats, bench and curls.
///
/// Expected behaviour: the top muscles come in the strength screen's
/// weighted-set order, at most four, each named and worded with its sets and
/// its volume in the athlete's unit.
#[test]
fn the_top_muscles_are_ranked_and_worded_by_the_engine() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_top.db");
    seed();

    let window = &compose_at(CLOCK)["strength"]["windows"]["last30"];
    let screen = screen(TODAY - 29 * DAY, TODAY + DAY - 1);
    let top = window["top"].as_array().expect("the top muscles");

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
    let lower_back = window["muscles"]
        .as_array()
        .expect("muscles")
        .iter()
        .any(|m| m["slug"] == "lower-back");
    assert!(lower_back);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the 30 days hold squats alone, and an imperial athlete reads them.
///
/// Expected behaviour: half sets keep their decimal, one set is singular, and
/// volume is in pounds.
#[test]
fn sets_and_volume_are_worded_in_the_athletes_language_and_unit() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_words.db");
    store_session("first", SQUAT_DAY + 8 * 3_600, Some(sets(SQUAT, 1, 100.0)));
    store_session("second", SQUAT_DAY + DAY, Some(sets(SQUAT, 2, 100.0)));

    let json = crate::persistence::read_pool::with_read_conn(|conn| {
        let mut ctx = context();
        ctx.is_metric = false;
        snapshot_json(conn, &ctx, CLOCK)
    })
    .expect("an open engine");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");
    let top = &snapshot["strength"]["windows"]["last30"]["top"];
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

/// Scenario: bench press in three sessions over the 30 days, two sets in one of
/// them, and squats in one, read in a language that writes a decimal comma.
///
/// Expected behaviour: each top muscle carries the sessions that trained it
/// and how often that is a week, sessions over the window's 30 days times
/// seven to one decimal: 0,7 a week for the chest, 0,2 for the quadriceps.
#[test]
fn each_top_muscle_carries_how_often_a_week_it_was_trained() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_frequency.db");
    store_session("today", TODAY + 9 * 3_600, Some(sets(BENCH_PRESS, 2, 60.0)));
    store_session("week", TODAY - 7 * DAY, Some(sets(BENCH_PRESS, 1, 60.0)));
    store_session("day29", TODAY - 29 * DAY, Some(sets(BENCH_PRESS, 1, 60.0)));
    store_session("first", SQUAT_DAY + 8 * 3_600, Some(sets(SQUAT, 3, 80.0)));

    let json = crate::persistence::read_pool::with_read_conn(|conn| {
        let mut ctx = context();
        ctx.numbers.decimal = ",".to_string();
        snapshot_json(conn, &ctx, CLOCK)
    })
    .expect("an open engine");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");
    let top = snapshot["strength"]["windows"]["last30"]["top"]
        .as_array()
        .expect("top")
        .clone();
    let find = |slug: &str| {
        top.iter()
            .find(|m| m["slug"] == slug)
            .cloned()
            .unwrap_or_else(|| panic!("no {slug}"))
    };

    assert_eq!(find("chest")["sessionCount"], 3);
    assert_eq!(find("chest")["frequencyText"], "0,7×/wk");
    assert_eq!(find("triceps")["frequencyText"], "0,7×/wk");
    assert_eq!(find("quadriceps")["sessionCount"], 1);
    assert_eq!(find("quadriceps")["frequencyText"], "0,2×/wk");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: 31 days after the clock's day, the last sets are 31 days old.
///
/// Expected behaviour: the window has no muscles and says so in the strength
/// tab's words for the 30 days.
#[test]
fn an_empty_window_says_so_and_draws_no_muscles() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_empty.db");
    seed();
    let later = NOW + 31 * DAY;

    let window = &compose_at(Clock {
        now_seconds: later,
        now_wall_seconds: later,
    })["strength"]["windows"]["last30"];

    assert_eq!(window["muscles"], serde_json::json!([]));
    assert_eq!(window["top"], serde_json::json!([]));
    assert_eq!(window["label"], "1 month");
    assert_eq!(
        window["emptyText"],
        "No strength workouts in the last 1 month"
    );
    assert_eq!(window["maxWeightedSets"], 0.0);
    assert_eq!(window["bodyLabel"], serde_json::Value::Null);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the window's only strength session has not had its file downloaded.
///
/// Expected behaviour: the window counts it as owed and says the workouts are
/// not downloaded yet, rather than that there are none.
#[test]
fn a_window_whose_sessions_are_owed_says_they_are_not_downloaded() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_owed.db");
    store_session("owed", TODAY + 9 * 3_600, None);

    let window = &compose_at(CLOCK)["strength"]["windows"]["last30"];

    assert_eq!(window["owedCount"], 1);
    assert_eq!(window["muscles"], serde_json::json!([]));
    assert_eq!(window["emptyText"], "Strength workouts not downloaded yet");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: a library with no strength work at all.
///
/// Expected behaviour: the block is still there, the window empty and worded,
/// so a native never words it itself.
#[test]
fn a_library_with_no_strength_work_still_carries_the_window_worded() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_strength_none.db");

    let strength = &compose_at(CLOCK)["strength"];

    assert_eq!(strength["body"], "male");
    assert_eq!(
        strength["windows"]["last30"]["emptyText"],
        "No strength workouts in the last 1 month"
    );
    assert_eq!(strength["windows"]["last30"]["activityCount"], 0);
    assert_eq!(strength["windows"]["last30"]["totalSets"], 0);
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
