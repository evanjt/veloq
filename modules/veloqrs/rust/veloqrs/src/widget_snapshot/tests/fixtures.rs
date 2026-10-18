//! The snapshots the widget captures render: the sample library in the app's
//! own words, the same shape with the longest words any locale has, a
//! 60-character activity name and five-digit values, an empty library, and a
//! library with rides and no wellness reading. All are composed here, so a
//! capture draws what the engine writes rather than a hand-kept copy.
//!
//! The files under `widget/fixtures/` are compared with what this composes, and
//! `VELOQ_WRITE_WIDGET_FIXTURES=1` rewrites them.

use super::super::*;

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::persistence::wellness::WellnessRow;
use crate::{GpsPoint, WidgetLatestComparison, WidgetRouteStanding};

// 2024-12-05 00:53 on the wall clock, the instant the other snapshot tests use, so
// a ride an hour earlier is dated yesterday.
const NOW: i64 = 1_733_360_000;

const CLOCK: Clock = Clock {
    now_seconds: NOW,
    now_wall_seconds: NOW,
};

const DAY: i64 = 86_400;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn flatten(prefix: &str, value: &serde_json::Value, out: &mut BTreeMap<String, String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten(&path, child, out);
            }
        }
        serde_json::Value::String(text) => {
            out.insert(prefix.to_string(), text.clone());
        }
        _ => {}
    }
}

fn locale(file: &str) -> BTreeMap<String, String> {
    let path = repo_root().join("src/i18n/locales").join(file);
    let text = std::fs::read_to_string(&path).expect("a locale file");
    let json: serde_json::Value = serde_json::from_str(&text).expect("a locale that parses");
    let mut out = BTreeMap::new();
    flatten("", &json, &mut out);
    out
}

/// Every key at the longest translation any locale gives it, counted in characters.
fn longest_strings() -> BTreeMap<String, String> {
    let dir = repo_root().join("src/i18n/locales");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("the locales directory")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .into_string()
                .expect("a name")
        })
        .filter(|name| name.ends_with(".json"))
        .collect();
    files.sort();
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for file in files {
        for (key, text) in locale(&file) {
            let longer = out
                .get(&key)
                .is_none_or(|kept| text.chars().count() > kept.chars().count());
            if longer {
                out.insert(key, text);
            }
        }
    }
    out
}

fn date_words(
    weekdays: [&str; 7],
    months: [&str; 12],
    long_months: [&str; 12],
    separator: &str,
) -> DateWords {
    let part = |kind: &str, value: &str| DatePart {
        r#type: kind.to_string(),
        value: value.to_string(),
    };
    let month_day = vec![part("day", ""), part("literal", " "), part("month", "")];
    let mut month_day_year = month_day.clone();
    month_day_year.extend([part("literal", separator), part("year", "")]);
    let months: Vec<String> = months.map(String::from).to_vec();
    DateWords {
        weekdays: weekdays.map(String::from).to_vec(),
        month_day: DatePattern {
            parts: month_day,
            months: months.clone(),
        },
        month_day_year: DatePattern {
            parts: month_day_year,
            months,
        },
        months: long_months.map(String::from).to_vec(),
    }
}

fn english_dates() -> DateWords {
    date_words(
        [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ],
        [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ],
        [
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
        ],
        " ",
    )
}

/// The longest weekday and month names among the app's locales.
fn long_dates() -> DateWords {
    date_words(
        [
            "domingo",
            "segunda-feira",
            "terça-feira",
            "quarta-feira",
            "quinta-feira",
            "sexta-feira",
            "sábado",
        ],
        [
            "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.",
            "nov.", "déc.",
        ],
        [
            "January",
            "fevereiro",
            "marzec",
            "kwiecień",
            "maggio",
            "czerwiec",
            "juillet",
            "augustus",
            "septiembre",
            "październik",
            "noviembre",
            "diciembre",
        ],
        " de ",
    )
}

fn shortcut(kind: &str, label: &str, glyph: &str) -> RecordShortcut {
    RecordShortcut {
        r#type: kind.to_string(),
        label: label.to_string(),
        url: format!("veloq://record?type={kind}"),
        glyph: glyph.to_string(),
    }
}

