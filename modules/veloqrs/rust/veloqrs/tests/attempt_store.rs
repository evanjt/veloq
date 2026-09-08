//! One answer to "have I already asked for this", and what it costs to forget.
//!
//! Three mechanisms answered it before this: `spawn_once`'s process-local
//! `HashSet`, the exclusive sync slot's bare boolean, and a TypeScript `Set`
//! of accepted windows. Only the first is a real key, so the store adopts its
//! vocabulary and nothing else's.
//!
//! What is held here is attempt bookkeeping, never a work row. Every pending
//! set in the engine is derived by negation from a completion marker, and
//! migration `020`'s own comment records what a stored failure row cost the
//! last time one existed.

mod migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::objects::start::FfiStartOutcome;
use veloqrs::persistence::attempts::{Claim, JobKey, Release, attempt_backoff_ms};

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("attempts.db");
    PersistentEngine::new(path.to_str().expect("path")).expect("engine opens")
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// The seven `spawn_once` call sites, as `objects/sync.rs` writes them today.
/// The store adopts this vocabulary rather than inventing a third, so every
/// one of them has to come back out of `JobKey` byte for byte.
#[test]
fn the_spawn_once_key_shapes_round_trip() {
    let cases: [(JobKey, &str); 6] = [
        (JobKey::new("power", &["Ride", "42"]), "power:Ride:42"),
        (
            JobKey::new("pace", &["Run", "42", "true"]),
            "pace:Run:42:true",
        ),
        (JobKey::new("intervals", &["a1"]), "intervals:a1"),
        (
            JobKey::new("calendar", &["2026-01-01", "2026-02-01"]),
            "calendar:2026-01-01:2026-02-01",
        ),
        (
            JobKey::new("streams", &["a1", "watts,cadence"]),
            "streams:a1:watts,cadence",
        ),
        (JobKey::new("detail", &["a1"]), "detail:a1"),
    ];

    for (built, expected) in cases {
        assert_eq!(
            built.as_str(),
            expected,
            "the key vocabulary is `spawn_once`'s, not a new one"
        );
    }
}

/// `timestreams` is the shape to rule out: its key was the id list joined by
/// commas, so a queue of a thousand activities wrote a key of a thousand ids
/// into a TEXT primary key. It becomes a hash of the list with the count, and
/// that has to stay short however long the list is.
#[test]
fn a_key_over_a_list_is_bounded_and_names_its_count() {
    let short: Vec<String> = (0..3).map(|i| format!("a{i}")).collect();
    let long: Vec<String> = (0..5_000).map(|i| format!("a{i}")).collect();

    let short_key = JobKey::over("timestreams", &short);
    let long_key = JobKey::over("timestreams", &long);

    assert!(
        short_key.as_str().starts_with("timestreams:3:"),
        "the count belongs in the key, so two different lists of the same \
         length are still told apart by the hash: {}",
        short_key.as_str()
    );
    assert!(
        long_key.as_str().len() < 80,
        "a key over 5,000 ids is still short: {}",
        long_key.as_str().len()
    );
    assert_ne!(short_key.as_str(), long_key.as_str());
}

/// Order is part of the identity for the joined shapes, so it has to be part
/// of it here too, or two different requests share one key.
#[test]
fn a_reordered_list_is_a_different_key() {
    let one = vec!["a1".to_string(), "a2".to_string()];
    let other = vec!["a2".to_string(), "a1".to_string()];

    assert_ne!(
        JobKey::over("timestreams", &one).as_str(),
        JobKey::over("timestreams", &other).as_str()
    );
}

/// The hash is written into a database that outlives the process, so it must
/// not move between builds. Pinned to its value rather than to itself.
#[test]
fn the_list_hash_is_stable_across_builds() {
    let ids = vec!["a1".to_string(), "a2".to_string(), "a3".to_string()];

    assert_eq!(
        JobKey::over("timestreams", &ids).as_str(),
        "timestreams:3:b14c1ab425b1b3a9",
        "the hash changed, so every stored key from an earlier build is now \
         a different job"
    );
}

// ---------------------------------------------------------------------------
// The lease
// ---------------------------------------------------------------------------

#[test]
fn a_free_key_is_claimed_and_the_same_key_is_then_refused() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("detail", &["a1"]);

    assert!(matches!(
        engine.claim_job(&key, 1_000).expect("claim"),
        Claim::Taken
    ));
    assert!(
        matches!(
            engine.claim_job(&key, 1_001).expect("second claim"),
            Claim::InFlight
        ),
        "a key this generation holds is busy, not free"
    );
}

