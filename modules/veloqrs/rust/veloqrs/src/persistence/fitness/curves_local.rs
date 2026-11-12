//! Power and pace curves, best efforts and a critical-power eFTP worked out on
//! the phone from a ride's own streams.
//!
//! A library with an intervals.icu account takes all of these from the server
//! (`persistence/curves.rs` parses them). A library read from Garmin files has
//! no server to ask, so this module is the one owner of the same figures for
//! it: a per-activity curve at the standard durations and distances, the
//! library curve over each window the charts offer as the best of the
//! activities in it, written as a `curve_bodies` row in the server body's
//! shape with `source = 'veloq'`, and the daily eFTP written to the wellness
//! body's `sportInfo` shape.
//!
//! A library that holds any intervals.icu activity never writes any of it, and
//! a body the server sent is never replaced by one written here.
//!
//! The model is a linear critical-power fit: work (or distance) against time
//! over the 3 to 20 minute points, whose slope is critical power (or speed)
//! and whose intercept is W' (or D'). It is a two-parameter fit of the athlete's
//! own bests and says so on the chart; it is not the server's model.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use serde_json::{Value, json};

use crate::net::offline_prefetch::{ALL_TIME_CURVE_DAYS, CURVE_DAYS, CURVE_KEYS};
use crate::net::types::StreamDto;
use crate::persistence::{bodies::CurveKind, codec};

/// The `source` of a body worked out here.
pub(crate) const SOURCE_LOCAL: &str = "veloq";

/// The model name the fit is written under.
pub(crate) const MODEL_KIND: &str = "CP_LINEAR";

/// The durations a ride's power is summarised at, in seconds. The best-efforts
/// checkpoints (5 s to 2 h) are all in it.
pub(crate) const POWER_DURATIONS: [u32; 61] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 150, 180, 210, 240,
    270, 300, 330, 360, 390, 420, 450, 480, 510, 540, 570, 600, 660, 720, 780, 840, 900, 960, 1020,
    1080, 1140, 1200, 1320, 1440, 1500, 1560, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 4500, 5400,
    7200,
];

/// The distances a ride's pace is summarised at, in metres. The best-efforts
/// checkpoints are all in it, the mile and half marathon to the metre the
/// screen matches them at.
pub(crate) const PACE_DISTANCES: [u32; 20] = [
    100, 200, 300, 400, 500, 800, 1000, 1500, 1609, 2000, 3000, 3200, 4000, 5000, 8000, 10000,
    15000, 21098, 30000, 42195,
];

/// The points of the fit, in seconds.
const FIT_FROM_S: f64 = 180.0;
const FIT_TO_S: f64 = 1200.0;

/// The trailing window the daily eFTP is fitted over.
const EFTP_WINDOW_DAYS: i64 = 90;
const DAY_S: i64 = 86_400;

/// The share of the 20 minute best taken as threshold when no fit is supported.
const EFTP_FRACTION: f64 = 0.95;
const EFTP_BEST_S: f64 = 1200.0;

/// A ride longer than this is not summarised: its stream is a recording left
/// running, and 24 hours of one-second samples is the most worth holding.
const MAX_RIDE_S: usize = 86_400;

/// An activity's samples at one per second from its first, a missing sample
/// and a gap in the clock both reading as nought. Without a clock the samples
/// are taken to be one second apart.
pub(crate) fn resample_1hz(time: Option<&[f64]>, values: &[Option<f64>]) -> Vec<f64> {
    let Some(time) = time else {
        return values
            .iter()
            .map(|v| v.filter(|v| v.is_finite()).unwrap_or(0.0))
            .collect();
    };
    let Some(first) = time.first().copied() else {
        return Vec::new();
    };
    let mut out: Vec<f64> = Vec::new();
    for (t, v) in time.iter().zip(values) {
        let at = (t - first).round();
        if !at.is_finite() || at < 0.0 || at as usize >= MAX_RIDE_S {
            continue;
        }
        let at = at as usize;
        if out.len() <= at {
            out.resize(at + 1, 0.0);
        }
        out[at] = v.filter(|v| v.is_finite()).unwrap_or(0.0).max(0.0);
    }
    out
}

