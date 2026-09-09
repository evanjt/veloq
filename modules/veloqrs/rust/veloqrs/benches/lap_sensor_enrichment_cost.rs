//! What slicing the stored sensor series over every lap would cost the
//! foreground, measured rather than argued.
//!
//! The lap_time backfill already walks every `section_activities` row whose
//! clock is NULL, decodes each activity's time stream once and issues one
//! UPDATE per lap under the engine write lock. These tests time that pass as
//! it is written today, then the same pass carrying heartrate, watts and
//! cadence from `activity_streams` into four proposed columns, so the added
//! cost is the difference between the two.
//!
//! Both passes run over a second connection to the engine's own file with
//! the same statements the engine would use, held under the engine write lock
//! so a reader queues exactly as it would in production.
//!
//! Baseline only, nothing asserts. Run in release:
//!   cargo test --release --features synthetic --bench lap_sensor_enrichment_cost -- --ignored --nocapture --test-threads=1

#![cfg(feature = "synthetic")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::synthetic::SyntheticScenario;
use veloqrs::PersistentEngine;
use veloqrs::net::types::StreamDto;
use veloqrs::persistence::codec;

/// Long enough for a ride of a few hours at one point a second.
const CORRIDOR_METERS: f64 = 20_000.0;
/// Normalised power's rolling window, in seconds.
const NP_WINDOW_SECS: u32 = 30;

struct Built {
    engine: PersistentEngine,
    path: String,
    _dir: TempDir,
    activity_ids: Vec<String>,
    points_per_track: usize,
}

