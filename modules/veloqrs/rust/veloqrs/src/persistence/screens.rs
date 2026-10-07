//! Per-screen data bundles.
//!
//! One method per rendered surface, each composing the reads that screen used
//! to make one at a time. Living on `PersistentEngine` keeps the FFI
//! objects thin and lets tests compare a bundle against the individual calls
//! it replaces without standing up the global engine.

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
    Ok(crate::FfiBackupScreenData {
        home_lat,
        home_lng,
        radius_m,
        suggestion,
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
    })
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
fn stride_track(points: Vec<crate::GpsPoint>, max_points: u32) -> Vec<crate::FfiGpsPoint> {
    strided(&points, max_points as usize)
        .into_iter()
        .map(crate::FfiGpsPoint::from)
        .collect()
}

/// The rule itself, over the points rather than the FFI record, so the section
/// thumbnail below draws the same outline as the widget.
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
/// read over, so they add back up to it.
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
            }
        })
        .collect()
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
    let previous_complete = period_is_covered(conn, p.prev_start as i64, p.prev_end as i64);
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

/// One activity's contribution to the 42-day and 7-day load averages.
/// The rest-day baseline cancels prior-day decay from each difference.
fn activity_load_impact(load: Option<f64>) -> Option<crate::FfiActivityFitnessImpact> {
    let load = load.filter(|value| value.is_finite() && *value >= 0.0)?;
    let fitness = load / 42.0;
    let fatigue = load / 7.0;
    Some(crate::FfiActivityFitnessImpact {
        fitness,
        fatigue,
        form: fitness - fatigue,
    })
}

/// The sport settings entry whose `types` holds `sport_type`, from the raw
/// JSON the sync stored.
fn sport_entry(sport_settings: &str, sport_type: &str) -> Option<serde_json::Value> {
    let settings: serde_json::Value = serde_json::from_str(sport_settings).ok()?;
    settings
        .as_array()?
        .iter()
        .find(|entry| {
            entry
                .get("types")
                .and_then(|t| t.as_array())
                .is_some_and(|types| types.iter().any(|t| t.as_str() == Some(sport_type)))
        })
        .cloned()
}

/// The upper edge of each percentage band of max HR, used when a sport lists no
/// zones of its own.
const DEFAULT_HR_ZONE_UPPER_FRACTIONS: [f64; 5] = [0.6, 0.7, 0.8, 0.9, 1.0];

/// The heart rate zone, numbered from 1, that `bpm` falls in for `sport_type`.
///
/// The bounds are the `hr_zones` of the sport settings entry holding the type,
/// each the upper edge of its zone, so zone 1 starts at 0 and a bound belongs
/// to the zone above it. A sport with no zones in bpm gets
/// [`DEFAULT_HR_ZONE_UPPER_FRACTIONS`] of its `max_hr`, or of
/// [`DEFAULT_MAX_HR`]. A reading at or above the top bound is the top zone, and
/// a reading that is not a positive number has none.
fn hr_zone_number(sport_settings: Option<&str>, sport_type: &str, bpm: f64) -> Option<u32> {
    let entry = sport_settings.and_then(|raw| sport_entry(raw, sport_type));
    let max_hr =
        positive(entry.as_ref().and_then(|e| e.get("max_hr")?.as_f64())).unwrap_or(DEFAULT_MAX_HR);
    hr_zone_index(&hr_zone_bounds(&[], entry.as_ref(), max_hr), bpm)
}

