//! A ride's load, intensity, normalised power, zone times, efficiency factor and
//! decoupling, worked out from its stored streams and the athlete's thresholds.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use super::sport_settings::thresholds_for;
use crate::objects::start::FfiStartOutcome;
use crate::persistence::origin::SOURCE_KEY_PREFIX;
use crate::persistence::{PersistentEngine, with_persistent_engine_for};

/// One ride's samples: the second each was taken, and its power and heart rate.
#[derive(Debug, Clone, Default)]
pub(crate) struct Samples {
    pub time: Vec<f64>,
    pub watts: Vec<Option<f64>>,
    pub heart_rate: Vec<Option<f64>>,
    /// Speed in metres per second.
    pub speed: Vec<Option<f64>>,
}

/// The figures a ride is judged against.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Judged {
    pub ftp: Option<f64>,
    pub threshold_hr: Option<f64>,
    pub max_hr: Option<f64>,
    pub resting_hr: Option<f64>,
    /// Threshold pace as a speed in metres per second. Set only for a sport
    /// that is scored by pace.
    pub threshold_pace: Option<f64>,
}

/// Which stream the load was worked out from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoadBasis {
    Power,
    HeartRate,
    Pace,
}

/// What a ride's streams give. A figure the streams cannot give is `None`.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RideMetrics {
    pub normalised_power: Option<f64>,
    /// Normalised power over FTP, 1.0 at threshold.
    pub intensity: Option<f64>,
    pub training_load: Option<f64>,
    pub load_basis: Option<LoadBasis>,
    pub power_zone_seconds: Option<[u32; 7]>,
    pub hr_zone_seconds: Option<[u32; 7]>,
    pub efficiency_factor: Option<f64>,
    /// First half against second half, in percent.
    pub decoupling: Option<f64>,
}

/// The longest a reading is held to cover the seconds after it. A longer gap
/// is a stop of the recorder, and none of it counts as riding.
const MAX_HOLD_SECONDS: f64 = 10.0;

/// The window normalised power rolls its mean over, in seconds.
const ROLLING_WINDOW: usize = 30;

/// The upper edge of power zones 1 to 6 as a percent of FTP. Zone 7 has none.
const POWER_ZONE_PERCENT: [f64; 6] = [55.0, 75.0, 90.0, 105.0, 120.0, 150.0];

/// The upper edge of heart rate zones 1 to 6 as a percent of threshold heart
/// rate. Zone 7 has none.
const HR_ZONE_PERCENT: [f64; 6] = [80.0, 89.0, 93.0, 99.0, 102.0, 105.0];

/// The steepness of the exponential weight a heart rate reserve fraction is
/// given in the heart rate load.
const HR_LOAD_STEEPNESS: f64 = 1.92;

#[derive(Debug, Clone, Copy)]
struct Second {
    watts: Option<f64>,
    heart_rate: Option<f64>,
    speed: Option<f64>,
}

/// One entry per second ridden. A reading is held across the seconds up to
/// the next one, so a recorder that logs every few seconds still counts them
/// all, and a gap past [`MAX_HOLD_SECONDS`] is dropped rather than counted.
fn seconds(samples: &Samples) -> Vec<Second> {
    let at = |series: &[Option<f64>], i: usize| {
        series
            .get(i)
            .copied()
            .flatten()
            .filter(|v| v.is_finite() && *v >= 0.0)
    };
    let mut out = Vec::with_capacity(samples.time.len());
    for (i, t) in samples.time.iter().enumerate() {
        let held = samples
            .time
            .get(i + 1)
            .map(|next| next - t)
            .filter(|gap| *gap > 0.0 && *gap <= MAX_HOLD_SECONDS)
            .map_or(1, |gap| gap.round().max(1.0) as usize);
        let second = Second {
            watts: at(&samples.watts, i),
            heart_rate: at(&samples.heart_rate, i).filter(|hr| *hr > 0.0),
            speed: at(&samples.speed, i),
        };
        out.extend(std::iter::repeat_n(second, held));
    }
    out
}