#[test]
fn a_released_key_is_free_again_in_the_same_run() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("detail", &["a1"]);

    engine.claim_job(&key, 1_000).expect("claim");
    engine
        .release_job(&key, Release::Done, 1_500)
        .expect("release");

    assert!(
        engine.job_attempt(&key).expect("read").is_none(),
        "work that landed is forgotten, or the table grows for ever"
    );
    assert!(matches!(
        engine.claim_job(&key, 1_600).expect("re-claim"),
        Claim::Taken
    ));
}

/// The lease is a generation a restart invalidates, not a timeout. A process
/// that was killed mid-fetch leaves a claimed row behind, and the next launch
/// has to free it whether that process exited cleanly, was killed or panicked.
/// Proved by minting the generation, never by waiting.
#[test]
fn a_restart_frees_every_lease_without_waiting() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("streams", &["a1", "watts"]);

    engine.claim_job(&key, 1_000).expect("claim");
    assert!(matches!(
        engine.claim_job(&key, 1_001).expect("held"),
        Claim::InFlight
    ));

    let before = engine.lease_generation().expect("generation");
    let after = engine.mint_lease_generation().expect("mint");
    assert_eq!(after, before + 1, "a launch mints exactly one generation");

    assert!(
        matches!(
            engine.claim_job(&key, 1_002).expect("claim after restart"),
            Claim::Taken
        ),
        "a lease from a process that is gone stranded the key"
    );
}

/// A row abandoned by a dead process carries no failure, so the restart that
/// frees it must not put it straight into a backoff. The cost of forgetting is
/// one wasted attempt; the cost of remembering must never be a job that never
/// runs again.
#[test]
fn a_lease_a_restart_freed_is_not_also_backing_off() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("detail", &["a1"]);

    engine.claim_job(&key, 1_000).expect("claim");
    engine.mint_lease_generation().expect("mint");

    assert!(matches!(
        engine.claim_job(&key, 1_000).expect("claim"),
        Claim::Taken
    ));
}

// ---------------------------------------------------------------------------
// The backoff
// ---------------------------------------------------------------------------

/// A pure function of the attempt count, so the schedule is read rather than
/// spent. No wall clock anywhere in this file.
#[test]
fn the_backoff_doubles_per_attempt_and_caps() {
    assert_eq!(attempt_backoff_ms(0), 1_000);
    assert_eq!(attempt_backoff_ms(1), 2_000);
    assert_eq!(attempt_backoff_ms(2), 4_000);

    let ladder: Vec<i64> = (0..12).map(attempt_backoff_ms).collect();
    assert!(
        ladder.windows(2).all(|w| w[1] >= w[0]),
        "a backoff that shrinks re-admits a failing key sooner: {ladder:?}"
    );
    assert_eq!(
        attempt_backoff_ms(64),
        attempt_backoff_ms(32),
        "the cap holds however many times it failed, and the shift never \
         overflows"
    );
    assert_eq!(attempt_backoff_ms(64), 60 * 60 * 1000);
}

#[test]
fn a_failed_key_backs_off_and_is_claimable_once_the_delay_runs_out() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("power", &["Ride", "42"]);

    engine.claim_job(&key, 1_000).expect("claim");
    engine
        .release_job(
            &key,
            Release::failed(FfiStartOutcome::Offline, Some("connection refused")),
            2_000,
        )
        .expect("release");

    let delay = attempt_backoff_ms(0);
    match engine.claim_job(&key, 2_000 + delay - 1).expect("claim") {
        Claim::BackingOff { until } => assert_eq!(until, 2_000 + delay),
        other => panic!("a key that just failed was re-admitted: {other:?}"),
    }
    assert!(matches!(
        engine.claim_job(&key, 2_000 + delay).expect("claim"),
        Claim::Taken
    ));
}

#[test]
fn a_repeatedly_failing_key_waits_longer_each_time() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("power", &["Ride", "42"]);

    let mut now = 1_000;
    let mut waits = Vec::new();
    for _ in 0..4 {
        assert!(matches!(
            engine.claim_job(&key, now).expect("claim"),
            Claim::Taken
        ));
        engine
            .release_job(&key, Release::failed(FfiStartOutcome::Failed, None), now)
            .expect("release");
        let Claim::BackingOff { until } = engine.claim_job(&key, now).expect("claim") else {
            panic!("a key that just failed was re-admitted");
        };
        waits.push(until - now);
        now = until;
    }

    assert_eq!(waits, vec![1_000, 2_000, 4_000, 8_000]);
}

