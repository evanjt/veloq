//! Concurrency safety net for the engine under the FFI lock discipline:
//! mutations + SQLite access take the write lock, in-memory reads take the read
//! lock (mirrors `with_engine` / `with_engine_read`). These guard the off-lock
//! tile invalidation (`add_activities_batch`) and the settings path against
//! deadlock, starvation, and lost updates under load.
//!
//! No `synthetic` feature: activities are built from plain `GpsPoint`s so the
//! test runs in the default `cargo test` set.

use std::sync::{Arc, Barrier, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

fn fresh_engine() -> (Arc<RwLock<PersistentRouteEngine>>, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("io_safety.db");
    let engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    (Arc::new(RwLock::new(engine)), dir)
}

fn track(seed: f64) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(42.5 + seed + i as f64 * 1e-4, 1.4 + i as f64 * 1e-4))
        .collect()
}

#[test]
fn concurrent_reads_during_writes_make_progress() {
    let (engine, _dir) = fresh_engine();
    const WRITES: usize = 30;
    let barrier = Arc::new(Barrier::new(5)); // 1 writer + 4 readers
    let mut handles = vec![];

    {
        let engine = Arc::clone(&engine);
        let barrier = Arc::clone(&barrier);
        handles.push(thread::spawn(move || {
            barrier.wait();
            for i in 0..WRITES {
                let mut g = engine.write().unwrap_or_else(|e| e.into_inner());
                g.add_activity(format!("w{i}"), track(i as f64 * 0.01), "Ride".to_string())
                    .expect("add_activity");
            }
        }));
    }

    let worst = Arc::new(Mutex::new(Duration::ZERO));
    for _ in 0..4 {
        let engine = Arc::clone(&engine);
        let barrier = Arc::clone(&barrier);
        let worst = Arc::clone(&worst);
        handles.push(thread::spawn(move || {
            barrier.wait();
            for _ in 0..300 {
                let t = Instant::now();
                {
                    // In-memory read under the read lock (safe per the SQLite
                    // invariant — no `self.db` access here).
                    let g = engine.read().unwrap_or_else(|e| e.into_inner());
                    let _ = g.activity_count();
                }
                let dt = t.elapsed();
                let mut m = worst.lock().unwrap_or_else(|e| e.into_inner());
                if dt > *m {
                    *m = dt;
                }
            }
        }));
    }

    for h in handles {
        h.join().expect("thread join");
    }

    // Every write landed (no lost updates, no deadlock).
    let count = engine
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .activity_count();
    assert_eq!(count, WRITES);

    // With tile I/O moved off the write lock, readers are never starved for
    // long. Generous bound — this asserts "no convoy", not a tight latency SLA.
    let worst = *worst.lock().unwrap_or_else(|e| e.into_inner());
    assert!(
        worst < Duration::from_secs(5),
        "reader starved for {worst:?} — possible lock convoy"
    );
}

#[test]
fn settings_under_concurrent_mutation_stay_consistent() {
    let (engine, _dir) = fresh_engine();
    const THREADS: usize = 8;
    const ITERS: usize = 40;
    let barrier = Arc::new(Barrier::new(THREADS));
    let mut handles = vec![];

    for t in 0..THREADS {
        let engine = Arc::clone(&engine);
        let barrier = Arc::clone(&barrier);
        handles.push(thread::spawn(move || {
            barrier.wait();
            let key = format!("k{t}");
            for v in 0..ITERS {
                let val = format!("{v}");
                // Both set and get touch SQLite, so both take the write lock
                // (exclusive), matching the engine's db-access discipline.
                {
                    let g = engine.write().unwrap_or_else(|e| e.into_inner());
                    g.set_setting(&key, &val).expect("set_setting");
                }
                let got = {
                    let g = engine.write().unwrap_or_else(|e| e.into_inner());
                    g.get_setting(&key).expect("get_setting")
                };
                // No other thread writes *our* key, so we read back our own
                // last write every time — no torn reads, no cross-key bleed.
                assert_eq!(got.as_deref(), Some(val.as_str()));
            }
        }));
    }

    for h in handles {
        h.join().expect("thread join");
    }

    // Final values are each thread's last iteration.
    let g = engine.write().unwrap_or_else(|e| e.into_inner());
    for t in 0..THREADS {
        assert_eq!(
            g.get_setting(&format!("k{t}")).unwrap().as_deref(),
            Some((ITERS - 1).to_string().as_str())
        );
    }
}