/// The best mean of `per_second` over each of `durations`, nought where the
/// ride is shorter than the duration.
pub(crate) fn mean_max(per_second: &[f64], durations: &[u32]) -> Vec<f32> {
    let mut prefix = Vec::with_capacity(per_second.len() + 1);
    prefix.push(0.0);
    let mut total = 0.0;
    for v in per_second {
        total += v;
        prefix.push(total);
    }
    durations
        .iter()
        .map(|&d| {
            let d = d as usize;
            if d == 0 || d > per_second.len() {
                return 0.0;
            }
            let best = (0..=per_second.len() - d)
                .map(|i| prefix[i + d] - prefix[i])
                .fold(0.0_f64, f64::max);
            (best / d as f64) as f32
        })
        .collect()
}

/// The shortest time taken to cover each of `distances`, in seconds, nought
/// where the ride is shorter. `time` and `distance` are the activity's own
/// samples, `distance` the cumulative metres; the effort starts at a sample
/// and ends where the distance is reached, interpolated between two.
pub(crate) fn best_times(time: &[f64], distance: &[f64], distances: &[u32]) -> Vec<f32> {
    let n = time.len().min(distance.len());
    let mut cumulative = Vec::with_capacity(n);
    let mut top = f64::NEG_INFINITY;
    for d in &distance[..n] {
        top = top.max(if d.is_finite() { *d } else { top.max(0.0) });
        cumulative.push(top);
    }
    distances
        .iter()
        .map(|&target| {
            let target = f64::from(target);
            let mut best = f64::INFINITY;
            let mut j = 0;
            for i in 0..n {
                if j < i {
                    j = i;
                }
                while j < n && cumulative[j] - cumulative[i] < target {
                    j += 1;
                }
                if j >= n {
                    break;
                }
                let reached = if j == i {
                    time[i]
                } else {
                    let (d0, d1) = (cumulative[j - 1], cumulative[j]);
                    let want = cumulative[i] + target;
                    let share = if d1 > d0 {
                        (want - d0) / (d1 - d0)
                    } else {
                        1.0
                    };
                    time[j - 1] + share * (time[j] - time[j - 1])
                };
                best = best.min(reached - time[i]);
            }
            if best.is_finite() && best > 0.0 {
                best as f32
            } else {
                0.0
            }
        })
        .collect()
}

/// The result of a critical-power or critical-speed fit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CriticalFit {
    /// Watts or metres a second.
    pub critical: f64,
    /// Joules or metres above critical.
    pub prime: f64,
    pub r2: f64,
}

/// The least-squares line through `(time, amount)` points, the amount being
/// work in joules or distance in metres: its slope is critical power or speed
/// and its intercept is W' or D'. Unsupported, so `None`, with fewer than three
/// points, a slope that is not positive or an intercept below nought.
pub(crate) fn critical_fit(points: &[(f64, f64)]) -> Option<CriticalFit> {
    if points.len() < 3 {
        return None;
    }
    let n = points.len() as f64;
    let (st, sa) = points
        .iter()
        .fold((0.0, 0.0), |(st, sa), (t, a)| (st + t, sa + a));
    let (mt, ma) = (st / n, sa / n);
    let sxx: f64 = points.iter().map(|(t, _)| (t - mt).powi(2)).sum();
    let sxy: f64 = points.iter().map(|(t, a)| (t - mt) * (a - ma)).sum();
    if sxx <= 0.0 {
        return None;
    }
    let slope = sxy / sxx;
    let intercept = ma - slope * mt;
    // A rounding error either side of nought is a fit that is exactly on it.
    if !(slope.is_finite() && intercept.is_finite()) || slope <= 0.0 || intercept < -1e-6 {
        return None;
    }
    let ss_tot: f64 = points.iter().map(|(_, a)| (a - ma).powi(2)).sum();
    let ss_res: f64 = points
        .iter()
        .map(|(t, a)| (a - (slope * t + intercept)).powi(2))
        .sum();
    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        1.0
    };
    Some(CriticalFit {
        critical: slope,
        prime: intercept.max(0.0),
        r2,
    })
}

