use super::super::*;

use std::fmt;

use serde::de::{Deserializer, MapAccess, SeqAccess, Visitor};

use crate::{
    FfiActivityMetrics, FfiClaimBasis, FfiFtpTrend, FfiPaceTrend, FfiPeriodStats,
    FfiWellnessSparklines, WidgetSummaryCardData,
};

// Midnight plus 53 minutes on the wall clock, so a ride 3000 s earlier is today
// and one 3600 s earlier is yesterday.
const NOW: i64 = 1_733_360_000;

// The two clocks agree at offset zero, which is the case these were written for.
const CLOCK: Clock = Clock {
    now_seconds: NOW,
    now_wall_seconds: NOW,
};

const LABELS: &[(&str, &str)] = &[
    ("metrics.form", "Form"),
    ("metrics.fitness", "Fitness"),
    ("metrics.fatigue", "Fatigue"),
    ("metrics.hrv", "HRV"),
    ("metrics.rhr", "RHR"),
    ("metrics.week", "Week"),
    ("recording.startActivity", "Start Activity"),
    ("fitnessScreen.perWeek", "/Woche"),
    ("fitnessScreen.rampRate", "Ramp"),
    ("metrics.ftp", "FTP"),
    ("metrics.pace", "Pace"),
    ("metrics.css", "CSS"),
    ("formZones.highRisk", "High Risk"),
    ("formZones.optimal", "Optimal"),
    ("formZones.greyZone", "Grey Zone"),
    ("formZones.fresh", "Fresh"),
    ("formZones.transition", "Transition"),
    ("time.today", "Today"),
    ("time.yesterday", "Yesterday"),
];

/// The engine data and app settings one snapshot is composed from.
#[derive(Clone)]
struct Raw {
    sparklines: Option<FfiWellnessSparklines>,
    summary: Option<WidgetSummaryCardData>,
    latest: Option<FfiActivityMetrics>,
    latest_is_pr: bool,
    ramp_rate: Option<f64>,
    summary_prefs: Option<SummaryPrefs>,
    form_as_percent: bool,
}

fn series(
    fitness: &[i32],
    fatigue: &[i32],
    form: &[i32],
    hrv: &[i32],
    rhr: &[i32],
) -> FfiWellnessSparklines {
    FfiWellnessSparklines {
        fitness: fitness.to_vec(),
        fatigue: fatigue.to_vec(),
        form: form.to_vec(),
        hrv: hrv.to_vec(),
        rhr: rhr.to_vec(),
        ..Default::default()
    }
}

/// Every series held at one value per day, beside the given fitness.
fn steady_beside(fitness: &[i32]) -> FfiWellnessSparklines {
    let n = fitness.len();
    series(
        fitness,
        &vec![20; n],
        &vec![5; n],
        &vec![60; n],
        &vec![50; n],
    )
}

fn make_raw() -> Raw {
    Raw {
        // Oldest first, the last entry today, as the engine returns them.
        sparklines: Some(series(
            &[66, 67, 68, 69, 70, 71, 72],
            &[66, 68, 70, 72, 74, 76, 80],
            &[0, -1, -2, -3, -4, -5, -8],
            &[62, 63, 67, 64, 66, 65, 68],
            &[47, 48, 49, 50, 48, 49, 48],
        )),
        summary: Some(WidgetSummaryCardData {
            current_week: FfiPeriodStats {
                count: 4,
                total_duration: 23_400.0,
                total_distance: 184_000.0,
                total_tss: 412.0,
            },
            prev_week: FfiPeriodStats {
                count: 3,
                total_duration: 19_000.0,
                total_distance: 150_000.0,
                total_tss: 349.0,
            },
            ftp_trend: FfiFtpTrend {
                latest_ftp: Some(251),
                previous_ftp: Some(245),
                ..Default::default()
            },
            run_pace_trend: FfiPaceTrend {
                latest_pace: Some(3.4),
                previous_pace: Some(3.3),
                ..Default::default()
            },
            ..Default::default()
        }),
        latest: Some(FfiActivityMetrics {
            activity_id: "i123".to_string(),
            name: "Morning Ride".to_string(),
            // Earlier today, so the impact applies.
            date: (NOW - 3000) as f64,
            distance: 42_100.0,
            moving_time: 5660,
            training_load: Some(62.0),
            sport_type: "Ride".to_string(),
            ..Default::default()
        }),
        latest_is_pr: false,
        ramp_rate: None,
        summary_prefs: Some(SummaryPrefs {
            enabled: true,
            hero_metric: "fitness".to_string(),
            show_sparkline: true,
            supporting_metrics: ["fitness", "ftp", "weekHours", "weight"]
                .map(String::from)
                .to_vec(),
        }),
        form_as_percent: false,
    }
}