/// Normalised power of a run of power readings: the fourth root of the mean
/// fourth power of the 30 s rolling mean. `None` when the run is shorter than
/// the window.
fn normalised_power(watts: &[f64]) -> Option<f64> {
    if watts.len() < ROLLING_WINDOW {
        return None;
    }
    let mut window: f64 = watts[..ROLLING_WINDOW].iter().sum();
    let mut fourth = 0.0;
    let mut count = 0usize;
    for end in ROLLING_WINDOW..=watts.len() {
        let mean = window / ROLLING_WINDOW as f64;
        fourth += mean.powi(4);
        count += 1;
        if end < watts.len() {
            window += watts[end] - watts[end - ROLLING_WINDOW];
        }
    }
    Some((fourth / count as f64).powf(0.25))
}

fn mean_heart_rate(seconds: &[Second]) -> Option<f64> {
    let (sum, n) = seconds
        .iter()
        .filter_map(|s| s.heart_rate)
        .fold((0.0, 0usize), |(sum, n), hr| (sum + hr, n + 1));
    (n > 0).then(|| sum / n as f64)
}

fn efficiency(seconds: &[Second], watts: &[f64]) -> Option<f64> {
    let np = normalised_power(watts)?;
    mean_heart_rate(seconds).map(|hr| np / hr)
}

fn zone_of(value: f64, bounds_percent: &[f64; 6], reference: f64) -> usize {
    // Compared as value times 100 against percent times the reference, so a
    // reading that lands on a bound is not split by rounding.
    bounds_percent
        .iter()
        .take_while(|percent| value * 100.0 > **percent * reference)
        .count()
}

/// The load a heart rate stream earns against a threshold: each second is
/// weighted by an exponential of its fraction of the heart rate reserve, and
/// an hour at threshold heart rate is a hundred.
fn heart_rate_load(seconds: &[Second], judged: &Judged) -> Option<f64> {
    let (threshold, max, rest) = (judged.threshold_hr?, judged.max_hr?, judged.resting_hr?);
    if !(max > rest && threshold > rest) {
        return None;
    }
    let weight = |hr: f64| {
        let fraction = ((hr - rest) / (max - rest)).clamp(0.0, 1.0);
        fraction * (HR_LOAD_STEEPNESS * fraction).exp()
    };
    let total: f64 = seconds
        .iter()
        .filter_map(|s| s.heart_rate)
        .map(weight)
        .sum();
    let at_threshold = weight(threshold);
    (total > 0.0 && at_threshold > 0.0).then(|| total / (3600.0 * at_threshold) * 100.0)
}

/// The load a speed stream earns against a threshold pace: each second counts
/// the square of its speed over the threshold speed, so an hour at threshold
/// pace is a hundred. A second with no speed reading adds nothing.
fn pace_load(seconds: &[Second], judged: &Judged) -> Option<f64> {
    let threshold = judged
        .threshold_pace
        .filter(|v| v.is_finite() && *v > 0.0)?;
    if !seconds.iter().any(|s| s.speed.is_some()) {
        return None;
    }
    let total: f64 = seconds
        .iter()
        .filter_map(|s| s.speed)
        .map(|v| (v / threshold).powi(2))
        .sum();
    (total > 0.0).then(|| total / 3600.0 * 100.0)
}