/// What `best` holds at each width of a library curve and which activity it
/// came from.
pub(crate) struct Best {
    pub values: Vec<f64>,
    pub owner: Vec<Option<usize>>,
}

/// An activity's curve with what the library body names it by.
#[derive(Debug, Clone)]
pub(crate) struct RideCurve {
    pub id: String,
    pub name: String,
    pub distance: f64,
    pub moving_time: f64,
    /// Local wall-clock epoch seconds, as `activity_metrics.date` keeps them.
    pub at: i64,
    pub points: Vec<f32>,
}

/// Which way a curve improves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Sense {
    /// Power: the most watts held.
    Highest,
    /// Pace: the fewest seconds taken. Nought is a distance not covered.
    Lowest,
}

/// The best of `rides` at each of `width` points. The first ride to hold a
/// value keeps it against an equal one.
pub(crate) fn best_of(rides: &[&RideCurve], width: usize, sense: Sense) -> Best {
    let mut values = vec![0.0; width];
    let mut owner = vec![None; width];
    for (index, ride) in rides.iter().enumerate() {
        for (slot, &value) in ride.points.iter().take(width).enumerate() {
            let value = f64::from(value);
            if value <= 0.0 {
                continue;
            }
            let better = match sense {
                Sense::Highest => value > values[slot],
                Sense::Lowest => values[slot] == 0.0 || value < values[slot],
            };
            if better {
                values[slot] = value;
                owner[slot] = Some(index);
            }
        }
    }
    Best { values, owner }
}

/// The eFTP a power curve supports: the critical power of the fit when one is
/// supported, else 95 % of the 20 minute best. `None` when the curve reaches
/// neither.
pub(crate) fn eftp_of(best: &Best) -> Option<f64> {
    let fit = power_fit(best);
    if let Some(fit) = fit {
        return Some(fit.critical);
    }
    POWER_DURATIONS
        .iter()
        .position(|&d| f64::from(d) == EFTP_BEST_S)
        .map(|slot| best.values[slot])
        .filter(|w| *w > 0.0)
        .map(|w| w * EFTP_FRACTION)
}

fn power_fit(best: &Best) -> Option<CriticalFit> {
    let points: Vec<(f64, f64)> = POWER_DURATIONS
        .iter()
        .zip(&best.values)
        .filter(|(d, w)| (FIT_FROM_S..=FIT_TO_S).contains(&f64::from(**d)) && **w > 0.0)
        .map(|(d, w)| (f64::from(*d), w * f64::from(*d)))
        .collect();
    critical_fit(&points)
}

fn pace_fit(best: &Best) -> Option<CriticalFit> {
    let points: Vec<(f64, f64)> = PACE_DISTANCES
        .iter()
        .zip(&best.values)
        .filter(|(_, t)| (FIT_FROM_S..=FIT_TO_S).contains(*t))
        .map(|(d, t)| (*t, f64::from(*d)))
        .collect();
    critical_fit(&points)
}

/// The local `YYYY-MM-DDTHH:MM:SS` of a wall-clock epoch.
fn local_stamp(at: i64) -> String {
    chrono::DateTime::from_timestamp(at, 0)
        .map(|t| t.naive_utc().format("%Y-%m-%dT%H:%M:%S").to_string())
        .unwrap_or_default()
}

/// The window a library curve covers, in the body's fields.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Window {
    pub days: i64,
    pub now: i64,
    pub earliest: i64,
}

impl Window {
    fn start(&self) -> i64 {
        if self.days == ALL_TIME_CURVE_DAYS {
            self.earliest
        } else {
            self.now - self.days * DAY_S
        }
    }

    fn add_to(&self, list: &mut serde_json::Map<String, Value>) {
        list.insert("start_date_local".into(), json!(local_stamp(self.start())));
        list.insert("end_date_local".into(), json!(local_stamp(self.now)));
        if self.days != ALL_TIME_CURVE_DAYS {
            list.insert("days".into(), json!(self.days));
        }
    }
}

