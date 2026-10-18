//! Per-screen data bundles.
//!
//! One method per rendered surface, each composing the reads that screen used
//! to make one at a time. Living on `PersistentEngine` keeps the FFI
//! objects thin and lets tests compare a bundle against the individual calls
//! it replaces without standing up the global engine.

use crate::persistence::fitness::sport_settings::{
    POWER_ZONE_OPEN_TOP_PERCENT, SportSettings, SportSettingsEntry,
};
use log::warn;

/// The fixed facts on backup settings, read from one SQLite snapshot.
pub fn backup_screen_data(
    conn: &rusqlite::Connection,
) -> Result<crate::FfiBackupScreenData, crate::objects::error::VeloqError> {
    use crate::objects::error::VeloqError;
    let setting = |key| {
        crate::persistence::settings::setting_from(conn, key).map_err(|error| {
            VeloqError::Database {
                msg: error.to_string(),
            }
        })
    };
    let home_lat = setting("__export_home_lat")?;
    let home_lng = setting("__export_home_lng")?;
    let radius_m = setting("__export_privacy_radius_m")?;
    let suggestion = if home_lat.is_some() && home_lng.is_some() {
        None
    } else {
        crate::persistence::export::suggest_export_home_from(conn)
    };
    let count = |key| -> Result<u32, VeloqError> {
        Ok(setting(key)?.and_then(|raw| raw.parse().ok()).unwrap_or(0))
    };
    Ok(crate::FfiBackupScreenData {
        home_lat,
        home_lng,
        radius_m,
        suggestion,
        not_restored: count(crate::persistence::record_restore::NOT_RESTORED_KEY)?,
        names_not_restored: count(crate::persistence::record_restore::NAMES_NOT_RESTORED_KEY)?,
        record_backup_run: crate::objects::record_backup_run().map(|run| run as f64),
    })
}

/// The stream history readout on cache settings, read from one SQLite snapshot.
pub fn cache_screen_data(
    conn: &rusqlite::Connection,
) -> Result<crate::FfiCacheScreenData, crate::objects::error::VeloqError> {
    let stream_retention_days =
        crate::persistence::streams::pooled::retention_days(conn).unwrap_or(0);
    let stream_store_bytes =
        crate::persistence::streams::pooled::store_bytes(conn).map_err(|error| {
            crate::objects::error::VeloqError::Database {
                msg: error.to_string(),
            }
        })?;
    Ok(crate::FfiCacheScreenData {
        stream_retention_days: stream_retention_days as f64,
        stream_store_bytes: stream_store_bytes as f64,
        activity_year_counts: activity_year_counts(conn)?,
    })
}

fn activity_year_counts(
    conn: &rusqlite::Connection,
) -> Result<Vec<crate::FfiYearCount>, crate::objects::error::VeloqError> {
    let stored = crate::persistence::settings::setting_from(
        conn,
        crate::objects::sync::ACTIVITY_YEAR_COUNTS_KEY,
    )
    .map_err(|error| crate::objects::error::VeloqError::Database {
        msg: error.to_string(),
    })?;
    let Some(stored) = stored else {
        return Ok(Vec::new());
    };
    let Ok(counts) = serde_json::from_str::<std::collections::BTreeMap<String, u32>>(&stored)
    else {
        return Ok(Vec::new());
    };
    Ok(counts
        .into_iter()
        .filter_map(|(year, count)| {
            year.parse()
                .ok()
                .map(|year| crate::FfiYearCount { year, count })
        })
        .collect())
}

/// The best stored set in each session for one exercise category.
pub fn exercise_detail_data(
    conn: &rusqlite::Connection,
    exercise_category: u16,
) -> Result<crate::FfiExerciseDetailData, crate::objects::error::VeloqError> {
    use crate::objects::error::VeloqError;
    let rows = crate::persistence::strength::pooled::exercise_history(conn, exercise_category)
        .map_err(|error| VeloqError::Database {
            msg: error.to_string(),
        })?;
    let mut sessions: Vec<crate::FfiExerciseHistorySession> = Vec::new();
    let mut exercise_name = String::new();
    for (activity_id, activity_name, date, set) in rows {
        let ffi = crate::objects::strength::sets_to_ffi(&activity_id, &[set]);
        let Some(set) = ffi.into_iter().next() else {
            continue;
        };
        if exercise_name.is_empty() {
            exercise_name = set.display_name.clone();
        }
        let Some(weight) = set.weight_kg.filter(|weight| weight.is_finite()) else {
            continue;
        };
        let current = sessions
            .last_mut()
            .filter(|session| session.activity_id == activity_id);
        if let Some(session) = current {
            let best_weight = session.best_set.weight_kg.unwrap_or(0.0);
            if weight < best_weight
                || (weight == best_weight
                    && set.repetitions.unwrap_or(0) <= session.best_set.repetitions.unwrap_or(0))
            {
                continue;
            }
            session.best_set = set.clone();
            session.estimated_one_rep_max_kg = estimated_one_rep_max(&set);
        } else {
            sessions.push(crate::FfiExerciseHistorySession {
                activity_id,
                activity_name,
                date: date as f64,
                estimated_one_rep_max_kg: estimated_one_rep_max(&set),
                best_set: set,
            });
        }
    }
    Ok(crate::FfiExerciseDetailData {
        exercise_category,
        exercise_name,
        sessions,
    })
}

fn estimated_one_rep_max(set: &crate::FfiExerciseSet) -> Option<f64> {
    let reps = set.repetitions.filter(|reps| (1..=10).contains(reps))?;
    Some(set.weight_kg? * (1.0 + f64::from(reps) / 30.0))
}

/// The background jobs' last runs and what they still owe, from one SQLite
/// snapshot on a connection that holds no engine lock.
pub fn background_jobs_data(
    conn: &rusqlite::Connection,
) -> Result<crate::FfiBackgroundJobsData, crate::objects::error::VeloqError> {
    let runs = crate::persistence::job_runs::job_runs(conn).map_err(|error| {
        crate::objects::error::VeloqError::Database {
            msg: error.to_string(),
        }
    })?;
    let detection_awaiting =
        crate::persistence::sections::pooled::activities_awaiting_detection(conn)
            .ok()
            .map(|owed| owed.try_into().unwrap_or(u32::MAX));
    Ok(crate::FfiBackgroundJobsData {
        runs,
        detection_awaiting,
        cutover_owed: crate::persistence::cutover::pooled::cutover_is_owed(conn),
    })
}

/// The window the feed card's sparklines cover. The card draws a month and
/// nothing else asks for a different one, so it is a constant here rather
/// than a parameter on the read.
const FEED_SPARKLINE_DAYS: u32 = 30;

/// Every `stride`-th point of a track, plus the last one, so the result is at
/// most `max_points` plus one.
///
/// The same rule the widget's own projection uses, so striding here leaves that
/// pass an identity rather than changing the outline it draws. `max_points` of
/// zero means the whole track, which is what a caller that wants no cap asks
/// for.
fn stride_track(points: Vec<crate::GpsPoint>, max_points: u32) -> Vec<crate::GpsPoint> {
    strided(&points, max_points as usize)
}

/// The rule itself, over a borrowed slice, so the section thumbnail below
/// draws the same outline as the widget.
fn strided(points: &[crate::GpsPoint], max_points: usize) -> Vec<crate::GpsPoint> {
    if max_points == 0 || points.len() <= max_points {
        return points.to_vec();
    }
    let stride = points.len().div_ceil(max_points).max(1);
    let last = points.len() - 1;
    let mut out: Vec<crate::GpsPoint> = points.iter().step_by(stride).cloned().collect();
    // The end of the ride is the part of the shape a stride is most likely to
    // drop, and the outline closes on it.
    if !last.is_multiple_of(stride) {
        out.push(points[last]);
    }
    out
}

/// The weeks the chronic window is read as. The window itself is whatever the
/// caller asked for, and the average is this divisor regardless, which is how
/// the insights screen has always read it.
const CHRONIC_WEEKS: f64 = 4.0;

/// The chronic window as one week of it.
fn chronic_week_average(chronic: &crate::FfiPeriodStats) -> crate::FfiPeriodStats {
    crate::FfiPeriodStats {
        count: (chronic.count as f64 / CHRONIC_WEEKS).round() as u32,
        total_duration: chronic.total_duration / CHRONIC_WEEKS,
        total_distance: chronic.total_distance / CHRONIC_WEEKS,
        total_tss: chronic.total_tss / CHRONIC_WEEKS,
    }
}

/// The chronic window one week at a time, oldest first, each dated by where
/// the week starts.
///
/// The comparison card's claim is about the last four weeks, and a total plus
/// an average cannot draw it: four weeks that fell steadily and four that
/// jumped once sum the same. The weeks are cut from the same span the total is
/// read over, so they add back up to it. `stats` reads `[from, to)`, since
/// each week ends at the second the next one starts.
fn chronic_weeks(
    chronic_start: i64,
    chronic_end: i64,
    mut stats: impl FnMut(i64, i64) -> crate::FfiPeriodStats,
) -> Vec<crate::FfiWeeklyTotal> {
    let weeks = CHRONIC_WEEKS as i64;
    let span = chronic_end - chronic_start;
    if span <= 0 || weeks <= 0 {
        return Vec::new();
    }
    let step = span / weeks;
    if step <= 0 {
        return Vec::new();
    }
    (0..weeks)
        .map(|week| {
            let from = chronic_start + week * step;
            // The last week takes the remainder, so the weeks cover the whole
            // window rather than leaving a few seconds of it uncounted.
            let to = if week == weeks - 1 {
                chronic_end
            } else {
                from + step
            };
            crate::FfiWeeklyTotal {
                start: from as f64,
                stats: stats(from, to),
                partial: false,
            }
        })
        .collect()
}

/// The weekly bars the comparison card draws: the four chronic weeks, last week
/// whole, and this week so far once it holds an activity, flagged partial.
///
/// The week-over-week comparison reads last week only up to the same point as
/// this one, which is a fair verdict and a wrong bar: drawn beside whole weeks,
/// a part of last week reads as a week that fell short.
///
/// `stats` reads `[from, to)`, so an activity at exactly Monday 00:00:00 is in
/// one bar only.
fn weekly_totals(
    p: &crate::FfiInsightsParams,
    current_week: &crate::FfiPeriodStats,
    mut stats: impl FnMut(i64, i64) -> crate::FfiPeriodStats,
) -> Vec<crate::FfiWeeklyTotal> {
    let mut weeks = chronic_weeks(p.chronic_start as i64, p.prev_start as i64, &mut stats);
    weeks.push(crate::FfiWeeklyTotal {
        start: p.prev_start,
        stats: stats(p.prev_start as i64, p.current_start as i64),
        partial: false,
    });
    if current_week.count > 0 {
        weeks.push(crate::FfiWeeklyTotal {
            start: p.current_start,
            stats: current_week.clone(),
            partial: true,
        });
    }
    weeks
}

/// One period against an earlier one, on training load where both carry it and
/// on moving time where either does not.
///
/// `None` where there is nothing to divide: an earlier period at zero has no
/// ratio, and a later one at zero is a period that did not happen rather than a
/// fall of 100%.
fn period_comparison(
    current: &crate::FfiPeriodStats,
    previous: &crate::FfiPeriodStats,
    compared_start: f64,
) -> Option<crate::FfiPeriodComparison> {
    let metric = if previous.total_tss > 0.0 && current.total_tss > 0.0 {
        crate::FfiLoadMetric::Tss
    } else {
        crate::FfiLoadMetric::Duration
    };
    let (cur, prev) = match metric {
        crate::FfiLoadMetric::Tss => (current.total_tss, previous.total_tss),
        crate::FfiLoadMetric::Duration => (current.total_duration, previous.total_duration),
    };
    if prev <= 0.0 || cur <= 0.0 {
        return None;
    }
    Some(crate::FfiPeriodComparison {
        metric,
        current: cur,
        previous: prev,
        ratio: cur / prev - 1.0,
        compared_start,
    })
}

/// Both comparisons the insights screen reads, from the three windows it is
/// given. Each is present when it can be taken, since which of them the screen
/// shows is the screen's own gate.
fn period_comparisons(
    current_week: &crate::FfiPeriodStats,
    previous_week: &crate::FfiPeriodStats,
    chronic_week: &crate::FfiPeriodStats,
    (current_start, previous_start): (f64, f64),
) -> (
    Option<crate::FfiPeriodComparison>,
    Option<crate::FfiPeriodComparison>,
) {
    let week_over_week = if current_week.count > 0 {
        period_comparison(current_week, previous_week, current_start)
    } else {
        None
    };
    let week_against_chronic = if previous_week.count > 0 {
        period_comparison(previous_week, chronic_week, previous_start)
    } else {
        None
    };
    (week_over_week, week_against_chronic)
}

fn previous_week_end(p: &crate::FfiInsightsParams, current: &crate::FfiPeriodStats) -> i64 {
    if current.count == 0 {
        p.current_start as i64
    } else {
        p.prev_end as i64
    }
}

/// A partial activity window cannot support a claim about the whole period.
fn complete_period_comparisons(
    conn: &rusqlite::Connection,
    p: &crate::FfiInsightsParams,
    current: &crate::FfiPeriodStats,
    previous: &crate::FfiPeriodStats,
    chronic: &crate::FfiPeriodStats,
) -> (
    Option<crate::FfiPeriodComparison>,
    Option<crate::FfiPeriodComparison>,
) {
    use super::activities::pooled::period_is_covered;

    let current_complete = period_is_covered(conn, p.current_start as i64, p.current_end as i64);
    let previous_complete =
        period_is_covered(conn, p.prev_start as i64, previous_week_end(p, current));
    if !current_complete || !previous_complete {
        // The empty-current-week branch also needs proof of that emptiness.
        return (None, None);
    }
    let (weekly, chronic_comparison) =
        period_comparisons(current, previous, chronic, (p.current_start, p.prev_start));
    let chronic_complete = period_is_covered(conn, p.chronic_start as i64, p.prev_start as i64);
    (
        weekly,
        if chronic_complete {
            chronic_comparison
        } else {
            None
        },
    )
}

/// The max HR an activity is read against when no source carries one.
const DEFAULT_MAX_HR: f64 = 190.0;

/// Whether a heart-rate change, rounded to a whole bpm, reaches the floor. A
/// smaller change reads as noise rather than adaptation.
pub(super) fn hr_change_clears_floor(hr_change_bpm: f64, min_bpm: u32) -> bool {
    (hr_change_bpm + 0.5).floor().abs() >= f64::from(min_bpm)
}

fn positive(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite() && *v > 0.0)
}

/// The fitness and fatigue days intervals.icu uses when the athlete sets none.
const DEFAULT_FITNESS_DAYS: (u32, u32) = (42, 7);

/// The fitness and fatigue days in effect on `date`: those of the latest
/// `FITNESS_DAYS` event dated on or before it. Each falls back to its default
/// when that event leaves it out or at zero, and both do when no such event
/// exists or the body will not parse.
fn fitness_days_on(events_json: &str, date: chrono::NaiveDate) -> (u32, u32) {
    let events: Vec<serde_json::Value> = serde_json::from_str(events_json).unwrap_or_default();
    let in_effect = events
        .iter()
        .filter(|event| event.get("category").and_then(|c| c.as_str()) == Some("FITNESS_DAYS"))
        .filter_map(|event| {
            let start = event.get("start_date_local")?.as_str()?.get(..10)?;
            let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
            (start <= date).then_some((start, event))
        })
        .max_by_key(|(start, _)| *start)
        .map(|(_, event)| event);
    let days = |key: &str, default: u32| {
        in_effect
            .and_then(|event| event.get(key)?.as_u64())
            .and_then(|days| u32::try_from(days).ok())
            .filter(|days| *days > 0)
            .unwrap_or(default)
    };
    (
        days("ctl_days", DEFAULT_FITNESS_DAYS.0),
        days("atl_days", DEFAULT_FITNESS_DAYS.1),
    )
}

/// [`fitness_days_on`] over the stored fitness model events. A library synced
/// before the events were stored reads the defaults.
fn stored_fitness_days_on(conn: &rusqlite::Connection, date: chrono::NaiveDate) -> (u32, u32) {
    let events = super::settings::setting_from(conn, super::settings_keys::FITNESS_MODEL_EVENTS)
        .ok()
        .flatten()
        .unwrap_or_default();
    fitness_days_on(&events, date)
}

/// One activity's contribution to the fitness and fatigue load averages over
/// `days`, the fitness and fatigue time constants in effect on its date.
/// The rest-day baseline cancels prior-day decay from each difference.
fn activity_load_impact(
    load: Option<f64>,
    sport_type: &str,
    (fitness_days, fatigue_days): (u32, u32),
) -> Option<crate::FfiActivityFitnessImpact> {
    let load = load.filter(|value| value.is_finite() && *value >= 0.0)?;
    let fitness_load = if sport_type == "WeightTraining" {
        0.0
    } else {
        load
    };
    let fitness = fitness_load * (1.0 - (-1.0 / f64::from(fitness_days)).exp());
    let fatigue = load * (1.0 - (-1.0 / f64::from(fatigue_days)).exp());
    Some(crate::FfiActivityFitnessImpact {
        fitness,
        fatigue,
        form: fitness - fatigue,
        fitness_days,
        fatigue_days,
    })
}

/// The upper edge of each percentage band of max HR, used when a sport lists no
/// zones of its own.
const DEFAULT_HR_ZONE_UPPER_FRACTIONS: [f64; 5] = [0.6, 0.7, 0.8, 0.9, 1.0];

/// The heart rate zone, numbered from 1, that `bpm` falls in for `sport_type`.
///
/// The bounds are the `hr_zones` of the matching sport settings entry, or the
/// entry marked `other` for an unlisted sport. Each is the upper edge of its
/// zone, so zone 1 starts at 0 and a bound belongs to the zone above it.
/// A sport with no zones in bpm gets
/// [`DEFAULT_HR_ZONE_UPPER_FRACTIONS`] of its `max_hr`, or of
/// [`DEFAULT_MAX_HR`]. A reading at or above the top bound is the top zone, and
/// a reading that is not a positive number has none.
fn hr_zone_number(sport_settings: Option<&str>, sport_type: &str, bpm: f64) -> Option<u32> {
    hr_zone_in(&SportSettings::parse(sport_settings), sport_type, bpm)
}

/// [`hr_zone_number`] over sport settings already parsed.
pub(crate) fn hr_zone_in(settings: &SportSettings, sport_type: &str, bpm: f64) -> Option<u32> {
    let entry = settings.entry_for(sport_type);
    let max_hr = positive(entry.and_then(|e| e.max_hr)).unwrap_or(DEFAULT_MAX_HR);
    hr_zone_index(&hr_zone_bounds(&[], entry, max_hr), bpm)
}

/// The upper bpm edge of each heart rate zone, from the first source that has
/// any: the activity's own zones, the sport settings entry's `hr_zones`, then
/// [`DEFAULT_HR_ZONE_UPPER_FRACTIONS`] of `max_hr`. A source holding a
/// non-positive or non-numeric bound is skipped whole. Live recording and the
/// saved activity chart both read their bands here.
fn hr_zone_bounds(
    own_zones: &[f64],
    sport_entry: Option<&SportSettingsEntry>,
    max_hr: f64,
) -> Vec<f64> {
    let usable = |bounds: &[f64]| !bounds.is_empty() && bounds.iter().all(|b| *b > 0.0);
    if usable(own_zones) {
        return own_zones.to_vec();
    }
    let sport_zones = sport_entry.map_or(&[][..], |e| e.hr_zones.as_slice());
    if usable(sport_zones) {
        return sport_zones.to_vec();
    }
    DEFAULT_HR_ZONE_UPPER_FRACTIONS
        .iter()
        .map(|f| f * max_hr)
        .collect()
}

/// The zone, numbered from 1, that `bpm` falls in: a bound belongs to the zone
/// above it, the top zone takes everything at or above its bound, and a
/// reading that is not a positive number has none.
fn hr_zone_index(bounds: &[f64], bpm: f64) -> Option<u32> {
    if !bpm.is_finite() || bpm <= 0.0 || bounds.is_empty() {
        return None;
    }
    let below = bounds.iter().take_while(|upper| bpm >= **upper).count();
    Some(below.min(bounds.len() - 1) as u32 + 1)
}

/// [`hr_zone_number`] over the rows one connection holds.
pub(crate) fn hr_zone_for_sport(
    conn: &rusqlite::Connection,
    sport_type: &str,
    bpm: f64,
) -> Option<u32> {
    let sport_settings = crate::persistence::fitness::sport_settings_from(conn);
    hr_zone_number(sport_settings.as_deref(), sport_type, bpm)
}

/// The max HR for one activity and where it came from, from the two places it
/// can come from, in order: the top bound of the activity's own
/// `icu_hr_zones`, the `max_hr` of the sport settings entry whose `types` holds
/// the activity's `type`, then [`DEFAULT_MAX_HR`]. Each source is raw JSON as
/// stored, and one that does not parse, or carries 0, is skipped.
fn resolve_max_hr(
    body: Option<&str>,
    sport_settings: Option<&str>,
) -> (f64, crate::FfiMaxHrSource) {
    let body: Option<serde_json::Value> = body.and_then(|b| serde_json::from_str(b).ok());
    max_hr_for(body.as_ref(), &SportSettings::parse(sport_settings))
}

/// [`resolve_max_hr`] over a body and settings already parsed.
fn max_hr_for(
    body: Option<&serde_json::Value>,
    sport_settings: &SportSettings,
) -> (f64, crate::FfiMaxHrSource) {
    let own_zones = body
        .and_then(|b| b.get("icu_hr_zones"))
        .and_then(|z| z.as_array())
        .and_then(|z| z.last())
        .and_then(|top| top.as_f64());
    if let Some(top) = positive(own_zones) {
        return (top, crate::FfiMaxHrSource::ActivityZones);
    }

    let sport = body
        .and_then(|b| b.get("type"))
        .and_then(|t| t.as_str())
        .and_then(|sport_type| sport_settings.entry_for(sport_type)?.max_hr);
    if let Some(sport) = positive(sport) {
        return (sport, crate::FfiMaxHrSource::SportSettings);
    }

    (DEFAULT_MAX_HR, crate::FfiMaxHrSource::Default)
}

/// [`resolve_max_hr`] over the rows one connection holds.
fn activity_max_hr(conn: &rusqlite::Connection, activity_id: &str) -> (f64, crate::FfiMaxHrSource) {
    let body = crate::persistence::activities::pooled::activity_body(conn, activity_id);
    let sport_settings = crate::persistence::fitness::sport_settings_from(conn);
    resolve_max_hr(body.as_deref(), sport_settings.as_deref())
}

/// Seconds between samples longer than this are a pause, not time in a zone.
const HR_ZONE_MAX_SAMPLE_GAP_SECS: f64 = 60.0;

