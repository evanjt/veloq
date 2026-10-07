//! Wellness: persisted daily fitness/recovery metrics.
//!
//! Rows mirror the intervals.icu `/wellness` endpoint. Persisting them in
//! SQLite lets Rust atomics compute sparklines and HRV trends without
//! round-tripping the full array through FFI each render.

use rusqlite::{Result as SqlResult, params};

use super::PersistentEngine;

/// HRV has to move by this fraction between the two halves of the window
/// before the trend is called, per Kiviniemi 2007.
const HRV_TREND_DEADBAND: f64 = 0.02;

/// One wellness record - shape used by upsert and range queries.
#[derive(Debug, Clone)]
pub struct WellnessRow {
    pub date: String,
    pub ctl: Option<f64>,
    pub atl: Option<f64>,
    pub ramp_rate: Option<f64>,
    pub hrv: Option<f64>,
    pub resting_hr: Option<f64>,
    pub weight: Option<f64>,
    pub sleep_secs: Option<i64>,
    pub sleep_score: Option<f64>,
    pub soreness: Option<i32>,
    pub fatigue: Option<i32>,
    pub stress: Option<i32>,
    pub mood: Option<i32>,
    pub motivation: Option<i32>,
    /// The untyped intervals.icu body for this day. The typed columns above
    /// are what Rust computes on; the UI reads fields beyond them.
    pub raw: Option<String>,
}

/// Today in the athlete's own timezone, which is the day their wellness rows
/// are stamped with.
pub(crate) fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

/// `days` days after `date`, or `date` itself when it cannot be read.
fn iso_days_after(date: &str, days: u32) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| (d + chrono::Duration::days(i64::from(days))).to_string())
        .unwrap_or_else(|_| date.to_string())
}

/// `days` days before `date`, or `date` itself when it cannot be read.
fn iso_days_before(date: &str, days: u32) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| (d - chrono::Duration::days(i64::from(days))).to_string())
        .unwrap_or_else(|_| date.to_string())
}

/// Drop non-finite floats (NaN / +/-Inf) to NULL so corrupt API values never
/// reach the form charts that subtract and plot them.
fn finite(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
}