fn english_dates() -> DateWords {
    let literal = |kind: &str, value: &str| DatePart {
        kind: kind.to_string(),
        value: value.to_string(),
    };
    DateWords {
        weekdays: [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ]
        .map(String::from)
        .to_vec(),
        month_day: DatePattern {
            parts: vec![
                literal("month", ""),
                literal("literal", " "),
                literal("day", ""),
            ],
            months: [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]
            .map(String::from)
            .to_vec(),
        },
        ..Default::default()
    }
}

fn context(raw: &Raw) -> WidgetContext {
    WidgetContext {
        locale: "en-AU".to_string(),
        is_metric: true,
        form_as_percent: raw.form_as_percent,
        strings: LABELS
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        dates: english_dates(),
        summary_card: raw.summary_prefs.clone(),
        theme: serde_json::json!({
            "light": {
                "primary": "#0D9488",
                "gold": "#D4AF37",
                "formOptimal": "#66BB6A",
                "fatigue": "#A855F7",
            },
            "dark": {
                "primary": "#2DD4BF",
                "formOptimal": "#66BB6A",
                "fatigue": "#C084FC",
            },
        }),
        activity_tints: [("Ride", "#3B82F6"), ("Other", "#64748B")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        ..Default::default()
    }
}

/// Stands in for the engine's wellness summary: each value is the newest
/// sparkline entry and each arrow the sign of its move from the entry before.
fn engine_wellness(sp: &FfiWellnessSparklines) -> WidgetWellnessSummary {
    let last = |s: &[i32]| s.last().map(|v| f64::from(*v));
    let previous = |s: &[i32]| (s.len() >= 2).then(|| f64::from(s[s.len() - 2]));
    let arrow = |s: &[i32]| {
        let glyph = match s {
            [.., before, today] if today > before => "↑",
            [.., before, today] if today < before => "↓",
            _ => "→",
        };
        Some(glyph.to_string())
    };
    WidgetWellnessSummary {
        fitness: last(&sp.fitness),
        fitness_trend: arrow(&sp.fitness),
        form: last(&sp.form),
        form_trend: arrow(&sp.form),
        hrv: last(&sp.hrv),
        hrv_trend: arrow(&sp.hrv),
        rhr: last(&sp.rhr),
        rhr_trend: arrow(&sp.rhr),
        fatigue: last(&sp.fatigue),
        fitness_previous: previous(&sp.fitness),
        fatigue_previous: previous(&sp.fatigue),
        form_previous: previous(&sp.form),
        hrv_previous: previous(&sp.hrv),
        rhr_previous: previous(&sp.rhr),
        fatigue_basis: earlier(&sp.fatigue),
        ..Default::default()
    }
}

/// Every entry before the newest as an earlier reading, which is what the
/// engine counts toward its floor.
fn earlier(s: &[i32]) -> Option<FfiClaimBasis> {
    Some(FfiClaimBasis {
        baseline: "earlierReading".to_string(),
        population: s.len().saturating_sub(1) as u32,
    })
}

fn compose_raw(raw: &Raw) -> WidgetSnapshot {
    let mut summary = raw.summary.clone().unwrap_or_default();
    // The engine has no wellness summary to give without a summary or a series.
    if let (Some(sp), Some(_)) = (&raw.sparklines, &raw.summary) {
        summary.wellness = engine_wellness(sp);
    }
    let data = FfiWidgetSnapshotData {
        sparklines: raw.sparklines.clone(),
        summary,
        latest: raw.latest.clone(),
        latest_is_pr: raw.latest_is_pr,
        latest_gps: Vec::new(),
        ramp_rate: raw.ramp_rate,
    };
    compose(&data, &context(raw), CLOCK)
}

fn snapshot() -> WidgetSnapshot {
    compose_raw(&make_raw())
}

fn with_latest_date(date: i64) -> Raw {
    let mut raw = make_raw();
    raw.latest.as_mut().unwrap().date = date as f64;
    raw
}

fn sparklines_mut(raw: &mut Raw) -> &mut FfiWellnessSparklines {
    raw.sparklines.as_mut().unwrap()
}

fn json(snapshot: &WidgetSnapshot) -> serde_json::Value {
    serde_json::to_value(snapshot).unwrap()
}

/// Counts the non-finite numbers in a value. JSON writes NaN as null, so the
/// scan goes through MessagePack, which keeps the float as it is.
struct NonFinite(usize);

impl<'de> serde::Deserialize<'de> for NonFinite {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(NonFiniteVisitor)
    }
}