/// The saved activity's zone bands and the time spent in each, or `None` when
/// there is no time to show.
///
/// Bands come from [`hr_zone_bounds`], so they match the live classifier. The
/// time in each is the activity's own `icu_hr_zone_times` when they sum to
/// something, else the heart rate stream bucketed against the bands, over the
/// samples whose gap to the one before is under a minute.
fn activity_hr_zones(
    body: Option<&str>,
    sport_settings: Option<&str>,
    heartrate: Option<&[Option<f64>]>,
    times: Option<&[u32]>,
) -> Option<Vec<crate::FfiHrZoneBand>> {
    let body_json: Option<serde_json::Value> = body.and_then(|b| serde_json::from_str(b).ok());
    let numbers = |key: &str| -> Vec<f64> {
        body_json
            .as_ref()
            .and_then(|b| b.get(key)?.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
            .unwrap_or_default()
    };
    let sport_type = body_json
        .as_ref()
        .and_then(|b| b.get("type"))
        .and_then(|t| t.as_str());
    let settings = SportSettings::parse(sport_settings);
    let entry = sport_type.and_then(|t| settings.entry_for(t));
    let (max_hr, _) = max_hr_for(body_json.as_ref(), &settings);
    let bounds = hr_zone_bounds(&numbers("icu_hr_zones"), entry, max_hr);

    let own_times = numbers("icu_hr_zone_times");
    let mut seconds = vec![0.0; bounds.len()];
    if own_times.iter().sum::<f64>() > 0.0 {
        for (slot, own) in seconds.iter_mut().zip(&own_times) {
            *slot = *own;
        }
    } else {
        let (heartrate, times) = (heartrate?, times?);
        if heartrate.len() < 2 {
            return None;
        }
        for i in 1..heartrate.len().min(times.len()) {
            let dt = f64::from(times[i]) - f64::from(times[i - 1]);
            if dt <= 0.0 || dt >= HR_ZONE_MAX_SAMPLE_GAP_SECS {
                continue;
            }
            if let Some(zone) = heartrate[i].and_then(|hr| hr_zone_index(&bounds, hr)) {
                seconds[zone as usize - 1] += dt;
            }
        }
    }
    let total: f64 = seconds.iter().sum();
    if total <= 0.0 {
        return None;
    }
    let shares = crate::persistence::fitness::whole_shares(&seconds);
    Some(
        bounds
            .iter()
            .enumerate()
            .map(|(i, upper)| crate::FfiHrZoneBand {
                zone: i as u32 + 1,
                min_bpm: if i == 0 {
                    0
                } else {
                    bounds[i - 1].round() as u32
                },
                max_bpm: upper.round() as u32,
                seconds: seconds[i],
                percent: seconds[i] / total * 100.0,
                share: shares[i],
            })
            .collect(),
    )
}

/// [`activity_hr_zones`] over the rows one connection holds.
fn activity_hr_zones_from(
    conn: &rusqlite::Connection,
    activity_id: &str,
) -> Vec<crate::FfiHrZoneBand> {
    let body = crate::persistence::activities::pooled::activity_body(conn, activity_id);
    let sport_settings = crate::persistence::fitness::sport_settings_from(conn);
    let heartrate = conn
        .query_row(
            "SELECT data FROM activity_streams WHERE activity_id = ? AND kind = 'heartrate'",
            rusqlite::params![activity_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .ok()
        .and_then(|blob| crate::persistence::codec::decode_series(&blob));
    let times = conn
        .query_row(
            "SELECT times FROM time_streams WHERE activity_id = ?",
            rusqlite::params![activity_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .ok()
        .and_then(
            |bytes| match crate::persistence::codec::deserialize::<Vec<u32>>(&bytes) {
                Ok(times) => Some(times),
                Err(error) => {
                    log::error!("time_streams {activity_id}: times read failed: {error}");
                    None
                }
            },
        );
    activity_hr_zones(
        body.as_deref(),
        sport_settings.as_deref(),
        heartrate.as_deref(),
        times.as_deref(),
    )
    .unwrap_or_default()
}

/// The summary intervals.icu stored with the activity. A field that is
/// missing, zero or not a number is `None`: a manual entry or a trainer ride
/// sends zeros for what it never measured, and a zero speed is not a reading.
/// Cadence is in the unit of `sport`, so a run's strides are steps.
fn activity_summary(body: Option<&str>, sport: &str) -> crate::FfiActivitySummary {
    let body: Option<serde_json::Value> = body.and_then(|b| serde_json::from_str(b).ok());
    let field = |name: &str| positive(body.as_ref()?.get(name)?.as_f64());
    crate::FfiActivitySummary {
        moving_time: field("moving_time"),
        elapsed_time: field("elapsed_time"),
        average_speed: field("average_speed"),
        max_speed: field("max_speed"),
        average_cadence: field("average_cadence")
            .map(|cadence| crate::sport::cadence_per_minute(sport, cadence)),
        cadence_unit: crate::sport::cadence_unit(sport),
    }
}

/// The saved activity's power zone bands in watts and the time spent in each,
/// or `None` when there is no time to show or no bounds to place it in.
///
/// `icu_power_zones` holds the upper edge of each zone as a percent of the
/// activity's `icu_ftp`, ending in [`POWER_ZONE_OPEN_TOP_PERCENT`]. Every edge
/// below that sentinel closes a zone and the zone after the last one is open,
/// whether or not the sentinel was sent. A body with no positive FTP, or with an
/// edge that is not a positive number, has no bands. The time in each zone is
/// the activity's own `icu_zone_times`, placed by zone id.
fn activity_power_zones(body: Option<&str>) -> Option<Vec<crate::FfiPowerZoneBand>> {
    let body: serde_json::Value = serde_json::from_str(body?).ok()?;
    let ftp = positive(body.get("icu_ftp")?.as_f64())?;
    let percents: Vec<f64> = body
        .get("icu_power_zones")?
        .as_array()?
        .iter()
        .map(|v| v.as_f64().filter(|p| *p > 0.0))
        .collect::<Option<_>>()?;
    let uppers: Vec<u32> = percents
        .iter()
        .take_while(|p| **p < POWER_ZONE_OPEN_TOP_PERCENT)
        .map(|p| (p * ftp / 100.0).round() as u32)
        .collect();
    if uppers.is_empty() {
        return None;
    }
    let zone_times: Vec<crate::net::intervals::wire::ZoneTime> =
        serde_json::from_value(body.get("icu_zone_times")?.clone()).ok()?;
    let seconds = crate::net::intervals::power_zone_seconds(&zone_times, uppers.len() + 1);
    let total: f64 = seconds.iter().map(|s| f64::from(*s)).sum();
    if total <= 0.0 {
        return None;
    }
    let shares = crate::persistence::fitness::whole_shares(
        &seconds.iter().map(|s| f64::from(*s)).collect::<Vec<_>>(),
    );
    Some(
        seconds
            .iter()
            .enumerate()
            .map(|(i, secs)| crate::FfiPowerZoneBand {
                zone: i as u32 + 1,
                min_watts: if i == 0 { 0 } else { uppers[i - 1] },
                max_watts: uppers.get(i).copied(),
                seconds: f64::from(*secs),
                percent: f64::from(*secs) / total * 100.0,
                share: shares[i],
            })
            .collect(),
    )
}

impl super::PersistentEngine {
    /// This engine's connection, after dropping what the pooled reads
    /// remember. That cache belongs to the database the pool is bound to,
    /// which a caller holding an engine of its own need not share, so the
    /// reads below start cold rather than answer from another database's rows.
    fn cold_connection(&self) -> &rusqlite::Connection {
        crate::persistence::read_cache::clear();
        &self.db
    }

    /// Everything the insights pipeline reads from the engine.
    ///
    /// Period stats and trends, plus the section and strength tail,
    /// in one call. The efficiency trends arrive already filtered and capped,
    /// so the generator renders what it is given rather than probing sections
    /// one by one.
    pub fn insights_data(&self, p: &crate::FfiInsightsParams) -> crate::FfiInsightsData {
        pooled::insights_data(self.cold_connection(), p)
    }

    /// Everything the activity detail screen paints with.
    ///
    /// `min_route_activities` filters the route groups the way the screen used
    /// to filter them after the fact.
    ///
    /// Both catalogues are narrowed to this activity before they cross the
    /// FFI. The screen asks one question of the route groups, which one holds
    /// this activity, and one of the custom sections, which of them name it,
    /// so handing over the whole of either made the payload and the work grow
    /// with the library on the mount path of every activity opened. The
    /// answers are unchanged: the group is the one the screen's own search
    /// would have found, and the custom list is the same filter it re-ran
    /// against what it was already given.
    ///
    /// **The GPS track and the stored upstream bodies are deliberately not
    /// here, and this is where that is written down.** The screen reads them
    /// through `get_gps_track`, `get_activity_record`, `get_activity_bodies`,
    /// `get_activity_intervals` and `get_activity_streams`, and it should keep doing so.
    /// A track is the largest thing an activity owns and a body is the
    /// upstream JSON whole; pulling either in here would put both on the mount
    /// path of every activity opened, which is the cost the narrowing above
    /// exists to avoid. It would also buy nothing measurable: on the test handset, over
    /// eight opens of a real screen, everything the engine answers, this read
    /// and the stored track together, took 2 to 103 ms of an open that reached
    /// a usable map at 1.4 to 4.3 s. The wait is the WebView and its tiles.
    /// `get_gps_track` is read by four areas besides this one, so it is not
    /// one screen's read to fold in.
    pub fn activity_detail_data(
        &self,
        activity_id: &str,
        min_route_activities: u32,
    ) -> crate::FfiActivityDetailData {
        pooled::activity_detail_data(self.cold_connection(), activity_id, min_route_activities)
    }

    /// A matched section in the light record the detail screen draws from.
    ///
    /// `bounds` is the polyline's own extent rather than the catalogue's stored
    /// one: the screen does not read it, and computing it here keeps the record
    /// one shape everywhere.
    fn matched_section(s: crate::sections::Section) -> crate::FfiSectionWithPolyline {
        let bounds = crate::Bounds::from_points(&s.polyline);
        crate::FfiSectionWithPolyline {
            id: s.id,
            name: s.name,
            section_type: s.section_type.as_str().to_string(),
            sport_types: s.sport_types,
            visit_count: s.visit_count,
            distance_meters: s.distance_meters,
            activity_count: s.activity_ids.len() as u32,
            confidence: s.confidence.unwrap_or(0.0),
            scale: s.scale,
            bounds,
            encoded_polyline: crate::persistence::codec::encode_polyline(&s.polyline),
            is_user_defined: s.is_user_defined,
            disabled: s.disabled,
            superseded_by: s.superseded_by,
            elevation_gain_m: s.elevation_gain_m,
            elevation_loss_m: s.elevation_loss_m,
            avg_grade_percent: s.avg_grade_percent,
            max_grade_percent: s.max_grade_percent,
            klass: s.klass,
            is_lift: s.is_lift,
            rank_score: s.rank_score,
            sport_rank_score: s.sport_rank_score,
            // The detail screen marks the encounter from the activity's own
            // indicators, so this record carries no section-level claim: only
            // the sections list asks for one, and only the paged read fills it.
            latest_is_record: false,
            trend: None,
        }
    }

    /// Everything the section detail screen can paint before time streams land.
    ///
    /// The stream sync is asynchronous, so the reads that depend on lap times
    /// live in [`Self::section_detail_performance`] instead. This half covers
    /// the section itself, its activities and the stream gap
    /// the caller has to close.
    pub fn section_detail_data(&self, section_id: &str) -> crate::FfiSectionDetailData {
        pooled::section_detail_data(self.cold_connection(), section_id)
    }

    /// The section detail reads that need lap times, so the caller runs this
    /// once the missing time streams have been fetched.
    ///
    /// Every read here answers one sport and one range, so the calendar, the
    /// lap list, the chart and the summary describe the same efforts. The
    /// delta curves come only once held, as the screen's own read serves them.
    pub fn section_detail_performance(
        &self,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
        highlight_activity_id: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        pooled::section_detail_performance(
            self.cold_connection(),
            section_id,
            time_range_days,
            sport_filter,
            highlight_activity_id,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        )
    }

    /// Everything the route detail screen paints with that one sport and one
    /// range do not change.
    pub fn route_detail_data(&self, group_id: &str) -> crate::FfiRouteDetailData {
        pooled::route_detail_data(self.cold_connection(), group_id)
    }

    /// The route detail reads that answer one sport and one range, in the
    /// section performance read's shape and by its arithmetic. The delta
    /// curves come only once held, as the screen's own read serves them.
    pub fn route_detail_performance(
        &self,
        group_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
        highlight_activity_id: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        pooled::route_detail_performance(
            self.cold_connection(),
            group_id,
            time_range_days,
            sport_filter,
            highlight_activity_id,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        )
    }

    /// One card's preview track, from the cached signature.
    ///
    /// The same line [`startup_data`] hands the first cards, so a card further
    /// down the feed draws from a hundred points rather than reading and
    /// boxing the four thousand of the stored track. `None` for an activity
    /// with no signature or an empty one: there is nothing to draw.
    pub fn preview_track(&mut self, activity_id: &str) -> Option<crate::FfiPreviewTrack> {
        let sig = self.get_signature(activity_id)?;
        if sig.points.is_empty() {
            return None;
        }
        Some(crate::FfiPreviewTrack {
            activity_id: activity_id.to_string(),
            encoded_coords: crate::persistence::codec::encode_polyline(&sig.points),
        })
    }

    /// The feed's first paint: the summary card and the preview tracks.
    ///
    /// Both are cheap, so this can run before the screen has anything to show.
    /// Preview tracks come from the cached route signatures rather than the
    /// full GPS track, which is a hundred points instead of four thousand.
    pub fn startup_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        preview_activity_ids: &[String],
    ) -> crate::FfiStartupData {
        pooled::startup_data(
            self.cold_connection(),
            current_start,
            current_end,
            prev_start,
            prev_end,
            preview_activity_ids,
        )
    }

    /// Everything launch writes and reads on the engine once the library's
    /// identity is settled.
    ///
    /// Launch took five round trips through the binding for this, and every one
    /// of them is a place a sync page write can hold first paint behind the
    /// write lock. The writes go first, so the stats come back from a library
    /// already carrying them.
    ///
    /// `athlete_id` is the signed-in athlete, or `None` when launch has no
    /// credentials: the stored value is what the backup's cross-athlete guard
    /// reads, so it is left alone rather than blanked.
    /// `heatmap_tiles_path` is the path when the athlete has heatmap tiles on
    /// and `None` when they do not, and the engine's copy goes with a clear or
    /// a reopen, which is why launch sets it every time.
    pub fn launch_data(
        &mut self,
        athlete_id: Option<String>,
        heatmap_tiles_path: Option<String>,
    ) -> super::PersistentEngineStats {
        if let Some(id) = athlete_id.as_deref()
            && let Err(e) = self.set_setting(super::settings_keys::ATHLETE_ID, id)
        {
            warn!("[launch] Could not store the athlete id: {}", e);
        }
        match heatmap_tiles_path {
            Some(path) => self.set_heatmap_tiles_path(path),
            None => self.clear_heatmap_tiles_path(),
        }
        self.stats()
    }

    /// Everything the home-screen widget snapshot is composed from.
    ///
    /// The latest activity is picked here rather than by handing every metric
    /// row across the boundary for the widget writer to scan.
    pub fn widget_snapshot_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
        max_gps_points: u32,
    ) -> crate::FfiWidgetSnapshotData {
        pooled::widget_snapshot_data(
            self.cold_connection(),
            current_start,
            current_end,
            prev_start,
            prev_end,
            sparkline_days,
            max_gps_points,
        )
    }

    /// Everything the Best Efforts screen paints with over one period. The
    /// app reads it through the pool, and this is the same read on the
    /// engine's connection.
    pub fn best_efforts_data(
        &self,
        days: i64,
        now: i64,
    ) -> rusqlite::Result<crate::FfiBestEffortsData> {
        pooled::best_efforts_data(self.cold_connection(), days, now)
    }

    /// Everything the fitness tab paints with that stays fixed while it is
    /// mounted, as of `today`, its range-led parts over each of `span_days`
    /// and its calendar parts over `windows`. The app reads it through the
    /// pool, and this is the same read on the engine's connection.
    pub fn fitness_screen_data(
        &self,
        today: &str,
        span_days: &[u32],
        windows: &crate::FfiFitnessScreenWindows,
    ) -> rusqlite::Result<crate::FfiFitnessScreenData> {
        pooled::fitness_screen_data(self.cold_connection(), today, span_days, windows)
    }

    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    ///
    /// The app reads this through the pool, off the engine lock. This method
    /// is the same query on the write connection, for a caller that already
    /// holds the engine and for the tests that seed one.
    // The parameters match the map FFI call and its layer switches.
    #[allow(clippy::too_many_arguments)]
    pub fn map_screen_data(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
        distance_band: crate::MapDistanceBand,
        is_metric: bool,
        route_lines: bool,
        sections: bool,
        name_needle: String,
    ) -> crate::FfiMapScreenData {
        // The write connection asks for the chips rather than taking them off
        // the read cache: a caller here may be part-way through a write, and
        // the cache only ever holds what is committed.
        let chips = pooled::available_sport_types(&self.db);
        pooled::screen_data(
            &self.db,
            start_date,
            end_date,
            sport_types,
            distance_band,
            is_metric,
            pooled::MapLayers {
                route_lines: route_lines.then_some(None),
                sections: sections.then_some(None),
            },
            name_needle,
            chips,
        )
    }

    /// Activities inside a date window.
    pub fn map_activities_filtered(
        &self,
        start_date: i64,
        end_date: i64,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        pooled::map_activities_filtered(&self.db, start_date, end_date)
    }
}

/// The Best Efforts screen's sports, in the order it lists them, with the
/// curve each reads: power for a ride, pace otherwise.
const BEST_EFFORT_SPORTS: [&str; 3] = ["Ride", "Run", "Swim"];

/// The power checkpoints, in seconds.
const POWER_CHECKPOINTS_S: [f64; 5] = [5.0, 60.0, 300.0, 1200.0, 3600.0];

/// The run checkpoints, in metres, with what each measures.
const RUN_CHECKPOINTS: [(f64, crate::FfiBestEffortKind); 5] = [
    (400.0, crate::FfiBestEffortKind::Distance),
    (1000.0, crate::FfiBestEffortKind::Distance),
    (5000.0, crate::FfiBestEffortKind::Distance),
    (10000.0, crate::FfiBestEffortKind::Distance),
    (21097.5, crate::FfiBestEffortKind::HalfMarathon),
];

/// The swim checkpoints, in metres.
const SWIM_CHECKPOINTS: [(f64, crate::FfiBestEffortKind); 4] = [
    (100.0, crate::FfiBestEffortKind::Distance),
    (200.0, crate::FfiBestEffortKind::Distance),
    (400.0, crate::FfiBestEffortKind::Distance),
    (1500.0, crate::FfiBestEffortKind::Distance),
];

/// The climbing families the screen ranks, named by their base sport.
const CLIMB_SPORTS: [&str; 2] = ["Ride", "Run"];

/// A curve sample stands for a duration checkpoint only within a second of it.
const DURATION_TOLERANCE_S: f64 = 1.0;

/// Distances are stored rounded to whole metres, so a fractional checkpoint
/// matches within a metre.
const DISTANCE_TOLERANCE_M: f64 = 1.0;

/// `5s`, `1m`, `20m`, `1h`.
fn duration_label(secs: f64) -> String {
    let secs = secs.round() as u64;
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h", secs / 3600)
    }
}

/// The sample nearest `target` within `tolerance`, the first on a tie.
fn nearest_within(points: &[f64], target: f64, tolerance: f64) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (i, point) in points.iter().enumerate() {
        let diff = (point - target).abs();
        if diff <= tolerance && best.is_none_or(|(_, d)| diff < d) {
            best = Some((i, diff));
        }
    }
    best.map(|(i, _)| i)
}

fn power_bests(
    curve: Option<&crate::persistence::curves::FfiPowerCurve>,
) -> Vec<crate::FfiBestEffort> {
    POWER_CHECKPOINTS_S
        .iter()
        .map(|&secs| {
            let index = curve.and_then(|c| nearest_within(&c.secs, secs, DURATION_TOLERANCE_S));
            let value = index.and_then(|i| positive(curve?.watts.get(i).copied()));
            crate::FfiBestEffort {
                kind: crate::FfiBestEffortKind::Duration,
                checkpoint: secs,
                value,
                time: None,
                activity_id: value
                    .and(index)
                    .and_then(|i| curve?.activity_ids.as_ref()?.get(i).cloned()),
                activity: None,
            }
        })
        .collect()
}

fn pace_bests(
    curve: Option<&crate::persistence::curves::FfiPaceCurve>,
    checkpoints: &[(f64, crate::FfiBestEffortKind)],
) -> Vec<crate::FfiBestEffort> {
    checkpoints
        .iter()
        .map(|&(metres, kind)| {
            let index =
                curve.and_then(|c| nearest_within(&c.distances, metres, DISTANCE_TOLERANCE_M));
            // A zero time is a distance the curve does not cover, and its pace
            // is stored as nought rather than as a best.
            let time = index.and_then(|i| positive(curve?.times.get(i).copied()));
            let value = time
                .and(index)
                .and_then(|i| positive(curve?.pace.get(i).copied()));
            crate::FfiBestEffort {
                kind,
                checkpoint: metres,
                value,
                time: value.and(time),
                activity_id: value
                    .and(index)
                    .and_then(|i| curve?.activity_ids.as_ref()?.get(i).cloned()),
                activity: None,
            }
        })
        .collect()
}

/// One climbing family's best window per stored length over the period, each
/// with the activity holding it. The rows are kept per activity by the climb
/// writer, so this is a maximum per length and decodes no track.
fn climb_bests(
    conn: &rusqlite::Connection,
    sport: &str,
    since: Option<i64>,
) -> rusqlite::Result<crate::FfiClimbBests> {
    use crate::metrics::vertical_power::{CLIMB_WINDOWS_S, watts_per_kg_of_vam};

    let family = crate::sport::climbing_family(sport);
    // SQLite takes the bare `activity_id` from the row holding the maximum.
    let sql = format!(
        "SELECT b.window_s, MAX(b.vam), b.activity_id
         FROM activity_climb_bests b
         JOIN activities a ON a.id = b.activity_id
         JOIN gps_tracks g ON g.activity_id = b.activity_id
         WHERE a.sport_type IN ({}) AND (?1 IS NULL OR a.start_date >= ?1)
           AND g.elevation_source = {} AND b.window_s != {}
         GROUP BY b.window_s",
        crate::sport::sql_list(&family),
        crate::persistence::ELEVATION_SOURCE_CORRECTED,
        crate::persistence::climb_bests::NO_WINDOW_S
    );
    // A track row missing or not corrected leaves the activity unranked. One
    // that measured to no window has nothing to rank, so it is not excluded.
    let excluded_sql = format!(
        "SELECT COUNT(DISTINCT b.activity_id)
         FROM activity_climb_bests b
         JOIN activities a ON a.id = b.activity_id
         LEFT JOIN gps_tracks g ON g.activity_id = b.activity_id
         WHERE a.sport_type IN ({}) AND (?1 IS NULL OR a.start_date >= ?1)
           AND COALESCE(g.elevation_source, {}) != {} AND b.window_s != {}",
        crate::sport::sql_list(&family),
        crate::persistence::ELEVATION_SOURCE_UNKNOWN,
        crate::persistence::ELEVATION_SOURCE_CORRECTED,
        crate::persistence::climb_bests::NO_WINDOW_S
    );
    let source_excluded: i64 = conn
        .prepare_cached(&excluded_sql)?
        .query_row(rusqlite::params![since], |row| row.get(0))?;
    let mut best_by_window = std::collections::HashMap::new();
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(rusqlite::params![since], |row| {
        Ok((
            row.get::<_, u32>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (window_s, vam, activity_id) = row?;
        if vam.is_finite() {
            best_by_window.insert(window_s, (vam, activity_id));
        }
    }
    let owed = crate::persistence::climb_bests::owed_among(conn, &family, since)?;
    Ok(crate::FfiClimbBests {
        sport: sport.to_string(),
        owed: u32::try_from(owed).unwrap_or(u32::MAX),
        source_excluded: u32::try_from(source_excluded).unwrap_or(u32::MAX),
        bests: CLIMB_WINDOWS_S
            .iter()
            .map(|&window_s| {
                let best = best_by_window.remove(&window_s);
                crate::FfiClimbBest {
                    label: duration_label(f64::from(window_s)),
                    window_s,
                    vam: best.as_ref().map(|(vam, _)| *vam),
                    watts_per_kg: best.as_ref().map(|(vam, _)| watts_per_kg_of_vam(*vam)),
                    activity_id: best.map(|(_, id)| id),
                    activity: None,
                }
            })
            .collect(),
    })
}

/// Name the activity holding each best, in one read over every id the screen
/// shows. An id the device holds no metrics row for stays unnamed.
fn name_best_activities(
    conn: &rusqlite::Connection,
    data: &mut crate::FfiBestEffortsData,
) -> rusqlite::Result<()> {
    let mut ids: Vec<String> = Vec::new();
    {
        let held = data
            .sports
            .iter()
            .flat_map(|s| s.efforts.iter().map(|e| e.activity_id.as_ref()))
            .chain(
                data.climbing
                    .iter()
                    .flat_map(|c| c.bests.iter().map(|b| b.activity_id.as_ref())),
            );
        for id in held.flatten() {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
    }
    let named = crate::persistence::strength::pooled::activity_names(conn, &ids)?;
    let name_of = |id: &Option<String>| {
        let id = id.as_ref()?;
        named.get(id).map(|(name, date)| crate::FfiActivityName {
            activity_id: id.clone(),
            name: name.clone(),
            date: *date as f64,
        })
    };
    for effort in data.sports.iter_mut().flat_map(|s| s.efforts.iter_mut()) {
        effort.activity = name_of(&effort.activity_id);
    }
    for best in data.climbing.iter_mut().flat_map(|c| c.bests.iter_mut()) {
        best.activity = name_of(&best.activity_id);
    }
    Ok(())
}

/// The section detail performance bundle, built from one sport's reads.
///
/// `read` answers a sport's included or excluded traversals over the whole
/// record: the lock holder from its caches, a pooled reader from SQLite.
/// Everything past that is arithmetic here, so the two paths give one answer,
/// and every figure on the screen is taken over one sport and one cutoff.
/// Each closure is one source a section and a route read differently.
#[allow(clippy::too_many_arguments)]
pub(crate) fn section_detail_from<R>(
    sports: &[(String, u32)],
    section_distance: Option<f64>,
    requested: Option<&str>,
    time_range_days: u32,
    subject: crate::FfiPerformanceSubject,
    highlight: Option<&str>,
    wellness_between: impl FnOnce(&str, &str) -> Vec<crate::FfiWellnessDay>,
    curves_of: impl FnOnce(Option<&str>) -> Option<std::sync::Arc<Option<crate::FfiSectionLapCurves>>>,
    efficiency_of: impl FnOnce(&str, i64) -> Option<crate::FfiEfficiencyTrend>,
    mut read: R,
) -> crate::FfiSectionPerformanceData
where
    R: FnMut(
        Option<&str>,
        crate::persistence::fitness::performances::laps::Rows,
    ) -> std::sync::Arc<crate::SectionPerformanceResult>,
{
    use crate::persistence::fitness::performances::laps;
    use crate::persistence::sections::{chart_from_cutoff, range_cutoff};

    let cutoff = range_cutoff(time_range_days);

    // A sport is offered when it has a lap on the chart over the range, or an
    // excluded lap to restore. A sport with neither would lead to an empty chart.
    let offered: Vec<(String, u32)> = sports
        .iter()
        .filter_map(|(sport, _)| {
            let count = chart_from_cutoff(&read(Some(sport), laps::Rows::Included), cutoff)
                .points
                .len() as u32;
            let restorable = !read(Some(sport), laps::Rows::Excluded).records.is_empty();
            (count > 0 || restorable).then(|| (sport.clone(), count))
        })
        .collect();

    // A record is held within one sport, so ground more than one sport has
    // taken is answered for one of them: the one asked for, or the offered one
    // with the most outings.
    let filter: Option<String> = match requested {
        Some(sport) => Some(sport.to_string()),
        None if sports.len() > 1 => offered
            .first()
            .or(sports.first())
            .map(|(sport, _)| sport.clone()),
        None => None,
    };
    let sport_type = filter
        .clone()
        .or_else(|| sports.first().map(|(sport, _)| sport.clone()));

    let all = read(filter.as_deref(), laps::Rows::Included);
    let mut chart_data = chart_from_cutoff(&all, cutoff);
    // Taken after the cached performances, so the highlighted attempt is no
    // part of any cache key and one cached read serves every activity.
    let scatter_focus = crate::persistence::sections::scatter_focus::scatter_focus(
        &mut chart_data.points,
        subject,
        highlight,
    );
    let performances = if time_range_days == 0 {
        all.as_ref().clone()
    } else {
        match all.records.first() {
            Some(first) => laps::summarise(
                first.section_distance,
                all.records
                    .iter()
                    .filter(|r| r.activity_date >= cutoff)
                    .cloned()
                    .collect(),
            ),
            None => laps::empty(),
        }
    };

    let excluded = read(filter.as_deref(), laps::Rows::Excluded);
    let mut excluded_points = chart_from_cutoff(&excluded, cutoff).points;
    for point in &mut excluded_points {
        // An excluded attempt is never a record, nor measured against one.
        point.is_best = false;
        point.record_gap_secs = None;
        point.record_gap_speed = None;
    }
    crate::persistence::sections::scatter_focus::flag_against(
        &mut excluded_points,
        &scatter_focus,
        subject,
    );

    let sport_counts = offered
        .into_iter()
        .map(|(sport_type, count)| crate::FfiSectionSportCount { sport_type, count })
        .collect();

    let best_forward_is_record =
        shown_best_is_record(&all, performances.best_forward_record.as_ref(), false);
    let best_reverse_is_record =
        shown_best_is_record(&all, performances.best_reverse_record.as_ref(), true);
    let trend_curves = crate::persistence::sections::trend_curve::trend_curves(&chart_data.points);
    let histograms = crate::persistence::sections::attempt_histogram::section_histograms(
        &chart_data.points,
        section_distance,
    );
    let days = chart_data.points.iter().filter_map(|p| {
        crate::persistence::sections::correlations::local_day(p.activity_date as i64)
    });
    let wellness = match (days.clone().min(), days.max()) {
        (Some(oldest), Some(newest)) => wellness_between(&oldest, &newest),
        _ => Vec::new(),
    };
    let correlations =
        crate::persistence::sections::correlations::section_correlations(&all, cutoff, &wellness);
    // Computed over the whole history against its reference, so a range only
    // filters which laps are drawn. `None` from the source leaves them owed.
    let whole_curves = curves_of(filter.as_deref());
    let curves_pending = whole_curves.is_none();
    let curves = whole_curves.as_deref().and_then(|curves| {
        curves.as_ref().and_then(|curves| {
            crate::persistence::sections::lap_curves::in_range(curves, cutoff, highlight)
        })
    });
    // Over the efforts the chart plots for the range, so the card never counts
    // efforts the header and the chart leave out.
    let efficiency_trend = sport_type
        .as_deref()
        .and_then(|sport| efficiency_of(sport, cutoff));
    // Over the whole record, like the ring: a range only filters what is drawn.
    let record_progression = crate::FfiRecordProgressions {
        forward: crate::persistence::records::section_record_progression(&all, false),
        reverse: crate::persistence::records::section_record_progression(&all, true),
    };

    crate::FfiSectionPerformanceData {
        best_forward_is_record,
        best_reverse_is_record,
        sport_type,
        sport_counts,
        calendar_summary: crate::persistence::fitness::derivations::calendar_from(&all),
        lap_records: lap_records(&all, &excluded.records),
        performances: crate::FfiSectionPerformanceResult::from(performances),
        chart_data,
        excluded_points,
        trend_curves,
        histograms,
        correlations,
        correlation_floor: crate::persistence::sections::correlations::MIN_PAIRS as u32,
        curves,
        curves_pending,
        efficiency_trend,
        scatter_focus,
        record_progression,
    }
}

/// Whether the best a direction shows is that direction's record: the same lap
/// as the best over the whole included history, and that history's record. A
/// ranged view's best that is not the whole record's is only the best of its
/// range.
fn shown_best_is_record(
    all: &crate::SectionPerformanceResult,
    shown: Option<&crate::SectionPerformanceRecord>,
    reverse: bool,
) -> bool {
    let Some(shown) = shown else {
        return false;
    };
    let whole = if reverse {
        all.best_reverse_record.as_ref()
    } else {
        all.best_forward_record.as_ref()
    };
    let Some(whole) = whole else {
        return false;
    };
    whole.activity_id == shown.activity_id
        && whole.best_time == shown.best_time
        && crate::persistence::records::is_section_record_pr(all, whole)
}

/// The lap list's rows: every lap of each activity, the record lap of each
/// direction over the whole included history flagged.
fn lap_records(
    all: &crate::SectionPerformanceResult,
    excluded: &[crate::SectionPerformanceRecord],
) -> Vec<crate::FfiSectionPerformanceRecord> {
    let record_laps: Vec<(&str, &str)> = [false, true]
        .into_iter()
        .filter_map(|reverse| crate::persistence::records::section_record_lap(all, reverse))
        .map(|(record, lap)| (record.activity_id.as_str(), lap.id.as_str()))
        .collect();
    with_excluded_laps(&all.records, excluded)
        .into_iter()
        .map(crate::FfiSectionPerformanceRecord::from)
        .map(|mut record| {
            for lap in &mut record.laps {
                lap.is_record = !lap.excluded
                    && record_laps
                        .iter()
                        .any(|(activity, id)| *activity == record.activity_id && *id == lap.id);
            }
            record
        })
        .collect()
}

/// Each activity's laps, included and excluded together in track order, so a
/// lap the athlete excluded stays listed beside the ones that count. An
/// activity with every lap excluded is listed too: its laps are how it comes
/// back.
fn with_excluded_laps(
    included: &[crate::SectionPerformanceRecord],
    excluded: &[crate::SectionPerformanceRecord],
) -> Vec<crate::SectionPerformanceRecord> {
    let mut by_activity: std::collections::BTreeMap<&str, crate::SectionPerformanceRecord> =
        included
            .iter()
            .map(|r| (r.activity_id.as_str(), r.clone()))
            .collect();
    for record in excluded {
        match by_activity.get_mut(record.activity_id.as_str()) {
            Some(listed) => listed.laps.extend(record.laps.iter().cloned()),
            None => {
                by_activity.insert(record.activity_id.as_str(), record.clone());
            }
        }
    }
    let mut records: Vec<crate::SectionPerformanceRecord> = by_activity
        .into_values()
        .map(|mut record| {
            record.laps.sort_by_key(|lap| lap.start_index);
            record.lap_count = record.laps.len() as u32;
            record
        })
        .collect();
    records.sort_by(|a, b| {
        a.activity_date
            .cmp(&b.activity_date)
            .then_with(|| a.activity_id.cmp(&b.activity_id))
    });
    records
}

/// This activity's own line through each section it traversed.
///
/// Shared by the engine path and the pooled one: the arithmetic is over a track
/// and a set of polylines, and neither of those is a tier.
fn section_traces(
    track: &[crate::GpsPoint],
    targets: &[(String, Vec<crate::GpsPoint>)],
) -> Vec<crate::FfiSectionTrace> {
    if track.len() < 3 {
        return Vec::new();
    }
    targets
        .iter()
        .filter(|(_, polyline)| polyline.len() >= 2)
        .filter_map(|(section_id, polyline)| {
            let tree = tracematch::sections::build_rtree(polyline);
            let trace = tracematch::sections::extract_activity_trace(track, polyline, &tree);
            if trace.is_empty() {
                return None;
            }
            Some(crate::FfiSectionTrace {
                section_id: section_id.clone(),
                encoded_coords: crate::persistence::codec::encode_polyline(&trace),
            })
        })
        .collect()
}

/// History points a trend carries. The graphic is a strip a few dozen pixels
/// wide, and a trend's series is read whole for its own arithmetic anyway, so
/// the cap is on what crosses the bridge rather than on what is read.
pub(crate) const TREND_HISTORY_POINTS: u32 = 30;

/// The section's line as a card thumbnail draws it. The strip is 48 by 36
/// points, so a six-hundred-point consensus line is six hundred coordinates
/// crossing the FFI on the slowest screen read to paint the same forty pixels.
const PREVIEW_POINTS: usize = 64;

pub(crate) fn preview_line(points: &[crate::GpsPoint]) -> Vec<u8> {
    crate::persistence::codec::encode_polyline(&strided(points, PREVIEW_POINTS))
}

/// A week's moving time in hours, rounded to the tenth the summary card and
/// the widget print. A non-finite total reads as none.
pub(crate) fn week_hours(week: &crate::FfiPeriodStats) -> f64 {
    let seconds = if week.total_duration.is_finite() {
        week.total_duration
    } else {
        0.0
    };
    (seconds / 3600.0 * 10.0).round() / 10.0
}

/// The arrows for this week's hours and activity count against the same part
/// of the week before, judged once for the summary card and the widget. Hours
/// are judged as printed, so the arrow never disagrees with the two numbers.
pub(crate) fn week_trends(
    current: &crate::FfiPeriodStats,
    previous: &crate::FfiPeriodStats,
) -> (Option<String>, Option<String>) {
    (
        crate::trend_table::glyph(
            "weekHours",
            Some(week_hours(current)),
            Some(week_hours(previous)),
        ),
        crate::trend_table::glyph(
            "weekCount",
            Some(f64::from(current.count)),
            Some(f64::from(previous.count)),
        ),
    )
}

/// One total against the same total of an earlier period, or none when the
/// earlier one is not a positive number. The move is judged through the trend
/// table on the values as printed, `(current, previous)`, so the arrow never
/// disagrees with the two numbers, and sized from the raw totals.
fn stat_trend(
    metric: &str,
    printed: (f64, f64),
    current: f64,
    previous: f64,
) -> Option<crate::FfiStatTrend> {
    if !(previous.is_finite() && previous > 0.0 && current.is_finite()) {
        return None;
    }
    let glyph = crate::trend_table::glyph(metric, Some(printed.0), Some(printed.1))?;
    let percent =
        (glyph != "→").then(|| (((current - previous) / previous).abs() * 100.0).round() as u32);
    Some(crate::FfiStatTrend { glyph, percent })
}

/// A period against the one before it, with the four totals judged once.
/// Hours are judged to the tenth, as [`week_trends`] judges them for the home
/// card, distance in kilometres and load in whole points.
pub(crate) fn summary_comparison(
    conn: &rusqlite::Connection,
    (current_start, current_end, previous_start, previous_end): (i64, i64, i64, i64),
) -> rusqlite::Result<crate::FfiSummaryComparison> {
    use crate::persistence::fitness::derivations::pooled::try_period_stats;
    let current = try_period_stats(conn, current_start, current_end)?;
    let previous = try_period_stats(conn, previous_start, previous_end)?;
    let range = |start: i64, end: i64| crate::FfiTimestampRange {
        start_ts: start as f64,
        end_ts: end as f64,
    };
    let (count, prev_count) = (f64::from(current.count), f64::from(previous.count));
    let (km, prev_km) = (
        current.total_distance / 1000.0,
        previous.total_distance / 1000.0,
    );
    let (load, prev_load) = (current.total_tss.round(), previous.total_tss.round());
    Ok(crate::FfiSummaryComparison {
        current: range(current_start, current_end),
        previous: range(previous_start, previous_end),
        count: stat_trend("weekCount", (count, prev_count), count, prev_count),
        duration: stat_trend(
            "weekHours",
            (week_hours(&current), week_hours(&previous)),
            current.total_duration,
            previous.total_duration,
        ),
        distance: stat_trend("weekDistance", (km, prev_km), km, prev_km),
        load: stat_trend("weekTss", (load, prev_load), load, prev_load),
        current_stats: current,
        previous_stats: previous,
    })
}

/// The tail of a series, oldest first, capped.
///
/// Every insight card draws a graphic of its own history, and the points come
/// from whatever the generator already holds: a section's laps, a trend's daily
/// estimates. Taking the tail rather than the head because a card shows the
/// run-up to now, and capping because the graphic is a strip a few dozen pixels
/// wide and the bridge is not free.
///
/// A non-finite value is left out rather than carried: the strip is drawn from
/// these and one NaN takes the whole path with it.
pub(crate) fn series_tail<T>(
    points: impl IntoIterator<Item = T>,
    limit: u32,
    mut point: impl FnMut(T) -> (f64, f64),
) -> Vec<crate::FfiSeriesPoint> {
    activity_series_tail(points, limit, |p| {
        let (value, date) = point(p);
        (value, date, None)
    })
}

/// [`series_tail`] for points that stand on an activity, each carrying the id
/// of the activity it was recorded in.
pub(crate) fn activity_series_tail<T>(
    points: impl IntoIterator<Item = T>,
    limit: u32,
    mut point: impl FnMut(T) -> (f64, f64, Option<String>),
) -> Vec<crate::FfiSeriesPoint> {
    let mut all: Vec<crate::FfiSeriesPoint> = points
        .into_iter()
        .map(|p| {
            let (value, date, activity_id) = point(p);
            crate::FfiSeriesPoint {
                value,
                date,
                activity_id,
            }
        })
        .filter(|p| p.value.is_finite() && p.date.is_finite())
        .collect();
    if limit == 0 {
        return Vec::new();
    }
    let keep = limit as usize;
    if all.len() > keep {
        all.drain(..all.len() - keep);
    }
    all
}

#[derive(Default)]
struct SectionPrStanding {
    standing_count: u32,
    percentile_faster: Option<u32>,
    previous_best_time: Option<f64>,
    previous_best_date: Option<f64>,
    delta_seconds: Option<f64>,
}

fn counted_pr_laps<'a>(
    records: &'a [crate::SectionPerformanceRecord],
    direction: &str,
    section_distance: f64,
) -> Vec<(&'a crate::SectionPerformanceRecord, &'a crate::SectionLap)> {
    records
        .iter()
        .flat_map(|activity| activity.laps.iter().map(move |lap| (activity, lap)))
        .filter(|(_, lap)| {
            lap.direction == direction
                && !lap.excluded
                && lap.time.is_finite()
                && lap.time > 0.0
                && crate::persistence::records::covers_enough_for_record(
                    lap.coverage,
                    lap.distance,
                    section_distance,
                )
        })
        .collect()
}

fn section_pr_standing(
    records: &[crate::SectionPerformanceRecord],
    record: &crate::SectionPerformanceRecord,
    reverse: bool,
) -> SectionPrStanding {
    let direction = if reverse { "reverse" } else { "same" };
    let mut laps = counted_pr_laps(records, direction, record.section_distance);
    let standing_count = laps.len() as u32;
    let Some(pr_index) = laps.iter().position(|(activity, lap)| {
        activity.activity_id == record.activity_id && lap.time == record.best_time
    }) else {
        return SectionPrStanding {
            standing_count,
            ..Default::default()
        };
    };
    laps.remove(pr_index);
    let percentile_faster = (standing_count >= 3).then(|| {
        let slower = laps
            .iter()
            .filter(|(_, lap)| lap.time > record.best_time)
            .count();
        (slower as f64 * 100.0 / f64::from(standing_count - 1)).round() as u32
    });
    let previous = laps
        .into_iter()
        .min_by(|(_, a), (_, b)| a.time.total_cmp(&b.time));
    SectionPrStanding {
        standing_count,
        percentile_faster,
        previous_best_time: previous.map(|(_, lap)| lap.time),
        previous_best_date: previous.map(|(activity, _)| activity.activity_date as f64),
        delta_seconds: previous.map(|(_, lap)| lap.time - record.best_time),
    }
}

/// Screen reads that need no engine, only its database.
///
/// These take a `Connection` rather than `&PersistentEngine`, which is what
/// lets the app run them on a pooled read-only connection while a write is in
/// flight. The cost of that, and the reason each one has to be moved
/// deliberately rather than swept: a pooled connection sees committed rows
/// only, never the engine's in-memory tier and never a write still inside its
/// transaction. So each function here reads the tables the memory tier is
/// loaded from, and the engine methods above are the same query on the write
/// connection.
pub mod pooled {
    use rusqlite::Connection;

    /// The days the fitness chart draws; its eFTP step uses the shared comparison window.
    pub const FITNESS_FTP_LOOKBACK_DAYS: i64 = 90;

    /// Everything the fitness tab paints with that stays fixed while it is
    /// mounted: the eFTP trend with the chart's history and the activities
    /// that moved it, the last stored critical speed for running and for
    /// swimming, and the set cycling FTP and running LTHR.
    ///
    /// The trend is read from wellness bodies and the eFTP markers a sync
    /// stores, the speeds from the snapshots a pace curve download writes, and
    /// the thresholds from the stored sport settings, else the FTP the newest
    /// ride was analysed against, and all of them land with the `activities`
    /// event. The trend's coverage is the
    /// wellness over the days its chart draws, so an empty chart can say
    /// whether those bodies were never pulled. The range and sport the
    /// athlete taps are not here: a tap would otherwise re-read the trend to
    /// get a curve. The decoupling ride and the strip's activities follow the
    /// range, so the read answers each of `span_days` and a tap reads nothing.
    ///
    /// The calendar, the weekly card and the year comparison sit on the same
    /// tab and go stale on the same event, so they are here too: the heatmap
    /// days, the monthly rows, and the year and month to date against the
    /// same spans of last year, each over the window `windows` names, and each
    /// of the weekly card's ranges to now against the same elapsed span of the
    /// period before. Every one is an aggregate of `activity_metrics`, or of
    /// the heatmap cache the metrics writer keeps beside it. The weekly card's
    /// range is chosen with a tap, so all five ranges are here; each is two
    /// indexed sums. A calendar part that cannot be read fails the read, so
    /// the cards never draw a year of nothing from a table they could not
    /// read.
    pub fn fitness_screen_data(
        conn: &Connection,
        today: &str,
        span_days: &[u32],
        windows: &crate::FfiFitnessScreenWindows,
    ) -> rusqlite::Result<crate::FfiFitnessScreenData> {
        use crate::persistence::fitness::derivations::pooled as fitness;
        use crate::persistence::fitness::derivations::pooled::{
            activity_heatmap, monthly_stats, try_period_stats,
        };
        use crate::persistence::fitness::sport_settings::{self, SportSettings};
        let settings = SportSettings::read(conn);
        let today_date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").ok();
        let window_start = today_date
            .map(|day| (day - chrono::Duration::days(FITNESS_FTP_LOOKBACK_DAYS)).to_string())
            .unwrap_or_else(|| today.to_string());
        let (fitness_days, fatigue_days) = today_date.map_or(super::DEFAULT_FITNESS_DAYS, |day| {
            super::stored_fitness_days_on(conn, day)
        });
        let span = |r: &crate::FfiTimestampRange| (r.start_ts as i64, r.end_ts as i64);
        let totals = |r: &crate::FfiTimestampRange| {
            let (start, end) = span(r);
            try_period_stats(conn, start, end)
        };
        let (months_start, months_end) = span(&windows.months);
        let [week, month, three_months, six_months, year] =
            crate::widget_snapshot::summary_period_bounds(crate::ffi_types::int_from_wire(
                windows.now_wall_seconds,
            ))
            .map(|bounds| super::summary_comparison(conn, bounds));
        Ok(crate::FfiFitnessScreenData {
            ftp_trend: fitness::ftp_trend_with_history(conn, today, FITNESS_FTP_LOOKBACK_DAYS),
            ftp_trend_coverage: crate::persistence::wellness::pooled::coverage(
                conn,
                &window_start,
                today,
            ),
            run_pace_trend: fitness::pace_trend(conn, "Run"),
            swim_pace_trend: fitness::pace_trend(conn, "Swim"),
            sport_mix: sport_mix(conn),
            fitness_days,
            fatigue_days,
            cycling_ftp_setting: sport_settings::cycling_ftp(conn, &settings),
            running_lthr: sport_settings::running_lthr(&settings),
            decoupling_sources: decoupling_sources(conn, today_date, span_days),
            load_dots: load_dots(conn, today_date, span_days),
            heatmap: activity_heatmap(conn, &windows.heatmap_first_day, &windows.heatmap_last_day)?,
            months: monthly_stats(conn, months_start, months_end)?,
            year_current: totals(&windows.year_current)?,
            year_previous: totals(&windows.year_previous)?,
            month_current: totals(&windows.month_current)?,
            month_previous: totals(&windows.month_previous)?,
            comparisons: crate::FfiSummaryComparisons {
                week: week?,
                month: month?,
                three_months: three_months?,
                six_months: six_months?,
                year: year?,
            },
        })
    }

    /// The shortest ride the decoupling card reports, in seconds.
    pub const DECOUPLING_MIN_MOVING_SECONDS: i64 = 30 * 60;

    /// The wall-clock seconds the span of `days` back from `today` runs over,
    /// from the first day's start to the end of today, inclusive.
    fn span_bounds(today: chrono::NaiveDate, days: u32) -> (i64, i64) {
        let first = today - chrono::Duration::days(i64::from(days));
        let start = first.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp());
        let end = today
            .and_hms_opt(23, 59, 59)
            .map(|t| t.and_utc().timestamp());
        (start.unwrap_or(0), end.unwrap_or(0))
    }

    /// An activity's wall-clock start as intervals.icu sends it.
    fn wall_clock(date: i64) -> String {
        chrono::DateTime::from_timestamp(date, 0)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_default()
    }

    /// The decoupling ride of each span: the newest cycling activity inside it
    /// of half an hour or more with power, heart rate and a finite decoupling
    /// on its stored body. Spans share today as their end, so the newest such
    /// ride in the longest span is every span's answer that reaches back to
    /// it. The value is read from the body because intervals.icu's is what its
    /// activity screen prints, and a half with no power arrives as the string
    /// `-Infinity`, which the type check passes over. A read that fails names
    /// no ride.
    fn decoupling_sources(
        conn: &Connection,
        today: Option<chrono::NaiveDate>,
        span_days: &[u32],
    ) -> Vec<crate::FfiSpanDecoupling> {
        let newest = match (today, span_days.iter().max()) {
            (Some(today), Some(&longest)) => {
                let (start, end) = span_bounds(today, longest);
                newest_decoupling_ride(conn, start, end)
            }
            _ => None,
        };
        span_days
            .iter()
            .map(|&days| crate::FfiSpanDecoupling {
                days,
                source: newest.as_ref().and_then(|(date, source)| {
                    let (start, _) = span_bounds(today?, days);
                    (*date >= start).then(|| source.clone())
                }),
            })
            .collect()
    }

    fn newest_decoupling_ride(
        conn: &Connection,
        start: i64,
        end: i64,
    ) -> Option<(i64, crate::FfiDecouplingSource)> {
        let rows: Vec<(String, String, i64, String, f64)> = conn
            .prepare_cached(
                "SELECT m.activity_id, m.name, m.date, m.sport_type,
                        json_extract(b.raw, '$.decoupling')
                 FROM activity_metrics m
                 JOIN activity_bodies b ON b.activity_id = m.activity_id
                 WHERE m.date BETWEEN ?1 AND ?2
                   AND m.moving_time >= ?3
                   AND m.avg_power > 0 AND m.avg_hr > 0
                   AND json_valid(b.raw)
                   AND json_type(b.raw, '$.decoupling') IN ('integer', 'real')
                 ORDER BY m.date DESC",
            )
            .and_then(|mut stmt| {
                stmt.query_map(
                    rusqlite::params![start, end, DECOUPLING_MIN_MOVING_SECONDS],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )?
                .collect()
            })
            .map_err(|e| log::warn!("veloqrs: [fitness] decoupling read failed: {e}"))
            .unwrap_or_default();
        rows.into_iter()
            .find(|(_, _, _, sport, value)| crate::sport::is_cycling(sport) && value.is_finite())
            .map(|(activity_id, name, date, _, decoupling)| {
                (
                    date,
                    crate::FfiDecouplingSource {
                        activity_id,
                        name,
                        start_date_local: wall_clock(date),
                        decoupling,
                    },
                )
            })
    }

    /// Every activity inside the longest span, oldest first. A read that fails
    /// marks nothing.
    fn load_dots(
        conn: &Connection,
        today: Option<chrono::NaiveDate>,
        span_days: &[u32],
    ) -> Vec<crate::FfiLoadDot> {
        let (Some(today), Some(&longest)) = (today, span_days.iter().max()) else {
            return Vec::new();
        };
        let (start, end) = span_bounds(today, longest);
        conn.prepare_cached(
            "SELECT activity_id, name, sport_type, date, moving_time, distance,
                    COALESCE(training_load, 0)
             FROM activity_metrics WHERE date BETWEEN ?1 AND ?2 ORDER BY date, activity_id",
        )
        .and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![start, end], |row| {
                Ok(crate::FfiLoadDot {
                    activity_id: row.get(0)?,
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    start_date_local: wall_clock(row.get(3)?),
                    moving_time: u32::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
                    distance: row.get(5)?,
                    load: row.get(6)?,
                })
            })?
            .collect()
        })
        .map_err(|e| log::warn!("veloqrs: [fitness] load dots read failed: {e}"))
        .unwrap_or_default()
    }

    /// The activities the sport mix counts, the most recent first. A fixed
    /// number rather than a span of days keeps the read level as the library
    /// grows, and still lets an athlete who stopped for a season count.
    pub const SPORT_MIX_ACTIVITIES: u32 = 50;

    /// Rides, runs and swims among the most recent activities, each sport
    /// counting every member of its family, and the one with the most. A read
    /// that fails counts nothing, so the athlete keeps the sport they had.
    fn sport_mix(conn: &Connection) -> crate::FfiSportMix {
        let rows: Vec<(String, u32)> = conn
            .prepare_cached(
                "SELECT sport_type, COUNT(*) FROM (
                     SELECT sport_type FROM activity_metrics ORDER BY date DESC LIMIT ?1
                 ) GROUP BY sport_type",
            )
            .and_then(|mut stmt| {
                stmt.query_map([SPORT_MIX_ACTIVITIES], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect()
            })
            .unwrap_or_default();
        let count = |member: fn(&str) -> bool| {
            rows.iter()
                .filter(|(sport, _)| member(sport))
                .map(|(_, n)| n)
                .sum::<u32>()
        };
        let ranked = [
            (count(crate::sport::is_cycling), "Cycling"),
            (count(crate::sport::is_running), "Running"),
            (count(crate::sport::is_swimming), "Swimming"),
        ];
        let top = ranked.iter().map(|(n, _)| *n).max().unwrap_or(0);
        let mut leaders = ranked.iter().filter(|(n, _)| *n == top && top > 0);
        let dominant = match (leaders.next(), leaders.next()) {
            (Some((_, sport)), None) => Some(sport.to_string()),
            _ => None,
        };
        crate::FfiSportMix {
            rides: ranked[0].0,
            runs: ranked[1].0,
            swims: ranked[2].0,
            dominant,
        }
    }

    /// Everything the Best Efforts screen paints with over the last `days`
    /// days to `now`, or over all time when `days` is 0.
    ///
    /// The period is the screen's one parameter and every part of the screen
    /// moves with it, so a toggle re-reads the whole of this and nothing it
    /// did not need. Power and pace come from the curve bodies stored under
    /// the period, and a sport whose body was never fetched says so, which is
    /// the front end's cue to ask for it. Climbing comes from the rows the
    /// climb writer keeps per activity.
    pub fn best_efforts_data(
        conn: &Connection,
        days: i64,
        now: i64,
    ) -> rusqlite::Result<crate::FfiBestEffortsData> {
        use crate::persistence::curves::pooled::{pace_curve, power_curve};

        let mut sports = Vec::with_capacity(super::BEST_EFFORT_SPORTS.len());
        for sport in super::BEST_EFFORT_SPORTS {
            let (fetched, efforts) = if sport == "Ride" {
                let (fetched, curve) = power_curve(conn, sport, days)?;
                (fetched, super::power_bests(curve.as_ref()))
            } else {
                let (fetched, curve) = pace_curve(conn, sport, days, false)?;
                let checkpoints: &[(f64, crate::FfiBestEffortKind)] = if sport == "Run" {
                    &super::RUN_CHECKPOINTS
                } else {
                    &super::SWIM_CHECKPOINTS
                };
                (fetched, super::pace_bests(curve.as_ref(), checkpoints))
            };
            sports.push(crate::FfiBestEffortsSport {
                sport: sport.to_string(),
                fetched,
                efforts,
            });
        }

        let since = (days > 0).then(|| now - days * 86_400);
        let climbing = super::CLIMB_SPORTS
            .iter()
            .map(|sport| super::climb_bests(conn, sport, since))
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut data = crate::FfiBestEffortsData { sports, climbing };
        super::name_best_activities(conn, &mut data)?;
        Ok(data)
    }

    /// Everything the map tab paints with.
    ///
    /// The chips come from the read cache, which holds them until something
    /// commits: they are a `DISTINCT` over every metrics row, asked on every
    /// read of this screen, and they change only when a sync lands.
    // The pooled read takes the same filters and layer switches as the engine read.
    #[allow(clippy::too_many_arguments)]
    pub fn map_screen_data(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
        distance_band: crate::MapDistanceBand,
        is_metric: bool,
        layers: MapLayers,
        name_needle: String,
    ) -> crate::FfiMapScreenData {
        let chips =
            crate::persistence::read_cache::sport_types(conn, || available_sport_types(conn));
        screen_data(
            conn,
            start_date,
            end_date,
            sport_types,
            distance_band,
            is_metric,
            layers,
            name_needle,
            chips,
        )
    }

    /// The section detail screen's performance bundle, read from SQLite alone.
    ///
    /// Every part of it is arithmetic over one sport's performances, so the
    /// engine method and this one share [`super::section_detail_from`] and
    /// differ only in where the performances come from: the engine's LRU and
    /// memory tier on one path, a pooled connection on the other. `curves`
    /// says whether this read computes the lap curves or serves them only
    /// once held.
    pub fn section_detail_performance(
        conn: &Connection,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
        highlight_activity_id: Option<&str>,
        curves: crate::persistence::sections::lap_curves::pooled::CurveRead,
    ) -> crate::FfiSectionPerformanceData {
        use crate::persistence::fitness::performances::{laps, pooled};
        let sports = laps::sports(conn, section_id);
        let section_distance = laps::section_distance(conn, section_id);
        super::section_detail_from(
            &sports,
            section_distance,
            sport_filter,
            time_range_days,
            crate::FfiPerformanceSubject::Section,
            highlight_activity_id,
            |oldest, newest| {
                crate::persistence::wellness::pooled::wellness_days(conn, oldest, newest)
                    .unwrap_or_default()
            },
            |sport| {
                crate::persistence::sections::lap_curves::pooled::cached_lap_curves(
                    conn, section_id, sport, curves,
                )
            },
            |sport, since| {
                // This section's name alone: the whole overlay grows with the catalogue.
                let names = crate::persistence::sections::named::pooled::overlay_names_for(
                    conn,
                    &[section_id],
                );
                section_efficiency_trend_of(conn, section_id, sport, &names, since)
            },
            |sport, rows| match rows {
                laps::Rows::Included => {
                    pooled::cached_section_performances(conn, section_id, sport)
                }
                laps::Rows::Excluded => std::sync::Arc::new(pooled::section_performances_of(
                    conn, section_id, sport, rows,
                )),
            },
        )
    }

    /// Everything the home-screen widget snapshot is composed from.
    ///
    /// The widget writer runs on every background transition and every settled
    /// sync, so it used to take the engine write lock behind whatever the sync
    /// was committing. Every read here is committed rows.
    pub fn widget_snapshot_data(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
        max_gps_points: u32,
    ) -> crate::FfiWidgetSnapshotData {
        use crate::persistence::wellness::pooled as wellness;

        let today = crate::persistence::wellness::today_iso();
        let latest = crate::persistence::activities::pooled::latest_metrics(conn);

        let (latest_is_pr, latest_comparison, latest_gps) = match latest.as_ref() {
            Some(m) => {
                let ids = [m.activity_id.clone()];
                let highlights =
                    crate::persistence::fitness::derivations::pooled::route_highlights(conn, &ids);
                let is_pr = holds_a_record(
                    &highlights,
                    &crate::persistence::indicators::pooled::activity_indicators(conn, &ids),
                );
                let comparison = latest_comparison(conn, m, highlights.first());
                let gps = crate::persistence::activities::pooled::gps_track(conn, &m.activity_id)
                    .map(|points| super::stride_track(points, max_gps_points))
                    .unwrap_or_default();
                (is_pr, comparison, gps)
            }
            None => (false, crate::WidgetLatestComparison::default(), Vec::new()),
        };

        crate::FfiWidgetSnapshotData {
            sparklines: wellness::sparklines_to(conn, sparkline_days, &today)
                .ok()
                .flatten(),
            summary: widget_summary_card(conn, current_start, current_end, prev_start, prev_end),
            latest: latest.map(crate::FfiActivityMetrics::from),
            latest_is_pr,
            latest_comparison,
            ramp_rate: wellness::latest_ramp_rate_to(conn, sparkline_days, &today),
            latest_gps,
            // The strength windows hang off the composer's clock, which reads them.
            ..Default::default()
        }
    }

    /// What the latest activity is measured against, from the same reads the
    /// feed card and the route screen make: its place among the attempts at its
    /// route, the sections it holds a record on, and, for an activity with no
    /// route to be judged on, the load that sport usually carries.
    fn latest_comparison(
        conn: &Connection,
        latest: &crate::ActivityMetrics,
        highlight: Option<&crate::FfiActivityRouteHighlight>,
    ) -> crate::WidgetLatestComparison {
        use crate::persistence::activities::pooled as activities;

        let route = highlight.and_then(|h| route_standing(conn, &latest.activity_id, h));
        let typical_load = if route.is_none() {
            activities::typical_training_load(
                conn,
                &latest.sport_type,
                &latest.activity_id,
                latest.date,
                TYPICAL_LOAD_DAYS,
            )
        } else {
            None
        };
        // The names overlay only renames a section, and a count needs none.
        let encounters =
            crate::persistence::fitness::derivations::pooled::activity_section_encounters(
                conn,
                &latest.activity_id,
                &std::collections::BTreeMap::new(),
            );
        crate::WidgetLatestComparison {
            route,
            section_pr_count: encounters.iter().filter(|e| e.is_pr).count() as u32,
            typical_load,
        }
    }

    /// The days before an activity the load it is judged against is taken from.
    const TYPICAL_LOAD_DAYS: i64 = 28;

    /// Where the activity stands among the attempts at the route `highlight`
    /// names, read as the route screen reads it. None when there is no other
    /// attempt to stand among.
    fn route_standing(
        conn: &Connection,
        activity_id: &str,
        highlight: &crate::FfiActivityRouteHighlight,
    ) -> Option<crate::WidgetRouteStanding> {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::performances::{
            is_comparable_attempt, route_performances,
        };
        use crate::persistence::routes::pooled as routes;

        let group = routes::group_by_id(conn, &highlight.route_id)?;
        let excluded = routes::excluded_route_activity_ids(conn, &highlight.route_id);
        let match_info = routes::match_info(conn, &highlight.route_id);
        let result = route_performances(
            &group.activity_ids,
            Some(&match_info),
            &excluded,
            |id| activities::metrics_of(conn, id),
            Some(activity_id),
            None,
        );
        if result.attempt_count < 2 {
            return None;
        }
        let direction = result
            .performances
            .iter()
            .find(|p| p.is_current)
            .map(|p| p.direction.as_str());
        Some(crate::WidgetRouteStanding {
            route_name: highlight.route_name.clone(),
            rank: result.current_rank,
            attempt_count: result.attempt_count,
            time_delta_seconds: highlight.time_delta_seconds,
            prior_attempt_seconds: result
                .performances
                .iter()
                .filter(|p| !p.is_current && is_comparable_attempt(p, direction))
                .map(|p| p.moving_time)
                .collect(),
        })
    }

    /// Whether the activity holds a record, by either of the two things that
    /// say so: the route highlight computed from its group, or an indicator a
    /// detection run recorded against it.
    pub(super) fn holds_a_record(
        route_highlights: &[crate::FfiActivityRouteHighlight],
        indicators: &[crate::FfiActivityIndicator],
    ) -> bool {
        route_highlights.iter().any(|r| r.is_pr)
            || indicators
                .iter()
                .any(|i| i.indicator_type == "section_pr" || i.indicator_type == "route_pr")
    }

    /// Everything the route detail screen paints with that one sport and one
    /// range do not change: the route, its line and headline, exclusions and
    /// signatures. Attempt times come from [`route_detail_performance`].
    ///
    /// The route is the last saved grouping rather than one the engine would
    /// regroup on the way past: a pooled reader sees committed rows, and
    /// `route_groups` holds the previous grouping until something on the write
    /// lock asks for a regroup. That deferred-regroup staleness is accepted and
    /// announced to the athlete elsewhere, so this read inherits it rather than
    /// fixing it.
    pub fn route_detail_data(conn: &Connection, group_id: &str) -> crate::FfiRouteDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::routes::pooled as routes;

        let group = routes::group_by_id(conn, group_id);
        let activity_ids: Vec<String> = group
            .as_ref()
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();
        let excluded = routes::excluded_route_activity_ids(conn, group_id);

        let representative = group
            .as_ref()
            .and_then(|g| activities::metrics_of(conn, &g.representative_id));
        let (distance_meters, elevation_gain_meters) =
            representative.map_or((0.0, 0.0), |m| (m.distance, m.elevation_gain));

        crate::FfiRouteDetailData {
            activity_count: activity_count(conn),
            distance_meters,
            elevation_gain_meters,
            encoded_representative: routes::representative_route(conn, group_id)
                .map(|points| crate::persistence::codec::encode_polyline(points.as_slice()))
                .unwrap_or_default(),
            excluded_activity_ids: excluded,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            missing_time_stream_ids: activities::activities_missing_time_streams(
                conn,
                &activity_ids,
            ),
            group: group.map(crate::FfiRouteGroup::from),
        }
    }

    /// The route detail screen's performance bundle, in the section
    /// performance read's shape.
    ///
    /// Each attempt enters [`super::section_detail_from`] as one lap over the
    /// whole activity, so the calendar, the chart, the ranged bests, the trend,
    /// the histogram, the correlations and the sport counts are the section's
    /// arithmetic. What the route judges for itself travels on the attempt:
    /// the distance band [`route_performances`] decides and the match. The lap
    /// curves run along the route's representative line, and `curves` says
    /// whether this read computes them or serves them only once held.
    ///
    /// [`route_performances`]: crate::persistence::fitness::performances::route_performances
    pub fn route_detail_performance(
        conn: &Connection,
        group_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
        highlight_activity_id: Option<&str>,
        curves: crate::persistence::sections::lap_curves::pooled::CurveRead,
    ) -> crate::FfiSectionPerformanceData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::derivations::{Effort, efficiency_trend};
        use crate::persistence::fitness::performances::{
            excluded_route_performances, is_comparable_attempt, laps, route_attempts,
            route_performances,
        };
        use crate::persistence::routes::pooled as routes;

        let group = routes::group_by_id(conn, group_id);
        let activity_ids: Vec<String> = group
            .as_ref()
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();
        let excluded = routes::excluded_route_activity_ids(conn, group_id);
        let match_info = routes::match_info(conn, group_id);
        // Read once: every sport's included and excluded attempts are taken
        // from the same members.
        let metrics: std::collections::HashMap<&str, crate::ActivityMetrics> = activity_ids
            .iter()
            .filter_map(|id| activities::metrics_of(conn, id).map(|m| (id.as_str(), m)))
            .collect();
        let metrics_of = |id: &str| metrics.get(id).cloned();
        let route_distance = group
            .as_ref()
            .and_then(|g| activities::metrics_of(conn, &g.representative_id))
            .map_or(0.0, |m| m.distance);

        // Every sport that has taken the route and its attempts that count,
        // most first, ties by name. A sport with every attempt excluded is
        // listed at none, so its attempts can still be restored under it.
        let mut sports: Vec<(String, u32)> = Vec::new();
        for id in &activity_ids {
            let Some(m) = metrics.get(id.as_str()) else {
                continue;
            };
            let counts = u32::from(!excluded.contains(id));
            match sports.iter_mut().find(|(sport, _)| *sport == m.sport_type) {
                Some((_, outings)) => *outings += counts,
                None => sports.push((m.sport_type.clone(), counts)),
            }
        }
        sports.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        // A sport's included or excluded attempts, each one lap over the whole
        // activity.
        let attempts_of = |sport: Option<&str>, rows: laps::Rows| {
            let attempts = match rows {
                laps::Rows::Included => route_performances(
                    &activity_ids,
                    Some(&match_info),
                    &excluded,
                    metrics_of,
                    None,
                    sport,
                ),
                laps::Rows::Excluded => excluded_route_performances(
                    &activity_ids,
                    &match_info,
                    &excluded,
                    metrics_of,
                    sport,
                ),
            };
            route_attempts(&attempts, route_distance, rows)
        };

        super::section_detail_from(
            &sports,
            None,
            sport_filter,
            time_range_days,
            crate::FfiPerformanceSubject::Route,
            highlight_activity_id,
            |oldest, newest| {
                crate::persistence::wellness::pooled::wellness_days(conn, oldest, newest)
                    .unwrap_or_default()
            },
            |sport| {
                crate::persistence::sections::lap_curves::pooled::cached_route_lap_curves(
                    conn,
                    group_id,
                    sport,
                    curves,
                    || attempts_of(sport, laps::Rows::Included),
                )
            },
            |sport, since| {
                let attempts = route_performances(
                    &activity_ids,
                    Some(&match_info),
                    &excluded,
                    metrics_of,
                    None,
                    Some(sport),
                );
                // Counted attempts with a heart rate, in the latest one's
                // direction: the way back is a different climb, as the
                // section trend and the ranking read it.
                let weighed: Vec<_> = attempts
                    .performances
                    .iter()
                    .filter(|p| is_comparable_attempt(p, None))
                    .filter_map(|p| Some((p, p.avg_hr.filter(|hr| *hr > 0)?)))
                    .collect();
                let latest_direction = weighed
                    .iter()
                    .max_by_key(|(p, _)| p.date)
                    .map(|(p, _)| p.direction.as_str());
                let efforts: Vec<Effort> = weighed
                    .iter()
                    .filter(|(p, _)| is_comparable_attempt(p, latest_direction))
                    .filter(|(p, _)| p.date >= since)
                    .map(|(p, hr)| Effort {
                        time_secs: f64::from(p.moving_time),
                        avg_hr: f64::from(*hr),
                        distance_meters: p.distance,
                        date: p.date,
                    })
                    .collect();
                let name = group
                    .as_ref()
                    .and_then(|g| g.custom_name.as_deref())
                    .unwrap_or("Route");
                efficiency_trend(group_id, sport, name, &efforts)
            },
            |sport, rows| std::sync::Arc::new(attempts_of(sport, rows)),
        )
    }

    /// Everything the activity detail screen paints with.
    ///
    /// The engine path answers the counts and the sport from the memory tier and
    /// the group from the lazily regrouped list; this one has committed rows
    /// only, so it inherits the same deferred-regroup staleness the route detail
    /// read above records.
    pub fn activity_detail_data(
        conn: &Connection,
        activity_id: &str,
        min_route_activities: u32,
    ) -> crate::FfiActivityDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::derivations::pooled as derivations;
        use crate::persistence::indicators::pooled as indicators;
        use crate::persistence::routes::pooled as routes;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::queries::pooled as sections;

        let names = named::overlay_names(conn);

        let route_groups: Vec<crate::FfiRouteGroup> = routes::group_holding(conn, activity_id)
            .filter(|g| g.activity_ids.len() as u32 >= min_route_activities)
            .map(crate::FfiRouteGroup::from)
            .into_iter()
            .collect();
        let representative_signature = route_groups
            .first()
            .and_then(|g| {
                routes::representative_polylines(conn, &[g.representative_id.as_str()])
                    .remove(&g.representative_id)
            })
            .unwrap_or_default();

        let matched = sections::sections_for_activity(conn, activity_id, &names);
        // The same dedup the engine path does: a custom section this activity
        // traverses is already in `matched_sections`.
        let matched_ids: std::collections::HashSet<&str> =
            matched.iter().map(|s| s.id.as_str()).collect();
        let custom: Vec<_> = sections::custom_sections_naming_activity(conn, activity_id, &names)
            .into_iter()
            .filter(|s| !matched_ids.contains(s.id.as_str()))
            .collect();

        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut targets: Vec<(String, Vec<crate::GpsPoint>)> = Vec::new();
        for section in matched.iter().chain(custom.iter()) {
            if seen.insert(section.id.as_str()) {
                targets.push((section.id.clone(), section.polyline.clone()));
            }
        }

        let track = activities::gps_track(conn, activity_id).unwrap_or_default();
        let section_traces = super::section_traces(&track, &targets);

        let encounters = derivations::activity_section_encounters(conn, activity_id, &names);
        let pr_section_ids: Vec<String> = targets
            .iter()
            .filter(|(section_id, _)| {
                encounters
                    .iter()
                    .any(|r| r.section_id == *section_id && r.is_pr)
            })
            .map(|(section_id, _)| section_id.clone())
            .collect();

        let ids = [activity_id.to_string()];
        let (max_hr, max_hr_source) = super::activity_max_hr(conn, activity_id);
        let body = activities::activity_body(conn, activity_id);
        crate::FfiActivityDetailData {
            exercise_groups: crate::persistence::strength::pooled::exercise_sets(conn, activity_id)
                .map(|sets| {
                    crate::objects::strength::summarise_session(
                        crate::objects::strength::sets_to_ffi(activity_id, &sets),
                    )
                    .groups
                })
                .unwrap_or_default(),
            fitness_impact: activities::metrics_of(conn, activity_id).and_then(|metrics| {
                // The date is local wall-clock in epoch seconds.
                let days = chrono::DateTime::from_timestamp(metrics.date, 0)
                    .map_or(super::DEFAULT_FITNESS_DAYS, |start| {
                        super::stored_fitness_days_on(conn, start.date_naive())
                    });
                super::activity_load_impact(metrics.training_load, &metrics.sport_type, days)
            }),
            activity_count: activity_count(conn),
            // The catalogue row and the track are written in one batch and the
            // track cascades from the row, so holding one is holding the other.
            has_gps_track: activities::has_activity(conn, activity_id).unwrap_or(false),
            section_count: sections::section_count(conn),
            route_groups,
            representative_signature,
            matched_sections: matched
                .into_iter()
                .map(crate::persistence::PersistentEngine::matched_section)
                .collect(),
            custom_sections: custom.into_iter().map(crate::FfiSection::from).collect(),
            encounters,
            highlights: crate::FfiActivityHighlightsBundle {
                indicators: indicators::activity_indicators(conn, &ids),
                route_highlights: derivations::route_highlights(conn, &ids),
                new_ground: crate::persistence::new_ground::pooled::new_ground_of(conn, &ids),
                strength_cards: crate::objects::strength::strength_cards(conn, &ids),
            },
            section_traces,
            pr_section_ids,
            max_hr,
            max_hr_source,
            hr_zones: super::activity_hr_zones_from(conn, activity_id),
            summary: super::activity_summary(
                body.as_deref(),
                &activities::activity_sport(conn, activity_id).unwrap_or_default(),
            ),
            power_zones: super::activity_power_zones(body.as_deref()).unwrap_or_default(),
            ledger_changes:
                crate::persistence::sections::history::pooled::ledger_changes_naming_activity(
                    conn,
                    activity_id,
                    &names,
                )
                .into_iter()
                .map(Into::into)
                .collect(),
            intervals_id: crate::persistence::activities::intervals_web_id(
                activity_id,
                activities::stored_intervals_id(conn, activity_id).as_deref(),
            ),
            pool_swim: crate::persistence::strength::pooled::pool_swim(conn, activity_id)
                .unwrap_or_default(),
        }
    }

    /// Everything the insights tab is computed from.
    ///
    /// The pooled path reads persisted rows under the same deferred-regroup
    /// staleness as the other pooled screens.
    pub fn insights_data(
        conn: &Connection,
        p: &crate::FfiInsightsParams,
    ) -> crate::FfiInsightsData {
        insights_data_at(conn, p)
    }

    pub(super) fn insights_data_at(
        conn: &Connection,
        p: &crate::FfiInsightsParams,
    ) -> crate::FfiInsightsData {
        use crate::persistence::fitness::derivations::pooled as derivations;
        use crate::persistence::fitness::performances::pooled as performances;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::queries::pooled as sections;
        use crate::persistence::sections::ranking::pooled as ranking;
        use crate::persistence::strength::pooled as strength;

        let names = named::overlay_names(conn);
        let now_ts = p.current_end;

        // Period stats (4 queries, all in one engine lock)
        let current_week =
            derivations::period_stats(conn, p.current_start as i64, p.current_end as i64);
        let previous_week = derivations::period_stats(
            conn,
            p.prev_start as i64,
            super::previous_week_end(p, &current_week),
        );
        let chronic_period =
            derivations::window_stats(conn, p.chronic_start as i64, p.prev_start as i64);

        // Trends
        let ftp_trend = derivations::ftp_trend_to(conn, &crate::persistence::wellness::today_iso());
        let run_pace_trend = derivations::pace_trend(conn, "Run");

        // Recent PRs - loop stays in Rust, never crosses FFI
        let recent_since = now_ts as i64 - i64::from(p.recent_pr_window_days) * 86_400;
        let mut recent_prs = Vec::new();
        let available_sports = available_sport_types(conn);
        // One candidate per (section, sport): shared ground holds a record in
        // each sport that travels it, and neither may be measured against the
        // other's laps.
        // One read, then the fan-out in memory. Asking per sport runs the whole
        // summary query once per sport and throws away every row belonging to
        // the others, which on a fourteen-sport library is thirteen wasted
        // scans and a third of this bundle.
        let recent_visits = sections_visited_since(conn, recent_since);
        // A record inside the window needs an outing inside the window, so only
        // the sections visited in it are read. When the junction cannot be
        // read, every section is a candidate.
        let candidates = match &recent_visits {
            Some(_) => sections::section_summaries_visited_since(conn, recent_since, &names),
            None => sections::section_summaries_filtered(conn, None, true, &names),
        };
        let all_summaries = crate::persistence::sections::summaries_by_sport(
            &candidates,
            &available_sports,
            // Outings, not passes: a PR slot is earned by returning.
            p.recent_pr_min_outings,
        );

        for (sport, s) in &all_summaries {
            // A record inside the window needs an outing inside the window, and
            // computing one section's performances costs tens of milliseconds,
            // so the junction says which sections are worth asking about before
            // any of them is computed.
            if let Some(recent) = &recent_visits
                && !recent.contains(&(s.id.clone(), sport.clone()))
            {
                continue;
            }
            let perf = performances::cached_section_performances(conn, &s.id, Some(sport));
            // The per-direction bests exclude partial and short traversals.
            let best = [
                (false, perf.best_forward_record.as_ref()),
                (true, perf.best_reverse_record.as_ref()),
            ]
            .into_iter()
            .filter_map(|(reverse, record)| record.map(|record| (reverse, record)))
            .filter(|(_, record)| crate::persistence::records::is_section_record_pr(&perf, record))
            .min_by(|(_, a), (_, b)| a.best_time.total_cmp(&b.best_time));
            if let Some((reverse, record)) = best
                && record.activity_date >= recent_since
            {
                let days_ago = crate::calendar_days_between(record.activity_date, now_ts as i64);
                let standing = super::section_pr_standing(&perf.records, record, reverse);
                // One row per (section, sport): a section holds a record in
                // each sport that travels it, and neither replaces the other.
                match recent_prs.iter_mut().find(|p: &&mut crate::FfiRecentPR| {
                    p.section_id == s.id && p.sport_type == *sport
                }) {
                    // A fresher duplicate of the same pair takes the row whole.
                    // Every field below the section is that sport's, so
                    // carrying the time over on its own would mix records.
                    Some(held) if days_ago < held.days_ago => {
                        held.best_time = record.best_time;
                        held.days_ago = days_ago;
                        held.traversal_count = perf.records.iter().map(|r| r.lap_count).sum();
                        held.standing_count = standing.standing_count;
                        held.percentile_faster = standing.percentile_faster;
                        held.previous_best_time = standing.previous_best_time;
                        held.previous_best_date = standing.previous_best_date;
                        held.delta_seconds = standing.delta_seconds;
                        held.best_activity_id = Some(record.activity_id.clone());
                        held.recent_efforts = super::activity_series_tail(
                            perf.records.iter(),
                            p.history_limit,
                            |r| {
                                (
                                    r.best_time,
                                    r.activity_date as f64,
                                    Some(r.activity_id.clone()),
                                )
                            },
                        );
                    }
                    Some(_) => {}
                    None => recent_prs.push(crate::FfiRecentPR {
                        section_id: s.id.clone(),
                        section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                        best_time: record.best_time,
                        days_ago,
                        sport_type: sport.clone(),
                        // This sport's passes, not the section's. `perf` is
                        // already filtered to the sport the record was set
                        // in, and every record carries its laps.
                        traversal_count: perf.records.iter().map(|r| r.lap_count).sum(),
                        standing_count: standing.standing_count,
                        percentile_faster: standing.percentile_faster,
                        previous_best_time: standing.previous_best_time,
                        previous_best_date: standing.previous_best_date,
                        delta_seconds: standing.delta_seconds,
                        // `perf.records` is already computed here, oldest
                        // first, to find the record above. The card draws the
                        // tail of it rather than the sheet reading the whole
                        // bundle back per open.
                        recent_efforts: super::activity_series_tail(
                            perf.records.iter(),
                            p.history_limit,
                            |r| {
                                (
                                    r.best_time,
                                    r.activity_date as f64,
                                    Some(r.activity_id.clone()),
                                )
                            },
                        ),
                        best_activity_id: Some(record.activity_id.clone()),
                        // Filled below, from one query over the rows that
                        // earned a slot rather than a read per pair the loop
                        // meets.
                        encoded_polyline: Vec::new(),
                    }),
                }
            }
        }

        // The card draws the section it names, so each row carries the line.
        // One query over the sections that earned a slot, after the loop,
        // because the loop meets every (section, sport) pair. A section held
        // in two sports is read once and drawn on both rows.
        {
            let mut ids: Vec<&str> = recent_prs.iter().map(|pr| pr.section_id.as_str()).collect();
            ids.sort_unstable();
            ids.dedup();
            let lines = crate::persistence::sections::pooled::section_polylines(conn, &ids);
            for pr in &mut recent_prs {
                if let Some(encoded) = lines.get(&pr.section_id) {
                    pr.encoded_polyline = super::preview_line(
                        &crate::persistence::codec::decode_polyline(encoded).unwrap_or_default(),
                    );
                }
            }
        }

        // Every sport the library holds is ranked: a sport done irregularly has
        // no activity pattern and still has sections worth a trend.
        let sport_types = available_sports;

        let section_count = sections::section_count(conn);
        let sections_ready = p.include_sections && section_count > 0;

        // One read for every sport, then one ranking per sport. The ranking is
        // within a sport and stays there; the scan it used to repeat per sport
        // grew with the number of sports rather than with the sections.
        let mut full_ranked_sections: Vec<crate::FfiRankedSectionsBySport> = if sections_ready {
            ranking::ranked_sections_by_sports(conn, &sport_types, u32::MAX, &names)
        } else {
            Vec::new()
        };
        let ranked_sections: Vec<crate::FfiRankedSectionsBySport> = full_ranked_sections
            .iter()
            .map(|batch| crate::FfiRankedSectionsBySport {
                sport_type: batch.sport_type.clone(),
                sections: batch
                    .sections
                    .iter()
                    .take(p.ranked_limit as usize)
                    .cloned()
                    .collect(),
            })
            .collect();

        // Efficiency candidates: the most recently visited ranked sections.
        // A trend on a section untouched for months is a curiosity, not an
        // insight, so anything outside the active window is dropped.
        // A trend is one sport's efforts on a section, so a section ranked in
        // two sports is two candidates.
        let mut candidates: Vec<(String, String)> = Vec::new();
        for batch in &ranked_sections {
            let recent = batch
                .sections
                .iter()
                .filter(|rs| rs.days_since_last <= p.active_window_days)
                .take(p.efficiency_per_sport as usize);
            for rs in recent {
                let pair = (rs.section_id.clone(), batch.sport_type.clone());
                if !candidates.contains(&pair) {
                    candidates.push(pair);
                }
            }
        }

        let mut efficiency_trends: Vec<crate::FfiEfficiencyTrend> = Vec::new();
        for (section_id, sport_type) in &candidates {
            let Some(trend) =
                section_efficiency_trend_of(conn, section_id, sport_type, &names, i64::MIN)
            else {
                continue;
            };
            let min_efforts = match trend.direction {
                crate::EfficiencyDirection::Improving => p.efficiency_min_efforts,
                crate::EfficiencyDirection::Worsening => p.efficiency_declining_min_efforts,
                crate::EfficiencyDirection::Flat => continue,
            };
            if trend.effort_count < min_efforts {
                continue;
            }
            if !super::hr_change_clears_floor(trend.hr_change_bpm, p.efficiency_min_hr_change_bpm) {
                continue;
            }
            efficiency_trends.push(trend);
        }
        efficiency_trends
            .sort_by_key(|trend| trend.direction != crate::EfficiencyDirection::Improving);
        efficiency_trends.truncate(p.efficiency_limit as usize);

        let has_strength_data = strength::strength_activity_count(conn).unwrap_or(0) > 0;
        let strength_series = if has_strength_data {
            strength_insight_series(conn, &p.strength_month, &p.strength_weeks)
        } else {
            None
        };

        let chronic_week_average = super::chronic_week_average(&chronic_period);
        let weekly_totals = super::weekly_totals(p, &current_week, |from, to| {
            derivations::window_stats(conn, from, to)
        });
        let (week_over_week, week_against_chronic) = super::complete_period_comparisons(
            conn,
            p,
            &current_week,
            &previous_week,
            &chronic_week_average,
        );
        let form = crate::persistence::wellness::pooled::latest_form(
            conn,
            &p.wellness_oldest,
            &p.wellness_newest,
        );

        // The three tails the insights screen used to reach back for, one
        // engine call each, on top of the heaviest read in the tree.
        //
        // The stale-PR exclusion looked like a caller's argument and was not.
        // The screen passed the sections already carrying a `section_pr-`
        // insight, which come only from `recent_prs`, and this bundle has just
        // built those. Taken here it is the whole list rather than the three
        // the screen surfaces, so a section that set a record and did not make
        // the cut is still not offered as stale. That is the rule the exclusion
        // was always for, stated where the data is.
        let hrv_trend = crate::persistence::wellness::pooled::hrv_trend_to(
            conn,
            p.hrv_window_days,
            &crate::persistence::wellness::today_iso(),
        )
        .unwrap_or(None);
        let hrv_withheld_since = crate::persistence::wellness::pooled::hrv_withheld_since_to(
            conn,
            p.hrv_window_days,
            &crate::persistence::wellness::today_iso(),
        )
        .unwrap_or(None);
        let recent_section_changes =
            crate::persistence::sections::history::pooled::recent_section_changes(
                conn,
                p.section_change_window_days,
            )
            .into_iter()
            .map(|c| crate::FfiSectionChange {
                section_name: names
                    .get(&c.section_id)
                    .cloned()
                    .unwrap_or_else(|| c.section_id.clone()),
                section_id: c.section_id,
                kind: c.kind,
                at: c.at,
                encoded_polyline: Vec::new(),
            })
            .collect::<Vec<_>>();
        // The line each change is about, one query over the sections named,
        // thinned as the record rows' lines are.
        let recent_section_changes = {
            let mut changes = recent_section_changes;
            let mut ids: Vec<&str> = changes.iter().map(|c| c.section_id.as_str()).collect();
            ids.sort_unstable();
            ids.dedup();
            let lines = crate::persistence::sections::pooled::section_polylines(conn, &ids);
            for change in &mut changes {
                if let Some(encoded) = lines.get(&change.section_id) {
                    change.encoded_polyline = super::preview_line(
                        &crate::persistence::codec::decode_polyline(encoded).unwrap_or_default(),
                    );
                }
            }
            changes
        };
        let exclude: std::collections::HashSet<(String, String)> = recent_prs
            .iter()
            .map(|pr| (pr.section_id.clone(), pr.sport_type.clone()))
            .collect();
        let swim_pace_trend = derivations::pace_trend(conn, "Swim");
        let stale_pr_opportunities = crate::persistence::fitness::stale_pr::opportunities(
            &crate::persistence::fitness::stale_pr::StalePrTrends {
                ftp: &ftp_trend,
                run_pace: &run_pace_trend,
                swim_pace: &swim_pace_trend,
            },
            &sport_types,
            &crate::persistence::fitness::stale_pr::StalePrRequest {
                stale_threshold_days: p.stale_threshold_days,
                min_gain_percent: p.stale_min_gain_percent,
                max_opportunities: p.stale_max_opportunities,
                min_traversals: p.stale_min_traversals,
                exclude_section_sports: &exclude,
                exclude_sections: &std::collections::HashSet::new(),
            },
            |sport| ranking::stale_ranked_sections(conn, sport, p.stale_threshold_days, &names),
            |sport, at| {
                crate::persistence::fitness::derivations::pooled::fitness_on(conn, sport, at)
            },
        );

        let covered: std::collections::HashSet<(&str, &str)> = recent_prs
            .iter()
            .map(|pr| (pr.section_id.as_str(), pr.sport_type.as_str()))
            .chain(
                stale_pr_opportunities
                    .iter()
                    .map(|pr| (pr.section_id.as_str(), pr.sport_type.as_str())),
            )
            .collect();
        let mut trend_faster_count = 0;
        let mut trend_slower_count = 0;
        for batch in &mut full_ranked_sections {
            batch.sections.retain(|section| {
                if covered.contains(&(section.section_id.as_str(), batch.sport_type.as_str()))
                    || section.days_since_last > p.active_window_days
                {
                    return false;
                }
                let eligible = crate::persistence::sections::ranking::eligible_trend(
                    section.trend,
                    section.days_since_last,
                    p.active_window_days,
                )
                .is_some();
                if eligible && section.trend > 0 {
                    trend_faster_count += 1;
                } else if eligible {
                    trend_slower_count += 1;
                }
                eligible
            });
        }

        let route_insights = derivations::route_insights(conn, p);
        let route_record_count =
            route_insights.iter().filter(|r| r.is_recent_record).count() as u32;
        let route_faster_count = route_insights.iter().filter(|r| r.trend > 0).count() as u32;
        let route_slower_count = route_insights.iter().filter(|r| r.trend < 0).count() as u32;

        crate::FfiInsightsData {
            current_week,
            previous_week,
            chronic_period,
            chronic_week_average,
            weekly_totals,
            ftp_trend,
            run_pace_trend,
            swim_pace_trend,
            recent_prs,
            section_count,
            sport_types,
            ranked_sections,
            trend_sections: full_ranked_sections,
            trend_faster_count,
            trend_slower_count,
            route_insights,
            route_record_count,
            route_faster_count,
            route_slower_count,
            efficiency_trends,
            has_strength_data,
            strength_series,
            week_over_week,
            week_against_chronic,
            form,
            hrv_trend,
            hrv_withheld_since,
            recent_section_changes,
            stale_pr_opportunities,
        }
    }

    /// The (section, sport) pairs travelled on or after `since`, or `None`
    /// when the junction cannot be read, which leaves the caller computing
    /// every section as it did before.
    fn sections_visited_since(
        conn: &Connection,
        since: i64,
    ) -> Option<std::collections::HashSet<(String, String)>> {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT sa.section_id, am.sport_type
                 FROM activity_metrics am
                 CROSS JOIN section_activities sa ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0 AND am.date >= ?1",
            )
            .map_err(|e| log::warn!("[screens] recent visit prepare failed: {}", e))
            .ok()?;
        let rows = stmt
            .query_map(rusqlite::params![since], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| log::warn!("[screens] recent visit query failed: {}", e))
            .ok()?;
        Some(rows.flatten().collect())
    }

    /// Strength volume over one month and a set of weeks, or `None` when a
    /// range cannot be read.
    fn strength_insight_series(
        conn: &Connection,
        month: &crate::FfiTimestampRange,
        weeks: &[crate::FfiTimestampRange],
    ) -> Option<crate::FfiStrengthInsightSeries> {
        let monthly = crate::objects::strength::aggregate_strength_sets(
            &crate::persistence::strength::pooled::exercise_sets_in_range(
                conn,
                month.start_ts as i64,
                month.end_ts as i64,
            )
            .ok()?,
        );
        let mut weekly = Vec::with_capacity(weeks.len());
        for range in weeks {
            let sets = crate::persistence::strength::pooled::exercise_sets_in_range(
                conn,
                range.start_ts as i64,
                range.end_ts as i64,
            )
            .ok()?;
            let mut summary = crate::objects::strength::aggregate_strength_sets(&sets);
            summary.start_ts = range.start_ts;
            weekly.push(summary);
        }
        let progressions = crate::objects::strength::strength_progressions(&monthly, &weekly);
        Some(crate::FfiStrengthInsightSeries {
            monthly,
            weekly,
            progressions,
        })
    }

    /// One section's efficiency trend over the efforts since `since`, with
    /// its name and length read from the row rather than the in-memory
    /// catalogue the engine path uses.
    pub(crate) fn section_efficiency_trend_of(
        conn: &Connection,
        section_id: &str,
        sport_type: &str,
        names: &std::collections::BTreeMap<String, String>,
        since: i64,
    ) -> Option<crate::FfiEfficiencyTrend> {
        let (name, length) =
            crate::persistence::sections::queries::pooled::section_name_and_length(
                conn, section_id, names,
            )?;
        crate::persistence::fitness::derivations::pooled::section_efficiency_trend(
            conn,
            section_id,
            sport_type,
            name.as_deref().unwrap_or("Section"),
            length,
            since,
        )
    }

    /// Everything the section detail screen paints with.
    ///
    /// Every read here is committed rows. What the engine path answers from
    /// memory is the activity count, the per-activity metrics and the section
    /// record itself, and each of those is loaded from the same table at init,
    /// so the pooled answers are the rows the memory tier is a copy of. The
    /// one place the two can differ is a catalogue a detection has computed
    /// and not yet saved, which is the deferred-regroup staleness the route
    /// detail read above already records.
    pub fn section_detail_data(conn: &Connection, section_id: &str) -> crate::FfiSectionDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::sections::merging::pooled as merging;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::pooled as sections_mod;
        use crate::persistence::sections::queries::pooled as sections;

        let names = named::overlay_names(conn);
        let section = sections::section(conn, section_id, &names).map(|raw| {
            crate::FfiSection::from(raw)
                .with_portions(sections_mod::section_portions(conn, section_id))
        });

        let activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| s.activity_ids.clone())
            .unwrap_or_default();
        let portion_activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| {
                let mut seen = std::collections::HashSet::new();
                s.activity_portions
                    .iter()
                    .filter(|p| seen.insert(p.activity_id.clone()))
                    .map(|p| p.activity_id.clone())
                    .collect()
            })
            .unwrap_or_default();

        let activity_rows: Vec<crate::FfiSectionActivityRow> = activity_ids
            .iter()
            .filter_map(|id| activities::metrics_of(conn, id))
            .map(|m| crate::FfiSectionActivityRow {
                activity_id: m.activity_id,
                name: m.name,
                sport_type: m.sport_type,
                start_time: m.date as f64,
                distance: m.distance,
                moving_time: m.moving_time,
                average_speed: if m.moving_time > 0 {
                    m.distance / f64::from(m.moving_time)
                } else {
                    0.0
                },
            })
            .collect();

        let pinned_version =
            crate::persistence::sections::history::pooled::pinned_section_version(conn, section_id);

        let retirement = if section.is_some() {
            None
        } else {
            crate::persistence::sections::history::pooled::retirement_of(conn, section_id).map(
                |r| {
                    let into_name = r
                        .into
                        .as_ref()
                        .and_then(|id| sections::section(conn, id, &names))
                        .and_then(|s| s.name);
                    crate::FfiSectionRetirement {
                        kind: r.kind,
                        at: r.at,
                        into: r.into,
                        into_name,
                    }
                },
            )
        };

        crate::FfiSectionDetailData {
            activity_count: activity_count(conn),
            retirement,
            merge_candidates: merging::merge_candidates(conn, section_id, &names),
            excluded_activity_ids: sections::excluded_activity_ids(conn, section_id),
            has_original_bounds: sections::has_original_bounds(conn, section_id),
            activity_rows,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            missing_time_stream_ids: activities::activities_missing_time_streams(
                conn,
                &portion_activity_ids,
            ),
            history: crate::persistence::sections::history::pooled::linked_section_history(
                conn, section_id, &names,
            ),
            geometry_versions:
                crate::persistence::sections::history::pooled::section_geometry_versions(
                    conn, section_id,
                )
                .into_iter()
                .map(|v| crate::FfiSectionGeometryVersion {
                    pinned: pinned_version == Some(v.version),
                    version: v.version as f64,
                    created_at: v.created_at,
                    milestone: v.milestone,
                })
                .collect(),
            pinned_version: pinned_version.map(|v| v as f64),
            section,
        }
    }

    /// The feed's first paint: the summary card and the preview tracks.
    ///
    /// Both halves are committed rows, so a sync page mid-transaction delays
    /// neither. What a card drawn here cannot show is the activity that sync
    /// is still writing, which is the same thing it could not show a moment
    /// earlier.
    pub fn startup_data(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        preview_activity_ids: &[String],
    ) -> crate::FfiStartupData {
        crate::FfiStartupData {
            summary_card: summary_card(conn, current_start, current_end, prev_start, prev_end),
            preview_tracks: preview_activity_ids
                .iter()
                .filter_map(|id| preview_track(conn, id))
                .collect(),
            sparklines: crate::persistence::wellness::pooled::sparklines_to(
                conn,
                super::FEED_SPARKLINE_DAYS,
                &crate::persistence::wellness::today_iso(),
            )
            .ok()
            .flatten(),
        }
    }

    /// The week against the week before it, plus the three trends beside them.
    pub fn summary_card(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
    ) -> crate::FfiSummaryCardData {
        use crate::persistence::fitness::derivations::pooled as fitness;
        let current_week = fitness::period_stats(conn, current_start, current_end);
        let prev_week = fitness::period_stats(conn, prev_start, prev_end);
        let (week_hours_trend, week_count_trend) = super::week_trends(&current_week, &prev_week);
        crate::FfiSummaryCardData {
            wellness: crate::persistence::wellness::pooled::summary(conn),
            current_week,
            prev_week,
            week_hours_trend,
            week_count_trend,
            ftp_trend: fitness::ftp_trend_to(conn, &crate::persistence::wellness::today_iso()),
            run_pace_trend: fitness::pace_trend(conn, "Run"),
            swim_pace_trend: fitness::pace_trend(conn, "Swim"),
        }
    }

    fn widget_summary_card(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
    ) -> crate::WidgetSummaryCardData {
        use crate::persistence::fitness::derivations::pooled as fitness;
        crate::WidgetSummaryCardData {
            wellness: crate::persistence::wellness::pooled::widget_summary(conn),
            current_week: fitness::period_stats(conn, current_start, current_end),
            prev_week: fitness::period_stats(conn, prev_start, prev_end),
            ftp_trend: fitness::ftp_trend_to(conn, &crate::persistence::wellness::today_iso()),
            run_pace_trend: fitness::pace_trend(conn, "Run"),
            swim_pace_trend: fitness::pace_trend(conn, "Swim"),
        }
    }

    /// One card's preview line, from the signature the read cache holds.
    ///
    /// `None` for an activity with no signature or an empty one: there is
    /// nothing to draw.
    pub fn preview_track(conn: &Connection, activity_id: &str) -> Option<crate::FfiPreviewTrack> {
        let sig = crate::persistence::read_cache::signature(conn, activity_id, || {
            crate::persistence::activities::pooled::signature(conn, activity_id)
        })?;
        if sig.points.is_empty() {
            return None;
        }
        Some(crate::FfiPreviewTrack {
            activity_id: activity_id.to_string(),
            encoded_coords: crate::persistence::codec::encode_polyline(&sig.points),
        })
    }

    /// The two layers a map read may carry. `None` leaves a layer out; `Some`
    /// asks for it, holding the stamp of the copy the caller already has, if
    /// any.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct MapLayers {
        pub route_lines: Option<Option<f64>>,
        pub sections: Option<Option<f64>>,
    }

    /// The screen itself, given the chips whoever asked for it is entitled to.
    // Both map entry points pass their filters and layer switches through here.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn screen_data(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
        distance_band: crate::MapDistanceBand,
        is_metric: bool,
        layers: MapLayers,
        name_needle: String,
        available_sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        // Taken before either layer is read, so a commit while they are read
        // moves the next stamp rather than hiding under this one. The filters
        // narrow the activities alone, so a filter change re-reads under the
        // same stamp and a layer the caller holds is not shipped again.
        let stamp = crate::persistence::read_cache::stamp(conn).map(|stamp| stamp as f64);
        let holds = |held: Option<f64>| stamp.is_some() && held == stamp;
        let window = map_activities_filtered(conn, start_date, end_date);
        let mapped = window.len() as u32;
        let category_counts = crate::FfiSportFamily::ALL
            .into_iter()
            .map(|family| crate::ffi_types::FfiMapCategoryCount {
                family,
                count: window
                    .iter()
                    .filter(|activity| crate::FfiSportFamily::of(&activity.sport_type) == family)
                    .count() as u32,
            })
            .collect();
        let selected: std::collections::HashSet<String> = sport_types.into_iter().collect();
        // The chip counts above are of the window alone, so a search does not
        // empty the chips that would widen it again.
        let needle = name_needle.trim().to_lowercase();
        let activities = window
            .into_iter()
            .filter(|activity| {
                (selected.is_empty() || selected.contains(&activity.sport_type))
                    && map_distance_matches(activity.distance, distance_band, is_metric)
                    && (needle.is_empty() || activity.name.to_lowercase().contains(&needle))
            })
            .collect::<Vec<_>>();
        // The backlog is counted only for a map that draws nothing, which is
        // the one case it explains. A count that cannot be read names no
        // cause rather than a wrong one.
        let empty_reason = if activities.is_empty() {
            match crate::persistence::activities::pooled::window_track_backlog(
                conn, start_date, end_date,
            ) {
                Ok((in_window, pending)) => {
                    map_empty_reason(in_window.max(mapped), mapped, 0, pending)
                }
                Err(e) => {
                    log::warn!("[map] window backlog: {e:?}");
                    None
                }
            }
        } else {
            None
        };
        // Off, or held by the caller, the read takes the count column alone;
        // on, it takes the one layer row. Neither touches a route group or a
        // track.
        let (route_count, route_lines) = match layers.route_lines {
            Some(held) if holds(held) => {
                match crate::persistence::route_lines::pooled::counted_generation(conn) {
                    Ok(Some((generation, count))) => (
                        count,
                        Some(crate::ffi_types::FfiRouteLineLayer {
                            generation: generation as f64,
                            stamp,
                            routes: None,
                        }),
                    ),
                    _ => (0, None),
                }
            }
            Some(_) => match crate::persistence::route_lines::pooled::layer_with_generation(conn) {
                Ok(Some((generation, lines))) => {
                    // Names and sizes change without a regroup, so they are
                    // read beside the layer rather than stored in it.
                    let ids: Vec<&str> = lines.iter().map(|line| line.route_id.as_str()).collect();
                    let names = crate::persistence::routes::pooled::route_names_for(conn, &ids);
                    let sizes = crate::persistence::routes::pooled::activity_counts_and_distances(
                        conn, &ids,
                    );
                    let routes = lines
                        .into_iter()
                        .map(|line| {
                            let (activity_count, distance_meters) =
                                sizes.get(&line.route_id).copied().unwrap_or_default();
                            crate::ffi_types::FfiRouteLine {
                                name: names.get(&line.route_id).cloned().unwrap_or_default(),
                                activity_count,
                                distance_meters,
                                route_id: line.route_id,
                                route_number: line.number,
                                polyline: line.polyline,
                            }
                        })
                        .collect::<Vec<_>>();
                    (
                        routes.len() as u32,
                        Some(crate::ffi_types::FfiRouteLineLayer {
                            generation: generation as f64,
                            stamp,
                            routes: Some(routes),
                        }),
                    )
                }
                _ => (0, None),
            },
            None => {
                let count =
                    crate::persistence::route_lines::pooled::route_count(conn).unwrap_or_default();
                (count, None)
            }
        };
        crate::FfiMapScreenData {
            activity_count: activity_count(conn),
            available_sport_types,
            category_counts,
            activities,
            route_count,
            route_lines,
            section_count: crate::persistence::sections::queries::pooled::section_count(conn),
            sections: layers.sections.map(|held| crate::FfiMapSectionLayer {
                stamp,
                sections: (!holds(held)).then(|| {
                    let overlay = crate::persistence::read_cache::map_sections(conn, || {
                        crate::persistence::sections::pooled::map_sections(
                            conn,
                            None,
                            Some(1),
                            &crate::persistence::sections::named::pooled::overlay_names(conn),
                        )
                    });
                    overlay.as_ref().clone()
                }),
            }),
            empty_reason,
        }
    }

    /// Why the map draws nothing, or `None` while it draws anything.
    /// `window` counts the activities in the date window, `mapped` those of
    /// them with a stored track, `shown` the tracks left after the sport,
    /// distance and name filters, and `pending` the window's tracks still to
    /// download. Filters answer first, since loosening them draws at once.
    pub(crate) fn map_empty_reason(
        window: u32,
        mapped: u32,
        shown: u32,
        pending: u32,
    ) -> Option<crate::FfiMapEmptyReason> {
        if shown > 0 {
            None
        } else if mapped > 0 {
            Some(crate::FfiMapEmptyReason::Filtered { mapped })
        } else if window == 0 {
            Some(crate::FfiMapEmptyReason::NoActivities)
        } else if pending > 0 {
            Some(crate::FfiMapEmptyReason::TracksPending {
                activities: window,
                pending,
            })
        } else {
            Some(crate::FfiMapEmptyReason::NoGps { activities: window })
        }
    }

    fn map_distance_matches(distance: f64, band: crate::MapDistanceBand, is_metric: bool) -> bool {
        let (xshort, short, medium) = if is_metric {
            (5_000.0, 10_000.0, 50_000.0)
        } else {
            (4_828.0, 9_656.0, 48_280.0)
        };
        match band {
            crate::MapDistanceBand::All => true,
            crate::MapDistanceBand::XShort => distance < xshort,
            crate::MapDistanceBand::Short => distance >= xshort && distance < short,
            crate::MapDistanceBand::Medium => distance >= short && distance < medium,
            crate::MapDistanceBand::Long => distance >= medium,
        }
    }

    /// The library total, including activities whose GPS has not arrived.
    pub(crate) fn activity_count(conn: &Connection) -> u32 {
        crate::persistence::activities::pooled::library_count(conn).unwrap_or_else(|e| {
            log::warn!("[map] activity count: {e:?}");
            0
        })
    }

    /// The sports the filter chips offer.
    pub(crate) fn available_sport_types(conn: &Connection) -> Vec<String> {
        crate::persistence::fitness::derivations::pooled::try_available_sport_types(conn)
            .unwrap_or_else(|e| {
                log::warn!("[map] sport types: {e:?}");
                Vec::new()
            })
    }

    /// Activities inside a date window, before map chip and distance filters.
    pub fn map_activities_filtered(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        // The join is what the memory read did by looking an id up in both
        // maps: an activity with no metrics row has no date to place it in the
        // window, so it is not on the map. The signature is a left join, since
        // one that has not been derived yet still draws, without its marker.
        let mut stmt = match conn.prepare(
            "SELECT a.id, m.name, m.sport_type, m.date, m.distance, m.moving_time,
                    a.min_lat, a.max_lat, a.min_lng, a.max_lng,
                    s.start_point_lat, s.start_point_lng
             FROM activity_metrics m
             JOIN activities a ON a.id = m.activity_id
             LEFT JOIN signatures s ON s.activity_id = m.activity_id
             WHERE m.date >= ?1 AND m.date <= ?2
             ORDER BY m.date DESC, a.id",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("[map] window: {e:?}");
                return Vec::new();
            }
        };

        let rows = stmt.query_map(rusqlite::params![start_date, end_date], |row| {
            let start_lat: Option<f64> = row.get(10)?;
            let start_lng: Option<f64> = row.get(11)?;
            let sport_type: String = row.get(2)?;
            Ok(crate::persistence::MapActivityComplete {
                activity_id: row.get(0)?,
                name: row.get(1)?,
                is_virtual: crate::sport::is_virtual(&sport_type),
                sport_type,
                date: row.get(3)?,
                distance: row.get(4)?,
                duration: row.get(5)?,
                bounds: crate::Bounds {
                    min_lat: row.get(6)?,
                    max_lat: row.get(7)?,
                    min_lng: row.get(8)?,
                    max_lng: row.get(9)?,
                },
                start_lat: start_lat.filter(|_| start_lng.is_some()),
                start_lng: start_lng.filter(|_| start_lat.is_some()),
            })
        });
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[map] window: {e:?}");
                return Vec::new();
            }
        };

        rows.flatten().collect()
    }
}

