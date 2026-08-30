//! Suite #2: concurrency and durability.
//!
//! The five other Suite #2 files probe identity, config, and edit survival
//! (roots R1/R2/R3). None of them touch what happens across a process restart
//! or when a second SQLite connection reads the file mid-write. That seam is
//! this file: does a detected catalogue survive a fresh `PersistentEngine`
//! open, does the in-memory detection cache agree with the DB view the app
//! actually renders, and does the no-WAL single-writer store stay consistent
//! under a concurrent reader, racing detections, and an interrupted sync.
//!
//! One live gate per curiosity, each asserting the invariant. Everything is
//! method-agnostic persistence behaviour, so it runs on the fast Control arm.
//!
//! A second engine is opened directly with `PersistentEngine::new(path)` on
//! the SAME db file, exactly what production's background detection thread does
//! (it clones `db_path` and opens its own connection). The harness engines are
//! owned by value, not the global `PERSISTENT_ENGINE` singleton, so this
//! exercises SQLite-level concurrency directly, not the process-wide RwLock.
//!
//! The two-engine timing tests need the machine to themselves: a heavy test
//! running alongside makes the reader observe mid-commit counts. `serialise()`
//! enforces that in-process, so the file is safe at any `--test-threads`.

mod lifecycle_support;

/// Serialises the tests in this binary. The two-engine timing tests observe
/// mid-commit counts if another heavy test shares the machine, and a comment
/// asking for `--test-threads=1` does not bind CI.
fn serialise() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use tracematch::sections::FrequentSection;
use veloqrs::PersistentEngine;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// The in-memory detection cache view (`get_sections()`), shaped like the DB
/// `snapshot()` so the two can be compared with the same signature/ground
/// machinery. This is the cache `apply_sections_save` overwrites and never
/// reloads from DB. The DB `snapshot()` is what the user actually sees.
fn in_memory_snapshot(engine: &PersistentEngine) -> SectionSnapshot {
    SectionSnapshot {
        sections: engine
            .get_sections()
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        distance_meters: s.distance_meters,
                        polyline: s.polyline.clone(),
                        sport_type: s.sport_type.clone(),
                        rank_score: None,
                        klass: None,
                        is_user_defined: s.is_user_defined,
                    },
                )
            })
            .collect(),
    }
}

/// Order-free signature of a raw detection result, before it is applied. Lets
/// the racing-detect test ask whether two concurrent full detections of the
/// same state produced the same catalogue.
fn frequent_signature(sections: &[FrequentSection]) -> String {
    let snap = SectionSnapshot {
        sections: sections
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        distance_meters: s.distance_meters,
                        polyline: s.polyline.clone(),
                        sport_type: s.sport_type.clone(),
                        rank_score: None,
                        klass: None,
                        is_user_defined: s.is_user_defined,
                    },
                )
            })
            .collect(),
    };
    snap.catalogue_signature()
}

/// The db file path a `fresh_engine_for` TempDir owns. A second engine opened on
/// this path shares the file with the first.
fn db_path(dir: &tempfile::TempDir) -> String {
    dir.path()
        .join("lifecycle.db")
        .to_str()
        .expect("utf8 path")
        .to_string()
}

// ============================================================================
// Curiosity 1: restart durability
//
// Cold-detect on engine #1, then open a FRESH engine #2 on the same file the
// way production does (`new` + `load`) and read it back. The question the whole
// app rests on: does a detected catalogue survive a restart, or was it only
// ever in memory?
// ============================================================================

/// The db catalogue signature after a cold detect, and again after a fresh
/// reopen, plus the in-memory count each engine carries. The counts let the gate
/// prove `load` rehydrates the cache rather than coming up empty.
fn restart_state() -> (String, String, usize, usize) {
    let corpus = corpus();
    let (mut e1, dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut e1, "cold", &corpus.through_a());
    let sig_db_before = cold.snapshot.catalogue_signature();
    let e1_inmem = in_memory_snapshot(&e1).count();

    // Close engine #1's connection (flush) before the "restart".
    drop(e1);

    // Production restart path: new() then load(). new() alone comes up with an
    // empty in-memory cache. load() hydrates it from the DB.
    let mut e2 = PersistentEngine::new(&db_path(&dir)).expect("reopen");
    e2.load().expect("load after reopen");
    let e2_inmem = in_memory_snapshot(&e2).count();
    let sig_db_after = snapshot(&mut e2).catalogue_signature();

    (sig_db_before, sig_db_after, e1_inmem, e2_inmem)
}