fn activities_of(rides: &[&RideCurve], used: &[usize], weight: Option<f64>) -> Value {
    let mut out = serde_json::Map::new();
    for &index in used {
        let ride = rides[index];
        out.insert(
            ride.id.clone(),
            json!({
                "id": ride.id,
                "name": ride.name,
                "distance": ride.distance,
                "moving_time": ride.moving_time,
                "training_load": 0,
                "icu_weight": weight.unwrap_or(0.0),
                "start_date_local": local_stamp(ride.at),
                "race": false,
            }),
        );
    }
    Value::Object(out)
}

fn used_rides(owners: &[Option<usize>]) -> Vec<usize> {
    let mut used: Vec<usize> = owners.iter().flatten().copied().collect();
    used.sort_unstable();
    used.dedup();
    used
}

/// The library power curve over `rides` in the server body's shape, or `None`
/// when no ride reaches any duration.
pub(crate) fn power_body(
    rides: &[&RideCurve],
    window: Window,
    weight: Option<f64>,
) -> Option<String> {
    let best = best_of(rides, POWER_DURATIONS.len(), Sense::Highest);
    let held: Vec<usize> = (0..POWER_DURATIONS.len())
        .filter(|&slot| best.values[slot] > 0.0)
        .collect();
    if held.is_empty() {
        return None;
    }
    let ids: Vec<&str> = held
        .iter()
        .filter_map(|&slot| best.owner[slot].map(|i| rides[i].id.as_str()))
        .collect();
    let mut list = serde_json::Map::new();
    window.add_to(&mut list);
    list.insert(
        "secs".into(),
        json!(held.iter().map(|&s| POWER_DURATIONS[s]).collect::<Vec<_>>()),
    );
    list.insert(
        "values".into(),
        json!(held.iter().map(|&s| best.values[s]).collect::<Vec<_>>()),
    );
    list.insert("activity_id".into(), json!(ids));
    if let Some(kg) = weight.filter(|w| *w > 0.0) {
        list.insert("weight".into(), json!(kg));
        list.insert(
            "watts_per_kg".into(),
            json!(
                held.iter()
                    .map(|&s| best.values[s] / kg)
                    .collect::<Vec<_>>()
            ),
        );
        list.insert("wkg_activity_id".into(), json!(ids));
    }
    if let (Some(fit), Some(eftp)) = (power_fit(&best), eftp_of(&best)) {
        let mut model = json!({
            "type": MODEL_KIND,
            "criticalPower": fit.critical,
            "wPrime": fit.prime,
            "ftp": eftp,
        });
        if let Some(five) = POWER_DURATIONS.iter().position(|&d| d == 5)
            && best.values[five] > 0.0
        {
            model["pMax"] = json!(best.values[five]);
        }
        list.insert("powerModels".into(), json!([model]));
    }
    let used = used_rides(&best.owner);
    Some(
        json!({
            "list": [Value::Object(list)],
            "activities": activities_of(rides, &used, weight),
            "source": SOURCE_LOCAL,
        })
        .to_string(),
    )
}

/// The library pace curve over `rides` in the server body's shape, or `None`
/// when no ride covers any distance.
pub(crate) fn pace_body(rides: &[&RideCurve], window: Window) -> Option<String> {
    let best = best_of(rides, PACE_DISTANCES.len(), Sense::Lowest);
    let held: Vec<usize> = (0..PACE_DISTANCES.len())
        .filter(|&slot| best.values[slot] > 0.0)
        .collect();
    if held.is_empty() {
        return None;
    }
    let mut list = serde_json::Map::new();
    window.add_to(&mut list);
    list.insert(
        "distance".into(),
        json!(held.iter().map(|&s| PACE_DISTANCES[s]).collect::<Vec<_>>()),
    );
    list.insert(
        "values".into(),
        json!(held.iter().map(|&s| best.values[s]).collect::<Vec<_>>()),
    );
    list.insert(
        "activity_id".into(),
        json!(
            held.iter()
                .filter_map(|&s| best.owner[s].map(|i| rides[i].id.as_str()))
                .collect::<Vec<_>>()
        ),
    );
    if let Some(fit) = pace_fit(&best) {
        list.insert(
            "paceModels".into(),
            json!([{
                "type": "CS",
                "criticalSpeed": fit.critical,
                "dPrime": fit.prime,
                "r2": fit.r2,
            }]),
        );
    }
    let used = used_rides(&best.owner);
    Some(
        json!({
            "list": [Value::Object(list)],
            "activities": activities_of(rides, &used, None),
            "source": SOURCE_LOCAL,
        })
        .to_string(),
    )
}