#[cfg(test)]
#[path = "tests/screens_performance_cache.rs"]
mod performance_cache_tests;

#[cfg(test)]
#[path = "tests/best_efforts_screen.rs"]
mod best_efforts_tests;

#[cfg(test)]
#[path = "tests/fitness_screen_calendar.rs"]
mod fitness_screen_calendar_tests;

#[cfg(test)]
#[path = "tests/fitness_screen.rs"]
mod fitness_screen_tests;

#[cfg(test)]
#[path = "tests/section_pr_standing.rs"]
mod section_pr_standing_tests;

#[cfg(test)]
#[path = "tests/section_record.rs"]
mod section_record_tests;

#[cfg(test)]
#[path = "tests/sport_settings_fallback.rs"]
mod sport_settings_fallback_tests;

#[cfg(test)]
#[path = "tests/map_empty_reason.rs"]
mod map_empty_reason_tests;

#[cfg(test)]
mod tests {
    use super::hr_change_clears_floor;

    static DETAIL_SQL: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

    fn record_detail_sql(sql: &str) {
        DETAIL_SQL.lock().unwrap().push(sql.to_string());
    }

    pub(super) fn lap_record(age_days: i64, time: f64) -> crate::SectionPerformanceRecord {
        let date = chrono::Utc::now().timestamp() - age_days * 86_400;
        crate::SectionPerformanceRecord {
            activity_id: format!("act{age_days}"),
            activity_name: String::new(),
            activity_date: date,
            laps: vec![crate::SectionLap {
                id: format!("lap{age_days}"),
                activity_id: format!("act{age_days}"),
                time,
                pace: 1000.0 / time,
                distance: 1000.0,
                direction: "same".to_string(),
                start_index: 0,
                end_index: 10,
                avg_hr: None,
                avg_power: None,
                coverage: Some(1.0),
                excluded: false,
                outside_distance_band: false,
                match_percentage: None,
            }],
            lap_count: 1,
            best_time: time,
            best_pace: 1000.0 / time,
            best_forward_time: Some(time),
            best_reverse_time: None,
            avg_time: time,
            avg_pace: 1000.0 / time,
            direction: "same".to_string(),
            section_distance: 1000.0,
        }
    }

