//! What a library keeps of Veloq's own figures once it holds intervals.icu.
//!
//! A library with no intervals.icu account works its ride figures, wellness
//! series and curves out on the phone and marks each as Veloq's. Once the
//! library holds anything from intervals.icu it shows none of them: the
//! server's numbers take their place as the sync delivers them, and what the
//! server has not served is empty rather than Veloq's. This module is the one
//! place that removes the marked figures, and it runs inside the write that
//! stores a synced page, after the page has replaced what it names.

use rusqlite::{Connection, Result as SqlResult, params};
use serde_json::Value;

use super::PersistentEngine;
use super::fitness::curves_local::{ENTRY_MARK, SOURCE_LOCAL as CURVE_MARK, is_garmin_only};
use super::fitness::fitness_series::SOURCE_VELOQ as SERIES_MARK;
use super::fitness::ride_metrics::{BODY_KEYS, SOURCE_VELOQ as RIDE_MARK};
use crate::ActivityMetrics;

impl PersistentEngine {
    /// Remove every figure marked as Veloq's from a library that holds
    /// intervals.icu, and answer the metrics rows it rewrote so the caller can
    /// refresh the in-memory copies. Does nothing in a library with no
    /// intervals.icu activity.
    ///
    /// Runs inside the caller's transaction. A ride keeps the rest of its body
    /// and its streams; only the figures worked out from them go.
    pub(crate) fn drop_veloq_figures(&self) -> SqlResult<Vec<ActivityMetrics>> {
        if is_garmin_only(&self.db)? {
            return Ok(Vec::new());
        }
        let rewritten = self.drop_ride_figures()?;
        drop_wellness_figures(&self.db)?;
        drop_curves(&self.db)?;
        Ok(rewritten)
    }

    /// Strip the figures from each ride marked as Veloq's and write its row
    /// again without them.
    fn drop_ride_figures(&self) -> SqlResult<Vec<ActivityMetrics>> {
        let marked: Vec<(String, i64, String)> = self
            .db
            .prepare(
                "SELECT m.activity_id, b.date, b.raw
                   FROM activity_metrics m
                   JOIN activity_bodies b ON b.activity_id = m.activity_id
                  WHERE m.metrics_source = ?1",
            )?
            .query_map(params![RIDE_MARK], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<SqlResult<_>>()?;
        let mut rewritten = Vec::with_capacity(marked.len());
        for (id, date, raw) in marked {
            let Ok(mut body) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            if let Some(map) = body.as_object_mut() {
                for key in BODY_KEYS {
                    map.remove(key);
                }
            }
            let stripped = body.to_string();
            self.db.execute(
                "UPDATE activity_bodies SET raw = ?2, updated_at = strftime('%s', 'now')
                  WHERE activity_id = ?1",
                params![id, stripped],
            )?;
            let row = crate::net::intervals::metrics_from_body(&stripped, date, &id)?;
            self.write_activity_metrics(&[&row], true)?;
            rewritten.push(row);
        }
        Ok(rewritten)
    }
}

/// Clear the fitness series Veloq folded and the eFTP entries it wrote into
/// the wellness days, leaving every other column and key of a day as it is. A
/// day left holding nothing is removed.
fn drop_wellness_figures(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "UPDATE wellness SET ctl = NULL, atl = NULL, ramp_rate = NULL, source = NULL
          WHERE source = ?1",
        params![SERIES_MARK],
    )?;
    let marked: Vec<(String, String)> = conn
        .prepare("SELECT date, raw FROM wellness WHERE raw LIKE ?1")?
        .query_map(
            params![format!("%\"{ENTRY_MARK}\":\"{RIDE_MARK}\"%")],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
        .collect::<SqlResult<_>>()?;
    for (date, raw) in marked {
        let Ok(mut body) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if let Some(Value::Array(entries)) = body.get_mut("sportInfo") {
            entries
                .retain(|entry| entry.get(ENTRY_MARK).and_then(Value::as_str) != Some(RIDE_MARK));
            if entries.is_empty() {
                body.as_object_mut().map(|map| map.remove("sportInfo"));
            }
        }
        let emptied = body.as_object().is_some_and(|map| map.is_empty());
        conn.execute(
            "UPDATE wellness SET raw = ?2, updated_at = strftime('%s', 'now') WHERE date = ?1",
            params![date, (!emptied).then(|| body.to_string())],
        )?;
    }
    conn.execute(
        "DELETE FROM wellness
          WHERE raw IS NULL AND ctl IS NULL AND atl IS NULL AND ramp_rate IS NULL
            AND hrv IS NULL AND resting_hr IS NULL AND weight IS NULL
            AND sleep_secs IS NULL AND sleep_score IS NULL AND soreness IS NULL
            AND fatigue IS NULL AND stress IS NULL AND mood IS NULL AND motivation IS NULL",
        [],
    )?;
    Ok(())
}

/// Remove the library curves worked out here and the per-ride figures they
/// were made from. A server body is never one of them.
fn drop_curves(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM curve_bodies WHERE source = ?1",
        params![CURVE_MARK],
    )?;
    conn.execute("DELETE FROM activity_curves", [])?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/adoption.rs"]
mod tests;
