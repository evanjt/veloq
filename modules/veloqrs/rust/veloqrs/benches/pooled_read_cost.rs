//! What a screen read costs once it reads SQLite through a read-only
//! connection instead of the in-memory tier.
//!
//! `Q253` decided on 2026-09-14 that screen reads leave the engine lock for a
//! read-only pool, and that a pooled read reads SQLite rather than the memory
//! tier. `I91` timed those reads from memory, so none of its numbers survives
//! the change, and the fallback it would justify (an `arc-swap` snapshot of the
//! tier) is only worth building for a read that misses its budget.
//!
//! Most of each screen read is already SQL on the engine's own connection
//! (`get_period_stats`, `get_section_summaries`, `get_group_summaries`,
//! `get_sections_for_activity`, `get_available_sport_types`), so the pooled
//! cost of a read is what it pays today plus two things this bench measures:
//! the queries that replace its memory-tier lookups, and the hop onto another
//! connection. The memory-tier lookups are:
//!
//! | read | lookup | replacement |
//! |---|---|---|
//! | `activity_count`, `stats`, `map_screen_data` | `activity_metadata.len()` | `count(*) FROM activities` |
//! | `widget_snapshot_data` | `get_activity_ids` then `activity_metrics.get` | the metrics row at the newest date |
//! | `map_screen_data` | `activity_metadata` x `activity_metrics` scan | one join over the date window |
//! | `routes_screen_data` | `activity_metrics.get` per representative | one metrics row by id |
//! | `activity_detail_data` | `get_groups` linear scan | `route_groups` loaded from the file |
//! | `stats` | `groups.len()`, `sections.len()` | two counts |
//!
//! Every read is timed twice: on a quiet file, and while a writer holds an open
//! `BEGIN IMMEDIATE` on its own connection, which is the shape `Q253` was
//! decided on. Under WAL a pooled reader takes the last commit and does not
//! wait, so the two columns should agree; they are both printed because that is
//! the claim being tested rather than assumed.
//!
//! Nothing asserts, it prints a table.
//!
//! On the S22, which is where the numbers belong, because `I91`'s budgets are
//! that handset's frame:
//!
//!     cargo bench -p veloqrs --bench pooled_read_cost --no-run --target aarch64-linux-android
//!     adb push <the binary> /data/local/tmp/
//!     adb shell "cd /data/local/tmp && TMPDIR=/data/local/tmp VELOQ_DEVICE_DB=/data/local/tmp/routes.db ./pooled_read_cost"
//!
//! On a workstation, against a pull off the handset:
//!
//!     adb -s <handset> shell "run-as com.veloq.app.dev cat files/routes.db" > /tmp/routes.db
//!     VELOQ_DEVICE_DB=/tmp/routes.db cargo bench -p veloqrs --bench pooled_read_cost

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use veloqrs::PersistentEngine;

/// Samples per figure. `I91`'s method, so the numbers compare.
const SAMPLES: usize = 7;

/// How long the writer holds its transaction, matching the hold `Q253` was
/// measured under.
const WRITE_HOLD: Duration = Duration::from_millis(200);

fn corpus_source() -> Option<PathBuf> {
    let Ok(p) = std::env::var("VELOQ_DEVICE_DB") else {
        eprintln!("skipped: no VELOQ_DEVICE_DB, so there is no corpus to measure");
        return None;
    };
    let named = PathBuf::from(&p);
    if named.exists() {
        return Some(named);
    }
    eprintln!("skipped: VELOQ_DEVICE_DB={p} does not exist");
    None
}

/// A copy of the corpus, so the athlete's own library is never migrated or
/// written in place.
///
/// The sidecars come with it. The library runs under WAL, so a live pull off
/// the handset is a 27 MB main file beside an 18 MB `-wal`, and copying the
/// main file alone leaves out every commit since the last checkpoint. That
/// reads as a smaller library rather than as a broken copy.
fn corpus() -> Option<(tempfile::TempDir, PathBuf)> {
    let src = corpus_source()?;
    let dir = tempfile::TempDir::new().expect("tempdir");
    let dst = dir.path().join("routes.db");
    std::fs::copy(&src, &dst).expect("copy corpus");
    for suffix in ["-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", src.display()));
        if from.exists() {
            std::fs::copy(&from, dir.path().join(format!("routes.db{suffix}")))
                .expect("copy the sidecar");
        }
    }
    Some((dir, dst))
}

fn median(mut xs: Vec<Duration>) -> Duration {
    xs.sort();
    xs[xs.len() / 2]
}

fn time<T>(f: impl Fn() -> T) -> Duration {
    median(
        (0..SAMPLES)
            .map(|_| {
                let at = Instant::now();
                let out = f();
                let d = at.elapsed();
                std::hint::black_box(out);
                d
            })
            .collect(),
    )
}

/// A pooled reader: read-only, no engine lock, its own connection to the file.
fn reader(path: &std::path::Path) -> Connection {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("open a read-only connection");
    conn.busy_timeout(Duration::from_secs(5)).expect("busy");
    conn
}

/// A writer holding `BEGIN IMMEDIATE` in a loop, so a read issued at any moment
/// lands inside a hold. It writes a settings row rather than anything a read
/// below looks at, which is what `Q253`'s proof did.
fn hold_writer(path: PathBuf, stop: Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let w = Connection::open(&path).expect("open the writer");
        w.busy_timeout(Duration::from_secs(10)).expect("busy");
        while !stop.load(Ordering::Relaxed) {
            w.execute_batch(
                "BEGIN IMMEDIATE;
                 INSERT OR REPLACE INTO settings(key, value) VALUES ('i187', 'held');",
            )
            .expect("take the write lock");
            std::thread::sleep(WRITE_HOLD);
            w.execute_batch("COMMIT").expect("release the write lock");
        }
    })
}