    /// Scenario: a one-month range over a section with older laps.
    ///
    /// Expected behaviour: the histogram bins only the laps the chart holds
    /// for that range.
    #[test]
    fn the_section_histogram_bins_only_the_ranged_laps() {
        use crate::persistence::fitness::performances::laps;
        let records = vec![
            lap_record(200, 500.0),
            lap_record(100, 520.0),
            lap_record(20, 300.0),
            lap_record(10, 305.0),
            lap_record(5, 310.0),
        ];
        let all = std::sync::Arc::new(laps::summarise(1000.0, records));
        let data = super::section_detail_from(
            &[],
            Some(1000.0),
            None,
            30,
            crate::FfiPerformanceSubject::Section,
            None,
            |_, _| Vec::new(),
            |_| Some(std::sync::Arc::new(None)),
            |_, _| None,
            |_, rows| match rows {
                laps::Rows::Included => all.clone(),
                laps::Rows::Excluded => std::sync::Arc::new(laps::empty()),
            },
        );
        let forward = data.histograms.forward.expect("three laps in range");
        assert_eq!(forward.binned, 3);
        assert_eq!(forward.counts.iter().sum::<u32>(), 3);
        assert_eq!(forward.start_secs, 300.0);
    }

    #[test]
    fn activity_load_impact_is_marginal_and_additive() {
        let one = super::activity_load_impact(Some(100.0), "Ride", (42, 7)).unwrap();
        assert!((one.fitness - 2.35283).abs() < 1e-5);
        assert!((one.fatigue - 13.31221).abs() < 1e-5);
        assert!((one.form - (one.fitness - one.fatigue)).abs() < 1e-10);
        let pair = super::activity_load_impact(Some(200.0), "Ride", (42, 7)).unwrap();
        assert!((pair.fitness - 2.0 * one.fitness).abs() < 1e-10);
        assert!((pair.fatigue - 2.0 * one.fatigue).abs() < 1e-10);
        assert!((pair.form - 2.0 * one.form).abs() < 1e-10);
        let zero = super::activity_load_impact(Some(0.0), "Ride", (42, 7)).unwrap();
        assert_eq!((zero.fitness, zero.fatigue, zero.form), (0.0, 0.0, 0.0));
        let large = super::activity_load_impact(Some(1e300), "Ride", (42, 7)).unwrap();
        assert!(large.fitness.is_finite() && large.fatigue.is_finite() && large.form.is_finite());
        assert!(super::activity_load_impact(None, "Ride", (42, 7)).is_none());
        assert_eq!((one.fitness_days, one.fatigue_days), (42, 7));
    }