struct NonFiniteVisitor;

impl<'de> Visitor<'de> for NonFiniteVisitor {
    type Value = NonFinite;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any value")
    }

    fn visit_bool<E>(self, _: bool) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_i64<E>(self, _: i64) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_u64<E>(self, _: u64) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_f64<E>(self, v: f64) -> Result<NonFinite, E> {
        Ok(NonFinite(usize::from(!v.is_finite())))
    }

    fn visit_str<E>(self, _: &str) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_bytes<E>(self, _: &[u8]) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_unit<E>(self) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_none<E>(self) -> Result<NonFinite, E> {
        Ok(NonFinite(0))
    }

    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<NonFinite, D::Error> {
        serde::Deserialize::deserialize(d)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<NonFinite, A::Error> {
        let mut n = 0;
        while let Some(NonFinite(k)) = seq.next_element()? {
            n += k;
        }
        Ok(NonFinite(n))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<NonFinite, A::Error> {
        let mut n = 0;
        while let Some((NonFinite(k), NonFinite(v))) = map.next_entry()? {
            n += k + v;
        }
        Ok(NonFinite(n))
    }
}

fn assert_all_finite(snapshot: &WidgetSnapshot) {
    let bytes = rmp_serde::to_vec_named(snapshot).unwrap();
    let NonFinite(n) = rmp_serde::from_slice(&bytes).unwrap();
    assert_eq!(n, 0, "the snapshot carries {n} non-finite numbers");
}

fn gps_line(n: usize) -> Vec<FfiGpsPoint> {
    (0..n)
        .map(|i| FfiGpsPoint {
            latitude: 47.0 + i as f64 * 0.001,
            longitude: 8.0 + i as f64 * 0.002,
            elevation: None,
        })
        .collect()
}

fn gps(latitude: f64, longitude: f64) -> FfiGpsPoint {
    FfiGpsPoint {
        latitude,
        longitude,
        elevation: None,
    }
}

// ---------------------------------------------------------------------------
// The composed snapshot
// ---------------------------------------------------------------------------

#[test]
fn emits_the_versioned_shape_with_the_light_and_dark_theme_carried_through() {
    let s = snapshot();
    assert_eq!(s.schema_version, SCHEMA_VERSION);
    assert_eq!(s.generated_at, NOW);
    assert_eq!(s.locale, "en-AU");
    let theme = &json(&s)["theme"];
    assert_eq!(theme["light"]["primary"], "#0D9488");
    assert_eq!(theme["dark"]["primary"], "#2DD4BF");
    assert_eq!(theme["light"]["gold"], "#D4AF37");
    assert_eq!(theme["light"]["formOptimal"], "#66BB6A");
    assert_eq!(theme["dark"]["formOptimal"], "#66BB6A");
    assert_eq!(theme["light"]["fatigue"], "#A855F7");
    assert_eq!(theme["dark"]["fatigue"], "#C084FC");
}

#[test]
fn computes_today_against_yesterday_trends_with_a_deadband() {
    let s = snapshot();
    assert_eq!(
        s.metrics.form,
        MetricValue {
            value: -8.0,
            trend_dir: "down",
            verdict: "moved",
            delta_vs_yesterday: Some(-3.0),
            zone: Some("greyZone"),
            text: Some("-8".to_string()),
        }
    );
    assert_eq!(
        s.metrics.fitness,
        MetricValue {
            value: 72.0,
            trend_dir: "up",
            verdict: "improved",
            delta_vs_yesterday: Some(1.0),
            zone: None,
            text: None,
        }
    );
    assert_eq!(s.metrics.fatigue.trend_dir, "up");
}

#[test]
fn assigns_the_form_zone_from_the_intervals_icu_tsb_boundaries() {
    let zone_for = |tsb: i32| {
        let mut raw = make_raw();
        sparklines_mut(&mut raw).form = vec![tsb, tsb];
        compose_raw(&raw).metrics.form.zone
    };
    assert_eq!(zone_for(-35), Some("highRisk"));
    assert_eq!(zone_for(-20), Some("optimal"));
    assert_eq!(zone_for(0), Some("greyZone"));
    assert_eq!(zone_for(10), Some("fresh"));
    assert_eq!(zone_for(30), Some("transition"));
}

#[test]
fn reads_flat_when_the_change_is_within_the_deadband() {
    let mut raw = make_raw();
    raw.sparklines = Some(series(
        &[70, 70],
        &[60, 60],
        &[10, 10],
        &[50, 50],
        &[45, 45],
    ));
    let s = compose_raw(&raw);
    assert_eq!(s.metrics.form.trend_dir, "flat");
    assert_eq!(s.metrics.fitness.trend_dir, "flat");
}

#[test]
fn derives_the_latest_activity_with_formatted_labels() {
    let s = snapshot();
    let latest = s.latest.expect("a latest activity");
    assert_eq!(latest.activity_id, "i123");
    assert_eq!(latest.distance_label, "42.1 km");
    assert_eq!(latest.duration_label, "1:34:20");
    assert_eq!(latest.date_label, "Today");
    assert_eq!(latest.tint_hex, "#3B82F6");
}

#[test]
fn an_activity_with_no_recorded_load_carries_no_load() {
    for recorded in [None, Some(0.0)] {
        let mut raw = make_raw();
        raw.latest.as_mut().unwrap().training_load = recorded;
        let latest = compose_raw(&raw).latest.expect("a latest activity");
        assert_eq!(latest.training_load, None, "recorded {recorded:?}");
    }
}

#[test]
fn expresses_the_latest_activity_impact_on_the_trend() {
    let impact = snapshot().impact.expect("an impact");
    assert_eq!(impact.form_before, -5.0);
    assert_eq!(impact.form_after, -8.0);
    assert_eq!(impact.form_before_text, "-5");
    assert_eq!(impact.form_after_text, "-8");
    assert_eq!(impact.form_before_zone, Some("greyZone"));
    assert_eq!(impact.form_after_zone, Some("greyZone"));
    assert_eq!(impact.ctl_delta, 1.0);
    assert_eq!(impact.atl_delta, 4.0);
    assert_eq!(impact.tss_added, Some(62.0));
    assert_eq!(impact.date_label, "Today");
}

#[test]
fn pairs_a_ride_from_yesterday_with_the_points_ending_on_its_own_day() {
    // 23:53 yesterday on the wall clock.
    let s = compose_raw(&with_latest_date(NOW - 3600));
    let impact = s.impact.expect("an impact");
    assert_eq!(impact.form_before, -4.0);
    assert_eq!(impact.form_after, -5.0);
    assert_eq!(impact.ctl_delta, 1.0);
    assert_eq!(impact.atl_delta, 2.0);
    assert_eq!(impact.tss_added, Some(62.0));
    assert_eq!(
        s.display.impact_line.as_deref(),
        Some("Form -4 → -5 · +62 TSS")
    );
}

#[test]
fn pairs_a_ride_from_two_days_ago_with_the_points_ending_on_that_day() {
    let impact = compose_raw(&with_latest_date(NOW - 86_400 - 3600))
        .impact
        .expect("an impact");
    assert_eq!(impact.form_before, -3.0);
    assert_eq!(impact.form_after, -4.0);
    assert_eq!(impact.ctl_delta, 1.0);
    assert_eq!(impact.atl_delta, 2.0);
}

#[test]
fn suppresses_the_impact_when_the_ride_day_has_no_earlier_point_in_the_series() {
    let mut raw = with_latest_date(NOW - 86_400 - 3600);
    let sp = sparklines_mut(&mut raw);
    sp.form = vec![-5, -8];
    sp.fitness = vec![71, 72];
    sp.fatigue = vec![76, 80];
    assert_eq!(compose_raw(&raw).impact, None);
}

#[test]
fn zones_the_impact_before_and_after_values_independently() {
    let mut raw = make_raw();
    sparklines_mut(&mut raw).form = vec![-2, 0, 2, 4, 6, 8, -12];
    let impact = compose_raw(&raw).impact.expect("an impact");
    // 8 yesterday, -12 today.
    assert_eq!(impact.form_before_zone, Some("fresh"));
    assert_eq!(impact.form_after_zone, Some("optimal"));
}

#[test]
fn defaults_the_latest_record_flag_to_false_and_passes_an_engine_record_through() {
    assert!(!snapshot().latest.unwrap().is_pr);
    let mut raw = make_raw();
    raw.latest_is_pr = true;
    assert!(compose_raw(&raw).latest.unwrap().is_pr);
}

#[test]
fn carries_localised_labels_and_a_composed_impact_line() {
    let s = snapshot();
    assert_eq!(
        s.display.metric_labels,
        MetricLabels {
            form: "Form".to_string(),
            fitness: "Fitness".to_string(),
            fatigue: "Fatigue".to_string(),
            hrv: "HRV".to_string(),
            rhr: "RHR".to_string(),
            ramp: "Ramp".to_string(),
        }
    );
    assert_eq!(s.display.week_label, "Week");
    assert_eq!(s.display.record_label, "Start Activity");
    assert_eq!(s.display.per_week_suffix, "/Woche");
    assert_eq!(s.display.form_zone, "Grey Zone");
    assert_eq!(
        s.display.impact_line.as_deref(),
        Some("Form -5 → -8 · +62 TSS")
    );
}

#[test]
fn suppresses_the_impact_and_its_line_for_a_stale_latest_activity() {
    let s = compose_raw(&with_latest_date(NOW - 5 * 86_400));
    assert_eq!(s.impact, None);
    assert_eq!(s.display.impact_line, None);
    let shape = json(&s);
    assert!(shape["impact"].is_null());
    assert!(shape["display"]["impactLine"].is_null());
}

#[test]
fn keeps_sparklines_oldest_first_for_left_to_right_drawing() {
    let s = snapshot();
    assert_eq!(s.sparklines.form.last(), Some(&-8));
    assert_eq!(s.sparklines.fitness[0], 66);
    assert_eq!(s.sparklines.fatigue[0], 66);
    assert_eq!(s.sparklines.fatigue.last(), Some(&80));
}

#[test]
fn writes_no_per_day_zone_beside_the_form_sparkline() {
    let json = serde_json::to_value(snapshot()).unwrap();
    assert!(json["sparklines"].get("formZones").is_none());
    assert!(json["sparklines"]["form"].is_array());
}

#[test]
fn computes_the_weekly_delta_percent_and_none_when_last_week_had_no_load() {
    assert_eq!(snapshot().weekly.delta_pct, Some(18));
    let mut no_prev = make_raw();
    no_prev.summary.as_mut().unwrap().prev_week.total_tss = 0.0;
    let s = compose_raw(&no_prev);
    assert_eq!(s.weekly.delta_pct, None);
    assert!(json(&s)["weekly"]["deltaPct"].is_null());
}

#[test]
fn is_null_safe_with_no_engine_data_and_never_emits_a_non_finite_number() {
    let ctx = WidgetContext {
        locale: "en-US".to_string(),
        is_metric: true,
        ..Default::default()
    };
    let s = compose(&FfiWidgetSnapshotData::default(), &ctx, CLOCK);
    assert_eq!(
        s.metrics.form,
        MetricValue {
            value: 0.0,
            trend_dir: "flat",
            verdict: "flat",
            delta_vs_yesterday: None,
            zone: Some("greyZone"),
            text: Some("-".to_string()),
        }
    );
    assert_eq!(s.metrics.ramp_rate.value, 0.0);
    assert_eq!(s.weekly.tss, 0);
    assert_eq!(s.weekly.count, 0);
    assert_eq!(s.weekly.delta_pct, None);
    assert_eq!(s.latest, None);
    assert_eq!(s.impact, None);
    assert_all_finite(&s);
}

#[test]
fn mirrors_the_in_app_summary_card_settings_as_a_ready_to_render_block() {
    let card = snapshot().summary_card.expect("a summary card");
    assert_eq!(
        card.hero,
        SummaryEntry {
            id: "fitness".to_string(),
            label: "Fitness".to_string(),
            value: "72".to_string(),
            trend_dir: "up",
            verdict: "improved",
            colour_key: "blue",
        }
    );
    // Weight is left out: the widget read has no source for it.
    let ids: Vec<&str> = card.entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["fitness", "ftp", "weekHours"]);
    assert_eq!(
        card.entries[1],
        SummaryEntry {
            id: "ftp".to_string(),
            label: "FTP".to_string(),
            value: "251".to_string(),
            trend_dir: "up",
            verdict: "improved",
            colour_key: "default",
        }
    );
    assert_eq!(card.entries[2].value, "6.5h");
    assert_eq!(card.sparkline, "fitnessForm");
}