/// The replacements, each named for the lookup it stands in for.
fn replacements(conn: &Connection, newest_id: &str) -> Vec<(&'static str, Duration)> {
    let mut out = Vec::new();

    out.push((
        "activity_metadata.len()",
        time(|| {
            conn.query_row("SELECT count(*) FROM activities", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
        }),
    ));

    out.push((
        "activity_metadata.keys()",
        time(|| {
            let mut stmt = conn.prepare("SELECT id FROM activities").unwrap();
            let ids: Vec<String> = stmt
                .query_map([], |r| r.get(0))
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            ids
        }),
    ));

    // `map_activities_filtered` over the whole library: the widest window the
    // map tab can ask for, which is the case that would cross a frame.
    out.push((
        "map_activities_filtered",
        time(|| {
            let mut stmt = conn
                .prepare(
                    "SELECT a.id, m.name, a.sport_type, m.date, m.distance, m.moving_time,
                            a.min_lat, a.max_lat, a.min_lng, a.max_lng,
                            s.start_point_lat, s.start_point_lng
                     FROM activities a
                     JOIN activity_metrics m ON m.activity_id = a.id
                     LEFT JOIN signatures s ON s.activity_id = a.id
                     WHERE m.date BETWEEN ?1 AND ?2",
                )
                .unwrap();
            let rows: Vec<(String, f64)> = stmt
                .query_map([i64::MIN, i64::MAX], |r| Ok((r.get(0)?, r.get(4)?)))
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            rows
        }),
    ));

    out.push((
        "activity_metrics.get(id)",
        time(|| {
            conn.query_row(
                "SELECT name, date, distance, moving_time FROM activity_metrics
                 WHERE activity_id = ?1",
                [newest_id],
                |r| r.get::<_, String>(0),
            )
            .ok()
        }),
    ));

    out.push((
        "the newest metrics row",
        time(|| {
            conn.query_row(
                "SELECT activity_id, date FROM activity_metrics ORDER BY date DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
        }),
    ));

    out.push((
        "get_groups()",
        time(|| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, representative_id, activity_ids, sport_type,
                            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                            activity_ids_blob
                     FROM route_groups",
                )
                .unwrap();
            let rows: Vec<(String, Option<Vec<u8>>)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(8)?)))
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            rows
        }),
    ));

    out.push((
        "groups.len(), sections.len()",
        time(|| {
            let g: i64 = conn
                .query_row("SELECT count(*) FROM route_groups", [], |r| r.get(0))
                .unwrap();
            let s: i64 = conn
                .query_row("SELECT count(*) FROM sections", [], |r| r.get(0))
                .unwrap();
            (g, s)
        }),
    ));

    // The hop itself: a query that is already SQL today, issued on the pooled
    // connection instead of the engine's. `get_period_stats` is the one every
    // screen bundle runs.
    out.push((
        "get_period_stats, pooled",
        time(|| {
            conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(moving_time), 0), COALESCE(SUM(distance), 0),
                        COALESCE(SUM(training_load), 0)
                 FROM activity_metrics WHERE date BETWEEN ?1 AND ?2",
                [0i64, i64::MAX],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
        }),
    ));

    out
}

fn main() {
    let Some((_dir, path)) = corpus() else { return };

    let started = Instant::now();
    let mut engine = match PersistentEngine::new(path.to_str().unwrap()) {
        Ok(engine) => engine,
        Err(e) => {
            eprintln!("skipped: the corpus does not open: {e:?}");
            return;
        }
    };
    engine.load().expect("load the catalogue");
    println!("open, migrate and load: {:?}", started.elapsed());

    let ids = engine.get_activity_ids();
    println!("{} activities in the corpus", ids.len());

    // The memory tier as it stands, on this library and this machine, so the
    // pooled figures below are compared against a number taken here rather than
    // against `I91`'s, which were taken on another day and another library.
    let from_memory = vec![
        ("activity_count", time(|| engine.activity_count())),
        (
            "map_screen_data",
            time(|| engine.map_screen_data(i64::MIN, i64::MAX, Vec::new())),
        ),
    ];
    let newest_id = ids.first().cloned().unwrap_or_default();

    // The catalogue is loaded, so the engine's own connection is no longer
    // needed and holding it open would keep a second writer out.
    drop(engine);

    println!("\nthe memory tier today");
    for (name, d) in &from_memory {
        println!("  {name:<30} {d:>10.2?}");
    }

    let quiet = {
        let conn = reader(&path);
        replacements(&conn, &newest_id)
    };

    let stop = Arc::new(AtomicBool::new(false));
    let writer = hold_writer(path.clone(), Arc::clone(&stop));
    // Let the first hold start before the reads do.
    std::thread::sleep(Duration::from_millis(20));
    let contended = {
        let conn = reader(&path);
        replacements(&conn, &newest_id)
    };
    stop.store(true, Ordering::Relaxed);
    writer.join().expect("the writer finishes");

    println!(
        "\nthrough a read-only connection, median of {SAMPLES}\n  {:<30} {:>10}  {:>10}",
        "lookup it replaces", "quiet", "writer held"
    );
    for ((name, q), (_, c)) in quiet.iter().zip(contended.iter()) {
        println!("  {name:<30} {q:>10.2?}  {c:>10.2?}");
    }
}