/// Everything the streams of one ride give against `judged`.
pub(crate) fn compute(samples: &Samples, judged: &Judged) -> RideMetrics {
    let seconds = seconds(samples);
    let positive = |v: Option<f64>| v.filter(|v| v.is_finite() && *v > 0.0);
    let ftp = positive(judged.ftp);
    let has_power = seconds.iter().any(|s| s.watts.is_some());
    let watts: Vec<f64> = if has_power {
        seconds.iter().map(|s| s.watts.unwrap_or(0.0)).collect()
    } else {
        Vec::new()
    };

    let mut out = RideMetrics {
        normalised_power: normalised_power(&watts),
        ..RideMetrics::default()
    };
    if let (Some(np), Some(ftp)) = (out.normalised_power, ftp) {
        let intensity = np / ftp;
        out.intensity = Some(intensity);
        out.training_load = Some(seconds.len() as f64 / 3600.0 * np * intensity / ftp * 100.0);
        out.load_basis = Some(LoadBasis::Power);
    }
    if out.training_load.is_none()
        && let Some(load) = heart_rate_load(&seconds, judged)
    {
        out.training_load = Some(load);
        out.load_basis = Some(LoadBasis::HeartRate);
    }
    if out.training_load.is_none()
        && let Some(load) = pace_load(&seconds, judged)
    {
        out.training_load = Some(load);
        out.load_basis = Some(LoadBasis::Pace);
    }
    if let (true, Some(ftp)) = (has_power, ftp) {
        let mut zones = [0u32; 7];
        for w in &watts {
            zones[zone_of(*w, &POWER_ZONE_PERCENT, ftp)] += 1;
        }
        out.power_zone_seconds = Some(zones);
    }
    if let Some(threshold) = positive(judged.threshold_hr)
        && seconds.iter().any(|s| s.heart_rate.is_some())
    {
        let mut zones = [0u32; 7];
        for hr in seconds.iter().filter_map(|s| s.heart_rate) {
            zones[zone_of(hr, &HR_ZONE_PERCENT, threshold)] += 1;
        }
        out.hr_zone_seconds = Some(zones);
    }
    if has_power {
        out.efficiency_factor = efficiency(&seconds, &watts);
        let half = seconds.len() / 2;
        let first = efficiency(&seconds[..half], &watts[..half]);
        let second = efficiency(&seconds[half..], &watts[half..]);
        if let (Some(first), Some(second)) = (first, second)
            && first > 0.0
        {
            out.decoupling = Some((first - second) / first * 100.0);
        }
    }
    out
}

// ============================================================================
// Storage
// ============================================================================

/// The mark on a row whose figures Veloq worked out from its streams.
pub(crate) const SOURCE_VELOQ: &str = "veloq";

/// The mark on a row that carries the figures intervals.icu served.
pub(crate) const SOURCE_INTERVALS: &str = "intervals";

/// The body keys a scored ride writes, which are the ones intervals.icu's own
/// body names these figures by. Every one is cleared before a re-score, so a
/// figure the streams no longer give does not outlive the others.
pub(crate) const BODY_KEYS: [&str; 9] = [
    "icu_training_load",
    "icu_intensity",
    "icu_ftp",
    "icu_weighted_avg_watts",
    "icu_efficiency_factor",
    "decoupling",
    "icu_zone_times",
    "icu_hr_zone_times",
    "metrics_source",
];

/// The rows the backfill owes work: a stored source row that has power or
/// heart rate streams and either no mark or a Veloq mark with no load, which a
/// threshold set since may now give.
const OWED_FROM_WHERE: &str = "FROM activity_metrics m
     WHERE m.activity_id >= ?1 AND m.activity_id < 'src.'
       AND (m.metrics_source IS NULL
            OR (m.metrics_source = 'veloq' AND m.training_load IS NULL))
       AND EXISTS (SELECT 1 FROM activity_streams s
                   WHERE s.activity_id = m.activity_id
                     AND s.kind IN ('watts', 'heartrate', 'velocity_smooth'))";

/// Rows scored under one hold of the engine lock.
const PAGE: usize = 25;

static RUNNING: AtomicBool = AtomicBool::new(false);

/// How many rows the backfill owes work.
pub(crate) fn owed_count(conn: &Connection) -> SqlResult<u64> {
    if !super::curves_local::is_garmin_only(conn)? {
        return Ok(0);
    }
    conn.query_row(
        &format!("SELECT COUNT(*) {OWED_FROM_WHERE}"),
        params![SOURCE_KEY_PREFIX],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as u64)
}