// ============================================================================
// Storage
// ============================================================================

/// Whether the library holds nothing from intervals.icu: no activity under an
/// intervals.icu id, and none a Garmin original was linked to one. Only such a
/// library works its curves out here.
pub(crate) fn is_garmin_only(conn: &Connection) -> SqlResult<bool> {
    let holds: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM activities
                         WHERE intervals_id IS NOT NULL
                            OR (id NOT LIKE 'local-%' AND id NOT LIKE 'src-%'
                                AND id NOT LIKE 'demo-%'))",
        [],
        |row| row.get(0),
    )?;
    Ok(!holds)
}

fn stream_values(streams: &[StreamDto], kind: &str) -> Option<Vec<Option<f64>>> {
    streams
        .iter()
        .find(|s| s.kind == kind && !s.data.is_empty())
        .map(|s| s.data.clone())
}

/// The curves one activity's stored streams make: power for a sport that
/// measures it, pace for one that is run or swum. Empty figures, not an
/// absent row, when the streams hold nothing to summarise.
fn ride_curves(conn: &Connection, id: &str, sport: &str) -> Vec<(&'static str, Vec<f32>)> {
    let Some(raw) = crate::persistence::bodies::pooled::reconstruct_stream_body(
        conn,
        id,
        "time,watts,velocity_smooth,distance",
    ) else {
        return curve_kinds_for(sport)
            .into_iter()
            .map(|k| (k, Vec::new()))
            .collect();
    };
    let streams: Vec<StreamDto> = serde_json::from_str(&raw).unwrap_or_default();
    let time: Option<Vec<f64>> = stream_values(&streams, "time")
        .map(|t| t.into_iter().map(|v| v.unwrap_or(f64::NAN)).collect());
    let time_ok = time.as_deref().filter(|t| t.iter().all(|v| v.is_finite()));
    let mut out = Vec::new();
    for kind in curve_kinds_for(sport) {
        let points = match kind {
            "power" => stream_values(&streams, "watts")
                .map(|watts| {
                    let per_second = resample_1hz(time_ok, &watts);
                    if per_second.is_empty() {
                        Vec::new()
                    } else {
                        mean_max(&per_second, &POWER_DURATIONS)
                    }
                })
                .unwrap_or_default(),
            _ => pace_points(&streams, time_ok),
        };
        out.push((kind, points));
    }
    out
}

fn pace_points(streams: &[StreamDto], time: Option<&[f64]>) -> Vec<f32> {
    let distance = stream_values(streams, "distance");
    let speed = stream_values(streams, "velocity_smooth");
    let length = distance
        .as_ref()
        .or(speed.as_ref())
        .map_or(0, |series| series.len());
    if length < 2 {
        return Vec::new();
    }
    let clock: Vec<f64> = match time {
        Some(t) if t.len() == length => t.to_vec(),
        _ => (0..length).map(|i| i as f64).collect(),
    };
    let cumulative: Vec<f64> = match distance {
        Some(d) => {
            let mut last = 0.0;
            d.into_iter()
                .map(|v| {
                    last = v.filter(|v| v.is_finite()).unwrap_or(last);
                    last
                })
                .collect()
        }
        None => {
            let speed = speed.unwrap_or_default();
            let mut total = 0.0;
            let mut out = Vec::with_capacity(length);
            for i in 0..length {
                if i > 0 {
                    let dt = (clock[i] - clock[i - 1]).max(0.0);
                    total += speed[i].filter(|v| v.is_finite()).unwrap_or(0.0).max(0.0) * dt;
                }
                out.push(total);
            }
            out
        }
    };
    best_times(&clock, &cumulative, &PACE_DISTANCES)
}

fn curve_kinds_for(sport: &str) -> Vec<&'static str> {
    if crate::sport::is_cycling(sport) {
        vec!["power"]
    } else if crate::sport::is_running(sport)
        || crate::sport::is_swimming(sport)
        || crate::sport::shows_pace(sport)
    {
        vec!["pace"]
    } else {
        Vec::new()
    }
}

