//! The home-screen widget snapshot: the small, pre-formatted JSON the widgets
//! render. Widgets run in a separate process with no engine, so everything they
//! show is baked here.
//!
//! One composer, because two callers write the file. The app writes it on a
//! background transition and a settled sync, and the Android push worker writes
//! it after a pushed ride lands, when no JavaScript is running. What only the
//! app knows (the translated words, the date names, the palette, the summary
//! card settings, the recent sports) it hands over as a [`WidgetContext`], which
//! is stored so the worker composes from the same one.
//!
//! Sparklines are ordered oldest first, which is also the order the native
//! charts draw: the last element is today and the one before it yesterday.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    FfiGpsPoint, FfiWidgetSnapshotData, WidgetLatestComparison, WidgetRouteStanding,
    WidgetWellnessSummary,
};

#[cfg(test)]
mod tests;

/// Bumped when the shape changes, so a native can tell a snapshot it cannot read.
pub const SCHEMA_VERSION: u32 = 15;

/// Trailing wellness window the sparklines cover.
pub const SPARKLINE_DAYS: u32 = 30;

/// Trailing days of form the large widget draws, which is also how much
/// wellness one read takes.
pub const FORM_HISTORY_DAYS: u32 = 42;

/// Where the form zones change, on the intervals.icu TSB boundaries: below the
/// first is high risk, then optimal, grey zone, fresh, and from the last
/// transition. Natives draw the bands from these and never hold a copy.
const FORM_ZONE_BOUNDS: [i32; 4] = [-30, -10, 5, 25];

/// The most points a route outline carries, which keeps the file small.
pub const ROUTE_OUTLINE_MAX_POINTS: usize = 150;

/// The most prior attempts the latest activity carries, which keeps the file small.
pub const LATEST_ATTEMPTS_MAX: usize = 20;

/// The strength screen's month: today and the 29 days before it.
pub const STRENGTH_WINDOW_DAYS: i64 = 30;

/// The most muscles a strength window ranks by name, which is what the
/// largest widget lists.
pub const STRENGTH_TOP_MAX: usize = 4;

/// The strength tab on the 30 days the widget opens with.
const STRENGTH_URL: &str = "veloq://insights?tab=strength&period=1m";

/// Only attribute impact to a genuinely recent activity.
const IMPACT_MAX_AGE_DAYS: f64 = 2.0;

/// What a metric prints where the athlete has no reading, so a native never draws a zero.
const TEXT_NONE: &str = "-";

const SECONDS_PER_DAY: i64 = 86_400;
pub(crate) const KM_TO_MI: f64 = 0.621371;
const KG_TO_LB: f64 = 2.20462;
const M_TO_FT: f64 = 3.28084;
pub(crate) const YARDS_100_IN_METRES: f64 = 91.44;
const MAX_PACE_SECONDS: f64 = 100.0 * 3600.0;
const MAX_DURATION_SECONDS: f64 = 1e9;

// ============================================================================
// What the app hands over
// ============================================================================

/// Everything the snapshot needs that the engine does not hold, resolved by the
/// app for the locale and settings it is running with.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetContext {
    pub locale: String,
    pub is_metric: bool,
    /// Whether the athlete reads form as a share of fitness (`icu_form_as_percent`).
    pub form_as_percent: bool,
    /// Translations by i18next key. A key not here prints as itself.
    pub strings: BTreeMap<String, String>,
    pub dates: DateWords,
    /// The in-app summary card settings; absent hides the widget summary block.
    pub summary_card: Option<SummaryPrefs>,
    /// The resolved light and dark palettes, carried through untouched.
    pub theme: serde_json::Value,
    /// Sport tint by sport type, with `Other` as the fallback.
    pub activity_tints: BTreeMap<String, String>,
    /// Every recent sport, most recent first, already labelled and linked.
    pub record_shortcuts: Vec<RecordShortcut>,
    /// The head of `record_shortcuts`, capped at what a launcher shows.
    pub launcher_shortcuts: Vec<RecordShortcut>,
    /// The top-ranked insights the athlete's picked kinds allow, in the order
    /// the Insights tab ranks them, already worded and linked.
    pub insights: Vec<WidgetInsight>,
    /// The library behind the snapshot is the sample one, so every widget wears
    /// the demo label: demo mode, and the sample shown while signed out.
    pub demo: bool,
    /// The app composed the file from a sample library it supplied, and the
    /// rows the engine holds are not what the widgets show. A native refresh
    /// reads this context as none, so it leaves that file standing rather than
    /// redrawing the stored rows over it.
    pub sample: bool,
}

/// One insight row of the widget: its copy, its icon and tone, and the link it opens.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetInsight {
    pub id: String,
    pub category: String,
    pub title: String,
    pub subtitle: String,
    pub icon: String,
    pub tone: String,
    pub url: String,
}

/// The locale's own names for days and months, and the order a short date is
/// written in, so a relative date label needs no locale data here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DateWords {
    /// Long weekday names, Sunday first.
    pub weekdays: Vec<String>,
    /// A day and month in this year, as "Jan 5".
    pub month_day: DatePattern,
    /// A day and month in another year, as "Jan 5, 2023".
    pub month_day_year: DatePattern,
    /// Long month names as a label writes one alone, January first. Empty in a
    /// context stored before they were handed over.
    pub months: Vec<String>,
}

/// One date format: its parts in order, and the month names it writes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DatePattern {
    pub parts: Vec<DatePart>,
    /// January first.
    pub months: Vec<String>,
}

/// A piece of a date format: `month`, `day` or `year`, or `literal` with its text.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DatePart {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SummaryPrefs {
    pub enabled: bool,
    pub hero_metric: String,
    pub show_sparkline: bool,
    pub supporting_metrics: Vec<String>,
}

/// One recent sport: the id, the name a surface shows, and the link that starts it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RecordShortcut {
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub url: String,
}

/// Now, twice: the true instant the snapshot is stamped with, and the same
/// moment as the zoneless wall clock an activity's date is recorded in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Clock {
    pub now_seconds: i64,
    pub now_wall_seconds: i64,
}

impl Clock {
    /// The device clock, read through the local zone.
    pub fn now() -> Self {
        let now = chrono::Local::now();
        Clock {
            now_seconds: now.timestamp(),
            now_wall_seconds: now.naive_local().and_utc().timestamp(),
        }
    }
}

// ============================================================================
// What the widgets read
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub schema_version: u32,
    pub generated_at: i64,
    /// When the sync the rows came from finished, in seconds. Present only on a
    /// snapshot composed by a refresh whose pull did not land, and absent when
    /// the library has recorded no clean sync. `generated_at` is then the time
    /// of the redraw, which says nothing about how old the numbers are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_as_of: Option<i64>,
    pub locale: String,
    /// No latest activity, no wellness series and no wellness reading. The
    /// metrics then read zero, which is not a measurement, so a widget shows its
    /// prompt to open the app.
    pub empty_library: bool,
    /// Composed from the sample library because no account is signed in. Absent
    /// otherwise, so a stored library's file is unchanged.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub demo: bool,
    pub metrics: Metrics,
    pub sparklines: Sparklines,
    /// Six weeks of form for the large size, absent with no form series.
    pub form_history: Option<FormHistory>,
    pub weekly: Weekly,
    pub latest: Option<Latest>,
    pub impact: Option<Impact>,
    pub summary_card: Option<SummaryCard>,
    /// One entry for every metric the summary card can show, so a placement
    /// that picks its own hero and supporting row composes from them without a
    /// second read. Independent of the card's own choice and of whether it is
    /// enabled; a weight with no reading is left out, as on the card.
    pub summary_metrics: Vec<SummaryEntry>,
    pub display: Display,
    pub theme: serde_json::Value,
    pub record_shortcuts: Vec<RecordShortcut>,
    pub launcher_shortcuts: Vec<RecordShortcut>,
    pub insights: Vec<WidgetInsight>,
    /// The strength diagram over the two windows a widget can be placed on,
    /// present with no strength work too, so a native never words a window.
    pub strength: StrengthWidget,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub form: MetricValue,
    pub fitness: MetricValue,
    pub fatigue: MetricValue,
    pub ramp_rate: RampRate,
    pub hrv: MetricValue,
    pub rhr: MetricValue,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RampRate {
    pub value: f64,
}

/// One headline number with the arrow and verdict a native draws beside it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricValue {
    pub value: f64,
    /// An improvement points up and a decline down, whichever way the number went.
    pub trend_dir: &'static str,
    /// `improved`, `declined`, `moved` or `flat`, so no native holds a polarity.
    pub verdict: &'static str,
    /// The change from the value the trend was judged against, absent with none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_vs_yesterday: Option<f64>,
    /// Form only: its TSB zone, absent on a day with no fitness under the percentage setting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<&'static str>,
    /// What a native prints in place of the number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sparklines {
    pub form: Vec<i32>,
    pub fitness: Vec<i32>,
    pub fatigue: Vec<i32>,
    pub hrv: Vec<i32>,
}