fn build_engine(pool: usize) -> Built {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("cost.db");
    let path = path.to_str().unwrap().to_string();
    let mut engine = PersistentEngine::new(&path).expect("open engine");
    let dataset = SyntheticScenario::with_activity_count(pool, CORRIDOR_METERS, 0.8).generate();
    let rows: Vec<(String, Vec<GpsPoint>, String)> = dataset
        .tracks
        .into_iter()
        .map(|(id, points)| {
            let sport = dataset
                .sport_types
                .get(&id)
                .cloned()
                .unwrap_or_else(|| "Ride".to_string());
            (id, points, sport)
        })
        .collect();
    let points_per_track = rows[0].1.len();
    for chunk in rows.chunks(100) {
        engine
            .add_activities_batch(chunk.to_vec())
            .expect("ingest batch");
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply");
    engine.set_stream_retention_days(0).expect("retention");

    let activity_ids: Vec<String> = rows.iter().map(|(id, _, _)| id.clone()).collect();
    Built {
        engine,
        path,
        _dir: dir,
        activity_ids,
        points_per_track,
    }
}

/// One-hertz time streams and three sensor series per activity, in the
/// track's index space. Watts carry a gap every seventh sample so the mixed
/// presence mode of the codec is exercised rather than the dense one.
fn store_streams(built: &mut Built) {
    let n = built.points_per_track;
    let mut all_times: Vec<u32> = Vec::with_capacity(n * built.activity_ids.len());
    let mut offsets: Vec<u32> = Vec::with_capacity(built.activity_ids.len());
    for _ in &built.activity_ids {
        offsets.push(all_times.len() as u32);
        all_times.extend(0..n as u32);
    }
    built
        .engine
        .set_time_streams_flat(&built.activity_ids, &all_times, &offsets);

    for (k, id) in built.activity_ids.iter().enumerate() {
        let phase = k as f64 * 0.37;
        let heartrate: Vec<Option<f64>> = (0..n)
            .map(|i| Some((145.0 + 20.0 * ((i as f64) / 300.0 + phase).sin()).round()))
            .collect();
        let watts: Vec<Option<f64>> = (0..n)
            .map(|i| {
                (i % 7 != 3).then(|| (220.0 + 60.0 * ((i as f64) / 45.0 + phase).sin()).round())
            })
            .collect();
        let cadence: Vec<Option<f64>> = (0..n)
            .map(|i| Some((88.0 + 5.0 * ((i as f64) / 90.0 + phase).cos()).round()))
            .collect();
        let series = [
            StreamDto {
                kind: "heartrate".to_string(),
                data: heartrate,
                data2: None,
            },
            StreamDto {
                kind: "watts".to_string(),
                data: watts,
                data2: None,
            },
            StreamDto {
                kind: "cadence".to_string(),
                data: cadence,
                data2: None,
            },
        ];
        built
            .engine
            .store_activity_streams(id, &series)
            .expect("store streams");
    }
}

/// The columns the proposal adds, on the harness's own copy of the schema.
fn add_proposed_columns(conn: &Connection) {
    for ddl in [
        "ALTER TABLE section_activities ADD COLUMN avg_power REAL",
        "ALTER TABLE section_activities ADD COLUMN normalised_power REAL",
        "ALTER TABLE section_activities ADD COLUMN avg_cadence REAL",
        "ALTER TABLE section_activities ADD COLUMN ftp_watts INTEGER",
        "ALTER TABLE section_activities ADD COLUMN weight_kg REAL",
    ] {
        conn.execute(ddl, []).expect(ddl);
    }
}

fn reset_laps(conn: &Connection) {
    conn.execute(
        "UPDATE section_activities SET lap_time = NULL, lap_pace = NULL, avg_hr = NULL,
            avg_power = NULL, normalised_power = NULL, avg_cadence = NULL,
            ftp_watts = NULL, weight_kg = NULL",
        [],
    )
    .expect("reset");
}

type NullLap = (String, String, u32, u32, f64);

fn null_laps(conn: &Connection) -> Vec<NullLap> {
    conn.prepare(
        "SELECT sa.section_id, sa.activity_id, sa.start_index, sa.end_index, sa.distance_meters
         FROM section_activities sa
         WHERE sa.lap_time IS NULL
           AND sa.start_index > 0
           AND sa.end_index > sa.start_index",
    )
    .unwrap()
    .query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
        ))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn load_times(conn: &Connection, ids: &[&String]) -> HashMap<String, Vec<u32>> {
    let mut out = HashMap::new();
    for id in ids {
        if let Ok(times) = conn.query_row(
            "SELECT times FROM time_streams WHERE activity_id = ?",
            [id],
            |row| {
                let bytes: Vec<u8> = row.get(0)?;
                codec::deserialize::<Vec<u32>>(&bytes).map_err(|_| rusqlite::Error::InvalidQuery)
            },
        ) {
            out.insert((*id).clone(), times);
        }
    }
    out
}

struct Sensors {
    heartrate: Option<Vec<Option<f64>>>,
    watts: Option<Vec<Option<f64>>>,
    cadence: Option<Vec<Option<f64>>>,
}

fn load_sensors(conn: &Connection, ids: &[&String]) -> (HashMap<String, Sensors>, Duration) {
    let mut decode = Duration::ZERO;
    let mut out = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT kind, data FROM activity_streams
             WHERE activity_id = ? AND kind IN ('heartrate', 'watts', 'cadence')",
        )
        .unwrap();
    for id in ids {
        let mut s = Sensors {
            heartrate: None,
            watts: None,
            cadence: None,
        };
        let rows: Vec<(String, Vec<u8>)> = stmt
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        for (kind, blob) in rows {
            let t0 = Instant::now();
            let series = codec::decode_series(&blob);
            decode += t0.elapsed();
            match kind.as_str() {
                "heartrate" => s.heartrate = series,
                "watts" => s.watts = series,
                "cadence" => s.cadence = series,
                _ => {}
            }
        }
        out.insert((*id).clone(), s);
    }
    (out, decode)
}

fn mean_over(series: Option<&Vec<Option<f64>>>, start: usize, end: usize) -> Option<f64> {
    let s = series?;
    if end >= s.len() {
        return None;
    }
    let mut sum = 0.0;
    let mut n = 0usize;
    for v in s[start..=end].iter().flatten() {
        sum += v;
        n += 1;
    }
    (n > 0).then(|| sum / n as f64)
}