/// Gate: the user-visible catalogue is byte-identical across a fresh open, and
/// `load` brings the in-memory cache back with it. This is the floor the app
/// stands on. A restart must not lose or mutate detected sections.
#[test]
fn restart_preserves_catalogue() {
    let _serial = serialise();
    let (before, after, e1_inmem, e2_inmem) = restart_state();
    assert_eq!(
        e2_inmem, e1_inmem,
        "load() rehydrated {e2_inmem} in-memory sections, engine #1 held {e1_inmem}"
    );
    assert!(
        !before.is_empty(),
        "cold detect produced no catalogue to persist"
    );
    assert_eq!(
        before, after,
        "catalogue changed across a fresh open, detection did not durably persist"
    );
}

/// Gate (B4 durability): the identity REGISTRIES survive a restart intact, not
/// just the ids (a reseed from the DB rows already adopts those) but the
/// hysteresis debounce streaks and the tombstones a dissolved ground re-emerges
/// under, which live only in the registry blob. A multi-step drip builds that
/// state; migration 013 persists it, and `load` restores it byte-for-byte where a
/// reseed could not (a reseed sees only the final rows, losing the debounce and
/// the tombstones). Fingerprint = the serialised registry, so equality is exact.
#[test]
fn identity_registries_survive_restart() {
    let _serial = serialise();
    let corpus = corpus();
    let (mut e1, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut e1, "cold", &corpus.through_a());
    ingest_step(&mut e1, "expand", &refs(&corpus.bucket_b_delta));
    ingest_step(&mut e1, "single", &[&corpus.bucket_c_single]);
    let section_fp = e1.section_identity_fingerprint();
    // Force route grouping so the route registry exists and is persisted.
    e1.get_groups();
    let route_fp = e1.route_identity_fingerprint();
    drop(e1);

    let mut e2 = PersistentEngine::new(&db_path(&dir)).expect("reopen");
    e2.load().expect("load after reopen");

    assert!(
        !section_fp.is_empty(),
        "section registry produced no state to persist"
    );
    assert_eq!(
        e2.section_identity_fingerprint(),
        section_fp,
        "section identity registry (debounce + tombstones) did not survive the restart",
    );
    assert_eq!(
        e2.route_identity_fingerprint(),
        route_fp,
        "route identity registry (mint counter + seniority) did not survive the restart",
    );
}

// ============================================================================
// Curiosity 2: in-memory cache vs DB view seam (B4)
//
// `get_sections()` returns the in-memory `self.sections` cache;
// `get_sections_by_type(None)` reads the DB. `apply_sections_save` re-assigns
// the cache wholesale, so the risk is a mutation that touches only the DB. Both
// halves are gated: the apply path stays coherent, and a DB-only edit (disable)
// is reflected in the cache rather than leaving it one section ahead.
// ============================================================================

/// Guard: the apply path itself keeps the cache and DB coherent. After a cold
/// detect and after an expand re-detect, `get_sections()` and the DB view report
/// the same catalogue. If a finalize step starts editing the DB without updating
/// the cache, this trips.
#[test]
fn apply_path_keeps_cache_coherent() {
    let _serial = serialise();
    let corpus = corpus();
    let (mut e, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut e, "cold", &corpus.through_a());
    assert_eq!(
        in_memory_snapshot(&e).count(),
        cold.snapshot.count(),
        "cache and DB disagree immediately after a cold apply"
    );
    let expand = ingest_step(&mut e, "expand", &refs(&corpus.bucket_b_delta));
    assert_eq!(
        in_memory_snapshot(&e).count(),
        expand.snapshot.count(),
        "cache and DB disagree immediately after an expand apply"
    );
}

/// Gate (B4): the in-memory cache reflects a DB-only edit. Disabling a section
/// drops it from the DB view the app renders, and the cache is kept in lockstep
/// rather than left one section ahead. A red here is the seam reopening: an
/// in-memory consumer acting on a section the user hid.
#[test]
fn cache_reflects_db_only_edits() {
    let _serial = serialise();
    let corpus = corpus();
    let (mut e, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut e, "cold", &corpus.through_a());
    let (id, _) = busiest_section(&cold.snapshot).expect("a section to disable");

    e.disable_section(&id).expect("disable_section");
    let inmem = in_memory_snapshot(&e).count();
    let db = snapshot(&mut e).count();

    assert_eq!(
        inmem, db,
        "after disabling {id}, the in-memory cache reports {inmem} sections but the DB view reports {db} (stale cache)"
    );
}