#[test]
fn selects_the_hrv_sparkline_for_an_hrv_hero_and_none_when_disabled() {
    let mut hrv_hero = make_raw();
    hrv_hero.summary_prefs.as_mut().unwrap().hero_metric = "hrv".to_string();
    let card = compose_raw(&hrv_hero).summary_card.unwrap();
    assert_eq!(card.sparkline, "hrv");
    assert_eq!(card.hero.id, "hrv");

    let mut no_spark = make_raw();
    no_spark.summary_prefs.as_mut().unwrap().show_sparkline = false;
    assert_eq!(
        compose_raw(&no_spark).summary_card.unwrap().sparkline,
        "none"
    );
}

#[test]
fn omits_the_summary_block_when_disabled_or_the_settings_are_missing() {
    let mut disabled = make_raw();
    disabled.summary_prefs.as_mut().unwrap().enabled = false;
    let s = compose_raw(&disabled);
    assert_eq!(s.summary_card, None);
    assert!(json(&s)["summaryCard"].is_null());

    let mut missing = make_raw();
    missing.summary_prefs = None;
    assert_eq!(compose_raw(&missing).summary_card, None);
}

#[test]
fn renders_a_dash_for_summary_metrics_with_no_backing_data() {
    let mut raw = make_raw();
    raw.sparklines = None;
    raw.summary_prefs.as_mut().unwrap().supporting_metrics =
        ["hrv", "rhr", "css"].map(String::from).to_vec();
    let card = compose_raw(&raw).summary_card.unwrap();
    let values: Vec<&str> = card.entries.iter().map(|e| e.value.as_str()).collect();
    assert_eq!(values, ["-", "-", "-"]);
    let dirs: Vec<&str> = card.entries.iter().map(|e| e.trend_dir).collect();
    assert_eq!(dirs, ["flat", "flat", "flat"]);
}