/// Form per day, oldest first, in the unit the athlete reads it in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormHistory {
    /// The TSB, or its percentage of that day's fitness under `as_percent`,
    /// where a day with no fitness has no value.
    pub values: Vec<Option<i32>>,
    pub as_percent: bool,
    /// Where each zone ends, in the same unit as `values`.
    pub zone_bounds: [i32; 4],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weekly {
    pub tss: i64,
    pub distance_m: f64,
    pub duration_s: f64,
    pub count: u32,
    /// Percent change against last week, absent when last week had no load.
    pub delta_pct: Option<i64>,
    pub distance_label: String,
    pub duration_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    pub activity_id: String,
    pub name: String,
    pub sport_type: String,
    pub distance_m: f64,
    pub moving_time_s: f64,
    /// Zoneless wall-clock seconds.
    pub date: f64,
    pub training_load: Option<f64>,
    pub distance_label: String,
    pub duration_label: String,
    pub date_label: String,
    pub tint_hex: String,
    /// The activity set a route or section record.
    pub is_pr: bool,
    /// Absent for an activity with no track; the widget then draws text only.
    pub route_preview: Option<RouteOutline>,
    /// Where it stands among the attempts at its route, absent when it has no
    /// route or no other attempt at it.
    pub route: Option<RouteStanding>,
    /// How many sections it holds the record on.
    pub section_prs: u32,
    /// With no route, its load against the load the sport usually carries.
    pub load_vs_typical: Option<LoadVsTypical>,
    /// The figures that matter for its sport, in the order they are read.
    pub stats: Vec<SportStat>,
    /// What the Last activity widget leads with, worded for the athlete. Absent
    /// when the activity has neither a ranking nor a load, or the app handed
    /// over none of the words.
    pub headline: Option<Headline>,
    /// "Load 62", absent when no load was recorded.
    pub load_text: Option<String>,
    /// "Section PRs 3", absent when it holds none.
    pub section_prs_text: Option<String>,
}

