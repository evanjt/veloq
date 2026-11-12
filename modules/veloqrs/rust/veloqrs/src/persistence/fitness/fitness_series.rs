//! Fitness, fatigue, form and ramp rate worked out from Veloq's own loads for
//! a library with no intervals.icu account.
//!
//! The daily sum of the loads stored on the activities is folded into two
//! exponentially weighted averages, fitness over the longer time constant and
//! fatigue over the shorter, and written to the wellness rows every fitness
//! surface already reads, marked `veloq`. Form is the difference of the two
//! and is not stored. The ramp rate is the week's change in fitness.

use chrono::{Duration, NaiveDate};
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::HashMap;

/// The mark on a wellness day Veloq folded from its own loads.
pub(crate) const SOURCE_VELOQ: &str = "veloq";

/// Days between a day and the one its ramp rate is measured against.
const RAMP_DAYS: i64 = 7;

/// Two figures this close are the same figure.
const SAME: f64 = 1e-9;

/// The share of a day's load that enters an average over `days`.
pub(crate) fn smoothing_weight(days: u32) -> f64 {
    1.0 - (-1.0 / f64::from(days)).exp()
}

/// One day of the series.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Day {
    fitness: f64,
    fatigue: f64,
    ramp_rate: f64,
}

/// The load of one day, and the part of it that counts towards fitness.
struct Load {
    all: f64,
    fitness: f64,
}

/// The daily loads of the activities stored, by local date.
fn daily_loads(conn: &Connection) -> SqlResult<HashMap<NaiveDate, Load>> {
    let mut stmt = conn.prepare(
        "SELECT date(m.date, 'unixepoch'), SUM(m.training_load),
                SUM(CASE WHEN m.sport_type = 'WeightTraining' THEN 0 ELSE m.training_load END)
           FROM activity_metrics m
          WHERE m.training_load >= 0
            AND EXISTS (SELECT 1 FROM activities a WHERE a.id = m.activity_id)
          GROUP BY 1",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
        ))
    })?;
    let mut loads = HashMap::new();
    for row in rows {
        let (date, all, fitness) = row?;
        if let Ok(date) = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            && all.is_finite()
            && fitness.is_finite()
        {
            loads.insert(date, Load { all, fitness });
        }
    }
    Ok(loads)
}

/// The series from `first` to `last`, a day at a time, each day's time
/// constants those in effect on it. Both averages start at nothing the day
/// before `first`.
fn series(
    loads: &HashMap<NaiveDate, Load>,
    first: NaiveDate,
    last: NaiveDate,
    events: &str,
) -> Vec<(NaiveDate, Day)> {
    let mut out: Vec<(NaiveDate, Day)> = Vec::new();
    let (mut fitness, mut fatigue) = (0.0, 0.0);
    let mut date = first;
    while date <= last {
        let (fitness_days, fatigue_days) =
            crate::persistence::screens::fitness_days_on(events, date);
        let load = loads.get(&date);
        fitness += (load.map_or(0.0, |l| l.fitness) - fitness) * smoothing_weight(fitness_days);
        fatigue += (load.map_or(0.0, |l| l.all) - fatigue) * smoothing_weight(fatigue_days);
        let week_ago = out
            .len()
            .checked_sub(RAMP_DAYS as usize)
            .map_or(0.0, |i| out[i].1.fitness);
        out.push((
            date,
            Day {
                fitness,
                fatigue,
                ramp_rate: fitness - week_ago,
            },
        ));
        date += Duration::days(1);
    }
    out
}

/// The figures a wellness row holds, and whose they are.
#[derive(Debug, PartialEq)]
struct Held {
    ctl: Option<f64>,
    atl: Option<f64>,
    ramp_rate: Option<f64>,
    source: Option<String>,
}

/// The stored figures of each day in the window.
fn stored(
    conn: &Connection,
    first: NaiveDate,
    last: NaiveDate,
) -> SqlResult<HashMap<String, Held>> {
    let mut stmt = conn.prepare(
        "SELECT date, ctl, atl, ramp_rate, source FROM wellness WHERE date BETWEEN ?1 AND ?2",
    )?;
    let rows = stmt.query_map(params![first.to_string(), last.to_string()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            Held {
                ctl: row.get(1)?,
                atl: row.get(2)?,
                ramp_rate: row.get(3)?,
                source: row.get(4)?,
            },
        ))
    })?;
    rows.collect()
}

fn same(stored: Option<f64>, computed: f64) -> bool {
    stored.is_some_and(|s| (s - computed).abs() < SAME)
}

/// Fold the daily loads into the wellness rows from the first day with a load
/// through `today`, and answer how many rows were written.
///
/// Does nothing in a library that holds anything from intervals.icu. A day
/// that already carries fitness or fatigue not marked as Veloq's is left as it
/// is; a day holding only a body is filled in and keeps it. A day whose figures
/// are already what the series gives is not written again.
pub(crate) fn refresh(conn: &Connection, today: &str) -> SqlResult<usize> {
    if !super::curves_local::is_garmin_only(conn)? {
        return Ok(0);
    }
    let loads = daily_loads(conn)?;
    let Some(first) = loads.keys().min().copied() else {
        return Ok(0);
    };
    let newest = loads.keys().max().copied().unwrap_or(first);
    let last =
        NaiveDate::parse_from_str(today, "%Y-%m-%d").map_or(newest, |today| today.max(newest));
    let events = crate::persistence::settings::setting_from(
        conn,
        crate::persistence::settings_keys::FITNESS_MODEL_EVENTS,
    )?
    .unwrap_or_default();
    let days = series(&loads, first, last, &events);
    let held = stored(conn, first, last)?;

    conn.execute_batch("SAVEPOINT fitness_series")?;
    let written = (|| {
        let mut upsert = conn.prepare(
            "INSERT INTO wellness (date, ctl, atl, ramp_rate, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
             ON CONFLICT(date) DO UPDATE SET
                ctl = excluded.ctl,
                atl = excluded.atl,
                ramp_rate = excluded.ramp_rate,
                source = excluded.source,
                updated_at = excluded.updated_at",
        )?;
        let mut written = 0;
        for (date, day) in &days {
            let key = date.to_string();
            if let Some(Held {
                ctl,
                atl,
                ramp_rate: ramp,
                source,
            }) = held.get(&key)
            {
                if source.as_deref() != Some(SOURCE_VELOQ) && (ctl.is_some() || atl.is_some()) {
                    continue;
                }
                if source.as_deref() == Some(SOURCE_VELOQ)
                    && same(*ctl, day.fitness)
                    && same(*atl, day.fatigue)
                    && same(*ramp, day.ramp_rate)
                {
                    continue;
                }
            }
            upsert.execute(params![
                key,
                day.fitness,
                day.fatigue,
                day.ramp_rate,
                SOURCE_VELOQ
            ])?;
            written += 1;
        }
        Ok::<_, rusqlite::Error>(written)
    })();
    match written {
        Ok(written) => {
            conn.execute_batch("RELEASE fitness_series")?;
            Ok(written)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO fitness_series; RELEASE fitness_series");
            Err(error)
        }
    }
}

#[cfg(test)]
#[path = "tests/fitness_series.rs"]
mod tests;