// The app once received these as big integers; the engine now hands over plain
// numbers, and they must come out unchanged.
#[test]
fn carries_the_activity_date_and_week_duration_through_as_numbers() {
    let mut raw = with_latest_date(NOW - 3600);
    raw.summary.as_mut().unwrap().current_week.total_duration = 23_400.0;
    let s = compose_raw(&raw);
    assert_eq!(s.latest.as_ref().unwrap().date, (NOW - 3600) as f64);
    assert_eq!(s.weekly.duration_s, 23_400.0);
    assert_all_finite(&s);
}

// ---------------------------------------------------------------------------
// The route outline
// ---------------------------------------------------------------------------

#[test]
fn normalises_points_into_the_unit_box_with_a_bounded_aspect() {
    let preview = route_outline(&gps_line(50), ROUTE_OUTLINE_MAX_POINTS).expect("an outline");
    for [x, y] in &preview.points {
        assert!((0.0..=1.0).contains(x), "x {x} out of the box");
        assert!((0.0..=1.0).contains(y), "y {y} out of the box");
    }
    assert!((0.1..=10.0).contains(&preview.aspect));
    // A northward track starts in the south, so it draws at the bottom.
    assert_eq!(preview.points[0][1], 1.0);
}

#[test]
fn downsamples_long_tracks_and_keeps_the_final_point() {
    let preview = route_outline(&gps_line(5000), ROUTE_OUTLINE_MAX_POINTS).expect("an outline");
    assert!(preview.points.len() <= ROUTE_OUTLINE_MAX_POINTS + 1);
    assert_eq!(preview.points.last(), Some(&[1.0, 0.0]));
}