/// The upper bpm edge of each heart rate zone, from the first source that has
/// any: the activity's own zones, the sport settings entry's `hr_zones`, then
/// [`DEFAULT_HR_ZONE_UPPER_FRACTIONS`] of `max_hr`. A source holding a
/// non-positive or non-numeric bound is skipped whole. Live recording and the
/// saved activity chart both read their bands here.
fn hr_zone_bounds(
    own_zones: &[f64],
    sport_entry: Option<&serde_json::Value>,
    max_hr: f64,
) -> Vec<f64> {
    let usable = |bounds: &[f64]| !bounds.is_empty() && bounds.iter().all(|b| *b > 0.0);
    if usable(own_zones) {
        return own_zones.to_vec();
    }
    let sport_zones: Vec<f64> = sport_entry
        .and_then(|e| e.get("hr_zones")?.as_array())
        .map(|zones| zones.iter().filter_map(|z| z.as_f64()).collect())
        .unwrap_or_default();
    if usable(&sport_zones) {
        return sport_zones;
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

/// The max HR for one activity, from the two places it can come from, in
/// order: the top bound of the activity's own `icu_hr_zones`, the `max_hr` of
/// the sport settings entry whose `types` holds the activity's `type`, then
/// [`DEFAULT_MAX_HR`]. Each source is raw JSON as stored, and one that does not
/// parse, or carries 0, is skipped.
fn resolve_max_hr(body: Option<&str>, sport_settings: Option<&str>) -> f64 {
    let body: Option<serde_json::Value> = body.and_then(|b| serde_json::from_str(b).ok());
    let own_zones = body
        .as_ref()
        .and_then(|b| b.get("icu_hr_zones"))
        .and_then(|z| z.as_array())
        .and_then(|z| z.last())
        .and_then(|top| top.as_f64());
    if let Some(top) = positive(own_zones) {
        return top;
    }

    let sport_type = body
        .as_ref()
        .and_then(|b| b.get("type"))
        .and_then(|t| t.as_str());
    let sport = sport_type
        .and_then(|sport_type| sport_entry(sport_settings?, sport_type))
        .and_then(|entry| entry.get("max_hr")?.as_f64());
    if let Some(sport) = positive(sport) {
        return sport;
    }

    DEFAULT_MAX_HR
}

/// [`resolve_max_hr`] over the rows one connection holds.
fn activity_max_hr(conn: &rusqlite::Connection, activity_id: &str) -> f64 {
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
    let entry = sport_type.and_then(|t| sport_entry(sport_settings?, t));
    let max_hr = resolve_max_hr(body, sport_settings);
    let bounds = hr_zone_bounds(&numbers("icu_hr_zones"), entry.as_ref(), max_hr);

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
        .and_then(|bytes| crate::persistence::codec::deserialize::<Vec<u32>>(&bytes).ok());
    activity_hr_zones(
        body.as_deref(),
        sport_settings.as_deref(),
        heartrate.as_deref(),
        times.as_deref(),
    )
    .unwrap_or_default()
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
    /// through `get_gps_track`, `get_activity_body`, `get_activity_bodies`,
    /// `get_interval_body` and `get_stream_body`, and it should keep doing so.
    /// A track is the largest thing an activity owns and a body is the
    /// upstream JSON whole; pulling either in here would put both on the mount
    /// path of every activity opened, which is the cost the narrowing above
    /// exists to avoid. It would also buy nothing measurable: on the S22, over
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
        let bounds = s
            .polyline
            .iter()
            .fold(None, |acc: Option<crate::FfiBounds>, p| {
                Some(match acc {
                    None => crate::FfiBounds {
                        min_lat: p.latitude,
                        max_lat: p.latitude,
                        min_lng: p.longitude,
                        max_lng: p.longitude,
                    },
                    Some(b) => crate::FfiBounds {
                        min_lat: b.min_lat.min(p.latitude),
                        max_lat: b.max_lat.max(p.latitude),
                        min_lng: b.min_lng.min(p.longitude),
                        max_lng: b.max_lng.max(p.longitude),
                    },
                })
            });
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
    /// lap list, the chart and the summary describe the same efforts.
    pub fn section_detail_performance(
        &self,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        pooled::section_detail_performance(
            self.cold_connection(),
            section_id,
            time_range_days,
            sport_filter,
        )
    }

    /// Everything the route detail screen paints with.
    ///
    /// The performances come back unfiltered so the screen can build its sport
    /// pills without a second read. A sport-filtered read is only worth making
    /// once the user picks one.
    pub fn route_detail_data(
        &self,
        group_id: &str,
        current_activity_id: Option<&str>,
        min_group_activities: u32,
    ) -> crate::FfiRouteDetailData {
        pooled::route_detail_data(
            self.cold_connection(),
            group_id,
            current_activity_id,
            min_group_activities,
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
        now: i64,
    ) -> crate::FfiStartupData {
        pooled::startup_data(
            self.cold_connection(),
            current_start,
            current_end,
            prev_start,
            prev_end,
            preview_activity_ids,
            now,
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

    /// Everything the training tab paints with that stays fixed while it is
    /// mounted. The app reads it through the pool, and this is the same read
    /// on the engine's connection.
    pub fn training_screen_data(
        &self,
        windows: &crate::FfiTrainingScreenWindows,
    ) -> rusqlite::Result<crate::FfiTrainingScreenData> {
        pooled::training_screen_data(self.cold_connection(), windows)
    }

    /// Everything the fitness tab paints with that stays fixed while it is
    /// mounted, as of `today`. The app reads it through the pool, and this is
    /// the same read on the engine's connection.
    pub fn fitness_screen_data(&self, today: &str) -> crate::FfiFitnessScreenData {
        pooled::fitness_screen_data(self.cold_connection(), today)
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
            route_lines,
            sections,
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

const RUN_CHECKPOINTS: [(f64, &str); 5] = [
    (400.0, "400m"),
    (1000.0, "1K"),
    (5000.0, "5K"),
    (10000.0, "10K"),
    (21097.5, "Half"),
];

const SWIM_CHECKPOINTS: [(f64, &str); 4] = [
    (100.0, "100m"),
    (200.0, "200m"),
    (400.0, "400m"),
    (1500.0, "1500m"),
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
                label: duration_label(secs),
                checkpoint: secs,
                value,
                time: None,
                activity_id: value
                    .and(index)
                    .and_then(|i| curve?.activity_ids.as_ref()?.get(i).cloned()),
            }
        })
        .collect()
}

fn pace_bests(
    curve: Option<&crate::persistence::curves::FfiPaceCurve>,
    checkpoints: &[(f64, &str)],
) -> Vec<crate::FfiBestEffort> {
    checkpoints
        .iter()
        .map(|&(metres, label)| {
            let index =
                curve.and_then(|c| nearest_within(&c.distances, metres, DISTANCE_TOLERANCE_M));
            // A zero time is a distance the curve does not cover, and its pace
            // is stored as nought rather than as a best.
            let time = index.and_then(|i| positive(curve?.times.get(i).copied()));
            let value = time
                .and(index)
                .and_then(|i| positive(curve?.pace.get(i).copied()));
            crate::FfiBestEffort {
                label: label.to_string(),
                checkpoint: metres,
                value,
                time: value.and(time),
                activity_id: value
                    .and(index)
                    .and_then(|i| curve?.activity_ids.as_ref()?.get(i).cloned()),
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
           AND g.elevation_source = {}
         GROUP BY b.window_s",
        crate::sport::sql_list(&family),
        crate::persistence::ELEVATION_SOURCE_CORRECTED
    );
    // A track row missing or not corrected leaves the activity unranked.
    let excluded_sql = format!(
        "SELECT COUNT(DISTINCT b.activity_id)
         FROM activity_climb_bests b
         JOIN activities a ON a.id = b.activity_id
         LEFT JOIN gps_tracks g ON g.activity_id = b.activity_id
         WHERE a.sport_type IN ({}) AND (?1 IS NULL OR a.start_date >= ?1)
           AND COALESCE(g.elevation_source, {}) != {}",
        crate::sport::sql_list(&family),
        crate::persistence::ELEVATION_SOURCE_UNKNOWN,
        crate::persistence::ELEVATION_SOURCE_CORRECTED
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
                }
            })
            .collect(),
    })
}

/// The section detail performance bundle, built from one sport's reads.
///
/// `read` answers a sport's included or excluded traversals over the whole
/// record: the lock holder from its caches, a pooled reader from SQLite.
/// Everything past that is arithmetic here, so the two paths give one answer,
/// and every figure on the screen is taken over one sport and one cutoff.
fn section_detail_from<R>(
    sports: &[(String, u32)],
    requested: Option<&str>,
    time_range_days: u32,
    wellness_between: impl FnOnce(&str, &str) -> Vec<crate::FfiWellnessDay>,
    curves_of: impl FnOnce(Option<&str>) -> std::sync::Arc<Option<crate::FfiSectionLapCurves>>,
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
    let chart_data = chart_from_cutoff(&all, cutoff);
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
        // An excluded attempt is never a record.
        point.is_best = false;
    }

    let sport_counts = offered
        .into_iter()
        .map(|(sport_type, count)| crate::FfiSectionSportCount { sport_type, count })
        .collect();

    let best_forward_is_record =
        shown_best_is_record(&all, performances.best_forward_record.as_ref(), false);
    let best_reverse_is_record =
        shown_best_is_record(&all, performances.best_reverse_record.as_ref(), true);
    let trend_curves = crate::persistence::sections::trend_curve::trend_curves(&chart_data.points);
    let histograms =
        crate::persistence::sections::attempt_histogram::section_histograms(&chart_data.points);
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
    // filters which laps are drawn.
    let curves = curves_of(filter.as_deref())
        .as_ref()
        .as_ref()
        .and_then(|curves| crate::persistence::sections::lap_curves::in_range(curves, cutoff));

    crate::FfiSectionPerformanceData {
        best_forward_is_record,
        best_reverse_is_record,
        sport_type,
        sport_counts,
        calendar_summary: crate::persistence::fitness::derivations::calendar_from(&all)
            .map(crate::FfiCalendarSummary::from),
        lap_records: with_excluded_laps(&all.records, &excluded.records)
            .into_iter()
            .map(crate::FfiSectionPerformanceRecord::from)
            .collect(),
        performances: crate::FfiSectionPerformanceResult::from(performances),
        chart_data,
        excluded_points,
        trend_curves,
        histograms,
        correlations,
        correlation_floor: crate::persistence::sections::correlations::MIN_PAIRS as u32,
        curves,
    }
}

/// Whether the best a direction shows is that direction's record: the same lap
/// as the best over the whole included history, and a strict beat of that
/// history's second best. A ranged view's best that is not the whole record's
/// is only the best of its range.
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
    if whole.activity_id != shown.activity_id || whole.best_time != shown.best_time {
        return false;
    }
    let times = all
        .records
        .iter()
        .flat_map(|r| &r.laps)
        .filter(|lap| (lap.direction == "reverse") == reverse && lap.direction != "partial")
        .filter(|lap| {
            crate::persistence::records::covers_enough_for_record(
                lap.coverage,
                lap.distance,
                whole.section_distance,
            )
        })
        .map(|lap| lap.time);
    let (best, second) = crate::persistence::records::best_two(times);
    best.is_some_and(|best| crate::persistence::records::is_personal_record(best, second))
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

    /// The days the fitness chart draws, and so the span its eFTP step is
    /// measured across.
    pub const FITNESS_FTP_LOOKBACK_DAYS: i64 = 90;

    /// Everything the fitness tab paints with that stays fixed while it is
    /// mounted: the eFTP trend over the chart's window with the activities
    /// that moved it, and the last stored critical speed for running and for
    /// swimming.
    ///
    /// The trend is read from wellness bodies and the eFTP markers a sync
    /// stores, the speeds from the snapshots a pace curve download writes, and
    /// all three land with the `activities` event. The range and sport the
    /// athlete taps are not here: a tap would otherwise re-read the trend to
    /// get a curve.
    pub fn fitness_screen_data(conn: &Connection, today: &str) -> crate::FfiFitnessScreenData {
        use crate::persistence::fitness::derivations::pooled as fitness;
        crate::FfiFitnessScreenData {
            ftp_trend: fitness::ftp_trend_over(conn, today, FITNESS_FTP_LOOKBACK_DAYS),
            run_pace_trend: fitness::pace_trend(conn, "Run"),
            swim_pace_trend: fitness::pace_trend(conn, "Swim"),
        }
    }

    /// Everything the training tab paints with that stays fixed while it is
    /// mounted: the heatmap days, the monthly rows, and the year and month to
    /// date against the same spans of last year.
    ///
    /// Every part is an aggregate of `activity_metrics`, or of the heatmap
    /// cache the metrics writer keeps beside it, so the `activities` event is
    /// the one that makes it stale. The weekly card's range is chosen with a
    /// tap while the screen stays mounted, so its totals are not here: a tap
    /// would otherwise re-read a year of days to get two numbers.
    pub fn training_screen_data(
        conn: &Connection,
        windows: &crate::FfiTrainingScreenWindows,
    ) -> rusqlite::Result<crate::FfiTrainingScreenData> {
        use crate::persistence::fitness::derivations::pooled::{
            activity_heatmap, monthly_stats, try_period_stats,
        };

        let span = |r: &crate::FfiTimestampRange| (r.start_ts as i64, r.end_ts as i64);
        let totals = |r: &crate::FfiTimestampRange| {
            let (start, end) = span(r);
            try_period_stats(conn, start, end)
        };
        let (months_start, months_end) = span(&windows.months);
        Ok(crate::FfiTrainingScreenData {
            heatmap: activity_heatmap(conn, &windows.heatmap_first_day, &windows.heatmap_last_day)?,
            months: monthly_stats(conn, months_start, months_end)?,
            year_current: totals(&windows.year_current)?,
            year_previous: totals(&windows.year_previous)?,
            month_current: totals(&windows.month_current)?,
            month_previous: totals(&windows.month_previous)?,
        })
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
                let checkpoints: &[(f64, &str)] = if sport == "Run" {
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

        Ok(crate::FfiBestEffortsData { sports, climbing })
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
        route_lines: bool,
        sections: bool,
        name_needle: String,
    ) -> crate::FfiMapScreenData {
        let chips = crate::persistence::read_cache::sport_types(|| available_sport_types(conn));
        screen_data(
            conn,
            start_date,
            end_date,
            sport_types,
            distance_band,
            is_metric,
            route_lines,
            sections,
            name_needle,
            chips,
        )
    }

    /// The section detail screen's performance bundle, read from SQLite alone.
    ///
    /// Every part of it is arithmetic over one sport's performances, so the
    /// engine method and this one share [`super::section_detail_from`] and
    /// differ only in where the performances come from: the engine's LRU and
    /// memory tier on one path, a pooled connection on the other.
    pub fn section_detail_performance(
        conn: &Connection,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        use crate::persistence::fitness::performances::{laps, pooled};
        let sports = laps::sports(conn, section_id);
        super::section_detail_from(
            &sports,
            sport_filter,
            time_range_days,
            |oldest, newest| {
                crate::persistence::wellness::pooled::wellness_days(conn, oldest, newest)
                    .unwrap_or_default()
            },
            |sport| {
                crate::persistence::sections::lap_curves::pooled::cached_lap_curves(
                    conn, section_id, sport,
                )
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

        let (latest_is_pr, latest_gps) = match latest.as_ref() {
            Some(m) => {
                let ids = [m.activity_id.clone()];
                let is_pr = holds_a_record(
                    &crate::persistence::fitness::derivations::pooled::route_highlights(conn, &ids),
                    &crate::persistence::indicators::pooled::activity_indicators(conn, &ids),
                );
                let gps = crate::persistence::activities::pooled::gps_track(conn, &m.activity_id)
                    .map(|points| super::stride_track(points, max_gps_points))
                    .unwrap_or_default();
                (is_pr, gps)
            }
            None => (false, Vec::new()),
        };

        crate::FfiWidgetSnapshotData {
            sparklines: wellness::sparklines_to(conn, sparkline_days, &today)
                .ok()
                .flatten(),
            summary: widget_summary_card(conn, current_start, current_end, prev_start, prev_end),
            latest: latest.map(crate::FfiActivityMetrics::from),
            latest_is_pr,
            ramp_rate: wellness::latest_ramp_rate_to(conn, sparkline_days, &today),
            latest_gps,
        }
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

    /// Everything the route detail screen paints with.
    ///
    /// The groups it lists are the last saved grouping rather than one the
    /// engine would regroup on the way past: a pooled reader sees committed
    /// rows, and `route_groups` holds the previous grouping until something on
    /// the write lock asks for a regroup. That deferred-regroup staleness is
    /// accepted and announced to the athlete elsewhere, so this read inherits
    /// it rather than fixing it.
    pub fn route_detail_data(
        conn: &Connection,
        group_id: &str,
        current_activity_id: Option<&str>,
        min_group_activities: u32,
    ) -> crate::FfiRouteDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::routes::pooled as routes;

        let mut groups: Vec<crate::FfiRouteGroup> = routes::all_groups(conn)
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_group_activities)
            .map(crate::FfiRouteGroup::from)
            .collect();
        groups.sort_by_key(|g| std::cmp::Reverse(g.activity_ids.len()));

        let group = routes::group_by_id(conn, group_id);
        let activity_ids: Vec<String> = group
            .as_ref()
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();
        let excluded = routes::excluded_route_activity_ids(conn, group_id);

        let match_info = routes::match_info(conn, group_id);
        let performances = crate::persistence::fitness::performances::route_performances(
            &activity_ids,
            Some(&match_info),
            &excluded,
            |id| activities::metrics_of(conn, id),
            current_activity_id,
            None,
        );

        let distance_meters = group
            .as_ref()
            .and_then(|g| activities::metrics_of(conn, &g.representative_id))
            .map_or(0.0, |m| m.distance);
        let performances = crate::FfiRoutePerformanceResult::from(performances);
        let last_activity_date = performances
            .performances
            .iter()
            .map(|p| p.date)
            .filter(|d| d.is_finite())
            .max_by(f64::total_cmp);

        crate::FfiRouteDetailData {
            activity_count: activity_count(conn),
            groups,
            performances,
            distance_meters,
            last_activity_date,
            encoded_representative: routes::representative_route(conn, group_id)
                .map(|points| crate::persistence::codec::encode_polyline(points.as_slice()))
                .unwrap_or_default(),
            route_names: routes::all_route_names(conn),
            excluded_activity_ids: excluded,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            group: group.map(crate::FfiRouteGroup::from),
        }
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

        let route_groups: Vec<crate::FfiRouteGroup> = routes::all_groups(conn)
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_route_activities)
            .find(|g| g.activity_ids.iter().any(|a| a == activity_id))
            .map(crate::FfiRouteGroup::from)
            .into_iter()
            .collect();

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
        crate::FfiActivityDetailData {
            exercise_groups: crate::persistence::strength::pooled::exercise_sets(conn, activity_id)
                .map(|sets| {
                    crate::objects::strength::summarise_session(
                        crate::objects::strength::sets_to_ffi(activity_id, &sets),
                    )
                    .groups
                })
                .unwrap_or_default(),
            fitness_impact: super::activity_load_impact(
                activities::metrics_of(conn, activity_id).and_then(|metrics| metrics.training_load),
            ),
            activity_count: activity_count(conn),
            section_count: sections::section_count(conn),
            route_groups,
            matched_sections: matched
                .into_iter()
                .map(crate::persistence::PersistentEngine::matched_section)
                .collect(),
            custom_sections: custom.into_iter().map(crate::FfiSection::from).collect(),
            encounters,
            highlights: crate::FfiActivityHighlightsBundle {
                indicators: indicators::activity_indicators(conn, &ids),
                route_highlights: derivations::route_highlights(conn, &ids),
            },
            section_traces,
            pr_section_ids,
            max_hr: super::activity_max_hr(conn, activity_id),
            hr_zones: super::activity_hr_zones_from(conn, activity_id),
            ledger_changes:
                crate::persistence::sections::history::pooled::ledger_changes_naming_activity(
                    conn,
                    activity_id,
                    &names,
                )
                .into_iter()
                .map(|c| crate::FfiActivityLedgerChange {
                    event_id: c.event_id as f64,
                    section_id: c.section_id,
                    section_name: c.section_name,
                    section_type: c.section_type,
                    at: c.at,
                    kind: c.kind,
                    relation: c.relation,
                })
                .collect(),
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
        use crate::persistence::activities::pooled as activities;
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
        let previous_week = derivations::period_stats(conn, p.prev_start as i64, p.prev_end as i64);
        let chronic_period =
            derivations::period_stats(conn, p.chronic_start as i64, p.prev_start as i64);

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
                perf.best_forward_record.as_ref(),
                perf.best_reverse_record.as_ref(),
            ]
            .into_iter()
            .flatten()
            .filter(|record| crate::persistence::records::is_section_record_pr(&perf, record))
            .min_by(|a, b| a.best_time.total_cmp(&b.best_time));
            if let Some(record) = best
                && record.activity_date >= recent_since
            {
                let days_ago = crate::calendar_days_between(record.activity_date, now_ts as i64);
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
            let Some(trend) = section_efficiency_trend_of(conn, section_id, sport_type, &names)
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
        // The four chronic weeks, then the compared week, which is already read.
        let mut weekly_totals =
            super::chronic_weeks(p.chronic_start as i64, p.prev_start as i64, |from, to| {
                derivations::period_stats(conn, from, to)
            });
        weekly_totals.push(crate::FfiWeeklyTotal {
            start: p.prev_start,
            stats: previous_week.clone(),
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
            weekly.push(crate::objects::strength::aggregate_strength_sets(&sets));
        }
        let progressions = crate::objects::strength::strength_progressions(&monthly, &weekly);
        Some(crate::FfiStrengthInsightSeries {
            monthly,
            weekly,
            progressions,
        })
    }

    /// One section's efficiency trend, with its name and length read from the
    /// row rather than the in-memory catalogue the engine path uses.
    pub(crate) fn section_efficiency_trend_of(
        conn: &Connection,
        section_id: &str,
        sport_type: &str,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Option<crate::FfiEfficiencyTrend> {
        let section =
            crate::persistence::sections::queries::pooled::section(conn, section_id, names)?;
        crate::persistence::fitness::derivations::pooled::section_efficiency_trend(
            conn,
            section_id,
            sport_type,
            section.name.as_deref().unwrap_or("Section"),
            section.distance_meters,
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
        use crate::persistence::fitness::derivations::pooled as derivations;
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

        let activity_metrics: Vec<crate::FfiActivityMetrics> = activity_ids
            .iter()
            .filter_map(|id| activities::metrics_of(conn, id))
            .map(crate::FfiActivityMetrics::from)
            .collect();

        let pinned_version =
            crate::persistence::sections::history::pooled::pinned_section_version(conn, section_id);

        // The trend is held within one sport. With no chip the screen opens on
        // the sport with the most outings, so that is the one sent ahead.
        let lead_sport = crate::persistence::fitness::performances::laps::sports(conn, section_id)
            .into_iter()
            .next()
            .map(|(sport, _)| sport);
        let efficiency_trend = section.as_ref().zip(lead_sport).and_then(|(s, sport)| {
            derivations::section_efficiency_trend(
                conn,
                section_id,
                &sport,
                s.name.as_deref().unwrap_or("Section"),
                s.distance_meters,
            )
        });

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
            activity_metrics,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            missing_time_stream_ids: activities::activities_missing_time_streams(
                conn,
                &portion_activity_ids,
            ),
            history: crate::persistence::sections::history::pooled::linked_section_history(
                conn, section_id, &names,
            )
            .into_iter()
            .map(|h| crate::FfiSectionHistoryEvent {
                id: h.id as f64,
                at: h.at,
                kind: h.kind,
                details: h.details,
                geometry_version: h.geometry_version.map(|v| v as f64),
            })
            .collect(),
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
            efficiency_trend,
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
        now: i64,
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
            new_activity_ids: crate::persistence::feed_rings::feed_ring_ids(conn, now),
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
        crate::FfiSummaryCardData {
            wellness: crate::persistence::wellness::pooled::summary(conn),
            current_week: fitness::period_stats(conn, current_start, current_end),
            prev_week: fitness::period_stats(conn, prev_start, prev_end),
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
        let sig = crate::persistence::read_cache::signature(activity_id, || {
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
        route_lines: bool,
        sections: bool,
        name_needle: String,
        available_sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        let window = map_activities_filtered(conn, start_date, end_date);
        let category_counts = crate::sport::DISPLAY_GROUPS
            .iter()
            .map(|(category, _)| crate::ffi_types::FfiMapCategoryCount {
                category: (*category).into(),
                count: window
                    .iter()
                    .filter(|activity| {
                        crate::sport::display_group(&activity.sport_type) == *category
                    })
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
            .collect();
        // Off, the read takes the count column alone; on, it takes the one
        // layer row. Neither touches a route group or a track.
        let (route_count, route_lines) = if route_lines {
            match crate::persistence::route_lines::pooled::layer_with_generation(conn) {
                Ok(Some((generation, lines))) => (
                    lines.len() as u32,
                    Some(crate::ffi_types::FfiRouteLineLayer {
                        generation: generation as f64,
                        routes: lines
                            .into_iter()
                            .map(|line| crate::ffi_types::FfiRouteLine {
                                route_id: line.route_id,
                                route_number: line.number,
                                polyline: line.polyline,
                            })
                            .collect(),
                    }),
                ),
                _ => (0, None),
            }
        } else {
            let count =
                crate::persistence::route_lines::pooled::route_count(conn).unwrap_or_default();
            (count, None)
        };
        crate::FfiMapScreenData {
            activity_count: activity_count(conn),
            available_sport_types,
            category_counts,
            activities,
            route_count,
            route_lines,
            section_count: crate::persistence::sections::queries::pooled::section_count(conn),
            sections: sections.then(|| {
                crate::persistence::sections::pooled::map_sections(
                    conn,
                    None,
                    Some(1),
                    &crate::persistence::sections::named::pooled::overlay_names(conn),
                )
            }),
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
                bounds: crate::FfiBounds {
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
#[path = "tests/training_screen.rs"]
mod training_screen_tests;

#[cfg(test)]
#[path = "tests/fitness_screen.rs"]
mod fitness_screen_tests;

#[cfg(test)]
mod tests {
    use super::hr_change_clears_floor;

    static DETAIL_SQL: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

    fn record_detail_sql(sql: &str) {
        DETAIL_SQL.lock().unwrap().push(sql.to_string());
    }

    fn lap_record(age_days: i64, time: f64) -> crate::SectionPerformanceRecord {
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
            None,
            30,
            |_, _| Vec::new(),
            |_| std::sync::Arc::new(None),
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
        let one = super::activity_load_impact(Some(100.0)).unwrap();
        assert!((one.fitness - 100.0 / 42.0).abs() < 1e-10);
        assert!((one.fatigue - 100.0 / 7.0).abs() < 1e-10);
        assert!((one.form - (one.fitness - one.fatigue)).abs() < 1e-10);
        let pair = super::activity_load_impact(Some(200.0)).unwrap();
        assert!((pair.fitness - 2.0 * one.fitness).abs() < 1e-10);
        assert!((pair.fatigue - 2.0 * one.fatigue).abs() < 1e-10);
        assert!((pair.form - 2.0 * one.form).abs() < 1e-10);
        let zero = super::activity_load_impact(Some(0.0)).unwrap();
        assert_eq!((zero.fitness, zero.fatigue, zero.form), (0.0, 0.0, 0.0));
        let large = super::activity_load_impact(Some(1e300)).unwrap();
        assert!(large.fitness.is_finite() && large.fatigue.is_finite() && large.form.is_finite());
        assert!(super::activity_load_impact(None).is_none());
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

    /// Scenario: the heart rate stat card and the zones chart on the activity
    /// screen divide by one max HR, and TypeScript resolved it from three engine
    /// reads. The screen read answers it now, with the same precedence.
    ///
    /// Expected behaviour: the top of the activity's own zones, then the sport
    /// setting for the activity's type, then 190. A value an older install left
    /// in the retired local zones setting is not read.
    mod activity_max_hr {
        use super::*;

        const RIDE: &str = r#"{"id":"a1","type":"Ride"}"#;
        const ZONED_RIDE: &str = r#"{"id":"a1","type":"Ride","icu_hr_zones":[130,150,170,196]}"#;
        const RIDE_185: &str = r#"[{"types":["Ride","VirtualRide"],"max_hr":185}]"#;
        const RUN_185: &str = r#"[{"types":["Run"],"max_hr":185}]"#;
        const LOCAL_180: &str =
            r#"{"maxHR":180,"zones":[{"id":1,"name":"Recovery","min":0.5,"max":0.6,"color":"x"}]}"#;

        #[test]
        fn takes_the_top_of_the_activitys_own_zones_first() {
            assert_eq!(resolve_max_hr(Some(ZONED_RIDE), Some(RIDE_185)), 196.0);
        }

        #[test]
        fn takes_the_sport_setting_for_an_activity_with_no_zones() {
            assert_eq!(resolve_max_hr(Some(RIDE), Some(RIDE_185)), 185.0);
            let empty = r#"{"type":"Ride","icu_hr_zones":[]}"#;
            assert_eq!(resolve_max_hr(Some(empty), Some(RIDE_185)), 185.0);
            let zero_top = r#"{"type":"Ride","icu_hr_zones":[130,150,0]}"#;
            assert_eq!(resolve_max_hr(Some(zero_top), Some(RIDE_185)), 185.0);
        }

        #[test]
        fn ignores_another_sports_setting_and_an_unset_one() {
            assert_eq!(resolve_max_hr(Some(RIDE), Some(RUN_185)), DEFAULT_MAX_HR);
            let unset = r#"[{"types":["Ride"],"max_hr":null}]"#;
            assert_eq!(resolve_max_hr(Some(RIDE), Some(unset)), DEFAULT_MAX_HR);
        }

        #[test]
        fn takes_the_default_with_nothing_else() {
            assert_eq!(resolve_max_hr(Some(RIDE), None), DEFAULT_MAX_HR);
            assert_eq!(resolve_max_hr(None, None), DEFAULT_MAX_HR);
            assert_eq!(DEFAULT_MAX_HR, 190.0);
        }

        #[test]
        fn garbage_sources_fall_through_rather_than_fail() {
            assert_eq!(resolve_max_hr(Some("{"), Some("{")), DEFAULT_MAX_HR);
            let wrong_shape = r#"{"type":"Ride","icu_hr_zones":"many"}"#;
            assert_eq!(resolve_max_hr(Some(wrong_shape), Some(RIDE_185)), 185.0);
        }

        /// The screen read carries the stored maximum heart rate.
        #[test]
        fn the_detail_read_carries_the_maximum_heart_rate() {
            let mut engine = crate::persistence::PersistentEngine::in_memory().expect("engine");
            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, RIDE.into())])
                .expect("body");
            engine.set_sport_settings(RIDE_185).expect("sport settings");
            engine
                .set_setting("veloq-hr-zones", LOCAL_180)
                .expect("local");

            assert_eq!(
                pooled::activity_detail_data(&engine.db, "a1", 1).max_hr,
                185.0
            );

            engine
                .upsert_activity_bodies(&[("a1".into(), 1_700_000_000, ZONED_RIDE.into())])
                .expect("detail body");
            assert_eq!(
                pooled::activity_detail_data(&engine.db, "a1", 1).max_hr,
                196.0
            );

            assert_eq!(
                pooled::activity_detail_data(&engine.db, "unknown", 1).max_hr,
                DEFAULT_MAX_HR
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
        // The pooled read goes through the process-wide read cache, which is keyed by section and not
        // by database, so another test's performances for the same ids must not be served here.
        let _serial = crate::test_globals::serial_global_state();
        crate::persistence::read_cache::clear();
        let dir = tempfile::TempDir::new().expect("directory");
        let path = dir.path().join("recent_insights.db");
        let engine = engine_with_a_recent_section_record(path.to_str().unwrap());
        let params = coverage_params();
        let bundle = pooled_insights_data(&engine, &params);
        assert_eq!(bundle.recent_prs.len(), 1);
        assert_eq!(bundle.recent_prs[0].best_time, 180.0);
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
        // The pooled read goes through the process-wide read cache, which is keyed by section and not
        // by database, so another test's performances for the same ids must not be served here.
        let _serial = crate::test_globals::serial_global_state();
        crate::persistence::read_cache::clear();
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
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        engine.set_setting("__athlete_id", "i1").expect("athlete");
        let p = coverage_params();
        let mut census = Vec::new();
        let mut bodies = Vec::new();
        for (i, (from, to)) in [
            (p.current_start, p.current_end),
            (p.prev_start, p.prev_end),
            (p.chronic_start, p.prev_start),
        ]
        .into_iter()
        .enumerate()
        {
            if empty == Some(i) {
                continue;
            }
            let id = format!("a{i}");
            let date = ((from + to) / 2.0) as i64;
            let local = chrono::DateTime::from_timestamp(date, 0)
                .expect("date")
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            census.push(crate::net::types::ActivityCensusEntry {
                id: id.clone(),
                start_date_local: Some(local),
                created: None,
                icu_sync_date: Some("v1".into()),
                has_latlng: false,
            });
            bodies.push((id.clone(), date, "{}".into()));
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id,
                    name: "Ride".into(),
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
        // The pooled overlay resolves through `read_cache`, whose stamp is one
        // process-wide path. Bind it to this database or the read answers with
        // whatever the last test left in the slot.
        crate::persistence::read_pool::bind(db_path);
        let engine = engine_with_a_traversed_section(db_path);

        let through_the_pool = pooled::section_detail_data(&engine.db, "auto1");
        assert_eq!(through_the_pool.activity_count, 2);
        assert_eq!(through_the_pool.activity_metrics.len(), 2);
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
        let mut engine = engine_with_a_traversed_section(db_path);

        DETAIL_SQL.lock().unwrap().clear();
        engine.db.trace(Some(record_detail_sql));
        let detail = pooled::section_detail_data(&engine.db, "auto1");
        engine.db.trace(None);

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
        let detail = pooled::section_detail_performance(&engine.db, "auto1", 1, None);
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
        pooled::section_detail_performance(&engine.db, "auto1", days, sport)
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
        let detail = pooled::section_detail_performance(&engine.db, "auto1", 0, None);

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
            pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids, 0)
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

        let data =
            pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids, 0);
        let lines = data.sparklines.expect("a day of wellness");
        assert_eq!(lines.fitness, vec![70]);
        assert_eq!(lines.form, vec![10], "form is fitness less fatigue");

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
        engine
            .set_activity_metrics(vec![first, second, missing])
            .expect("metrics");
        for id in ["first", "second"] {
            let impact = engine.activity_detail_data(id, 1).fitness_impact.unwrap();
            assert!((impact.fitness - 100.0 / 42.0).abs() < 1e-10);
            assert!((impact.fatigue - 100.0 / 7.0).abs() < 1e-10);
        }
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
            false,
            false,
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
            false,
            false,
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
            false,
            false,
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
            false,
            false,
            String::new(),
        );
        assert_eq!(screen.activity_count, 6);
        assert_eq!(screen.activities.len(), 1);
        assert_eq!(screen.activities[0].activity_id, "below");
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.category == "Ride")
                .unwrap()
                .count,
            2
        );
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.category == "Run")
                .unwrap()
                .count,
            1
        );
        assert_eq!(
            screen
                .category_counts
                .iter()
                .find(|c| c.category == "Other")
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
            false,
            false,
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
            false,
            false,
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
            false,
            false,
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
            false,
            false,
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
        let route = pooled::route_detail_data(&engine.db, "g1", Some("a2"), 1).activity_count;
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

        let detail = pooled::route_detail_data(&engine.db, "g1", None, 1);
        let best = detail
            .performances
            .best
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
            pooled::route_detail_data(&engine.db, "g1", None, 1).encoded_representative,
            long_encoded
        );

        engine
            .set_route_representative("g1", "short")
            .expect("set reference");
        let short_encoded = crate::persistence::codec::encode_polyline(&short_track);
        assert_eq!(
            pooled::route_detail_data(&engine.db, "g1", None, 1).encoded_representative,
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

        let detail = pooled::route_detail_data(&engine.db, "nope", None, 1);
        assert!(detail.group.is_none());
        assert!(detail.performances.performances.is_empty());
        assert!(detail.encoded_representative.is_empty());

        crate::persistence::read_cache::close();
    }

    /// Scenario: the athlete names a detected section, then opens an activity
    /// that crossed it. The row keeps the generated name, and the name the
    /// athlete gave lives on the named overlay.
    ///
    /// Expected behaviour: the encounters carry the athlete's name.
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
    /// distance, the figure the routes list shows, and the newest attempt's
    /// date across both sports.
    #[test]
    fn test_route_detail_carries_the_representative_distance_and_newest_date() {
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
        let mut walk = widget_metric("a2", 1_700_086_400, 3_500);
        walk.distance = 5_000.0;
        walk.sport_type = "Walk".into();
        engine
            .set_activity_metrics(vec![ride, walk])
            .expect("metrics");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let detail = pooled::route_detail_data(&engine.db, "g1", None, 1);
        assert_eq!(detail.distance_meters, 10_000.0);
        assert_eq!(detail.last_activity_date, Some(1_700_086_400.0));
        let unknown = pooled::route_detail_data(&engine.db, "nope", None, 1);
        assert_eq!(unknown.distance_meters, 0.0);
        assert_eq!(unknown.last_activity_date, None);

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