/// The per-sport load entries of a stored body, dropping any that carry
/// neither a sport nor a number. A body that will not parse has none: a
/// corrupt row is a day with no breakdown, not a failed read.
fn sport_load(raw: &str) -> Vec<crate::FfiSportLoad> {
    let Ok(body) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(entries) = body.get("sportInfo").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    entries
        .iter()
        .map(|e| crate::FfiSportLoad {
            sport_group: e
                .get("type")
                .or_else(|| e.get("sportGroup"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            load: finite(e.get("load").and_then(serde_json::Value::as_f64)),
        })
        .filter(|e| e.sport_group.is_some() || e.load.is_some())
        .collect()
}

impl PersistentEngine {
    /// Upsert a batch of wellness rows in one transaction. Idempotent on
    /// `date`: re-syncing overwrites prior values.
    pub fn upsert_wellness(&mut self, rows: &[WellnessRow]) -> SqlResult<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let tx = self.db.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO wellness (
                    date, ctl, atl, ramp_rate, hrv, resting_hr, weight,
                    sleep_secs, sleep_score, soreness, fatigue, stress,
                    mood, motivation, raw, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(date) DO UPDATE SET
                    ctl = excluded.ctl,
                    atl = excluded.atl,
                    ramp_rate = excluded.ramp_rate,
                    hrv = excluded.hrv,
                    resting_hr = excluded.resting_hr,
                    weight = excluded.weight,
                    sleep_secs = excluded.sleep_secs,
                    sleep_score = excluded.sleep_score,
                    soreness = excluded.soreness,
                    fatigue = excluded.fatigue,
                    stress = excluded.stress,
                    mood = excluded.mood,
                    motivation = excluded.motivation,
                    -- A caller that only has typed values must not erase a
                    -- body a previous sync stored.
                    raw = COALESCE(excluded.raw, wellness.raw),
                    updated_at = excluded.updated_at",
            )?;
            for row in rows {
                stmt.execute(params![
                    row.date,
                    finite(row.ctl),
                    finite(row.atl),
                    finite(row.ramp_rate),
                    finite(row.hrv),
                    finite(row.resting_hr),
                    finite(row.weight),
                    row.sleep_secs,
                    finite(row.sleep_score),
                    row.soreness,
                    row.fatigue,
                    row.stress,
                    row.mood,
                    row.motivation,
                    row.raw,
                ])?;
            }
        }
        tx.commit()
    }

    /// Trailing N-day wellness rows ending on `today`, oldest first. `days`
    /// includes today, and the tests pin the end.
    ///
    /// A day the athlete has no row for is a gap, not a shorter window: rows
    /// exist only for the days intervals.icu has data for, so taking the last
    /// N rows spans as much calendar time as the gaps require and every
    /// caller reading position as date reads across them.
    pub fn get_wellness_window_to(&self, days: u32, today: &str) -> SqlResult<Vec<WellnessRow>> {
        pooled::window_to(&self.db, days, today)
    }

    /// Stored wellness days over an inclusive date window, oldest first.
    ///
    /// Typed, so no screen parses JSON to draw a chart. The per-sport loads
    /// are lifted out of the stored body, which is the only field the screens
    /// read that has no column of its own; a day synced before the body column
    /// existed simply has none.
    pub fn get_wellness_days(
        &self,
        oldest: &str,
        newest: &str,
    ) -> SqlResult<Vec<crate::FfiWellnessDay>> {
        pooled::wellness_days(&self.db, oldest, newest)
    }

    /// The newest stored wellness date, or `None` when nothing has synced.
    ///
    /// A scalar, so the insights panel can date a sync it has dropped the form
    /// cards for without pulling the rows and their CTL back across the FFI:
    /// quoting those as today's figures is the thing to avoid.
    pub fn latest_wellness_date(&self) -> SqlResult<Option<String>> {
        pooled::latest_date(&self.db)
    }

    /// The summary card's five numbers and the arrow beside each.
    ///
    /// The card derived these in TypeScript from a month of parsed bodies on
    /// every wellness invalidation, for values already stored as columns.
    pub fn wellness_summary(&self) -> crate::FfiWellnessSummary {
        pooled::summary(&self.db)
    }

    /// Sparkline arrays for the summary card: fitness/fatigue/form/hrv/rhr
    /// over the trailing `days` window. Null/missing values are forward-filled
    /// so sparkline renderers get continuous lines (matches prior TS behaviour).
    /// Returns `None` when no wellness data has been synced yet.
    pub fn get_wellness_sparklines(
        &self,
        days: u32,
    ) -> SqlResult<Option<crate::FfiWellnessSparklines>> {
        self.get_wellness_sparklines_to(days, &today_iso())
    }

    /// The same sparklines ending on `today`, which the tests pin.
    ///
    /// One entry per calendar day from the athlete's first row in the window
    /// to `today`, so a caller indexing by position reads a date: the last
    /// entry is today, the one before it is yesterday, and seven back is a
    /// week. A day with no row at all carries the last value forward, which is
    /// what a line chart draws between two points anyway.
    pub fn get_wellness_sparklines_to(
        &self,
        days: u32,
        today: &str,
    ) -> SqlResult<Option<crate::FfiWellnessSparklines>> {
        pooled::sparklines_to(&self.db, days, today)
    }

    /// The ramp rate intervals.icu computed, off the newest day in the window
    /// that carries one.
    ///
    /// Forward-filled like the sparklines rather than read off today alone: a
    /// day the athlete has not synced has no row, and the last figure they
    /// actually had is the honest answer where a zero is not.
    pub fn latest_ramp_rate(&self, days: u32) -> Option<f64> {
        self.latest_ramp_rate_to(days, &today_iso())
    }

    /// The same read ending on `today`, which the tests pin.
    pub fn latest_ramp_rate_to(&self, days: u32, today: &str) -> Option<f64> {
        pooled::latest_ramp_rate_to(&self.db, days, today)
    }

    /// HRV trend over the trailing window. Splits the window in half and
    /// compares averages; flags consecutive-day decline (Kiviniemi 2007
    /// guidance). Returns `None` when there are fewer than 5 valid HRV days.
    pub fn compute_hrv_trend(&self, days: u32) -> SqlResult<Option<crate::FfiHrvTrend>> {
        self.compute_hrv_trend_to(days, &today_iso())
    }

    /// The same trend ending on `today`, which the tests pin.
    pub fn compute_hrv_trend_to(
        &self,
        days: u32,
        today: &str,
    ) -> SqlResult<Option<crate::FfiHrvTrend>> {
        pooled::hrv_trend_to(&self.db, days, today)
    }

    /// See [`pooled::hrv_withheld_since_to`].
    pub fn hrv_withheld_since_to(&self, days: u32, today: &str) -> SqlResult<Option<String>> {
        pooled::hrv_withheld_since_to(&self.db, days, today)
    }
}

/// Each value, with a missing one holding the last real value before it.
/// Empty when nothing in the series is real.
/// A day is marked when fitness rose on the day before by more than this many
/// CTL points. The figure is the summary card plan's.
const RISE_DAY_THRESHOLD: f64 = 1.0;