// A real intervals.icu week, where fitness falls and form rises, so reading
// the series newest first would be unmistakable rather than off by a little.
#[test]
fn reports_the_newest_day_matching_what_the_fitness_tab_shows() {
    let mut raw = make_raw();
    raw.sparklines = Some(series(
        &[37, 36, 35, 34, 35, 34, 33, 32],
        &[34, 29, 25, 22, 25, 21, 19, 16],
        &[3, 7, 10, 12, 10, 13, 14, 16],
        &[60, 61, 62, 63, 64, 65, 66, 67],
        &[50, 50, 49, 49, 48, 48, 47, 46],
    ));
    let s = compose_raw(&raw);

    assert_eq!(s.metrics.fitness.value, 32.0);
    assert_eq!(s.metrics.fatigue.value, 16.0);
    assert_eq!(s.metrics.form.value, 16.0);
    assert_eq!(s.metrics.hrv.value, 67.0);
    assert_eq!(s.metrics.rhr.value, 46.0);

    assert_eq!(s.metrics.fitness.trend_dir, "down");
    assert_eq!(s.metrics.form.trend_dir, "up");
}

#[test]
fn has_no_outline_for_a_missing_short_or_degenerate_track() {
    assert_eq!(route_outline(&[], ROUTE_OUTLINE_MAX_POINTS), None);
    assert_eq!(route_outline(&gps_line(1), ROUTE_OUTLINE_MAX_POINTS), None);
    let stationary = vec![gps(47.0, 8.0); 10];
    assert_eq!(route_outline(&stationary, ROUTE_OUTLINE_MAX_POINTS), None);
    let junk = [gps(f64::NAN, 8.0), gps(47.0, f64::NAN)];
    assert_eq!(route_outline(&junk, ROUTE_OUTLINE_MAX_POINTS), None);
}