// ============================================================================
// Curiosity 3: two-engine read during write
//
// A writer engine runs a big expand (ingest + full re-detect + apply) on a
// background thread while a reader engine on a second connection hammers
// `get_sections_by_type(None)`. No-WAL rollback journal means a single writer
// and readers that block during the commit window. The question: do reads ever
// error, return a false-empty (`get_sections_by_type` swallows a prepare error
// to `Vec::new()`), or see a torn catalogue?
// ============================================================================

/// (sections before the expand, sections after the expand, per-read
///  (count, latency) samples taken concurrently with the writer).
fn read_during_write() -> (usize, usize, Vec<(usize, Duration)>) {
    let corpus = corpus();

    // Reader engine holds the cold catalogue. Its DB has N0 sections committed.
    let (mut reader, dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut reader, "cold", &corpus.through_a());
    let n0 = reader.get_sections_by_type(None).len();

    let path = db_path(&dir);
    let delta = corpus.bucket_b_delta.clone();
    let done = Arc::new(AtomicBool::new(false));
    let done_writer = done.clone();

    // Writer opens its OWN connection (production's detection-thread pattern),
    // loads the cold state, then ingests the year-expand and re-detects. The
    // expand is >50% new activities, so the engine runs a full re-detect: one
    // `save_sections` DELETE+INSERT transaction is the write the reader races.
    let writer = thread::spawn(move || {
        let mut w = PersistentEngine::new(&path).expect("writer open");
        w.load().expect("writer load");
        for a in &delta {
            w.add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
                .expect("writer add_activity");
            w.update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
                .expect("writer update_metadata");
        }
        let handle = w.detect_sections_background();
        let (sections, processed) = handle.recv().unwrap_or_default();
        w.apply_sections(sections).expect("writer apply_sections");
        w.save_processed_activity_ids(&processed)
            .expect("writer save_processed");
        done_writer.store(true, Ordering::SeqCst);
        w.get_sections_by_type(None).len()
    });

    // Hammer reads until the writer finishes, then a few more to catch the
    // committed post-state. Each read is timed. Count is the torn/false-empty
    // signal (must be N0 or N1, never 0, never partial).
    let mut reads: Vec<(usize, Duration)> = Vec::new();
    while !done.load(Ordering::SeqCst) {
        let t = Instant::now();
        let count = reader.get_sections_by_type(None).len();
        reads.push((count, t.elapsed()));
        if reads.len() >= 200_000 {
            break; // guard against a wedged writer, measurement stays bounded
        }
    }
    for _ in 0..5 {
        let t = Instant::now();
        let count = reader.get_sections_by_type(None).len();
        reads.push((count, t.elapsed()));
    }

    let n1 = writer.join().expect("writer join");
    (n0, n1, reads)
}

/// Gate: a concurrent reader on a second connection never errors, never sees a
/// false-empty, and never sees a torn catalogue while the writer re-detects.
/// Every read is N0 (pre-commit) or N1 (post-commit). SQLite's transaction
/// isolation plus the 5s busy_timeout should give this for free. A count of 0
/// (with N0 > 0) would mean `get_sections_by_type` swallowed a SQLITE_BUSY to
/// `Vec::new()`. A count that is neither N0 nor N1 would mean a mid-transaction
/// read. Kept as a live guard: if it ever fails, contention safety regressed.
#[test]
fn concurrent_reads_are_consistent() {
    let _serial = serialise();
    let (n0, n1, reads) = read_during_write();
    assert!(n0 > 0, "cold detect produced no baseline catalogue");
    let max_latency = reads.iter().map(|(_, d)| *d).max().unwrap_or_default();
    for (count, _) in &reads {
        assert!(
            *count == n0 || *count == n1,
            "reader saw {count} sections during the write (expected N0={n0} or N1={n1}): torn or false-empty read"
        );
    }
    assert!(
        max_latency < Duration::from_secs(5),
        "a read blocked {max_latency:?}, at/over the 5s busy_timeout, writer starved the reader"
    );
}

