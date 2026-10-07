//! Fitness derivations: trends, aggregates, calendars, highlights.
//!
//! Built on top of stored activity metrics and section performances - nothing
//! here mutates persisted state, with the exception of `save_pace_snapshot`
//! which records a trend sample.

use chrono::{DateTime, Datelike};
use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::super::PersistentEngine;

/// The cycling `sportInfo` entry's model estimate, rounded, or none when the
/// day carries no cycling entry.
fn cycling_eftp(raw: &str) -> Option<u16> {
    let body: serde_json::Value = serde_json::from_str(raw).ok()?;
    let entries = body.get("sportInfo")?.as_array()?;
    let entry = entries.iter().find(|e| {
        e.get("type")
            .and_then(|t| t.as_str())
            .is_some_and(crate::sport::is_cycling)
    })?;
    let eftp = entry.get("eftp")?.as_f64()?;
    (eftp.is_finite() && eftp > 0.0).then(|| eftp.round() as u16)
}

/// The days the FTP trend reads, from a newest-first stream of stored bodies.
///
/// It pulls until it holds the newest day carrying a cycling estimate and the
/// newest one at least `lookback` days older, then stops. The whole table used
/// to be parsed for those two: wellness is upserted 365 days a sync and the
/// only delete is the full wipe, so it grows a year per year of use.
///
/// A day with no cycling entry is skipped and never counts as the newest, so a
/// month off the bike is read through rather than reported as no trend. An
/// account that has never ridden reads to the end, which is the price of
/// knowing there is nothing.
///
/// Returned oldest first, which is the order the trend reads them in.
fn trend_days(rows: impl Iterator<Item = (String, String)>, lookback: i64) -> Vec<(String, u16)> {
    let mut days: Vec<(String, u16)> = Vec::new();
    let mut cutoff: Option<String> = None;
    for (date, raw) in rows {
        let Some(ftp) = cycling_eftp(&raw) else {
            continue;
        };
        let cutoff = cutoff.get_or_insert_with(|| day_offset(&date, -lookback));
        let old_enough = date.as_str() <= cutoff.as_str();
        days.push((date, ftp));
        if old_enough {
            break;
        }
    }
    days.reverse();
    days
}

/// A `YYYY-MM-DD` day shifted by whole days, in the same shape.
fn day_offset(date: &str, days: i64) -> String {
    match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => (d + chrono::Duration::days(days))
            .format("%Y-%m-%d")
            .to_string(),
        Err(_) => date.to_string(),
    }
}

/// Midnight UTC of a `YYYY-MM-DD` day, which is the unit the record carries.
fn epoch_seconds(date: &str) -> i64 {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| dt.and_utc().timestamp())
        .unwrap_or(0)
}

/// The summary card's reads, over a connection rather than the engine.
///
/// Every one of these was already a plain query on `self.db`, touching nothing
/// the engine holds in memory, which is what makes the feed's first paint
/// servable from a pooled read-only connection while a write is in flight. The
/// methods above are the same functions on the write connection.
/// One local day's recorded load from the loads of its activities, `None`
/// where an activity carries none. An explicit zero is a known load.
fn day_load(date: &str, loads: &[Option<f64>]) -> crate::FfiDayLoad {
    use crate::FfiDayLoadStatus::{Complete, Partial, Rest, Unavailable};
    let known: Vec<f64> = loads.iter().flatten().copied().collect();
    let (status, total) = match (loads.len(), known.len()) {
        (0, _) => (Rest, None),
        (_, 0) => (Unavailable, None),
        (all, some) => (
            if all == some { Complete } else { Partial },
            Some(known.iter().sum()),
        ),
    };
    crate::FfiDayLoad {
        date: date.to_string(),
        status,
        total,
        activity_count: loads.len() as u32,
    }
}

pub(crate) mod pooled {

    /// The efficiency trend for one section, with its name and length handed
    /// in: the engine reads those off the in-memory catalogue and a pooled
    /// caller off the row, and neither belongs in this query.
    pub(crate) fn section_efficiency_trend(
        conn: &Connection,
        section_id: &str,
        sport_type: &str,
        section_name: &str,
        section_distance_meters: f64,
    ) -> Option<crate::FfiEfficiencyTrend> {
        let section_name = section_name.to_string();
        let section_distance_km = section_distance_meters / 1000.0;

        if section_distance_km <= 0.0 {
            return None;
        }

        // Query section_activities joined with activity_metrics for date,
        // filtering to one sport's complete traversals with both lap_time and
        // avg_hr: a fragment's pace is its own ground's, not the section's,
        // and a ride's pace against a run's is not one series.
        let complete = crate::persistence::records::complete_traversal_clause("sa", "s");
        let mut stmt = conn
            .prepare(&format!(
                "SELECT sa.lap_time, sa.avg_hr, sa.distance_meters, am.date
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 LEFT JOIN sections s ON s.id = sa.section_id
                 WHERE sa.section_id = ?1
                   AND am.sport_type = ?2
                   AND sa.excluded = 0
                   AND sa.lap_time IS NOT NULL
                   AND sa.avg_hr IS NOT NULL
                   AND sa.lap_time > 0
                   AND sa.avg_hr > 0{complete}
                 ORDER BY am.date ASC"
            ))
            .map_err(|e| {
                log::warn!(
                    "[fitness] get_section_efficiency_trend: prepare failed for section {}: {}",
                    section_id,
                    e
                );
                e
            })
            .ok()?;

        struct EffortRow {
            lap_time: f64,
            avg_hr: f64,
            distance_meters: f64,
            date: i64,
        }

        let rows: Vec<EffortRow> = stmt
            .query_map(rusqlite::params![section_id, sport_type], |row| {
                Ok(EffortRow {
                    lap_time: row.get(0)?,
                    avg_hr: row.get(1)?,
                    distance_meters: row.get(2)?,
                    date: row.get(3)?,
                })
            })
            .map_err(|e| {
                log::warn!("[fitness] get_section_efficiency_trend: query_map failed for section {}: {}", section_id, e);
                e
            })
            .ok()?
            .filter_map(|r| match r {
                Ok(row) => Some(row),
                Err(e) => {
                    log::warn!("[fitness] get_section_efficiency_trend: skipping corrupt row for section {}: {}", section_id, e);
                    None
                }
            })
            .collect();

        // Need at least 3 data points for a meaningful trend
        if rows.len() < 3 {
            return None;
        }

        // Build efficiency points
        let points: Vec<crate::FfiEfficiencyPoint> = rows
            .iter()
            .filter_map(|row| {
                // Use actual traversal distance for pace calculation
                let distance_km = row.distance_meters / 1000.0;
                if distance_km <= 0.0 {
                    return None;
                }
                let pace_secs_per_km = row.lap_time / distance_km;
                // Sanity check: pace should be reasonable (1 min/km to 30 min/km)
                if !(60.0..=1800.0).contains(&pace_secs_per_km) {
                    return None;
                }
                // Heart rate per unit of speed. Dividing by seconds per km
                // had pace the wrong way up: a slower effort carries more
                // seconds per km, so the same heart rate over a slower effort
                // read as a lower cost and the card called it an adaptation.
                let hr_pace_ratio = row.avg_hr * pace_secs_per_km;
                Some(crate::FfiEfficiencyPoint {
                    date: row.date as f64,
                    pace_secs_per_km,
                    avg_hr: row.avg_hr,
                    hr_pace_ratio,
                })
            })
            .collect();

        if points.len() < 3 {
            return None;
        }

        // Linear regression on hr_pace_ratio over time
        // x = days since first effort, y = hr_pace_ratio
        let first_date = points[0].date;
        let regression_points: Vec<(f64, f64)> = points
            .iter()
            .map(|p| {
                let days = (p.date - first_date) / 86400.0;
                (days, p.hr_pace_ratio)
            })
            .collect();

        let (slope, _intercept) = super::linear_regression(&regression_points);

        // Time range in days
        let time_range_days = regression_points.last().map(|(x, _)| *x).unwrap_or(0.0);

        // The ratio is heart rate times seconds per km, so heart rate at a
        // given pace is the ratio divided by it: at the mean pace, HR change
        // is slope / mean_pace over the window. It is the ratio's own movement
        // restated in beats, not a measured heart rate delta, so an effort set
        // that only changed pace still moves it. A card states the direction
        // of this modelled change after the regression clears its threshold.
        let mean_pace: f64 =
            points.iter().map(|p| p.pace_secs_per_km).sum::<f64>() / points.len() as f64;
        let hr_change_bpm = slope * time_range_days / mean_pace;

        // Improving when the cost of a given speed is falling by a fifth of a
        // percent a day, which is the rate the old absolute -0.001 stood for
        // on the ratio it was written against: a heart rate of 150 over 300
        // seconds per km gave 0.5, and -0.001 of that is -0.2% a day.
        const IMPROVING_FRACTION_PER_DAY: f64 = 0.002;
        let mean_ratio: f64 =
            points.iter().map(|p| p.hr_pace_ratio).sum::<f64>() / points.len() as f64;
        let direction = if slope < -IMPROVING_FRACTION_PER_DAY * mean_ratio && points.len() >= 5 {
            crate::EfficiencyDirection::Improving
        } else if slope > IMPROVING_FRACTION_PER_DAY * mean_ratio && points.len() >= 5 {
            crate::EfficiencyDirection::Worsening
        } else {
            crate::EfficiencyDirection::Flat
        };

        // The newest matched effort against the mean of the series it belongs
        // to. One ratio per effort is the only spread there is, and the ranker
        // reads the distance rather than the ratios.
        let effort_count = points.len() as u32;
        let ratios: Vec<f64> = points.iter().map(|p| p.hr_pace_ratio).collect();
        let signal_delta = crate::signal::mean(&ratios).and_then(|mean| {
            crate::signal::signal_delta(*ratios.last().expect("points is not empty"), mean, &ratios)
        });

        Some(crate::FfiEfficiencyTrend {
            section_id: section_id.to_string(),
            sport_type: sport_type.to_string(),
            section_name,
            points,
            trend_slope: slope,
            direction,
            hr_change_bpm,
            effort_count,
            signal_delta,
        })
    }
    use std::collections::HashSet;

    /// Every section this activity traversed, with the history each traversal
    /// is measured against.
    ///
    /// Two queries on committed rows and no memory tier, which is why the engine
    /// method is a one-line delegate to this. `names` is the named overlay, so an
    /// auto section the athlete named reads by that name rather than its row's.
    pub(crate) fn activity_section_encounters(
        conn: &Connection,
        activity_id: &str,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Vec<crate::ffi_types::FfiSectionEncounter> {
        use crate::ffi_types::FfiSectionEncounter;

        let visible_filter = "s.disabled = 0 AND s.superseded_by IS NULL";
        // A record is only ever a complete traversal: not a `partial` overlap,
        // and covering enough of the section, the rule the section screen, the
        // ranking and the feed apply. A fragment stays an encounter, takes no
        // trophy, and is never anyone's rival.
        let complete = crate::persistence::records::complete_traversal_clause("sa", "s");

        // Get this activity's traversals with section metadata, a complete
        // traversal ahead of a fragment of the same pair.
        let query = format!(
            "SELECT sa.section_id, s.section_type, COALESCE(s.name, ''), sa.direction,
                    sa.distance_meters, COALESCE(sa.lap_time, 0.0),
                    CASE WHEN sa.lap_pace > 0 THEN sa.lap_pace
                         WHEN sa.lap_time > 0 THEN sa.distance_meters / sa.lap_time
                         ELSE 0.0 END,
                    (1 = 1{complete}) AS complete, sa.start_index
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE sa.activity_id = ?1 AND sa.excluded = 0 AND {visible_filter}
             ORDER BY sa.section_id, sa.direction, complete DESC,
                      CASE WHEN sa.lap_time IS NULL OR sa.lap_time <= 0 THEN 1 ELSE 0 END,
                      sa.lap_time ASC"
        );

        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        struct Traversal {
            section_id: String,
            section_type: String,
            section_name: String,
            direction: String,
            distance_meters: f64,
            lap_time: f64,
            lap_pace: f64,
            complete: bool,
            start_index: u32,
        }

        let passes: Vec<Traversal> = stmt
            .query_map(rusqlite::params![activity_id], |row| {
                Ok(Traversal {
                    section_id: row.get(0)?,
                    section_type: row.get(1)?,
                    section_name: row.get(2)?,
                    direction: row.get(3)?,
                    distance_meters: row.get(4)?,
                    lap_time: row.get(5)?,
                    lap_pace: row.get(6)?,
                    complete: row.get(7)?,
                    start_index: row.get::<_, i64>(8)?.max(0) as u32,
                })
            })
            .ok()
            .map(|rows| {
                rows.filter_map(|r| r.ok())
                    .map(|mut pass: Traversal| {
                        if let Some(name) = names.get(&pass.section_id) {
                            pass.section_name = name.clone();
                        }
                        pass
                    })
                    .collect()
            })
            .unwrap_or_default();

        // A pair is placed where the track first enters it, whichever lap is
        // the best-timed one.
        let mut first_entry: std::collections::HashMap<(String, String), u32> =
            std::collections::HashMap::new();
        for pass in &passes {
            first_entry
                .entry((pass.section_id.clone(), pass.direction.clone()))
                .and_modify(|first| *first = (*first).min(pass.start_index))
                .or_insert(pass.start_index);
        }

        // Best-timed first, so the first pass of a pair represents it.
        let mut seen_pairs: HashSet<(String, String)> = HashSet::new();
        let complete_sections: HashSet<String> = passes
            .iter()
            .filter(|t| t.complete)
            .map(|t| t.section_id.clone())
            .collect();
        let mut traversals: Vec<Traversal> = passes
            .into_iter()
            .filter(|t| t.complete || !complete_sections.contains(t.section_id.as_str()))
            .filter(|t| seen_pairs.insert((t.section_id.clone(), t.direction.clone())))
            .map(|mut t| {
                if let Some(first) = first_entry.get(&(t.section_id.clone(), t.direction.clone())) {
                    t.start_index = *first;
                }
                t
            })
            .collect();
        traversals.sort_by(|a, b| {
            (a.start_index, &a.section_id, &a.direction).cmp(&(
                b.start_index,
                &b.section_id,
                &b.direction,
            ))
        });

        let mut encounters = Vec::new();

        for trav in &traversals {
            // History for this (section, direction), in this activity's sport: a
            // run's progress over shared ground is its own, not the rides'.
            let history_query = format!(
                "SELECT sa.lap_time, sa.activity_id, COALESCE(a.start_date, 0) as act_date
                 FROM section_activities sa
                 JOIN activities a ON a.id = sa.activity_id
                 LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
                 LEFT JOIN sections s ON s.id = sa.section_id
                 WHERE sa.section_id = ?1 AND sa.direction = ?2
                   AND COALESCE(am.sport_type, a.sport_type) = (
                       SELECT COALESCE(current_metrics.sport_type, current_activity.sport_type)
                       FROM activities current_activity
                       LEFT JOIN activity_metrics current_metrics
                         ON current_metrics.activity_id = current_activity.id
                       WHERE current_activity.id = ?3)
                   AND sa.excluded = 0 AND sa.lap_time IS NOT NULL AND sa.lap_time > 0{complete}
                 ORDER BY act_date ASC"
            );

            let mut history_times: Vec<f64> = Vec::new();
            let mut history_ids: Vec<String> = Vec::new();
            // The best of the outings other than this one. This activity's own
            // rows are excluded rather than merely out-competed, so a lapped
            // session cannot manufacture a record against its own laps.
            let mut rival: Option<f64> = None;

            if trav.direction != "partial" {
                let mut hist_stmt = match conn.prepare(&history_query) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                if let Ok(rows) = hist_stmt.query_map(
                    rusqlite::params![trav.section_id, trav.direction, activity_id],
                    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, String>(1)?)),
                ) {
                    for row in rows.flatten() {
                        if row.1 != activity_id && rival.is_none_or(|r| row.0 < r) {
                            rival = Some(row.0);
                        }
                        history_times.push(row.0);
                        history_ids.push(row.1);
                    }
                }
            }
            debug_assert_eq!(history_times.len(), history_ids.len());

            let rivals: Vec<f64> = history_times
                .iter()
                .zip(&history_ids)
                .filter(|(_, id)| id.as_str() != activity_id)
                .map(|(t, _)| *t)
                .collect();
            let rank = if trav.complete {
                crate::persistence::records::podium_place(trav.lap_time, &rivals)
            } else {
                None
            };
            let is_pr = rank == Some(1);

            encounters.push(FfiSectionEncounter {
                section_id: trav.section_id.clone(),
                section_type: trav.section_type.clone(),
                section_name: trav.section_name.clone(),
                direction: trav.direction.clone(),
                distance_meters: trav.distance_meters,
                start_index: trav.start_index,
                lap_time: trav.lap_time,
                lap_pace: trav.lap_pace,
                is_pr,
                is_complete: trav.complete,
                rank,
                visit_count: history_times.len() as u32,
                history_times,
                history_activity_ids: history_ids,
            });
        }