/// Last plotted value minus the first, `None` below two values.
fn series_delta(series: &[i32]) -> Option<i32> {
    match (series.first(), series.last()) {
        (Some(first), Some(last)) if series.len() >= 2 => Some(last - first),
        _ => None,
    }
}

/// Indices of the days whose load rose over the day before by more than
/// `RISE_DAY_THRESHOLD`.
fn rise_days(load: &[f64]) -> Vec<u32> {
    load.windows(2)
        .enumerate()
        .filter(|(_, w)| w[1] - w[0] > RISE_DAY_THRESHOLD)
        .map(|(i, _)| (i + 1) as u32)
        .collect()
}

fn forward_fill<I>(iter: I) -> Vec<f64>
where
    I: Iterator<Item = Option<f64>>,
{
    let raw: Vec<Option<f64>> = iter.collect();
    let Some(mut last) = raw.iter().copied().find(|v| v.is_some()).flatten() else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        if let Some(val) = v {
            last = val;
        }
        out.push(last);
    }
    out
}

/// Which days of a filled series had a reading of their own, empty when the
/// series is.
fn read_days<I>(filled: &[i32], iter: I) -> Vec<bool>
where
    I: Iterator<Item = Option<f64>>,
{
    if filled.is_empty() {
        return Vec::new();
    }
    iter.map(|v| v.is_some()).collect()
}

fn forward_fill_round<I>(iter: I) -> Vec<i32>
where
    I: Iterator<Item = Option<f64>>,
{
    let raw: Vec<Option<f64>> = iter.collect();
    let first_real = raw.iter().copied().find(|v| v.is_some()).flatten();
    let Some(mut last) = first_real else {
        // Every value missing - mirror TS's `undefined` return via empty Vec.
        return Vec::new();
    };
    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        if let Some(val) = v {
            last = val;
        }
        out.push(last.round() as i32);
    }
    out
}

/// The index where the later half of `len` readings starts.
fn halves_split(len: usize) -> usize {
    len / 2
}

/// A stored `YYYY-MM-DD` day as epoch seconds at its UTC midnight, the form
/// every dated series leaves the engine in. `0.0` for a day that cannot be read.
fn date_epoch(date: &str) -> f64 {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map_or(0.0, |t| t.and_utc().timestamp() as f64)
}

/// The window's verdict, its mean, and which rule produced the verdict, split
/// out from [`PersistentEngine::compute_hrv_trend`] so the rule itself can be
/// tested without a database. `None` when the window is too short to say
/// anything.
///
/// The reason is not decoration: `trendingDown` has two causes and they are
/// different claims. `halves` is the newer half of the window sitting below
/// the older one by more than the deadband. `lastTwoDays` is a window that did
/// not move, ending on two consecutive readings that fell below its mean. The
/// card says which, so it never reports a falling average that did not fall.
fn hrv_verdict(
    values: &[f64],
    last_two_are_consecutive_days: bool,
) -> Option<(&'static str, f64, &'static str)> {
    if values.len() < 5 {
        return None;
    }
    let avg = values.iter().sum::<f64>() / values.len() as f64;
    if avg <= 0.0 {
        return None;
    }

    let mid = halves_split(values.len());
    let mean = |xs: &[f64]| {
        if xs.is_empty() {
            0.0
        } else {
            xs.iter().sum::<f64>() / xs.len() as f64
        }
    };
    let first_avg = mean(&values[..mid]);
    let second_avg = mean(&values[mid..]);

    let last_two = &values[values.len().saturating_sub(2)..];
    let consecutive_decline = last_two_are_consecutive_days
        && last_two.len() == 2
        && last_two[0] > last_two[1]
        && last_two[1] < avg;

    // Higher HRV is the better direction, so this reads as a value, not a
    // time. A consecutive decline overrides a stable verdict: two days down
    // and below the average is the signal the study leans on.
    let verdict =
        crate::trend::classify_value(first_avg, second_avg, HRV_TREND_DEADBAND).unwrap_or(0);
    let (label, reason) = if verdict > 0 {
        ("trendingUp", "halves")
    } else if verdict < 0 {
        ("trendingDown", "halves")
    } else if consecutive_decline {
        ("trendingDown", "lastTwoDays")
    } else {
        ("stable", "halves")
    };
    Some((label, avg, reason))
}

/// Wellness reads that need no engine, only its database.
///
/// The engine methods above are these same reads on the write connection, so
/// a pooled reader and a lock holder cannot answer differently.
pub(crate) mod pooled {
    use rusqlite::{Connection, Result as SqlResult, params};