/// Normalised power over a lap: the fourth root of the mean fourth power of
/// a thirty-second rolling mean, windows bounded by the time stream.
fn normalised_power(
    watts: Option<&Vec<Option<f64>>>,
    times: &[u32],
    start: usize,
    end: usize,
) -> Option<f64> {
    let w = watts?;
    if end >= w.len() || end >= times.len() {
        return None;
    }
    let mut fourth_sum = 0.0;
    let mut windows = 0usize;
    let mut lo = start;
    for hi in start..=end {
        while times[hi] - times[lo] > NP_WINDOW_SECS {
            lo += 1;
        }
        if times[hi] - times[start] < NP_WINDOW_SECS {
            continue;
        }
        let mut sum = 0.0;
        let mut n = 0usize;
        for v in w[lo..=hi].iter().flatten() {
            sum += v;
            n += 1;
        }
        if n == 0 {
            continue;
        }
        let mean = sum / n as f64;
        fourth_sum += mean.powi(4);
        windows += 1;
    }
    (windows > 0).then(|| (fourth_sum / windows as f64).powf(0.25))
}

/// The FTP and weight in force on a date: the newest row at or before it.
fn context_for(conn: &Connection, date: i64) -> (Option<i64>, Option<f64>) {
    let ftp = conn
        .query_row(
            "SELECT ftp FROM ftp_history WHERE date <= ? ORDER BY date DESC LIMIT 1",
            [date],
            |r| r.get::<_, i64>(0),
        )
        .ok();
    let weight = conn
        .query_row(
            "SELECT weight FROM wellness WHERE date <= date(?, 'unixepoch') AND weight IS NOT NULL
             ORDER BY date DESC LIMIT 1",
            [date],
            |r| r.get::<_, f64>(0),
        )
        .ok();
    (ftp, weight)
}

struct PassCost {
    laps: usize,
    updated: usize,
    total: Duration,
    decode: Duration,
}

/// The lap_time backfill as `backfill_null_lap_times` runs it: one time
/// stream decode per activity, one autocommitted UPDATE per lap.
fn clock_pass(conn: &Connection, in_transaction: bool) -> PassCost {
    let t0 = Instant::now();
    let laps = null_laps(conn);
    let ids: Vec<&String> = {
        let mut v: Vec<&String> = laps.iter().map(|l| &l.1).collect();
        v.sort();
        v.dedup();
        v
    };
    let d0 = Instant::now();
    let times = load_times(conn, &ids);
    let decode = d0.elapsed();
    if in_transaction {
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    }
    let mut stmt = conn
        .prepare(
            "UPDATE section_activities SET lap_time = ?, lap_pace = ?
             WHERE section_id = ? AND activity_id = ? AND start_index = ?",
        )
        .unwrap();
    let mut updated = 0usize;
    for (sid, aid, si, ei, dist) in &laps {
        let Some(t) = times.get(aid) else { continue };
        let (si, ei) = (*si as usize, *ei as usize);
        if si >= t.len() || ei >= t.len() {
            continue;
        }
        let lap_time = (t[ei] as f64 - t[si] as f64).abs();
        if lap_time <= 0.0 {
            continue;
        }
        stmt.execute(params![lap_time, dist / lap_time, sid, aid, si as u32])
            .unwrap();
        updated += 1;
    }
    if in_transaction {
        conn.execute_batch("COMMIT").unwrap();
    }
    PassCost {
        laps: laps.len(),
        updated,
        total: t0.elapsed(),
        decode,
    }
}