    fn day(text: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    const SHORTER_DAYS: &str = r#"[{"category":"FITNESS_DAYS","start_date_local":"2026-01-01T00:00:00","ctl_days":28,"atl_days":5}]"#;

    #[test]
    fn activity_load_impact_uses_the_days_it_is_given() {
        let days = super::fitness_days_on(SHORTER_DAYS, day("2026-02-01"));
        let impact = super::activity_load_impact(Some(100.0), "Ride", days).unwrap();
        assert!((impact.fitness - 3.50841).abs() < 1e-5);
        assert!((impact.fatigue - 18.12692).abs() < 1e-5);
        assert!((impact.form - (impact.fitness - impact.fatigue)).abs() < 1e-10);
        assert_eq!((impact.fitness_days, impact.fatigue_days), (28, 5));
    }

    #[test]
    fn fitness_days_take_effect_on_the_event_date() {
        assert_eq!(
            super::fitness_days_on(SHORTER_DAYS, day("2025-12-31")),
            (42, 7)
        );
        assert_eq!(
            super::fitness_days_on(SHORTER_DAYS, day("2026-01-01")),
            (28, 5)
        );
    }

    #[test]
    fn the_latest_fitness_days_event_wins_and_other_categories_change_nothing() {
        let events = r#"[
            {"category":"FITNESS_DAYS","start_date_local":"2026-01-01T00:00:00","ctl_days":28,"atl_days":5},
            {"category":"SET_FITNESS","start_date_local":"2026-02-01T00:00:00","ctl_days":60,"atl_days":14},
            {"category":"FITNESS_DAYS","start_date_local":"2026-03-01T00:00:00","ctl_days":35,"atl_days":10}
        ]"#;
        assert_eq!(super::fitness_days_on(events, day("2026-02-15")), (28, 5));
        assert_eq!(super::fitness_days_on(events, day("2026-02-28")), (28, 5));
        assert_eq!(super::fitness_days_on(events, day("2026-03-01")), (35, 10));
        assert_eq!(super::fitness_days_on(events, day("2027-01-01")), (35, 10));
    }

    #[test]
    fn fitness_days_fall_back_to_the_defaults() {
        assert_eq!(super::fitness_days_on("[]", day("2026-02-01")), (42, 7));
        assert_eq!(
            super::fitness_days_on("not json", day("2026-02-01")),
            (42, 7)
        );
        assert_eq!(super::fitness_days_on("", day("2026-02-01")), (42, 7));
        let partial = r#"[{"category":"FITNESS_DAYS","start_date_local":"2026-01-01T00:00:00","ctl_days":0}]"#;
        assert_eq!(super::fitness_days_on(partial, day("2026-02-01")), (42, 7));
        let fatigue_only = r#"[{"category":"FITNESS_DAYS","start_date_local":"2026-01-01T00:00:00","atl_days":4}]"#;
        assert_eq!(
            super::fitness_days_on(fatigue_only, day("2026-02-01")),
            (42, 4)
        );
    }

    /// Scenario: the floor is a parameter, and the change is rounded to a
    /// whole bpm before it is compared.
    ///
    /// Expected behaviour: a change that rounds below the floor is dropped in
    /// either direction, and raising the floor drops what the old one kept.
    #[test]
    fn hr_change_floor_follows_the_parameter() {
        assert!(!hr_change_clears_floor(0.4, 1));
        assert!(!hr_change_clears_floor(-0.4, 1));
        assert!(hr_change_clears_floor(0.5, 1));
        assert!(hr_change_clears_floor(-1.4, 1));
        assert!(!hr_change_clears_floor(-2.4, 3));
        assert!(hr_change_clears_floor(-3.0, 3));
        assert!(hr_change_clears_floor(0.0, 0));
    }

    use super::*;

    /// Scenario: the live recording tile named a zone from fixed bands of 190,
    /// while the saved activity used the athlete's own zones.
    ///
    /// Expected behaviour: the zone comes from the `hr_zones` of the sport
    /// setting for the recording's type, Z1 starting at 0, and from percentage
    /// bands of that setting's max HR when it lists no zones.
    mod live_hr_zone {
        use super::*;

        const RIDE_ZONES: &str =
            r#"[{"types":["Ride","VirtualRide"],"max_hr":200,"hr_zones":[140,155,170,185,200]}]"#;
        const RIDE_MAX_ONLY: &str = r#"[{"types":["Ride"],"max_hr":175}]"#;

