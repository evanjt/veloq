//! Route and section performance queries.
//!
//! Includes time-stream management, backfill, and performance-record computation
//! for both route groups and detected sections (including their excluded variants).

use crate::{
    ActivityMetrics, Direction, DirectionStats, RoutePerformance, RoutePerformanceResult,
    SectionLap, SectionPerformanceRecord, SectionPerformanceResult,
};
use rusqlite::params;
use std::collections::HashMap;

use super::super::PersistentRouteEngine;

impl PersistentRouteEngine {
    /// Set time streams for activities from flat buffer.
    /// Time streams are cumulative seconds at each GPS point, used for section performance calculations.
    /// Persists to SQLite for offline access.
    pub fn set_time_streams_flat(
        &mut self,
        activity_ids: &[String],
        all_times: &[u32],
        offsets: &[u32],
    ) {
        let mut persisted_count = 0;
        for (i, activity_id) in activity_ids.iter().enumerate() {
            let start = offsets[i] as usize;
            let end = offsets
                .get(i + 1)
                .map(|&o| o as usize)
                .unwrap_or(all_times.len());
            let times = all_times[start..end].to_vec();

            // Persist to SQLite for offline access
            if self.store_time_stream(activity_id, &times).is_ok() {
                persisted_count += 1;
            }

            // Also keep in memory for fast access
            self.time_streams.insert(activity_id.clone(), times);
        }
        log::debug!(
            "tracematch: [PersistentEngine] Set time streams for {} activities ({} persisted to SQLite)",
            activity_ids.len(),
            persisted_count
        );
        self.invalidate_perf_cache();
    }

    /// Get activity IDs that have section_activities with NULL lap_time but no time_stream.
    /// Used to trigger time stream fetching for existing activities after upgrade.
    pub fn get_activities_needing_time_streams(&self) -> Vec<String> {
        match self.db.prepare(
            "SELECT DISTINCT sa.activity_id
             FROM section_activities sa
             LEFT JOIN time_streams ts ON sa.activity_id = ts.activity_id
             WHERE sa.lap_time IS NULL AND sa.excluded = 0 AND ts.activity_id IS NULL"
        ) {
            Ok(mut stmt) => stmt
                .query_map([], |row| row.get(0))
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => vec![],
        }
    }