/// Work the owed rows off in pages, each under its own hold of the engine
/// lock, so a sync or a read waits for one page and not for the library. Stops
/// when nothing is owed, when the library it began against is replaced, or
/// when a page fails.
fn run_pass(install: u64) -> usize {
    let mut attempted = HashSet::new();
    let mut total = 0;
    loop {
        match with_persistent_engine_for(install, |engine| {
            engine.backfill_ride_metrics_page(&mut attempted, PAGE)
        }) {
            Some(Ok(0)) | None => {
                settle_fitness_series(install);
                return total;
            }
            Some(Ok(done)) => total += done,
            Some(Err(error)) => {
                log::warn!("[Metrics] ride metrics backfill stopped: {error}");
                return total;
            }
        }
        std::thread::yield_now();
    }
}

/// Fold the loads the pass settled into the wellness rows.
fn settle_fitness_series(install: u64) {
    let outcome = with_persistent_engine_for(install, |engine| {
        super::fitness_series::refresh(&engine.db, &crate::persistence::wellness::today_iso())
    });
    if let Some(Err(error)) = outcome {
        log::warn!("[Metrics] fitness series not worked out: {error}");
    }
}

/// Start a pass on a thread of its own when rows are owed.
///
/// It reads only what is stored, so it needs no credential. The count reads
/// through the pool, so an empty queue costs one query and no thread. It is
/// safe to ask at every open.
pub fn start_backfill() -> FfiStartOutcome {
    match crate::objects::error::with_reader(owed_count) {
        Ok(Ok(0)) => return FfiStartOutcome::NotOwed,
        Ok(Ok(_)) => {}
        _ => return FfiStartOutcome::NotReady,
    }
    if RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return FfiStartOutcome::Busy;
    }
    let install = crate::persistence::engine_install();
    crate::threads::spawn_named("veloq-ridescore", move || {
        run_pass(install);
        RUNNING.store(false, Ordering::SeqCst);
    });
    FfiStartOutcome::Started
}

/// The series of one stored activity as [`Samples`]. The time axis is the
/// activity's own `time` series when it was stored without a track, else the
/// track's clock. A series that does not cover the same samples as the time
/// axis is not used.
fn samples_of(conn: &Connection, id: &str) -> Option<Samples> {
    let streams = crate::persistence::streams::pooled::activity_streams(conn, id).ok()?;
    let find = |kind: &str| streams.iter().find(|s| s.kind == kind).map(|s| &s.data);
    let time: Vec<f64> = match find("time") {
        Some(time) => time.iter().map(|t| t.unwrap_or(f64::NAN)).collect(),
        None => crate::persistence::activities::pooled::time_stream(conn, id)?
            .into_iter()
            .map(f64::from)
            .collect(),
    };
    if time.is_empty() || time.iter().any(|t| !t.is_finite()) {
        return None;
    }
    let covered = time.len();
    let aligned = |kind: &str| {
        find(kind)
            .filter(|data| data.len() == covered)
            .cloned()
            .unwrap_or_default()
    };
    Some(Samples {
        time,
        watts: aligned("watts"),
        heart_rate: aligned("heartrate"),
        speed: aligned("velocity_smooth"),
    })
}

fn has_figures(m: &RideMetrics) -> bool {
    m.training_load.is_some()
        || m.normalised_power.is_some()
        || m.power_zone_seconds.is_some()
        || m.hr_zone_seconds.is_some()
        || m.efficiency_factor.is_some()
}