// ============================================================================
// Curiosity 4: racing detections
//
// Two `detect_sections_background` handles taken before either is `recv`d, both
// over the same unprocessed cold state, both applied in sequence. Does the
// second apply crash on a UNIQUE id, duplicate, or corrupt the catalogue?
// ============================================================================

/// (apply #1 ok, apply #2 ok, signatures of the two detection results,
///  final DB count, apply #2 error if any).
fn racing_detect() -> (bool, bool, String, String, usize, Option<String>) {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);

    // Ingest WITHOUT saving processed ids, so both detections run a full
    // detect over the same state (a saved-processed cold state would make both
    // short-circuit to the cached set, a trivial race).
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_metadata");
    }

    let h1 = engine.detect_sections_background();
    let h2 = engine.detect_sections_background();
    let (s1, _) = h1.recv().unwrap_or_default();
    let (s2, _) = h2.recv().unwrap_or_default();
    let sig1 = frequent_signature(&s1);
    let sig2 = frequent_signature(&s2);

    let r1 = engine.apply_sections(s1);
    let r2 = engine.apply_sections(s2);
    let r1_ok = r1.is_ok();
    let r2_err = r2.as_ref().err().map(|e| e.to_string());
    let r2_ok = r2.is_ok();
    let final_count = snapshot(&mut engine).count();

    (r1_ok, r2_ok, sig1, sig2, final_count, r2_err)
}

/// Gate: racing two full detections and applying both must not crash or corrupt
/// the store. The second apply succeeds and leaves a non-empty catalogue.
/// `save_sections` DELETEs all auto sections before re-inserting, so the second
/// apply cannot collide on a UNIQUE id. A live guard on that wipe-rebuild
/// crash-safety.
#[test]
fn racing_detect_does_not_corrupt() {
    let _serial = serialise();
    let (r1_ok, r2_ok, _sig1, _sig2, final_count, r2_err) = racing_detect();
    assert!(r1_ok, "first apply of a racing detect failed");
    assert!(
        r2_ok,
        "second apply of a racing detect failed: {}",
        r2_err.unwrap_or_default()
    );
    assert!(
        final_count > 0,
        "racing double-apply left an empty catalogue"
    );
}

// ============================================================================
// Curiosity 5: crash mid-sync
//
// Simulate a sync killed after activities are persisted but before detection is
// applied: ingest cold, DO NOT detect/apply, drop the engine, reopen fresh.
// The DB must be consistent (activities present, no half-written sections) and
// a subsequent detect must recover the catalogue.
// ============================================================================

/// (activities visible after reopen, sections visible before recover,
///  sections after a recover detect).
fn crash_before_apply() -> (usize, usize, usize) {
    let corpus = corpus();
    let (mut e1, dir) = fresh_engine_for(Arm::Battery);

    // Ingest persists GPS + metadata to the DB immediately (add_activity
    // commits its own transaction). Detection is never run, the sync is
    // "killed" here, before any section is applied.
    for a in corpus.through_a() {
        e1.add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        e1.update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_metadata");
    }
    drop(e1);

    let mut e2 = PersistentEngine::new(&db_path(&dir)).expect("reopen");
    e2.load().expect("load after crash");
    let activities = e2.get_activity_ids().len();
    let sections_before = snapshot(&mut e2).count();

    // Recover: a detect over the reloaded (still-unprocessed) activities. No new
    // activities are added. The ingest slice is empty.
    let recovered = ingest_step(&mut e2, "recover", &[]);
    let sections_after = recovered.snapshot.count();

    (activities, sections_before, sections_after)
}

/// Gate: an interrupted sync leaves a consistent DB and is fully recoverable.
/// All ingested activities survive the reopen, no partial sections were written
/// before the crash, and a subsequent detect rebuilds the catalogue.
/// `add_activity` commits independently of detection, so nothing half-writes a
/// section without an apply.
#[test]
fn crash_before_apply_recovers() {
    let _serial = serialise();
    let corpus = corpus();
    let expected_activities = corpus.through_a().len();
    let (activities, before, after) = crash_before_apply();
    assert_eq!(
        activities, expected_activities,
        "reopen lost activities: {activities} of {expected_activities} survived the crash"
    );
    assert_eq!(
        before, 0,
        "reopen found {before} sections after a sync that never applied any (half-written state)"
    );
    assert!(
        after > 0,
        "recover detect after a crash produced no sections (unrecoverable)"
    );
}