        #[test]
        fn names_the_zone_from_the_sports_own_bpm_bounds() {
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 150.0), Some(2));
            assert_eq!(
                hr_zone_number(Some(RIDE_ZONES), "VirtualRide", 90.0),
                Some(1)
            );
        }

        #[test]
        fn a_bound_belongs_to_the_zone_above_it() {
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 139.0), Some(1));
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 140.0), Some(2));
        }

        #[test]
        fn at_or_above_the_top_bound_is_the_top_zone() {
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 200.0), Some(5));
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 230.0), Some(5));
        }

        #[test]
        fn no_reading_has_no_zone() {
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", 0.0), None);
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", -3.0), None);
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Ride", f64::NAN), None);
        }

        #[test]
        fn falls_back_to_percentage_bands_of_the_sports_max_hr() {
            assert_eq!(hr_zone_number(Some(RIDE_MAX_ONLY), "Ride", 165.0), Some(5));
            assert_eq!(hr_zone_number(Some(RIDE_MAX_ONLY), "Ride", 120.0), Some(2));
            assert_eq!(hr_zone_number(Some(RIDE_MAX_ONLY), "Ride", 50.0), Some(1));
        }

        #[test]
        fn falls_back_to_the_default_max_hr_for_a_sport_with_no_setting() {
            assert_eq!(hr_zone_number(Some(RIDE_ZONES), "Run", 150.0), Some(3));
            assert_eq!(hr_zone_number(None, "Ride", 150.0), Some(3));
            assert_eq!(hr_zone_number(Some("{"), "Ride", 150.0), Some(3));
        }

        #[test]
        fn zones_that_are_not_bpm_numbers_are_skipped() {
            let objects = r#"[{"types":["Ride"],"max_hr":175,"hr_zones":[{"max":140}]}]"#;
            assert_eq!(hr_zone_number(Some(objects), "Ride", 165.0), Some(5));
        }
    }

    /// Scenario: the saved activity chart bucketed its own stream against bands
    /// it built itself, apart from the classifier live recording uses.
    ///
    /// Expected behaviour: the bands and the time in each come from the same
    /// bounds as `hr_zone_number`, with the activity's own zones first.
    mod saved_hr_zones {
        use super::*;

        const SETTINGS: &str =
            r#"[{"types":["Ride"],"max_hr":200,"hr_zones":[140,155,170,185,200]}]"#;
        const RIDE: &str = r#"{"type":"Ride"}"#;

        #[test]
        fn test_activity_hr_zones_from_undecodable_times_logs_and_returns_empty() {
            crate::test_log::capturing();
            let mut engine = crate::persistence::PersistentEngine::in_memory().unwrap();
            engine
                .upsert_activity_bodies(&[("garbled-zones".into(), 1_700_000_000, RIDE.into())])
                .unwrap();
            engine.set_sport_settings(SETTINGS).unwrap();
            engine
                .db
                .execute_batch(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES ('garbled-zones', 'Ride', 0, 0, 0, 0, 1700000000);
                     INSERT INTO gps_tracks (activity_id, track_data, point_count)
                     VALUES ('garbled-zones', x'00', 4);",
                )
                .unwrap();
            engine
                .store_time_stream("garbled-zones", &[0, 1, 2, 3])
                .unwrap();
            engine
                .store_activity_streams(
                    "garbled-zones",
                    &[crate::net::types::StreamDto {
                        kind: "heartrate".into(),
                        data: vec![Some(90.0), Some(90.0), Some(150.0), Some(150.0)],
                        data2: None,
                    }],
                )
                .unwrap();

            assert!(!activity_hr_zones_from(&engine.db, "garbled-zones").is_empty());
            engine
                .db
                .execute(
                    "UPDATE time_streams SET times = x'ff' WHERE activity_id = 'garbled-zones'",
                    [],
                )
                .unwrap();

            assert!(activity_hr_zones_from(&engine.db, "garbled-zones").is_empty());
            assert_eq!(
                crate::test_log::errors_with("time_streams garbled-zones").len(),
                1
            );
        }

        fn zones(
            body: &str,
            settings: Option<&str>,
            hr: &[Option<f64>],
            times: &[u32],
        ) -> Option<Vec<crate::FfiHrZoneBand>> {
            activity_hr_zones(Some(body), settings, Some(hr), Some(times))
        }

        #[test]
        fn saved_and_live_name_the_same_zone_for_the_same_bounds() {
            let bands = zones(
                RIDE,
                Some(SETTINGS),
                &[None, Some(150.0), Some(90.0)],
                &[0, 1, 2],
            )
            .expect("zones");
            assert_eq!(hr_zone_number(Some(SETTINGS), "Ride", 150.0), Some(2));
            assert_eq!(hr_zone_number(Some(SETTINGS), "Ride", 90.0), Some(1));
            assert_eq!(bands.len(), 5);
            assert_eq!((bands[0].min_bpm, bands[0].max_bpm), (0, 140));
            assert_eq!((bands[1].min_bpm, bands[1].max_bpm), (140, 155));
            assert_eq!(bands[0].seconds, 1.0);
            assert_eq!(bands[1].seconds, 1.0);
            assert_eq!(bands[0].percent, 50.0);
            assert_eq!(bands[4].seconds, 0.0);
        }

        #[test]
        fn the_activitys_own_zones_come_before_the_sport_settings() {
            let body = r#"{"type":"Ride","icu_hr_zones":[120,140,160,180,196]}"#;
            let bands =
                zones(body, Some(SETTINGS), &[Some(10.0), Some(130.0)], &[0, 5]).expect("zones");
            assert_eq!(bands[4].max_bpm, 196);
            assert_eq!(bands[1].seconds, 5.0);
        }

        #[test]
        fn percentage_bands_of_the_resolved_max_hr_when_no_zones_are_listed() {
            let settings = r#"[{"types":["Ride"],"max_hr":175}]"#;
            let bands =
                zones(RIDE, Some(settings), &[Some(100.0), Some(120.0)], &[0, 4]).expect("zones");
            assert_eq!(bands[4].max_bpm, 175);
            assert_eq!(bands[1].seconds, 4.0);
        }

        #[test]
        fn the_activitys_zone_times_are_used_without_a_stream() {
            let body = r#"{"type":"Ride","icu_hr_zone_times":[60,30,0,0,0]}"#;
            let bands = activity_hr_zones(Some(body), Some(SETTINGS), None, None).expect("zones");
            assert_eq!(bands[0].seconds, 60.0);
            assert!((bands[1].percent - 100.0 / 3.0).abs() < 1e-9);
            let shares: Vec<u32> = bands.iter().map(|b| b.share).collect();
            assert_eq!(shares, vec![67, 33, 0, 0, 0]);
        }

        #[test]
        fn heart_rate_shares_total_one_hundred_where_each_rounded_alone_would_not() {
            let body = r#"{"type":"Ride","icu_hr_zone_times":[60,60,60,0,0]}"#;
            let bands = activity_hr_zones(Some(body), Some(SETTINGS), None, None).expect("zones");
            let shares: Vec<u32> = bands.iter().map(|b| b.share).collect();
            assert_eq!(shares, vec![34, 33, 33, 0, 0]);
        }

        #[test]
        fn pauses_and_gaps_in_the_stream_are_not_zone_time() {
            let bands = zones(
                RIDE,
                Some(SETTINGS),
                &[Some(150.0), Some(150.0), Some(150.0), Some(150.0)],
                &[0, 2, 2, 100],
            )
            .expect("zones");
            assert_eq!(bands[1].seconds, 2.0);
        }

        #[test]
        fn nothing_to_show_is_none() {
            assert!(zones(RIDE, Some(SETTINGS), &[Some(150.0)], &[0]).is_none());
            assert!(zones(RIDE, Some(SETTINGS), &[None, None], &[0, 1]).is_none());
            assert!(activity_hr_zones(Some(RIDE), Some(SETTINGS), None, None).is_none());
        }

        #[test]
        fn the_stored_heart_rate_and_time_streams_are_bucketed() {
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, RIDE.into())])
                .expect("body");
            engine.set_sport_settings(SETTINGS).expect("sport settings");
            engine
                .db
                .execute_batch(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES ('a1', 'Ride', 0, 0, 0, 0, 1700000000);
                     INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES ('a1', X'00', 4);",
                )
                .expect("track");
            engine
                .store_time_stream("a1", &[0, 1, 2, 3])
                .expect("times");
            engine
                .store_activity_streams(
                    "a1",
                    &[crate::net::types::StreamDto {
                        kind: "heartrate".into(),
                        data: vec![Some(90.0), Some(90.0), Some(150.0), Some(150.0)],
                        data2: None,
                    }],
                )
                .expect("heartrate");

            let bands = pooled::activity_detail_data(&engine.db, "a1", 1).hr_zones;
            assert_eq!(bands[0].seconds, 1.0);
            assert_eq!(bands[1].seconds, 2.0);
        }

        #[test]
        fn the_detail_read_carries_the_stored_zones() {
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, RIDE.into())])
                .expect("body");
            engine.set_sport_settings(SETTINGS).expect("sport settings");
            let body = r#"{"type":"Ride","icu_hr_zone_times":[10,20,0,0,0]}"#;
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, body.into())])
                .expect("detail body");

            let zones = pooled::activity_detail_data(&engine.db, "a1", 1).hr_zones;
            assert_eq!(zones.len(), 5);
            assert_eq!(zones[1].seconds, 20.0);
            assert!(
                pooled::activity_detail_data(&engine.db, "unknown", 1)
                    .hr_zones
                    .is_empty()
            );
        }
    }

    /// Scenario: intervals.icu sends `icu_power_zones` as percent of FTP with 999
    /// standing for the open top, and the chart printed those percentages as watts.
    ///
    /// Expected behaviour: each bound is converted with the activity's own FTP,
    /// the sentinel leaves the top zone open, and the time in each zone is read
    /// by its id so sweet spot never takes a slot.
    mod saved_power_zones {
        use super::*;

        const RIDE: &str = r#"{"type":"Ride","icu_ftp":155,
            "icu_power_zones":[55,75,90,105,120,150,999],
            "icu_zone_times":[{"id":"Z1","secs":600},{"id":"Z2","secs":300},
              {"id":"Z3","secs":0},{"id":"Z4","secs":0},{"id":"Z5","secs":0},
              {"id":"Z6","secs":0},{"id":"Z7","secs":100},{"id":"SS","secs":450}]}"#;

        #[test]
        fn percent_of_ftp_bounds_become_watts_with_an_open_top() {
            let bands = activity_power_zones(Some(RIDE)).expect("zones");
            assert_eq!(bands.len(), 7);
            assert_eq!(
                (bands[0].zone, bands[0].min_watts, bands[0].max_watts),
                (1, 0, Some(85))
            );
            assert_eq!(
                (bands[1].zone, bands[1].min_watts, bands[1].max_watts),
                (2, 85, Some(116))
            );
            assert_eq!((bands[5].min_watts, bands[5].max_watts), (186, Some(233)));
            assert_eq!(
                (bands[6].zone, bands[6].min_watts, bands[6].max_watts),
                (7, 233, None)
            );
        }

        #[test]
        fn time_is_placed_by_zone_id_and_sweet_spot_is_left_out() {
            let bands = activity_power_zones(Some(RIDE)).expect("zones");
            assert_eq!(bands[0].seconds, 600.0);
            assert_eq!(bands[1].seconds, 300.0);
            assert_eq!(bands[6].seconds, 100.0);
            assert_eq!(bands[0].percent, 60.0);
            assert_eq!(bands.iter().map(|b| b.percent).sum::<f64>(), 100.0);
            assert_eq!(bands.iter().map(|b| b.share).sum::<u32>(), 100);
        }

        #[test]
        fn bounds_without_the_sentinel_still_end_in_an_open_zone() {
            let body = r#"{"type":"Ride","icu_ftp":200,"icu_power_zones":[55,75,90,105,120,150],
                "icu_zone_times":[{"id":"Z1","secs":10},{"id":"Z7","secs":10}]}"#;
            let bands = activity_power_zones(Some(body)).expect("zones");
            assert_eq!(bands.len(), 7);
            assert_eq!((bands[6].min_watts, bands[6].max_watts), (300, None));
            assert_eq!(bands[6].seconds, 10.0);
        }

        #[test]
        fn nothing_to_show_is_none() {
            let no_time = r#"{"icu_ftp":155,"icu_power_zones":[55,75,999],
                "icu_zone_times":[{"id":"Z1","secs":0}]}"#;
            let no_ftp =
                r#"{"icu_power_zones":[55,75,999],"icu_zone_times":[{"id":"Z1","secs":5}]}"#;
            let zero_ftp = r#"{"icu_ftp":0,"icu_power_zones":[55,75,999],
                "icu_zone_times":[{"id":"Z1","secs":5}]}"#;
            let no_zones = r#"{"icu_ftp":155,"icu_zone_times":[{"id":"Z1","secs":5}]}"#;
            let bad_bound = r#"{"icu_ftp":155,"icu_power_zones":[55,0,999],
                "icu_zone_times":[{"id":"Z1","secs":5}]}"#;
            for body in [no_time, no_ftp, zero_ftp, no_zones, bad_bound, "not json"] {
                assert!(activity_power_zones(Some(body)).is_none(), "{body}");
            }
            assert!(activity_power_zones(None).is_none());
        }

        #[test]
        fn the_detail_read_carries_the_power_zones() {
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, RIDE.into())])
                .expect("body");

            let zones = pooled::activity_detail_data(&engine.db, "a1", 1).power_zones;
            assert_eq!(zones.len(), 7);
            assert_eq!(zones[1].max_watts, Some(116));
            assert!(
                pooled::activity_detail_data(&engine.db, "unknown", 1)
                    .power_zones
                    .is_empty()
            );
        }
    }

    /// Expected behaviour: the detail read carries the summary intervals.icu
    /// stored with the activity, so the stat cards show it with no streams. A
    /// zero or a missing field is no value rather than a zero to print.
    mod activity_summary {
        use super::*;

        #[test]
        fn the_detail_read_carries_the_stored_summary() {
            let body = r#"{"type":"Ride","moving_time":3600,"elapsed_time":3720,
                "average_speed":8.2,"max_speed":15.4,"average_cadence":88.5}"#;
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, body.into())])
                .expect("body");

            let summary = pooled::activity_detail_data(&engine.db, "a1", 1).summary;
            assert_eq!(summary.moving_time, Some(3600.0));
            assert_eq!(summary.elapsed_time, Some(3720.0));
            assert_eq!(summary.average_speed, Some(8.2));
            assert_eq!(summary.max_speed, Some(15.4));
            assert_eq!(summary.average_cadence, Some(88.5));
            assert_eq!(summary.cadence_unit, crate::FfiCadenceUnit::Rpm);
        }

        #[test]
        fn a_run_carries_its_strides_as_steps() {
            let body = r#"{"type":"Run","moving_time":5800,"average_cadence":66}"#;
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("r1".into(), 1_700_000_000, body.into())])
                .expect("body");

            let summary = pooled::activity_detail_data(&engine.db, "r1", 1).summary;
            assert_eq!(summary.average_cadence, Some(132.0));
            assert_eq!(summary.cadence_unit, crate::FfiCadenceUnit::StepsPerMinute);
        }

        #[test]
        fn a_zero_or_missing_field_is_no_value() {
            let body = r#"{"type":"WeightTraining","moving_time":1800,"elapsed_time":0,
                "average_speed":0,"max_speed":null}"#;
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, body.into())])
                .expect("body");

            let summary = pooled::activity_detail_data(&engine.db, "a1", 1).summary;
            assert_eq!(summary.moving_time, Some(1800.0));
            assert_eq!(summary.elapsed_time, None);
            assert_eq!(summary.average_speed, None);
            assert_eq!(summary.max_speed, None);
            assert_eq!(summary.average_cadence, None);

            let unknown = pooled::activity_detail_data(&engine.db, "unknown", 1).summary;
            assert_eq!(unknown.moving_time, None);
            assert_eq!(unknown.average_speed, None);
        }
    }

    /// Scenario: the heart rate stat card and the zones chart on the activity
    /// screen divide by one max HR, and TypeScript resolved it from three engine
    /// reads. The screen read answers it now, with the same precedence, and says
    /// which source answered so a default is never shown as the athlete's own.
    ///
    /// Expected behaviour: the top of the activity's own zones, then the sport
    /// setting for the activity's type, then 190 marked as the default. A value
    /// an older install left in the retired local zones setting is not read.
    mod activity_max_hr {
        use super::*;
        use crate::FfiMaxHrSource as Source;

        const RIDE: &str = r#"{"id":"a1","type":"Ride"}"#;
        const ZONED_RIDE: &str = r#"{"id":"a1","type":"Ride","icu_hr_zones":[130,150,170,196]}"#;
        const RIDE_185: &str = r#"[{"types":["Ride","VirtualRide"],"max_hr":185}]"#;
        const RIDE_175: &str = r#"[{"types":["Ride"],"max_hr":175}]"#;
        const RUN_185: &str = r#"[{"types":["Run"],"max_hr":185}]"#;
        const LOCAL_180: &str =
            r#"{"maxHR":180,"zones":[{"id":1,"name":"Recovery","min":0.5,"max":0.6,"color":"x"}]}"#;

        #[test]
        fn takes_the_top_of_the_activitys_own_zones_first() {
            assert_eq!(
                resolve_max_hr(Some(ZONED_RIDE), Some(RIDE_185)),
                (196.0, Source::ActivityZones)
            );
        }

        #[test]
        fn takes_the_sport_setting_for_an_activity_with_no_zones() {
            assert_eq!(
                resolve_max_hr(Some(RIDE), Some(RIDE_175)),
                (175.0, Source::SportSettings)
            );
            let empty = r#"{"type":"Ride","icu_hr_zones":[]}"#;
            assert_eq!(
                resolve_max_hr(Some(empty), Some(RIDE_185)),
                (185.0, Source::SportSettings)
            );
            let zero_top = r#"{"type":"Ride","icu_hr_zones":[130,150,0]}"#;
            assert_eq!(
                resolve_max_hr(Some(zero_top), Some(RIDE_185)),
                (185.0, Source::SportSettings)
            );
        }

        #[test]
        fn ignores_another_sports_setting_and_an_unset_one() {
            assert_eq!(
                resolve_max_hr(Some(RIDE), Some(RUN_185)),
                (DEFAULT_MAX_HR, Source::Default)
            );
            let unset = r#"[{"types":["Ride"],"max_hr":null}]"#;
            assert_eq!(
                resolve_max_hr(Some(RIDE), Some(unset)),
                (DEFAULT_MAX_HR, Source::Default)
            );
        }

        #[test]
        fn takes_the_default_with_nothing_else() {
            assert_eq!(
                resolve_max_hr(Some(RIDE), None),
                (DEFAULT_MAX_HR, Source::Default)
            );
            assert_eq!(
                resolve_max_hr(None, None),
                (DEFAULT_MAX_HR, Source::Default)
            );
            assert_eq!(DEFAULT_MAX_HR, 190.0);
        }

        #[test]
        fn garbage_sources_fall_through_rather_than_fail() {
            assert_eq!(
                resolve_max_hr(Some("{"), Some("{")),
                (DEFAULT_MAX_HR, Source::Default)
            );
            let wrong_shape = r#"{"type":"Ride","icu_hr_zones":"many"}"#;
            assert_eq!(
                resolve_max_hr(Some(wrong_shape), Some(RIDE_185)),
                (185.0, Source::SportSettings)
            );
        }

        /// The screen read carries the stored maximum heart rate and its source.
        #[test]
        fn the_detail_read_carries_the_maximum_heart_rate_and_its_source() {
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, RIDE.into())])
                .expect("body");

            let bare = pooled::activity_detail_data(&engine.db, "a1", 1);
            assert_eq!(
                (bare.max_hr, bare.max_hr_source),
                (DEFAULT_MAX_HR, Source::Default)
            );

            engine.set_sport_settings(RIDE_185).expect("sport settings");
            engine
                .set_setting("veloq-hr-zones", LOCAL_180)
                .expect("local");

            let set = pooled::activity_detail_data(&engine.db, "a1", 1);
            assert_eq!(
                (set.max_hr, set.max_hr_source),
                (185.0, Source::SportSettings)
            );

            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, ZONED_RIDE.into())])
                .expect("detail body");
            let zoned = pooled::activity_detail_data(&engine.db, "a1", 1);
            assert_eq!(
                (zoned.max_hr, zoned.max_hr_source),
                (196.0, Source::ActivityZones)
            );

            let unknown = pooled::activity_detail_data(&engine.db, "unknown", 1);
            assert_eq!(
                (unknown.max_hr, unknown.max_hr_source),
                (DEFAULT_MAX_HR, Source::Default)
            );
        }
    }

    /// Scenario: an insight card draws a graphic of its own history, and the
    /// engine read carried a series for two of eight generators. The points a
    /// card needs are already held wherever the generator computed its
    /// summary: a section's laps, a trend's daily estimates.
    ///
    /// Expected behaviour: the tail of them, oldest first, capped, with
    /// anything undrawable left out rather than carried into a path.
    mod series_tail {
        use super::*;

        fn values(points: &[crate::FfiSeriesPoint]) -> Vec<f64> {
            points.iter().map(|p| p.value).collect()
        }

        #[test]
        fn takes_the_newest_points_and_keeps_them_oldest_first() {
            let got = series_tail(
                [(1.0, 10.0), (2.0, 20.0), (3.0, 30.0), (4.0, 40.0)],
                3,
                |p| p,
            );

            assert_eq!(values(&got), vec![2.0, 3.0, 4.0]);
            assert_eq!(got[0].date, 20.0);
        }

        #[test]
        fn keeps_everything_when_there_is_less_than_the_cap() {
            let got = series_tail([(1.0, 10.0), (2.0, 20.0)], 10, |p| p);

            assert_eq!(values(&got), vec![1.0, 2.0]);
        }

        #[test]
        fn leaves_out_a_point_that_cannot_be_drawn() {
            let got = series_tail(
                [
                    (1.0, 10.0),
                    (f64::NAN, 20.0),
                    (3.0, f64::INFINITY),
                    (4.0, 40.0),
                ],
                10,
                |p| p,
            );

            assert_eq!(values(&got), vec![1.0, 4.0]);
        }

        /// The cap is applied after the undrawable ones are dropped, so a
        /// series holding a NaN still fills the strip.
        #[test]
        fn caps_what_is_left_rather_than_what_arrived() {
            let got = series_tail(
                [(1.0, 10.0), (f64::NAN, 20.0), (3.0, 30.0), (4.0, 40.0)],
                2,
                |p| p,
            );

            assert_eq!(values(&got), vec![3.0, 4.0]);
        }

        #[test]
        fn a_cap_of_nothing_carries_nothing() {
            assert!(series_tail([(1.0, 10.0)], 0, |p| p).is_empty());
        }

        #[test]
        fn an_empty_series_is_empty_rather_than_a_point_of_zeroes() {
            let none: [(f64, f64); 0] = [];
            assert!(series_tail(none, 5, |p| p).is_empty());
        }
    }

    /// A section with two traversals, written the way the detector writes one.
    /// Enough for the performance bundle: a distance, a lap time per activity
    /// and metrics rows to name them by.
    fn engine_with_a_traversed_section(path: &str) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        for (id, date) in [("a1", 1_700_000_000i64), ("a2", 1_700_086_400)] {
            engine
                .add_activity(id.into(), track(60), "Ride".into())
                .expect("add");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id.into(),
                    name: format!("Fixture {id}"),
                    date,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
        }
        let polyline = serde_json::to_string(&track(30)).expect("polyline");
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, source_activity_id)
                 VALUES ('auto1', 'auto', 'Auto Climb', 'Ride', ?1, 800.0, 0, 1, NULL)",
                rusqlite::params![polyline],
            )
            .expect("section");
        for (activity_id, lap_time) in [("a1", 200.0f64), ("a2", 240.0)] {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                         start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                     VALUES ('auto1', ?1, 'same', 0, 40, 800.0, ?2, ?3, 0)",
                    rusqlite::params![activity_id, lap_time, 800.0 / lap_time],
                )
                .expect("traversal");
        }
        engine
    }

    /// The traversed section with a third, fastest outing inside the week, so
    /// the section has the outings a recent record needs.
    fn engine_with_a_recent_section_record(path: &str) -> crate::persistence::PersistentEngine {
        let mut engine = engine_with_a_traversed_section(path);
        engine
            .add_activity("a3".into(), track(60), "Ride".into())
            .expect("add");
        engine
            .set_activity_metrics(vec![crate::types::ActivityMetrics {
                activity_id: "a3".into(),
                name: "Fixture a3".into(),
                date: 1_700_172_800,
                distance: 1000.0,
                moving_time: 300,
                elapsed_time: 300,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("metrics");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('auto1', 'a3', 'same', 0, 40, 800.0, 180.0, ?1, 0)",
                rusqlite::params![800.0 / 180.0],
            )
            .expect("traversal");
        engine
    }

    fn pooled_insights_data(
        engine: &crate::persistence::PersistentEngine,
        params: &crate::FfiInsightsParams,
    ) -> crate::FfiInsightsData {
        crate::persistence::read_pool::bind(&engine.db_path);
        let data = crate::persistence::read_pool::with_read_conn(|conn| {
            pooled::insights_data(conn, params)
        })
        .expect("pooled insights");
        crate::persistence::read_pool::close();
        data
    }

    #[test]
    fn test_insights_recent_section_record_reaches_the_screen() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("recent_insights.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        let params = coverage_params();
        let bundle = pooled_insights_data(&engine, &params);
        assert_eq!(bundle.recent_prs.len(), 1);
        assert_eq!(bundle.recent_prs[0].best_time, 180.0);
        assert_eq!(bundle.recent_prs[0].standing_count, 3);
        assert_eq!(bundle.recent_prs[0].percentile_faster, Some(100));
        assert_eq!(bundle.recent_prs[0].previous_best_time, Some(200.0));
        assert_eq!(bundle.recent_prs[0].delta_seconds, Some(20.0));
    }

    /// Three Run outings on the fixture section, the newest the fastest and
    /// newer than the ride record.
    fn add_run_outings(engine: &mut crate::persistence::PersistentEngine) {
        for (id, date, lap_time) in [
            ("r1", 1_700_100_000i64, 420.0f64),
            ("r2", 1_700_150_000, 400.0),
            ("r3", 1_700_190_000, 380.0),
        ] {
            engine
                .add_activity(id.into(), track(60), "Run".into())
                .expect("add");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id.into(),
                    name: format!("Fixture {id}"),
                    date,
                    distance: 1000.0,
                    moving_time: 400,
                    elapsed_time: 400,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Run".into(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                         start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                     VALUES ('auto1', ?1, 'same', 0, 40, 800.0, ?2, ?3, 0)",
                    rusqlite::params![id, lap_time, 800.0 / lap_time],
                )
                .expect("traversal");
        }
    }

    #[test]
    fn test_insights_recent_section_record_keeps_one_row_per_sport() {
        let _serial = crate::test_globals::serial_global_state();
        crate::persistence::read_cache::clear();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("two_sport_insights.db");
        let mut engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        add_run_outings(&mut engine);
        let params = coverage_params();
        let bundle = pooled_insights_data(&engine, &params);
        let mut rows: Vec<_> = bundle
            .recent_prs
            .iter()
            .map(|pr| (pr.sport_type.clone(), pr.best_time, pr.traversal_count))
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(rows.len(), 2, "one row per sport: {rows:?}");
        assert_eq!(rows[0].0, "Ride");
        assert_eq!(rows[0].1, 180.0);
        assert_eq!(rows[1].0, "Run");
        assert_eq!(rows[1].1, 380.0);
        let lines: Vec<_> = bundle
            .recent_prs
            .iter()
            .map(|pr| pr.encoded_polyline.clone())
            .collect();
        assert!(!lines[0].is_empty(), "first row keeps its preview");
        assert_eq!(lines[0], lines[1], "both rows draw the section's line");
        let ride = bundle.recent_prs.iter().find(|p| p.sport_type == "Ride");
        assert_eq!(ride.map(|p| p.recent_efforts.len()), Some(3));
        let run = bundle.recent_prs.iter().find(|p| p.sport_type == "Run");
        assert_eq!(run.map(|p| p.recent_efforts.len()), Some(3));
    }

    /// The fixture's newest record is 1_700_172_800, set on its third outing.
    fn params_a_fortnight_after_the_record() -> crate::FfiInsightsParams {
        let mut params = coverage_params();
        let then = 1_700_172_800i64 + 10 * 86_400;
        params.current_end = then as f64;
        params.current_start = (then - 7 * 86_400) as f64;
        params.prev_end = params.current_start;
        params.prev_start = (then - 14 * 86_400) as f64;
        params.chronic_start = (then - 35 * 86_400) as f64;
        params.today_start = (then - 86_400) as f64;
        params
    }

    #[test]
    fn test_insights_recent_record_window_and_outing_floor_follow_the_params() {
        // Scenario: a record set ten days ago on a section ridden three times.
        // Expected behaviour: the window and the floor decide whether it is returned.
        let _serial = crate::test_globals::serial_global_state();
        crate::persistence::read_cache::clear();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("recent_window.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        let mut params = params_a_fortnight_after_the_record();

        params.recent_pr_window_days = 7;
        assert!(pooled_insights_data(&engine, &params).recent_prs.is_empty());

        params.recent_pr_window_days = 14;
        assert_eq!(pooled_insights_data(&engine, &params).recent_prs.len(), 1);

        params.recent_pr_min_outings = 4;
        assert!(pooled_insights_data(&engine, &params).recent_prs.is_empty());
    }

    /// Scenario: the insights screen draws a swim pace card, and the summary card
    /// read was the only place it could take the swim trend from.
    ///
    /// Expected behaviour: the insights read carries the swim trend, equal to the
    /// one the summary card read gives for the same library.
    #[test]
    fn test_insights_carries_the_swim_pace_trend() {
        use crate::persistence::fitness::derivations::pooled::SYNC_PACE_WINDOW_DAYS;
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("swim_insights.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        engine.save_pace_snapshot(
            "Swim",
            1.0,
            None,
            None,
            1_700_000_000,
            SYNC_PACE_WINDOW_DAYS,
        );
        engine.save_pace_snapshot(
            "Swim",
            1.25,
            None,
            None,
            1_700_200_000,
            SYNC_PACE_WINDOW_DAYS,
        );
        let params = coverage_params();

        let data = pooled_insights_data(&engine, &params);

        crate::persistence::read_pool::bind(&engine.db_path);
        let card = crate::persistence::read_pool::with_read_conn(|conn| {
            pooled::summary_card(conn, 0, 1, 0, 1)
        })
        .expect("summary card");
        crate::persistence::read_pool::close();
        assert_eq!(data.swim_pace_trend.sample_count, 2);
        assert_eq!(data.swim_pace_trend.gain_percent, Some(25.0));
        assert_eq!(data.swim_pace_trend.delta_seconds, Some(20.0));
        assert_eq!(
            format!("{:?}", data.swim_pace_trend),
            format!("{:?}", card.swim_pace_trend)
        );
    }

    #[test]
    fn test_insights_ranks_sports_without_pattern_detection() {
        // Ranked sections carry every eligible sport without pattern detection.
        let _serial = crate::test_globals::serial_global_state();
        crate::persistence::read_cache::clear();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("patternless_sport.db");
        let mut engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        add_run_outings(&mut engine);
        let params = coverage_params();
        crate::persistence::read_pool::bind(&engine.db_path);
        let data = crate::persistence::read_pool::with_read_conn(|conn| {
            pooled::insights_data(conn, &params)
        })
        .expect("pooled insights");
        crate::persistence::read_pool::close();
        let run = data.ranked_sections.iter().find(|b| b.sport_type == "Run");
        assert!(
            run.is_some_and(|b| !b.sections.is_empty()),
            "Run sections are ranked from the available sports: {:?}",
            data.ranked_sections
                .iter()
                .map(|b| &b.sport_type)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_insights_read_skips_pattern_clustering() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("insights.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        let before = crate::patterns::pattern_computations();

        let data = pooled_insights_data(&engine, &coverage_params());

        assert!(!data.sport_types.is_empty());
        assert_eq!(crate::patterns::pattern_computations(), before);
    }

    #[test]
    fn test_insights_partial_laps_have_no_recent_record() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("partial_insights.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        engine
            .db
            .execute("UPDATE section_activities SET direction = 'partial'", [])
            .expect("partial traversals");
        let params = coverage_params();
        assert!(pooled_insights_data(&engine, &params).recent_prs.is_empty());
    }

    fn coverage_params() -> crate::FfiInsightsParams {
        let now = 1_700_200_000i64;
        crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: true,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_min_hr_change_bpm: 1,
            efficiency_limit: 2,
            efficiency_min_efforts: 1,
            efficiency_declining_min_efforts: 3,
            strength_month: crate::FfiTimestampRange {
                start_ts: (now - 28 * 86_400) as f64,
                end_ts: now as f64,
            },
            strength_weeks: vec![crate::FfiTimestampRange {
                start_ts: (now - 7 * 86_400) as f64,
                end_ts: now as f64,
            }],
            wellness_oldest: "2026-01-01".to_string(),
            wellness_newest: "2026-12-31".to_string(),
            hrv_window_days: 7,
            section_change_window_days: 14,
            stale_threshold_days: 30,
            stale_min_gain_percent: 3.0,
            stale_max_opportunities: 3,
            stale_min_traversals: 1,
            recent_pr_window_days: 7,
            recent_pr_min_outings: 3,
        }
    }

    fn coverage_engine(path: &str, empty: Option<usize>) -> crate::persistence::PersistentEngine {
        let p = coverage_params();
        let rides: Vec<_> = [
            (p.current_start, p.current_end),
            (p.prev_start, p.prev_end),
            (p.chronic_start, p.prev_start),
        ]
        .into_iter()
        .enumerate()
        .filter(|(i, _)| empty != Some(*i))
        .map(|(i, (from, to))| (format!("a{i}"), ((from + to) / 2.0) as i64, 100.0))
        .collect();
        insights_engine(path, &rides)
    }

    /// An engine whose census and synced bodies cover each ride, so every
    /// insights window holding one reads as complete.
    fn insights_engine(
        path: &str,
        rides: &[(String, i64, f64)],
    ) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        engine.set_setting("__athlete_id", "i1").expect("athlete");
        let mut census = Vec::new();
        let mut bodies = Vec::new();
        for (id, date, load) in rides {
            let local = chrono::DateTime::from_timestamp(*date, 0)
                .expect("date")
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            census.push(crate::net::types::ActivityCensusEntry {
                id: id.clone(),
                start_date_local: Some(local),
                created: None,
                icu_sync_date: Some("v1".into()),
                has_latlng: false,
                has_series: false,
            });
            bodies.push((id.clone(), *date, "{}".into()));
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id.clone(),
                    name: "Ride".into(),
                    date: *date,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: Some(*load),
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
        }
        engine
            .record_activity_census("i1", &census)
            .expect("census");
        let ids: Vec<_> = census.iter().map(|entry| entry.id.clone()).collect();
        let metrics: Vec<_> = ids
            .iter()
            .map(|id| engine.activity_metrics.get(id).expect("metrics").clone())
            .collect();
        engine
            .store_synced_activity_bodies("i1", &bodies, &ids, metrics)
            .expect("bodies");
        engine
    }

    #[test]
    fn test_insights_need_the_current_athletes_census() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let engine = coverage_engine(dir.path().join("insights.db").to_str().unwrap(), None);
        let p = coverage_params();
        for athlete in ["", "another-athlete"] {
            engine
                .set_setting("__athlete_id", athlete)
                .expect("athlete");
            let data = pooled_insights_data(&engine, &p);
            assert!(data.week_over_week.is_none());
            assert!(data.week_against_chronic.is_none());
        }
    }

    // Each missing row leaves plausible nonzero totals behind, so only the
    // census can say the denominator or numerator is still incomplete.
    #[test]
    fn test_insights_wait_for_each_required_window() {
        let _serial = crate::test_globals::serial_global_state();
        for missing in 0..3 {
            let dir = tempfile::TempDir::new().expect("directory");
            let mut engine =
                coverage_engine(dir.path().join("insights.db").to_str().unwrap(), None);
            let p = coverage_params();
            let range = [
                (p.current_start, p.current_end),
                (p.prev_start, p.prev_end),
                (p.chronic_start, p.prev_start),
            ][missing];
            let date = ((range.0 + range.1) / 2.0) as i64;
            let local = chrono::DateTime::from_timestamp(date, 0)
                .unwrap()
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            engine.db.execute("INSERT INTO activity_census (athlete_id, intervals_id, start_date_local, icu_sync_date) VALUES ('i1', 'owed', ?1, 'v1')", rusqlite::params![local]).expect("owed row");
            let data = pooled_insights_data(&engine, &p);
            assert_eq!(
                data.week_over_week.is_some(),
                missing == 2,
                "window {missing}"
            );
            assert!(data.week_against_chronic.is_none(), "window {missing}");
            engine
                .store_synced_activity_bodies(
                    "i1",
                    &[("owed".into(), date, "{}".into())],
                    &["owed".into()],
                    vec![crate::ActivityMetrics {
                        activity_id: "owed".into(),
                        date,
                        ..Default::default()
                    }],
                )
                .expect("body");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: "owed".into(),
                    name: "Downloaded ride".into(),
                    date,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: Some(100.0),
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("downloaded metrics");
            let data = pooled_insights_data(&engine, &p);
            let weekly = data.week_over_week.expect("complete weeks");
            let chronic = data.week_against_chronic.expect("complete chronic window");
            assert_eq!(weekly.ratio, [1.0, -0.5, 0.0][missing]);
            assert_eq!(chronic.ratio, [3.0, 7.0, 1.0][missing]);
        }
    }

    #[test]
    fn test_insights_preserve_confirmed_empty_windows() {
        let _serial = crate::test_globals::serial_global_state();
        for empty in 0..3 {
            let dir = tempfile::TempDir::new().expect("directory");
            let engine = coverage_engine(
                dir.path().join("insights.db").to_str().unwrap(),
                Some(empty),
            );
            let p = coverage_params();
            let data = pooled_insights_data(&engine, &p);
            assert_eq!(data.week_over_week.is_some(), empty == 2);
            assert_eq!(data.week_against_chronic.is_some(), empty == 0);
        }
    }

    #[test]
    fn test_insights_rest_day_compares_the_whole_previous_week() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        let engine = coverage_engine(dir.path().join("insights.db").to_str().unwrap(), Some(0));
        engine
            .db
            .execute(
                "UPDATE activity_metrics SET training_load = CASE activity_id \
                 WHEN 'a1' THEN 400 WHEN 'a2' THEN 1600 ELSE training_load END",
                [],
            )
            .expect("period loads");
        let mut p = coverage_params();
        p.prev_end = p.prev_start + 3.0 * 3_600.0;

        let data = pooled_insights_data(&engine, &p);
        let comparison = data.week_against_chronic.expect("rest day comparison");
        let last_week = data.weekly_totals.last().expect("last week");

        assert_eq!(data.current_week.count, 0);
        assert_eq!(data.previous_week.total_tss, 400.0);
        assert_eq!(comparison.ratio, 0.0);
        assert_eq!(last_week.stats.total_tss, 400.0);
        assert_eq!(last_week.start, p.prev_start);
        assert!(!last_week.partial);
        assert_eq!(comparison.compared_start, last_week.start);
    }

    /// Scenario: on a Tuesday with a ride already this week, the card compares
    /// this week so far with the same point last week.
    ///
    /// Expected behaviour: the weekly bars still draw last week whole, and the
    /// running week is the last bar, flagged partial and dated where the
    /// comparison says it starts.
    #[test]
    fn test_insights_weekly_bars_draw_last_week_whole_and_this_week_so_far() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        // 2023-11-14 is a Tuesday.
        let tuesday_noon = 1_699_963_200i64;
        let (current_start, current_end, prev_start, prev_end) =
            crate::widget_snapshot::week_bounds(tuesday_noon);
        let hour = 3_600i64;
        let engine = insights_engine(
            dir.path().join("insights.db").to_str().unwrap(),
            &[
                ("monday".into(), prev_start + 10 * hour, 400.0),
                (
                    "friday".into(),
                    prev_start + 4 * 24 * hour + 10 * hour,
                    1600.0,
                ),
                ("this-monday".into(), current_start + 10 * hour, 300.0),
            ],
        );
        let p = crate::FfiInsightsParams {
            current_start: current_start as f64,
            current_end: current_end as f64,
            prev_start: prev_start as f64,
            prev_end: prev_end as f64,
            chronic_start: (prev_start - 28 * 24 * hour) as f64,
            ..coverage_params()
        };

        let data = pooled_insights_data(&engine, &p);
        let weekly = data.week_over_week.expect("week over week");
        let last_week = &data.weekly_totals[4];
        let this_week = data.weekly_totals.last().expect("this week");

        assert_eq!(data.weekly_totals.len(), 6);
        assert!(data.weekly_totals[..5].iter().all(|week| !week.partial));
        assert_eq!(last_week.start, p.prev_start);
        assert_eq!(last_week.stats.total_tss, 2000.0);
        assert_eq!(this_week.start, p.current_start);
        assert_eq!(this_week.stats.total_tss, 300.0);
        assert!(this_week.partial);
        assert_eq!(weekly.previous, 400.0);
        assert_eq!(weekly.current, 300.0);
        assert_eq!(weekly.compared_start, this_week.start);
    }

    /// Scenario: activities dated at exactly Monday 00:00:00, the second one
    /// week ends and the next begins.
    ///
    /// Expected behaviour: each one counts in exactly one weekly bar, the bars
    /// add up to the activities there are, and the chronic baseline holds none
    /// of last week.
    #[test]
    fn test_insights_boundary_second_activities_count_in_one_week() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("directory");
        // 2023-11-14 is a Tuesday.
        let tuesday_noon = 1_699_963_200i64;
        let (current_start, current_end, prev_start, prev_end) =
            crate::widget_snapshot::week_bounds(tuesday_noon);
        let day = 86_400i64;
        let chronic_start = prev_start - 28 * day;
        let engine = insights_engine(
            dir.path().join("insights.db").to_str().unwrap(),
            &[
                ("chronic-inner".into(), chronic_start + 7 * day, 100.0),
                ("last-monday".into(), prev_start, 200.0),
                ("this-monday".into(), current_start, 300.0),
            ],
        );
        let p = crate::FfiInsightsParams {
            current_start: current_start as f64,
            current_end: current_end as f64,
            prev_start: prev_start as f64,
            prev_end: prev_end as f64,
            chronic_start: chronic_start as f64,
            ..coverage_params()
        };

        let data = pooled_insights_data(&engine, &p);
        let counts: Vec<u32> = data.weekly_totals.iter().map(|w| w.stats.count).collect();
        let tss: Vec<f64> = data
            .weekly_totals
            .iter()
            .map(|w| w.stats.total_tss)
            .collect();

        assert_eq!(counts, vec![0, 1, 0, 0, 1, 1]);
        assert_eq!(tss, vec![0.0, 100.0, 0.0, 0.0, 200.0, 300.0]);
        assert_eq!(data.chronic_period.count, 1);
        assert_eq!(data.chronic_period.total_tss, 100.0);
        let chronic_bars: u32 = counts[..4].iter().sum();
        assert_eq!(chronic_bars, data.chronic_period.count);
        assert_eq!(data.previous_week.count, 1);
        assert_eq!(data.current_week.count, 1);
    }

    /// Scenario: the insights tab is opened twice with nothing changed between.
    ///
    /// Expected behaviour: the second read is served from the section
    /// performances the first one computed.
    #[test]
    fn the_second_pooled_insights_read_reuses_the_section_performances() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("insights_parity.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let mut engine = engine_with_a_traversed_section(db_path);
        engine
            .add_activity("a3".into(), track(60), "Ride".into())
            .expect("third outing");
        engine
            .set_activity_metrics(vec![crate::types::ActivityMetrics {
                activity_id: "a3".into(),
                name: "Fixture a3".into(),
                date: 1_700_150_000,
                distance: 1000.0,
                moving_time: 300,
                elapsed_time: 300,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("third metrics");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('auto1', 'a3', 'same', 0, 40, 800.0, 180.0, 800.0 / 180.0, 0)",
                [],
            )
            .expect("third traversal");

        let now = 1_700_200_000i64;
        let params = crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: true,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_min_hr_change_bpm: 1,
            efficiency_limit: 2,
            efficiency_min_efforts: 1,
            efficiency_declining_min_efforts: 3,
            strength_month: crate::FfiTimestampRange {
                start_ts: (now - 28 * 86_400) as f64,
                end_ts: now as f64,
            },
            strength_weeks: vec![crate::FfiTimestampRange {
                start_ts: (now - 7 * 86_400) as f64,
                end_ts: now as f64,
            }],
            wellness_oldest: "2026-01-01".to_string(),
            wellness_newest: "2026-12-31".to_string(),
            hrv_window_days: 7,
            section_change_window_days: 14,
            stale_threshold_days: 30,
            stale_min_gain_percent: 3.0,
            stale_max_opportunities: 3,
            stale_min_traversals: 1,
            recent_pr_window_days: 7,
            recent_pr_min_outings: 3,
        };

        crate::persistence::fitness::performances::pooled::reset_test_computations();
        let first = crate::persistence::read_pool::with_read_conn(|conn| {
            pooled::insights_data(conn, &params)
        })
        .expect("pooled insights");
        let first_computations = crate::persistence::fitness::performances::pooled::computations();
        assert!(
            first_computations > 0,
            "the fixture reaches section performances"
        );
        assert_eq!(first.section_count, 1, "the fixture has one section");
        let _again = crate::persistence::read_pool::with_read_conn(|conn| {
            pooled::insights_data(conn, &params)
        })
        .expect("second pooled insights");
        assert_eq!(
            crate::persistence::fitness::performances::pooled::computations(),
            first_computations,
            "the second insights read reuses the section performances"
        );
    }

    fn period(count: u32, total_duration: f64, total_tss: f64) -> crate::FfiPeriodStats {
        crate::FfiPeriodStats {
            count,
            total_duration,
            total_distance: 0.0,
            total_tss,
        }
    }

    /// Scenario: a week is compared against the one before it.
    ///
    /// Expected behaviour: the ratio and the metric are the engine's, so a
    /// reader divides nothing. Load is the metric where both weeks carry some
    /// and moving time where either does not, and a period with nothing to
    /// divide gets no comparison rather than one reading minus a hundred
    /// percent.
    #[test]
    fn a_comparison_is_taken_on_load_where_both_weeks_carry_it() {
        let current = period(5, 7_200.0, 320.0);
        let previous = period(4, 5_000.0, 250.0);

        let comparison = period_comparison(&current, &previous, 0.0).expect("a comparison");

        assert!(matches!(comparison.metric, crate::FfiLoadMetric::Tss));
        assert_eq!(comparison.current, 320.0);
        assert_eq!(comparison.previous, 250.0);
        assert!(
            (comparison.ratio - 0.28).abs() < 1e-9,
            "{}",
            comparison.ratio
        );
    }

    #[test]
    fn a_week_without_load_is_compared_on_moving_time() {
        let comparison =
            period_comparison(&period(5, 7_200.0, 0.0), &period(4, 5_000.0, 250.0), 0.0)
                .expect("one");

        assert!(matches!(comparison.metric, crate::FfiLoadMetric::Duration));
        assert_eq!(comparison.current, 7_200.0);
        assert_eq!(comparison.previous, 5_000.0);
    }

    #[test]
    fn nothing_to_divide_is_no_comparison() {
        assert!(period_comparison(&period(5, 7_200.0, 320.0), &period(0, 0.0, 0.0), 0.0).is_none());
        assert!(period_comparison(&period(0, 0.0, 0.0), &period(4, 5_000.0, 250.0), 0.0).is_none());
    }

    #[test]
    fn each_comparison_names_the_start_of_the_week_it_judges() {
        let (week_over_week, week_against_chronic) = period_comparisons(
            &period(5, 7_200.0, 320.0),
            &period(4, 5_000.0, 250.0),
            &chronic_week_average(&period(12, 20_000.0, 1_000.0)),
            (2_000.0, 1_000.0),
        );

        assert_eq!(
            week_over_week.expect("current week").compared_start,
            2_000.0
        );
        assert_eq!(
            week_against_chronic.expect("previous week").compared_start,
            1_000.0
        );
    }

    #[test]
    fn a_week_with_no_activity_gets_no_comparison_but_the_one_before_it_still_does() {
        let (week_over_week, week_against_chronic) = period_comparisons(
            &period(0, 0.0, 0.0),
            &period(4, 5_000.0, 250.0),
            &chronic_week_average(&period(12, 20_000.0, 1_000.0)),
            (2_000.0, 1_000.0),
        );

        assert!(week_over_week.is_none(), "no week to compare");
        let chronic = week_against_chronic.expect("last week against the average");
        assert_eq!(
            chronic.previous, 250.0,
            "the chronic window over four weeks"
        );
        assert_eq!(chronic.ratio, 0.0);
    }

    #[test]
    fn the_chronic_window_is_averaged_over_four_weeks() {
        let average = chronic_week_average(&period(12, 20_000.0, 1_000.0));

        assert_eq!(average.count, 3);
        assert_eq!(average.total_duration, 5_000.0);
        assert_eq!(average.total_tss, 250.0);
    }

    /// The section detail bundle contains the fixture's two traversals.
    #[test]
    fn the_pooled_section_detail_contains_the_traversals() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("section_detail_parity.db");
        let db_path = path.to_str().expect("utf-8");
        // Bound to this database, so the pooled overlay resolves through
        // `read_cache` as it does for the pool's own readers.
        crate::persistence::read_pool::bind(db_path);
        let engine = engine_with_a_traversed_section(db_path);

        let through_the_pool = pooled::section_detail_data(&engine.db, "auto1");
        assert_eq!(through_the_pool.activity_count, 2);
        assert_eq!(through_the_pool.activity_rows.len(), 2);
        assert_eq!(
            through_the_pool.section.as_ref().map(|s| s.id.as_str()),
            Some("auto1")
        );

        engine
            .db
            .execute(
                "UPDATE sections SET disabled = 1, superseded_by = 'cust1' WHERE id = 'auto1'",
                [],
            )
            .expect("disable section");
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                     distance_meters, source_activity_id, start_index, end_index)
                 VALUES ('cust1', 'custom', 'My Portion', 'Ride', ?1, 800.0, 'a1', 4, 24)",
                rusqlite::params![serde_json::to_string(&track(30)).expect("polyline")],
            )
            .expect("custom section");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('cust1', 'a1', 'same', 4, 24, 800.0, 210.0, 3.8, 0)",
                [],
            )
            .expect("custom traversal");
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage,
                     direction, excluded) VALUES ('r1', 'a1', 100.0, 'same', 0)",
                [],
            )
            .expect("route match");
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                     activity_count) VALUES ('r1', 'a1', '[]', 'Ride', 2)",
                [],
            )
            .unwrap();

        for (id, section_type, disabled, source) in [
            ("auto1", "auto", true, None),
            ("cust1", "custom", false, Some("a1")),
        ] {
            let section = pooled::section_detail_data(&engine.db, id)
                .section
                .expect("pooled");
            assert_eq!(section.section_type, section_type);
            assert_eq!(section.disabled, disabled);
            assert_eq!(
                section.superseded_by.as_deref(),
                disabled.then_some("cust1")
            );
            assert_eq!(section.source_activity_id.as_deref(), source);
            assert_eq!(section.route_ids, Some(vec!["r1".to_string()]));
        }
    }

    #[test]
    fn the_section_detail_read_skips_nearby_geometry() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("detail_queries.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let engine = engine_with_a_traversed_section(db_path);

        DETAIL_SQL.lock().unwrap().clear();
        crate::test_trace::trace_statements!(engine.db, record_detail_sql);
        let detail = pooled::section_detail_data(&engine.db, "auto1");
        crate::test_trace::untrace(&engine.db);

        assert!(detail.section.is_some());
        assert!(
            DETAIL_SQL.lock().unwrap().iter().all(|sql| {
                !(sql.contains("bounds_min_lat") && sql.contains("rep_start_index"))
            })
        );
    }

    /// A window that excludes every effort returns an empty chart.
    #[test]
    fn the_pooled_section_performance_honours_the_time_range() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("section_perf_window.db");
        let engine = engine_with_a_traversed_section(path.to_str().expect("utf-8"));

        // The fixture's efforts are from 2023, so a one-day window holds none.
        let detail = pooled::section_detail_performance(
            &engine.db,
            "auto1",
            1,
            None,
            None,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        );
        assert!(
            detail.chart_data.points.is_empty(),
            "nothing inside a one-day window"
        );
    }

    /// One activity's traversals of the 800 m section `auto1`: its id, its
    /// sport, how many days ago it was, and each lap as `(seconds, excluded)`.
    type Effort<'a> = (&'a str, &'a str, i64, &'a [(f64, bool)]);

    fn section_detail_engine(
        path: &str,
        efforts: &[Effort],
    ) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        let polyline = serde_json::to_string(&track(30)).expect("polyline");
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, source_activity_id)
                 VALUES ('auto1', 'auto', 'Shared Climb', 'Ride', ?1, 800.0, 0, 1, NULL)",
                rusqlite::params![polyline],
            )
            .expect("section");
        let now = chrono::Utc::now().timestamp();
        for (id, sport, days_ago, laps) in efforts {
            engine
                .add_activity(id.to_string(), track(200), sport.to_string())
                .expect("add");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id.to_string(),
                    name: format!("Fixture {id}"),
                    date: now - days_ago * 86_400,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: sport.to_string(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
            for (i, (lap_time, excluded)) in laps.iter().enumerate() {
                let start = i as u32 * 50;
                engine
                    .db
                    .execute(
                        "INSERT INTO section_activities (section_id, activity_id, direction,
                             start_index, end_index, distance_meters, lap_time, lap_pace,
                             coverage, excluded)
                         VALUES ('auto1', ?1, 'same', ?2, ?3, 800.0, ?4, ?5, 1.0, ?6)",
                        rusqlite::params![
                            id,
                            start,
                            start + 40,
                            lap_time,
                            800.0 / lap_time,
                            *excluded as i64
                        ],
                    )
                    .expect("traversal");
            }
        }
        engine
    }

    /// The performance bundle the pooled read answers, from a cold cache.
    fn performance_detail(
        engine: &mut crate::persistence::PersistentEngine,
        days: u32,
        sport: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        crate::persistence::read_cache::clear();
        pooled::section_detail_performance(
            &engine.db,
            "auto1",
            days,
            sport,
            None,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        )
    }

    fn lap_ids(points: &[crate::FfiSectionChartPoint]) -> Vec<String> {
        let mut ids: Vec<String> = points.iter().map(|p| p.lap_id.clone()).collect();
        ids.sort();
        ids
    }

    /// Scenario: twelve rides of one section, each on a day with a stored
    /// wellness row whose hrv rises with the ride's speed.
    ///
    /// Expected behaviour: the screen read carries an hrv correlation over
    /// twelve pairs, while a variable no row records is absent.
    #[test]
    fn the_section_performance_read_carries_wellness_correlations() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("section_correlations.db");
        let times: Vec<f64> = (0..12).map(|i| 240.0 - 4.0 * i as f64).collect();
        let laps: Vec<[(f64, bool); 1]> = times.iter().map(|t| [(*t, false)]).collect();
        let ids: Vec<String> = (0..12).map(|i| format!("ride{i}")).collect();
        let efforts: Vec<Effort> = (0..12)
            .map(|i| (ids[i].as_str(), "Ride", 20 - i as i64, &laps[i][..]))
            .collect();
        let mut engine = section_detail_engine(path.to_str().expect("utf-8"), &efforts);
        let now = chrono::Utc::now().timestamp();
        let rows: Vec<crate::persistence::wellness::WellnessRow> = (0..12)
            .map(|i| crate::persistence::wellness::WellnessRow {
                date: crate::persistence::sections::correlations::local_day(
                    now - (20 - i as i64) * 86_400,
                )
                .expect("day"),
                ctl: None,
                atl: None,
                ramp_rate: None,
                hrv: Some(50.0 + 2.0 * i as f64 + (i % 3) as f64 * 0.4),
                resting_hr: None,
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
            .collect();
        engine.upsert_wellness(&rows).expect("wellness");

        crate::persistence::read_cache::clear();
        let detail = pooled::section_detail_performance(
            &engine.db,
            "auto1",
            0,
            None,
            None,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        );

        let hrv = detail
            .correlations
            .iter()
            .find(|c| c.direction == "same" && c.variable == "hrv")
            .expect("hrv is recorded");
        assert!(matches!(
            hrv.result,
            crate::FfiCorrelation::Mover { n: 12, .. }
        ));
        assert!(detail.correlations.iter().all(|c| c.variable == "hrv"));
        assert_eq!(
            detail.correlation_floor as usize,
            crate::persistence::sections::correlations::MIN_PAIRS
        );
    }

    /// Scenario: a section has rides this month, one ride excluded in 2024,
    /// and a run excluded this month. The athlete picks one month, the Ride
    /// chip, and turns on show excluded.
    ///
    /// Expected behaviour: the excluded attempts shown are the ones inside the
    /// range and the sport, so the axis does not stretch back to 2024 and a
    /// run is not drawn as a ride. Picking all time brings the old one back.
    #[test]
    fn the_excluded_attempts_follow_the_range_and_the_sport() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("excluded_range.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("ride_now", "Ride", 5, &[(200.0, false)]),
                ("ride_old", "Ride", 700, &[(190.0, true)]),
                ("ride_x", "Ride", 2, &[(260.0, true)]),
                ("run_x", "Run", 3, &[(400.0, true)]),
            ],
        );

        let month = performance_detail(&mut engine, 30, Some("Ride"));
        assert_eq!(lap_ids(&month.excluded_points), vec!["ride_x_lap0"]);
        assert_eq!(lap_ids(&month.chart_data.points), vec!["ride_now_lap0"]);

        let all = performance_detail(&mut engine, 0, Some("Ride"));
        assert_eq!(
            lap_ids(&all.excluded_points),
            vec!["ride_old_lap0", "ride_x_lap0"]
        );

        // With no chip asked, which is how the screen opens, the run is still
        // another sport's attempt: the section has been run, even if every
        // run is excluded, so the answer is for the rides alone.
        let opened = performance_detail(&mut engine, 30, None);
        assert_eq!(opened.sport_type.as_deref(), Some("Ride"));
        assert_eq!(lap_ids(&opened.excluded_points), vec!["ride_x_lap0"]);
    }

    /// Scenario: a section ridden and run, and walked once, the walk
    /// excluded.
    ///
    /// Expected behaviour: the walk keeps a pill, at no laps, so its excluded
    /// lap can be found under it and restored.
    #[test]
    fn a_sport_with_every_lap_excluded_keeps_its_pill() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("excluded_sport.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("ride_a", "Ride", 3, &[(200.0, false)]),
                ("ride_b", "Ride", 4, &[(205.0, false)]),
                ("run_a", "Run", 5, &[(400.0, false)]),
                ("walk_a", "Walk", 6, &[(900.0, true)]),
            ],
        );

        let opened = performance_detail(&mut engine, 0, None);
        let counts: Vec<(String, u32)> = opened
            .sport_counts
            .iter()
            .map(|c| (c.sport_type.clone(), c.count))
            .collect();
        assert_eq!(
            counts,
            vec![
                ("Ride".to_string(), 2),
                ("Run".to_string(), 1),
                ("Walk".to_string(), 0)
            ]
        );

        let walk = performance_detail(&mut engine, 0, Some("Walk"));
        let laps: Vec<(String, bool)> = walk
            .lap_records
            .iter()
            .flat_map(|r| r.laps.iter().map(|l| (l.id.clone(), l.excluded)))
            .collect();
        assert_eq!(laps, vec![("walk_a_lap0".to_string(), true)]);
    }

    /// Scenario: a section's record was set two years ago. The athlete picks
    /// one month.
    ///
    /// Expected behaviour: the performances the summary card and the stats
    /// rows read are the month's, the same laps the chart plots, so Best and
    /// Avg are figures in the chart above them.
    #[test]
    fn the_performances_follow_the_range() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("ranged_best.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("old_pr", "Ride", 700, &[(150.0, false)]),
                ("this_month_a", "Ride", 10, &[(240.0, false)]),
                ("this_month_b", "Ride", 4, &[(250.0, false)]),
            ],
        );

        let month = performance_detail(&mut engine, 30, None);
        let best = month
            .performances
            .best_forward_record
            .as_ref()
            .expect("a best this month");
        assert_eq!(best.best_time, 240.0);
        let stats = month.performances.forward_stats.as_ref().expect("stats");
        assert_eq!(stats.count, 2);
        assert_eq!(stats.avg_time, Some(245.0));
        assert_eq!(month.performances.records.len(), 2);
        assert_eq!(
            month
                .calendar_summary
                .as_ref()
                .map(|c| c.forward_pr.as_ref().map(|p| p.best_time)),
            Some(Some(150.0)),
            "the calendar stays on the whole record"
        );

        let all = performance_detail(&mut engine, 0, None);
        assert_eq!(
            all.performances
                .best_forward_record
                .as_ref()
                .map(|b| b.best_time),
            Some(150.0)
        );
    }

    /// Scenario: a section's record was set two years ago and the athlete rode
    /// it twice this month. The athlete picks one month, then all time.
    ///
    /// Expected behaviour: the month's best is not the record, so the engine
    /// says so, and all time says it is.
    #[test]
    fn a_ranged_best_is_a_record_only_when_it_is_the_whole_record() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("ranged_record.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("old_pr", "Ride", 700, &[(150.0, false)]),
                ("this_month_a", "Ride", 10, &[(240.0, false)]),
                ("this_month_b", "Ride", 4, &[(250.0, false)]),
            ],
        );

        let month = performance_detail(&mut engine, 30, None);
        assert!(
            !month.best_forward_is_record,
            "a month's best is not the record"
        );
        assert!(
            !month.best_reverse_is_record,
            "no reverse lap, no reverse record"
        );

        let all = performance_detail(&mut engine, 0, None);
        assert!(all.best_forward_is_record, "all time holds the record");
    }

    /// Expected behaviour: a record set inside the range is the record.
    #[test]
    fn a_record_set_in_the_range_is_flagged_on_that_range() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("ranged_record_set.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("older", "Ride", 700, &[(300.0, false)]),
                ("this_month", "Ride", 4, &[(240.0, false)]),
            ],
        );

        let month = performance_detail(&mut engine, 30, None);
        assert!(month.best_forward_is_record);
    }

    /// Expected behaviour: a lone lap has beaten nothing, and two laps tied at
    /// the fastest time have beaten each other nowhere.
    #[test]
    fn a_lone_or_tied_best_is_not_a_record() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");

        let lone_path = dir.path().join("lone.db");
        let mut lone = section_detail_engine(
            lone_path.to_str().expect("utf-8"),
            &[("only", "Ride", 4, &[(240.0, false)])],
        );
        assert!(!performance_detail(&mut lone, 0, None).best_forward_is_record);
        crate::persistence::read_cache::clear();

        let tied_path = dir.path().join("tied.db");
        let mut tied = section_detail_engine(
            tied_path.to_str().expect("utf-8"),
            &[
                ("first", "Ride", 9, &[(240.0, false)]),
                ("second", "Ride", 4, &[(240.0, false)]),
            ],
        );
        assert!(!performance_detail(&mut tied, 0, None).best_forward_is_record);
    }

    /// Expected behaviour: each direction is judged against its own laps, so a
    /// reverse record stands beside a forward lap that has beaten nothing.
    #[test]
    fn each_direction_is_judged_on_its_own_laps() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("directions.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("forward_once", "Ride", 20, &[(100.0, false)]),
                ("back_slow", "Ride", 10, &[(260.0, false)]),
                ("back_fast", "Ride", 4, &[(240.0, false)]),
            ],
        );
        engine
            .db
            .execute(
                "UPDATE section_activities SET direction = 'reverse'
                 WHERE activity_id IN ('back_slow', 'back_fast')",
                [],
            )
            .expect("reverse");

        let all = performance_detail(&mut engine, 0, None);
        assert!(!all.best_forward_is_record, "one forward lap beat nothing");
        assert!(all.best_reverse_is_record, "240 s beats 260 s in reverse");
    }

    /// Scenario: a lapped cross-sport section. Two rides this month, one ride
    /// last year, and one run this month that lapped it three times.
    ///
    /// Expected behaviour: the pills count laps per sport over the range the
    /// header counts, with the exclusions the chart applies, so on one month
    /// they read Ride 2 and Run 3, and the header under the Run chip reads 3.
    #[test]
    fn the_sport_counts_are_laps_over_the_range() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("sport_counts.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("ride_a", "Ride", 3, &[(200.0, false)]),
                ("ride_b", "Ride", 6, &[(210.0, false), (220.0, true)]),
                ("ride_old", "Ride", 400, &[(205.0, false)]),
                (
                    "run_a",
                    "Run",
                    2,
                    &[(400.0, false), (410.0, false), (420.0, false)],
                ),
            ],
        );

        let month = performance_detail(&mut engine, 30, Some("Run"));
        let counts: Vec<(String, u32)> = month
            .sport_counts
            .iter()
            .map(|c| (c.sport_type.clone(), c.count))
            .collect();
        assert_eq!(
            counts,
            vec![("Ride".to_string(), 2), ("Run".to_string(), 3)],
            "outings order the pills, laps fill them"
        );
        assert_eq!(month.chart_data.points.len(), 3);

        let all = performance_detail(&mut engine, 0, Some("Run"));
        assert_eq!(all.sport_counts[0].count, 3, "rides over all time");

        // A fragment of the run's ground is a row the section's visit count
        // holds and the chart refuses, so at all time too the count under the
        // Run chip is the chart's.
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, coverage)
                 VALUES ('auto1', 'run_a', 'same', 160, 170, 200.0, 90.0, 2.2, 0.25)",
                [],
            )
            .expect("fragment");
        engine.invalidate_perf_cache();
        let all = performance_detail(&mut engine, 0, Some("Run"));
        let run = all
            .sport_counts
            .iter()
            .find(|c| c.sport_type == "Run")
            .expect("a Run pill");
        assert_eq!(run.count, 3);
        assert_eq!(all.chart_data.points.len(), 3);
    }

    /// Scenario: a section run recently and ridden once over a year ago.
    ///
    /// Expected behaviour: over a month the ride has no lap in range and no
    /// excluded lap, so it is not offered, and with no chip asked the answer is
    /// for the run even when the ride has the most outings.
    #[test]
    fn a_sport_with_no_lap_in_range_is_not_offered() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("range_empty.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("run_a", "Run", 2, &[(400.0, false)]),
                ("ride_old_a", "Ride", 400, &[(200.0, false)]),
                ("ride_old_b", "Ride", 401, &[(205.0, false)]),
            ],
        );

        let month = performance_detail(&mut engine, 30, None);
        let counts: Vec<(String, u32)> = month
            .sport_counts
            .iter()
            .map(|c| (c.sport_type.clone(), c.count))
            .collect();
        assert_eq!(counts, vec![("Run".to_string(), 1)]);
        assert_eq!(month.sport_type.as_deref(), Some("Run"));
        assert_eq!(month.chart_data.points.len(), 1);
    }

    /// Scenario: a section run twice and ridden once, opened with no chip.
    ///
    /// Expected behaviour: a record is held within one sport, so the engine
    /// answers for the sport with the most outings and says so, rather than
    /// ranking the ride against the runs.
    #[test]
    fn with_no_sport_asked_a_mixed_section_answers_for_its_most_ridden_sport() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("default_sport.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[
                ("run_a", "Run", 3, &[(400.0, false)]),
                ("run_b", "Run", 9, &[(390.0, false)]),
                ("ride_a", "Ride", 5, &[(65.0, false)]),
            ],
        );

        let detail = performance_detail(&mut engine, 0, None);
        assert_eq!(detail.sport_type.as_deref(), Some("Run"));
        assert_eq!(
            lap_ids(&detail.chart_data.points),
            vec!["run_a_lap0", "run_b_lap0"]
        );
        assert_eq!(detail.chart_data.best_time_secs, Some(390.0));
    }

    /// A section only one sport has taken answers for that sport, so the
    /// screen formats it in that sport's units without a label to fall back on.
    #[test]
    fn a_single_sport_section_names_its_sport() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("single_sport.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[("run_a", "Run", 3, &[(400.0, false)])],
        );

        let detail = performance_detail(&mut engine, 0, None);
        assert_eq!(detail.sport_type.as_deref(), Some("Run"));
        assert_eq!(detail.chart_data.points.len(), 1);

        // A sport the section has never seen answers nothing, and the one
        // pill still counts the sport that took it, so the screen can see
        // the chip it asked for is not offered.
        let ride = performance_detail(&mut engine, 0, Some("Ride"));
        assert_eq!(ride.sport_type.as_deref(), Some("Ride"));
        assert!(ride.chart_data.points.is_empty());
        let counts: Vec<(String, u32)> = ride
            .sport_counts
            .iter()
            .map(|c| (c.sport_type.clone(), c.count))
            .collect();
        assert_eq!(counts, vec![("Run".to_string(), 1)]);
    }

    /// Scenario: an activity crosses a section three times and the athlete
    /// excludes the second lap.
    ///
    /// Expected behaviour: the lap list still holds all three, the second
    /// flagged excluded so it keeps its undo, while the records, the stats
    /// and the chart count the other two.
    #[test]
    fn an_excluded_lap_stays_in_the_lap_list_flagged() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_list.db");
        let mut engine = section_detail_engine(
            path.to_str().expect("utf-8"),
            &[(
                "loop",
                "Ride",
                3,
                &[(200.0, false), (205.0, false), (210.0, false)],
            )],
        );
        engine
            .exclude_section_lap("auto1", "loop", 50)
            .expect("exclude lap 2");

        let detail = performance_detail(&mut engine, 0, None);
        let laps: Vec<(u32, bool)> = detail
            .lap_records
            .iter()
            .flat_map(|r| r.laps.iter().map(|l| (l.start_index, l.excluded)))
            .collect();
        assert_eq!(laps, vec![(0, false), (50, true), (100, false)]);
        assert_eq!(
            detail.performances.forward_stats.as_ref().map(|s| s.count),
            Some(2)
        );
        assert_eq!(detail.chart_data.points.len(), 2);
        assert!(
            detail
                .performances
                .records
                .iter()
                .flat_map(|r| &r.laps)
                .all(|l| !l.excluded)
        );
    }

    fn track(n: usize) -> Vec<crate::GpsPoint> {
        (0..n)
            .map(|i| crate::GpsPoint {
                latitude: 46.0 + i as f64 * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// Scenario: the widget draws 150 points, and the writer runs on every
    /// background transition and every settled sync. The whole track crossed
    /// the FFI boundary each time so JavaScript could keep 150 of it.
    ///
    /// Expected behaviour: the stride happens before the crossing, and produces
    /// the same points the projection would have kept.
    #[test]
    fn a_long_track_crosses_at_the_cap_not_at_its_length() {
        let strided = stride_track(track(5_000), 150);

        assert!(
            strided.len() <= 151,
            "150 points, plus the last one the stride missed: {}",
            strided.len()
        );
        assert_eq!(strided[0].latitude, 46.0, "it starts where the ride did");
        assert_eq!(
            strided.last().unwrap().latitude,
            46.0 + 4_999.0 * 0.001,
            "and ends where it did: the outline closes on that point"
        );
    }

    /// A track already under the cap is handed over whole. Striding it would
    /// throw away detail for nothing.
    #[test]
    fn a_short_track_is_not_strided() {
        assert_eq!(stride_track(track(100), 150).len(), 100);
        assert_eq!(stride_track(track(150), 150).len(), 150);
    }

    /// Zero is a caller asking for no cap, not for no points.
    #[test]
    fn no_cap_means_the_whole_track() {
        assert_eq!(stride_track(track(5_000), 0).len(), 5_000);
    }

    /// An empty track strides to nothing rather than panicking on its last
    /// index.
    #[test]
    fn an_empty_track_strides_to_nothing() {
        assert!(stride_track(Vec::new(), 150).is_empty());
    }

    /// Scenario: the feed card drew its sparklines from a second engine call
    /// beside the bundle it had already read.
    ///
    /// Expected behaviour: the bundle carries them. An athlete with no
    /// wellness gets `None` rather than an empty chart.
    #[test]
    fn the_startup_bundle_carries_the_card_sparklines() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("sparkline_bundle.db");
        let path = path.to_str().expect("utf-8");
        let engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let window = (1_699_000_000, 1_701_000_000, 1_698_000_000, 1_699_000_000);
        let ids: Vec<String> = Vec::new();

        assert!(
            pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids,)
                .sparklines
                .is_none(),
            "an athlete with no wellness has no line to draw"
        );

        let today = crate::persistence::wellness::today_iso();
        engine
            .db
            .execute(
                "INSERT INTO wellness (date, ctl, atl, hrv, resting_hr) VALUES (?1, 70.0, 60.0, 55.0, 48.0)",
                rusqlite::params![today],
            )
            .expect("wellness");

        let data = pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids);
        let lines = data.sparklines.expect("a day of wellness");
        assert_eq!(lines.fitness, vec![70]);
        assert_eq!(lines.form, vec![10], "form is fitness less fatigue");

        crate::persistence::read_cache::close();
    }

    /// Scenario: the eFTP chart is read from the stored wellness bodies, and
    /// with none stored it told the athlete to complete power activities.
    ///
    /// Expected behaviour: the fitness screen read says the chart's window owes
    /// its download until wellness is stored, and says it is loaded once a day
    /// inside the window is, whether or not that day carries an estimate.
    #[test]
    fn the_fitness_screen_read_says_whether_the_eftp_window_was_downloaded() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("fitness_screen_coverage.db");
        let path = path.to_str().expect("utf-8");
        let engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        let today = "2026-06-30";
        let day = crate::FfiTimestampRange {
            start_ts: 1_782_777_600.0,
            end_ts: 1_782_863_999.0,
        };
        let windows = crate::FfiFitnessScreenWindows {
            heatmap_first_day: today.into(),
            heatmap_last_day: today.into(),
            months: day.clone(),
            year_current: day.clone(),
            year_previous: day.clone(),
            month_current: day.clone(),
            month_previous: day,
            now_wall_seconds: 1_782_820_800.0,
        };
        let read = |today| pooled::fitness_screen_data(&engine.db, today, &[], &windows).unwrap();

        let read_now = read(today);
        assert!(read_now.ftp_trend.history.is_empty());
        assert_eq!(
            read_now.ftp_trend_coverage,
            crate::RangeCoverage::NotFetched
        );

        let before_window = "2026-03-01";
        engine
            .db
            .execute(
                "INSERT INTO wellness (date, ctl, atl) VALUES (?1, 50.0, 40.0)",
                rusqlite::params![before_window],
            )
            .expect("wellness");
        assert_eq!(
            read(today).ftp_trend_coverage,
            crate::RangeCoverage::Empty,
            "wellness stored only before the chart's window"
        );

        engine
            .db
            .execute(
                "INSERT INTO wellness (date, ctl, atl) VALUES (?1, 50.0, 40.0)",
                rusqlite::params!["2026-06-29"],
            )
            .expect("wellness");
        let read_now = read(today);
        assert!(
            read_now.ftp_trend.history.is_empty(),
            "no day carries an estimate"
        );
        assert_eq!(read_now.ftp_trend_coverage, crate::RangeCoverage::Loaded);

        crate::persistence::read_cache::close();
    }

    /// An empty library has no latest activity or GPS track.
    #[test]
    fn the_pooled_widget_snapshot_survives_an_empty_library() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_empty.db");
        let path = path.to_str().expect("utf-8");
        let engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let snapshot = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        assert!(snapshot.latest.is_none());
        assert!(!snapshot.latest_is_pr);
        assert!(snapshot.latest_gps.is_empty());

        crate::persistence::read_cache::close();
    }

    /// A ride of `moving_time` seconds over a fixed distance.
    fn widget_metric(id: &str, date: i64, moving_time: u32) -> crate::types::ActivityMetrics {
        crate::types::ActivityMetrics {
            activity_id: id.into(),
            name: id.into(),
            date,
            distance: 40_000.0,
            moving_time,
            elapsed_time: moving_time + 100,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".into(),
            training_load: Some(42.0),
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    /// Fourteen rides over one route, one a day, `latest` the newest: the best
    /// takes 3000 s and the newest 3095 s, so the newest is second.
    fn seed_route_of_fourteen(engine: &mut crate::persistence::PersistentEngine) {
        let ids: Vec<String> = (0..14).map(|i| format!("a{i}")).collect();
        let metrics: Vec<_> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| {
                let moving_time = match i {
                    3 => 3_000,
                    13 => 3_095,
                    _ => 3_200 + i as u32,
                };
                widget_metric(id, 1_700_000_000 + i as i64 * 86_400, moving_time)
            })
            .collect();
        engine.set_activity_metrics(metrics).expect("metrics");
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES ('g1', 'a0', ?1, 'Ride', 14)",
                rusqlite::params![serde_json::to_string(&ids).unwrap()],
            )
            .expect("group");
        engine
            .db
            .execute(
                "INSERT INTO route_names (route_id, custom_name) VALUES ('g1', 'Lake loop')",
                [],
            )
            .expect("name");
    }

    #[test]
    fn the_widget_read_ranks_the_latest_ride_second_of_fourteen_attempts() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_route_standing.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        seed_route_of_fourteen(&mut engine);

        let data = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        let route = data.latest_comparison.route.expect("the route it rode");
        assert_eq!(route.route_name, "Lake loop");
        assert_eq!(route.rank, Some(2));
        assert_eq!(route.attempt_count, 14);
        assert_eq!(route.time_delta_seconds, Some(95), "behind the 3000 s best");
        assert_eq!(route.prior_attempt_seconds.len(), 13);
        assert_eq!(route.prior_attempt_seconds[0], 3_200, "oldest first");
        assert_eq!(route.prior_attempt_seconds[3], 3_000, "a3 holds the best");
        assert_eq!(route.prior_attempt_seconds[4], 3_204, "a4 follows it");
        assert_eq!(
            data.latest_comparison.typical_load, None,
            "a matched route needs no typical load"
        );

        crate::persistence::read_cache::close();
    }

    #[test]
    fn the_widget_read_leaves_out_attempts_the_athlete_excluded_from_the_route() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_route_excluded.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        seed_route_of_fourteen(&mut engine);
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
                 VALUES ('g1', 'a5', 100.0, 'same', 1)",
                [],
            )
            .expect("exclusion");

        let route = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150)
            .latest_comparison
            .route
            .expect("the route it rode");
        assert_eq!(route.attempt_count, 13);
        assert_eq!(route.prior_attempt_seconds.len(), 12);
        assert!(!route.prior_attempt_seconds.contains(&3_205));

        crate::persistence::read_cache::close();
    }

    #[test]
    fn the_widget_read_gives_a_lone_route_member_no_standing_and_falls_back_to_load() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_route_alone.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let mut prior = widget_metric("prior", 1_700_000_000, 3_000);
        prior.training_load = Some(40.0);
        let latest = widget_metric("latest", 1_700_086_400, 3_000);
        engine
            .set_activity_metrics(vec![prior, latest])
            .expect("metrics");
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES ('g1', 'latest', '[\"latest\"]', 'Ride', 1)",
                [],
            )
            .expect("group");

        let data = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        assert_eq!(data.latest_comparison.route, None);
        assert_eq!(data.latest_comparison.typical_load, Some(40.0));

        crate::persistence::read_cache::close();
    }

    /// The typical load is the median of the same sport's recorded loads in
    /// the four weeks before the latest activity, the latest itself left out.
    #[test]
    fn the_widget_read_takes_the_typical_load_from_the_same_sport_in_the_four_weeks_before() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_typical_load.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        const DAY: i64 = 86_400;
        let latest_date = 1_700_000_000 + 40 * DAY;
        let ride = |id: &str, days_before: i64, sport: &str, load: Option<f64>| {
            let mut m = widget_metric(id, latest_date - days_before * DAY, 3_600);
            m.sport_type = sport.into();
            m.training_load = load;
            m
        };
        let mut latest = ride("latest", 0, "Ride", Some(90.0));
        latest.training_load = Some(90.0);
        engine
            .set_activity_metrics(vec![
                latest,
                ride("r1", 2, "Ride", Some(40.0)),
                ride("r2", 9, "Ride", Some(60.0)),
                ride("r3", 27, "Ride", Some(80.0)),
                ride("r4", 29, "Ride", Some(500.0)),
                ride("no_load", 5, "Ride", None),
                ride("zero_load", 6, "Ride", Some(0.0)),
                ride("a_run", 3, "Run", Some(300.0)),
            ])
            .expect("metrics");

        let data = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        assert_eq!(data.latest_comparison.route, None);
        assert_eq!(
            data.latest_comparison.typical_load,
            Some(60.0),
            "the median of 40, 60 and 80, not the 500 outside the window or the run"
        );

        crate::persistence::read_cache::close();
    }

    #[test]
    fn the_widget_read_has_no_typical_load_when_nothing_of_that_sport_came_before() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_typical_none.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .set_activity_metrics(vec![widget_metric("only", 1_700_000_000, 3_600)])
            .expect("metrics");

        let data = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        assert_eq!(data.latest_comparison.typical_load, None);
        assert_eq!(data.latest_comparison.section_pr_count, 0);

        crate::persistence::read_cache::close();
    }

    #[test]
    fn the_widget_read_counts_the_sections_the_latest_activity_set_a_record_on() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_section_prs.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .set_activity_metrics(vec![
                widget_metric("old", 1_700_000_000, 3_600),
                widget_metric("new", 1_700_086_400, 3_600),
            ])
            .expect("metrics");
        for (id, start) in [("old", 1_700_000_000_i64), ("new", 1_700_086_400)] {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                              start_date, name, distance_meters, duration_secs)
                     VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?1, 40000.0, 3600)",
                    rusqlite::params![id, start],
                )
                .expect("activity");
        }
        // `fast` and `faster` are beaten by the new ride; `slow` is not.
        for section in ["fast", "faster", "slow"] {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                           distance_meters, disabled, version)
                     VALUES (?1, 'auto', ?1, 'Ride', '[]', 800.0, 0, 1)",
                    rusqlite::params![section],
                )
                .expect("section");
        }
        for (section, activity, lap) in [
            ("fast", "old", 240.0),
            ("fast", "new", 230.0),
            ("faster", "old", 240.0),
            ("faster", "new", 200.0),
            ("slow", "old", 240.0),
            ("slow", "new", 250.0),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                                     end_index, distance_meters, lap_time, lap_pace, excluded)
                     VALUES (?1, ?2, 'same', 0, 0, 800.0, ?3, ?4, 0)",
                    rusqlite::params![section, activity, lap, 800.0 / lap],
                )
                .expect("traversal");
        }

        let data = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);
        assert_eq!(data.latest_comparison.section_pr_count, 2);

        crate::persistence::read_cache::close();
    }

    /// Scenario: the library holds a synced ride, a demo ride, a recording no
    /// upload has answered, a tracked recording the server has named and a
    /// trackless one it has named.
    ///
    /// Expected behaviour: the detail read and every row of the feed page
    /// carry the intervals.icu id a web link may name, and none for the demo
    /// ride or the unanswered recording.
    #[test]
    fn the_screen_reads_carry_the_id_a_web_link_may_name() {
        let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
        let points = vec![
            crate::GpsPoint::new(46.0, 7.0),
            crate::GpsPoint::new(46.001, 7.001),
        ];
        let rows = [
            ("i901", Some("i901")),
            ("demo-ride-1", None),
            ("local-ride-1", None),
            ("local-ride-2", Some("i900")),
            ("local-ride-3", Some("i903")),
        ];
        for (offset, (key, _)) in rows.iter().enumerate() {
            if *key != "local-ride-3" {
                engine
                    .add_activity(key.to_string(), points.clone(), "Ride".into())
                    .expect("track");
            }
            engine
                .upsert_activity_bodies(&[(
                    key.to_string(),
                    1_700_000_000 - offset as i64 * 86_400,
                    format!("{{\"id\":\"{key}\"}}"),
                )])
                .expect("body");
        }
        assert!(engine.record_upload("local-ride-2", "i900").unwrap());
        assert!(engine.record_upload("local-ride-3", "i903").unwrap());

        for (key, expected) in rows {
            assert_eq!(
                pooled::activity_detail_data(&engine.db, key, 1)
                    .intervals_id
                    .as_deref(),
                expected,
                "detail read of {key}"
            );
        }

        let page = crate::persistence::activities::pooled::activity_body_page(
            &engine.db,
            &crate::FfiActivityBodiesQuery {
                oldest_ts: None,
                newest_ts: None,
                needle: String::new(),
                sport_families: Vec::new(),
                offset: 0,
                limit: None,
            },
        )
        .expect("page");
        assert_eq!(page.bodies.len(), rows.len());
        assert_eq!(page.intervals_ids.len(), page.bodies.len());
        for (index, (key, expected)) in rows.iter().enumerate() {
            assert!(
                page.bodies[index].contains(key),
                "page row {index} is {key}"
            );
            assert_eq!(
                page.intervals_ids[index].as_deref(),
                *expected,
                "page row of {key}"
            );
        }
    }

    #[test]
    fn activity_detail_reads_its_own_load_impact() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("activity_impact.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let mut first = widget_metric("first", 1_700_000_000, 600);
        first.training_load = Some(100.0);
        let mut second = widget_metric("second", 1_700_000_000, 600);
        second.training_load = Some(100.0);
        let mut missing = widget_metric("missing", 1_700_000_000, 600);
        missing.training_load = None;
        let mut strength = widget_metric("strength", 1_700_000_000, 600);
        strength.sport_type = "WeightTraining".into();
        strength.training_load = Some(22.0);
        engine
            .set_activity_metrics(vec![first, second, missing, strength])
            .expect("metrics");
        for id in ["first", "second"] {
            let impact = engine.activity_detail_data(id, 1).fitness_impact.unwrap();
            assert!((impact.fitness - 2.35283).abs() < 1e-5);
            assert!((impact.fatigue - 13.31221).abs() < 1e-5);
        }
        let impact = engine
            .activity_detail_data("strength", 1)
            .fitness_impact
            .unwrap();
        assert_eq!(impact.fitness, 0.0);
        assert!((impact.fatigue - 2.92869).abs() < 1e-5);
        assert!(
            engine
                .activity_detail_data("missing", 1)
                .fitness_impact
                .is_none()
        );
        assert!(
            engine
                .activity_detail_data("unknown", 1)
                .fitness_impact
                .is_none()
        );
        crate::persistence::read_cache::close();
    }

    /// Scenario: a library holds a pool swim whose file was read, one still
    /// owed its file, one settled with no lengths, and a ride.
    ///
    /// Expected behaviour: the detail read carries the read swim's five
    /// lengths, says owed and none for the other two, carries nothing for the
    /// ride, and the engine's path and the pooled reader answer the same.
    #[test]
    fn activity_detail_carries_a_pool_swims_lengths_on_both_paths() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("pool_swim_detail.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let swim = |id: &str| {
            let mut metric = widget_metric(id, 1_700_000_000, 600);
            metric.sport_type = "Swim".into();
            metric
        };
        engine
            .set_activity_metrics(vec![
                swim("read"),
                swim("owed"),
                swim("settled"),
                widget_metric("ride", 1_700_000_000, 600),
            ])
            .expect("metrics");
        let fixture = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();
        engine.settle_pool_swim("read", &fixture).unwrap();
        engine
            .settle_pool_swim("settled", &crate::fit::FitPoolSwim::default())
            .unwrap();

        let read = engine.activity_detail_data("read", 1).pool_swim.unwrap();
        assert_eq!(read.state, crate::FfiPoolSwimState::Read);
        assert_eq!(read.lengths.len(), 5);
        assert!(!read.lengths[2].active, "the third length is the rest");
        assert_eq!(read.lengths[0].swolf, Some(43.0));
        assert_eq!(read.stroke_totals.len(), 2);
        assert_eq!(
            engine
                .activity_detail_data("owed", 1)
                .pool_swim
                .map(|p| p.state),
            Some(crate::FfiPoolSwimState::Owed)
        );
        assert_eq!(
            engine
                .activity_detail_data("settled", 1)
                .pool_swim
                .map(|p| p.state),
            Some(crate::FfiPoolSwimState::NoLengths)
        );
        assert_eq!(engine.activity_detail_data("ride", 1).pool_swim, None);
        for id in ["read", "owed", "settled", "ride"] {
            assert_eq!(
                engine.activity_detail_data(id, 1).pool_swim,
                pooled::activity_detail_data(&engine.db, id, 1).pool_swim,
                "{id} reads the same on both paths"
            );
        }
        crate::persistence::read_cache::close();
    }

    /// Scenario: an activity has metrics and no GPS row yet.
    ///
    /// Expected behaviour: the library count includes it and the GPS-backed
    /// set does not, and the map screen reports the library count rather than
    /// a count of its own.
    #[test]
    fn library_count_includes_activities_without_gps_and_the_map_reads_it() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("library_count.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .set_activity_metrics(vec![widget_metric("pending", 1_700_000_000, 600)])
            .expect("metrics");

        let conn = rusqlite::Connection::open(&path).expect("open");
        let library = crate::persistence::activities::pooled::library_count(&conn).expect("count");
        let gps_set = crate::persistence::activities::pooled::activity_count(&conn).expect("count");
        let map = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::All,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );

        assert_eq!(library, 1);
        assert_eq!(gps_set, 0);
        assert_eq!(map.activity_count, library);
        crate::persistence::read_cache::close();
    }

    #[test]
    fn engine_stats_library_count_includes_activities_without_gps() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("stats_library.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .set_activity_metrics(vec![
                widget_metric("a1", 1_700_000_000, 600),
                widget_metric("a2", 1_700_100_000, 900),
            ])
            .expect("metrics");

        let stats = crate::persistence::pooled_stats(&engine.db);
        assert_eq!(stats.activity_count, 0);
        assert_eq!(stats.library_count, 2);
        assert_eq!(engine.stats().library_count, 2);
    }

    #[test]
    fn test_map_screen_counts_demo_metrics_before_gps_arrives() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("map_demo.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .set_activity_metrics(vec![widget_metric("a1", 1_700_000_000, 600)])
            .expect("metrics");

        let pooled = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::All,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(pooled.activity_count, 1);
        assert!(pooled.activities.is_empty());
        crate::persistence::read_cache::close();
    }

    #[test]
    fn test_map_sport_filter_uses_current_metrics_sport() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("map_sport.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .add_activity("a1".into(), track(60), "Ride".into())
            .expect("track");
        let mut metric = widget_metric("a1", 1_700_000_000, 600);
        metric.sport_type = "GravelRide".into();
        engine.set_activity_metrics(vec![metric]).expect("metrics");

        let screen = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec!["GravelRide".into()],
            crate::MapDistanceBand::All,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(screen.available_sport_types, vec!["GravelRide"]);
        assert_eq!(screen.activities.len(), 1);
        assert_eq!(screen.activities[0].sport_type, "GravelRide");
        crate::persistence::read_cache::close();
    }

    #[test]
    fn test_map_screen_filters_distance_edges_and_counts_unfiltered_window() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("map_distance.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let cases = [
            ("below", "Ride", 4_999.0, 1_700_000_000),
            ("edge", "Ride", 5_000.0, 1_700_000_000),
            ("short", "Run", 10_000.0, 1_700_000_000),
            ("long", "Unicycle", 50_000.0, 1_700_000_000),
            ("outside", "Ride", 6_000.0, 1_800_000_000),
        ];
        for (id, sport, _, _) in cases {
            engine
                .add_activity(id.into(), track(60), sport.into())
                .expect("track");
        }
        let mut metrics = Vec::new();
        for (id, sport, distance, date) in cases {
            let mut metric = widget_metric(id, date, 600);
            metric.sport_type = sport.into();
            metric.distance = distance;
            metrics.push(metric);
        }
        let mut no_gps = widget_metric("pending", 1_700_000_000, 600);
        no_gps.distance = 6_000.0;
        metrics.push(no_gps);
        engine.set_activity_metrics(metrics).expect("metrics");

        let screen = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec!["Ride".into()],
            crate::ffi_types::MapDistanceBand::XShort,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(screen.activity_count, 6);
        assert_eq!(screen.activities.len(), 1);
        assert_eq!(screen.activities[0].activity_id, "below");
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.family == crate::FfiSportFamily::Ride)
                .unwrap()
                .count,
            2
        );
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.family == crate::FfiSportFamily::Run)
                .unwrap()
                .count,
            1
        );
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.family == crate::FfiSportFamily::Other)
                .unwrap()
                .count,
            1
        );

        let short = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::Short,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(
            short
                .activities
                .iter()
                .map(|a| a.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["edge"]
        );
        let medium = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::Medium,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(
            medium
                .activities
                .iter()
                .map(|a| a.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["short"]
        );
        let long = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::Long,
            true,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(
            long.activities
                .iter()
                .map(|a| a.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["long"]
        );
        let imperial = pooled::map_screen_data(
            &engine.db,
            1_699_000_000,
            1_701_000_000,
            vec![],
            crate::MapDistanceBand::Short,
            false,
            pooled::MapLayers::default(),
            String::new(),
        );
        assert_eq!(
            imperial
                .activities
                .iter()
                .map(|a| a.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["below", "edge"]
        );
        crate::persistence::read_cache::close();
    }

    /// Scenario: the library holds an activity whose track has not arrived, so
    /// it has a metrics row and no GPS.
    ///
    /// Expected behaviour: the activity, route and section detail reads count
    /// the metrics rows, including the activity without GPS.
    #[test]
    fn the_detail_reads_count_metrics_rows_without_gps() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("count_parity.db");
        let path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(path);
        let mut engine = engine_with_a_traversed_section(path);
        engine
            .set_activity_metrics(vec![widget_metric("no_track", 1_700_172_800, 600)])
            .expect("metrics");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let activity = pooled::activity_detail_data(&engine.db, "a1", 1).activity_count;
        let route = pooled::route_detail_data(&engine.db, "g1").activity_count;
        let section = pooled::section_detail_data(&engine.db, "auto1").activity_count;

        assert_eq!(activity, 3, "activity detail");
        assert_eq!(route, 3, "route detail");
        assert_eq!(section, 3, "section detail");
        crate::persistence::read_cache::close();
    }

    /// Scenario: the route page opened from the routes list carries no
    /// activity and no sport filter, and a route ridden in one sport only is
    /// given no chip to pick one with.
    ///
    /// Expected behaviour: its best is still there.
    #[test]
    fn test_route_detail_opened_from_the_list_has_a_best() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_from_list.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        for (id, points) in [("a1", 60), ("a2", 80)] {
            engine
                .add_activity(id.into(), track(points), "Ride".into())
                .expect("add");
        }
        engine
            .set_activity_metrics(vec![
                widget_metric("a1", 1_700_000_000, 3_600),
                widget_metric("a2", 1_700_086_400, 3_500),
            ])
            .expect("metrics");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let read = pooled::route_detail_performance(
            &engine.db,
            "g1",
            0,
            None,
            None,
            crate::persistence::sections::lap_curves::pooled::CurveRead::Held,
        );
        let best = read
            .performances
            .best_forward_record
            .as_ref()
            .map(|p| p.activity_id.as_str());
        assert_eq!(best, Some("a2"));

        crate::persistence::read_cache::close();
    }

    #[test]
    fn test_route_detail_draws_stored_representative_after_reference_change() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_representative.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let long_track = track(60);
        let short_track = long_track[30..32].to_vec();
        engine
            .add_activity("long".into(), long_track.clone(), "Ride".into())
            .expect("long activity");
        engine
            .add_activity("short".into(), short_track.clone(), "Ride".into())
            .expect("short activity");
        seed_route_group(&engine, "g1", &["long", "short"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let long_encoded = crate::persistence::codec::encode_polyline(&long_track);
        assert_eq!(
            pooled::route_detail_data(&engine.db, "g1").encoded_representative,
            long_encoded
        );

        engine
            .set_route_representative("g1", "short")
            .expect("set reference");
        let short_encoded = crate::persistence::codec::encode_polyline(&short_track);
        assert_eq!(
            pooled::route_detail_data(&engine.db, "g1").encoded_representative,
            short_encoded
        );
        crate::persistence::read_cache::close();
    }

    /// A route id nobody has returns an empty detail bundle.
    #[test]
    fn the_pooled_route_detail_is_empty_for_a_route_that_is_not_there() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_missing.db");
        let path = path.to_str().expect("utf-8");
        let engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let detail = pooled::route_detail_data(&engine.db, "nope");
        assert!(detail.group.is_none());
        assert!(detail.map_signatures.is_empty());
        assert!(detail.encoded_representative.is_empty());

        crate::persistence::read_cache::close();
    }

    /// Scenario: the athlete names a detected section, then opens an activity
    /// that crossed it. The row keeps the generated name, and the name the
    /// athlete gave lives on the named overlay.
    ///
    /// Expected behaviour: the encounters carry the athlete's name.
    /// Scenario: the activity's Routes tab draws its route's representative
    /// over the map. It read the representative's thirteen detail series for
    /// that line, and downloaded them when they were not stored.
    ///
    /// Expected behaviour: the activity read carries the representative's
    /// stored signature, and nothing for an activity in no route.
    #[test]
    fn the_activity_detail_carries_its_routes_representative_signature() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("activity_representative.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        for id in ["leader", "follower", "loner"] {
            engine
                .add_activity(id.into(), track(60), "Ride".into())
                .expect("activity");
        }
        seed_route_group(&engine, "g1", &["leader", "follower"]);
        engine.load_groups().expect("groups");

        let signature =
            crate::persistence::routes::pooled::representative_polylines(&engine.db, &["leader"])
                .remove("leader")
                .expect("stored signature");
        assert!(!signature.is_empty());

        let detail = pooled::activity_detail_data(&engine.db, "follower", 1);
        assert_eq!(detail.route_groups.len(), 1);
        assert_eq!(detail.representative_signature, signature);
        assert_eq!(
            pooled::activity_detail_data(&engine.db, "leader", 1).representative_signature,
            signature
        );
        assert!(
            pooled::activity_detail_data(&engine.db, "loner", 1)
                .representative_signature
                .is_empty()
        );
        assert!(
            pooled::activity_detail_data(&engine.db, "follower", 3)
                .representative_signature
                .is_empty()
        );

        crate::persistence::read_cache::close();
    }

    #[test]
    fn the_activity_encounters_carry_the_corridor_name() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("encounter_names.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = engine_with_a_traversed_section(path);
        engine.load_sections().expect("sections");
        engine
            .set_section_name("auto1", Some("Col du Test"))
            .expect("name the section");

        let detail = pooled::activity_detail_data(&engine.db, "a1", 1);
        let names: Vec<&str> = detail
            .encounters
            .iter()
            .map(|e| e.section_name.as_str())
            .collect();
        assert_eq!(names, vec!["Col du Test"]);
        crate::persistence::read_cache::close();
    }

    /// Scenario: the same fortnight holds a re-cut on a section the athlete
    /// renamed, on one with no name of its own, and on the lower part of a
    /// split of a named section.
    ///
    /// Expected behaviour: each change row carries the name the athlete is
    /// shown for its section, so the feed needs no catalogue read to label it.
    #[test]
    fn the_insights_section_changes_carry_the_name_shown_for_the_section() {
        let _serial = crate::test_globals::serial_global_state();
        let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
        for (index, (id, section_type, name)) in [
            ("ridge", "auto", Some("Ridge Generated")),
            ("summit", "custom", Some("Harbour Climb")),
            ("lower", "auto", None),
            ("plain", "auto", None),
        ]
        .into_iter()
        .enumerate()
        {
            let polyline = serde_json::to_string(&track(30 + index * 5)).expect("polyline");
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                           distance_meters, is_user_defined)
                     VALUES (?1, ?2, ?3, 'Ride', ?4, 800.0, ?5)",
                    rusqlite::params![id, section_type, name, polyline, section_type == "custom"],
                )
                .expect("section");
        }
        engine
            .db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details)
                 VALUES ('lower', '2026-01-01T00:00:00Z', 'formed',
                         '{\"split_from\":\"summit\",\"discriminator\":\"2\",\"line_order\":1}')",
                [],
            )
            .expect("birth");
        engine
            .set_section_name("ridge", Some("Col du Test"))
            .expect("rename");
        for id in ["ridge", "lower", "plain"] {
            engine
                .db
                .execute(
                    "INSERT INTO section_history (section_id, at, kind, details)
                     VALUES (?1, datetime('now'), 'recut', NULL)",
                    rusqlite::params![id],
                )
                .expect("recut");
        }

        let bundle = pooled::insights_data(&engine.db, &coverage_params());

        let mut shown: Vec<(&str, &str)> = bundle
            .recent_section_changes
            .iter()
            .map(|c| (c.section_id.as_str(), c.section_name.as_str()))
            .collect();
        shown.sort_unstable();
        let plain_number: u32 = engine
            .db
            .query_row(
                "SELECT number FROM section_numbers WHERE section_id = 'plain'",
                [],
                |row| row.get(0),
            )
            .expect("number");
        let plain_label = format!("{} {plain_number}", crate::persistence::get_section_word());
        assert_eq!(
            shown,
            vec![
                ("lower", "Harbour Climb / 1"),
                ("plain", plain_label.as_str()),
                ("ridge", "Col du Test"),
            ]
        );
        crate::persistence::read_cache::close();
    }

    /// Scenario: a re-cut on a section records the activity among those around
    /// it, and the athlete opens that activity.
    ///
    /// Expected behaviour: the activity screen read carries the change with its
    /// section.
    #[test]
    fn the_activity_screen_carries_the_changes_that_name_it() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("ledger_changes.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = engine_with_a_traversed_section(path);
        engine.load_sections().expect("sections");
        engine
            .append_section_history("auto1", "recut", Some(r#"{"around":["a1"]}"#), None)
            .expect("history row");

        let detail = pooled::activity_detail_data(&engine.db, "a1", 1);
        let shape: Vec<(&str, &str)> = detail
            .ledger_changes
            .iter()
            .map(|c| (c.section_id.as_str(), c.relation.as_str()))
            .collect();
        assert_eq!(shape, vec![("auto1", "around")]);
        assert!(
            pooled::activity_detail_data(&engine.db, "unknown", 1)
                .ledger_changes
                .is_empty()
        );
        crate::persistence::read_cache::close();
    }

    /// Scenario: a section the athlete drew reaches the routes list and the
    /// activity screen. Each surface decides what it offers (delete, rename,
    /// reset) from the record's type.
    ///
    /// Expected behaviour: the record says `custom` on the routes page and on
    /// the activity screen.
    #[test]
    fn a_drawn_section_reads_as_custom_on_the_routes_and_activity_screens() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("custom_type.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = engine_with_a_traversed_section(path);
        engine.load_sections().expect("sections");
        let drawn = track(60)[10..50].to_vec();
        let custom = engine
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".into(),
                distance_meters: tracematch::matching::calculate_route_distance(&drawn),
                polyline: drawn,
                name: Some("Drawn".into()),
                source_activity_id: Some("a1".into()),
                start_index: Some(10),
                end_index: Some(49),
            })
            .expect("draw a section");

        let type_on_routes = |screen: &crate::FfiRoutesScreenData| {
            screen
                .sections
                .iter()
                .find(|s| s.id == custom)
                .map(|s| s.section_type.clone())
        };
        let type_on_activity = |detail: &crate::FfiActivityDetailData| {
            let matched = detail
                .matched_sections
                .iter()
                .find(|s| s.id == custom)
                .map(|s| s.section_type.clone());
            let listed = detail
                .custom_sections
                .iter()
                .find(|s| s.id == custom)
                .map(|s| s.section_type.clone());
            matched.or(listed)
        };
        let query = crate::FfiRoutesScreenQuery::default();
        let routes_pooled = crate::persistence::pooled_routes_screen_data(&engine.db, query);
        let activity_pooled = pooled::activity_detail_data(&engine.db, "a1", 1);

        assert_eq!(type_on_routes(&routes_pooled).as_deref(), Some("custom"));
        assert_eq!(
            type_on_activity(&activity_pooled).as_deref(),
            Some("custom")
        );
        crate::persistence::read_cache::close();
    }

    /// Scenario: a route holds a 10 km ride, its representative, and a later
    /// 5 km walk.
    ///
    /// Expected behaviour: the detail read carries the representative's
    /// distance, the figure the routes list shows, and its climbing, the
    /// figure the route hero shows, never the walk's.
    #[test]
    fn test_route_detail_carries_the_representative_distance_and_climbing() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_headline.db");
        let mut engine =
            crate::persistence::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        for (id, points) in [("a1", 60), ("a2", 80)] {
            engine
                .add_activity(id.into(), track(points), "Ride".into())
                .expect("add");
        }
        let mut ride = widget_metric("a1", 1_700_000_000, 3_600);
        ride.distance = 10_000.0;
        ride.elevation_gain = 236.0;
        let mut walk = widget_metric("a2", 1_700_086_400, 3_500);
        walk.distance = 5_000.0;
        walk.elevation_gain = 40.0;
        walk.sport_type = "Walk".into();
        engine
            .set_activity_metrics(vec![ride, walk])
            .expect("metrics");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let detail = pooled::route_detail_data(&engine.db, "g1");
        assert_eq!(detail.distance_meters, 10_000.0);
        assert_eq!(detail.elevation_gain_meters, 236.0);
        let unknown = pooled::route_detail_data(&engine.db, "nope");
        assert_eq!(unknown.distance_meters, 0.0);
        assert_eq!(unknown.elevation_gain_meters, 0.0);

        crate::persistence::read_cache::close();
    }

    /// One group holding `members`, each matched forward, as detection writes
    /// it.
    fn seed_route_group(
        engine: &crate::persistence::PersistentEngine,
        group_id: &str,
        members: &[&str],
    ) {
        let ids: Vec<String> = members.iter().map(|m| m.to_string()).collect();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES (?1, ?2, ?3, 'Ride')",
                rusqlite::params![group_id, members[0], serde_json::to_string(&ids).unwrap()],
            )
            .unwrap();
        for m in members {
            engine
                .db
                .execute(
                    "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                     VALUES (?1, ?2, 0.95, 'same')",
                    rusqlite::params![group_id, m],
                )
                .unwrap();
        }
    }

    fn launch_window_engine(
        path: &str,
        recent_rides: usize,
        old_ride_days: Option<i64>,
    ) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        let now = chrono::Utc::now().timestamp();
        let mut bodies = Vec::new();
        for i in 0..recent_rides {
            bodies.push((
                format!("recent{i}"),
                now - (i as i64 + 1) * 86_400,
                "{}".to_string(),
            ));
        }
        if let Some(days) = old_ride_days {
            bodies.push(("old".to_string(), now - days * 86_400, "{}".to_string()));
        }
        let ids: Vec<String> = bodies.iter().map(|b| b.0.clone()).collect();
        let metrics = bodies
            .iter()
            .map(|b| crate::ActivityMetrics {
                activity_id: b.0.clone(),
                date: b.1,
                ..Default::default()
            })
            .collect();
        engine
            .store_synced_activity_bodies("i1", &bodies, &ids, metrics)
            .expect("bodies");
        engine
    }

    #[test]
    fn launch_data_reports_the_held_window_not_the_oldest_stored_ride() {
        let _serial = crate::test_globals::serial_global_state();
        let default = (chrono::Local::now().date_naive() - chrono::Duration::days(90)).to_string();
        let dir = tempfile::TempDir::new().expect("tempdir");

        let mut engine = launch_window_engine(
            dir.path().join("window_named.db").to_str().unwrap(),
            10,
            Some(4 * 365),
        );
        engine
            .set_setting(
                "__record_restore_pending",
                r#"[{"ground":{"rep_activity_id":"old"}}]"#,
            )
            .expect("pending record");
        let stats = engine.launch_data(Some("i1".into()), None);
        assert_eq!(stats.activity_window_oldest, default);
        assert!(
            stats.oldest_date.unwrap() < (chrono::Utc::now().timestamp() - 365 * 86_400) as f64
        );

        engine
            .record_activity_window(
                "i1",
                &(chrono::Local::now().date_naive() - chrono::Duration::days(3 * 365)).to_string(),
            )
            .expect("ask");
        let asked =
            (chrono::Local::now().date_naive() - chrono::Duration::days(3 * 365)).to_string();
        assert_eq!(
            engine
                .launch_data(Some("i1".into()), None)
                .activity_window_oldest,
            asked
        );
        assert_eq!(engine.stats().activity_window_oldest, asked);
    }

    #[test]
    fn launch_data_window_is_the_default_without_an_athlete_or_a_library() {
        let _serial = crate::test_globals::serial_global_state();
        let default = (chrono::Local::now().date_naive() - chrono::Duration::days(90)).to_string();
        let dir = tempfile::TempDir::new().expect("tempdir");

        let mut with_rides = launch_window_engine(
            dir.path().join("window_no_athlete.db").to_str().unwrap(),
            3,
            Some(4 * 365),
        );
        assert_eq!(
            with_rides.launch_data(None, None).activity_window_oldest,
            default
        );

        let mut empty = crate::persistence::PersistentEngine::new(
            dir.path().join("window_empty.db").to_str().unwrap(),
        )
        .expect("engine");
        assert_eq!(
            empty
                .launch_data(Some("i1".into()), None)
                .activity_window_oldest,
            default
        );
    }
}