/// The body of a scored ride: `body` with the keys intervals.icu names these
/// figures by set from `m`, and the mark.
fn scored_body(mut body: Value, m: &RideMetrics, ftp: Option<f64>) -> Value {
    let Some(map) = body.as_object_mut() else {
        return body;
    };
    for key in BODY_KEYS {
        map.remove(key);
    }
    let finite = |v: f64| v.is_finite().then_some(v);
    let mut put = |key: &str, value: Option<f64>| {
        if let Some(v) = value.and_then(finite) {
            map.insert(key.into(), json!(v));
        }
    };
    put("icu_training_load", m.training_load);
    put("icu_intensity", m.intensity.map(|i| i * 100.0));
    if m.load_basis == Some(LoadBasis::Power) || m.power_zone_seconds.is_some() {
        put("icu_ftp", ftp);
    }
    put("icu_weighted_avg_watts", m.normalised_power);
    put("icu_efficiency_factor", m.efficiency_factor);
    put("decoupling", m.decoupling);
    if let Some(zones) = m.power_zone_seconds {
        let zones: Vec<Value> = zones
            .iter()
            .enumerate()
            .map(|(i, secs)| json!({"id": format!("Z{}", i + 1), "secs": secs}))
            .collect();
        map.insert("icu_zone_times".into(), Value::Array(zones));
    }
    if let Some(zones) = m.hr_zone_seconds {
        map.insert("icu_hr_zone_times".into(), json!(zones));
    }
    map.insert("metrics_source".into(), json!(SOURCE_VELOQ));
    body
}

/// The samples whose time falls in `[from, to]` seconds from the start.
fn samples_between(samples: &Samples, from: f64, to: f64) -> Samples {
    let inside: Vec<usize> = (0..samples.time.len())
        .filter(|&i| samples.time[i] >= from && samples.time[i] <= to)
        .collect();
    let pick = |series: &[Option<f64>]| -> Vec<Option<f64>> {
        if series.is_empty() {
            return Vec::new();
        }
        inside.iter().map(|&i| series[i]).collect()
    };
    Samples {
        time: inside.iter().map(|&i| samples.time[i]).collect(),
        watts: pick(&samples.watts),
        heart_rate: pick(&samples.heart_rate),
        speed: pick(&samples.speed),
    }
}

/// An interval body with each lap's load and intensity set from the samples
/// inside it, scored as the ride is, or `None` when the body holds no laps or
/// nothing changes.
fn scored_laps(raw: &str, samples: &Samples, judged: &Judged) -> Option<String> {
    let before: Value = serde_json::from_str(raw).ok()?;
    let mut body = before.clone();
    let intervals = body.get_mut("icu_intervals")?.as_array_mut()?;
    for lap in intervals.iter_mut() {
        let Some(entry) = lap.as_object_mut() else {
            continue;
        };
        entry.remove("icu_training_load");
        entry.remove("icu_intensity");
        let (Some(from), Some(to)) = (
            entry.get("start_time").and_then(Value::as_f64),
            entry.get("end_time").and_then(Value::as_f64),
        ) else {
            continue;
        };
        let metrics = compute(&samples_between(samples, from, to), judged);
        let finite = |v: f64| v.is_finite().then_some(v);
        if let Some(load) = metrics.training_load.and_then(finite) {
            entry.insert("icu_training_load".into(), json!(load));
        }
        if let Some(intensity) = metrics.intensity.and_then(finite) {
            entry.insert("icu_intensity".into(), json!(intensity * 100.0));
        }
    }
    (body != before).then(|| body.to_string())
}

fn serves_load(body: &Value) -> bool {
    body.get("icu_training_load").is_some_and(Value::is_number)
}