    use super::{
        WellnessRow, finite, forward_fill, forward_fill_round, iso_days_after, iso_days_before,
        read_days, rise_days, series_delta, sport_load,
    };

    /// Stored wellness days over an inclusive date window, oldest first, with
    /// the per-sport loads lifted out of each stored body.
    pub(crate) fn wellness_days(
        conn: &Connection,
        oldest: &str,
        newest: &str,
    ) -> SqlResult<Vec<crate::FfiWellnessDay>> {
        let mut stmt = conn.prepare(
            "SELECT date, ctl, atl, ramp_rate, hrv, resting_hr, weight,
                    sleep_secs, sleep_score, soreness, fatigue, stress,
                    mood, motivation, raw
             FROM wellness
             WHERE date >= ? AND date <= ?
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![oldest, newest], |r| {
            let raw: Option<String> = r.get(14)?;
            Ok(crate::FfiWellnessDay {
                date: r.get(0)?,
                ctl: finite(r.get(1)?),
                atl: finite(r.get(2)?),
                ramp_rate: finite(r.get(3)?),
                hrv: finite(r.get(4)?),
                resting_hr: finite(r.get(5)?),
                weight: finite(r.get(6)?),
                sleep_secs: r.get(7)?,
                sleep_score: finite(r.get(8)?),
                soreness: r.get(9)?,
                fatigue: r.get(10)?,
                stress: r.get(11)?,
                mood: r.get(12)?,
                motivation: r.get(13)?,
                sport_load: raw.as_deref().map(sport_load).unwrap_or_default(),
            })
        })?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    /// HRV trend over the trailing window ending on `today`. Splits the window
    /// in half and compares averages; flags consecutive-day decline (Kiviniemi
    /// 2007 guidance). `None` when there are fewer than 5 valid HRV days.
    ///
    /// Read through the pool as well as through the engine, because the
    /// insights bundle carries it and is served from the pool's connection.
    pub(crate) fn hrv_trend_to(
        conn: &Connection,
        days: u32,
        today: &str,
    ) -> SqlResult<Option<crate::FfiHrvTrend>> {
        let window = window_to(conn, days, today)?;
        // A decline is two days running, so the pair the flag reads has to be
        // two days running. Rows either side of a gap are adjacent in the
        // array and days apart on the calendar.
        let last_two_adjacent = window
            .iter()
            .rev()
            .filter(|w| w.hrv.is_some_and(|v| v > 0.0))
            .take(2)
            .map(|w| w.date.clone())
            .collect::<Vec<_>>();
        let consecutive = match last_two_adjacent.as_slice() {
            [newer, older] => iso_days_before(newer, 1) == *older,
            _ => false,
        };
        let readings: Vec<(&str, f64)> = window
            .iter()
            .filter_map(|w| Some((w.date.as_str(), w.hrv?)))
            .filter(|(_, v)| *v > 0.0)
            .collect();
        let values: Vec<f64> = readings.iter().map(|(_, v)| *v).collect();
        let Some((label, avg, reason)) = super::hrv_verdict(&values, consecutive) else {
            return Ok(None);
        };

        let latest = *values.last().unwrap_or(&0.0);
        Ok(Some(crate::FfiHrvTrend {
            label: label.to_string(),
            reason: reason.to_string(),
            avg,
            latest,
            data_points: values.len() as u32,
            signal_delta: crate::signal::signal_delta(latest, avg, &values),
            window_split: (reason == "halves")
                .then(|| {
                    readings
                        .get(super::halves_split(values.len()))
                        .map(|(d, _)| super::date_epoch(d))
                })
                .flatten(),
            sparkline: readings
                .iter()
                .map(|(date, value)| crate::FfiSeriesPoint {
                    value: *value,
                    date: super::date_epoch(date),
                    activity_id: None,
                })
                .collect(),
        }))
    }

    /// The summary card's five numbers and five glyphs.
    ///
    /// Each metric takes its baseline from its own nearest row, inside a
    /// window of one lookback either side of the day it stands for: weight
    /// moves too little day to day to read, so it looks back a week, and the
    /// rest look back a day. A metric with no row in its window gets no arrow,
    /// which is not the same as a flat move, and neither does one with fewer
    /// than [`crate::claim::MIN_PRIOR_READINGS`] earlier readings in its
    /// evidence window: a week before the day, a fortnight for weight.
    pub(crate) fn summary(conn: &Connection) -> crate::FfiWellnessSummary {
        widget_summary(conn).into()
    }

    /// Wellness values with the baselines used by native widget composition.
    pub(crate) fn widget_summary(conn: &Connection) -> crate::WidgetWellnessSummary {
        let rows = newest_first(conn);
        let Some(latest) = rows.first() else {
            return crate::WidgetWellnessSummary::default();
        };

        let fitness = latest.ctl.map(f64::round);
        let fatigue = latest.atl.map(f64::round);

        let form = fitness.zip(fatigue).map(|(c, a)| c - a);

        // One row answers for both loads, the way the card's own baseline does:
        // form is a difference, so mixing two days into it would compare a
        // number against one that never existed.
        let load_baseline = baseline_on_or_before(&rows, &latest.date, DAY, |r| r.ctl);
        let prev_fitness = load_baseline.and_then(|r| r.ctl).map(f64::round);
        let prev_fatigue = load_baseline.and_then(|r| r.atl).map(f64::round);
        let prev_form = prev_fitness.zip(prev_fatigue).map(|(c, a)| c - a);

        let prev_hrv =
            baseline_on_or_before(&rows, &latest.date, DAY, |r| r.hrv).and_then(|r| r.hrv);
        let prev_rhr = baseline_on_or_before(&rows, &latest.date, DAY, |r| r.resting_hr)
            .and_then(|r| r.resting_hr);
        let prev_weight =
            baseline_on_or_before(&rows, &latest.date, WEEK, |r| r.weight).and_then(|r| r.weight);

        let both_loads = |r: &WellnessRow| r.ctl.zip(r.atl).map(|(c, _)| c);
        let fitness_basis = fitness.and(basis(&rows, &latest.date, DAY, |r| r.ctl));
        let fatigue_basis = fatigue.and(basis(&rows, &latest.date, DAY, |r| r.atl));
        let form_basis = form.and(basis(&rows, &latest.date, DAY, both_loads));
        let hrv_basis = latest.hrv.and(basis(&rows, &latest.date, DAY, |r| r.hrv));
        let rhr_basis = latest
            .resting_hr
            .and(basis(&rows, &latest.date, DAY, |r| r.resting_hr));
        let weight_basis = latest
            .weight
            .and(basis(&rows, &latest.date, WEEK, |r| r.weight));

        crate::WidgetWellnessSummary {
            fitness,
            fitness_trend: judged("fitness", fitness, prev_fitness, fitness_basis.as_ref()),
            form,
            form_trend: judged("form", form, prev_form, form_basis.as_ref()),
            hrv: latest.hrv,
            hrv_trend: judged("hrv", latest.hrv, prev_hrv, hrv_basis.as_ref()),
            rhr: latest.resting_hr,
            rhr_trend: judged("rhr", latest.resting_hr, prev_rhr, rhr_basis.as_ref()),
            weight: latest.weight,
            weight_trend: judged("weight", latest.weight, prev_weight, weight_basis.as_ref()),
            fatigue,
            fitness_previous: prev_fitness,
            fatigue_previous: prev_fatigue,
            form_previous: prev_form,
            hrv_previous: prev_hrv,
            rhr_previous: prev_rhr,
            fitness_basis,
            fatigue_basis,
            form_basis,
            hrv_basis,
            rhr_basis,
            weight_basis,
        }
    }

    /// How far back a summary arrow looks for its baseline, and how many days
    /// before the reading its earlier readings are counted over.
    #[derive(Clone, Copy)]
    struct Reach {
        lookback_days: i64,
        window_days: i64,
    }

    /// A metric read every day: the day before, out of the week before.
    const DAY: Reach = Reach {
        lookback_days: 1,
        window_days: 7,
    };

    /// Weight: a week before, out of the fortnight before.
    const WEEK: Reach = Reach {
        lookback_days: 7,
        window_days: 14,
    };

    /// The earlier readings of `field` inside the window before `latest`.
    fn basis(
        rows: &[WellnessRow],
        latest: &str,
        reach: Reach,
        field: impl Fn(&WellnessRow) -> Option<f64>,
    ) -> Option<crate::FfiClaimBasis> {
        let oldest = shift_days(latest, reach.window_days)?;
        let population = rows
            .iter()
            .filter(|r| r.date.as_str() < latest && r.date >= oldest && field(r).is_some())
            .count();
        Some(crate::FfiClaimBasis {
            baseline: crate::claim::EARLIER_READING.to_string(),
            population: population as u32,
        })
    }

    /// The glyph for a move of `current` against `baseline`, or none when the
    /// basis does not carry a claim.
    fn judged(
        name: &str,
        current: Option<f64>,
        baseline: Option<f64>,
        basis: Option<&crate::FfiClaimBasis>,
    ) -> Option<String> {
        if !crate::claim::holds(basis) {
            return None;
        }
        crate::trend_table::glyph(name, current, baseline)
    }

    /// Fitness and fatigue, as the newest day in the window
    /// has them, or `None` when the window holds no day at all.
    ///
    /// The newest day is the reading whether or not it carries figures: a day
    /// logged without an upstream fitness number reads as zero, which is what
    /// the screens deriving this in JavaScript did, and reaching past it would
    /// date the reading wrong.
    pub(crate) fn latest_form(
        conn: &Connection,
        oldest: &str,
        newest: &str,
    ) -> Option<crate::FfiInsightForm> {
        let mut stmt = conn
            .prepare(
                "SELECT date, ctl, atl FROM wellness
                 WHERE date >= ?1 AND date <= ?2
                 ORDER BY date DESC LIMIT 1",
            )
            .ok()?;
        let row = stmt
            .query_row(params![oldest, newest], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<f64>>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                ))
            })
            .ok()?;

        let ctl = row.1.unwrap_or(0.0);
        let atl = row.2.unwrap_or(0.0);
        Some(crate::FfiInsightForm {
            date: row.0,
            ctl,
            atl,
        })
    }

    /// Every stored row, newest first, which is the order the baselines walk.
    fn newest_first(conn: &Connection) -> Vec<WellnessRow> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT date, ctl, atl, ramp_rate, hrv, resting_hr, weight
             FROM wellness ORDER BY date DESC",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |r| {
            Ok(WellnessRow {
                date: r.get(0)?,
                ctl: r.get(1)?,
                atl: r.get(2)?,
                ramp_rate: r.get(3)?,
                hrv: r.get(4)?,
                resting_hr: r.get(5)?,
                weight: r.get(6)?,
                sleep_secs: None,
                sleep_score: None,
                soreness: None,
                fatigue: None,
                stress: None,
                mood: None,
                motivation: None,
                raw: None,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// The newest row carrying `field` inside the window one lookback before
    /// `latest`, and no older than two lookbacks. A row outside that window is
    /// not the day the arrow would stand for, so it is not a baseline.
    fn baseline_on_or_before<'a>(
        rows: &'a [WellnessRow],
        latest: &str,
        reach: Reach,
        field: impl Fn(&WellnessRow) -> Option<f64>,
    ) -> Option<&'a WellnessRow> {
        let newest = shift_days(latest, reach.lookback_days)?;
        let oldest = shift_days(latest, reach.lookback_days * 2)?;
        rows.iter()
            .find(|r| r.date <= newest && r.date >= oldest && field(r).is_some())
    }

    /// `date` moved back `days`, as the same `YYYY-MM-DD` spelling.
    fn shift_days(date: &str, days: i64) -> Option<String> {
        let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
        Some(
            parsed
                .checked_sub_signed(chrono::Duration::days(days))?
                .format("%Y-%m-%d")
                .to_string(),
        )
    }

    /// The newest stored wellness date, or `None` on an empty table.
    pub(crate) fn latest_date(conn: &Connection) -> SqlResult<Option<String>> {
        conn.query_row("SELECT MAX(date) FROM wellness", [], |r| r.get(0))
    }

    /// The newest stored wellness date when the `days`-long window ending on
    /// `today` holds no row at all, which is the window going stale rather
    /// than the athlete not recording. `None` when the window has a row, and
    /// when no wellness was ever synced, so neither is dated as a gap.
    pub(crate) fn hrv_withheld_since_to(
        conn: &Connection,
        days: u32,
        today: &str,
    ) -> SqlResult<Option<String>> {
        let oldest = iso_days_before(today, days.saturating_sub(1));
        Ok(latest_date(conn)?.filter(|newest| *newest < oldest))
    }

    /// The rows inside a `days`-long window ending on `today`.
    pub(crate) fn window_to(
        conn: &Connection,
        days: u32,
        today: &str,
    ) -> SqlResult<Vec<WellnessRow>> {
        let oldest = iso_days_before(today, days.saturating_sub(1));
        let mut stmt = conn.prepare(
            "SELECT date, ctl, atl, ramp_rate, hrv, resting_hr, weight,
                    sleep_secs, sleep_score, soreness, fatigue, stress,
                    mood, motivation, raw
             FROM wellness
             WHERE date >= ? AND date <= ?
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![oldest, today], |r| {
            Ok(WellnessRow {
                date: r.get(0)?,
                ctl: r.get(1)?,
                atl: r.get(2)?,
                ramp_rate: r.get(3)?,
                hrv: r.get(4)?,
                resting_hr: r.get(5)?,
                weight: r.get(6)?,
                sleep_secs: r.get(7)?,
                sleep_score: r.get(8)?,
                soreness: r.get(9)?,
                fatigue: r.get(10)?,
                stress: r.get(11)?,
                mood: r.get(12)?,
                motivation: r.get(13)?,
                raw: r.get(14)?,
            })
        })?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    /// The window with a row for every calendar day it spans, starting at the
    /// athlete's first row inside it. A day with no row of its own carries no
    /// values, so the forward fill stands in for it.
    fn daily_window(conn: &Connection, days: u32, today: &str) -> SqlResult<Vec<WellnessRow>> {
        let rows = window_to(conn, days, today)?;
        let Some(first) = rows.first().map(|r| r.date.clone()) else {
            return Ok(Vec::new());
        };
        let mut by_date: std::collections::HashMap<String, WellnessRow> =
            rows.into_iter().map(|r| (r.date.clone(), r)).collect();

        let mut out = Vec::new();
        let mut date = first;
        while date.as_str() <= today {
            let next = iso_days_after(&date, 1);
            let filled = by_date.remove(&date).unwrap_or_else(|| WellnessRow {
                date: date.clone(),
                ctl: None,
                atl: None,
                ramp_rate: None,
                hrv: None,
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
            });
            out.push(filled);
            if next == date {
                break;
            }
            date = next;
        }
        Ok(out)
    }

    /// The sparklines ending on `today`, which the tests pin.
    ///
    /// One entry per calendar day from the athlete's first row in the window to
    /// `today`, so a caller indexing by position reads a date: the last entry is
    /// today, the one before it is yesterday, and seven back is a week. A day
    /// with no row at all carries the last value forward, which is what a line
    /// chart draws between two points anyway.
    pub(crate) fn sparklines_to(
        conn: &Connection,
        days: u32,
        today: &str,
    ) -> SqlResult<Option<crate::FfiWellnessSparklines>> {
        let window = daily_window(conn, days, today)?;
        if window.is_empty() {
            return Ok(None);
        }

        // A day with no row of its own holds the last value the athlete had,
        // the same treatment `hrv` and `rhr` already got. Dropping it to zero
        // draws a cliff where the athlete simply did not sync.
        let ctl = forward_fill(window.iter().map(|w| w.ctl));
        let atl = forward_fill(window.iter().map(|w| w.atl));
        let fitness: Vec<i32> = ctl.iter().map(|v| v.round() as i32).collect();
        let fatigue: Vec<i32> = atl.iter().map(|v| v.round() as i32).collect();
        // Form is the difference of the rounded loads, as `summary` computes it,
        // so the card's hero line and its supporting row cannot differ by one.
        let form: Vec<i32> = fitness.iter().zip(&fatigue).map(|(c, a)| c - a).collect();

        let hrv = forward_fill_round(window.iter().map(|w| w.hrv));
        let rhr = forward_fill_round(window.iter().map(|w| w.resting_hr));
        let hrv_read = read_days(&hrv, window.iter().map(|w| w.hrv));
        let rhr_read = read_days(&rhr, window.iter().map(|w| w.resting_hr));

        let fitness_rise_days = rise_days(&ctl);
        Ok(Some(crate::FfiWellnessSparklines {
            fitness_delta: series_delta(&fitness),
            fitness_rise_days,
            fitness,
            fatigue,
            form,
            hrv,
            rhr,
            hrv_read,
            rhr_read,
        }))
    }

    /// The ramp rate off the newest day in the window that carries one.
    pub(crate) fn latest_ramp_rate_to(conn: &Connection, days: u32, today: &str) -> Option<f64> {
        daily_window(conn, days, today)
            .ok()?
            .iter()
            .rev()
            .find_map(|w| w.ramp_rate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_series_delta_is_last_minus_first() {
        assert_eq!(series_delta(&[52, 55, 61]), Some(9));
        assert_eq!(series_delta(&[61, 50]), Some(-11));
        assert_eq!(series_delta(&[40, 40, 40]), Some(0));
    }

    #[test]
    fn a_series_under_two_values_has_no_delta() {
        assert_eq!(series_delta(&[52]), None);
        assert_eq!(series_delta(&[]), None);
    }

    #[test]
    fn a_flat_load_series_marks_no_rise_days() {
        assert!(rise_days(&[50.0, 50.0, 50.0, 50.0]).is_empty());
    }

    #[test]
    fn one_jump_over_the_threshold_marks_exactly_that_day() {
        assert_eq!(rise_days(&[50.0, 50.4, 51.9, 51.9, 51.0]), vec![2]);
    }

    #[test]
    fn a_rise_of_exactly_the_threshold_is_not_marked() {
        assert!(rise_days(&[50.0, 51.0]).is_empty());
    }

    #[test]
    fn sparklines_carry_the_delta_and_rise_days() {
        let sp = crate::FfiWellnessSparklines::default();
        assert_eq!(sp.fitness_delta, None);
        assert!(sp.fitness_rise_days.is_empty());
    }

    #[test]
    fn a_window_under_five_days_has_no_hrv_verdict() {
        assert_eq!(hrv_verdict(&[50.0, 52.0], true), None);
        assert_eq!(hrv_verdict(&[], true), None);
    }

    #[test]
    fn a_window_averaging_zero_has_no_hrv_verdict() {
        assert_eq!(hrv_verdict(&[0.0, 0.0, 0.0, 0.0, 0.0], true), None);
    }

    #[test]
    fn a_rising_second_half_trends_up() {
        assert_eq!(
            hrv_verdict(&[40.0, 45.0, 50.0, 55.0, 60.0], true).map(|(l, _, _)| l),
            Some("trendingUp")
        );
    }

    #[test]
    fn a_falling_second_half_trends_down() {
        assert_eq!(
            hrv_verdict(&[60.0, 55.0, 50.0, 45.0, 40.0], true).map(|(l, _, _)| l),
            Some("trendingDown")
        );
    }

    #[test]
    fn a_flat_window_is_stable() {
        let verdict = hrv_verdict(&[50.0, 50.0, 50.0, 50.0, 50.0], true);
        assert_eq!(verdict.map(|(l, _, _)| l), Some("stable"));
        assert_eq!(verdict.map(|(_, avg, _)| avg), Some(50.0));
    }

    #[test]
    fn a_move_inside_the_deadband_is_stable() {
        // Second half is 1 % above the first, under the 2 % deadband, and the
        // last two days rise so the decline override cannot fire.
        assert_eq!(
            hrv_verdict(&[50.0, 50.0, 50.0, 50.0, 50.5], true).map(|(l, _, _)| l),
            Some("stable")
        );
    }

    #[test]
    fn a_drop_across_a_gap_does_not_override_stable() {
        // The same values, with the last two rows days apart rather than one.
        // Two days running is the rule, so a pair that is not two days
        // running cannot fire it.
        assert_eq!(
            hrv_verdict(&[50.0, 50.0, 50.0, 51.0, 49.0], false).map(|(l, _, _)| l),
            Some("stable")
        );
    }

    #[test]
    fn two_days_down_and_below_average_overrides_stable() {
        // Halves are within the deadband, but the window ends on a drop that
        // sits under the window average.
        assert_eq!(
            hrv_verdict(&[50.0, 50.0, 50.0, 51.0, 49.0], true).map(|(l, _, _)| l),
            Some("trendingDown")
        );
    }

    /// The card says why the verdict came out as it did, so which of the two
    /// rules fired has to reach the copy. Both end in `trendingDown` and they
    /// are not the same claim: one is the window moving, the other is two
    /// readings falling under a window that did not move.
    #[test]
    fn a_window_whose_halves_moved_says_the_halves_did_it() {
        assert_eq!(
            hrv_verdict(&[60.0, 55.0, 50.0, 45.0, 40.0], true).map(|(_, _, r)| r),
            Some("halves")
        );
    }

    #[test]
    fn a_decline_the_override_found_says_it_was_the_last_two_days() {
        let verdict = hrv_verdict(&[50.0, 50.0, 50.0, 51.0, 49.0], true);
        assert_eq!(verdict.map(|(l, _, _)| l), Some("trendingDown"));
        assert_eq!(verdict.map(|(_, _, r)| r), Some("lastTwoDays"));
    }

    #[test]
    fn a_rise_and_a_flat_window_are_both_the_halves() {
        assert_eq!(
            hrv_verdict(&[40.0, 45.0, 50.0, 55.0, 60.0], true).map(|(_, _, r)| r),
            Some("halves")
        );
        assert_eq!(
            hrv_verdict(&[50.0, 50.0, 50.0, 50.0, 50.0], false).map(|(_, _, r)| r),
            Some("halves")
        );
    }

    #[test]
    fn finite_drops_non_finite_floats() {
        assert_eq!(finite(Some(f64::NAN)), None);
        assert_eq!(finite(Some(f64::INFINITY)), None);
        assert_eq!(finite(Some(f64::NEG_INFINITY)), None);
        assert_eq!(finite(Some(42.0)), Some(42.0));
        assert_eq!(finite(Some(0.0)), Some(0.0));
        assert_eq!(finite(None), None);
    }
}
