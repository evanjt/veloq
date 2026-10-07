//! Whether a step-wise online copy of a WAL database finishes while another
//! connection keeps committing.
//!
//! Builds a WAL library of a given size, then copies it from a connection of
//! its own, as the clear snapshot does, while a writer on a second connection
//! commits one small row every `interval` milliseconds. A write from any
//! connection other than the copy's own restarts a step-wise copy, so the copy
//! only finishes when one whole pass fits between two commits.
//!
//! Usage: snapshot-copy-starvation <dir> [pages] [cap_seconds]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::backup::{Backup, StepResult};
use rusqlite::Connection;

const PAGE_SIZE: usize = 4096;
const PAUSE: Duration = Duration::from_millis(10);

fn open_writer(path: &Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.busy_timeout(Duration::from_secs(5)).unwrap();
    db.pragma_update(None, "synchronous", "NORMAL").unwrap();
    db
}

fn build_library(path: &Path, pages: usize) {
    let _ = std::fs::remove_file(path);
    let db = Connection::open(path).unwrap();
    let mode: String = db
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    db.execute_batch(
        "CREATE TABLE tracks(id INTEGER PRIMARY KEY, body BLOB);
         CREATE TABLE checkpoints(id INTEGER PRIMARY KEY, body BLOB);",
    )
    .unwrap();
    // One row of just under a page keeps the page count close to the row count.
    let body = vec![7u8; PAGE_SIZE - 200];
    let tx = db.unchecked_transaction().unwrap();
    for i in 0..pages {
        tx.execute("INSERT INTO tracks(id, body) VALUES (?1, ?2)", (i as i64, &body))
            .unwrap();
    }
    tx.commit().unwrap();
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
}

struct Run {
    finished: bool,
    seconds: f64,
    steps: u64,
    restarts: u64,
    commits: u64,
    worst_commit_ms: f64,
    rows: i64,
}

fn copy_once(source_path: &Path, dest_path: &Path, pages_per_step: i32, interval: Option<Duration>, cap: Duration) -> Run {
    let _ = std::fs::remove_file(dest_path);
    let stop = Arc::new(AtomicBool::new(false));
    let commits = Arc::new(AtomicU64::new(0));
    let worst_us = Arc::new(AtomicU64::new(0));
    let writer = interval.map(|every| {
        let (stop, commits, worst_us) = (stop.clone(), commits.clone(), worst_us.clone());
        let path = source_path.to_path_buf();
        std::thread::spawn(move || {
            let db = open_writer(&path);
            // About the size of a detection checkpoint for a small library.
            let body = vec![3u8; 5_000];
            let mut next = Instant::now() + every;
            while !stop.load(Ordering::Relaxed) {
                let now = Instant::now();
                if now < next {
                    std::thread::sleep((next - now).min(Duration::from_millis(5)));
                    continue;
                }
                let started = Instant::now();
                db.execute("INSERT OR REPLACE INTO checkpoints(id, body) VALUES (1, ?1)", [&body])
                    .unwrap();
                let us = started.elapsed().as_micros() as u64;
                worst_us.fetch_max(us, Ordering::Relaxed);
                commits.fetch_add(1, Ordering::Relaxed);
                next += every;
            }
        })
    });

    let source = Connection::open(source_path).unwrap();
    source.busy_timeout(Duration::from_secs(5)).unwrap();
    let mut dest = Connection::open(dest_path).unwrap();
    let started = Instant::now();
    let (mut steps, mut restarts, mut last_remaining, mut finished) = (0u64, 0u64, i32::MAX, false);
    {
        let copy = Backup::new(&source, &mut dest).unwrap();
        while started.elapsed() < cap {
            let result = copy.step(pages_per_step).unwrap();
            steps += 1;
            let remaining = copy.progress().remaining;
            if remaining > last_remaining {
                restarts += 1;
            }
            last_remaining = remaining;
            match result {
                StepResult::Done => {
                    finished = true;
                    break;
                }
                StepResult::More => std::thread::sleep(PAUSE),
                StepResult::Busy | StepResult::Locked => std::thread::sleep(PAUSE),
                _ => std::thread::sleep(PAUSE),
            }
        }
    }
    let seconds = started.elapsed().as_secs_f64();
    stop.store(true, Ordering::Relaxed);
    if let Some(w) = writer {
        w.join().unwrap();
    }
    let rows = if finished {
        dest.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0)).unwrap()
    } else {
        -1
    };
    Run {
        finished,
        seconds,
        steps,
        restarts,
        commits: commits.load(Ordering::Relaxed),
        worst_commit_ms: worst_us.load(Ordering::Relaxed) as f64 / 1000.0,
        rows,
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("a scratch directory"));
    let pages: usize = args.next().map(|s| s.parse().unwrap()).unwrap_or(11_200);
    let cap = Duration::from_secs(args.next().map(|s| s.parse().unwrap()).unwrap_or(30));
    std::fs::create_dir_all(&dir).unwrap();
    let source = dir.join("library.db");
    let dest = dir.join("library.db.snapshot");
    build_library(&source, pages);
    let size = std::fs::metadata(&source).unwrap().len();
    let sqlite: String = Connection::open_in_memory()
        .unwrap()
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .unwrap();
    println!("sqlite {sqlite}, library {:.1} MB, {} rows, cap {} s", size as f64 / 1e6, pages, cap.as_secs());
    println!("step  interval_ms  finished  seconds  steps  restarts  commits  worst_commit_ms  rows");
    let intervals: [Option<u64>; 8] = [None, Some(5000), Some(2000), Some(1500), Some(1000), Some(500), Some(100), Some(10)];
    for pages_per_step in [100, -1] {
        for interval in intervals {
            let run = copy_once(&source, &dest, pages_per_step, interval.map(Duration::from_millis), cap);
            println!(
                "{:>4}  {:>11}  {:>8}  {:>7.3}  {:>5}  {:>8}  {:>7}  {:>15.2}  {:>4}",
                pages_per_step,
                interval.map_or("none".to_string(), |i| i.to_string()),
                run.finished,
                run.seconds,
                run.steps,
                run.restarts,
                run.commits,
                run.worst_commit_ms,
                run.rows
            );
        }
    }
}