/// The same pass carrying the sensors: three more decodes per activity, a
/// slice per lap, normalised power over the watts, the FTP and weight in
/// force, and one wider UPDATE per lap.
fn sensor_pass(conn: &Connection, in_transaction: bool) -> PassCost {
    let t0 = Instant::now();
    let laps = null_laps(conn);
    let ids: Vec<&String> = {
        let mut v: Vec<&String> = laps.iter().map(|l| &l.1).collect();
        v.sort();
        v.dedup();
        v
    };
    let d0 = Instant::now();
    let times = load_times(conn, &ids);
    let mut decode = d0.elapsed();
    let (sensors, sensor_decode) = load_sensors(conn, &ids);
    decode += sensor_decode;
    let mut context: HashMap<&String, (Option<i64>, Option<f64>)> = HashMap::new();
    for id in &ids {
        context.insert(id, context_for(conn, 1_780_000_000));
    }
    if in_transaction {
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    }
    let mut stmt = conn
        .prepare(
            "UPDATE section_activities
             SET lap_time = ?, lap_pace = ?, avg_hr = ?, avg_power = ?, normalised_power = ?,
                 avg_cadence = ?, ftp_watts = ?, weight_kg = ?
             WHERE section_id = ? AND activity_id = ? AND start_index = ?",
        )
        .unwrap();
    let mut updated = 0usize;
    for (sid, aid, si, ei, dist) in &laps {
        let Some(t) = times.get(aid) else { continue };
        let (si, ei) = (*si as usize, *ei as usize);
        if si >= t.len() || ei >= t.len() {
            continue;
        }
        let lap_time = (t[ei] as f64 - t[si] as f64).abs();
        if lap_time <= 0.0 {
            continue;
        }
        let s = sensors.get(aid);
        let avg_hr = mean_over(s.and_then(|s| s.heartrate.as_ref()), si, ei);
        let avg_power = mean_over(s.and_then(|s| s.watts.as_ref()), si, ei);
        let np = normalised_power(s.and_then(|s| s.watts.as_ref()), t, si, ei);
        let avg_cadence = mean_over(s.and_then(|s| s.cadence.as_ref()), si, ei);
        let (ftp, weight) = context.get(aid).copied().unwrap_or((None, None));
        stmt.execute(params![
            lap_time,
            dist / lap_time,
            avg_hr,
            avg_power,
            np,
            avg_cadence,
            ftp,
            weight,
            sid,
            aid,
            si as u32
        ])
        .unwrap();
        updated += 1;
    }
    if in_transaction {
        conn.execute_batch("COMMIT").unwrap();
    }
    PassCost {
        laps: laps.len(),
        updated,
        total: t0.elapsed(),
        decode,
    }
}

fn open_second(path: &str) -> Connection {
    let conn = Connection::open(path).expect("second connection");
    conn.busy_timeout(Duration::from_secs(5)).unwrap();
    conn
}

fn report(label: &str, pool: usize, points: usize, c: &PassCost) {
    let per_lap_us = c.total.as_secs_f64() * 1e6 / c.updated.max(1) as f64;
    println!(
        "[laps] pool={} points/track={} pass={} laps={} updated={} total={:.1}ms decode={:.1}ms per_lap={:.0}us",
        pool,
        points,
        label,
        c.laps,
        c.updated,
        c.total.as_secs_f64() * 1000.0,
        c.decode.as_secs_f64() * 1000.0,
        per_lap_us
    );
}

#[test]
#[ignore]
fn pass_cost_at_two_pool_sizes() {
    for pool in [400usize, 1200] {
        let mut built = build_engine(pool);
        store_streams(&mut built);
        let conn = open_second(&built.path);
        add_proposed_columns(&conn);
        let stream_bytes: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM activity_streams",
                [],
                |r| r.get(0),
            )
            .unwrap();
        println!(
            "[laps] pool={} activity_streams_bytes={} per_activity={}",
            pool,
            stream_bytes,
            stream_bytes / pool as i64
        );
        for (label, in_tx) in [("clock", false), ("clock_tx", true)] {
            reset_laps(&conn);
            let mut runs: Vec<PassCost> = (0..3)
                .map(|_| {
                    reset_laps(&conn);
                    clock_pass(&conn, in_tx)
                })
                .collect();
            for (i, run) in runs.iter().enumerate() {
                report(&format!("{label}#{i}"), pool, built.points_per_track, run);
            }
            runs.sort_by_key(|c| c.total);
            report(
                &format!("{label}_median"),
                pool,
                built.points_per_track,
                &runs[1],
            );
        }
        for (label, in_tx) in [("sensors", false), ("sensors_tx", true)] {
            let mut runs: Vec<PassCost> = (0..3)
                .map(|_| {
                    reset_laps(&conn);
                    sensor_pass(&conn, in_tx)
                })
                .collect();
            for (i, run) in runs.iter().enumerate() {
                report(&format!("{label}#{i}"), pool, built.points_per_track, run);
            }
            runs.sort_by_key(|c| c.total);
            report(
                &format!("{label}_median"),
                pool,
                built.points_per_track,
                &runs[1],
            );
        }
        let filled: (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(avg_hr), COUNT(normalised_power), COUNT(*) FROM section_activities",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        println!(
            "[laps] pool={} rows={} with_avg_hr={} with_np={}",
            pool, filled.2, filled.0, filled.1
        );
    }
}