fn store_ride_curve(conn: &Connection, id: &str, kind: &str, points: &[f32]) -> SqlResult<()> {
    let blob = codec::serialize(&points.to_vec())
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
    conn.execute(
        "INSERT INTO activity_curves (activity_id, kind, points) VALUES (?1, ?2, ?3)
         ON CONFLICT(activity_id, kind) DO UPDATE SET points = excluded.points",
        params![id, kind, blob],
    )?;
    Ok(())
}

/// Summarise every activity that has no curve row yet. Returns the dates of
/// those summarised, which are the days a trailing window now reads differently.
fn summarise_new_rides(conn: &Connection) -> SqlResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT m.activity_id, m.sport_type, m.date FROM activity_metrics m
          WHERE EXISTS (SELECT 1 FROM activities a WHERE a.id = m.activity_id)",
    )?;
    let rides: Vec<(String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<SqlResult<_>>()?;
    let mut added = Vec::new();
    for (id, sport, at) in rides {
        for kind in curve_kinds_for(&sport) {
            let held: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM activity_curves WHERE activity_id = ?1 AND kind = ?2)",
                params![id, kind],
                |row| row.get(0),
            )?;
            if held {
                continue;
            }
            let curves = ride_curves(conn, &id, &sport);
            let points = curves
                .iter()
                .find(|(k, _)| *k == kind)
                .map(|(_, p)| p.as_slice())
                .unwrap_or(&[]);
            store_ride_curve(conn, &id, kind, points)?;
            added.push(at);
        }
    }
    Ok(added)
}

