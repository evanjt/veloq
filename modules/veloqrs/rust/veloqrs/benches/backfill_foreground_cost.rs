//! What the elevation backfill and the conditioning detect cost a foreground
//! reader, measured rather than argued.
//!
//! Every screen read goes through the engine's write lock, so a reader does not
//! contend in SQLite, it queues behind the batch that holds the lock. These
//! tests time the holds the backfill takes per batch of 20, the latency a
//! reader sees while a pass drains, the spawn-time hold of a detect, and the
//! stall the main connection takes while the detect worker reads over its own.
//!
//! Baseline only, nothing asserts. Run in release:
//!   cargo test --release --features synthetic --bench backfill_foreground_cost -- --ignored --nocapture

#![cfg(feature = "synthetic")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::synthetic::SyntheticScenario;
use veloqrs::PersistentEngine;

/// The backfill's batch, mirrored from `net/elevation_backfill.rs`.
const BATCH: usize = 20;
/// Long enough for a ride of a few hours at one point a second.
const CORRIDOR_METERS: f64 = 20_000.0;

fn build_engine(
    pool: usize,
) -> (
    PersistentEngine,
    TempDir,
    Vec<(String, Vec<GpsPoint>, String)>,
) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("cost.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
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
    for chunk in rows.chunks(100) {
        engine
            .add_activities_batch(chunk.to_vec())
            .expect("ingest batch");
    }
    (engine, dir, rows)
}

fn elevated(points: &[GpsPoint]) -> Vec<GpsPoint> {
    points
        .iter()
        .enumerate()
        .map(|(i, p)| GpsPoint::with_elevation(p.latitude, p.longitude, 400.0 + (i % 50) as f64))
        .collect()
}

fn median_ms(samples: &mut [f64]) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

fn percentile_us(samples: &mut [u128], q: f64) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    samples.sort_unstable();
    let idx = ((samples.len() as f64 - 1.0) * q).round() as usize;
    samples[idx.min(samples.len() - 1)]
}

/// One splice batch as `splice_batch` runs it: twenty row rewrites under one hold.
fn splice_hold(engine: &PersistentEngine, batch: &[(String, Vec<GpsPoint>, String)]) -> f64 {
    let t0 = Instant::now();
    for (id, points, _) in batch {
        let alts: Vec<f64> = points
            .iter()
            .enumerate()
            .map(|(i, _)| 400.0 + (i % 50) as f64)
            .collect();
        engine.splice_track_elevation(id, &alts).expect("splice");
    }
    t0.elapsed().as_secs_f64() * 1000.0
}

/// One store batch as `store_batch` runs it: a re-ingest of twenty elevated
/// tracks, which ends in the spatial index rebuild, then the provenance stamp.
fn store_hold(engine: &mut PersistentEngine, batch: &[(String, Vec<GpsPoint>, String)]) -> f64 {
    let rows: Vec<(String, Vec<GpsPoint>, String)> = batch
        .iter()
        .map(|(id, points, sport)| (id.clone(), elevated(points), sport.clone()))
        .collect();
    let states: Vec<(String, u8)> = batch.iter().map(|(id, _, _)| (id.clone(), 1u8)).collect();
    let t0 = Instant::now();
    engine.add_activities_batch(rows).expect("store");
    engine.record_elevation_state(&states).expect("provenance");
    t0.elapsed().as_secs_f64() * 1000.0
}

#[test]
#[ignore]
fn hold_per_batch_at_two_pool_sizes() {
    for pool in [400usize, 1200] {
        let (mut engine, _dir, rows) = build_engine(pool);
        let points_per_track = rows[0].1.len();
        let batches: Vec<&[(String, Vec<GpsPoint>, String)]> = rows.chunks(BATCH).take(5).collect();

        let mut splice: Vec<f64> = batches.iter().map(|b| splice_hold(&engine, b)).collect();
        let mut store: Vec<f64> = batches.iter().map(|b| store_hold(&mut engine, b)).collect();
        let mut single: Vec<f64> = batches
            .iter()
            .map(|b| store_hold(&mut engine, &b[..1]))
            .collect();

        let t0 = Instant::now();
        let handle = engine.detect_sections_background();
        let spawn_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (sections, _) = handle.recv().unwrap_or_default();
        let detect_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let t1 = Instant::now();
        engine.apply_sections(sections).expect("apply");
        let apply_ms = t1.elapsed().as_secs_f64() * 1000.0;

        println!(
            "[cost] pool={} points/track={} splice20={:.1}ms store20={:.1}ms store1={:.1}ms detect_spawn={:.1}ms detect_total={:.0}ms apply={:.0}ms",
            pool,
            points_per_track,
            median_ms(&mut splice),
            median_ms(&mut store),
            median_ms(&mut single),
            spawn_ms,
            detect_ms,
            apply_ms
        );
    }
}