    /// Backfill NULL lap_time/lap_pace in section_activities from available time streams.
    /// Called after sync when new time streams may have been loaded.
    /// This fixes orphaned rows from migration or activities that were synced after section detection.
    pub fn backfill_section_performance_cache(&mut self) {
        let null_portions: Vec<(String, String, u32, u32, f64)> = match self.db.prepare(
            "SELECT section_id, activity_id, start_index, end_index, distance_meters
             FROM section_activities
             WHERE lap_time IS NULL AND excluded = 0",
        ) {
            Ok(mut stmt) => stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                })
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => return,
        };

        if null_portions.is_empty() {
            return;
        }

        log::info!(
            "tracematch: [Backfill] Found {} section_activities with NULL lap_time, attempting backfill",
            null_portions.len()
        );

        // Load time streams from DB for activities that need backfill
        let activity_ids: std::collections::HashSet<String> = null_portions
            .iter()
            .map(|(_, aid, _, _, _)| aid.clone())
            .collect();

        let mut db_time_streams: HashMap<String, Vec<u32>> = HashMap::new();
        for activity_id in &activity_ids {
            if let Some(ts) = self.time_streams.get(activity_id) {
                db_time_streams.insert(activity_id.clone(), ts.clone());
            } else if let Ok(stream) = self.db.query_row(
                "SELECT times FROM time_streams WHERE activity_id = ?",
                params![activity_id],
                |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    rmp_serde::from_slice::<Vec<u32>>(&bytes)
                        .map_err(|_| rusqlite::Error::InvalidQuery)
                },
            ) {
                db_time_streams.insert(activity_id.clone(), stream);
            }
        }

        let mut populated = 0u32;
        for (section_id, activity_id, start_idx, end_idx, distance) in &null_portions {
            let times = db_time_streams.get(activity_id).map(|v| v.as_slice());
            let (lap_time, lap_pace) = super::super::sections::compute_lap_time_from_stream(
                times, *start_idx, *end_idx, *distance,
            );
            if let (Some(lap_time), Some(lap_pace)) = (lap_time, lap_pace) {
                let _ = self.db.execute(
                    "UPDATE section_activities SET lap_time = ?, lap_pace = ?
                     WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                    params![lap_time, lap_pace, section_id, activity_id, start_idx],
                );
                populated += 1;
            }
        }

        if populated > 0 {
            log::info!(
                "tracematch: [Backfill] Populated {}/{} NULL lap_time entries",
                populated,
                null_portions.len()
            );
        }
    }

    /// Get section performances with accurate time calculations.
    /// Uses time streams to calculate actual traversal times.
    /// Auto-loads time streams from SQLite if not in memory.
    pub fn get_section_performances(&mut self, section_id: &str) -> SectionPerformanceResult {
        self.get_section_performances_filtered(section_id, None)
    }

    /// Get section performances filtered by sport type.
    /// When `sport_type_filter` is None, returns all activities.
    /// When set, only returns activities matching that sport type.
    pub fn get_section_performances_filtered(
        &mut self,
        section_id: &str,
        sport_type_filter: Option<&str>,
    ) -> SectionPerformanceResult {
        let start = std::time::Instant::now();

        // Return cached result if same section + filter
        let cache_key = match sport_type_filter {
            Some(st) => format!("{}:{}", section_id, st),
            None => section_id.to_string(),
        };
        if self.perf_cache_section_id.as_deref() == Some(&cache_key) {
            if let Some(ref cached) = self.perf_cache_result {
                log::info!(
                    "[PERF] get_section_performances({}) -> cached in {:?}",
                    cache_key,
                    start.elapsed()
                );
                return cached.clone();
            }
        }

        // Find the section (in-memory for auto, fallback to DB for custom)
        let section = match self.sections.iter().find(|s| s.id == section_id) {
            Some(s) => s.clone(),
            None => match self.get_section_by_id(section_id) {
                Some(s) => s,
                None => {
                    log::warn!("[DEBUG] Section not found: {}", section_id);
                    return SectionPerformanceResult {
                        records: vec![],
                        best_record: None,
                        best_forward_record: None,
                        best_reverse_record: None,
                        forward_stats: None,
                        reverse_stats: None,
                    };
                }
            },
        };

        log::info!(
            "[DEBUG] Section found. activity_portions count: {}",
            section.activity_portions.len()
        );

        // Load portions WITH cached performance metrics from database
        // Optional sport type filter for cross-sport merged sections
        let (query, query_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
            match sport_type_filter {
                Some(st) => (
                    "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                        sa.distance_meters, sa.lap_time, sa.lap_pace
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.section_id = ? AND am.sport_type = ? AND sa.excluded = 0
                 ORDER BY sa.activity_id, sa.start_index"
                        .to_string(),
                    vec![
                        Box::new(section_id.to_string()) as Box<dyn rusqlite::types::ToSql>,
                        Box::new(st.to_string()),
                    ],
                ),
                None => (
                    "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                        sa.distance_meters, sa.lap_time, sa.lap_pace
                 FROM section_activities sa
                 WHERE sa.section_id = ? AND sa.excluded = 0
                 ORDER BY sa.activity_id, sa.start_index"
                        .to_string(),
                    vec![Box::new(section_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
                ),
            };
        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[DEBUG] Failed to prepare portion query: {}", e);
                return SectionPerformanceResult {
                    records: vec![],
                    best_record: None,
                    best_forward_record: None,
                    best_reverse_record: None,
                    forward_stats: None,
                    reverse_stats: None,
                };
            }
        };

        struct CachedPortion {
            activity_id: String,
            direction: String,
            start_index: u32,
            end_index: u32,
            distance_meters: f64,
            lap_time: Option<f64>,
            lap_pace: Option<f64>,
        }

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            query_params.iter().map(|p| p.as_ref()).collect();
        let portions: Vec<CachedPortion> = match stmt.query_map(params_refs.as_slice(), |row| {
            Ok(CachedPortion {
                activity_id: row.get(0)?,
                direction: row.get(1)?,
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
                lap_time: row.get(5)?,
                lap_pace: row.get(6)?,
            })
        }) {
            Ok(iter) => match iter.collect::<Result<Vec<_>, _>>() {
                Ok(v) => v,
                Err(e) => {
                    log::error!("[DEBUG] Failed to deserialize portion row: {}", e);
                    return SectionPerformanceResult {
                        records: vec![],
                        best_record: None,
                        best_forward_record: None,
                        best_reverse_record: None,
                        forward_stats: None,
                        reverse_stats: None,
                    };
                }
            },
            Err(e) => {
                log::error!("[DEBUG] Failed to query portions: {}", e);
                return SectionPerformanceResult {
                    records: vec![],
                    best_record: None,
                    best_forward_record: None,
                    best_reverse_record: None,
                    forward_stats: None,
                    reverse_stats: None,
                };
            }
        };

        // Drop the statement to release the borrow on self.db
        drop(stmt);

        // Group portions by activity
        let mut portions_by_activity: HashMap<String, Vec<CachedPortion>> = HashMap::new();
        for portion in portions {
            portions_by_activity
                .entry(portion.activity_id.clone())
                .or_default()
                .push(portion);
        }

        // Pre-load time streams for any activities with cache misses
        // This avoids borrow checker issues when processing records
        let activity_ids_needing_streams: Vec<String> = portions_by_activity
            .iter()
            .filter(|(_, portions)| {
                portions
                    .iter()
                    .any(|p| p.lap_time.is_none() || p.lap_pace.is_none())
            })
            .map(|(id, _)| id.clone())
            .collect();

        for activity_id in activity_ids_needing_streams {
            if !self.time_streams.contains_key(&activity_id) {
                self.ensure_time_stream_loaded(&activity_id);
            }
        }

        // Pre-load activity metadata from DB for activities not in memory
        // This handles activities outside the current sync range that still have section_activities rows
        let mut db_metrics: HashMap<String, (String, i64)> = HashMap::new();
        for activity_id in portions_by_activity.keys() {
            if !self.activity_metrics.contains_key(activity_id) {
                if let Ok((name, date)) = self.db.query_row(
                    "SELECT name, date FROM activity_metrics WHERE activity_id = ?",
                    params![activity_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                ) {
                    db_metrics.insert(activity_id.clone(), (name, date));
                }
            }
        }

        // Build performance records
        let mut records: Vec<SectionPerformanceRecord> = portions_by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                // Get activity name and date from in-memory cache or DB fallback
                let (activity_name, activity_date) = if let Some(m) = self.activity_metrics.get(activity_id) {
                    (m.name.clone(), m.date)
                } else if let Some((name, date)) = db_metrics.get(activity_id) {
                    (name.clone(), *date)
                } else {
                    return None;
                };

                let laps: Vec<SectionLap> = portions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, portion)| {
                        // Use cached values if available, otherwise fall back to calculation
                        let (lap_time, lap_pace) = match (portion.lap_time, portion.lap_pace) {
                            (Some(t), Some(p)) => (t, p),
                            _ => {
                                // Fall back to calculation if cache miss
                                // This handles migration edge case or corrupt data
                                // Time stream should already be loaded by pre-loading step above
                                if let Some(times) = self.time_streams.get(activity_id) {
                                    let start_idx = portion.start_index as usize;
                                    let end_idx = portion.end_index as usize;

                                    if start_idx < times.len() && end_idx < times.len() {
                                        let lap_time = (times[end_idx] as f64 - times[start_idx] as f64).abs();
                                        if lap_time > 0.0 {
                                            let lap_pace = portion.distance_meters / lap_time;
                                            (lap_time, lap_pace)
                                        } else {
                                            return None;
                                        }
                                    } else {
                                        return None;
                                    }
                                } else {
                                    log::warn!(
                                        "[DEBUG] No time stream available for {}, lap {} - skipping",
                                        activity_id, i
                                    );
                                    return None;
                                }
                            }
                        };

                        if lap_time <= 0.0 {
                            return None;
                        }

                        Some(SectionLap {
                            id: format!("{}_lap{}", activity_id, i),
                            activity_id: activity_id.to_string(),
                            time: lap_time,
                            pace: lap_pace,
                            distance: portion.distance_meters,
                            direction: portion.direction.clone(),
                            start_index: portion.start_index,
                            end_index: portion.end_index,
                        })
                    })
                    .collect();

                if laps.is_empty() {
                    return None;
                }

                let lap_count = laps.len() as u32;
                // Find the lap with minimum time (best performance)
                // Use both time and pace from the SAME lap for consistency
                let best_lap = laps
                    .iter()
                    .min_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
                let (best_time, best_pace) = best_lap
                    .map(|lap| (lap.time, lap.pace))
                    .unwrap_or((0.0, 0.0));
                let avg_time = laps.iter().map(|l| l.time).sum::<f64>() / lap_count as f64;
                let avg_pace = laps.iter().map(|l| l.pace).sum::<f64>() / lap_count as f64;
                let direction = laps
                    .first()
                    .map(|l| l.direction.clone())
                    .unwrap_or_else(|| "same".to_string());
                let section_distance = section.distance_meters;

                Some(SectionPerformanceRecord {
                    activity_id: activity_id.to_string(),
                    activity_name: activity_name.clone(),
                    activity_date,
                    laps,
                    lap_count,
                    best_time,
                    best_pace,
                    avg_time,
                    avg_pace,
                    direction,
                    section_distance,
                })
            })
            .collect();

        log::info!("[DEBUG] Built {} performance records", records.len());

        // Sort by date
        records.sort_by_key(|r| r.activity_date);

        // Find best record (fastest time) - overall
        let best_record = records
            .iter()
            .min_by(|a, b| {
                a.best_time
                    .partial_cmp(&b.best_time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Scan all laps across all records to find per-direction bests.
        // This fixes the bug where record-level direction (first lap) and
        // cross-direction best_time gave wrong per-direction PRs.
        let mut best_fwd_time = f64::MAX;
        let mut best_fwd_record_idx: Option<usize> = None;
        let mut best_fwd_pace = 0.0f64;
        let mut best_rev_time = f64::MAX;
        let mut best_rev_record_idx: Option<usize> = None;
        let mut best_rev_pace = 0.0f64;

        let mut fwd_times: Vec<f64> = Vec::new();
        let mut fwd_last_date: Option<i64> = None;
        let mut rev_times: Vec<f64> = Vec::new();
        let mut rev_last_date: Option<i64> = None;

        for (i, record) in records.iter().enumerate() {
            for lap in &record.laps {
                let is_rev = lap.direction == "reverse" || lap.direction == "backward";
                if is_rev {
                    rev_times.push(lap.time);
                    rev_last_date = Some(
                        rev_last_date
                            .map_or(record.activity_date, |d: i64| d.max(record.activity_date)),
                    );
                    if lap.time < best_rev_time {
                        best_rev_time = lap.time;
                        best_rev_pace = lap.pace;
                        best_rev_record_idx = Some(i);
                    }
                } else {
                    fwd_times.push(lap.time);
                    fwd_last_date = Some(
                        fwd_last_date
                            .map_or(record.activity_date, |d: i64| d.max(record.activity_date)),
                    );
                    if lap.time < best_fwd_time {
                        best_fwd_time = lap.time;
                        best_fwd_pace = lap.pace;
                        best_fwd_record_idx = Some(i);
                    }
                }
            }
        }

        // Construct per-direction best records with direction-correct times
        let best_forward_record = best_fwd_record_idx.map(|idx| {
            let mut r = records[idx].clone();
            r.best_time = best_fwd_time;
            r.best_pace = best_fwd_pace;
            r.direction = "same".to_string();
            r
        });

        let best_reverse_record = best_rev_record_idx.map(|idx| {
            let mut r = records[idx].clone();
            r.best_time = best_rev_time;
            r.best_pace = best_rev_pace;
            r.direction = "reverse".to_string();
            r
        });

        // Compute forward direction stats from lap-level data
        let forward_stats = if fwd_times.is_empty() {
            None
        } else {
            let count = fwd_times.len() as u32;
            let avg_time = fwd_times.iter().sum::<f64>() / count as f64;
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity: fwd_last_date,
                count,
                avg_speed: None,
            })
        };

        // Compute reverse direction stats from lap-level data
        let reverse_stats = if rev_times.is_empty() {
            None
        } else {
            let count = rev_times.len() as u32;
            let avg_time = rev_times.iter().sum::<f64>() / count as f64;
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity: rev_last_date,
                count,
                avg_speed: None,
            })
        };

        let result = SectionPerformanceResult {
            records,
            best_record,
            best_forward_record,
            best_reverse_record,
            forward_stats,
            reverse_stats,
        };

        log::info!(
            "[PERF] get_section_performances({}) -> {} records in {:?}",
            section_id,
            result.records.len(),
            start.elapsed()
        );

        // Cache for reuse by buckets/calendar (includes sport type filter in key)
        self.perf_cache_section_id = Some(cache_key);
        self.perf_cache_result = Some(result.clone());

        result
    }

    /// Get performance records for excluded activities in a section.
    /// Only uses cached lap_time/lap_pace (no time stream fallback).
    /// Returns just the records — no best/stats computation.
    pub fn get_excluded_section_performances(
        &mut self,
        section_id: &str,
    ) -> Vec<SectionPerformanceRecord> {
        // Find section sport type
        let sport_type: String = match self.sections.iter().find(|s| s.id == section_id) {
            Some(s) => s.sport_type.clone(),
            None => match self.db.query_row(
                "SELECT sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            ) {
                Ok(st) => st,
                Err(_) => return Vec::new(),
            },
        };

        let section_distance: f64 = self
            .sections
            .iter()
            .find(|s| s.id == section_id)
            .map(|s| s.distance_meters)
            .unwrap_or_else(|| {
                self.db
                    .query_row(
                        "SELECT distance_meters FROM sections WHERE id = ?",
                        params![section_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(0.0)
            });

        let mut stmt = match self.db.prepare(
            "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                    sa.distance_meters, sa.lap_time, sa.lap_pace
             FROM section_activities sa
             JOIN activity_metrics am ON sa.activity_id = am.activity_id
             WHERE sa.section_id = ? AND am.sport_type = ? AND sa.excluded = 1
             ORDER BY sa.activity_id, sa.start_index",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        struct Portion {
            activity_id: String,
            direction: String,
            start_index: u32,
            end_index: u32,
            distance_meters: f64,
            lap_time: Option<f64>,
            lap_pace: Option<f64>,
        }

        let portions: Vec<Portion> = match stmt.query_map(params![section_id, &sport_type], |row| {
            Ok(Portion {
                activity_id: row.get(0)?,
                direction: row.get(1)?,
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
                lap_time: row.get(5)?,
                lap_pace: row.get(6)?,
            })
        }) {
            Ok(iter) => match iter.collect::<Result<Vec<_>, _>>() {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[fitness] Failed to deserialize excluded portion row: {}",
                        e
                    );
                    return Vec::new();
                }
            },
            Err(_) => return Vec::new(),
        };
        drop(stmt);

        // Group by activity
        let mut by_activity: HashMap<String, Vec<Portion>> = HashMap::new();
        for p in portions {
            by_activity
                .entry(p.activity_id.clone())
                .or_default()
                .push(p);
        }

        // Pre-load time streams for activities with cache misses
        let activity_ids_needing_streams: Vec<String> = by_activity
            .iter()
            .filter(|(_, portions)| {
                portions
                    .iter()
                    .any(|p| p.lap_time.is_none() || p.lap_pace.is_none())
            })
            .map(|(id, _)| id.clone())
            .collect();

        for activity_id in activity_ids_needing_streams {
            if !self.time_streams.contains_key(&activity_id) {
                self.ensure_time_stream_loaded(&activity_id);
            }
        }

        let mut records: Vec<SectionPerformanceRecord> = by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                let metrics = self.activity_metrics.get(activity_id)?;
                let laps: Vec<SectionLap> = portions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| {
                        let (time, pace) = match (p.lap_time, p.lap_pace) {
                            (Some(t), Some(p)) if t > 0.0 => (t, p),
                            _ => {
                                // Fall back to time-stream calculation if cache miss
                                if let Some(times) = self.time_streams.get(activity_id) {
                                    let start_idx = p.start_index as usize;
                                    let end_idx = p.end_index as usize;
                                    if start_idx < times.len() && end_idx < times.len() {
                                        let lap_time =
                                            (times[end_idx] as f64 - times[start_idx] as f64).abs();
                                        if lap_time > 0.0 {
                                            (lap_time, p.distance_meters / lap_time)
                                        } else {
                                            return None;
                                        }
                                    } else {
                                        return None;
                                    }
                                } else {
                                    return None;
                                }
                            }
                        };
                        Some(SectionLap {
                            id: format!("{}_lap{}", activity_id, i),
                            activity_id: activity_id.to_string(),
                            time,
                            pace,
                            distance: p.distance_meters,
                            direction: p.direction.clone(),
                            start_index: p.start_index,
                            end_index: p.end_index,
                        })
                    })
                    .collect();

                if laps.is_empty() {
                    return None;
                }

                let lap_count = laps.len() as u32;
                let best_lap = laps.iter().min_by(|a, b| {
                    a.time
                        .partial_cmp(&b.time)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                let (best_time, best_pace) =
                    best_lap.map(|l| (l.time, l.pace)).unwrap_or((0.0, 0.0));
                let avg_time = laps.iter().map(|l| l.time).sum::<f64>() / lap_count as f64;
                let avg_pace = laps.iter().map(|l| l.pace).sum::<f64>() / lap_count as f64;
                let direction = laps
                    .first()
                    .map(|l| l.direction.clone())
                    .unwrap_or_else(|| "same".to_string());

                Some(SectionPerformanceRecord {
                    activity_id: activity_id.to_string(),
                    activity_name: metrics.name.clone(),
                    activity_date: metrics.date,
                    laps,
                    lap_count,
                    best_time,
                    best_pace,
                    avg_time,
                    avg_pace,
                    direction,
                    section_distance,
                })
            })
            .collect();

        records.sort_by_key(|r| r.activity_date);
        records
    }

    /// Get route performances for all activities in a group.
    /// Uses stored activity_matches for match percentages instead of hardcoding 100%.
    pub fn get_route_performances(
        &self,
        route_group_id: &str,
        current_activity_id: Option<&str>,
        sport_type_filter: Option<&str>,
    ) -> RoutePerformanceResult {
        // Find the group
        let group = match self.groups.iter().find(|g| g.group_id == route_group_id) {
            Some(g) => g,
            None => {
                log::debug!(
                    "tracematch: get_route_performances: group {} not found",
                    route_group_id
                );
                return RoutePerformanceResult {
                    performances: vec![],
                    activity_metrics: vec![],
                    best: None,
                    best_forward: None,
                    best_reverse: None,
                    forward_stats: None,
                    reverse_stats: None,
                    current_rank: None,
                };
            }
        };

        // Get match info for this route
        let match_info = self.activity_matches.get(route_group_id);
        log::debug!(
            "tracematch: get_route_performances: group {} has {} activities, match_info: {}",
            route_group_id,
            group.activity_ids.len(),
            match_info.map(|m| m.len()).unwrap_or(0)
        );

        // Get excluded activity IDs for this route
        let excluded_ids = self.get_excluded_route_activity_ids(route_group_id);

        // Build performances from metrics + collect metrics for inline return
        let mut performances: Vec<RoutePerformance> = Vec::new();
        let mut metrics_list: Vec<ActivityMetrics> = Vec::new();

        for id in &group.activity_ids {
            // Skip excluded activities
            if excluded_ids.contains(id) {
                continue;
            }
            if let Some(metrics) = self.activity_metrics.get(id) {
                // Filter by sport type if specified
                if let Some(filter) = sport_type_filter {
                    if metrics.sport_type != filter {
                        continue;
                    }
                }

                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                // Look up match info for this activity (optional - may not exist for old data)
                let match_data =
                    match_info.and_then(|matches| matches.iter().find(|m| m.activity_id == *id));
                let match_percentage = match_data.map(|m| m.match_percentage);
                let direction = match_data
                    .map(|m| m.direction.clone())
                    .unwrap_or(Direction::Same);

                performances.push(RoutePerformance {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    date: metrics.date,
                    speed,
                    duration: metrics.elapsed_time,
                    moving_time: metrics.moving_time,
                    distance: metrics.distance,
                    elevation_gain: metrics.elevation_gain,
                    avg_hr: metrics.avg_hr,
                    avg_power: metrics.avg_power,
                    is_current: current_activity_id == Some(id.as_str()),
                    direction: direction.to_string(),
                    match_percentage,
                });

                // Collect metrics for inline return (Issue C optimization)
                metrics_list.push(metrics.clone());
            }
        }

        // Sort by date (oldest first for charting)
        performances.sort_by_key(|p| p.date);

        // Find best (fastest speed) - overall
        let best = performances
            .iter()
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best forward (direction is "same" or "forward")
        let best_forward = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best reverse
        let best_reverse = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Calculate current rank (1 = fastest)
        let current_rank = current_activity_id.and_then(|current_id| {
            let mut by_speed = performances.clone();
            by_speed.sort_by(|a, b| {
                b.speed
                    .partial_cmp(&a.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            by_speed
                .iter()
                .position(|p| p.activity_id == current_id)
                .map(|idx| (idx + 1) as u32)
        });

        // Compute forward direction stats
        let forward_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .collect();
        let forward_stats = if forward_perfs.is_empty() {
            None
        } else {
            let count = forward_perfs.len() as u32;
            let avg_time =
                forward_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let valid_speeds: Vec<f64> = forward_perfs
                .iter()
                .map(|p| p.speed)
                .filter(|s| s.is_finite() && *s > 0.0)
                .collect();
            let avg_speed = if valid_speeds.is_empty() {
                None
            } else {
                Some(valid_speeds.iter().sum::<f64>() / valid_speeds.len() as f64)
            };
            let last_activity = forward_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
                avg_speed,
            })
        };

        // Compute reverse direction stats
        let reverse_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .collect();
        let reverse_stats = if reverse_perfs.is_empty() {
            None
        } else {
            let count = reverse_perfs.len() as u32;
            let avg_time =
                reverse_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let valid_speeds: Vec<f64> = reverse_perfs
                .iter()
                .map(|p| p.speed)
                .filter(|s| s.is_finite() && *s > 0.0)
                .collect();
            let avg_speed = if valid_speeds.is_empty() {
                None
            } else {
                Some(valid_speeds.iter().sum::<f64>() / valid_speeds.len() as f64)
            };
            let last_activity = reverse_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
                avg_speed,
            })
        };

        RoutePerformanceResult {
            performances,
            activity_metrics: metrics_list,
            best,
            best_forward,
            best_reverse,
            forward_stats,
            reverse_stats,
            current_rank,
        }
    }

    /// Get route performances for excluded activities only.
    /// Returns a RoutePerformanceResult with only the excluded activities.
    pub fn get_excluded_route_performances(
        &self,
        route_group_id: &str,
        sport_type_filter: Option<&str>,
    ) -> RoutePerformanceResult {
        let group = match self.groups.iter().find(|g| g.group_id == route_group_id) {
            Some(g) => g,
            None => {
                return RoutePerformanceResult {
                    performances: vec![],
                    activity_metrics: vec![],
                    best: None,
                    best_forward: None,
                    best_reverse: None,
                    forward_stats: None,
                    reverse_stats: None,
                    current_rank: None,
                };
            }
        };

        let excluded_ids = self.get_excluded_route_activity_ids(route_group_id);
        if excluded_ids.is_empty() {
            return RoutePerformanceResult {
                performances: vec![],
                activity_metrics: vec![],
                best: None,
                best_forward: None,
                best_reverse: None,
                forward_stats: None,
                reverse_stats: None,
                current_rank: None,
            };
        }

        let match_info = self.activity_matches.get(route_group_id);
        let mut performances: Vec<RoutePerformance> = Vec::new();
        let mut metrics_list: Vec<ActivityMetrics> = Vec::new();

        for id in &group.activity_ids {
            if !excluded_ids.contains(id) {
                continue;
            }
            if let Some(metrics) = self.activity_metrics.get(id) {
                // Filter by sport type if specified
                if let Some(filter) = sport_type_filter {
                    if metrics.sport_type != filter {
                        continue;
                    }
                }

                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                let match_data =
                    match_info.and_then(|matches| matches.iter().find(|m| m.activity_id == *id));
                let match_percentage = match_data.map(|m| m.match_percentage);
                let direction = match_data
                    .map(|m| m.direction.clone())
                    .unwrap_or(Direction::Same);

                performances.push(RoutePerformance {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    date: metrics.date,
                    speed,
                    duration: metrics.elapsed_time,
                    moving_time: metrics.moving_time,
                    distance: metrics.distance,
                    elevation_gain: metrics.elevation_gain,
                    avg_hr: metrics.avg_hr,
                    avg_power: metrics.avg_power,
                    is_current: false,
                    direction: direction.to_string(),
                    match_percentage,
                });
                metrics_list.push(metrics.clone());
            }
        }

        performances.sort_by_key(|p| p.date);

        RoutePerformanceResult {
            performances,
            activity_metrics: metrics_list,
            best: None,
            best_forward: None,
            best_reverse: None,
            forward_stats: None,
            reverse_stats: None,
            current_rank: None,
        }
    }
}