        encounters
    }

    use super::{day_offset, epoch_seconds, trend_days};
    use rusqlite::{Connection, Result as SqlResult, params};

    /// Route highlights for `activity_ids`, read from the tables the engine's
    /// in-memory groups are loaded from.
    ///
    /// The same computation as [`super::PersistentEngine::get_activity_route_highlights`],
    /// over committed rows. Only the groups holding a requested activity are
    /// loaded in full, and only their members' efforts, so the cost is the
    /// requested route rather than the library.
    pub fn route_highlights(
        conn: &Connection,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityRouteHighlight> {
        use super::highlights::GroupView;
        use std::collections::{HashMap, HashSet};

        if activity_ids.is_empty() {
            log::debug!("route_highlights: groups=0 members=0 prs=0 trends=0");
            return Vec::new();
        }
        let requested: HashSet<&str> = activity_ids.iter().map(|s| s.as_str()).collect();

        let groups: Vec<(String, Vec<String>)> = group_membership(conn)
            .into_iter()
            .filter(|(_, members)| members.iter().any(|m| requested.contains(m.as_str())))
            .collect();
        if groups.is_empty() {
            log::debug!("route_highlights: groups=0 members=0 prs=0 trends=0");
            return Vec::new();
        }

        let views: Vec<GroupView<'_>> = groups
            .iter()
            .map(|(id, members)| GroupView {
                group_id: id.as_str(),
                activity_ids: members,
            })
            .collect();

        let group_ids: Vec<&str> = groups.iter().map(|(id, _)| id.as_str()).collect();
        let loaded = match_directions(conn, &group_ids);
        let mut directions: HashMap<&str, HashMap<&str, bool>> = HashMap::new();
        for (gid, members) in &groups {
            if let Some(by_activity) = loaded.get(gid.as_str()) {
                directions.insert(
                    gid.as_str(),
                    members
                        .iter()
                        .filter_map(|m| by_activity.get(m.as_str()).map(|fwd| (m.as_str(), *fwd)))
                        .collect(),
                );
            }
        }

        let member_ids: Vec<&str> = {
            let mut seen: HashSet<&str> = HashSet::new();
            groups
                .iter()
                .flat_map(|(_, members)| members.iter())
                .filter(|m| seen.insert(m.as_str()))
                .map(|m| m.as_str())
                .collect()
        };
        let efforts = member_efforts(conn, &member_ids);

        super::highlights::route_highlights(
            &views,
            &directions,
            &super::highlights::non_attempt_members(conn),
            &super::highlights::route_names(conn),
            |id| efforts.get(id).cloned(),
            activity_ids,
        )
    }

    /// Every group and the activities in it.
    ///
    /// The blob is the current encoding and the JSON column the one before it,
    /// the same order `load_groups` reads them in, so a library written by
    /// either release answers the same.
    fn group_membership(conn: &Connection) -> Vec<(String, Vec<String>)> {
        let mut stmt =
            match conn.prepare("SELECT id, activity_ids, activity_ids_blob FROM route_groups") {
                Ok(stmt) => stmt,
                Err(e) => {
                    log::warn!("[highlights] groups: {e:?}");
                    return Vec::new();
                }
            };
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let members = crate::persistence::routes::decode_activity_ids(row, &id, 1, 2)?;
            Ok((id, members))
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("[highlights] groups: {e:?}");
                Vec::new()
            }
        }
    }

    /// The route buckets the insights panel names, read for the groups with an
    /// attempt inside the larger of the two windows.
    ///
    /// A record needs an attempt inside its window and a trend needs the
    /// newest attempt inside the active one, so a route with neither holds
    /// nothing to say and is never loaded. That keeps the read to the recent
    /// routes rather than the library.
    pub fn route_insights(
        conn: &Connection,
        p: &crate::FfiInsightsParams,
    ) -> Vec<crate::FfiRouteInsight> {
        use super::highlights::{GroupView, RouteInsightWindow};
        use std::collections::{HashMap, HashSet};

        let now = p.current_end as i64;
        let recent_since = now - i64::from(p.recent_pr_window_days) * SECONDS_PER_DAY;
        let active_since = now - i64::from(p.active_window_days) * SECONDS_PER_DAY;
        let since = recent_since.min(active_since);

        let route_ids = recently_attempted_routes(conn, since);
        if route_ids.is_empty() {
            return Vec::new();
        }
        let groups = group_membership_of(conn, &route_ids);
        let (loaded, non_attempts) = route_matches(conn, &route_ids);
        let views: Vec<GroupView<'_>> = groups
            .iter()
            .map(|(id, members)| GroupView {
                group_id: id.as_str(),
                activity_ids: members,
            })
            .collect();
        let mut directions: HashMap<&str, HashMap<&str, bool>> = HashMap::new();
        for (gid, members) in &groups {
            if let Some(by_activity) = loaded.get(gid.as_str()) {
                directions.insert(
                    gid.as_str(),
                    members
                        .iter()
                        .filter_map(|m| by_activity.get(m.as_str()).map(|fwd| (m.as_str(), *fwd)))
                        .collect(),
                );
            }
        }
        let member_ids: Vec<&str> = {
            let mut seen: HashSet<&str> = HashSet::new();
            groups
                .iter()
                .flat_map(|(_, members)| members.iter())
                .filter(|m| seen.insert(m.as_str()))
                .map(|m| m.as_str())
                .collect()
        };
        let efforts = member_efforts(conn, &member_ids);

        let mut rows = super::highlights::route_insights(
            &views,
            &directions,
            &non_attempts,
            &HashMap::new(),
            |id| efforts.get(id).cloned(),
            &RouteInsightWindow {
                now,
                recent_since,
                active_window_days: p.active_window_days,
                history_limit: p.history_limit,
            },
        );
        let named: Vec<&str> = rows.iter().map(|r| r.route_id.as_str()).collect();
        let names = crate::persistence::routes::pooled::route_names_for(conn, &named);
        for row in &mut rows {
            row.route_name = names.get(&row.route_id).cloned().unwrap_or_default();
        }
        rows
    }

    /// The groups holding a member whose attempt is on or after `since`.
    fn recently_attempted_routes(conn: &Connection, since: i64) -> Vec<String> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT am.route_id
             FROM activity_metrics m
             CROSS JOIN activity_matches am ON am.activity_id = m.activity_id
             WHERE m.date >= ?1 AND am.excluded = 0",
        ) else {
            log::warn!("[highlights] recent routes prepare failed");
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map(params![since], |row| row.get::<_, String>(0)) else {
            log::warn!("[highlights] recent routes query failed");
            return Vec::new();
        };
        rows.flatten().collect()
    }

    /// `group_membership` for `ids` alone.
    fn group_membership_of(conn: &Connection, ids: &[String]) -> Vec<(String, Vec<String>)> {
        let mut out = Vec::new();
        for chunk in ids.chunks(500) {
            let marks = vec!["?"; chunk.len()].join(",");
            let Ok(mut stmt) = conn.prepare(&format!(
                "SELECT id, activity_ids, activity_ids_blob FROM route_groups WHERE id IN ({marks})"
            )) else {
                log::warn!("[highlights] groups prepare failed");
                continue;
            };
            let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                let id: String = row.get(0)?;
                let members = crate::persistence::routes::decode_activity_ids(row, &id, 1, 2)?;
                Ok((id, members))
            });
            match rows {
                Ok(rows) => out.extend(rows.flatten()),
                Err(e) => log::warn!("[highlights] groups: {e:?}"),
            }
        }
        out
    }

    /// Which way round each activity ran each of `ids`, and the members that
    /// are not attempts there (excluded or partial), from one read.
    #[allow(clippy::type_complexity)]
    fn route_matches(
        conn: &Connection,
        ids: &[String],
    ) -> (
        std::collections::HashMap<String, std::collections::HashMap<String, bool>>,
        std::collections::HashMap<String, std::collections::HashSet<String>>,
    ) {
        use std::collections::{HashMap, HashSet};

        let mut directions: HashMap<String, HashMap<String, bool>> = HashMap::new();
        let mut non_attempts: HashMap<String, HashSet<String>> = HashMap::new();
        for chunk in ids.chunks(500) {
            let marks = vec!["?"; chunk.len()].join(",");
            let Ok(mut stmt) = conn.prepare(&format!(
                "SELECT route_id, activity_id, direction, excluded FROM activity_matches
                 WHERE route_id IN ({marks})"
            )) else {
                log::warn!("[highlights] matches prepare failed");
                continue;
            };
            let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            }) else {
                log::warn!("[highlights] matches query failed");
                continue;
            };
            for (route_id, activity_id, direction, excluded) in rows.flatten() {
                if excluded || direction == "partial" {
                    non_attempts
                        .entry(route_id.clone())
                        .or_default()
                        .insert(activity_id.clone());
                }
                if excluded {
                    continue;
                }
                if let Ok(parsed) = direction.parse::<tracematch::Direction>() {
                    directions
                        .entry(route_id)
                        .or_default()
                        .insert(activity_id, parsed.is_forward_like());
                }
            }
        }
        (directions, non_attempts)
    }

    /// Which way round each activity ran its group's route.
    ///
    /// A row whose direction will not parse is skipped, which is what
    /// `load_activity_matches` does with it, and the computation then treats
    /// the activity as forward like it treats one with no row at all.
    fn match_directions(
        conn: &Connection,
        group_ids: &[&str],
    ) -> std::collections::HashMap<String, std::collections::HashMap<String, bool>> {
        use std::collections::HashMap;

        let mut out: HashMap<String, HashMap<String, bool>> = HashMap::new();
        if group_ids.is_empty() {
            return out;
        }
        let placeholders = std::iter::repeat_n("?", group_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT route_id, activity_id, direction FROM activity_matches WHERE excluded = 0 AND route_id IN ({placeholders})"
        );
        let mut stmt = match conn.prepare(&sql) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("[highlights] matches: {e:?}");
                return out;
            }
        };
        let params: Vec<&dyn rusqlite::types::ToSql> = group_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        });
        let Ok(rows) = rows else {
            log::warn!("[highlights] matches query failed");
            return out;
        };
        for (route_id, activity_id, direction) in rows.flatten() {
            let Ok(parsed) = direction.parse::<tracematch::Direction>() else {
                continue;
            };
            out.entry(route_id)
                .or_default()
                .insert(activity_id, parsed.is_forward_like());
        }
        out
    }

    /// The distance, time and date each member rode, for the speed and record
    /// arithmetic.
    fn member_efforts(
        conn: &Connection,
        activity_ids: &[&str],
    ) -> std::collections::HashMap<String, super::highlights::Effort> {
        use super::highlights::Effort;
        use std::collections::HashMap;

        let mut out: HashMap<String, Effort> = HashMap::new();
        // SQLite's default parameter limit is 999; stay well under it.
        const CHUNK: usize = 500;
        for chunk in activity_ids.chunks(CHUNK) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id, distance, moving_time, date, sport_type FROM activity_metrics
                 WHERE activity_id IN ({placeholders})"
            );
            let mut stmt = match conn.prepare(&sql) {
                Ok(stmt) => stmt,
                Err(e) => {
                    log::warn!("[highlights] efforts: {e:?}");
                    return out;
                }
            };
            let params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Effort {
                        distance: row.get(1)?,
                        moving_time: row.get(2)?,
                        date: row.get(3)?,
                        sport_type: row.get(4)?,
                    },
                ))
            });
            match rows {
                Ok(rows) => out.extend(rows.flatten()),
                Err(e) => log::warn!("[highlights] efforts: {e:?}"),
            }
        }
        out
    }

    /// How far back the FTP comparison reaches. A daily series moves by a watt
    /// or two a week, so yesterday is noise and a month is a change the
    /// athlete would recognise.
    const FTP_LOOKBACK_DAYS: i64 = 30;

    /// How far back the pace trend will reach for something to compare against.
    ///
    /// The same shape as `FTP_LOOKBACK_DAYS` and the same reason: without it
    /// the card compares the newest snapshot with whichever of the last twenty
    /// differs, at any age, and calls that a move. Wider than the FTP one
    /// because a pace snapshot is written when the sync runs or the screen is
    /// opened rather than daily, so thirty days can hold very few.
    pub(super) const PACE_LOOKBACK_DAYS: i64 = 90;

    /// Seconds in a day. `pace_history` is keyed by a unix timestamp rather
    /// than the `YYYY-MM-DD` the wellness tables use, so the lookback is
    /// arithmetic rather than a date shift.
    const SECONDS_PER_DAY: i64 = 86_400;

    /// The window the sync writes, and so the only one the trend compares.
    ///
    /// The pace curve screen writes whatever range it is showing. Those rows
    /// are kept, because they are a real reading of a real range, and they are
    /// not compared with these.
    pub(crate) const SYNC_PACE_WINDOW_DAYS: i64 = 42;

    /// Aggregated stats for a date range: count, total duration, distance, TSS.
    /// Zero on a failed read as well as on a quiet window.
    pub fn period_stats(conn: &Connection, start_ts: i64, end_ts: i64) -> crate::FfiPeriodStats {
        try_period_stats(conn, start_ts, end_ts).unwrap_or(crate::FfiPeriodStats {
            count: 0,
            total_duration: 0.0,
            total_distance: 0.0,
            total_tss: 0.0,
        })
    }

    /// A date range's totals, or the error the read failed with.
    pub(crate) fn try_period_stats(
        conn: &Connection,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<crate::FfiPeriodStats> {
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(moving_time), 0), COALESCE(SUM(distance), 0),
                    COALESCE(SUM(training_load), 0)
             FROM activity_metrics WHERE date BETWEEN ?1 AND ?2",
            params![start_ts, end_ts],
            |row| {
                Ok(crate::FfiPeriodStats {
                    count: row.get::<_, i64>(0)? as u32,
                    total_duration: row.get(1)?,
                    total_distance: row.get(2)?,
                    total_tss: row.get(3)?,
                })
            },
        )
    }

    /// Recorded activity load per local calendar day over an inclusive window
    /// of wall-clock timestamps, oldest first. Days without activities are
    /// absent; `day_load` names such a day `Rest`.
    ///
    /// `activity_metrics.date` holds local wall time, so its date part is the
    /// athlete's local day with no timezone arithmetic.
    pub fn daily_activity_loads(
        conn: &Connection,
        start_ts: i64,
        end_ts: i64,
    ) -> Vec<crate::FfiDayLoad> {
        let mut stmt = match conn.prepare(
            "SELECT date(date, 'unixepoch'), training_load FROM activity_metrics
             WHERE date BETWEEN ?1 AND ?2 ORDER BY date",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [daily_load] prepare failed: {e}");
                return Vec::new();
            }
        };
        let rows = match stmt.query_map(params![start_ts, end_ts], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<f64>>(1)?))
        }) {
            Ok(rows) => rows.flatten(),
            Err(e) => {
                log::warn!("veloqrs: [daily_load] row walk failed: {e}");
                return Vec::new();
            }
        };
        let mut days: Vec<(String, Vec<Option<f64>>)> = Vec::new();
        for (date, load) in rows {
            match days.last_mut() {
                Some((last, loads)) if *last == date => loads.push(load),
                _ => days.push((date, vec![load])),
            }
        }
        days.iter()
            .map(|(date, loads)| super::day_load(date, loads))
            .collect()
    }

    /// One entry per week anchor, each the totals of `[start, start + length)`.
    ///
    /// The windows are half-open because `activity_metrics.date` is whole
    /// seconds and an anchor is the previous week's end. `period_stats` is
    /// inclusive at both ends, so asking it for `start + length` counted an
    /// activity at exactly Monday 00:00:00 in both weeks.
    pub fn weekly_summaries(
        conn: &Connection,
        week_starts: &[i64],
        week_length_secs: i64,
    ) -> Vec<crate::FfiWeeklySummary> {
        week_starts
            .iter()
            .map(|&start| {
                let stats = period_stats(conn, start, start + week_length_secs - 1);
                crate::FfiWeeklySummary {
                    week_start: start as f64,
                    count: stats.count,
                    moving_time: stats.total_duration,
                    distance: stats.total_distance,
                    training_load: stats.total_tss,
                }
            })
            .collect()
    }

    /// The cycling eFTP recorded on or before `date`, as `YYYY-MM-DD`.
    ///
    /// The stale-PR card reads this at the record's own date. Days before the
    /// athlete's first wellness body, and days whose bodies carry no cycling
    /// entry, answer none: a card that cannot say what the fitness was when
    /// the record was set has nothing honest to claim.
    pub fn cycling_eftp_on_or_before(conn: &Connection, date: &str) -> Option<u16> {
        let mut stmt = conn
            .prepare(
                "SELECT raw FROM wellness
                 WHERE raw IS NOT NULL AND date <= ?
                 ORDER BY date DESC
                 LIMIT 400",
            )
            .ok()?;
        let rows = stmt
            .query_map(params![date], |row| row.get::<_, String>(0))
            .ok()?;
        rows.flatten().find_map(|raw| super::cycling_eftp(&raw))
    }

    /// The critical speed snapshot on or before `at`, epoch seconds, for the
    /// sport's family. None when the snapshots start after that date.
    pub fn pace_on_or_before(conn: &Connection, sport_type: &str, at: i64) -> Option<f64> {
        // The sync's window and no other, the same condition `pace_trend`
        // takes. The pace curve screen writes a snapshot of whatever range it
        // is showing, and a year curve's critical speed is the athlete's best
        // year where a six-week curve's is recent form: reading whichever row
        // is newest on or before a date otherwise reads two different facts on
        // two consecutive days, and the fall between them is read as the
        // athlete having got slower. A row from before the window column is of
        // an unknown range and is left out, so the card this feeds is quiet
        // until the next sync writes one rather than wrong.
        let query = format!(
            "SELECT critical_speed FROM pace_history
             WHERE sport_type IN ({}) AND date <= ? AND window_days = {}
             ORDER BY date DESC
             LIMIT 1",
            crate::sport::sql_list(&crate::sport::family_of(sport_type)),
            SYNC_PACE_WINDOW_DAYS
        );
        conn.query_row(&query, params![at], |row| row.get::<_, f64>(0))
            .ok()
            .filter(|speed| speed.is_finite() && *speed > 0.0)
    }

    /// The athlete's fitness in `sport` on the day of `at`, epoch seconds.
    ///
    /// eFTP for a cycling sport, critical speed for a running or swimming one,
    /// each the value recorded on or before that day. This is what the
    /// stale-PR card measures today's fitness against, so it is read at the
    /// record's own date rather than at a fixed window back from now.
    pub fn fitness_on(conn: &Connection, sport: &str, at: f64) -> Option<f64> {
        if !at.is_finite() {
            return None;
        }
        let seconds = at as i64;
        if crate::sport::is_cycling(sport) {
            let day = chrono::DateTime::from_timestamp(seconds, 0)?
                .date_naive()
                .format("%Y-%m-%d")
                .to_string();
            return cycling_eftp_on_or_before(conn, &day).map(f64::from);
        }
        if crate::sport::is_running(sport) || crate::sport::is_swimming(sport) {
            return pace_on_or_before(conn, sport, seconds);
        }
        None
    }

    pub fn ftp_trend_to(conn: &Connection, today: &str) -> crate::FfiFtpTrend {
        ftp_trend_over(conn, today, FTP_LOOKBACK_DAYS)
    }

    /// The FTP trend compared across `lookback_days` rather than the default
    /// month, with the history carrying the whole window it was read from.
    ///
    /// The card's thumbnail is a strip a few dozen pixels wide and keeps the
    /// tail of thirty days. A screen that plots the window asks for it and
    /// draws every day of it.
    pub fn ftp_trend_over(
        conn: &Connection,
        today: &str,
        lookback_days: i64,
    ) -> crate::FfiFtpTrend {
        let changes = eftp_changes(conn);
        let default = crate::FfiFtpTrend {
            changes: changes.clone(),
            history: Vec::new(),
            latest_ftp: None,
            latest_date: None,
            previous_ftp: None,
            previous_date: None,
            delta_watts: None,
            sample_count: 0,
        };

        // A year of days is 365 rows of JSON, parsed once per call, and the
        // caller is a screen bundle rather than a loop.
        let rows = match daily_cycling_ftp(conn, today, lookback_days) {
            Ok(rows) if !rows.is_empty() => rows,
            _ => return default,
        };

        let history_limit = crate::persistence::screens::TREND_HISTORY_POINTS
            .max(u32::try_from(lookback_days.saturating_add(1)).unwrap_or(u32::MAX));
        let (latest_date, latest_ftp) = rows[rows.len() - 1].clone();
        let cutoff = day_offset(&latest_date, -lookback_days);

        // The newest day at or before the cutoff. Nothing that old means the
        // history is shorter than the window, and one value is not a trend.
        let previous_at = rows
            .iter()
            .rposition(|(date, _)| date.as_str() <= cutoff.as_str());
        let previous = previous_at.map(|at| &rows[at]);

        // Days from the one compared against to the newest, inclusive. With
        // nothing to compare against the trend stands on the single day it
        // holds, which is what the ranker should weigh it as.
        let sample_count = previous_at.map(|at| rows.len() - at).unwrap_or(1) as u32;

        crate::FfiFtpTrend {
            changes,
            latest_ftp: Some(latest_ftp),
            latest_date: Some(epoch_seconds(&latest_date) as f64),
            previous_ftp: previous.map(|(_, ftp)| *ftp),
            previous_date: previous.map(|(date, _)| epoch_seconds(date) as f64),
            delta_watts: previous.map(|(_, ftp)| latest_ftp as i32 - *ftp as i32),
            sample_count,
            // The days the step was read from, carried rather than counted.
            // `rows` is already the window `sample_count` counts, so the card
            // draws the run-up to the step without a second read.
            history: crate::persistence::screens::series_tail(
                rows.iter(),
                history_limit,
                |(date, ftp)| (f64::from(*ftp), epoch_seconds(date) as f64),
            ),
        }
    }

    /// The stored days the trend needs, oldest first.
    ///
    /// Newest first out of SQLite so [`trend_days`] can stop at the day it
    /// compares against, rather than materialising and parsing every body in
    /// a table that grows a year per year of use.
    fn daily_cycling_ftp(
        conn: &Connection,
        today: &str,
        lookback_days: i64,
    ) -> rusqlite::Result<Vec<(String, u16)>> {
        Ok(trend_days(
            cycling_wellness_rows(conn, today)?.into_iter(),
            lookback_days,
        ))
    }

    /// The stored bodies on or before `today`, newest first, that carry a
    /// cycling `sportInfo` entry with a positive `eftp`. SQLite filters inside
    /// the JSON so a body without one is never fetched or parsed in Rust.
    pub(crate) fn cycling_wellness_rows(
        conn: &Connection,
        today: &str,
    ) -> rusqlite::Result<Vec<(String, String)>> {
        let query = format!(
            "SELECT date, raw FROM wellness
             WHERE raw IS NOT NULL AND date <= ?
               AND EXISTS (
                 SELECT 1 FROM json_each(wellness.raw, '$.sportInfo') j
                 WHERE json_extract(j.value, '$.type') IN ({})
                   AND json_extract(j.value, '$.eftp') > 0)
             ORDER BY date DESC",
            crate::sport::sql_list(crate::sport::CYCLING)
        );
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map(params![today], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn pace_trend(conn: &Connection, sport_type: &str) -> crate::FfiPaceTrend {
        pace_trend_through(conn, sport_type, i64::MAX)
    }

    /// [`pace_trend`] as it stood at `through`, a unix timestamp: snapshots
    /// written later are not read.
    pub fn pace_trend_through(
        conn: &Connection,
        sport_type: &str,
        through: i64,
    ) -> crate::FfiPaceTrend {
        let default = crate::FfiPaceTrend {
            history: Vec::new(),
            latest_pace: None,
            latest_date: None,
            previous_pace: None,
            previous_date: None,
            gain_percent: None,
            delta_seconds: None,
            glyph: None,
            sample_count: 0,
        };

        // One window only. Two callers write this table with different ranges,
        // and a year curve's critical speed is the athlete's best year where a
        // 42-day curve's is the last six weeks. `window_days IS NULL` is a row
        // upgraded from before the column, of an unknown range, and an unknown
        // range is not the sync's just because most rows were.
        // Bound by date and not by row count: a daily syncer writes a row a
        // day, so a count cap would end the lookback inside a month.
        let family = crate::sport::sql_list(&crate::sport::family_of(sport_type));
        let query = format!(
            "SELECT critical_speed, date FROM pace_history
         WHERE sport_type IN ({family}) AND window_days = {SYNC_PACE_WINDOW_DAYS} AND date <= {through}
           AND date >= (SELECT MAX(date) FROM pace_history
                        WHERE sport_type IN ({family}) AND window_days = {SYNC_PACE_WINDOW_DAYS}
                          AND date <= {through}) - {lookback}
         ORDER BY date DESC",
            lookback = PACE_LOOKBACK_DAYS * SECONDS_PER_DAY
        );
        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            Err(_) => return default,
        };

        let rows: Vec<(f64, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()
            .map(|iter| iter.flatten().collect())
            .unwrap_or_default();

        if rows.is_empty() {
            return default;
        }

        let latest_speed = rows[0].0;
        let latest_date = rows[0].1;

        // The first row with a meaningfully different critical speed, >0.02 m/s
        // and about a second off the kilometre, and inside the lookback. The
        // bound is what stops the card reaching back through twenty snapshots
        // of any age and calling the difference a recent improvement, the way
        // `FTP_LOOKBACK_DAYS` bounds the FTP trend.
        let previous = rows
            .iter()
            .find(|(speed, _)| (speed - latest_speed).abs() > 0.02);

        // The unit the sport is paced in. A swimmer reads seconds off the
        // hundred and a runner seconds off the kilometre, so the trend states
        // the move in the one its readers render.
        let (unit_metres, table_metric) = if crate::sport::is_swimming(sport_type) {
            (100.0, "css")
        } else {
            (1000.0, "thresholdPace")
        };
        let moved = previous.filter(|(speed, _)| *speed > 0.0 && latest_speed > 0.0);
        // Judged as pace, minutes per unit, which is the table's unit and the
        // polarity it was written for: a falling pace is a faster athlete.
        let minutes_per_unit = |speed: f64| unit_metres / speed / 60.0;
        let glyph = match moved {
            Some((speed, _)) => crate::trend_table::glyph(
                table_metric,
                Some(minutes_per_unit(latest_speed)),
                Some(minutes_per_unit(*speed)),
            ),
            None if previous.is_none() => Some("→".to_string()),
            None => None,
        };

        crate::FfiPaceTrend {
            latest_pace: Some(latest_speed),
            latest_date: Some(latest_date as f64),
            previous_pace: previous.map(|(speed, _)| *speed),
            previous_date: previous.map(|(_, date)| *date as f64),
            gain_percent: moved.map(|(speed, _)| (latest_speed - speed) / speed * 100.0),
            delta_seconds: moved.map(|(speed, _)| unit_metres / speed - unit_metres / latest_speed),
            glyph,
            sample_count: rows.len() as u32,
            // `rows` arrives newest first out of SQLite, so the series is
            // reversed into the oldest-first order every other one carries.
            history: crate::persistence::screens::series_tail(
                rows.iter().rev(),
                crate::persistence::screens::TREND_HISTORY_POINTS,
                |(speed, date)| (*speed, *date as f64),
            ),
        }
    }

    /// A window's totals grouped by calendar month, oldest first, or the
    /// error the read failed with.
    pub(crate) fn monthly_stats(
        conn: &Connection,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<Vec<crate::FfiMonthlyStats>> {
        let mut stmt = conn.prepare(
            "SELECT CAST(strftime('%Y', date, 'unixepoch') AS INTEGER),
                    CAST(strftime('%m', date, 'unixepoch') AS INTEGER),
                    COUNT(*), COALESCE(SUM(moving_time), 0),
                    COALESCE(SUM(distance), 0), COALESCE(SUM(training_load), 0)
             FROM activity_metrics
             WHERE date BETWEEN ?1 AND ?2
             GROUP BY 1, 2
             ORDER BY 1, 2",
        )?;

        stmt.query_map(params![start_ts, end_ts], |row| {
            Ok(crate::FfiMonthlyStats {
                year: row.get(0)?,
                month: row.get::<_, u32>(1)?,
                stats: crate::FfiPeriodStats {
                    count: row.get::<_, i64>(2)? as u32,
                    total_duration: row.get(3)?,
                    total_distance: row.get(4)?,
                    total_tss: row.get(5)?,
                },
            })
        })?
        .collect()
    }

    /// Zone seconds summed over a sport's family for the activities dated in
    /// `start_ts..=end_ts`, stamps in the wall-clock-as-UTC timebase
    /// `activity_metrics.date` holds. `zone_type` is `"power"` or `"hr"`, and
    /// anything else, like a failed read, is empty.
    pub(crate) fn zone_distribution(
        conn: &Connection,
        sport_type: &str,
        zone_type: &str,
        start_ts: i64,
        end_ts: i64,
    ) -> Vec<f64> {
        let family = crate::sport::sql_list(&crate::sport::family_of(sport_type));
        // Use cached zone columns for 40-100x speedup (was 50-200ms, now 2-5ms)
        let prefix = match zone_type {
            "power" => "power_z",
            "hr" => "hr_z",
            _ => return Vec::new(),
        };
        let sums = (1..=crate::persistence::fitness::ZONE_COLUMNS)
            .map(|zone| format!("COALESCE(SUM({prefix}{zone}), 0)"))
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!(
            "SELECT {sums}
             FROM activity_metrics
             WHERE sport_type IN ({family}) AND date BETWEEN ?1 AND ?2"
        );

        match conn.query_row(&query, params![start_ts, end_ts], |row| {
            (0..crate::persistence::fitness::ZONE_COLUMNS)
                .map(|zone| row.get(zone))
                .collect()
        }) {
            Ok(result) => result,
            Err(rusqlite::Error::QueryReturnedNoRows) => Vec::new(),
            Err(e) => {
                log::warn!(
                    "[fitness] get_zone_distribution query failed for sport={}, zone={}: {}",
                    sport_type,
                    zone_type,
                    e
                );
                Vec::new()
            }
        }
    }

    /// The athlete's own zone names for a sport, from the cached sport
    /// settings body, at most one per stored zone column. Empty when the settings are missing, do not cover the
    /// sport, or carry no names for that zone type.
    pub(crate) fn zone_names(
        sport_settings: Option<&str>,
        sport_type: &str,
        zone_type: &str,
    ) -> Vec<String> {
        let key = match zone_type {
            "power" => "power_zone_names",
            "hr" => "hr_zone_names",
            _ => return Vec::new(),
        };
        let family = crate::sport::family_of(sport_type);
        let names = sport_settings
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .and_then(|settings| {
                settings
                    .as_array()?
                    .iter()
                    .find(|entry| {
                        entry
                            .get("types")
                            .and_then(|t| t.as_array())
                            .is_some_and(|types| {
                                types
                                    .iter()
                                    .any(|t| t.as_str().is_some_and(|t| family.contains(&t)))
                            })
                    })?
                    .get(key)?
                    .as_array()?
                    .iter()
                    .map(|name| name.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()
            });
        let mut names = names.unwrap_or_default();
        names.truncate(crate::persistence::fitness::ZONE_COLUMNS);
        names
    }

    /// [`zone_distribution`] with the athlete's zone names beside it.
    pub(crate) fn zone_distribution_named(
        conn: &Connection,
        sport_type: &str,
        zone_type: &str,
        start_ts: i64,
        end_ts: i64,
    ) -> crate::FfiZoneDistribution {
        let settings = crate::persistence::fitness::sport_settings_from(conn);
        crate::FfiZoneDistribution {
            seconds: zone_distribution(conn, sport_type, zone_type, start_ts, end_ts),
            names: zone_names(settings.as_deref(), sport_type, zone_type),
        }
    }

    /// Distinct sport types, or the error the read failed with.
    pub(crate) fn try_available_sport_types(conn: &Connection) -> SqlResult<Vec<String>> {
        let mut stmt =
            conn.prepare("SELECT DISTINCT sport_type FROM activity_metrics ORDER BY sport_type")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect()
    }

    /// Heatmap days within a `YYYY-MM-DD` window, oldest first, or the error
    /// the read failed with. A row that will not read is skipped.
    pub(crate) fn activity_heatmap(
        conn: &Connection,
        start_date: &str,
        end_date: &str,
    ) -> SqlResult<Vec<crate::FfiHeatmapDay>> {
        let mut stmt = conn.prepare(
            "SELECT date, intensity, max_duration, activity_count
             FROM activity_heatmap
             WHERE date BETWEEN ?1 AND ?2
             ORDER BY date",
        )?;

        let rows = stmt.query_map(params![start_date, end_date], |row| {
            Ok(crate::FfiHeatmapDay {
                date: row.get(0)?,
                intensity: row.get::<_, u8>(1)?,
                max_duration: row.get(2)?,
                activity_count: row.get::<_, u32>(3)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Every activity that moved the accepted eFTP, oldest first. A failed
    /// read is empty and logged.
    pub(crate) fn eftp_changes(conn: &Connection) -> Vec<crate::FfiEftpChange> {
        let mut stmt = match conn.prepare(
            "SELECT activity_id, date, eftp, delta, activity_name
             FROM eftp_changes ORDER BY date ASC, activity_id ASC",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [eftp_changes] query failed: {e}");
                return Vec::new();
            }
        };
        let rows = stmt.query_map([], |row| {
            Ok(crate::FfiEftpChange {
                activity_id: row.get(0)?,
                date: row.get(1)?,
                eftp: row.get(2)?,
                delta: row.get(3)?,
                activity_name: row.get(4)?,
            })
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("veloqrs: [eftp_changes] row walk failed: {e}");
                Vec::new()
            }
        }
    }
}

impl PersistentEngine {
    // ========================================================================
    // Aggregate Queries (SQL-based, for dashboard/stats/charts)
    // ========================================================================

    /// Get aggregated stats for a date range: count, total duration, distance, TSS.
    pub fn get_period_stats(&self, start_ts: i64, end_ts: i64) -> crate::FfiPeriodStats {
        pooled::period_stats(&self.db, start_ts, end_ts)
    }

    /// A window's totals grouped by calendar month, oldest first.
    ///
    /// Only months carrying an activity are returned. The caller plots a fixed
    /// twelve bars and reads a missing month as zero, which is what it means:
    /// returning a row of zeroes for every quiet month would be the same
    /// answer with more rows.
    ///
    /// The month is taken in local time, because that is what the athlete's
    /// year looks like to them. `date` is stored as the activity's local
    /// wall-clock start read as UTC (`sync.rs` builds it from
    /// `start_date_local`), so `'unixepoch'` with no `'localtime'` is what
    /// keeps a January 1st activity in January.
    pub fn get_monthly_stats(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<Vec<crate::FfiMonthlyStats>> {
        pooled::monthly_stats(&self.db, start_ts, end_ts)
    }

    /// Aggregated zone distribution for a sport and its family, so a gravel
    /// ride's seconds reach the chart the athlete filtered to cycling, over
    /// the activities dated in `start_ts..=end_ts`.
    /// zone_type: "power" | "hr"
    pub fn get_zone_distribution(
        &self,
        sport_type: &str,
        zone_type: &str,
        start_ts: i64,
        end_ts: i64,
    ) -> Vec<f64> {
        pooled::zone_distribution(&self.db, sport_type, zone_type, start_ts, end_ts)
    }

    /// The cycling threshold now and a month ago, from the daily model
    /// estimate intervals.icu computes.
    ///
    /// Not `icu_ftp`: that is the athlete's configured setting, and on a real
    /// five-year account it holds one value throughout, so a trend read from it
    /// has no previous value and the delta never renders. The estimate is
    /// already on the device, in the wellness body's `sportInfo` entry for the
    /// sport, so this costs no request and no column.
    pub fn get_ftp_trend(&self) -> crate::FfiFtpTrend {
        self.get_ftp_trend_to(&crate::persistence::wellness::today_iso())
    }

    pub fn get_ftp_trend_to(&self, today: &str) -> crate::FfiFtpTrend {
        pooled::ftp_trend_to(&self.db, today)
    }

    pub fn get_ftp_trend_over_to(&self, today: &str, lookback_days: i64) -> crate::FfiFtpTrend {
        pooled::ftp_trend_over(&self.db, today, lookback_days)
    }

    /// The athlete's fitness in `sport` on the day of `at`, epoch seconds.
    pub fn fitness_on(&self, sport: &str, at: f64) -> Option<f64> {
        pooled::fitness_on(&self.db, sport, at)
    }

    /// Record one critical-speed snapshot, under the window it was read over.
    ///
    /// The window is part of the key. Two callers write this table with
    /// different ranges, and before the window was recorded the later write of
    /// a day replaced the earlier one whatever range it came from, which is how
    /// a year curve's critical speed came to sit where the sync's six-week one
    /// had been.
    pub fn save_pace_snapshot(
        &self,
        sport_type: &str,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
        window_days: i64,
    ) {
        let _ = self.db.execute(
            "INSERT OR REPLACE INTO pace_history
                 (date, sport_type, critical_speed, d_prime, r2, window_days)
             VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![date, sport_type, critical_speed, d_prime, r2, window_days],
        );
    }

    pub fn get_pace_trend(&self, sport_type: &str) -> crate::FfiPaceTrend {
        pooled::pace_trend(&self.db, sport_type)
    }

    /// Get distinct sport types from stored activities.
    ///
    /// Empty and failed are the same answer here, and a caller that can tell
    /// them apart wants `try_available_sport_types`: a sync that fetches
    /// nothing because the read failed leaves the athlete a chart saying
    /// there is no power data for years of rides.
    pub fn get_available_sport_types(&self) -> Vec<String> {
        self.try_available_sport_types().unwrap_or_default()
    }

    /// Distinct sport types, or the error the read failed with.
    pub fn try_available_sport_types(&self) -> SqlResult<Vec<String>> {
        pooled::try_available_sport_types(&self.db)
    }

    /// For each stored sport type, when its newest body was written here, as
    /// epoch seconds on this device's clock.
    ///
    /// Arrival, not start time: `activity_metrics.date` is local wall time
    /// read as UTC, so it cannot be compared with a fetch time, and a late
    /// upload or a reprocessed activity starts before a fetch it arrived
    /// after. `None` for a sport whose activities carry no stored body.
    pub fn try_latest_arrival_by_sport(&self) -> SqlResult<Vec<(String, Option<i64>)>> {
        let mut stmt = self.db.prepare(
            "SELECT m.sport_type, MAX(b.updated_at)
             FROM activity_metrics m
             LEFT JOIN activity_bodies b ON b.activity_id = m.activity_id
             GROUP BY m.sport_type",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// Each sport type's distinct activity days, as days since 1970-01-01 on
    /// the local wall clock the stored `date` carries.
    ///
    /// The curve sweep reads these to tell whether an activity has crossed a
    /// bounded window's edge since the stored curve was fetched.
    pub fn try_activity_days_by_sport(&self) -> SqlResult<Vec<(String, i64)>> {
        let mut stmt = self.db.prepare(
            "SELECT DISTINCT sport_type, date / 86400
             FROM activity_metrics",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// For each sport type an activity of which left intervals.icu, when the
    /// last one was removed here, as epoch seconds on this device's clock.
    ///
    /// The curve sweep reads these beside `try_latest_arrival_by_sport`: a
    /// removal changes what the server's curves would say as surely as an
    /// arrival does.
    pub fn try_curve_removals_by_sport(&self) -> SqlResult<Vec<(String, Option<i64>)>> {
        let mut stmt = self.db.prepare(
            "SELECT substr(key, length(?1) + 1), CAST(value AS INTEGER)
             FROM settings
             WHERE substr(key, 1, length(?1)) = ?1",
        )?;
        let rows = stmt.query_map(
            params![crate::persistence::settings_keys::CURVE_REMOVED_AT_PREFIX],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        rows.collect()
    }

    /// Get a calendar-aligned Year > Month performance summary for a section.
    /// Returns full history (no date range filter), for one sport when given.
    pub fn get_section_calendar_summary(
        &mut self,
        section_id: &str,
        sport_filter: Option<&str>,
    ) -> Option<crate::CalendarSummary> {
        let start = std::time::Instant::now();
        // Reuse get_section_performances - single source of truth for section times.
        // This ensures calendar values match chart PRs exactly (no proportional estimates
        // for activities without time streams, matching the strict behaviour).
        let perf_result = self.get_section_performances_filtered(section_id, sport_filter);
        let result = calendar_from(&perf_result);
        log::info!(
            "[PERF] get_section_calendar_summary({}) -> {} years in {:?}",
            section_id,
            result.as_ref().map(|r| r.years.len()).unwrap_or(0),
            start.elapsed()
        );
        result
    }

    /// Get aerobic efficiency trend for a section over one sport's traversals.
    ///
    /// Queries section_activities for traversals that have both lap_time and avg_hr,
    /// computes HR/pace ratio for each, and performs linear regression to detect
    /// improving aerobic efficiency (declining HR at the same pace).
    ///
    /// Returns None if fewer than 3 data points have both pace and HR data.
    pub fn get_section_efficiency_trend(
        &mut self,
        section_id: &str,
        sport_type: &str,
    ) -> Option<crate::FfiEfficiencyTrend> {
        let section = self.sections.iter().find(|s| s.id == section_id)?;
        let name = if section.is_user_defined {
            section
                .name
                .clone()
                .or_else(|| self.named_overlay_name(section_id))
        } else {
            self.named_overlay_name(section_id)
                .or_else(|| section.name.clone())
        }
        .unwrap_or_else(|| "Section".to_string());
        let distance_meters = section.distance_meters;
        pooled::section_efficiency_trend(&self.db, section_id, sport_type, &name, distance_meters)
    }

    // ========================================================================
    // Activity Section Highlights (batch PR detection)
    // ========================================================================

    /// Batch-query route highlights for a list of activity IDs.
    ///
    /// Answered from the engine's in-memory groups, matches and metrics. The
    /// same computation over rows a pooled read-only connection can see is
    /// [`pooled::route_highlights`], and
    /// `pooled_route_highlights_match_the_ones_a_lock_holder_gets` holds the
    /// two together.
    pub fn get_activity_route_highlights(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityRouteHighlight> {
        if activity_ids.is_empty() || self.groups.is_empty() {
            log::debug!("route_highlights: groups=0 members=0 prs=0 trends=0");
            return vec![];
        }

        let groups: Vec<highlights::GroupView<'_>> = self
            .groups
            .iter()
            .map(|g| highlights::GroupView {
                group_id: g.group_id.as_str(),
                activity_ids: &g.activity_ids,
            })
            .collect();

        let mut directions: HashMap<&str, HashMap<&str, bool>> = HashMap::new();
        for group in &self.groups {
            let gid = group.group_id.as_str();
            if let Some(matches) = self.activity_matches.get(gid) {
                directions.insert(
                    gid,
                    matches
                        .iter()
                        .map(|m| (m.activity_id.as_str(), m.direction.is_forward_like()))
                        .collect(),
                );
            }
        }

        let route_names = highlights::route_names(&self.db);

        // The lookup stays lazy rather than becoming a map of the whole
        // library: only the members of the groups the requested activities
        // are in are ever asked for.
        highlights::route_highlights(
            &groups,
            &directions,
            &highlights::non_attempt_members(&self.db),
            &route_names,
            |id| self.activity_metrics.get(id).map(highlights::Effort::from),
            activity_ids,
        )
    }

    /// Get section encounters for an activity: one entry per
    /// `(section, direction)`, represented by the activity's fastest pass.
    /// Includes this activity's time, PR status, visit count, and sparkline
    /// history. Individual laps are the `FfiSectionLap` surface.
    pub fn get_activity_section_encounters(
        &self,
        activity_id: &str,
    ) -> Vec<crate::ffi_types::FfiSectionEncounter> {
        self.ensure_named_overlay();
        pooled::activity_section_encounters(
            &self.db,
            activity_id,
            &self.named_overlay_cached_names(),
        )
    }
}

/// The calendar the section detail screen draws, from an already-read set of
/// performances.
///
/// Pure arithmetic over `perf_result`, so the pooled reader and the lock
/// holder share it rather than each building a calendar of its own.
pub(crate) fn calendar_from(
    perf_result: &crate::SectionPerformanceResult,
) -> Option<crate::CalendarSummary> {
    if perf_result.records.is_empty() {
        return None;
    }

    // Get section distance from the first record
    let section_distance = perf_result
        .records
        .first()
        .map(|r| r.section_distance)
        .unwrap_or(0.0);

    // Each record has laps with per-direction data. Build per-activity,
    // per-direction entries, each carrying how many laps it stands for.
    struct DirPerf {
        activity_id: String,
        activity_name: String,
        activity_date: i64,
        best_time: f64,
        best_pace: f64,
        is_reverse: bool,
        laps: u32,
    }

    let mut all_perfs: Vec<DirPerf> = Vec::new();

    for record in &perf_result.records {
        // The laps the record builder would let stand: never a `partial`
        // overlap, never one covering too little of the section.
        let eligible = record.laps.iter().filter(|lap| {
            !lap.excluded
                && lap.direction != "partial"
                && lap.time.is_finite()
                && lap.time > 0.0
                && crate::persistence::records::covers_enough_for_record(
                    lap.coverage,
                    lap.distance,
                    section_distance,
                )
        });
        let mut forward: Option<DirPerf> = None;
        let mut reverse: Option<DirPerf> = None;
        for lap in eligible {
            let is_reverse = lap.direction == "reverse";
            let slot = if is_reverse {
                &mut reverse
            } else {
                &mut forward
            };
            let perf = slot.get_or_insert_with(|| DirPerf {
                activity_id: record.activity_id.clone(),
                activity_name: record.activity_name.clone(),
                activity_date: record.activity_date,
                best_time: f64::MAX,
                best_pace: 0.0,
                is_reverse,
                laps: 0,
            });
            perf.laps += 1;
            if lap.time < perf.best_time {
                perf.best_time = lap.time;
                perf.best_pace = lap.pace;
            }
        }
        all_perfs.extend(forward);
        all_perfs.extend(reverse);
    }

    if all_perfs.is_empty() {
        return None;
    }

    fn to_dir_best(perf: &DirPerf, count: u32) -> crate::CalendarDirectionBest {
        crate::CalendarDirectionBest {
            count,
            best_time: perf.best_time,
            best_pace: perf.best_pace,
            best_activity_id: perf.activity_id.clone(),
            best_activity_name: perf.activity_name.clone(),
        }
    }

    // Group by year, month, and direction
    use std::collections::BTreeMap;
    struct MonthDirData {
        total_count: u32,
        activities: std::collections::BTreeSet<String>,
        fwd_count: u32,
        fwd_best: Option<usize>,
        rev_count: u32,
        rev_best: Option<usize>,
    }
    struct YearData {
        months: BTreeMap<u32, MonthDirData>,
    }

    let mut years_map: BTreeMap<i32, YearData> = BTreeMap::new();

    for (i, perf) in all_perfs.iter().enumerate() {
        let dt = DateTime::from_timestamp(perf.activity_date, 0)
            .unwrap_or_default()
            .naive_utc();
        let year = dt.year();
        let month = dt.month();

        let year_data = years_map.entry(year).or_insert_with(|| YearData {
            months: BTreeMap::new(),
        });

        let md = year_data
            .months
            .entry(month)
            .or_insert_with(|| MonthDirData {
                total_count: 0,
                activities: std::collections::BTreeSet::new(),
                fwd_count: 0,
                fwd_best: None,
                rev_count: 0,
                rev_best: None,
            });

        md.total_count += perf.laps;
        md.activities.insert(perf.activity_id.clone());
        if perf.is_reverse {
            md.rev_count += perf.laps;
            match md.rev_best {
                Some(idx) if perf.best_time < all_perfs[idx].best_time => md.rev_best = Some(i),
                None => md.rev_best = Some(i),
                _ => {}
            }
        } else {
            md.fwd_count += perf.laps;
            match md.fwd_best {
                Some(idx) if perf.best_time < all_perfs[idx].best_time => md.fwd_best = Some(i),
                None => md.fwd_best = Some(i),
                _ => {}
            }
        }
    }

    // Build result (newest year first)
    let years: Vec<crate::CalendarYearSummary> = years_map
        .into_iter()
        .rev()
        .map(|(year, year_data)| {
            let year_activities = year_data
                .months
                .values()
                .flat_map(|md| md.activities.iter())
                .collect::<std::collections::BTreeSet<_>>()
                .len() as u32;
            let months: Vec<crate::CalendarMonthSummary> = year_data
                .months
                .into_iter()
                .map(|(month, md)| crate::CalendarMonthSummary {
                    month,
                    traversal_count: md.total_count,
                    activity_count: md.activities.len() as u32,
                    forward: md
                        .fwd_best
                        .map(|idx| to_dir_best(&all_perfs[idx], md.fwd_count)),
                    reverse: md
                        .rev_best
                        .map(|idx| to_dir_best(&all_perfs[idx], md.rev_count)),
                })
                .collect();

            let year_fwd_best = months
                .iter()
                .filter_map(|m| m.forward.as_ref())
                .min_by(|a, b| {
                    a.best_time
                        .partial_cmp(&b.best_time)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
            let year_rev_best = months
                .iter()
                .filter_map(|m| m.reverse.as_ref())
                .min_by(|a, b| {
                    a.best_time
                        .partial_cmp(&b.best_time)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

            let fwd_count: u32 = months
                .iter()
                .filter_map(|m| m.forward.as_ref())
                .map(|f| f.count)
                .sum();
            let rev_count: u32 = months
                .iter()
                .filter_map(|m| m.reverse.as_ref())
                .map(|r| r.count)
                .sum();
            let traversal_count = months.iter().map(|m| m.traversal_count).sum();

            crate::CalendarYearSummary {
                year,
                traversal_count,
                activity_count: year_activities,
                forward: year_fwd_best.map(|b| crate::CalendarDirectionBest {
                    count: fwd_count,
                    ..b.clone()
                }),
                reverse: year_rev_best.map(|b| crate::CalendarDirectionBest {
                    count: rev_count,
                    ..b.clone()
                }),
                months,
            }
        })
        .collect();

    // Overall PRs by direction
    let fwd_total: u32 = all_perfs
        .iter()
        .filter(|p| !p.is_reverse)
        .map(|p| p.laps)
        .sum();
    let rev_total: u32 = all_perfs
        .iter()
        .filter(|p| p.is_reverse)
        .map(|p| p.laps)
        .sum();

    let forward_pr = all_perfs.iter().filter(|p| !p.is_reverse).min_by(|a, b| {
        a.best_time
            .partial_cmp(&b.best_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let reverse_pr = all_perfs.iter().filter(|p| p.is_reverse).min_by(|a, b| {
        a.best_time
            .partial_cmp(&b.best_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let result = crate::CalendarSummary {
        years,
        forward_pr: forward_pr.map(|p| to_dir_best(p, fwd_total)),
        reverse_pr: reverse_pr.map(|p| to_dir_best(p, rev_total)),
        section_distance,
    };
    Some(result)
}

/// Simple least-squares linear regression.
/// Returns (slope, intercept) for the best-fit line y = slope*x + intercept.
fn linear_regression(points: &[(f64, f64)]) -> (f64, f64) {
    let n = points.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0);
    }
    let sum_x: f64 = points.iter().map(|(x, _)| x).sum();
    let sum_y: f64 = points.iter().map(|(_, y)| y).sum();
    let sum_xy: f64 = points.iter().map(|(x, y)| x * y).sum();
    let sum_x2: f64 = points.iter().map(|(x, _)| x * x).sum();
    let denom = n * sum_x2 - sum_x * sum_x;
    if denom.abs() < f64::EPSILON {
        return (0.0, sum_y / n);
    }
    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;
    (slope, intercept)
}

impl PersistentEngine {
    /// Record that an activity moved the accepted eFTP, or update the marker
    /// a previous sync wrote for it.
    pub fn set_eftp_change(
        &self,
        activity_id: &str,
        date: i64,
        eftp: f64,
        delta: f64,
        activity_name: &str,
    ) -> SqlResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO eftp_changes
             (activity_id, date, eftp, delta, activity_name)
             VALUES (?, ?, ?, ?, ?)",
            params![activity_id, date, eftp, delta, activity_name],
        )?;
        Ok(())
    }

    /// Every activity that moved the accepted eFTP, oldest first, which is the
    /// order the fitness plot draws them in.
    pub fn eftp_changes(&self) -> Vec<crate::FfiEftpChange> {
        pooled::eftp_changes(&self.db)
    }
}

#[cfg(test)]
mod eftp_change_markers {
    use crate::persistence::PersistentEngine;

    fn seed(engine: &PersistentEngine, id: &str, date: i64, eftp: f64, delta: f64) {
        engine
            .set_eftp_change(id, date, eftp, delta, &format!("{id} ride"))
            .expect("write marker");
    }

    /// Scenario: the activities that moved the accepted eFTP were derived in
    /// TypeScript from a parsed body per activity, beside an engine that
    /// stores everything else the fitness plot draws.
    ///
    /// Expected behaviour: the engine answers with the markers, oldest first.
    #[test]
    fn the_markers_come_back_oldest_first() {
        let engine = PersistentEngine::in_memory().unwrap();
        seed(&engine, "b", 1_700_100_000, 372.0, 5.0);
        seed(&engine, "a", 1_700_000_000, 367.0, 20.0);

        let markers = engine.eftp_changes();

        assert_eq!(
            markers
                .iter()
                .map(|m| m.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(markers[0].eftp, 367.0);
        assert_eq!(markers[0].delta, 20.0);
        assert_eq!(markers[0].activity_name, "a ride");
    }

    /// The fitness plot draws the markers beside the trend it reads, so the
    /// trend carries them in every window, estimates or none.
    #[test]
    fn the_ftp_trend_carries_the_markers_in_any_window() {
        let engine = PersistentEngine::in_memory().unwrap();
        seed(&engine, "b", 1_700_100_000, 372.0, 5.0);
        seed(&engine, "a", 1_700_000_000, 367.0, 20.0);

        for lookback in [30, 90] {
            let trend = engine.get_ftp_trend_over_to("2026-09-05", lookback);
            assert_eq!(
                trend
                    .changes
                    .iter()
                    .map(|m| m.activity_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["a", "b"],
                "lookback {lookback}"
            );
        }
    }

    /// A resync reports the same activity again, and the marker is one row.
    #[test]
    fn re_reporting_an_activity_leaves_one_marker() {
        let engine = PersistentEngine::in_memory().unwrap();
        seed(&engine, "a", 1_700_000_000, 367.0, 20.0);
        seed(&engine, "a", 1_700_000_000, 368.0, 21.0);

        let markers = engine.eftp_changes();

        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].eftp, 368.0);
    }

    /// A library that has never moved its eFTP has no markers, not an error.
    #[test]
    fn a_library_with_no_changes_answers_with_nothing() {
        let engine = PersistentEngine::in_memory().unwrap();

        assert!(engine.eftp_changes().is_empty());
    }
}

/// The route highlight computation, over whatever loaded its inputs.
///
/// The engine answers it from its in-memory tier and a pooled reader answers
/// it from the tables that tier is loaded from, so the arithmetic lives here
/// once rather than twice.
pub(crate) mod highlights {
    use std::collections::{HashMap, HashSet};

    use rusqlite::Connection;

    /// One route group, as this computation needs it.
    pub(crate) struct GroupView<'a> {
        pub group_id: &'a str,
        pub activity_ids: &'a [String],
    }

    /// One member's effort on a route.
    #[derive(Clone)]
    pub(crate) struct Effort {
        pub distance: f64,
        pub moving_time: u32,
        pub date: i64,
        pub sport_type: String,
    }

    impl From<&crate::ActivityMetrics> for Effort {
        fn from(m: &crate::ActivityMetrics) -> Self {
            Effort {
                distance: m.distance,
                moving_time: m.moving_time,
                date: m.date,
                sport_type: m.sport_type.clone(),
            }
        }
    }

    /// One attempt in a route bucket.
    pub(crate) struct BucketMember<'a> {
        pub id: &'a str,
        pub speed: f64,
        pub moving_time: u32,
        pub date: i64,
        pub counted: bool,
    }

    /// The attempts at one route in one sport and one direction, oldest first.
    ///
    /// Excluded and partial members are not attempts, an activity with no
    /// match row reads as forward, and `counted` says whether the distance sits
    /// inside the band around the bucket's usual one, the only attempts that
    /// hold or contest the record or stand in the trend. The one place the
    /// bucket is drawn, for the per-activity highlight and the insights read.
    pub(crate) fn bucket_members<'a, F>(
        group: &GroupView<'a>,
        directions: Option<&HashMap<&str, bool>>,
        excluded: Option<&HashSet<String>>,
        sport: &str,
        forward: bool,
        effort_of: &F,
    ) -> Vec<BucketMember<'a>>
    where
        F: Fn(&str) -> Option<Effort>,
    {
        let mut members: Vec<(BucketMember<'a>, f64)> = group
            .activity_ids
            .iter()
            .filter_map(|id| {
                if excluded.is_some_and(|ids| ids.contains(id)) {
                    return None;
                }
                let is_fwd = directions
                    .and_then(|m| m.get(id.as_str()).copied())
                    .unwrap_or(true);
                if is_fwd != forward {
                    return None;
                }
                let m = effort_of(id)?;
                if m.sport_type != sport || m.moving_time == 0 || m.distance <= 0.0 {
                    return None;
                }
                Some((
                    BucketMember {
                        id: id.as_str(),
                        speed: m.distance / m.moving_time as f64,
                        moving_time: m.moving_time,
                        date: m.date,
                        counted: false,
                    },
                    m.distance,
                ))
            })
            .collect();
        members.sort_by_key(|(m, _)| m.date);
        let counted = crate::persistence::records::counted_for_route_record(
            sport,
            &members.iter().map(|(_, d)| *d).collect::<Vec<f64>>(),
        );
        members
            .into_iter()
            .zip(counted)
            .map(|((mut m, _), counted)| {
                m.counted = counted;
                m
            })
            .collect()
    }

    /// The clock and limits the insights read judges route buckets by.
    pub(crate) struct RouteInsightWindow {
        pub now: i64,
        /// A record is recent when its attempt is on or after this.
        pub recent_since: i64,
        /// A trend is shown only for a bucket whose newest attempt is this
        /// many days old or less.
        pub active_window_days: u32,
        pub history_limit: u32,
    }

    /// The trend's deadband, the one the section trend uses.
    const ROUTE_TREND_DEADBAND: f64 = 0.02;

    /// Every route bucket (route, sport, direction) holding a recent record or
    /// an eligible trend, recent records first and then newest attempt.
    ///
    /// Both verdicts read the bucket's counted attempts only, on moving time,
    /// the series the record rule is on. A record is the fastest counted
    /// attempt beating every other counted one. A trend is the section median
    /// window rule, and is withheld when the newest attempt is older than the
    /// active window.
    pub(crate) fn route_insights<'a, F>(
        groups: &[GroupView<'a>],
        directions: &HashMap<&'a str, HashMap<&'a str, bool>>,
        excluded: &HashMap<String, HashSet<String>>,
        route_names: &HashMap<String, String>,
        effort_of: F,
        window: &RouteInsightWindow,
    ) -> Vec<crate::FfiRouteInsight>
    where
        F: Fn(&str) -> Option<Effort>,
    {
        let mut rows: Vec<(crate::FfiRouteInsight, i64)> = Vec::new();
        for group in groups {
            let gid = group.group_id;
            let dir_map = directions.get(gid);
            let skipped = excluded.get(gid);
            let mut buckets: std::collections::BTreeSet<(String, bool)> =
                std::collections::BTreeSet::new();
            for id in group.activity_ids {
                if skipped.is_some_and(|ids| ids.contains(id)) {
                    continue;
                }
                let Some(effort) = effort_of(id) else {
                    continue;
                };
                let forward = dir_map
                    .and_then(|m| m.get(id.as_str()).copied())
                    .unwrap_or(true);
                buckets.insert((effort.sport_type, forward));
            }
            for (sport, forward) in buckets {
                let members = bucket_members(group, dir_map, skipped, &sport, forward, &effort_of);
                let counted: Vec<&BucketMember<'_>> =
                    members.iter().filter(|m| m.counted).collect();
                let (Some(newest), Some((best_at, best))) = (
                    counted.last(),
                    counted
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, m)| m.moving_time),
                ) else {
                    continue;
                };
                let rival = counted
                    .iter()
                    .enumerate()
                    .filter(|(at, _)| *at != best_at)
                    .map(|(_, m)| f64::from(m.moving_time))
                    .reduce(f64::min);
                let is_recent_record = best.date >= window.recent_since
                    && crate::persistence::records::is_personal_record(
                        f64::from(best.moving_time),
                        rival,
                    );
                let days_since_last = crate::calendar_days_between(newest.date, window.now);
                let times: Vec<f64> = counted.iter().map(|m| f64::from(m.moving_time)).collect();
                let trend = crate::persistence::sections::ranking::eligible_trend(
                    crate::trend::median_window_trend(&times, ROUTE_TREND_DEADBAND),
                    days_since_last,
                    window.active_window_days,
                )
                .unwrap_or(0);
                if !is_recent_record && trend == 0 {
                    continue;
                }
                rows.push((
                    crate::FfiRouteInsight {
                        route_id: gid.to_string(),
                        route_name: route_names.get(gid).cloned().unwrap_or_default(),
                        sport_type: sport,
                        is_reverse: !forward,
                        is_recent_record,
                        trend,
                        best_time: f64::from(best.moving_time),
                        days_since_last,
                        attempt_count: counted.len() as u32,
                        recent_efforts: crate::persistence::screens::series_tail(
                            counted.iter(),
                            window.history_limit,
                            |m| (f64::from(m.moving_time), m.date as f64),
                        ),
                    },
                    newest.date,
                ));
            }
        }
        rows.sort_by(|(a, a_newest), (b, b_newest)| {
            b.is_recent_record
                .cmp(&a.is_recent_record)
                .then(b_newest.cmp(a_newest))
                .then_with(|| a.route_id.cmp(&b.route_id))
                .then_with(|| a.sport_type.cmp(&b.sport_type))
                .then(a.is_reverse.cmp(&b.is_reverse))
        });
        rows.into_iter().map(|(row, _)| row).collect()
    }

    pub(crate) fn excluded_members(conn: &Connection) -> HashMap<String, HashSet<String>> {
        let mut excluded: HashMap<String, HashSet<String>> = HashMap::new();
        let Ok(mut stmt) =
            conn.prepare("SELECT route_id, activity_id FROM activity_matches WHERE excluded = 1")
        else {
            return excluded;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            return excluded;
        };
        for (route_id, activity_id) in rows.flatten() {
            excluded.entry(route_id).or_default().insert(activity_id);
        }
        excluded
    }

    /// The members that are not attempts at their route: the ones the athlete
    /// excluded and the ones that only partly overlap it. Neither earns a
    /// highlight or stands as another effort's rival.
    pub(crate) fn non_attempt_members(conn: &Connection) -> HashMap<String, HashSet<String>> {
        let mut members = excluded_members(conn);
        let Ok(mut stmt) = conn.prepare(
            "SELECT route_id, activity_id FROM activity_matches WHERE direction = 'partial'",
        ) else {
            return members;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            return members;
        };
        for (route_id, activity_id) in rows.flatten() {
            members.entry(route_id).or_default().insert(activity_id);
        }
        members
    }

    /// The name each route is shown under, keyed by group.
    pub(crate) fn route_names(conn: &Connection) -> HashMap<String, String> {
        crate::persistence::routes::pooled::all_route_names(conn)
    }

    /// The highlights for `activity_ids`, one per activity that is in a group.
    ///
    /// `groups` may be every group or only the ones holding a requested
    /// activity: a group holding none contributes to neither the membership
    /// map nor any cache key, so narrowing it does not change the answer.
    /// `effort_of` stays a lookup rather than a map so the engine path reads
    /// its own metrics tier without copying it.
    pub(crate) fn route_highlights<'a, F>(
        groups: &[GroupView<'a>],
        directions: &HashMap<&'a str, HashMap<&'a str, bool>>,
        excluded: &HashMap<String, HashSet<String>>,
        route_names: &HashMap<String, String>,
        effort_of: F,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityRouteHighlight>
    where
        F: Fn(&str) -> Option<Effort>,
    {
        let requested: std::collections::HashSet<&str> =
            activity_ids.iter().map(|s| s.as_str()).collect();

        // Which group each requested activity belongs to.
        let mut activity_to_group: HashMap<&str, &GroupView<'a>> = HashMap::new();
        for group in groups {
            for aid in group.activity_ids {
                if requested.contains(aid.as_str())
                    && !excluded
                        .get(group.group_id)
                        .is_some_and(|ids| ids.contains(aid))
                {
                    activity_to_group.insert(aid.as_str(), group);
                }
            }
        }

        if activity_to_group.is_empty() {
            log::debug!("route_highlights: groups=0 members=0 prs=0 trends=0");
            return vec![];
        }
        let groups_considered = activity_to_group
            .values()
            .map(|group| group.group_id)
            .collect::<HashSet<_>>()
            .len();

        // Cache keyed by group, direction and sport.
        // (best_moving_time, second_best_moving_time, per-activity data)
        type GroupCache<'a> =
            HashMap<(&'a str, bool, String), (u32, u32, HashMap<&'a str, (i8, f64, u32, bool)>)>;
        let mut group_cache: GroupCache<'_> = HashMap::new();
        let mut results = Vec::new();
        let mut members_ranked = 0usize;

        for (&aid, group) in &activity_to_group {
            let gid = group.group_id;
            let this_is_forward = directions
                .get(gid)
                .and_then(|m| m.get(aid).copied())
                .unwrap_or(true);

            let Some(this_effort) = effort_of(aid) else {
                continue;
            };

            let cache_key = (gid, this_is_forward, this_effort.sport_type.clone());

            if let std::collections::hash_map::Entry::Vacant(e) =
                group_cache.entry(cache_key.clone())
            {
                let members = bucket_members(
                    group,
                    directions.get(gid),
                    excluded.get(gid),
                    &this_effort.sport_type,
                    this_is_forward,
                    &effort_of,
                );
                members_ranked += members.len();
                let counts: Vec<bool> = members.iter().map(|m| m.counted).collect();

                if members.is_empty() {
                    e.insert((0u32, u32::MAX, HashMap::new()));
                } else {
                    let mut best_moving_time: u32 = u32::MAX;
                    let mut second_best_moving_time: u32 = u32::MAX;
                    let mut trends: HashMap<&str, (i8, f64, u32, bool)> = HashMap::new();
                    let mut sum = 0.0f64;
                    for (
                        n,
                        BucketMember {
                            id: mid,
                            speed,
                            moving_time,
                            ..
                        },
                    ) in members.iter().enumerate()
                    {
                        let trend = if n == 0 {
                            0i8
                        } else {
                            let avg = sum / n as f64;
                            if *speed > avg * 1.01 {
                                1
                            } else if *speed < avg * 0.99 {
                                -1
                            } else {
                                0
                            }
                        };
                        trends.insert(mid, (trend, *speed, *moving_time, counts[n]));
                        sum += speed;
                        if !counts[n] {
                            continue;
                        }
                        if *moving_time < best_moving_time {
                            second_best_moving_time = best_moving_time;
                            best_moving_time = *moving_time;
                        } else if *moving_time < second_best_moving_time {
                            second_best_moving_time = *moving_time;
                        }
                    }

                    if best_moving_time == u32::MAX {
                        best_moving_time = 0;
                    }
                    e.insert((best_moving_time, second_best_moving_time, trends));
                }
            }

            if let Some((best_moving_time, second_best_moving_time, trends)) =
                group_cache.get(&cache_key)
            {
                let (trend, _speed, moving_time, counted) =
                    trends.get(aid).copied().unwrap_or((0, 0.0, 0, false));
                // The record is beaten, not matched, so this effort is judged
                // against the best of the others: the second best when it holds
                // the best itself, and nothing at all when it is alone.
                let rival = crate::persistence::records::rival_of(
                    moving_time as f64,
                    (*best_moving_time > 0).then_some(*best_moving_time as f64),
                    (*second_best_moving_time != u32::MAX)
                        .then_some(*second_best_moving_time as f64),
                );
                let is_pr =
                    crate::persistence::records::is_personal_record(moving_time as f64, rival);
                let is_pr = is_pr && counted;
                let time_delta_seconds = if moving_time > 0 && *best_moving_time > 0 {
                    Some(moving_time as i32 - *best_moving_time as i32)
                } else {
                    None
                };
                let pr_improvement_seconds = if is_pr
                    && *second_best_moving_time != u32::MAX
                    && *second_best_moving_time > moving_time
                {
                    Some(*second_best_moving_time - moving_time)
                } else {
                    None
                };
                results.push(crate::FfiActivityRouteHighlight {
                    activity_id: aid.to_string(),
                    route_id: gid.to_string(),
                    route_name: route_names.get(gid).cloned().unwrap_or_default(),
                    is_pr,
                    trend,
                    time_delta_seconds,
                    pr_improvement_seconds,
                });
            }
        }

        log::debug!(
            "route_highlights: groups={} members={} prs={} trends={}",
            groups_considered,
            members_ranked,
            results.iter().filter(|r| r.is_pr).count(),
            results.iter().filter(|r| r.trend != 0).count()
        );
        results
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::PersistentEngine;
    use super::pooled::{PACE_LOOKBACK_DAYS, SYNC_PACE_WINDOW_DAYS};
    use crate::ActivityMetrics;

    const SETTINGS: &str = r#"[
        {"types":["Ride","GravelRide"],"hr_zone_names":["Easy","Steady","Hard"],"power_zone_names":["Active Recovery","Endurance"]},
        {"types":["Run"],"hr_zone_names":["Z1","Z2","Z3","Z4","Z5","Z6","Z7","Z8"]}
    ]"#;

    #[test]
    fn zone_names_come_from_the_settings_entry_covering_the_sport_family() {
        use super::pooled::zone_names;

        assert_eq!(
            zone_names(Some(SETTINGS), "EBikeRide", "hr"),
            vec!["Easy", "Steady", "Hard"]
        );
        assert_eq!(
            zone_names(Some(SETTINGS), "Ride", "power"),
            vec!["Active Recovery", "Endurance"]
        );
        let run = zone_names(Some(SETTINGS), "Run", "hr");
        assert_eq!(run.len(), crate::persistence::fitness::ZONE_COLUMNS);
        assert_eq!(run.last().map(String::as_str), Some("Z7"));
    }

    #[test]
    fn zone_names_are_empty_when_the_settings_cannot_name_the_zones() {
        use super::pooled::zone_names;

        assert!(zone_names(None, "Ride", "hr").is_empty());
        assert!(zone_names(Some("not json"), "Ride", "hr").is_empty());
        assert!(zone_names(Some(SETTINGS), "Swim", "hr").is_empty());
        assert!(zone_names(Some(SETTINGS), "Run", "power").is_empty());
        assert!(zone_names(Some(SETTINGS), "Ride", "cadence").is_empty());
        let wrong = r#"[{"types":["Ride"],"hr_zone_names":"many"}]"#;
        assert!(zone_names(Some(wrong), "Ride", "hr").is_empty());
        let mixed = r#"[{"types":["Ride"],"hr_zone_names":["Easy",3]}]"#;
        assert!(zone_names(Some(mixed), "Ride", "hr").is_empty());
    }

    fn metric(id: &str, sport: &str, ftp: Option<u16>) -> ActivityMetrics {
        ActivityMetrics {
            activity_id: id.to_string(),
            name: sport.to_string(),
            date: 1_700_000_000,
            distance: 40_000.0,
            moving_time: 3_600,
            elapsed_time: 3_700,
            elevation_gain: 400.0,
            avg_hr: Some(140),
            avg_power: Some(200),
            sport_type: sport.to_string(),
            training_load: None,
            ftp,
            power_zone_times: Some(vec![10, 20, 30, 40, 50, 60, 70]),
            hr_zone_times: Some(vec![11, 22, 33, 44, 55]),
        }
    }

    fn engine_with(metrics: Vec<ActivityMetrics>) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine.set_activity_metrics(metrics).unwrap();
        engine
    }

    /// 15 March 2026, noon UTC.
    const MARCH: i64 = 1_773_576_000;

    /// Monday 21 September 2026, 00:00:00 wall clock, as `activity_metrics.date`
    /// holds it.
    const MONDAY_21_SEPTEMBER: i64 = 1_789_948_800;
    const WEEK: i64 = 7 * 86_400;

    /// Scenario: a manual entry starts at exactly midnight on a Monday, which
    /// is the anchor of its own week and the end of the week before.
    ///
    /// Expected behaviour: it counts in the week it starts and in no other.
    #[test]
    fn an_activity_on_a_monday_anchor_counts_in_one_week() {
        let mut on_anchor = metric("midnight", "Ride", None);
        on_anchor.date = MONDAY_21_SEPTEMBER;
        let engine = engine_with(vec![on_anchor]);

        let weeks = super::pooled::weekly_summaries(
            &engine.db,
            &[MONDAY_21_SEPTEMBER - WEEK, MONDAY_21_SEPTEMBER],
            WEEK,
        );

        assert_eq!(
            weeks.iter().map(|w| w.count).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(weeks[0].moving_time, 0.0);
        assert_eq!(weeks[1].moving_time, 3_600.0);
    }

    /// The last second of a week is still that week's.
    #[test]
    fn an_activity_in_a_weeks_last_second_counts_in_that_week() {
        let mut last_second = metric("late", "Run", None);
        last_second.date = MONDAY_21_SEPTEMBER - 1;
        let engine = engine_with(vec![last_second]);

        let weeks = super::pooled::weekly_summaries(
            &engine.db,
            &[MONDAY_21_SEPTEMBER - WEEK, MONDAY_21_SEPTEMBER],
            WEEK,
        );

        assert_eq!(
            weeks.iter().map(|w| w.count).collect::<Vec<_>>(),
            vec![1, 0]
        );
    }

    fn lap(
        activity: &str,
        direction: &str,
        time: f64,
        metres: f64,
        coverage: f64,
    ) -> crate::SectionLap {
        crate::SectionLap {
            id: format!("{activity}_{direction}_{time}"),
            activity_id: activity.to_string(),
            time,
            pace: metres / time,
            distance: metres,
            direction: direction.to_string(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power: None,
            coverage: Some(coverage),
            excluded: false,
        }
    }

    fn record(
        activity: &str,
        date: i64,
        laps: Vec<crate::SectionLap>,
    ) -> crate::SectionPerformanceRecord {
        crate::SectionPerformanceRecord {
            activity_id: activity.to_string(),
            activity_name: format!("{activity} ride"),
            activity_date: date,
            lap_count: laps.len() as u32,
            best_time: laps.iter().map(|l| l.time).fold(f64::INFINITY, f64::min),
            best_pace: 0.0,
            best_forward_time: None,
            best_reverse_time: None,
            avg_time: 0.0,
            avg_pace: 0.0,
            direction: "same".to_string(),
            section_distance: 2_000.0,
            laps,
        }
    }

    fn calendar(records: Vec<crate::SectionPerformanceRecord>) -> Option<crate::CalendarSummary> {
        super::calendar_from(&crate::SectionPerformanceResult {
            records,
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        })
    }

    /// Scenario: one March ride laps a circuit section three times forward.
    ///
    /// Expected behaviour: the calendar counts three traversals from one
    /// activity, not one.
    #[test]
    fn a_three_lap_ride_is_three_traversals_from_one_activity() {
        let summary = calendar(vec![record(
            "loop",
            MARCH,
            vec![
                lap("loop", "same", 380.0, 2_000.0, 1.0),
                lap("loop", "same", 385.0, 2_000.0, 1.0),
                lap("loop", "same", 390.0, 2_000.0, 1.0),
            ],
        )])
        .expect("a calendar");

        let year = &summary.years[0];
        let month = &year.months[0];
        assert_eq!(month.traversal_count, 3);
        assert_eq!(month.forward.as_ref().map(|f| f.count), Some(3));
        assert_eq!(month.activity_count, 1);
        assert_eq!(year.traversal_count, 3);
        assert_eq!(year.forward.as_ref().map(|f| f.count), Some(3));
        assert_eq!(year.activity_count, 1);
        assert_eq!(summary.forward_pr.as_ref().map(|f| f.count), Some(3));
        assert_eq!(month.forward.as_ref().map(|f| f.best_time), Some(380.0));
    }

    /// An out-and-back is one traversal each way from one activity.
    #[test]
    fn an_out_and_back_is_one_traversal_each_way_from_one_activity() {
        let summary = calendar(vec![record(
            "oab",
            MARCH,
            vec![
                lap("oab", "same", 380.0, 2_000.0, 1.0),
                lap("oab", "reverse", 360.0, 2_000.0, 1.0),
            ],
        )])
        .expect("a calendar");

        let month = &summary.years[0].months[0];
        assert_eq!(month.forward.as_ref().map(|f| f.count), Some(1));
        assert_eq!(month.reverse.as_ref().map(|f| f.count), Some(1));
        assert_eq!(month.traversal_count, 2);
        assert_eq!(month.activity_count, 1);
    }

    /// Scenario: a 2 km section with six full forward laps near 380 s in May,
    /// a 200 m lap at 40 s covering a tenth of it, and a `partial` lap at 30 s.
    ///
    /// Expected behaviour: the calendar refuses both the way the record does,
    /// so neither moves the month best, the year best or the calendar's PR,
    /// and a record holding only such laps adds no entry.
    #[test]
    fn a_fragment_or_partial_lap_moves_no_calendar_best() {
        let mut records: Vec<_> = (0..6)
            .map(|i| {
                let id = format!("full{i}");
                let laps = vec![lap(&id, "same", 380.0 + i as f64, 2_000.0, 1.0)];
                record(&id, MARCH + i * 3_600, laps)
            })
            .collect();
        records.push(record(
            "frag",
            MARCH,
            vec![
                lap("frag", "same", 40.0, 200.0, 0.1),
                lap("frag", "partial", 30.0, 300.0, 0.15),
            ],
        ));
        // A fragment alone, in a month with nothing else.
        records.push(record(
            "lonely",
            MARCH + 60 * 86_400,
            vec![lap("lonely", "same", 41.0, 200.0, 0.1)],
        ));

        let summary = calendar(records).expect("a calendar");

        let year = &summary.years[0];
        assert_eq!(year.months.len(), 1, "the fragment-only month has no entry");
        let month = &year.months[0];
        assert_eq!(month.forward.as_ref().map(|f| f.best_time), Some(380.0));
        assert_eq!(month.traversal_count, 6);
        assert_eq!(month.activity_count, 6);
        assert_eq!(year.forward.as_ref().map(|f| f.best_time), Some(380.0));
        assert_eq!(
            summary
                .forward_pr
                .as_ref()
                .map(|f| f.best_activity_id.as_str()),
            Some("full0")
        );
        assert!(
            month.reverse.is_none(),
            "a partial lap is not a reverse one either"
        );
    }

    /// A section holding only fragments has no calendar at all.
    #[test]
    fn a_section_of_fragments_has_no_calendar() {
        assert!(
            calendar(vec![record(
                "frag",
                MARCH,
                vec![lap("frag", "same", 40.0, 200.0, 0.1)]
            )])
            .is_none()
        );
    }

    /// Scenario: a 1 km section with three full efforts carrying heart rate,
    /// and one row covering half of it at a pace the sanity range admits.
    ///
    /// Expected behaviour: the efficiency trend is taken over full traversals,
    /// so the fragment enters neither the regression nor the effort count.
    #[test]
    fn the_efficiency_trend_leaves_a_fragment_out() {
        let engine = engine_with(
            ["e1", "e2", "e3", "e4"]
                .iter()
                .enumerate()
                .map(|(i, id)| ActivityMetrics {
                    date: 1_700_000_000 + i as i64 * 86_400,
                    ..metric(id, "Ride", None)
                })
                .collect(),
        );
        // The junction rows name activities by id, and the trend reads their
        // metrics alone, so no track has to stand behind them.
        engine
            .db
            .execute_batch("PRAGMA foreign_keys = OFF")
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES ('s1', 'auto', 'Hill', 'Ride', '[]', 1000.0, 0, 1,
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        for id in ["e1", "e2", "e3", "e4"] {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?1, 'Ride', 0, 0, 0, 0)",
                    rusqlite::params![id],
                )
                .unwrap();
        }
        for (id, distance, lap_time, coverage) in [
            ("e1", 1000.0, 240.0, 1.0),
            ("e2", 1000.0, 235.0, 1.0),
            ("e3", 1000.0, 230.0, 1.0),
            ("e4", 500.0, 100.0, 0.5),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace,
                        avg_hr, coverage)
                     VALUES ('s1', ?1, 'same', 0, 10, ?2, ?3, ?2 / ?3, 150.0, ?4)",
                    rusqlite::params![id, distance, lap_time, coverage],
                )
                .unwrap();
        }

        let trend =
            super::pooled::section_efficiency_trend(&engine.db, "s1", "Ride", "Hill", 1000.0)
                .expect("three full efforts make a trend");

        assert_eq!(trend.effort_count, 3);
        assert!(trend.points.iter().all(|p| p.pace_secs_per_km > 200.0));
    }

    /// Scenario: one 1 km section run six times at a high-pulse pace, then
    /// ridden six times at a much faster pace and lower heart rate. Pooled, the
    /// later rides' lower heart-rate cost reads as a falling ratio.
    ///
    /// Expected behaviour: each sport's trend is taken over its own efforts, so
    /// neither sport alone is improving and each reports six efforts.
    #[test]
    fn the_efficiency_trend_is_taken_per_sport() {
        let engine = engine_with(
            (0..12)
                .map(|i| ActivityMetrics {
                    date: 1_700_000_000 + i as i64 * 86_400,
                    ..metric(&format!("e{i}"), if i < 6 { "Run" } else { "Ride" }, None)
                })
                .collect(),
        );
        engine
            .db
            .execute_batch("PRAGMA foreign_keys = OFF")
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES ('s1', 'auto', 'Hill', 'Run', '[]', 1000.0, 0, 1,
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        for i in 0..12 {
            let (sport, lap_time, hr) = if i < 6 {
                ("Run", 300.0, 150.0)
            } else {
                ("Ride", 120.0, 140.0)
            };
            let id = format!("e{i}");
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?1, ?2, 0, 0, 0, 0)",
                    rusqlite::params![id, sport],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace,
                        avg_hr, coverage)
                     VALUES ('s1', ?1, 'same', 0, 10, 1000.0, ?2, 1000.0 / ?2, ?3, 1.0)",
                    rusqlite::params![id, lap_time, hr],
                )
                .unwrap();
        }

        for sport in ["Run", "Ride"] {
            let trend =
                super::pooled::section_efficiency_trend(&engine.db, "s1", sport, "Hill", 1000.0)
                    .expect("six efforts make a trend");
            assert_eq!(trend.sport_type, sport);
            assert_eq!(trend.effort_count, 6);
            assert_eq!(
                trend.direction,
                crate::EfficiencyDirection::Flat,
                "{sport} did not change"
            );
        }
    }

    /// Scenario: five weekly efforts at a constant 150 bpm over one 1 km
    /// section, run at 340, 330, 320, 310 and 300 seconds per km.
    ///
    /// Expected behaviour: the trend is improving and `hr_change_bpm` is the
    /// ratio's movement restated at the mean pace, while every point still
    /// carries the unchanged heart rate. The figure is modelled, not measured.
    #[test]
    fn constant_heart_rate_with_faster_pace_moves_the_modelled_change_only() {
        let engine = engine_with(
            (0..5)
                .map(|i| ActivityMetrics {
                    date: 1_700_000_000 + i as i64 * 7 * 86_400,
                    ..metric(&format!("e{i}"), "Run", None)
                })
                .collect(),
        );
        engine
            .db
            .execute_batch("PRAGMA foreign_keys = OFF")
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES ('s1', 'auto', 'Hill', 'Run', '[]', 1000.0, 0, 1,
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        for (i, lap_time) in [340.0, 330.0, 320.0, 310.0, 300.0].iter().enumerate() {
            let id = format!("e{i}");
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?1, 'Run', 0, 0, 0, 0)",
                    rusqlite::params![id],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace,
                        avg_hr, coverage)
                     VALUES ('s1', ?1, 'same', 0, 10, 1000.0, ?2, 1000.0 / ?2, 150.0, 1.0)",
                    rusqlite::params![id, lap_time],
                )
                .unwrap();
        }

        let trend =
            super::pooled::section_efficiency_trend(&engine.db, "s1", "Run", "Hill", 1000.0)
                .expect("five efforts make a trend");

        assert!(trend.points.iter().all(|p| p.avg_hr == 150.0));
        assert_eq!(trend.direction, crate::EfficiencyDirection::Improving);
        assert!(
            (trend.hr_change_bpm - -18.75).abs() < 0.01,
            "hr_change_bpm {} is slope * days / mean pace",
            trend.hr_change_bpm
        );

        engine
            .db
            .execute(
                "UPDATE section_activities SET lap_time = 640.0 - lap_time",
                [],
            )
            .unwrap();
        let worsening =
            super::pooled::section_efficiency_trend(&engine.db, "s1", "Run", "Hill", 1000.0)
                .expect("five efforts make a trend");
        assert_eq!(worsening.direction, crate::EfficiencyDirection::Worsening);
    }

    /// A metric on a given UTC day, with the three fields the season chart sums.
    fn on_day(id: &str, day: &str, moving_time: u32, distance: f64, load: f64) -> ActivityMetrics {
        let date = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();
        ActivityMetrics {
            date,
            distance,
            moving_time,
            training_load: Some(load),
            ..metric(id, "Ride", None)
        }
    }

    // Scenario: the season chart plots two calendar years month by month. It
    // summed a parsed array of every body in the window to do it, so the cost
    // scaled with the library rather than with the 24 bars it draws.
    #[test]
    fn monthly_stats_group_by_calendar_month() {
        let engine = engine_with(vec![
            on_day("a", "2025-01-05", 3_600, 40_000.0, 50.0),
            on_day("b", "2025-01-20", 1_800, 20_000.0, 25.0),
            on_day("c", "2025-03-01", 7_200, 80_000.0, 100.0),
        ]);

        let months = engine
            .get_monthly_stats(day_ts("2025-01-01"), day_ts("2025-12-31"))
            .unwrap();

        assert_eq!(months.len(), 2, "only months with activities are returned");
        assert_eq!(months[0].year, 2025);
        assert_eq!(months[0].month, 1);
        assert_eq!(months[0].stats.count, 2);
        assert_eq!(months[0].stats.total_duration, 5_400.0);
        assert_eq!(months[0].stats.total_distance, 60_000.0);
        assert_eq!(months[0].stats.total_tss, 75.0);
        assert_eq!(months[1].month, 3);
        assert_eq!(months[1].stats.count, 1);
    }

    #[test]
    fn monthly_stats_are_oldest_first_across_a_year_boundary() {
        let engine = engine_with(vec![
            on_day("a", "2025-12-20", 3_600, 40_000.0, 50.0),
            on_day("b", "2026-01-10", 3_600, 40_000.0, 50.0),
            on_day("c", "2026-02-10", 3_600, 40_000.0, 50.0),
        ]);

        let months = engine
            .get_monthly_stats(day_ts("2025-01-01"), day_ts("2026-12-31"))
            .unwrap();

        let order: Vec<(i32, u32)> = months.iter().map(|m| (m.year, m.month)).collect();
        assert_eq!(order, vec![(2025, 12), (2026, 1), (2026, 2)]);
    }

    #[test]
    fn monthly_stats_exclude_what_falls_outside_the_window() {
        let engine = engine_with(vec![
            on_day("before", "2024-12-31", 3_600, 40_000.0, 50.0),
            on_day("inside", "2025-06-15", 3_600, 40_000.0, 50.0),
            on_day("after", "2026-01-01", 3_600, 40_000.0, 50.0),
        ]);

        let months = engine
            .get_monthly_stats(day_ts("2025-01-01"), day_ts("2025-12-31"))
            .unwrap();

        assert_eq!(months.len(), 1);
        assert_eq!(months[0].month, 6);
    }

    #[test]
    fn monthly_stats_are_empty_rather_than_absent_for_a_window_with_nothing_in_it() {
        let engine = engine_with(vec![on_day("a", "2025-01-05", 3_600, 40_000.0, 50.0)]);

        assert!(
            engine
                .get_monthly_stats(day_ts("2020-01-01"), day_ts("2020-12-31"))
                .unwrap()
                .is_empty()
        );
    }

    // A null training load is no load, not a month with no total: the chart
    // plots every month of the year and a missing one reads as a gap.
    #[test]
    fn monthly_stats_count_an_activity_with_no_training_load() {
        let mut no_load = on_day("a", "2025-01-05", 3_600, 40_000.0, 0.0);
        no_load.training_load = None;
        let engine = engine_with(vec![no_load]);

        let months = engine
            .get_monthly_stats(day_ts("2025-01-01"), day_ts("2025-12-31"))
            .unwrap();

        assert_eq!(months.len(), 1);
        assert_eq!(months[0].stats.count, 1);
        assert_eq!(months[0].stats.total_tss, 0.0);
        assert_eq!(months[0].stats.total_duration, 3_600.0);
    }

    fn day_ts(day: &str) -> i64 {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp()
    }

    // Scenario: the zone chart asked for `Ride` and the aggregate matched the
    // string exactly, so a gravel or e-bike ride's zone seconds never reached
    // the chart the athlete filtered to cycling.
    #[test]
    fn zone_distribution_sums_every_sport_in_the_family() {
        let engine = engine_with(vec![
            metric("a1", "Ride", None),
            metric("a2", "GravelRide", None),
            metric("a3", "EBikeRide", None),
            metric("a4", "Run", None),
        ]);

        assert_eq!(
            engine.get_zone_distribution("Ride", "power", 0, i64::MAX),
            vec![30.0, 60.0, 90.0, 120.0, 150.0, 180.0, 210.0]
        );
        assert_eq!(
            engine.get_zone_distribution("Run", "hr", 0, i64::MAX),
            vec![11.0, 22.0, 33.0, 44.0, 55.0, 0.0, 0.0]
        );
    }

    #[test]
    fn zone_distribution_counts_only_activities_inside_the_window() {
        let mut inside = metric("in", "Ride", None);
        inside.date = MONDAY_21_SEPTEMBER + 3_600;
        let mut before = metric("before", "Ride", None);
        before.date = MONDAY_21_SEPTEMBER - 1;
        let mut after = metric("after", "Ride", None);
        after.date = MONDAY_21_SEPTEMBER + 7 * 86_400;
        let engine = engine_with(vec![inside, before, after]);
        let (start, end) = (MONDAY_21_SEPTEMBER, MONDAY_21_SEPTEMBER + 86_400);

        assert_eq!(
            engine.get_zone_distribution("Ride", "power", start, end),
            vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0]
        );
        assert_eq!(
            engine.get_zone_distribution("Ride", "hr", start, end),
            vec![11.0, 22.0, 33.0, 44.0, 55.0, 0.0, 0.0]
        );
        assert_eq!(
            engine.get_zone_distribution("Ride", "power", end, end + 1),
            vec![0.0; 7]
        );
    }

    #[test]
    fn zone_distribution_of_an_unknown_sport_is_its_own_rows() {
        let engine = engine_with(vec![
            metric("a1", "Ride", None),
            metric("a2", "Unicycle", None),
        ]);

        assert_eq!(
            engine.get_zone_distribution("Unicycle", "hr", 0, i64::MAX),
            vec![11.0, 22.0, 33.0, 44.0, 55.0, 0.0, 0.0]
        );
        assert_eq!(
            engine
                .get_zone_distribution("Pogo", "hr", 0, i64::MAX)
                .iter()
                .sum::<f64>(),
            0.0
        );
        assert!(
            engine
                .get_zone_distribution("Ride", "cadence", 0, i64::MAX)
                .is_empty()
        );
    }

    /// Scenario: three years of wellness on the device. The table is upserted
    /// 365 days a sync and nothing ever prunes it.
    ///
    /// Expected behaviour: the trend reads back only as far as the day it
    /// compares against. Every body pulled past that is a JSON parse for an
    /// answer already known.
    mod trend_days {
        use super::super::trend_days;
        use std::cell::Cell;

        fn body(eftp: f64) -> String {
            serde_json::json!({ "sportInfo": [{"type": "Ride", "eftp": eftp}] }).to_string()
        }

        /// `n` days ending at 2026-09-05, newest first.
        fn newest_first(n: usize) -> Vec<(String, String)> {
            let end = chrono::NaiveDate::parse_from_str("2026-09-05", "%Y-%m-%d").unwrap();
            (0..n)
                .map(|i| {
                    let date = end - chrono::Duration::days(i as i64);
                    (date.format("%Y-%m-%d").to_string(), body(200.0 + i as f64))
                })
                .collect()
        }

        /// Counts what the reader actually pulled off the statement.
        fn pulled(rows: Vec<(String, String)>) -> (Vec<(String, u16)>, usize) {
            let count = Cell::new(0usize);
            let days = trend_days(rows.into_iter().inspect(|_| count.set(count.get() + 1)), 30);
            (days, count.get())
        }

        #[test]
        fn stops_at_the_day_it_compares_against() {
            let (days, read) = pulled(newest_first(1_100));

            assert_eq!(read, 31, "reads the newest day and thirty days back");
            assert_eq!(days.len(), 31);
            assert_eq!(days.last().unwrap().1, 200, "newest day last");
            assert_eq!(days.first().unwrap().1, 230, "the day compared against");
        }

        #[test]
        fn reads_what_there_is_when_the_history_is_shorter_than_the_window() {
            let (days, read) = pulled(newest_first(5));

            assert_eq!(read, 5);
            assert_eq!(days.len(), 5);
        }

        #[test]
        fn skips_a_day_with_no_cycling_entry_without_counting_it_as_the_latest() {
            let mut rows = newest_first(40);
            rows[0].1 =
                serde_json::json!({ "sportInfo": [{"type": "Run", "eftp": 300.0}] }).to_string();

            let (days, _) = pulled(rows);

            assert_eq!(days.last().unwrap().0, "2026-09-04");
        }

        #[test]
        fn keeps_reading_past_a_gap_to_find_a_day_old_enough() {
            // A month off the bike, then a season of riding before it.
            let mut rows = newest_first(200);
            for row in rows.iter_mut().take(60).skip(1) {
                row.1 = serde_json::json!({ "sportInfo": [] }).to_string();
            }

            let (days, _) = pulled(rows);

            assert_eq!(days.last().unwrap().0, "2026-09-05");
            assert!(
                days.first().unwrap().0.as_str() <= "2026-08-06",
                "the day compared against is at least thirty days older"
            );
        }

        #[test]
        fn reads_the_whole_stream_when_no_day_carries_an_estimate() {
            let rows: Vec<(String, String)> = newest_first(10)
                .into_iter()
                .map(|(d, _)| (d, "not json at all".to_string()))
                .collect();

            let (days, read) = pulled(rows);

            assert!(days.is_empty());
            assert_eq!(read, 10);
        }
    }

    /// Every sport in the cycling family carries the same threshold, and a
    /// running entry on the same day is a different number.
    #[test]
    fn ftp_trend_reads_every_cycling_sport_and_no_other() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let day = |date: &str, sport: &str, eftp: f64| {
            let mut row = wellness_day(date, None);
            row.raw = Some(
                serde_json::json!({
                    "id": date,
                    "sportInfo": [
                        {"type": "Run", "eftp": 300.0},
                        {"type": sport, "eftp": eftp},
                    ],
                })
                .to_string(),
            );
            row
        };
        engine
            .upsert_wellness(&[
                day("2026-08-01", "TrackRide", 240.0),
                day("2026-09-05", "EBikeRide", 260.0),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");
        assert_eq!(trend.latest_ftp, Some(260));
        assert_eq!(trend.previous_ftp, Some(240));
    }

    /// Scenario: the stale-PR card asks what the athlete's fitness was on the
    /// day a section record was set.
    ///
    /// Expected behaviour: the eFTP from the newest wellness body at or before
    /// that day, and nothing at all for a day before the first body.
    #[test]
    fn fitness_on_reads_the_day_the_record_was_set() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let day = |date: &str, eftp: f64| {
            let mut row = wellness_day(date, None);
            row.raw = Some(
                serde_json::json!({
                    "id": date,
                    "sportInfo": [{"type": "Ride", "eftp": eftp}],
                })
                .to_string(),
            );
            row
        };
        engine
            .upsert_wellness(&[day("2026-03-01", 230.0), day("2026-08-01", 250.0)])
            .unwrap();

        let at = |iso: &str| {
            chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d")
                .expect("date")
                .and_hms_opt(12, 0, 0)
                .expect("midday")
                .and_utc()
                .timestamp() as f64
        };

        assert_eq!(engine.fitness_on("Ride", at("2026-03-02")), Some(230.0));
        assert_eq!(engine.fitness_on("Ride", at("2026-08-15")), Some(250.0));
        assert_eq!(
            engine.fitness_on("Ride", at("2026-02-01")),
            None,
            "nothing recorded by then"
        );
    }

    /// The running and swimming side reads the critical-speed snapshot, on or
    /// before the same day.
    #[test]
    fn fitness_on_reads_the_pace_snapshot_for_a_run() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.0, None, None, 1_700_000_000, SYNC_PACE_WINDOW_DAYS);
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_500_000, SYNC_PACE_WINDOW_DAYS);

        assert_eq!(engine.fitness_on("Run", 1_700_400_000.0), Some(3.0));
        assert_eq!(engine.fitness_on("Run", 1_700_600_000.0), Some(3.5));
        assert_eq!(engine.fitness_on("Run", 1_600_000_000.0), None);
        assert_eq!(engine.fitness_on("Walk", 1_700_600_000.0), None);
    }

    /// Scenario: the pace curve screen writes a snapshot of whatever range it
    /// is showing, and the sync writes the 42-day one. A year curve's critical
    /// speed is the athlete's best year where a six-week curve's is recent
    /// form, so reading whichever row is newest on or before a date reads two
    /// different facts on two consecutive days.
    ///
    /// Expected behaviour: the fitness read takes the sync's window, the same
    /// one the pace trend compares, and nothing else.
    #[test]
    fn fitness_on_takes_only_the_syncs_window() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot(
            "Run",
            3.95,
            None,
            None,
            1_700_000_000,
            SYNC_PACE_WINDOW_DAYS,
        );
        // The screen, on the year range, the next day: the athlete's best year.
        engine.save_pace_snapshot("Run", 4.10, None, None, 1_700_086_400, 365);

        assert_eq!(
            engine.fitness_on("Run", 1_700_200_000.0),
            Some(3.95),
            "the year curve is a different fact, not a fitter athlete"
        );
    }

    /// A row upgraded from before the window column is of an unknown range, and
    /// the read leaves it out rather than assuming it was the sync's. The card
    /// it feeds is quiet until the next sync writes one.
    #[test]
    fn fitness_on_leaves_out_a_row_from_before_the_window_column() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO pace_history (date, sport_type, critical_speed, window_days)
                 VALUES (?, 'Run', 4.10, NULL)",
                rusqlite::params![1_700_000_000i64],
            )
            .expect("a legacy row");

        assert_eq!(engine.fitness_on("Run", 1_700_200_000.0), None);
    }

    /// Activity FTP values do not drive the trend, which reads wellness eFTP.
    #[test]
    fn the_configured_setting_does_not_reach_the_trend() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut older = metric("a1", "Ride", Some(240));
        older.date = 1_700_000_000;
        let mut newer = metric("a2", "Ride", Some(300));
        newer.date = 1_700_100_000;
        engine.set_activity_metrics(vec![older, newer]).unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-01", Some(150.0)),
                wellness_day("2026-09-05", Some(141.0)),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(
            trend.latest_ftp,
            Some(141),
            "the estimate, not the 300 W setting"
        );
        assert_eq!(trend.previous_ftp, Some(150));
    }

    /// A wellness day carrying the daily model estimate for cycling, which is
    /// what intervals.icu puts in `sportInfo[].eftp`.
    /// A day whose body carries a running estimate and no cycling entry.
    fn run_only_day(date: &str) -> crate::persistence::wellness::WellnessRow {
        let mut row = wellness_day(date, Some(1.0));
        row.raw = Some(
            serde_json::json!({"id": date, "sportInfo": [{"type": "Run", "eftp": 300.0}]})
                .to_string(),
        );
        row
    }

    fn wellness_day(
        date: &str,
        cycling_eftp: Option<f64>,
    ) -> crate::persistence::wellness::WellnessRow {
        let raw = cycling_eftp.map(|eftp| {
            serde_json::json!({
                "id": date,
                "sportInfo": [
                    {"type": "Ride", "eftp": eftp},
                    {"type": "Run", "eftp": 999.0},
                ],
            })
            .to_string()
        });
        crate::persistence::wellness::WellnessRow {
            date: date.to_string(),
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
            raw,
        }
    }

    /// Scenario: `icu_ftp` is the athlete's configured setting, and on a real
    /// five-year account it holds one value throughout, so a trend read from it
    /// never has a previous value and the delta never renders. The daily model
    /// estimate is already on the device in the wellness body and does move.
    ///
    /// Expected behaviour: the trend is the daily estimate, newest against the
    /// same series a month back, and the cycling entry alone.
    #[test]
    fn the_ftp_trend_is_the_daily_estimate_and_not_the_setting() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        // A setting that never moves, which is what the old trend read.
        let mut older = metric("a1", "Ride", Some(155));
        older.date = 1_700_000_000;
        let mut newer = metric("a2", "Ride", Some(155));
        newer.date = 1_700_100_000;
        engine.set_activity_metrics(vec![older, newer]).unwrap();

        engine
            .upsert_wellness(&[
                wellness_day("2026-08-06", Some(148.0)),
                wellness_day("2026-09-04", Some(143.0)),
                wellness_day("2026-09-05", Some(141.0)),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.latest_ftp, Some(141), "the newest daily estimate");
        assert_eq!(
            trend.previous_ftp,
            Some(148),
            "the estimate a month back, not the row before it"
        );
    }

    /// A day with no cycling entry is not a cycling estimate, and a running one
    /// is a different number entirely.
    #[test]
    fn the_ftp_trend_ignores_a_day_with_no_cycling_estimate() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-06", Some(150.0)),
                wellness_day("2026-09-05", None),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.latest_ftp, Some(150));
        assert_eq!(trend.previous_ftp, None, "one value is not a trend");
    }

    /// Scenario: a runner's wellness bodies carry no cycling entry.
    ///
    /// Expected behaviour: the query hands Rust none of them, and the trend is
    /// the default.
    #[test]
    fn the_ftp_trend_query_fetches_no_body_without_a_cycling_estimate() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                run_only_day("2026-09-03"),
                run_only_day("2026-09-04"),
                run_only_day("2026-09-05"),
            ])
            .unwrap();

        let rows = super::pooled::cycling_wellness_rows(&engine.db, "2026-09-05").unwrap();

        assert!(rows.is_empty());
        let trend = engine.get_ftp_trend_to("2026-09-05");
        assert_eq!(trend.latest_ftp, None);
        assert_eq!(trend.previous_ftp, None);
    }

    /// A day with a cycling estimate among days without is the only row read.
    #[test]
    fn the_ftp_trend_query_keeps_only_days_with_a_cycling_estimate() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-06", Some(148.0)),
                run_only_day("2026-09-04"),
                wellness_day("2026-09-05", Some(141.0)),
            ])
            .unwrap();

        let rows = super::pooled::cycling_wellness_rows(&engine.db, "2026-09-05").unwrap();

        let dates: Vec<_> = rows.iter().map(|(d, _)| d.as_str()).collect();
        assert_eq!(dates, ["2026-09-05", "2026-08-06"]);
        let trend = engine.get_ftp_trend_to("2026-09-05");
        assert_eq!(
            (trend.latest_ftp, trend.previous_ftp),
            (Some(141), Some(148))
        );
    }

    /// An account with no wellness body has nothing to report, rather than
    /// falling back to a setting that would read as a fitness change.
    #[test]
    fn the_ftp_trend_is_empty_without_a_daily_estimate() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut only = metric("a1", "Ride", Some(240));
        only.date = 1_700_000_000;
        engine.set_activity_metrics(vec![only]).unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.latest_ftp, None);
        assert_eq!(trend.previous_ftp, None);
    }

    /// Scenario: the insight ranker weighs how much data a claim stands on, and
    /// an FTP step measured off three days reads the same as one off thirty.
    ///
    /// Expected behaviour: the trend says how many days carried an estimate
    /// between the two it compared, so the ranker has a population to weigh.
    #[test]
    fn the_ftp_trend_reports_the_days_it_compared_across() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                // Outside the window the comparison reaches back to.
                wellness_day("2026-07-01", Some(160.0)),
                wellness_day("2026-08-06", Some(148.0)),
                wellness_day("2026-08-20", Some(145.0)),
                wellness_day("2026-09-04", Some(143.0)),
                wellness_day("2026-09-05", Some(141.0)),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.previous_ftp, Some(148), "the estimate a month back");
        assert_eq!(
            trend.sample_count, 4,
            "the days from the one it compared against to the newest, inclusive"
        );
    }

    /// A trend with nothing to compare against stands on the one day it has.
    #[test]
    fn a_trend_with_no_earlier_estimate_counts_only_what_it_holds() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[wellness_day("2026-09-05", Some(150.0))])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.previous_ftp, None, "one value is not a trend");
        assert_eq!(trend.sample_count, 1, "and it is one value");
    }

    /// An account with nothing stored counts nothing, rather than one.
    #[test]
    fn an_empty_ftp_trend_counts_nothing() {
        let engine = PersistentEngine::in_memory().unwrap();
        assert_eq!(engine.get_ftp_trend_to("2026-09-05").sample_count, 0);
    }

    /// Scenario: the fitness tab captions its eFTP badge "from 3 months ago"
    /// and plots the daily series, and the trend compared across a month.
    ///
    /// Expected behaviour: given a 90-day lookback the step is read against
    /// the day 90 days back and the history carries every day of the window,
    /// where the default lookback still compares across 30.
    #[test]
    fn the_ftp_trend_reads_the_lookback_it_is_asked_for() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut days = vec![wellness_day("2026-06-07", Some(150.0))];
        let start = chrono::NaiveDate::from_ymd_opt(2026, 6, 8).unwrap();
        for offset in 0..90 {
            let day = (start + chrono::Duration::days(offset))
                .format("%Y-%m-%d")
                .to_string();
            days.push(wellness_day(&day, Some(160.0 + offset as f64 / 10.0)));
        }
        engine.upsert_wellness(&days).unwrap();

        let month = engine.get_ftp_trend_to("2026-09-05");
        assert_eq!(month.previous_ftp, Some(166), "the estimate 30 days back");

        let quarter = engine.get_ftp_trend_over_to("2026-09-05", 90);
        assert_eq!(quarter.latest_ftp, Some(169));
        assert_eq!(quarter.previous_ftp, Some(150), "the estimate 90 days back");
        assert_eq!(quarter.delta_watts, Some(19));
        assert_eq!(quarter.sample_count, 91);
        assert_eq!(
            quarter.history.len(),
            91,
            "every day of the window reaches the chart, not the card's tail"
        );
    }

    /// A lookback longer than the stored history compares against nothing.
    #[test]
    fn a_lookback_longer_than_the_history_has_no_step() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-20", Some(150.0)),
                wellness_day("2026-09-05", Some(155.0)),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_over_to("2026-09-05", 90);

        assert_eq!(trend.latest_ftp, Some(155));
        assert_eq!(trend.previous_ftp, None);
        assert_eq!(trend.history.len(), 2);
    }

    /// Scenario: the FTP step is stated on the insights screen, in a
    /// notification body and on the widget, and each subtracted its own way.
    ///
    /// Expected behaviour: the trend carries the step, so every reader quotes
    /// the one number.
    #[test]
    fn the_ftp_trend_carries_the_step_in_watts() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-06", Some(155.0)),
                wellness_day("2026-09-05", Some(168.0)),
            ])
            .unwrap();

        let trend = engine.get_ftp_trend_to("2026-09-05");

        assert_eq!(trend.previous_ftp, Some(155));
        assert_eq!(trend.latest_ftp, Some(168));
        assert_eq!(trend.delta_watts, Some(13));
    }

    /// A fall is a step too, and the sign is the trend's to state.
    #[test]
    fn the_ftp_step_carries_its_sign() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[
                wellness_day("2026-08-06", Some(168.0)),
                wellness_day("2026-09-05", Some(155.0)),
            ])
            .unwrap();

        assert_eq!(engine.get_ftp_trend_to("2026-09-05").delta_watts, Some(-13));
    }

    /// Nothing to compare against is no step, not a step of zero.
    #[test]
    fn an_ftp_trend_with_no_earlier_estimate_carries_no_step() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_wellness(&[wellness_day("2026-09-05", Some(150.0))])
            .unwrap();

        assert_eq!(engine.get_ftp_trend_to("2026-09-05").delta_watts, None);
        assert_eq!(
            PersistentEngine::in_memory()
                .unwrap()
                .get_ftp_trend_to("2026-09-05")
                .delta_watts,
            None
        );
    }

    /// Scenario: a running pace step is read as a gain percent and as seconds
    /// off the kilometre, and both were derived from the two speeds by hand.
    ///
    /// Expected behaviour: the trend carries the move in the unit the sport is
    /// paced in.
    #[test]
    fn the_run_pace_trend_carries_the_gain_and_the_seconds_off_the_kilometre() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.2, None, None, 1_700_000_000, SYNC_PACE_WINDOW_DAYS);
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_200_000, SYNC_PACE_WINDOW_DAYS);

        let trend = engine.get_pace_trend("Run");

        let gain = trend.gain_percent.expect("a gain");
        assert!((gain - 9.375).abs() < 1e-6, "{gain} percent of 3.2 m/s");
        // 1000/3.2 is 312.5 s and 1000/3.5 is 285.71 s.
        let delta = trend.delta_seconds.expect("a delta");
        assert!((delta - 26.785_714_285).abs() < 1e-6, "{delta} s/km");
    }

    /// Swimming is paced over a hundred metres, not a kilometre.
    #[test]
    fn the_swim_pace_trend_paces_over_a_hundred_metres() {
        let engine = PersistentEngine::in_memory().unwrap();
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

        let trend = engine.get_pace_trend("Swim");

        assert_eq!(trend.gain_percent, Some(25.0));
        // 100 s per 100 m against 80 s per 100 m.
        assert_eq!(trend.delta_seconds, Some(20.0));
    }

    /// Scenario: `pace_history` is written by two callers with different
    /// windows. The pace curve screen wrote the critical speed of whatever
    /// range it was showing, 7 days to a year, and the sync writes the 42-day
    /// curve. A year curve's critical speed is the athlete's best year and a
    /// 42-day curve's is the last six weeks, so the card compared two estimates
    /// of different things and called the difference an improvement.
    ///
    /// Expected behaviour: a snapshot carries the window it was read over, and
    /// the trend compares only snapshots of one window.
    #[test]
    fn two_windows_on_adjacent_days_are_not_a_trend() {
        let engine = PersistentEngine::in_memory().unwrap();
        // The screen, on the year range: the athlete's best year.
        engine.save_pace_snapshot("Run", 4.10, None, None, 1_700_000_000, 365);
        // The sync, the next day: the last six weeks.
        engine.save_pace_snapshot("Run", 3.95, None, None, 1_700_086_400, 42);

        let trend = engine.get_pace_trend("Run");

        assert_eq!(
            trend.previous_pace, None,
            "two windows are not a comparison"
        );
        assert_eq!(trend.gain_percent, None);
        assert_eq!(trend.delta_seconds, None);
    }

    /// The two writers no longer overwrite each other either: the window is
    /// part of what makes a snapshot distinct, so a screen row and a sync row
    /// stamped the same day are two rows.
    #[test]
    fn a_screen_snapshot_does_not_replace_the_syncs_for_that_day() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.95, None, None, 1_700_000_000, 42);
        engine.save_pace_snapshot("Run", 4.10, None, None, 1_700_000_000, 365);
        engine.save_pace_snapshot("Run", 3.80, None, None, 1_699_000_000, 42);

        let trend = engine.get_pace_trend("Run");

        assert_eq!(
            trend.latest_pace,
            Some(3.95),
            "the sync's row, not the screen's"
        );
        assert_eq!(trend.previous_pace, Some(3.80));
    }

    /// A comparison against a snapshot older than the lookback is not a trend,
    /// the way the FTP trend is bounded. Otherwise the card reaches back
    /// through twenty rows of whatever age and calls it a recent improvement.
    #[test]
    fn a_previous_snapshot_past_the_lookback_is_not_a_trend() {
        let engine = PersistentEngine::in_memory().unwrap();
        let today = 1_700_000_000;
        let long_ago = today - (PACE_LOOKBACK_DAYS + 5) * 86_400;
        engine.save_pace_snapshot("Run", 3.60, None, None, long_ago, 42);
        engine.save_pace_snapshot("Run", 3.95, None, None, today, 42);

        let trend = engine.get_pace_trend("Run");

        assert_eq!(trend.latest_pace, Some(3.95));
        assert_eq!(trend.previous_pace, None, "too old to be a move");
    }

    /// Expected behaviour: the lookback is bound by date, so a daily syncer
    /// with more than twenty recent rows still reaches the older reading.
    #[test]
    fn a_daily_syncer_reaches_the_lookback_past_twenty_rows() {
        let engine = PersistentEngine::in_memory().unwrap();
        let today = 1_700_000_000;
        engine.save_pace_snapshot("Run", 3.40, None, None, today - 35 * 86_400, 42);
        for day in 0..25 {
            engine.save_pace_snapshot("Run", 3.50, None, None, today - day * 86_400, 42);
        }

        let trend = engine.get_pace_trend("Run");

        assert_eq!(trend.previous_pace, Some(3.40));
        assert_eq!(trend.sample_count, 26);
    }

    /// Inside the lookback it is a trend, which is the other half of the bound.
    #[test]
    fn a_previous_snapshot_inside_the_lookback_is_a_trend() {
        let engine = PersistentEngine::in_memory().unwrap();
        let today = 1_700_000_000;
        let recent = today - (PACE_LOOKBACK_DAYS - 5) * 86_400;
        engine.save_pace_snapshot("Run", 3.60, None, None, recent, 42);
        engine.save_pace_snapshot("Run", 3.95, None, None, today, 42);

        let trend = engine.get_pace_trend("Run");

        assert_eq!(trend.previous_pace, Some(3.60));
    }

    /// A row upgraded from before the window column is of an unknown window,
    /// and an unknown window cannot be compared with a known one. It is left
    /// out rather than assumed to be the sync's: assuming is how the card came
    /// to compare a year curve with a six-week one in the first place.
    #[test]
    fn a_row_from_before_the_window_column_is_not_compared() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO pace_history (date, sport_type, critical_speed, window_days)
                 VALUES (?, 'Run', 4.10, NULL)",
                rusqlite::params![1_700_000_000i64],
            )
            .expect("a legacy row");
        engine.save_pace_snapshot("Run", 3.95, None, None, 1_700_086_400, 42);

        let trend = engine.get_pace_trend("Run");

        assert_eq!(trend.latest_pace, Some(3.95));
        assert_eq!(trend.previous_pace, None);
    }

    /// Scenario: the card judged critical speed in m/s against a polarity
    /// written for minutes per kilometre, so 3.80 to 3.95 m/s, about 4:23 to
    /// 4:13 per km, drew a decline.
    ///
    /// Expected behaviour: the engine judges the move as pace in the unit the
    /// sport is paced in, so faster is up, slower is down, and a move inside
    /// the table's deadband is flat.
    #[test]
    fn the_pace_trend_judges_faster_as_up_in_the_sports_own_pace() {
        fn glyph(sport: &str, earlier: f64, later: f64) -> Option<String> {
            let engine = PersistentEngine::in_memory().unwrap();
            engine.save_pace_snapshot(
                sport,
                earlier,
                None,
                None,
                1_700_000_000,
                SYNC_PACE_WINDOW_DAYS,
            );
            engine.save_pace_snapshot(
                sport,
                later,
                None,
                None,
                1_700_200_000,
                SYNC_PACE_WINDOW_DAYS,
            );
            engine.get_pace_trend(sport).glyph
        }

        assert_eq!(glyph("Run", 3.80, 3.95).as_deref(), Some("↑"));
        assert_eq!(glyph("Run", 3.95, 3.80).as_deref(), Some("↓"));
        // 4:23.2 to 4:21.1 per km, 0.034 min/km against a 0.05 deadband.
        assert_eq!(glyph("Run", 3.80, 3.83).as_deref(), Some("→"));

        // Swimming is judged per 100 m: 1:20 to 1:14.1 is up, 1:16.9 to 1:15.2
        // is 0.029 min inside the deadband.
        assert_eq!(glyph("Swim", 1.25, 1.35).as_deref(), Some("↑"));
        assert_eq!(glyph("Swim", 1.35, 1.25).as_deref(), Some("↓"));
        assert_eq!(glyph("Swim", 1.30, 1.33).as_deref(), Some("→"));
    }

    /// No earlier snapshot that differs is no move, which the card draws flat
    /// as it always has. No snapshot at all is nothing to draw.
    #[test]
    fn a_pace_trend_with_no_different_snapshot_is_flat_and_an_empty_one_has_no_glyph() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_000_000, SYNC_PACE_WINDOW_DAYS);
        assert_eq!(engine.get_pace_trend("Run").glyph.as_deref(), Some("→"));

        let empty = PersistentEngine::in_memory().unwrap().get_pace_trend("Run");
        assert_eq!(empty.glyph, None);
    }

    /// One snapshot is no move, and an empty history is no move either.
    #[test]
    fn a_pace_trend_with_nothing_to_compare_carries_no_move() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_000_000, SYNC_PACE_WINDOW_DAYS);

        let trend = engine.get_pace_trend("Run");
        assert_eq!(trend.gain_percent, None);
        assert_eq!(trend.delta_seconds, None);

        let empty = PersistentEngine::in_memory().unwrap().get_pace_trend("Run");
        assert_eq!(empty.gain_percent, None);
        assert_eq!(empty.delta_seconds, None);
    }

    /// The pace trend stands on its snapshots the same way.
    #[test]
    fn the_pace_trend_reports_the_snapshots_behind_it() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot("Run", 3.0, None, None, 1_700_000_000, SYNC_PACE_WINDOW_DAYS);
        engine.save_pace_snapshot("Run", 3.2, None, None, 1_700_100_000, SYNC_PACE_WINDOW_DAYS);
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_200_000, SYNC_PACE_WINDOW_DAYS);

        assert_eq!(engine.get_pace_trend("Run").sample_count, 3);
        assert_eq!(
            engine.get_pace_trend("Pogo").sample_count,
            0,
            "a sport with no history stands on nothing"
        );
    }

    // The pace trend was keyed on `Run` alone, so a snapshot saved for a trail
    // run was invisible to the running trend.
    #[test]
    fn pace_trend_reads_every_sport_in_the_family() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.save_pace_snapshot(
            "TrailRun",
            3.0,
            None,
            None,
            1_700_000_000,
            SYNC_PACE_WINDOW_DAYS,
        );
        engine.save_pace_snapshot("Run", 3.5, None, None, 1_700_100_000, SYNC_PACE_WINDOW_DAYS);
        engine.save_pace_snapshot(
            "Swim",
            1.2,
            None,
            None,
            1_700_200_000,
            SYNC_PACE_WINDOW_DAYS,
        );

        let trend = engine.get_pace_trend("Run");
        assert_eq!(trend.latest_pace, Some(3.5));
        assert_eq!(trend.previous_pace, Some(3.0));
        assert_eq!(engine.get_pace_trend("Swim").latest_pace, Some(1.2));
        assert!(engine.get_pace_trend("Pogo").latest_pace.is_none());
    }

    /// Scenario: the read behind the sport filter hits a broken table.
    ///
    /// Expected behaviour: the fallible reader says so, because "no sports"
    /// and "the read failed" are the same empty list to everything above it.
    #[test]
    fn a_failed_sport_type_read_is_reported() {
        let engine = PersistentEngine::in_memory().unwrap();
        assert_eq!(
            engine.try_available_sport_types().unwrap(),
            Vec::<String>::new()
        );

        engine
            .db
            .execute_batch("DROP TABLE activity_metrics")
            .unwrap();

        assert!(engine.try_available_sport_types().is_err());
        assert!(engine.get_available_sport_types().is_empty());
    }

    /// Scenario: the route highlight a detail screen and the widget snapshot
    /// both read is computed from the engine's in-memory groups, so neither
    /// can be answered from a pooled read-only connection.
    ///
    /// Expected behaviour: the same library gives the same highlights through
    /// the pool as through the lock. Two answers to one question is the
    /// failure this guards, and it is the price of moving a read off the lock.
    #[test]
    fn pooled_route_highlights_match_the_ones_a_lock_holder_gets() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics(vec![
                ride("a1", 1_700_000_000, 3_600),
                ride("a2", 1_700_086_400, 3_500),
                ride("a3", 1_700_172_800, 3_700),
            ])
            .unwrap();
        seed_group(&engine, "g1", &["a1", "a2", "a3"]);
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();

        let ids = vec!["a1".to_string(), "a2".to_string(), "unknown".to_string()];
        let through_the_lock = engine.get_activity_route_highlights(&ids);
        let through_the_pool = super::pooled::route_highlights(&engine.db, &ids);

        assert_eq!(through_the_lock.len(), 2, "the id in no group is left out");
        assert_same_highlights(&through_the_pool, &through_the_lock);
        assert!(
            through_the_lock.iter().any(|h| h.is_pr),
            "a2 is the quickest of the three, so one of them is a record"
        );
    }

    /// A group with two forward rides, two reverse rides and a quick partial
    /// overlap, which is a shortcut and not an attempt at the route.
    fn engine_with_a_partial_shortcut() -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics(vec![
                ride("fwd1", 1_700_000_000, 600),
                ride("fwd2", 1_700_086_400, 620),
                ride("rev1", 1_700_172_800, 650),
                ride("rev2", 1_700_259_200, 700),
                ride("cut", 1_700_345_600, 500),
                ride("cut2", 1_700_432_000, 510),
            ])
            .unwrap();
        seed_group(
            &engine,
            "g1",
            &["fwd1", "fwd2", "rev1", "rev2", "cut", "cut2"],
        );
        for (id, direction, pct) in [
            ("rev1", "reverse", 0.95),
            ("rev2", "reverse", 0.95),
            ("cut", "partial", 0.6),
            ("cut2", "partial", 0.6),
        ] {
            engine
                .db
                .execute(
                    "UPDATE activity_matches SET direction = ?1, match_percentage = ?2
                     WHERE route_id = 'g1' AND activity_id = ?3",
                    rusqlite::params![direction, pct, id],
                )
                .unwrap();
        }
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();
        engine
    }

    #[test]
    fn a_partial_match_takes_no_highlight_and_is_nobody_s_rival() {
        let engine = engine_with_a_partial_shortcut();
        let ids: Vec<String> = ["fwd1", "fwd2", "rev1", "rev2", "cut", "cut2"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let locked = engine.get_activity_route_highlights(&ids);
        let pooled = super::pooled::route_highlights(&engine.db, &ids);
        assert_same_highlights(&pooled, &locked);

        assert!(
            locked.iter().all(|h| h.activity_id != "cut"),
            "a partial match has no highlight"
        );
        let rev1 = locked.iter().find(|h| h.activity_id == "rev1").unwrap();
        assert!(
            rev1.is_pr,
            "the quickest real reverse attempt is the record"
        );
        assert_eq!(rev1.time_delta_seconds, Some(0));
    }

    #[test]
    fn a_partial_current_activity_has_no_rank_count_or_percentile() {
        let engine = engine_with_a_partial_shortcut();

        let result = engine.get_route_performances("g1", Some("cut"), None);

        assert_eq!(result.current_rank, None);
        assert_eq!(result.attempt_count, 0);
        assert_eq!(result.percentile_rank, None);
    }

    #[test]
    fn test_route_highlights_excluded_attempt_cannot_hold_record() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics(vec![
                ride("a1", 1_700_000_000, 340),
                ride("a2", 1_700_086_400, 300),
                ride("a3", 1_700_172_800, 320),
            ])
            .unwrap();
        seed_group(&engine, "g1", &["a1", "a2", "a3"]);
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();
        let ids = vec!["a2".to_string(), "a3".to_string()];

        engine.exclude_activity_from_route("g1", "a2").unwrap();
        let locked = engine.get_activity_route_highlights(&ids);
        let pooled = super::pooled::route_highlights(&engine.db, &ids);
        assert_same_highlights(&pooled, &locked);
        assert!(locked.iter().all(|h| h.activity_id != "a2"));
        assert!(locked.iter().find(|h| h.activity_id == "a3").unwrap().is_pr);
        assert_eq!(
            engine
                .get_route_performances("g1", Some("a3"), None)
                .best
                .unwrap()
                .activity_id,
            "a3"
        );

        engine.include_activity_in_route("g1", "a2").unwrap();
        let restored = engine.get_activity_route_highlights(&ids);
        let restored_pooled = super::pooled::route_highlights(&engine.db, &ids);
        assert_same_highlights(&restored_pooled, &restored);
        assert!(
            restored
                .iter()
                .find(|h| h.activity_id == "a2")
                .unwrap()
                .is_pr
        );
        assert!(
            !restored
                .iter()
                .find(|h| h.activity_id == "a3")
                .unwrap()
                .is_pr
        );
    }

    #[test]
    fn test_route_highlights_compares_efforts_within_one_sport() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut first_run = ride("run1", 1_700_086_400, 1500);
        first_run.sport_type = "Run".to_string();
        let mut second_run = ride("run2", 1_700_172_800, 1470);
        second_run.sport_type = "Run".to_string();
        engine
            .set_activity_metrics(vec![
                ride("ride", 1_700_000_000, 720),
                first_run,
                second_run,
            ])
            .unwrap();
        seed_group(&engine, "g1", &["ride", "run1", "run2"]);
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();
        let ids = vec!["run1".to_string(), "run2".to_string()];
        let locked = engine.get_activity_route_highlights(&ids);
        let pooled = super::pooled::route_highlights(&engine.db, &ids);
        assert_same_highlights(&pooled, &locked);
        assert!(
            !locked
                .iter()
                .find(|h| h.activity_id == "run1")
                .unwrap()
                .is_pr
        );
        assert!(
            locked
                .iter()
                .find(|h| h.activity_id == "run2")
                .unwrap()
                .is_pr
        );
        assert_eq!(
            locked
                .iter()
                .find(|h| h.activity_id == "run2")
                .unwrap()
                .pr_improvement_seconds,
            Some(30)
        );
        assert_eq!(
            locked
                .iter()
                .find(|h| h.activity_id == "run1")
                .unwrap()
                .time_delta_seconds,
            Some(30)
        );
    }

    /// Scenario: a loop is ridden forward, then run once forward and ridden
    /// once in reverse. The run and the reverse ride are each the first in
    /// their sport and direction.
    ///
    /// Expected behaviour: none of the three reads as a record or carries a
    /// gap against another sport's time, on either path.
    #[test]
    fn test_route_highlights_a_lone_first_outing_is_no_record_and_no_delta() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut run = ride("run", 1_700_086_400, 1500);
        run.sport_type = "Run".to_string();
        engine
            .set_activity_metrics(vec![
                ride("ride", 1_700_000_000, 720),
                run,
                ride("ride_rev", 1_700_172_800, 700),
            ])
            .unwrap();
        seed_group(&engine, "g1", &["ride", "run", "ride_rev"]);
        engine
            .db
            .execute(
                "UPDATE activity_matches SET direction = 'reverse' WHERE activity_id = 'ride_rev'",
                [],
            )
            .unwrap();
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();
        let ids = vec![
            "ride".to_string(),
            "run".to_string(),
            "ride_rev".to_string(),
        ];
        let locked = engine.get_activity_route_highlights(&ids);
        let pooled = super::pooled::route_highlights(&engine.db, &ids);
        assert_same_highlights(&pooled, &locked);
        for id in &ids {
            let h = locked.iter().find(|h| &h.activity_id == id).unwrap();
            assert!(!h.is_pr, "{id} is alone in its sport and direction");
            assert_eq!(h.time_delta_seconds, Some(0), "{id}");
            assert_eq!(h.pr_improvement_seconds, None, "{id}");
        }
    }

    /// An activity in no group has no route to be measured against, on either
    /// path.
    #[test]
    fn pooled_route_highlights_are_empty_without_a_group() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics(vec![ride("a1", 1_700_000_000, 3_600)])
            .unwrap();

        let ids = vec!["a1".to_string()];
        assert!(engine.get_activity_route_highlights(&ids).is_empty());
        assert!(super::pooled::route_highlights(&engine.db, &ids).is_empty());
    }

    /// The custom name an athlete gave a route is on the highlight, and it is
    /// read from the same table either way.
    #[test]
    fn pooled_route_highlights_carry_the_custom_route_name() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics(vec![ride("a1", 1_700_000_000, 3_600)])
            .unwrap();
        seed_group(&engine, "g1", &["a1"]);
        engine
            .db
            .execute(
                "INSERT INTO route_names (route_id, custom_name) VALUES ('g1', 'The river loop')",
                [],
            )
            .unwrap();
        engine.load_groups().unwrap();
        engine.load_activity_matches().unwrap();

        let ids = vec!["a1".to_string()];
        let through_the_pool = super::pooled::route_highlights(&engine.db, &ids);
        assert_eq!(through_the_pool[0].route_name, "The river loop");
        assert_same_highlights(
            &through_the_pool,
            &engine.get_activity_route_highlights(&ids),
        );
    }

    /// A ride of `moving_time` seconds over a fixed distance, so the speed
    /// ordering is the time ordering reversed.
    fn ride(id: &str, date: i64, moving_time: u32) -> ActivityMetrics {
        ActivityMetrics {
            activity_id: id.to_string(),
            name: id.to_string(),
            date,
            distance: 40_000.0,
            moving_time,
            elapsed_time: moving_time + 100,
            elevation_gain: 400.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    /// One group holding `members`, each matched forward, as detection writes
    /// it.
    fn seed_group(engine: &PersistentEngine, group_id: &str, members: &[&str]) {
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

    /// Order is not part of either answer, so compare by activity.
    fn assert_same_highlights(
        pooled: &[crate::FfiActivityRouteHighlight],
        through_the_lock: &[crate::FfiActivityRouteHighlight],
    ) {
        assert_eq!(pooled.len(), through_the_lock.len());
        for expected in through_the_lock {
            let actual = pooled
                .iter()
                .find(|h| h.activity_id == expected.activity_id)
                .unwrap_or_else(|| {
                    panic!("{} is missing from the pooled read", expected.activity_id)
                });
            assert_eq!(actual.route_id, expected.route_id);
            assert_eq!(actual.route_name, expected.route_name);
            assert_eq!(actual.is_pr, expected.is_pr);
            assert_eq!(actual.trend, expected.trend);
            assert_eq!(actual.time_delta_seconds, expected.time_delta_seconds);
            assert_eq!(
                actual.pr_improvement_seconds,
                expected.pr_improvement_seconds
            );
        }
    }

    /// Local wall-clock instant as `activity_metrics.date` holds it.
    fn local(date: &str, time: &str) -> i64 {
        chrono::NaiveDateTime::parse_from_str(&format!("{date} {time}"), "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
            .timestamp()
    }

    fn loaded(id: &str, at: i64, load: Option<f64>) -> ActivityMetrics {
        let mut m = metric(id, "Ride", None);
        m.date = at;
        m.training_load = load;
        m
    }

    /// Scenario: activities on one local day carry loads that are known,
    /// missing or an explicit zero, and two sit either side of midnight.
    ///
    /// Expected behaviour: each local date reports its own recorded total and
    /// whether every activity on it carried a load.
    #[test]
    fn daily_activity_load_reports_total_and_completeness_per_local_date() {
        use crate::FfiDayLoadStatus::{Complete, Partial, Unavailable};
        let engine = engine_with(vec![
            loaded("a1", local("2026-03-10", "08:00:00"), Some(40.0)),
            loaded("a2", local("2026-03-10", "17:00:00"), Some(60.0)),
            loaded("b1", local("2026-03-11", "00:00:00"), Some(40.0)),
            loaded("b2", local("2026-03-11", "23:59:59"), None),
            loaded("c1", local("2026-03-12", "00:00:01"), None),
            loaded("d1", local("2026-03-13", "12:00:00"), Some(0.0)),
        ]);

        let days = super::pooled::daily_activity_loads(
            &engine.db,
            local("2026-03-10", "00:00:00"),
            local("2026-03-13", "23:59:59"),
        );

        let got: Vec<_> = days
            .iter()
            .map(|d| (d.date.as_str(), d.status, d.total, d.activity_count))
            .collect();
        assert_eq!(
            got,
            vec![
                ("2026-03-10", Complete, Some(100.0), 2),
                ("2026-03-11", Partial, Some(40.0), 2),
                ("2026-03-12", Unavailable, None, 1),
                ("2026-03-13", Complete, Some(0.0), 1),
            ]
        );
    }

    #[test]
    fn a_day_with_no_activities_is_rest() {
        use crate::FfiDayLoadStatus::Rest;
        let day = super::day_load("2026-03-14", &[]);
        assert_eq!((day.status, day.total, day.activity_count), (Rest, None, 0));
    }

    #[test]
    fn daily_activity_load_leaves_out_days_outside_the_window() {
        let engine = engine_with(vec![
            loaded("a", local("2026-03-09", "23:59:59"), Some(10.0)),
            loaded("b", local("2026-03-15", "00:00:00"), Some(10.0)),
        ]);
        let days = super::pooled::daily_activity_loads(
            &engine.db,
            local("2026-03-10", "00:00:00"),
            local("2026-03-14", "23:59:59"),
        );
        assert!(days.is_empty());
    }
}