/// The sensor pass under the engine write lock, with readers polling
/// `get_sections` on the read lock every sixteen milliseconds as a screen
/// would, so the number is what a reader waits and not only what the writer
/// spends.
#[test]
#[ignore]
fn reader_latency_under_the_sensor_pass() {
    for pool in [400usize, 1200] {
        let mut built = build_engine(pool);
        store_streams(&mut built);
        let path = built.path.clone();
        let conn = open_second(&path);
        add_proposed_columns(&conn);
        reset_laps(&conn);
        let engine = Arc::new(RwLock::new(built.engine));
        const READERS: usize = 2;
        let barrier = Arc::new(Barrier::new(READERS + 2));
        let stop = Arc::new(AtomicBool::new(false));
        let mut handles = Vec::new();
        for _ in 0..READERS {
            let engine = Arc::clone(&engine);
            let b = Arc::clone(&barrier);
            let stop = Arc::clone(&stop);
            handles.push(thread::spawn(move || -> Vec<u128> {
                b.wait();
                let mut out = Vec::with_capacity(10_000);
                while !stop.load(Ordering::Relaxed) {
                    let t0 = Instant::now();
                    let n = {
                        let g = engine.read().unwrap();
                        g.get_sections().len()
                    };
                    out.push(t0.elapsed().as_micros());
                    std::hint::black_box(n);
                    thread::sleep(Duration::from_millis(16));
                }
                out
            }));
        }
        let writer_engine = Arc::clone(&engine);
        let writer_barrier = Arc::clone(&barrier);
        let writer = thread::spawn(move || -> (PassCost, PassCost) {
            writer_barrier.wait();
            thread::sleep(Duration::from_millis(50));
            let cold = {
                let _g = writer_engine.write().unwrap();
                sensor_pass(&conn, true)
            };
            thread::sleep(Duration::from_millis(200));
            reset_laps(&conn);
            let warm = {
                let _g = writer_engine.write().unwrap();
                sensor_pass(&conn, true)
            };
            (cold, warm)
        });
        barrier.wait();
        let (cost, warm) = writer.join().unwrap();
        thread::sleep(Duration::from_millis(100));
        stop.store(true, Ordering::Relaxed);
        let mut samples: Vec<u128> = handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect();
        samples.sort_unstable();
        let pick = |q: f64| samples[((samples.len() - 1) as f64 * q).round() as usize];
        println!(
            "[laps] pool={} cold_hold={:.1}ms cold_decode={:.1}ms warm_hold={:.1}ms warm_decode={:.1}ms updated={} reader_samples={} p50={}us p95={}us p99={}us max={}us",
            pool,
            cost.total.as_secs_f64() * 1000.0,
            cost.decode.as_secs_f64() * 1000.0,
            warm.total.as_secs_f64() * 1000.0,
            warm.decode.as_secs_f64() * 1000.0,
            cost.updated,
            samples.len(),
            pick(0.5),
            pick(0.95),
            pick(0.99),
            samples.last().copied().unwrap_or(0)
        );
    }
}