fn reader_latency(pool: usize, readers_take_write: bool) {
    let (engine, _dir, rows) = build_engine(pool);
    let engine = Arc::new(RwLock::new(engine));
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
            let mut out = Vec::with_capacity(200_000);
            while !stop.load(Ordering::Relaxed) {
                let t0 = Instant::now();
                let n = if readers_take_write {
                    let g = engine.write().unwrap();
                    g.get_sections().len() + g.get_activity_ids().len()
                } else {
                    let g = engine.read().unwrap();
                    g.get_sections().len() + g.get_activity_ids().len()
                };
                out.push(t0.elapsed().as_micros());
                std::hint::black_box(n);
                // A screen polls, it does not spin.
                thread::sleep(Duration::from_millis(16));
            }
            out
        }));
    }

    let writer_engine = Arc::clone(&engine);
    let writer_barrier = Arc::clone(&barrier);
    let writer = thread::spawn(move || -> (Duration, usize) {
        writer_barrier.wait();
        let t0 = Instant::now();
        let mut batches = 0;
        for batch in rows.chunks(BATCH) {
            {
                let g = writer_engine.write().unwrap();
                splice_hold(&g, batch);
            }
            {
                let mut g = writer_engine.write().unwrap();
                store_hold(&mut g, batch);
            }
            batches += 1;
        }
        (t0.elapsed(), batches)
    });

    barrier.wait();
    let (pass, batches) = writer.join().unwrap();
    stop.store(true, Ordering::Relaxed);
    let mut samples: Vec<u128> = handles
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect();
    let n = samples.len();
    println!(
        "[cost] pool={} readers_on={} pass={:.1}s batches={} reader_samples={} p50={}us p95={}us p99={}us max={}us",
        pool,
        if readers_take_write { "write" } else { "read" },
        pass.as_secs_f64(),
        batches,
        n,
        percentile_us(&mut samples, 0.50),
        percentile_us(&mut samples, 0.95),
        percentile_us(&mut samples, 0.99),
        samples.last().copied().unwrap_or(0)
    );
}

#[test]
#[ignore]
fn reader_latency_under_a_draining_pass() {
    reader_latency(400, true);
    reader_latency(400, false);
    reader_latency(1200, true);
}

/// The detect worker reads every track over its own connection while the main
/// connection keeps writing. With the journal in rollback mode a reader's
/// shared lock blocks the writer's commit, and `busy_timeout` is the only
/// thing that turns that into a wait rather than an error.
#[test]
#[ignore]
fn main_connection_stall_while_the_worker_loads() {
    let (mut engine, _dir, rows) = build_engine(1200);
    let mut quiet: Vec<f64> = rows
        .chunks(BATCH)
        .take(5)
        .map(|b| splice_hold(&engine, b))
        .collect();
    let quiet_ms = median_ms(&mut quiet);

    let handle = engine.detect_sections_background();
    let mut during: Vec<f64> = Vec::new();
    let t0 = Instant::now();
    for batch in rows.chunks(BATCH) {
        during.push(splice_hold(&engine, batch));
        if handle.get_progress().0 != "loading" && t0.elapsed() > Duration::from_secs(2) {
            break;
        }
    }
    let phase_at_end = handle.get_progress().0;
    let max = during.iter().cloned().fold(0.0_f64, f64::max);
    let over_1s = during.iter().filter(|d| **d > 1000.0).count();
    println!(
        "[cost] quiet_splice20={:.1}ms during_worker: batches={} median={:.1}ms max={:.1}ms over_1s={} worker_phase_at_end={}",
        quiet_ms,
        during.len(),
        median_ms(&mut during),
        max,
        over_1s,
        phase_at_end
    );
    let _ = handle.recv();
}