/// The comparison a widget leads with: the rank among attempts on the route,
/// or with no ranking the load against the typical one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Headline {
    /// `route` or `load`.
    pub kind: &'static str,
    /// The route's name, or the word for load.
    pub label: String,
    /// "2 of 14", or the load itself.
    pub hero: String,
    /// The gap to the route record, or the load against the typical one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Every comparable attempt in date order, the latest last. Empty without a route.
    pub dots: Vec<AttemptDot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AttemptDot {
    /// The activity the widget is about.
    pub current: bool,
    /// The fastest attempt on the route.
    pub record: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStanding {
    pub name: String,
    /// One a strict record; absent when the attempt is not ranked on the route.
    pub rank: Option<u32>,
    /// Comparable attempts, the latest activity included.
    pub attempt_count: u32,
    /// Seconds behind the route record, zero for the record itself.
    pub gap_seconds: Option<i32>,
    /// The gap as a duration, with no sign and no words.
    pub gap_label: Option<String>,
    /// Moving time of up to twenty other comparable attempts, oldest first.
    pub attempt_seconds: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadVsTypical {
    /// The median load of the sport's activities in the four weeks before.
    pub typical: f64,
    /// How far the latest load sits above (positive) or below the typical one.
    pub delta_pct: i64,
}

/// One figure of the latest activity, labelled and formatted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SportStat {
    pub id: &'static str,
    pub label: String,
    pub value: String,
}

/// A track normalised to a 0..1 box, y growing downward like screen pixels.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RouteOutline {
    pub points: Vec<[f64; 2]>,
    /// Projected width over height, for letterboxed drawing.
    pub aspect: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub form_before: f64,
    pub form_after: f64,
    pub form_before_text: String,
    pub form_after_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form_before_zone: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form_after_zone: Option<&'static str>,
    pub ctl_delta: f64,
    pub atl_delta: f64,
    pub tss_added: Option<f64>,
    pub date_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryEntry {
    pub id: String,
    pub label: String,
    pub value: String,
    pub trend_dir: &'static str,
    pub verdict: &'static str,
    /// The palette role a native tints the value with.
    #[serde(rename = "colorKey")]
    pub colour_key: &'static str,
}

/// The in-app summary card as the athlete configured it, ready to draw.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCard {
    pub hero: SummaryEntry,
    /// Up to four, in the configured order.
    pub entries: Vec<SummaryEntry>,
    /// `fitnessForm`, `hrv` or `none`.
    pub sparkline: &'static str,
    /// The hero's own daily series, oldest first. Empty when the card hides its
    /// sparkline or the hero has no daily series.
    pub hero_sparkline: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub metric_labels: MetricLabels,
    pub week_label: String,
    /// The record control's spoken name, since its glyph carries no text.
    pub record_label: String,
    /// The widget refresh control's spoken labels in the athlete's language.
    pub refresh_label: String,
    pub refreshing_label: String,
    pub per_week_suffix: String,
    pub form_zone: String,
    pub impact_line: Option<String>,
    /// The words that say the numbers are as of the last sync. Present on the
    /// same snapshots as `data_as_of`, and also when no sync time is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_as_of_label: Option<String>,
    /// The small label every widget draws on a sample library's snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub demo_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthWidget {
    /// `male` or `female`: the body the strength tab draws for this athlete.
    pub body: &'static str,
    /// The strength tab on the trailing 30 days.
    pub url: &'static str,
    pub windows: StrengthWindows,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StrengthWindows {
    /// Today and the 29 days before it.
    pub last30: StrengthWindow,
    /// The calendar month to the end of today.
    pub month: StrengthWindow,
}

/// One window of the strength diagram, shaded and ranked as the strength
/// screen does it over the same days.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthWindow {
    /// What a picker calls the window: the strength tab's name for 30 days,
    /// or the month's name.
    pub label: String,
    pub activity_count: u32,
    pub total_sets: u32,
    /// Strength sessions in the window whose sets have not been downloaded.
    pub owed_count: u32,
    /// The most trained muscle's weighted sets, the top of the shade scale.
    pub max_weighted_sets: f64,
    /// Every trained muscle and its shade, most trained first.
    pub muscles: Vec<StrengthMuscle>,
    /// The most trained muscles, named and worded, at most `STRENGTH_TOP_MAX`.
    pub top: Vec<StrengthTopMuscle>,
    /// What a widget shows in place of the body when the window has no
    /// strength sessions: none, or sessions whose sets are still owed.
    pub empty_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StrengthMuscle {
    pub slug: String,
    /// 1 (lightest) to `DIAGRAM_SHADES`, against the window's most trained muscle.
    pub shade: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthTopMuscle {
    pub slug: String,
    pub name: String,
    /// Weighted sets, as the strength tab words a muscle's: "7.5 sets".
    pub sets_text: String,
    /// Weight times reps in the athlete's unit, absent for bodyweight work.
    pub volume_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricLabels {
    pub form: String,
    pub fitness: String,
    pub fatigue: String,
    pub hrv: String,
    pub rhr: String,
    pub ramp: String,
}

// ============================================================================
// Composition
// ============================================================================

/// Raw engine data to the widget snapshot. No I/O and no clock: the time is
/// handed in, so the same data and context always compose the same file.
pub fn compose(data: &FfiWidgetSnapshotData, ctx: &WidgetContext, clock: Clock) -> WidgetSnapshot {
    let sp = data.sparklines.as_ref();
    let recent = |pick: fn(&crate::FfiWellnessSparklines) -> &Vec<i32>| {
        sp.map_or(&[][..], |s| tail(pick(s), SPARKLINE_DAYS))
    };
    let fitness = recent(|s| &s.fitness);
    let fatigue = recent(|s| &s.fatigue);
    let form = recent(|s| &s.form);
    let hrv = recent(|s| &s.hrv);
    let rhr = recent(|s| &s.rhr);

    let as_percent = ctx.form_as_percent;
    let summary = &data.summary;
    let w = wellness_of(&summary.wellness);

    let cur_tss = finite(summary.current_week.total_tss);
    let prev_tss = finite(summary.prev_week.total_tss);
    let weekly_distance = finite(summary.current_week.total_distance);
    let weekly_duration = finite(summary.current_week.total_duration);
    let delta_pct =
        (prev_tss > 0.0).then(|| js_round((cur_tss - prev_tss) / prev_tss * 100.0) as i64);

    let latest = compose_latest(data, ctx, clock);
    let empty_library = latest.is_none()
        && w.is_none()
        && [fitness, fatigue, form, hrv, rhr]
            .iter()
            .all(|s| s.is_empty());
    let impact = compose_impact(
        clock,
        fitness,
        fatigue,
        form,
        latest.as_ref(),
        as_percent,
        w,
    );
    let today_zone = form_zone(
        f64::from(form.last().copied().unwrap_or(0)),
        Some(f64::from(fitness.last().copied().unwrap_or(0))),
        as_percent,
    );

    WidgetSnapshot {
        schema_version: SCHEMA_VERSION,
        generated_at: clock.now_seconds,
        data_as_of: None,
        locale: ctx.locale.clone(),
        empty_library,
        demo: ctx.demo,
        metrics: Metrics {
            form: form_metric(as_percent, w),
            fitness: wellness_metric(
                w.and_then(|w| w.fitness),
                w.and_then(|w| w.fitness_trend.as_deref()),
                w.and_then(|w| w.fitness_previous),
            ),
            fatigue: fatigue_metric(
                w.and_then(|w| w.fatigue),
                w.and_then(|w| w.fatigue_previous),
                w.and_then(|w| w.fatigue_basis.as_ref()),
            ),
            ramp_rate: RampRate {
                value: js_round(finite(data.ramp_rate.unwrap_or(0.0)) * 10.0) / 10.0,
            },
            hrv: wellness_metric(
                w.and_then(|w| w.hrv),
                w.and_then(|w| w.hrv_trend.as_deref()),
                w.and_then(|w| w.hrv_previous),
            ),
            rhr: wellness_metric(
                w.and_then(|w| w.rhr),
                w.and_then(|w| w.rhr_trend.as_deref()),
                w.and_then(|w| w.rhr_previous),
            ),
        },
        sparklines: Sparklines {
            form: form.to_vec(),
            fitness: fitness.to_vec(),
            fatigue: fatigue.to_vec(),
            hrv: hrv.to_vec(),
        },
        form_history: form_history(sp, as_percent),
        weekly: Weekly {
            tss: js_round(cur_tss) as i64,
            distance_m: weekly_distance,
            duration_s: weekly_duration,
            count: summary.current_week.count,
            delta_pct,
            distance_label: format_distance(weekly_distance, ctx.is_metric),
            duration_label: format_duration(weekly_duration),
        },
        summary_card: ctx
            .summary_card
            .as_ref()
            .filter(|p| p.enabled)
            .and_then(|prefs| summary_card(data, ctx, prefs)),
        summary_metrics: SUMMARY_METRIC_IDS
            .iter()
            .filter_map(|id| summary_entry(data, ctx, id, false))
            .collect(),
        display: display(ctx, impact.as_ref(), today_zone),
        latest,
        impact,
        theme: ctx.theme.clone(),
        record_shortcuts: ctx.record_shortcuts.clone(),
        launcher_shortcuts: ctx.launcher_shortcuts.clone(),
        insights: ctx.insights.clone(),
        strength: compose_strength(data, ctx, clock),
    }
}

/// The summary's wellness, or none when it carries no reading at all. The
/// engine always answers with the struct, so an empty one is the empty library
/// rather than a reading of zero.
fn wellness_of(w: &WidgetWellnessSummary) -> Option<&WidgetWellnessSummary> {
    let any = [w.fitness, w.form, w.fatigue, w.hrv, w.rhr, w.weight]
        .iter()
        .any(Option::is_some);
    any.then_some(w)
}

/// The newest `days` of a series that runs oldest first.
fn tail(series: &[i32], days: u32) -> &[i32] {
    &series[series.len().saturating_sub(days as usize)..]
}

fn finite(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

/// `Math.round`: halves go up, so -2.5 is -2, which is what the app printed.
fn js_round(v: f64) -> f64 {
    let floor = v.floor();
    if v - floor >= 0.5 { floor + 1.0 } else { floor }
}

fn translate<'a>(ctx: &'a WidgetContext, key: &'a str) -> &'a str {
    ctx.strings.get(key).map_or(key, String::as_str)
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

const FLAT: (&str, &str) = ("flat", "flat");

/// The arrow and verdict for an engine glyph. `judged` is false for a metric
/// with no polarity, where the glyph is the number's own direction.
fn from_glyph(glyph: Option<&str>, judged: bool) -> (&'static str, &'static str) {
    match glyph {
        Some("↑") => ("up", if judged { "improved" } else { "moved" }),
        Some("↓") => ("down", if judged { "declined" } else { "moved" }),
        _ => FLAT,
    }
}

/// The same judgement for a move the engine does not judge, off the shared
/// polarity and deadband table. An improvement draws up and a decline down.
fn judge(
    metric: &str,
    current: Option<f64>,
    baseline: Option<f64>,
) -> (&'static str, &'static str) {
    let Some(m) = crate::trend_table::metric(metric) else {
        return FLAT;
    };
    let (Some(current), Some(baseline)) = (current, baseline) else {
        return FLAT;
    };
    if !current.is_finite() || !baseline.is_finite() {
        return FLAT;
    }
    let delta = current - baseline;
    if delta.abs() < m.deadband {
        return FLAT;
    }
    let up = delta > 0.0;
    match m.polarity {
        crate::trend_table::Polarity::None => (if up { "up" } else { "down" }, "moved"),
        crate::trend_table::Polarity::Higher if up => ("up", "improved"),
        crate::trend_table::Polarity::Lower if !up => ("up", "improved"),
        _ => ("down", "declined"),
    }
}

fn metric(value: f64, (trend_dir, verdict): (&'static str, &'static str)) -> MetricValue {
    MetricValue {
        value,
        trend_dir,
        verdict,
        delta_vs_yesterday: None,
        zone: None,
        text: None,
    }
}

/// The change from the value the engine judged against, absent where it had no baseline.
fn change_from(value: Option<f64>, previous: Option<f64>) -> Option<f64> {
    Some(finite(value?) - finite(previous?))
}

/// Fatigue has no engine verdict: a move with no judgement, read from the
/// newest row so a day with no fatigue is not filled in from the day before.
/// Its arrow takes the same evidence floor as the engine's arrows.
fn fatigue_metric(
    value: Option<f64>,
    previous: Option<f64>,
    basis: Option<&crate::FfiClaimBasis>,
) -> MetricValue {
    let Some(v) = value else {
        return MetricValue {
            text: Some(TEXT_NONE.to_string()),
            ..metric(0.0, FLAT)
        };
    };
    if previous.is_none() {
        return metric(finite(v), FLAT);
    }
    let arrow = if crate::claim::holds(basis) {
        judge("fatigue", value, previous)
    } else {
        FLAT
    };
    MetricValue {
        delta_vs_yesterday: change_from(value, previous),
        ..metric(finite(v), arrow)
    }
}

/// A metric whose value, arrow and change are the engine's wellness summary, so
/// a stale or gappy sparkline cannot disagree with the card.
fn wellness_metric(value: Option<f64>, glyph: Option<&str>, previous: Option<f64>) -> MetricValue {
    let Some(v) = value else {
        return MetricValue {
            text: Some(TEXT_NONE.to_string()),
            ..metric(0.0, FLAT)
        };
    };
    MetricValue {
        delta_vs_yesterday: change_from(value, previous),
        ..metric(finite(v), from_glyph(glyph, true))
    }
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/// The band a form number falls in, on the denominator the athlete chose. A
/// percentage needs fitness, so a day with none has no zone under that setting.
fn form_zone(tsb: f64, fitness: Option<f64>, as_percent: bool) -> Option<&'static str> {
    let fitness = fitness.filter(|f| *f != 0.0 && !f.is_nan());
    if as_percent && fitness.is_none() {
        return None;
    }
    let value = match (as_percent, fitness) {
        (true, Some(f)) => tsb / f * 100.0,
        _ => tsb,
    };
    let [high_risk, optimal, grey, fresh] = FORM_ZONE_BOUNDS.map(f64::from);
    Some(if value < high_risk {
        "highRisk"
    } else if value < optimal {
        "optimal"
    } else if value < grey {
        "greyZone"
    } else if value < fresh {
        "fresh"
    } else {
        "transition"
    })
}

/// Six weeks of form in the unit the athlete reads it in. The series runs
/// beside fitness, so under the percentage setting each day is read against its
/// own fitness and a day with none has no value.
fn form_history(
    sp: Option<&crate::FfiWellnessSparklines>,
    as_percent: bool,
) -> Option<FormHistory> {
    let sp = sp.filter(|s| !s.form.is_empty())?;
    let form = tail(&sp.form, FORM_HISTORY_DAYS);
    let fitness = tail(&sp.fitness, FORM_HISTORY_DAYS);
    // Both series end today; a shorter fitness series starts later than form does.
    let lead = form.len().saturating_sub(fitness.len());
    let values = form
        .iter()
        .enumerate()
        .map(|(i, tsb)| {
            if !as_percent {
                return Some(*tsb);
            }
            let fitness = f64::from(*i.checked_sub(lead).and_then(|j| fitness.get(j))?);
            (fitness != 0.0).then(|| js_round(f64::from(*tsb) / fitness * 100.0) as i32)
        })
        .collect();
    Some(FormHistory {
        values,
        as_percent,
        zone_bounds: FORM_ZONE_BOUNDS,
    })
}

fn signed(n: f64) -> String {
    if n > 0.0 {
        format!("+{n}")
    } else if n == 0.0 {
        "0".to_string()
    } else {
        format!("{n}")
    }
}

/// A form number as the athlete reads it: the whole percentage of fitness under
/// that setting, the signed TSB otherwise, and "-" with no fitness to divide by.
fn form_text(tsb: f64, fitness: f64, as_percent: bool) -> String {
    if as_percent {
        if fitness == 0.0 || fitness.is_nan() {
            return TEXT_NONE.to_string();
        }
        return format!("{}%", signed(js_round(tsb / fitness * 100.0)));
    }
    signed(js_round(tsb))
}

/// The change in the headline's own unit. Under the percentage setting it is the
/// move in percentage points, each on that day's fitness, and absent when either
/// day has none.
fn form_change(w: &WidgetWellnessSummary, as_percent: bool) -> Option<f64> {
    let (form, previous) = (w.form?, w.form_previous?);
    if !as_percent {
        return Some(finite(form) - finite(previous));
    }
    let today = finite(w.fitness.unwrap_or(0.0));
    let before = finite(w.fitness_previous.unwrap_or(0.0));
    if today == 0.0 || before == 0.0 {
        return None;
    }
    Some((finite(form) / today - finite(previous) / before) * 100.0)
}

/// The form metric with its zone, so natives colour by enum and never do TSB maths.
fn form_metric(as_percent: bool, w: Option<&WidgetWellnessSummary>) -> MetricValue {
    let reading = w.and_then(|w| w.form);
    let value = reading.map_or(0.0, finite);
    let today = finite(w.and_then(|w| w.fitness).unwrap_or(0.0));
    MetricValue {
        delta_vs_yesterday: w.and_then(|w| form_change(w, as_percent)),
        zone: form_zone(value, Some(today), as_percent),
        text: Some(match reading {
            None => TEXT_NONE.to_string(),
            Some(_) => form_text(value, today, as_percent),
        }),
        ..metric(
            value,
            from_glyph(w.and_then(|w| w.form_trend.as_deref()), false),
        )
    }
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

/// The metrics the in-app summary card offers, in the order its picker lists them.
const SUMMARY_METRIC_IDS: [&str; 10] = [
    "hrv",
    "rhr",
    "weekHours",
    "weekCount",
    "ftp",
    "thresholdPace",
    "css",
    "fitness",
    "form",
    "weight",
];

/// The widget mirror of the in-app summary card for `prefs`: the card's own
/// settings by default, or a placement's override of them. Whether the card is
/// enabled is the caller's to decide; this composes what it is given.
pub fn summary_card(
    data: &FfiWidgetSnapshotData,
    ctx: &WidgetContext,
    prefs: &SummaryPrefs,
) -> Option<SummaryCard> {
    let hero = summary_entry(data, ctx, &prefs.hero_metric, true)
        .or_else(|| summary_entry(data, ctx, "fitness", true))?;
    let entries = prefs
        .supporting_metrics
        .iter()
        .filter_map(|id| summary_entry(data, ctx, id, false))
        .take(4)
        .collect();
    let (sparkline, hero_sparkline) = if prefs.show_sparkline {
        (
            if hero.id == "hrv" {
                "hrv"
            } else {
                "fitnessForm"
            },
            hero_series(data, &hero.id),
        )
    } else {
        ("none", Vec::new())
    };
    Some(SummaryCard {
        hero,
        entries,
        sparkline,
        hero_sparkline,
    })
}

/// The daily series behind a metric, where it has one.
fn hero_series(data: &FfiWidgetSnapshotData, id: &str) -> Vec<i32> {
    let Some(sp) = data.sparklines.as_ref() else {
        return Vec::new();
    };
    let series = match id {
        "fitness" => &sp.fitness,
        "form" => &sp.form,
        "hrv" => &sp.hrv,
        "rhr" => &sp.rhr,
        _ => return Vec::new(),
    };
    tail(series, SPARKLINE_DAYS).to_vec()
}

/// One metric of the card. A supporting weight with no reading is left out, as
/// the app card does, but a hero always prints, as a dash where it has none.
fn summary_entry(
    data: &FfiWidgetSnapshotData,
    ctx: &WidgetContext,
    id: &str,
    hero: bool,
) -> Option<SummaryEntry> {
    let summary = &data.summary;
    let w = wellness_of(&summary.wellness);
    let entry = |label: &str, value: String, judged: (&'static str, &'static str), colour_key| {
        Some(SummaryEntry {
            id: id.to_string(),
            label: label.to_string(),
            value,
            trend_dir: judged.0,
            verdict: judged.1,
            colour_key,
        })
    };
    let whole =
        |reading: Option<f64>| reading.map_or(TEXT_NONE.to_string(), |v| int_text(finite(v)));
    let wellness_entry =
        |key: &str, reading: Option<f64>, glyph: Option<&str>, previous, colour_key| {
            let m = wellness_metric(reading, glyph, previous);
            entry(
                translate(ctx, key),
                whole(reading),
                (m.trend_dir, m.verdict),
                colour_key,
            )
        };

    match id {
        "fitness" => wellness_entry(
            "metrics.fitness",
            w.and_then(|w| w.fitness),
            w.and_then(|w| w.fitness_trend.as_deref()),
            w.and_then(|w| w.fitness_previous),
            "blue",
        ),
        "form" => {
            let m = form_metric(ctx.form_as_percent, w);
            entry(
                translate(ctx, "metrics.form"),
                m.text.unwrap_or_default(),
                (m.trend_dir, m.verdict),
                "formZone",
            )
        }
        "hrv" => wellness_entry(
            "metrics.hrv",
            w.and_then(|w| w.hrv),
            w.and_then(|w| w.hrv_trend.as_deref()),
            w.and_then(|w| w.hrv_previous),
            "default",
        ),
        "rhr" => wellness_entry(
            "metrics.rhr",
            w.and_then(|w| w.rhr),
            w.and_then(|w| w.rhr_trend.as_deref()),
            w.and_then(|w| w.rhr_previous),
            "default",
        ),
        "weekHours" => {
            let hours =
                js_round(finite(summary.current_week.total_duration) / 3600.0 * 10.0) / 10.0;
            let previous =
                js_round(finite(summary.prev_week.total_duration) / 3600.0 * 10.0) / 10.0;
            entry(
                translate(ctx, "metrics.week"),
                format!("{hours}h"),
                judge("weekHours", Some(hours), Some(previous)),
                "default",
            )
        }
        "weekCount" => {
            let count = f64::from(summary.current_week.count);
            entry(
                "#",
                summary.current_week.count.to_string(),
                judge(
                    "weekCount",
                    Some(count),
                    Some(f64::from(summary.prev_week.count)),
                ),
                "default",
            )
        }
        "weight" => {
            let kg = w.and_then(|w| w.weight).filter(|kg| kg.is_finite());
            if kg.is_none() && !hero {
                return None;
            }
            entry(
                translate(ctx, "metrics.weight"),
                kg.map_or(TEXT_NONE.to_string(), |kg| weight_text(kg, ctx.is_metric)),
                from_glyph(w.and_then(|w| w.weight_trend.as_deref()), false),
                "default",
            )
        }
        "ftp" => {
            let latest = summary.ftp_trend.latest_ftp.map(f64::from);
            entry(
                translate(ctx, "metrics.ftp"),
                latest.map_or(TEXT_NONE.to_string(), int_text),
                judge("ftp", latest, summary.ftp_trend.previous_ftp.map(f64::from)),
                "default",
            )
        }
        "thresholdPace" => {
            let pace = summary.run_pace_trend.latest_pace.filter(|p| *p > 0.0);
            entry(
                translate(ctx, "metrics.pace"),
                pace.map_or(TEXT_NONE.to_string(), |p| {
                    format_pace_compact(p, ctx.is_metric)
                }),
                from_glyph(summary.run_pace_trend.glyph.as_deref(), true),
                "default",
            )
        }
        "css" => {
            let pace = summary.swim_pace_trend.latest_pace.filter(|p| *p > 0.0);
            entry(
                translate(ctx, "metrics.css"),
                pace.map_or(TEXT_NONE.to_string(), |p| {
                    format_swim_pace(p, ctx.is_metric)
                }),
                from_glyph(summary.swim_pace_trend.glyph.as_deref(), true),
                "default",
            )
        }
        _ => None,
    }
}

/// Kilograms in the athlete's unit, and the unit's label.
fn display_weight(kg: f64, is_metric: bool) -> (f64, &'static str) {
    if is_metric {
        (kg, "kg")
    } else {
        (kg * KG_TO_LB, "lbs")
    }
}

/// Weight as the app card prints it: one decimal at most, the unit with no space.
fn weight_text(kg: f64, is_metric: bool) -> String {
    let (value, unit) = display_weight(kg, is_metric);
    format!("{}{unit}", js_round(value * 10.0) / 10.0)
}

fn int_text(v: f64) -> String {
    let n = js_round(v);
    if n == 0.0 {
        "0".to_string()
    } else {
        format!("{n}")
    }
}

// ---------------------------------------------------------------------------
// Display strings
// ---------------------------------------------------------------------------

fn display(ctx: &WidgetContext, impact: Option<&Impact>, zone: Option<&'static str>) -> Display {
    let form_label = translate(ctx, "metrics.form").to_string();
    Display {
        impact_line: impact.map(|i| impact_line(&form_label, i)),
        data_as_of_label: None,
        demo_label: ctx.demo.then(|| translate(ctx, "demo.banner").to_string()),
        metric_labels: MetricLabels {
            fitness: translate(ctx, "metrics.fitness").to_string(),
            fatigue: translate(ctx, "metrics.fatigue").to_string(),
            hrv: translate(ctx, "metrics.hrv").to_string(),
            rhr: translate(ctx, "metrics.rhr").to_string(),
            ramp: translate(ctx, "fitnessScreen.rampRate").to_string(),
            form: form_label,
        },
        week_label: translate(ctx, "metrics.week").to_string(),
        record_label: translate(ctx, "recording.startActivity").to_string(),
        refresh_label: translate(ctx, "systemSurfaces.refresh").to_string(),
        refreshing_label: translate(ctx, "systemSurfaces.refreshing").to_string(),
        per_week_suffix: translate(ctx, "fitnessScreen.perWeek").to_string(),
        form_zone: zone.map_or(String::new(), |z| {
            translate(ctx, &format!("formZones.{z}")).to_string()
        }),
    }
}

fn impact_line(form_label: &str, impact: &Impact) -> String {
    let mut line = format!(
        "{form_label} {} → {}",
        impact.form_before_text, impact.form_after_text
    );
    if let Some(tss) = impact.tss_added {
        let tss = js_round(tss);
        line.push_str(&format!(
            " · {}{} TSS",
            if tss >= 0.0 { "+" } else { "" },
            int_text(tss)
        ));
    }
    line
}

// ---------------------------------------------------------------------------
// Strength
// ---------------------------------------------------------------------------

fn compose_strength(
    data: &FfiWidgetSnapshotData,
    ctx: &WidgetContext,
    clock: Clock,
) -> StrengthWidget {
    let last30_label = translate(ctx, "period.long.1m").to_string();
    let last30_none = translate(ctx, "strength.noWorkouts").replace("{{period}}", &last30_label);
    StrengthWidget {
        body: if data.athlete_sex.as_deref() == Some("F") {
            "female"
        } else {
            "male"
        },
        url: STRENGTH_URL,
        windows: StrengthWindows {
            last30: strength_window(&data.strength_last30, last30_label, last30_none, ctx),
            month: strength_window(
                &data.strength_month,
                month_label(clock, ctx),
                translate(ctx, "strength.noWorkoutsThisMonth").to_string(),
                ctx,
            ),
        },
    }
}

fn strength_window(
    window: &crate::WidgetStrengthWindow,
    label: String,
    none_text: String,
    ctx: &WidgetContext,
) -> StrengthWindow {
    let summary = &window.summary;
    let empty_text = (summary.activity_count == 0).then(|| {
        if window.owed_count > 0 {
            translate(ctx, "strength.notDownloaded").to_string()
        } else {
            none_text
        }
    });
    StrengthWindow {
        label,
        activity_count: summary.activity_count,
        total_sets: summary.total_sets,
        owed_count: window.owed_count,
        max_weighted_sets: summary.max_weighted_sets,
        muscles: summary
            .muscle_volumes
            .iter()
            .map(|m| StrengthMuscle {
                slug: m.slug.clone(),
                shade: m.shade,
            })
            .collect(),
        top: summary
            .muscle_volumes
            .iter()
            .take(STRENGTH_TOP_MAX)
            .map(|m| StrengthTopMuscle {
                slug: m.slug.clone(),
                name: phrase(ctx, &muscle_name_key(&m.slug)).unwrap_or_else(|| m.slug.clone()),
                sets_text: sets_text(m.weighted_sets, ctx),
                volume_text: volume_text(m.volume_kg, ctx.is_metric),
            })
            .collect(),
        empty_text,
    }
}

/// The month the clock falls in, by its long name, else by the short one an
/// older stored context carries.
fn month_label(clock: Clock, ctx: &WidgetContext) -> String {
    use chrono::Datelike;
    let Some(now) = chrono::DateTime::from_timestamp(clock.now_wall_seconds, 0) else {
        return String::new();
    };
    let month = now.month0() as usize;
    [&ctx.dates.months, &ctx.dates.month_day.months]
        .iter()
        .find_map(|names| names.get(month).filter(|name| !name.is_empty()))
        .cloned()
        .unwrap_or_else(|| now.format("%B").to_string())
}

/// The translation key of a muscle's name: `lower-back` is `strength.muscles.lowerBack`.
fn muscle_name_key(slug: &str) -> String {
    let mut key = String::from("strength.muscles.");
    let mut upper = false;
    for c in slug.chars() {
        if c == '-' {
            upper = true;
            continue;
        }
        key.push(if upper { c.to_ascii_uppercase() } else { c });
        upper = false;
    }
    key
}

/// Weighted sets as the strength tab prints them: whole counts bare, half
/// counts with their decimal.
fn set_count(weighted_sets: f64) -> String {
    if weighted_sets.fract() == 0.0 {
        format!("{weighted_sets:.0}")
    } else {
        format!("{weighted_sets:.1}")
    }
}

/// "7.5 sets", in the plural form the app's translator picks for the count.
/// A form the language does not have falls back to `other`, and a context
/// carrying neither prints the count alone.
fn sets_text(weighted_sets: f64, ctx: &WidgetContext) -> String {
    let count = set_count(weighted_sets);
    let key = match plural_category(&ctx.locale, count.parse().unwrap_or(weighted_sets)) {
        "one" => "strength.setsCount_one",
        "few" => "strength.setsCount_few",
        "many" => "strength.setsCount_many",
        _ => "strength.setsCount_other",
    };
    phrase(ctx, key)
        .or_else(|| phrase(ctx, "strength.setsCount_other"))
        .map_or_else(
            || count.clone(),
            |template| with_slots(template, &[("count", count.clone())]),
        )
}

/// Volume as the strength tab prints it, rounded to a whole number in the
/// athlete's unit. None for bodyweight work, which moved no recorded weight.
fn volume_text(kg: f64, is_metric: bool) -> Option<String> {
    let (value, unit) = display_weight(finite(kg), is_metric);
    let rounded = js_round(value);
    (rounded > 0.0).then(|| format!("{} {unit}", rounded as i64))
}

/// The CLDR cardinal category the app's translator picks for `count` in
/// `locale`'s language, for the languages the app ships and counts below a
/// million, where the only rules that differ are these. The operands are the
/// integer part and whether a decimal is shown, as `set_count` writes it.
fn plural_category(locale: &str, count: f64) -> &'static str {
    let language = locale.split(['-', '_']).next().unwrap_or("");
    let whole = count.fract() == 0.0;
    let i = count.trunc().abs() as u64;
    match language {
        "ja" | "zh" => "other",
        // One for anything under two: 0, 1 and 1.5.
        "fr" | "pt" => {
            if i <= 1 {
                "one"
            } else {
                "other"
            }
        }
        // One for 1, and for a fraction whose integer part is 0 or 1.
        "da" => {
            if count == 1.0 || (!whole && i <= 1) {
                "one"
            } else {
                "other"
            }
        }
        "pl" => {
            if !whole {
                "other"
            } else if i == 1 {
                "one"
            } else if (2..=4).contains(&(i % 10)) && !(12..=14).contains(&(i % 100)) {
                "few"
            } else {
                "many"
            }
        }
        _ => {
            if whole && i == 1 {
                "one"
            } else {
                "other"
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Latest activity and its impact
// ---------------------------------------------------------------------------

fn compose_latest(
    data: &FfiWidgetSnapshotData,
    ctx: &WidgetContext,
    clock: Clock,
) -> Option<Latest> {
    let a = data.latest.as_ref()?;
    let date = finite(a.date);
    let distance = finite(a.distance);
    let moving = f64::from(a.moving_time);
    Some(Latest {
        activity_id: a.activity_id.clone(),
        name: a.name.clone(),
        sport_type: a.sport_type.clone(),
        distance_m: distance,
        moving_time_s: moving,
        date,
        // A load of zero is how an activity without one is stored; it is not a measured zero.
        training_load: a.training_load.map(finite).filter(|load| *load > 0.0),
        distance_label: format_distance(distance, ctx.is_metric),
        duration_label: format_duration(moving),
        date_label: relative_date_label(date, clock, ctx),
        tint_hex: ctx
            .activity_tints
            .get(&a.sport_type)
            .or_else(|| ctx.activity_tints.get("Other"))
            .cloned()
            .unwrap_or_default(),
        is_pr: data.latest_is_pr,
        route_preview: route_outline(&data.latest_gps, ROUTE_OUTLINE_MAX_POINTS),
        route: route_standing(&data.latest_comparison),
        section_prs: data.latest_comparison.section_pr_count,
        load_vs_typical: load_vs_typical(a.training_load, &data.latest_comparison),
        stats: sport_stats(a, ctx),
        headline: headline(a, &data.latest_comparison, ctx),
        load_text: positive(a.training_load).and_then(|load| {
            phrase(ctx, "systemSurfaces.latest.load")
                .map(|word| format!("{word} {}", int_text(load)))
        }),
        section_prs_text: section_prs_text(data.latest_comparison.section_pr_count, ctx),
    })
}

fn section_prs_text(count: u32, ctx: &WidgetContext) -> Option<String> {
    if count == 0 {
        return None;
    }
    fill(
        ctx,
        "systemSurfaces.latest.sectionPrs",
        &[("number", count.to_string())],
    )
}

/// A recorded load: zero is how an activity without one is stored.
fn positive(load: Option<f64>) -> Option<f64> {
    load.map(finite).filter(|load| *load > 0.0)
}

/// A word the app handed over, or nothing: a key that comes back as itself is
/// not copy, and an older stored context lacks the newer keys.
fn phrase(ctx: &WidgetContext, key: &str) -> Option<String> {
    ctx.strings
        .get(key)
        .filter(|text| !text.is_empty() && text.as_str() != key)
        .cloned()
}

/// A phrase with its `{{name}}` slots filled.
fn fill(ctx: &WidgetContext, key: &str, slots: &[(&str, String)]) -> Option<String> {
    Some(with_slots(phrase(ctx, key)?, slots))
}

fn with_slots(mut text: String, slots: &[(&str, String)]) -> String {
    for (name, value) in slots {
        text = text.replace(&format!("{{{{{name}}}}}"), value);
    }
    text
}

/// What the Last activity widget leads with: its rank among the attempts at its
/// route and the gap to the record, else its load against the typical one.
fn headline(
    a: &crate::FfiActivityMetrics,
    comparison: &WidgetLatestComparison,
    ctx: &WidgetContext,
) -> Option<Headline> {
    route_headline(a, comparison, ctx).or_else(|| load_headline(a, comparison, ctx))
}

fn route_headline(
    a: &crate::FfiActivityMetrics,
    comparison: &WidgetLatestComparison,
    ctx: &WidgetContext,
) -> Option<Headline> {
    let standing = comparison.route.as_ref()?;
    let rank = standing.rank?;
    let hero = fill(
        ctx,
        "systemSurfaces.latest.rank",
        &[
            ("rank", rank.to_string()),
            ("total", standing.attempt_count.to_string()),
        ],
    )?;
    let detail = if rank == 1 {
        phrase(ctx, "systemSurfaces.latest.fastest")
    } else {
        standing.time_delta_seconds.and_then(|gap| {
            fill(
                ctx,
                "systemSurfaces.latest.offBest",
                &[("gap", format_duration(f64::from(gap.unsigned_abs())))],
            )
        })
    };
    let skipped = standing
        .prior_attempt_seconds
        .len()
        .saturating_sub(LATEST_ATTEMPTS_MAX);
    let prior = &standing.prior_attempt_seconds[skipped..];
    let own = a.moving_time;
    let fastest = prior.iter().copied().chain(Some(own)).min().unwrap_or(own);
    let mut dots: Vec<AttemptDot> = prior
        .iter()
        .map(|seconds| AttemptDot {
            current: false,
            record: *seconds == fastest,
        })
        .collect();
    // The latest is told apart from an earlier time of the same length by position alone.
    dots.push(AttemptDot {
        current: true,
        record: own == fastest && !prior.contains(&fastest),
    });
    Some(Headline {
        kind: "route",
        label: standing.route_name.clone(),
        hero,
        detail,
        dots,
    })
}

fn load_headline(
    a: &crate::FfiActivityMetrics,
    comparison: &WidgetLatestComparison,
    ctx: &WidgetContext,
) -> Option<Headline> {
    let load = positive(a.training_load)?;
    let label = phrase(ctx, "systemSurfaces.latest.load")?;
    let detail = load_against_typical(a.training_load, comparison).and_then(|typical| {
        fill(
            ctx,
            "systemSurfaces.latest.loadVsTypical",
            &[(
                "percent",
                format!(
                    "{}{}%",
                    if typical.delta_pct > 0 { "+" } else { "" },
                    typical.delta_pct
                ),
            )],
        )
    });
    Some(Headline {
        kind: "load",
        label,
        hero: int_text(load),
        detail,
        dots: Vec::new(),
    })
}

fn route_standing(comparison: &WidgetLatestComparison) -> Option<RouteStanding> {
    let WidgetRouteStanding {
        route_name,
        rank,
        attempt_count,
        time_delta_seconds,
        prior_attempt_seconds,
    } = comparison.route.as_ref()?;
    let skipped = prior_attempt_seconds
        .len()
        .saturating_sub(LATEST_ATTEMPTS_MAX);
    Some(RouteStanding {
        name: route_name.clone(),
        rank: *rank,
        attempt_count: *attempt_count,
        gap_seconds: *time_delta_seconds,
        gap_label: time_delta_seconds.map(|gap| format_duration(f64::from(gap.unsigned_abs()))),
        attempt_seconds: prior_attempt_seconds[skipped..].to_vec(),
    })
}

/// The fallback for an activity with no route standing: its own load against
/// the typical one. Absent when either load is missing, so a zero is never
/// divided by and an unrecorded load is never read as a measured one.
fn load_vs_typical(
    load: Option<f64>,
    comparison: &WidgetLatestComparison,
) -> Option<LoadVsTypical> {
    if comparison.route.is_some() {
        return None;
    }
    load_against_typical(load, comparison)
}

/// The load against the typical one, whether or not the activity has a route.
fn load_against_typical(
    load: Option<f64>,
    comparison: &WidgetLatestComparison,
) -> Option<LoadVsTypical> {
    let load = finite(load?);
    let typical = finite(comparison.typical_load?);
    (load > 0.0 && typical > 0.0).then(|| LoadVsTypical {
        typical: js_round(typical * 10.0) / 10.0,
        delta_pct: js_round((load - typical) / typical * 100.0) as i64,
    })
}

/// What a sport is read by: a ride by its climbing and power, a run or a swim
/// by its pace, the rest by distance and time alone. A figure the activity has
/// no reading for is left out, never printed as zero.
fn sport_stats(a: &crate::FfiActivityMetrics, ctx: &WidgetContext) -> Vec<SportStat> {
    let distance = finite(a.distance);
    let moving = f64::from(a.moving_time);
    let stat = |id, key, value| SportStat {
        id,
        label: translate(ctx, key).to_string(),
        value,
    };
    let mut stats = vec![
        stat(
            "distance",
            "activity.distance",
            format_distance(distance, ctx.is_metric),
        ),
        stat(
            "movingTime",
            "recording.fields.movingTime",
            format_duration(moving),
        ),
    ];
    let speed = (moving > 0.0 && distance > 0.0).then(|| distance / moving);
    if crate::sport::is_cycling(&a.sport_type) {
        let climb = finite(a.elevation_gain);
        if climb > 0.0 {
            let value = if ctx.is_metric {
                format!("{} m", int_text(climb))
            } else {
                format!("{} ft", int_text(climb * M_TO_FT))
            };
            stats.push(stat(
                "elevationGain",
                "recording.fields.elevationGain",
                value,
            ));
        }
        if let Some(watts) = a.avg_power.filter(|w| *w > 0) {
            stats.push(stat("avgPower", "activity.power", format!("{watts} W")));
        }
    } else if crate::sport::is_swimming(&a.sport_type) {
        if let Some(speed) = speed {
            let unit = if ctx.is_metric { "/100 m" } else { "/100 yd" };
            stats.push(stat(
                "pace",
                "metrics.pace",
                format!("{} {unit}", format_swim_pace(speed, ctx.is_metric)),
            ));
        }
    } else if crate::sport::shows_pace(&a.sport_type)
        && let Some(speed) = speed
    {
        let unit = if ctx.is_metric { "/km" } else { "/mi" };
        stats.push(stat(
            "pace",
            "metrics.pace",
            format!("{} {unit}", format_pace_compact(speed, ctx.is_metric)),
        ));
    }
    stats
}

fn compose_impact(
    clock: Clock,
    fitness: &[i32],
    fatigue: &[i32],
    form: &[i32],
    latest: Option<&Latest>,
    as_percent: bool,
    w: Option<&WidgetWellnessSummary>,
) -> Option<Impact> {
    let latest = latest?;
    if form.len() < 2 || fitness.len() < 2 || fatigue.len() < 2 {
        return None;
    }
    let age_days = (clock.now_wall_seconds as f64 - latest.date) / SECONDS_PER_DAY as f64;
    if !(0.0..=IMPACT_MAX_AGE_DAYS).contains(&age_days) {
        return None;
    }
    // The pair is the activity's own day and the day before it, found by
    // counting back the whole calendar days between the two wall-clock dates.
    let days_back = clock.now_wall_seconds.div_euclid(SECONDS_PER_DAY)
        - (latest.date / SECONDS_PER_DAY as f64).floor() as i64;
    let day = form.len() as i64 - 1 - days_back;
    if day < 1 {
        return None;
    }
    let day = day as usize;
    let at = |series: &[i32], i: usize| f64::from(series.get(i).copied().unwrap_or(0));
    let delta = |series: &[i32]| at(series, day) - at(series, day - 1);
    let form_after = at(form, day);
    let form_before = at(form, day - 1);
    let today = w.filter(|_| days_back == 0);
    Some(Impact {
        form_before,
        form_after,
        form_before_text: form_text(form_before, at(fitness, day - 1), as_percent),
        form_after_text: form_text(form_after, at(fitness, day), as_percent),
        form_before_zone: form_zone(form_before, Some(at(fitness, day - 1)), as_percent),
        form_after_zone: form_zone(form_after, Some(at(fitness, day)), as_percent),
        ctl_delta: today.map_or_else(
            || delta(fitness),
            |w| change_from(w.fitness, w.fitness_previous).unwrap_or(0.0),
        ),
        atl_delta: today.map_or_else(
            || delta(fatigue),
            |w| change_from(w.fatigue, w.fatigue_previous).unwrap_or(0.0),
        ),
        tss_added: latest.training_load,
        date_label: latest.date_label.clone(),
    })
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/// `toFixed(1)`: an exact tie rounds away from zero, where Rust's own
/// formatting rounds it to even and would print 1.25 km as "1.2 km".
fn fixed1(v: f64) -> String {
    let quarter = v * 4.0;
    if quarter.fract() == 0.0 && (quarter as i64) % 2 != 0 {
        return format!("{:.1}", v + 0.05 * v.signum());
    }
    format!("{v:.1}")
}

/// "500 m" and "1.5 km", or "800 ft" and "0.9 mi".
pub fn format_distance(meters: f64, is_metric: bool) -> String {
    if !meters.is_finite() || meters < 0.0 {
        return if is_metric { "0 m" } else { "0 ft" }.to_string();
    }
    if is_metric {
        if meters < 1000.0 {
            return format!("{} m", int_text(meters));
        }
        return format!("{} km", fixed1(meters / 1000.0));
    }
    let miles = meters / 1000.0 * KM_TO_MI;
    if miles < 0.25 {
        return format!("{} ft", int_text(meters * M_TO_FT));
    }
    format!("{} mi", fixed1(miles))
}

/// "1:01:05" from an hour, "45:30" under one.
pub fn format_duration(seconds: f64) -> String {
    if !seconds.is_finite() || !(0.0..=MAX_DURATION_SECONDS).contains(&seconds) {
        return "0:00".to_string();
    }
    let total = seconds as i64;
    let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes}:{secs:02}")
    }
}

/// Minutes and seconds, carrying a rounded 60 into the minutes.
fn min_sec(total: f64) -> String {
    let mut minutes = (total / 60.0).floor() as i64;
    let mut seconds = js_round(total % 60.0) as i64;
    if seconds == 60 {
        minutes += 1;
        seconds = 0;
    }
    format!("{minutes}:{seconds:02}")
}

/// Pace per kilometre or mile with no unit.
pub fn format_pace_compact(meters_per_second: f64, is_metric: bool) -> String {
    if !meters_per_second.is_finite() || meters_per_second <= 0.0 {
        return "--:--".to_string();
    }
    let per_km = 1000.0 / meters_per_second;
    let total = if is_metric { per_km } else { per_km / KM_TO_MI };
    if !total.is_finite() || total > MAX_PACE_SECONDS {
        return "--:--".to_string();
    }
    min_sec(total)
}

/// Swim pace per 100 m, or per 100 yd.
pub fn format_swim_pace(meters_per_second: f64, is_metric: bool) -> String {
    if !meters_per_second.is_finite() || meters_per_second <= 0.0 {
        return "--:--".to_string();
    }
    let distance = if is_metric {
        100.0
    } else {
        YARDS_100_IN_METRES
    };
    let total = js_round(distance / meters_per_second);
    if !total.is_finite() || total > MAX_PACE_SECONDS {
        return "--:--".to_string();
    }
    min_sec(total)
}

/// "Today", "Yesterday", a weekday within the week, then a short date, with
/// the year once it is not this one. Calendar days on the wall clock, so a ride
/// yesterday at 4 pm reads as yesterday at 8 am today.
fn relative_date_label(wall_seconds: f64, clock: Clock, ctx: &WidgetContext) -> String {
    if !wall_seconds.is_finite() || wall_seconds <= 0.0 {
        return String::new();
    }
    let Some(date) = chrono::DateTime::from_timestamp(wall_seconds as i64, 0) else {
        return String::new();
    };
    let Some(now) = chrono::DateTime::from_timestamp(clock.now_wall_seconds, 0) else {
        return String::new();
    };
    let (date, now) = (date.date_naive(), now.date_naive());
    let diff = (now - date).num_days();
    use chrono::Datelike;
    if diff == 0 {
        return translate(ctx, "time.today").to_string();
    }
    if diff == 1 {
        return translate(ctx, "time.yesterday").to_string();
    }
    if diff < 7 {
        let weekday = date.weekday().num_days_from_sunday() as usize;
        if let Some(name) = ctx.dates.weekdays.get(weekday) {
            return name.clone();
        }
        return date.format("%Y-%m-%d").to_string();
    }
    let pattern = if date.year() == now.year() {
        &ctx.dates.month_day
    } else {
        &ctx.dates.month_day_year
    };
    write_date(pattern, date).unwrap_or_else(|| date.format("%Y-%m-%d").to_string())
}

/// A date in the locale's own order, or none when the pattern is not one this can write.
fn write_date(pattern: &DatePattern, date: chrono::NaiveDate) -> Option<String> {
    use chrono::Datelike;
    if pattern.parts.is_empty() {
        return None;
    }
    let mut out = String::new();
    for part in &pattern.parts {
        match part.kind.as_str() {
            "month" => out.push_str(pattern.months.get(date.month0() as usize)?),
            "day" => out.push_str(&date.day().to_string()),
            "year" => out.push_str(&date.year().to_string()),
            "literal" => out.push_str(&part.value),
            _ => return None,
        }
    }
    Some(out)
}

/// Project and normalise a track into a 0..1 box. Equirectangular, x scaled by
/// the cosine of the mid latitude, which keeps the shape at route scale; y is
/// flipped so it grows downward. The origin is the absence of a fix.
pub fn route_outline(gps: &[FfiGpsPoint], max_points: usize) -> Option<RouteOutline> {
    if gps.len() < 2 {
        return None;
    }
    let positioned = |p: &FfiGpsPoint| {
        p.latitude.is_finite()
            && p.longitude.is_finite()
            && (p.latitude != 0.0 || p.longitude != 0.0)
    };
    let stride = gps.len().div_ceil(max_points.max(1)).max(1);
    let mut sampled: Vec<&FfiGpsPoint> = gps
        .iter()
        .step_by(stride)
        .filter(|p| positioned(p))
        .collect();
    let last_index = gps.len() - 1;
    if !sampled.is_empty() && !last_index.is_multiple_of(stride) && positioned(&gps[last_index]) {
        sampled.push(&gps[last_index]);
    }
    if sampled.len() < 2 {
        return None;
    }
    let mid_lat = (sampled[0].latitude + sampled[sampled.len() - 1].latitude) / 2.0;
    let lon_scale = match mid_lat.to_radians().cos() {
        c if c == 0.0 || c.is_nan() => 1.0,
        c => c,
    };
    let projected: Vec<(f64, f64)> = sampled
        .iter()
        .map(|p| (p.longitude * lon_scale, p.latitude))
        .collect();
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for &(x, y) in &projected {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    let (w, h) = (max_x - min_x, max_y - min_y);
    // NaN spans fail both tests, so a track of NaN draws nothing.
    if !matches!(w.partial_cmp(&0.0), Some(std::cmp::Ordering::Greater))
        && !matches!(h.partial_cmp(&0.0), Some(std::cmp::Ordering::Greater))
    {
        return None;
    }
    let safe_w = if w > 0.0 { w } else { 1.0 };
    let safe_h = if h > 0.0 { h } else { 1.0 };
    let round3 = |v: f64| js_round(v * 1000.0) / 1000.0;
    let points = projected
        .iter()
        .map(|&(x, y)| {
            [
                round3((x - min_x) / safe_w),
                round3(1.0 - (y - min_y) / safe_h),
            ]
        })
        .collect();
    let aspect = if h > 0.0 {
        (w / h).clamp(0.1, 10.0)
    } else {
        1.0
    };
    Some(RouteOutline {
        points,
        aspect: js_round(aspect * 100.0) / 100.0,
    })
}

// ============================================================================
// Reading and writing
// ============================================================================

/// Monday of this week to now, and the same elapsed part of the week before, in the wall-clock
/// seconds an activity's date is recorded in.
pub fn week_bounds(now_wall_seconds: i64) -> (i64, i64, i64, i64) {
    let day = now_wall_seconds.div_euclid(SECONDS_PER_DAY);
    // 1970-01-01 was a Thursday, three days after a Monday.
    let since_monday = (day + 3).rem_euclid(7);
    let current_start = (day - since_monday) * SECONDS_PER_DAY;
    (
        current_start,
        now_wall_seconds,
        current_start - 7 * SECONDS_PER_DAY,
        now_wall_seconds - 7 * SECONDS_PER_DAY,
    )
}

/// The two strength windows in the wall-clock seconds an activity's date is
/// recorded in: today and the 29 days before it, as the strength screen
/// bounds its 30 days, and the calendar month, each from midnight on its first
/// day to the last second of today.
pub fn strength_bounds(now_wall_seconds: i64) -> [(i64, i64); 2] {
    use chrono::Datelike;
    let today = now_wall_seconds.div_euclid(SECONDS_PER_DAY);
    let end = (today + 1) * SECONDS_PER_DAY - 1;
    let last30 = (today - (STRENGTH_WINDOW_DAYS - 1)) * SECONDS_PER_DAY;
    let day_of_month =
        chrono::DateTime::from_timestamp(now_wall_seconds, 0).map_or(1, |now| i64::from(now.day()));
    let month = (today - (day_of_month - 1)) * SECONDS_PER_DAY;
    [(last30, end), (month, end)]
}

/// The engine's side of the snapshot, read off `conn` for the week `clock` falls in.
pub fn data_from(conn: &rusqlite::Connection, clock: Clock) -> FfiWidgetSnapshotData {
    let (current_start, current_end, prev_start, prev_end) = week_bounds(clock.now_wall_seconds);
    let [last30, month] = strength_bounds(clock.now_wall_seconds);
    let strength = |(start, end): (i64, i64)| {
        crate::objects::strength::widget_strength_window(conn, start, end).unwrap_or_default()
    };
    FfiWidgetSnapshotData {
        strength_last30: strength(last30),
        strength_month: strength(month),
        athlete_sex: athlete_sex(conn),
        ..crate::persistence::screens::pooled::widget_snapshot_data(
            conn,
            current_start,
            current_end,
            prev_start,
            prev_end,
            FORM_HISTORY_DAYS,
            ROUTE_OUTLINE_MAX_POINTS as u32,
        )
    }
}

/// The `sex` field of the stored intervals.icu profile, or none when there is
/// no profile or it carries none.
fn athlete_sex(conn: &rusqlite::Connection) -> Option<String> {
    let json = crate::persistence::settings::athlete_profile_from(conn)?;
    let profile: serde_json::Value = serde_json::from_str(&json).ok()?;
    profile.get("sex")?.as_str().map(str::to_string)
}

/// The snapshot as the file holds it.
pub fn snapshot_json(conn: &rusqlite::Connection, ctx: &WidgetContext, clock: Clock) -> String {
    serialise(&compose(&data_from(conn, clock), ctx, clock))
}

/// The snapshot as the file holds it, marked as being from the last sync: for
/// a refresh that redrew the widget from stored rows because its pull did not
/// land. The mark carries the time that sync finished, so the widget shows the
/// age of the numbers and not the age of the redraw.
pub fn snapshot_json_as_of_last_sync(
    conn: &rusqlite::Connection,
    ctx: &WidgetContext,
    clock: Clock,
) -> String {
    let mut snapshot = compose(&data_from(conn, clock), ctx, clock);
    snapshot.data_as_of = last_sync_seconds(conn);
    snapshot.display.data_as_of_label = Some(translate(ctx, "time.asOfLastSync").to_string());
    serialise(&snapshot)
}

/// The rows of a sample library, in the shapes the stores take them: what the
/// widgets draw while no account is signed in.
pub struct SampleLibrary {
    pub athlete_json: String,
    pub sport_settings_json: String,
    pub wellness: Vec<crate::persistence::wellness::WellnessRow>,
    /// Activity id, start time in seconds and the untyped body.
    pub activities: Vec<(String, i64, String)>,
    /// The strength sets, each under its activity id.
    pub exercise_sets: Vec<(String, crate::fit::FitExerciseSet)>,
}

/// The snapshot of a sample library, marked as one. The rows go into a scratch
/// database that is dropped with the call, so the athlete's own database is
/// neither read nor written and a later sign-in meets nothing left behind.
pub fn sample_snapshot_json(
    library: &SampleLibrary,
    ctx: &WidgetContext,
    clock: Clock,
) -> rusqlite::Result<String> {
    let mut scratch = crate::persistence::PersistentEngine::in_memory()?;
    scratch.set_athlete_profile(&library.athlete_json)?;
    scratch.set_sport_settings(&library.sport_settings_json)?;
    scratch.upsert_wellness(&library.wellness)?;
    scratch.upsert_activity_bodies_with_metrics(&library.activities)?;
    let mut sessions: std::collections::BTreeMap<&str, Vec<crate::fit::FitExerciseSet>> =
        std::collections::BTreeMap::new();
    for (activity_id, set) in &library.exercise_sets {
        sessions.entry(activity_id).or_default().push(set.clone());
    }
    for (activity_id, sets) in &sessions {
        scratch.settle_exercise_sets(activity_id, sets)?;
    }
    let ctx = WidgetContext {
        demo: true,
        ..ctx.clone()
    };
    Ok(serialise(&compose(
        &data_from(&scratch.db, clock),
        &ctx,
        clock,
    )))
}

fn serialise(snapshot: &WidgetSnapshot) -> String {
    serde_json::to_string(snapshot).unwrap_or_default()
}

/// When the last clean sync finished, in seconds, or none when the library has
/// recorded none or the row does not parse.
fn last_sync_seconds(conn: &rusqlite::Connection) -> Option<i64> {
    let stamp = crate::persistence::settings::setting_from(
        conn,
        crate::persistence::settings::settings_keys::SYNC_LAST_SUCCESS_AT,
    )
    .ok()??;
    chrono::DateTime::parse_from_rfc3339(&stamp)
        .ok()
        .map(|at| at.timestamp())
}

/// The context the app last stored, or none before it has stored one. A row
/// that no longer parses reads as none, so a caller leaves the file it has, and
/// so does a context for a sample library, whose file is the app's to write.
pub fn stored_context(conn: &rusqlite::Connection) -> Option<WidgetContext> {
    let json = crate::persistence::settings::setting_from(
        conn,
        crate::persistence::settings::settings_keys::WIDGET_CONTEXT,
    )
    .ok()??;
    serde_json::from_str::<WidgetContext>(&json)
        .ok()
        .filter(|ctx| !ctx.sample)
}

/// The snapshot for a caller with no JavaScript, from the stored context and
/// the device clock. None when the engine is not open or the app has never
/// stored a context, and then the widgets keep the file they have.
pub fn native_snapshot_json() -> Option<String> {
    crate::persistence::read_pool::with_read_conn(|conn| {
        let ctx = stored_context(conn)?;
        Some(snapshot_json(conn, &ctx, Clock::now()))
    })
    .flatten()
}

/// [`native_snapshot_json`], marked as being from the last sync.
pub fn native_snapshot_json_as_of_last_sync() -> Option<String> {
    crate::persistence::read_pool::with_read_conn(|conn| {
        let ctx = stored_context(conn)?;
        Some(snapshot_json_as_of_last_sync(conn, &ctx, Clock::now()))
    })
    .flatten()
}
