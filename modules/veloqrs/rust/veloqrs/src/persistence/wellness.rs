//! Wellness: persisted daily fitness/recovery metrics.
//!
//! Rows mirror the intervals.icu `/wellness` endpoint. Persisting them in
//! SQLite lets Rust atomics compute sparklines and HRV trends without
//! round-tripping the full array through FFI each render.

use rusqlite::{Result as SqlResult, params};

use super::PersistentRouteEngine;

/// One wellness record — shape used by upsert and range queries.
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
}

impl PersistentRouteEngine {
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
                    mood, motivation, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
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
                    updated_at = excluded.updated_at",
            )?;
            for row in rows {
                stmt.execute(params![
                    row.date,
                    row.ctl,
                    row.atl,
                    row.ramp_rate,
                    row.hrv,
                    row.resting_hr,
                    row.weight,
                    row.sleep_secs,
                    row.sleep_score,
                    row.soreness,
                    row.fatigue,
                    row.stress,
                    row.mood,
                    row.motivation,
                ])?;
            }
        }
        tx.commit()
    }

    /// Trailing N-day wellness rows, oldest first. `days` includes today.
    pub fn get_wellness_window(&self, days: u32) -> SqlResult<Vec<WellnessRow>> {
        let mut stmt = self.db.prepare(
            "SELECT date, ctl, atl, ramp_rate, hrv, resting_hr, weight,
                    sleep_secs, sleep_score, soreness, fatigue, stress,
                    mood, motivation
             FROM wellness
             ORDER BY date DESC
             LIMIT ?",
        )?;
        let rows = stmt.query_map(params![days], |r| {
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
            })
        })?;
        let mut out: Vec<WellnessRow> = rows.collect::<SqlResult<Vec<_>>>()?;
        out.reverse(); // oldest first so callers can render left-to-right
        Ok(out)
    }

    /// Sparkline arrays for the summary card: fitness/fatigue/form/hrv/rhr
    /// over the trailing `days` window. Null/missing values are forward-filled
    /// so sparkline renderers get continuous lines (matches prior TS behavior).
    /// Returns `None` when no wellness data has been synced yet.
    pub fn get_wellness_sparklines(&self, days: u32) -> SqlResult<Option<crate::FfiWellnessSparklines>> {
        let window = self.get_wellness_window(days)?;
        if window.is_empty() {
            return Ok(None);
        }

        let fitness: Vec<i32> = window
            .iter()
            .map(|w| w.ctl.unwrap_or(0.0).round() as i32)
            .collect();
        let fatigue: Vec<i32> = window
            .iter()
            .map(|w| w.atl.unwrap_or(0.0).round() as i32)
            .collect();
        let form: Vec<i32> = window
            .iter()
            .map(|w| {
                let ctl = w.ctl.unwrap_or(0.0);
                let atl = w.atl.unwrap_or(0.0);
                (ctl - atl).round() as i32
            })
            .collect();

        let hrv = forward_fill_round(window.iter().map(|w| w.hrv));
        let rhr = forward_fill_round(window.iter().map(|w| w.resting_hr));

        Ok(Some(crate::FfiWellnessSparklines {
            fitness,
            fatigue,
            form,
            hrv,
            rhr,
        }))
    }

    /// HRV trend over the trailing window. Splits the window in half and
    /// compares averages; flags consecutive-day decline (Kiviniemi 2007
    /// guidance). Returns `None` when there are fewer than 5 valid HRV days.
    pub fn compute_hrv_trend(&self, days: u32) -> SqlResult<Option<crate::FfiHrvTrend>> {
        let window = self.get_wellness_window(days)?;
        let values: Vec<f64> = window
            .iter()
            .filter_map(|w| w.hrv)
            .filter(|v| *v > 0.0)
            .collect();
        if values.len() < 5 {
            return Ok(None);
        }

        let avg = values.iter().sum::<f64>() / values.len() as f64;
        if avg <= 0.0 {
            return Ok(None);
        }

        let mid = values.len() / 2;
        let first_half = &values[..mid];
        let second_half = &values[mid..];
        let first_avg = if first_half.is_empty() {
            0.0
        } else {
            first_half.iter().sum::<f64>() / first_half.len() as f64
        };
        let second_avg = if second_half.is_empty() {
            0.0
        } else {
            second_half.iter().sum::<f64>() / second_half.len() as f64
        };

        let last_two = &values[values.len().saturating_sub(2)..];
        let consecutive_decline =
            last_two.len() == 2 && last_two[0] > last_two[1] && last_two[1] < avg;

        let label = if second_avg > first_avg * 1.02 {
            "trendingUp"
        } else if consecutive_decline || second_avg < first_avg * 0.98 {
            "trendingDown"
        } else {
            "stable"
        };

        Ok(Some(crate::FfiHrvTrend {
            label: label.to_string(),
            avg,
            latest: *values.last().unwrap_or(&0.0),
            data_points: values.len() as u32,
            sparkline: values,
        }))
    }
}

/// Forward-fill an iterator of optional floats into rounded i32s. Returns
/// an empty Vec when every value is None/zero (TS behavior).
fn forward_fill_round<I>(iter: I) -> Vec<i32>
where
    I: Iterator<Item = Option<f64>>,
{
    let raw: Vec<Option<f64>> = iter.collect();
    let first_real = raw.iter().copied().find(|v| v.is_some()).flatten();
    let Some(mut last) = first_real else {
        // Every value missing — mirror TS's `undefined` return via empty Vec.
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
