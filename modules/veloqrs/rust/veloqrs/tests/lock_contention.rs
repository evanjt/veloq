//! Lock-contention baseline.
//!
//! Today's `apply_sections` holds the engine write lock through
//! `save_sections` + `merge_cross_sport_sections` +
//! `recompute_activity_indicators`. While that's running, every UI-side
//! read FFI call blocks behind it. This test measures **how long readers
//! wait** under that contention, baseline-only — Tier 1.1 will split the
//! lock, after which this test's recorded p99 should drop dramatically.
//!
//! Methodology:
//! 1. Build scenario-B state (150 activities) on a fresh engine.
//! 2. Spawn one writer thread that acquires the write lock and runs
//!    `apply_sections` on the next detection result.
//! 3. Spawn N reader threads that, in a tight loop, acquire the read lock
//!    and call `get_sections` (in-memory read, the cheapest case).
//! 4. Record each reader call's wall-clock latency and report p50/p95/p99/max.
//!
//! Caveat: this test wraps a `PersistentRouteEngine` in
//! `Arc<RwLock<PersistentRouteEngine>>` directly rather than going through
//! the global `PERSISTENT_ENGINE` singleton — the lock primitive is
//! identical, so the contention semantics are too. Going through the FFI
//! init path would require process-global state setup that doesn't compose
//! with `cargo test`'s parallel-test default.

#![cfg(feature = "synthetic")]

use std::sync::{Arc, Barrier, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn build_scenario_b_engine() -> (Arc<RwLock<PersistentRouteEngine>>, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("contention.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");

    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    for activity in corpus.through_b() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }

    // Run an initial detection so the engine has sections to read.
    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("initial apply");

    (Arc::new(RwLock::new(engine)), dir)
}

fn percentile_us(samples: &mut Vec<u128>, q: f64) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    samples.sort_unstable();
    let idx = ((samples.len() as f64 - 1.0) * q).round() as usize;
    samples[idx.min(samples.len() - 1)]
}

#[test]
#[ignore] // ~30s; Tier 1.1 baseline
fn lock_contention_baseline() {
    let (engine_arc, _tmp) = build_scenario_b_engine();

    // Force the writer to do real work: ingest scenario E's delta (~400
    // activities) so the queued detection result genuinely differs from
    // the current state and apply_sections has rows to insert/merge/index.
    {
        let mut engine = engine_arc.write().expect("write for ingest");
        let cfg = LifecycleConfig::default();
        let corpus = LifecycleCorpus::generate(&cfg);
        for activity in corpus.bucket_e_delta.iter().take(120) {
            engine
                .add_activity(
                    activity.id.clone(),
                    activity.gps_points.clone(),
                    activity.sport_type.clone(),
                )
                .expect("add_activity");
            engine
                .update_activity_metadata(
                    &activity.id,
                    Some(activity.start_date_unix),
                    None,
                    None,
                    None,
                )
                .expect("update_activity_metadata");
        }
    }

    // Pre-compute the next detection result OUTSIDE the contention window
    // so the writer's measured time is `apply_sections` only, not detection.
    let next_sections = {
        let mut engine = engine_arc.write().expect("write for detect");
        let handle = engine.detect_sections_background(None);
        handle.recv().unwrap_or_default().0
    };
    println!(
        "[lock_contention] queued {} sections for the writer's apply_sections",
        next_sections.len()
    );

    const READER_THREADS: usize = 4;
    const READER_WALL_CLOCK: Duration = Duration::from_secs(3);

    let barrier = Arc::new(Barrier::new(READER_THREADS + 2)); // readers + writer + this
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Spawn readers
    let mut reader_handles = Vec::with_capacity(READER_THREADS);
    for tid in 0..READER_THREADS {
        let engine = Arc::clone(&engine_arc);
        let b = Arc::clone(&barrier);
        let stop = Arc::clone(&stop_flag);
        reader_handles.push(thread::spawn(move || -> Vec<u128> {
            b.wait();
            let mut latencies_us: Vec<u128> = Vec::with_capacity(8_000);
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                let t0 = Instant::now();
                let n = {
                    let guard = engine.read().expect("read");
                    guard.get_sections().len()
                };
                let dt = t0.elapsed().as_micros();
                latencies_us.push(dt);
                if latencies_us.len() == latencies_us.capacity() {
                    // Avoid unbounded growth on long runs.
                    break;
                }
                // Tiny yield to avoid pure spin; still aggressively contends.
                std::hint::spin_loop();
                let _ = n;
            }
            latencies_us
        }));
        let _ = tid;
    }

    // Spawn writer
    let writer_engine = Arc::clone(&engine_arc);
    let writer_barrier = Arc::clone(&barrier);
    let writer_handle = thread::spawn(move || -> Duration {
        writer_barrier.wait();
        // Slight sleep so readers warm up first and we measure
        // contention, not cold-start.
        thread::sleep(Duration::from_millis(50));
        let t0 = Instant::now();
        let mut guard = writer_engine.write().expect("write");
        guard
            .apply_sections(next_sections)
            .expect("apply_sections in contention test");
        t0.elapsed()
    });

    barrier.wait();
    thread::sleep(READER_WALL_CLOCK);
    stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);

    let writer_dt = writer_handle.join().expect("writer thread");
    let mut all_reader_samples: Vec<u128> = Vec::new();
    for h in reader_handles {
        let samples = h.join().expect("reader thread");
        all_reader_samples.extend(samples);
    }

    let mut sorted = all_reader_samples.clone();
    let p50 = percentile_us(&mut sorted, 0.50);
    let p95 = percentile_us(&mut sorted, 0.95);
    let p99 = percentile_us(&mut sorted, 0.99);
    let max = *sorted.last().unwrap_or(&0);
    let total = all_reader_samples.len();

    println!("[lock_contention] writer apply_sections wall-clock: {:?}", writer_dt);
    println!(
        "[lock_contention] reader latencies ({} samples across {} threads): p50={}us p95={}us p99={}us max={}us",
        total, READER_THREADS, p50, p95, p99, max,
    );

    // Baseline-only: don't fail on absolute numbers, just record. After
    // Tier 1.1 splits the apply lock, p99 should be < 50ms (50_000us).
    // The current expectation: p99 will be roughly equal to writer_dt
    // because every reader that arrives during the write blocks for the
    // full write duration.
}