// ---------------------------------------------------------------------------
// One entry per calendar day: the last is today, the one before yesterday
// ---------------------------------------------------------------------------

/// Thirty days of fitness, climbing by one a day to 60 today.
fn thirty_days() -> Vec<i32> {
    (31..=60).collect()
}

fn snapshot_of_fitness(fitness: &[i32]) -> WidgetSnapshot {
    let mut raw = make_raw();
    raw.sparklines = Some(steady_beside(fitness));
    compose_raw(&raw)
}

#[test]
fn takes_yesterday_from_the_entry_before_last() {
    let s = snapshot_of_fitness(&thirty_days());
    assert_eq!(s.metrics.fitness.value, 60.0);
    assert_eq!(s.metrics.fitness.delta_vs_yesterday, Some(1.0));
}

#[test]
fn reads_a_flat_stretch_as_flat_rather_than_as_missing_days() {
    let mut flat_end = thirty_days()[..27].to_vec();
    flat_end.extend([58, 58, 58]);
    let s = snapshot_of_fitness(&flat_end);
    assert_eq!(s.metrics.fitness.delta_vs_yesterday, Some(0.0));
    assert_eq!(s.metrics.fitness.trend_dir, "flat");
}

#[test]
fn answers_on_a_series_shorter_than_the_ramp_window() {
    assert_eq!(
        snapshot_of_fitness(&[40, 42, 44]).metrics.fitness.value,
        44.0
    );
}

// ---------------------------------------------------------------------------
// The ramp rate is the stored figure, never one derived from the sparkline
// ---------------------------------------------------------------------------

fn snapshot_of_ramp(ramp_rate: Option<f64>) -> WidgetSnapshot {
    let mut raw = make_raw();
    raw.ramp_rate = ramp_rate;
    // Climbing one a day, so a ramp derived from the sparkline would read 6.
    raw.sparklines = Some(steady_beside(&thirty_days()));
    compose_raw(&raw)
}

#[test]
fn takes_the_stored_ramp_rather_than_the_sparkline_it_sits_beside() {
    assert_eq!(snapshot_of_ramp(Some(2.3)).metrics.ramp_rate.value, 2.3);
}

#[test]
fn carries_a_negative_ramp_through() {
    assert_eq!(snapshot_of_ramp(Some(-4.6)).metrics.ramp_rate.value, -4.6);
}

#[test]
fn rounds_the_ramp_to_the_one_decimal_the_widget_has_always_shown() {
    assert_eq!(snapshot_of_ramp(Some(2.34567)).metrics.ramp_rate.value, 2.3);
}

#[test]
fn reads_a_zero_ramp_before_wellness_has_synced_never_nan() {
    let s = snapshot_of_ramp(None);
    assert_eq!(s.metrics.ramp_rate.value, 0.0);
    assert_all_finite(&s);
}