fn insight(id: &str, tone: &str, title: &str, subtitle: &str) -> WidgetInsight {
    WidgetInsight {
        id: id.to_string(),
        category: "fitness".to_string(),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        icon: "trending-up".to_string(),
        tone: tone.to_string(),
        url: "veloq://fitness".to_string(),
    }
}

fn context(strings: BTreeMap<String, String>, dates: DateWords, demo: bool) -> FfiWidgetContext {
    FfiWidgetContext {
        locale: "en-AU".to_string(),
        is_metric: true,
        strings: strings.into_iter().collect(),
        dates,
        summary_card: Some(SummaryPrefs {
            enabled: true,
            hero_metric: "form".to_string(),
            show_sparkline: true,
            supporting_metrics: ["fitness", "fatigue", "ftp", "weekHours"]
                .map(String::from)
                .to_vec(),
        }),
        activity_tints: [
            ("Ride", "#3B82F6"),
            ("Run", "#F97316"),
            ("Other", "#64748B"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
        demo,
        ..Default::default()
    }
}

fn wellness(days: i64, ctl: f64, atl: f64) -> Vec<WellnessRow> {
    (0..days)
        .rev()
        .map(|offset| WellnessRow {
            date: chrono::DateTime::from_timestamp(NOW - offset * DAY, 0)
                .expect("a date")
                .date_naive()
                .to_string(),
            ctl: Some(ctl - offset as f64 * ctl / 200.0),
            atl: Some(atl - (offset % 7) as f64 * atl / 40.0),
            ramp_rate: Some(4.2),
            hrv: Some(58.0 + (offset % 5) as f64),
            resting_hr: Some(47.0 + (offset % 3) as f64),
            weight: None,
            sleep_secs: None,
            sleep_score: None,
            soreness: None,
            fatigue: None,
            stress: None,
            mood: None,
            motivation: None,
            raw: None,
        })
        .collect()
}

fn ride(
    id: &str,
    name: &str,
    start: i64,
    distance: f64,
    seconds: u32,
    load: f64,
) -> (String, i64, String) {
    let local = chrono::DateTime::from_timestamp(start, 0)
        .expect("a time")
        .format("%Y-%m-%dT%H:%M:%S");
    (
        id.to_string(),
        start,
        serde_json::json!({
            "id": id,
            "name": name,
            "type": "Ride",
            "start_date_local": local.to_string(),
            "distance": distance,
            "moving_time": seconds,
            "elapsed_time": seconds + 120,
            "total_elevation_gain": 310.0,
            "icu_training_load": load,
            "icu_ftp": 251,
        })
        .to_string(),
    )
}

/// A loop drawn as a rounded square, enough points for a route preview.
fn track() -> Vec<GpsPoint> {
    (0..80)
        .map(|i| {
            let t = i as f64 / 80.0 * std::f64::consts::TAU;
            GpsPoint {
                latitude: -33.86 + 0.02 * t.sin() + 0.004 * (3.0 * t).sin(),
                longitude: 151.20 + 0.03 * t.cos(),
                elevation: None,
            }
        })
        .collect()
}

/// A strength session: its id, its date, and each exercise as its FIT
/// category, the number of sets of eight and the weight.
type Session = (&'static str, i64, Vec<(u16, u32, f64)>);

struct Library {
    wellness: Vec<WellnessRow>,
    rides: Vec<(String, i64, String)>,
    route_name: String,
    strength: Vec<Session>,
}

fn store_session(
    scratch: &mut crate::persistence::PersistentEngine,
    (id, date, exercises): &Session,
) {
    scratch
        .set_activity_metrics(vec![crate::ActivityMetrics {
            activity_id: id.to_string(),
            name: "Gym".to_string(),
            date: *date,
            distance: 0.0,
            moving_time: 3_600,
            elapsed_time: 3_600,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "WeightTraining".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }])
        .expect("the session");
    let mut sets = Vec::new();
    for (category, count, weight_kg) in exercises {
        for _ in 0..*count {
            sets.push(crate::fit::FitExerciseSet {
                set_order: sets.len() as u32,
                exercise_category: *category,
                exercise_name: None,
                set_type: 0,
                repetitions: Some(8),
                weight_kg: Some(*weight_kg),
                duration_secs: None,
                start_time: None,
            });
        }
    }
    scratch.store_exercise_sets(id, &sets).expect("the sets");
    scratch
        .mark_fit_outcome(id, crate::persistence::FitOutcome::Parsed)
        .expect("the outcome");
}

fn compose_fixture(library: &Library, ctx: &FfiWidgetContext) -> serde_json::Value {
    let mut scratch = crate::persistence::PersistentEngine::in_memory().expect("a database");
    scratch
        .set_athlete_profile(r#"{"id":"sample","name":"Sample Athlete"}"#)
        .expect("a profile");
    scratch.set_sport_settings("[]").expect("sport settings");
    scratch
        .upsert_wellness(&library.wellness)
        .expect("wellness");
    scratch
        .upsert_activity_bodies_with_metrics(&library.rides)
        .expect("activities");
    for session in &library.strength {
        store_session(&mut scratch, session);
    }
    let mut data = data_from(&scratch.db, CLOCK);
    // The engine reads the sparklines up to the device's today, and a fixture
    // is pinned to its own.
    let today = chrono::DateTime::from_timestamp(NOW, 0)
        .expect("a date")
        .date_naive()
        .to_string();
    data.sparklines =
        crate::persistence::wellness::pooled::sparklines_to(&scratch.db, FORM_HISTORY_DAYS, &today)
            .expect("sparklines");
    data.ramp_rate = crate::persistence::wellness::pooled::latest_ramp_rate_to(
        &scratch.db,
        FORM_HISTORY_DAYS,
        &today,
    );
    data.latest_is_pr = true;
    data.latest_gps = track();
    data.latest_comparison = WidgetLatestComparison {
        route: Some(WidgetRouteStanding {
            route_name: library.route_name.clone(),
            rank: Some(2),
            attempt_count: 14,
            time_delta_seconds: Some(83),
            prior_attempt_seconds: vec![
                5900, 5750, 5820, 5700, 5660, 5610, 5800, 5590, 5640, 5577, 5720, 5680, 5600,
            ],
        }),
        section_pr_count: 3,
        typical_load: Some(70.0),
    };
    let json = serialise(&compose(&data, ctx, CLOCK));
    serde_json::from_str(&json).expect("a snapshot that parses")
}

pub(super) fn demo() -> serde_json::Value {
    let mut ctx = context(english(), english_dates(), true);
    ctx.record_shortcuts = vec![
        shortcut("Ride", "Ride", "ride"),
        shortcut("Run", "Run", "run"),
    ];
    ctx.launcher_shortcuts = ctx.record_shortcuts.clone();
    ctx.insights = vec![
        insight(
            "fitness-up",
            "positive",
            "Fitness up 6 this month",
            "Ramp of 4.2 a week",
        ),
        insight(
            "route-pr",
            "record",
            "2nd best on Harbour Loop",
            "1:23 off your best",
        ),
        insight("hrv-steady", "info", "HRV is steady", "58 ms over 7 days"),
        insight(
            "form-fresh",
            "neutral",
            "Form is in the grey zone",
            "−8 today",
        ),
        insight("ftp", "positive", "eFTP 251 W", "Up 6 W in 30 days"),
    ];
    let library = Library {
        wellness: wellness(56, 72.0, 80.0),
        rides: vec![
            ride(
                "sample-1",
                "Harbour Loop",
                NOW - 3_600,
                42_195.0,
                5_400,
                88.0,
            ),
            ride(
                "sample-2",
                "Coffee Spin",
                NOW - 3 * DAY,
                31_000.0,
                4_100,
                54.0,
            ),
            ride(
                "sample-3",
                "Hill Repeats",
                NOW - 9 * DAY,
                38_400.0,
                5_200,
                96.0,
            ),
        ],
        route_name: "Harbour Loop".to_string(),
        // The 1st falls in neither week the weekly totals compare, and 15 days
        // back is inside the 30 days and outside the month.
        strength: vec![
            (
                "sample-gym-1",
                NOW - 4 * DAY,
                vec![(0, 4, 60.0), (28, 4, 80.0), (8, 3, 100.0)],
            ),
            (
                "sample-gym-2",
                NOW - 15 * DAY,
                vec![(7, 3, 15.0), (24, 3, 30.0)],
            ),
        ],
    };
    compose_fixture(&library, &ctx)
}

fn long_text() -> serde_json::Value {
    let strings = longest_strings();
    let mut ctx = context(strings, long_dates(), false);
    ctx.record_shortcuts = vec![
        shortcut("VirtualRide", "Ciclismo virtual en interiores", "ride"),
        shortcut("Run", "Corsa su pista", "run"),
    ];
    ctx.launcher_shortcuts = ctx.record_shortcuts.clone();
    ctx.insights = vec![
        insight(
            "fitness-up",
            "positive",
            "Deine Fitness ist in den letzten vier Wochen um 12345 Punkte gestiegen",
            "Steigerungsrate von 12345 pro Woche über den gesamten Zeitraum gemessen",
        ),
        insight(
            "route-pr",
            "record",
            "Zweitbeste Zeit auf der Strecke Großer Hafenrundkurs über die Brücke",
            "12:34:56 hinter deiner Bestzeit auf dieser Strecke",
        ),
        insight(
            "hrv-steady",
            "info",
            "Variabilité de la fréquence cardiaque stable sur sept jours consécutifs",
            "12345 ms de moyenne sur la période de référence choisie",
        ),
        insight(
            "form-fresh",
            "caution",
            "Tagesform liegt im Übergangsbereich zwischen Erholung und Training",
            "−12345 heute, nach einer sehr langen Belastungsphase",
        ),
        insight(
            "ftp",
            "positive",
            "eFTP de 12345 W, a mais alta estimativa desde o início do registo",
            "Subiu 12345 W nos últimos trinta dias de treino",
        ),
    ];
    let library = Library {
        wellness: wellness(56, 12_345.0, 10_987.0),
        rides: vec![
            ride(
                "long-1",
                "Grande boucle des collines et du littoral par le col du vent",
                NOW - 3_600,
                12_345_678.0,
                359_999,
                12_345.0,
            ),
            ride(
                "long-2",
                "Rundfahrt",
                NOW - 3 * DAY,
                9_876_543.0,
                299_999,
                23_456.0,
            ),
        ],
        route_name: "Grande boucle des collines et du littoral par le col du vent".to_string(),
        strength: vec![
            (
                "long-gym-1",
                NOW - 4 * DAY,
                vec![
                    (28, 41, 250.0),
                    (13, 37, 120.0),
                    (11, 33, 90.0),
                    (5, 29, 40.0),
                ],
            ),
            ("long-gym-2", NOW - 15 * DAY, vec![(23, 30, 110.0)]),
        ],
    };
    compose_fixture(&library, &ctx)
}

pub(super) fn english() -> BTreeMap<String, String> {
    // The app's English is en-GB with the en-AU words laid over it.
    let mut strings = locale("en-GB.json");
    strings.extend(locale("en-AU.json"));
    strings
}

/// A signed-in athlete who has synced nothing yet.
fn empty() -> serde_json::Value {
    let ctx = context(english(), english_dates(), false);
    let library = Library {
        wellness: Vec::new(),
        rides: Vec::new(),
        route_name: String::new(),
        strength: Vec::new(),
    };
    compose_fixture(&library, &ctx)
}

/// Rides synced and no wellness row yet, with every wellness metric on the
/// summary so each one draws its dash.
fn no_wellness() -> serde_json::Value {
    let mut ctx = context(english(), english_dates(), false);
    if let Some(prefs) = ctx.summary_card.as_mut() {
        prefs.hero_metric = "hrv".to_string();
        prefs.supporting_metrics = ["fitness", "fatigue", "form", "rhr"]
            .map(String::from)
            .to_vec();
    }
    let library = Library {
        wellness: Vec::new(),
        rides: vec![ride(
            "bare-1",
            "Harbour Loop",
            NOW - 3_600,
            42_195.0,
            5_400,
            88.0,
        )],
        route_name: "Harbour Loop".to_string(),
        strength: Vec::new(),
    };
    compose_fixture(&library, &ctx)
}

fn check(name: &str, composed: serde_json::Value) {
    let path = repo_root()
        .join("widget/fixtures")
        .join(format!("{name}.json"));
    let text = serde_json::to_string_pretty(&composed).expect("JSON") + "\n";
    if std::env::var("VELOQ_WRITE_WIDGET_FIXTURES").as_deref() == Ok("1") {
        std::fs::create_dir_all(path.parent().expect("a directory"))
            .expect("the fixtures directory");
        std::fs::write(&path, &text).expect("the fixture written");
        return;
    }
    let kept = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        kept == text,
        "{} is not what the engine composes; rerun with VELOQ_WRITE_WIDGET_FIXTURES=1",
        path.display()
    );
}

/// Scenario: the widget captures draw the committed fixtures, and the snapshot
/// the engine writes changes shape.
///
/// Expected behaviour: the fixtures are exactly what the engine composes, so a
/// capture never passes on a snapshot the app no longer writes.
#[test]
fn the_widget_fixtures_are_what_the_engine_composes() {
    check("demo", demo());
    check("long-text", long_text());
    check("empty", empty());
    check("no-wellness", no_wellness());
}

/// Scenario: the captures draw the empty prompt and the dash for a missing
/// reading from these two fixtures.
///
/// Expected behaviour: the empty fixture marks an empty library, and the
/// no-wellness fixture has a ride and a dash for every wellness metric.
#[test]
fn the_sparse_fixtures_carry_the_empty_library_and_the_dashes() {
    assert_eq!(empty()["emptyLibrary"], serde_json::json!(true));
    let bare = no_wellness();
    assert_eq!(bare["emptyLibrary"], serde_json::json!(false));
    assert!(bare["latest"].is_object());
    for metric in ["fitness", "fatigue", "form", "hrv", "rhr"] {
        assert_eq!(
            bare["metrics"][metric]["text"],
            serde_json::json!(TEXT_NONE),
            "{metric}"
        );
    }
}

/// Scenario: the long-text fixture is meant to stress every line a widget draws.
///
/// Expected behaviour: the activity name is 60 characters, the values run to
/// five digits, and every word is the longest the locales have.
#[test]
fn the_long_text_fixture_carries_the_longest_words() {
    let snapshot = long_text();
    let latest = &snapshot["latest"];
    assert_eq!(latest["name"].as_str().expect("a name").chars().count(), 60);
    assert!(snapshot["weekly"]["tss"].as_i64().expect("a load") >= 10_000);
    assert!(
        snapshot["metrics"]["fitness"]["value"]
            .as_f64()
            .expect("fitness")
            >= 10_000.0
    );
    let longest = longest_strings();
    assert_eq!(
        snapshot["display"]["metricLabels"]["form"],
        serde_json::json!(longest["metrics.form"])
    );
    assert_eq!(
        latest["dateLabel"],
        serde_json::json!(longest["time.yesterday"])
    );
}

/// Scenario: on iOS the widget's refresh control opens the app, since the
/// engine does not fit in the extension, and says so in the athlete's words.
///
/// Expected behaviour: every snapshot carries those words from the locale, the
/// longest of them in the long-text fixture, and not the words of a control
/// that refreshes in place.
#[test]
fn the_snapshot_carries_the_words_of_a_control_that_opens_the_app() {
    let english = english();
    let longest = longest_strings();
    let words = &english["systemSurfaces.openToRefresh"];
    assert_ne!(words, &english["systemSurfaces.refresh"]);
    for snapshot in [demo(), no_wellness(), empty()] {
        assert_eq!(
            snapshot["display"]["openToRefreshLabel"],
            serde_json::json!(words)
        );
    }
    assert_eq!(
        long_text()["display"]["openToRefreshLabel"],
        serde_json::json!(longest["systemSurfaces.openToRefresh"])
    );
}