fn load_rides(conn: &Connection, kind: &str, sport: &str) -> SqlResult<Vec<RideCurve>> {
    let family = crate::sport::sql_list(&crate::sport::family_of(sport));
    let mut stmt = conn.prepare(&format!(
        "SELECT m.activity_id, m.name, m.distance, m.moving_time, m.date, c.points
           FROM activity_curves c JOIN activity_metrics m ON m.activity_id = c.activity_id
          WHERE c.kind = ?1 AND m.sport_type IN ({family})
          ORDER BY m.date, m.activity_id"
    ))?;
    let rows = stmt.query_map(params![kind], |row| {
        let blob: Vec<u8> = row.get(5)?;
        Ok(RideCurve {
            id: row.get(0)?,
            name: row.get(1)?,
            distance: row.get(2)?,
            moving_time: row.get::<_, i64>(3)? as f64,
            at: row.get(4)?,
            points: codec::deserialize(&blob).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

/// Write `raw` as the library body for the key, unless the server holds one.
/// `None` takes a body written here back out, which is a window that no
/// longer holds any ride.
fn write_local_body(
    conn: &Connection,
    kind: CurveKind,
    sport: &str,
    days: i64,
    raw: Option<&str>,
    now: i64,
) -> SqlResult<()> {
    let kind = match kind {
        CurveKind::Power => "power",
        CurveKind::Pace => "pace",
    };
    match raw {
        Some(raw) => {
            conn.execute(
                "INSERT INTO curve_bodies (kind, sport, days, gap, raw, updated_at, source)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
                 ON CONFLICT(kind, sport, days, gap) DO UPDATE SET
                    raw = excluded.raw, updated_at = excluded.updated_at
                  WHERE curve_bodies.source = ?6",
                params![kind, sport, days, raw, now, SOURCE_LOCAL],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM curve_bodies
                  WHERE kind = ?1 AND sport = ?2 AND days = ?3 AND gap = 0 AND source = ?4",
                params![kind, sport, days, SOURCE_LOCAL],
            )?;
        }
    }
    Ok(())
}

/// The athlete's weight in force at `at`, for the per-kilogram series.
fn weight_at(conn: &Connection, at: i64) -> Option<f64> {
    super::sport_settings::thresholds_for(conn, "Ride", at)
        .weight_kg
        .map(|w| w.value)
}

fn rebuild_library_curves(conn: &Connection, now: i64) -> SqlResult<()> {
    for key in CURVE_KEYS.iter().filter(|key| !key.gap) {
        let kind_name = match key.kind {
            CurveKind::Power => "power",
            CurveKind::Pace => "pace",
        };
        let rides = load_rides(conn, kind_name, key.sport)?;
        let weight = (key.kind == CurveKind::Power)
            .then(|| weight_at(conn, now))
            .flatten();
        for &days in CURVE_DAYS {
            let inside: Vec<&RideCurve> = rides
                .iter()
                .filter(|r| days == ALL_TIME_CURVE_DAYS || r.at >= now - days * DAY_S)
                .collect();
            let window = Window {
                days,
                now,
                earliest: inside.iter().map(|r| r.at).min().unwrap_or(now),
            };
            let body = match key.kind {
                CurveKind::Power => power_body(&inside, window, weight),
                CurveKind::Pace => pace_body(&inside, window),
            };
            write_local_body(conn, key.kind, key.sport, days, body.as_deref(), now)?;
        }
    }
    Ok(())
}

/// The cycling eFTP for each day that holds a ride and whose trailing 90 days
/// include one of `added`: the fit over the rides in the 90 days up to and
/// including the day.
fn rebuild_daily_eftp(conn: &Connection, added: &[i64]) -> SqlResult<()> {
    let rides = load_rides(conn, "power", "Ride")?;
    let mut days: Vec<i64> = rides.iter().map(|r| r.at.div_euclid(DAY_S)).collect();
    days.dedup();
    for day in days {
        let end = (day + 1) * DAY_S;
        let start = end - EFTP_WINDOW_DAYS * DAY_S;
        if !added.iter().any(|at| (start..end).contains(at)) {
            continue;
        }
        let inside: Vec<&RideCurve> = rides
            .iter()
            .filter(|r| (start..end).contains(&r.at))
            .collect();
        let best = best_of(&inside, POWER_DURATIONS.len(), Sense::Highest);
        let Some(eftp) = eftp_of(&best) else {
            continue;
        };
        let date = chrono::DateTime::from_timestamp(day * DAY_S, 0)
            .map(|t| t.date_naive().to_string())
            .unwrap_or_default();
        write_daily_eftp(conn, &date, eftp)?;
    }
    Ok(())
}

/// Put `eftp` into the day's wellness body as its cycling `sportInfo` entry,
/// leaving everything else in the body and the row as it is.
fn write_daily_eftp(conn: &Connection, date: &str, eftp: f64) -> SqlResult<()> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT raw FROM wellness WHERE date = ?1",
            params![date],
            |row| row.get(0),
        )
        .optional()?;
    let mut body: Value = stored
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let entries = body
        .as_object_mut()
        .and_then(|o| {
            o.entry("sportInfo")
                .or_insert_with(|| json!([]))
                .as_array_mut()
        })
        .map(|a| a.to_owned())
        .unwrap_or_default();
    let mut entries: Vec<Value> = entries
        .into_iter()
        .filter(|e| {
            !e.get("type")
                .and_then(Value::as_str)
                .is_some_and(crate::sport::is_cycling)
        })
        .collect();
    entries.push(json!({"type": "Ride", "eftp": eftp.round()}));
    body["sportInfo"] = Value::Array(entries);
    conn.execute(
        "INSERT INTO wellness (date, raw, updated_at) VALUES (?1, ?2, strftime('%s', 'now'))
         ON CONFLICT(date) DO UPDATE SET raw = excluded.raw, updated_at = excluded.updated_at",
        params![date, body.to_string()],
    )?;
    Ok(())
}

/// Bring the curves up to date with the activities stored: summarise the ones
/// not yet summarised, then rewrite the library curves and the daily eFTP they
/// move. Does nothing in a library that holds anything from intervals.icu.
pub(crate) fn refresh(conn: &Connection, now: i64) -> SqlResult<()> {
    if !is_garmin_only(conn)? {
        return Ok(());
    }
    let added = summarise_new_rides(conn)?;
    if added.is_empty() {
        return Ok(());
    }
    rebuild_library_curves(conn, now)?;
    rebuild_daily_eftp(conn, &added)
}

#[cfg(test)]
#[path = "tests/curves_local.rs"]
mod tests;