// ---------------------------------------------------------------------------
// Form readouts under the percentage setting
// ---------------------------------------------------------------------------

fn snapshot_of_form(fitness_today: i32, as_percent: bool) -> WidgetSnapshot {
    let mut raw = make_raw();
    raw.form_as_percent = as_percent;
    let sp = sparklines_mut(&mut raw);
    sp.fitness = vec![40, fitness_today];
    sp.fatigue = vec![44, fitness_today + 8];
    sp.form = vec![-4, -8];
    raw.summary_prefs.as_mut().unwrap().supporting_metrics = vec!["form".to_string()];
    compose_raw(&raw)
}

fn form_entry(s: &WidgetSnapshot) -> &SummaryEntry {
    let card = s.summary_card.as_ref().expect("a summary card");
    card.entries
        .iter()
        .find(|e| e.id == "form")
        .expect("a form entry")
}

#[test]
fn prints_every_form_readout_as_a_percentage_of_fitness() {
    let s = snapshot_of_form(40, true);
    let impact = s.impact.as_ref().expect("an impact");
    assert_eq!(s.metrics.form.text.as_deref(), Some("-20%"));
    assert_eq!(form_entry(&s).value, "-20%");
    assert_eq!(impact.form_before_text, "-10%");
    assert_eq!(impact.form_after_text, "-20%");
    assert_eq!(
        s.display.impact_line.as_deref(),
        Some("Form -10% → -20% · +62 TSS")
    );
}

#[test]
fn prints_no_number_and_no_zone_when_the_denominator_is_zero() {
    let s = snapshot_of_form(0, true);
    let impact = s.impact.as_ref().expect("an impact");
    assert_eq!(s.metrics.form.text.as_deref(), Some("-"));
    assert_eq!(s.metrics.form.zone, None);
    let shape = json(&s);
    let form = shape["metrics"]["form"].as_object().unwrap();
    assert!(
        !form.contains_key("zone"),
        "a form with no zone must omit the field"
    );
    assert_eq!(form_entry(&s).value, "-");
    assert_eq!(impact.form_after_text, "-");
    let line = s.display.impact_line.as_deref().expect("an impact line");
    assert!(!line.contains("-8"), "the line printed a raw TSB: {line}");
}

#[test]
fn restores_the_absolute_readouts_with_the_setting_off() {
    let s = snapshot_of_form(40, false);
    let impact = s.impact.as_ref().expect("an impact");
    assert_eq!(s.metrics.form.text.as_deref(), Some("-8"));
    assert_eq!(form_entry(&s).value, "-8");
    assert_eq!(impact.form_before_text, "-4");
    assert_eq!(impact.form_after_text, "-8");
    assert_eq!(
        s.display.impact_line.as_deref(),
        Some("Form -4 → -8 · +62 TSS")
    );
}

#[test]
fn signs_a_positive_form() {
    let mut raw = make_raw();
    sparklines_mut(&mut raw).form = vec![1, 3];
    let s = compose_raw(&raw);
    assert_eq!(s.metrics.form.text.as_deref(), Some("+3"));
    let line = s.display.impact_line.as_deref().expect("an impact line");
    assert!(line.contains("+1 → +3"), "unsigned form in {line}");
}

// ---------------------------------------------------------------------------
// The empty library flag
// ---------------------------------------------------------------------------

fn no_series() -> FfiWellnessSparklines {
    FfiWellnessSparklines::default()
}

#[test]
fn flags_an_empty_library_with_no_activity_no_series_and_no_wellness() {
    let mut nothing = make_raw();
    nothing.sparklines = None;
    nothing.summary = None;
    nothing.latest = None;
    assert!(compose_raw(&nothing).empty_library);

    let mut empty_series = make_raw();
    empty_series.sparklines = Some(no_series());
    empty_series.summary = None;
    empty_series.latest = None;
    assert!(compose_raw(&empty_series).empty_library);
}

#[test]
fn clears_the_empty_library_flag_when_an_activity_exists_without_wellness() {
    let mut raw = make_raw();
    raw.sparklines = Some(no_series());
    assert!(!compose_raw(&raw).empty_library);
}

#[test]
fn clears_the_empty_library_flag_when_wellness_exists_without_an_activity() {
    let mut raw = make_raw();
    raw.latest = None;
    assert!(!compose_raw(&raw).empty_library);
}