/// The refusal is recorded, not just the failure, so a caller can say why the
/// last attempt did not land rather than re-deriving it.
#[test]
fn the_row_carries_the_reason_the_last_attempt_gave() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("intervals", &["a1"]);

    engine.claim_job(&key, 1_000).expect("claim");
    engine
        .release_job(
            &key,
            Release::failed(FfiStartOutcome::NotConfigured, Some("no credential")),
            1_100,
        )
        .expect("release");

    let row = engine.job_attempt(&key).expect("read").expect("a row");
    assert_eq!(row.attempts, 1);
    assert_eq!(row.last_attempt_at, Some(1_100));
    assert_eq!(row.last_refusal.as_deref(), Some("NotConfigured"));
    assert_eq!(row.last_error.as_deref(), Some("no credential"));
}

/// A key that lands after failing starts clean, or one bad afternoon backs it
/// off for the rest of the install.
#[test]
fn work_that_lands_clears_the_attempts_behind_it() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let key = JobKey::new("intervals", &["a1"]);

    engine.claim_job(&key, 1_000).expect("claim");
    engine
        .release_job(&key, Release::failed(FfiStartOutcome::Failed, None), 1_000)
        .expect("release");
    let at = 1_000 + attempt_backoff_ms(0);
    engine.claim_job(&key, at).expect("claim");
    engine
        .release_job(&key, Release::Done, at)
        .expect("release");

    assert!(engine.job_attempt(&key).expect("read").is_none());
    assert!(matches!(
        engine.claim_job(&key, at + 1).expect("claim"),
        Claim::Taken
    ));
    assert_eq!(
        engine
            .job_attempt(&key)
            .expect("read")
            .expect("row")
            .attempts,
        0,
        "the failure before it still counts against the next backoff"
    );
}

// ---------------------------------------------------------------------------
// What it is, and what it is not
// ---------------------------------------------------------------------------

/// The store is `Derived`: losing it costs at most one extra attempt at the
/// base delay, which is time and not information. Salvaging it would carry a
/// backed-off row into a fresh database whose underlying data did not survive,
/// which is migration `020`'s bug rebuilt in a new table.
#[test]
fn a_quarantine_salvage_leaves_the_attempt_store_empty() {
    let dir = TempDir::new().expect("tempdir");
    let corrupt = dir.path().join("corrupt.db");
    {
        let engine = PersistentEngine::new(corrupt.to_str().expect("path")).expect("engine");
        let key = JobKey::new("detail", &["a1"]);
        engine.claim_job(&key, 1_000).expect("claim");
        engine
            .release_job(&key, Release::failed(FfiStartOutcome::Failed, None), 1_000)
            .expect("release");
        assert!(engine.job_attempt(&key).expect("read").is_some());
    }

    let fresh_path = dir.path().join("fresh.db");
    let fresh = PersistentEngine::new(fresh_path.to_str().expect("path")).expect("engine");
    fresh.salvage_ledger_from(corrupt.to_str().expect("path"));

    let conn = Connection::open(&fresh_path).expect("open");
    let rows: i64 = conn
        .query_row("SELECT count(*) FROM job_attempts", [], |r| r.get(0))
        .expect("count");
    assert_eq!(
        rows, 0,
        "the salvage carried attempt bookkeeping into a database whose data \
         did not survive"
    );
}

#[test]
fn the_store_is_declared_derived() {
    use veloqrs::persistence::tables::{TableClass, class_of};

    assert_eq!(class_of("job_attempts"), Some(TableClass::Derived));
}

/// The live upgrade path is 12 to 28, not a fresh install. Every 0.3.x build
/// shipped 12, so this is the migration a real device takes.
#[test]
fn the_twelve_to_twenty_eight_upgrade_keeps_every_other_table() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v12.db");
    let seeded = seed_at_version(&path, 12);
    let before = tables_at(&seeded);
    seeded
        .execute(
            "INSERT INTO settings (key, value) VALUES ('__athlete_id', 'a1')",
            [],
        )
        .expect("seed a row the upgrade must not touch");
    drop(seeded);

    let engine = PersistentEngine::new(path.to_str().expect("path")).expect("upgrade opens");
    drop(engine);

    let conn = Connection::open(&path).expect("open");
    let after = tables_at(&conn);
    for table in &before {
        assert!(
            after.contains(table),
            "the upgrade dropped {table}, which held one athlete's data"
        );
    }
    assert!(
        after.iter().any(|t| t == "job_attempts"),
        "the upgrade did not create the attempt store"
    );
    let athlete: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = '__athlete_id'",
            [],
            |r| r.get(0),
        )
        .expect("the seeded row survived");
    assert_eq!(athlete, "a1");
}