impl PersistentEngine {
    /// Work out a stored activity's load, intensity, normalised power, zone
    /// times, efficiency factor and decoupling from its streams and the
    /// thresholds in force on its date, and store them beside the server
    /// columns marked as Veloq's. Answers whether anything was scored.
    ///
    /// A body that carries intervals.icu's load keeps every number it has and
    /// the row is marked `intervals`. A ride whose streams give no power and no
    /// heart rate, or whose sport has no threshold to judge it by, is left as
    /// it is, with no figures rather than zeros.
    pub(crate) fn settle_ride_metrics(&mut self, id: &str) -> SqlResult<bool> {
        let Some(raw) = self.get_activity_body(id) else {
            return Ok(false);
        };
        let Ok(body) = serde_json::from_str::<Value>(&raw) else {
            return Ok(false);
        };
        let Some((sport, date, mark)) = self
            .db
            .query_row(
                "SELECT sport_type, date, metrics_source FROM activity_metrics
                 WHERE activity_id = ?",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(false);
        };
        let ours = body.get("metrics_source").and_then(Value::as_str) == Some(SOURCE_VELOQ);
        if !ours && serves_load(&body) {
            if mark.as_deref() != Some(SOURCE_INTERVALS) {
                self.db.execute(
                    "UPDATE activity_metrics SET metrics_source = ? WHERE activity_id = ?",
                    params![SOURCE_INTERVALS, id],
                )?;
            }
            return Ok(false);
        }

        // A library that holds intervals.icu shows its numbers and none of ours.
        if !super::curves_local::is_garmin_only(&self.db)? {
            return Ok(false);
        }
        let Some(samples) = samples_of(&self.db, id) else {
            return Ok(false);
        };
        let found = thresholds_for(&self.db, &sport, date);
        let value = |t: Option<super::sport_settings::Sourced>| t.map(|t| t.value);
        let judged = Judged {
            ftp: value(found.ftp),
            threshold_hr: value(found.threshold_hr),
            max_hr: value(found.max_hr),
            resting_hr: value(found.resting_hr),
            threshold_pace: crate::sport::family_of(&sport)
                .contains(&"Run")
                .then(|| value(found.threshold_pace))
                .flatten(),
        };
        let metrics = compute(&samples, &judged);
        if !has_figures(&metrics) {
            return Ok(false);
        }

        self.settle_lap_metrics(id, &samples, &judged)?;

        let scored_value = scored_body(body.clone(), &metrics, judged.ftp);
        if scored_value == body && mark.as_deref() == Some(SOURCE_VELOQ) {
            return Ok(false);
        }
        let scored = scored_value.to_string();
        let row = crate::net::intervals::metrics_from_body(&scored, date, id)?;
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let written = (|| {
            self.db.execute(
                "UPDATE activity_bodies SET raw = ?2, updated_at = strftime('%s', 'now')
                 WHERE activity_id = ?1",
                params![id, scored],
            )?;
            self.write_activity_metrics(&[&row], true)?;
            self.db.execute(
                "UPDATE activity_metrics SET metrics_source = ? WHERE activity_id = ?",
                params![SOURCE_VELOQ, id],
            )?;
            Ok::<_, rusqlite::Error>(())
        })();
        match written {
            Ok(()) => crate::persistence::commit_write_txn(&self.db)?,
            Err(error) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
        self.activity_metrics.insert(id.to_owned(), row);
        self.invalidate_perf_cache();
        Ok(true)
    }

    /// Score the laps of a stored lap body, when the activity has one, with the
    /// same function and thresholds as the ride.
    fn settle_lap_metrics(&self, id: &str, samples: &Samples, judged: &Judged) -> SqlResult<()> {
        let Some(raw) = self.get_interval_body(id)? else {
            return Ok(());
        };
        if let Some(scored) = scored_laps(&raw, samples, judged) {
            self.set_interval_body(id, &scored)?;
        }
        Ok(())
    }

    /// Settle up to `limit` stored source rows that have power or heart rate
    /// streams and either no mark or a Veloq mark with no load, which a
    /// threshold set since may now give. Skips the ids in `attempted`, which gains the
    /// ones tried. Answers how many were tried.
    pub(crate) fn backfill_ride_metrics_page(
        &mut self,
        attempted: &mut HashSet<String>,
        limit: usize,
    ) -> SqlResult<usize> {
        let ids: Vec<String> = self
            .db
            .prepare(&format!(
                "SELECT m.activity_id {OWED_FROM_WHERE} ORDER BY m.date DESC"
            ))?
            .query_map(params![SOURCE_KEY_PREFIX], |row| row.get::<_, String>(0))?
            .collect::<SqlResult<Vec<_>>>()?
            .into_iter()
            .filter(|id| !attempted.contains(id))
            .take(limit)
            .collect();
        for id in &ids {
            attempted.insert(id.clone());
            self.settle_ride_metrics(id)?;
        }
        Ok(ids.len())
    }
}

#[cfg(test)]
#[path = "tests/ride_metrics.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/ride_metrics_store.rs"]
mod store_tests;
