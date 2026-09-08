//! The attempt store: one answer to "have I already asked for this".
//!
//! A job identity is `kind` plus its ordered discriminants, joined by colons.
//! That is not a new vocabulary, it is the one `spawn_once` already writes at
//! seven call sites (`objects/sync.rs`), and it is the only real key of the
//! three answers the tree carried: the exclusive sync slot is a bare boolean
//! and cannot say what is running, and `useActivities.ts` keys a `Set` on
//! accepted windows only, so a refused window and one never asked for are
//! indistinguishable.
//!
//! The lease is a generation the engine mints once at init, not a timeout.
//! Every row a previous process left behind is free the moment the new
//! generation is minted, whether that process exited cleanly, was killed or
//! panicked, and no clock decides it. The cost of forgetting is one wasted
//! attempt; the cost of remembering must never be a job that never runs again.
//!
//! Work stays derived. The table holds attempt bookkeeping, never a work row,
//! because every pending set in the engine is derived by negation from a
//! completion marker and migration `020` records what a stored failure row
//! cost the last time one existed.

use rusqlite::{OptionalExtension, Result as SqlResult, params};

use super::PersistentEngine;
use crate::objects::start::FfiStartOutcome;

/// `schema_info` key holding the lease generation this install is on.
pub const LEASE_GENERATION_KEY: &str = "lease_generation";

/// What a key with no failures behind it waits before it can be asked again.
const BACKOFF_BASE_MS: i64 = 1_000;

/// The longest any key waits, whatever its attempt count. An hour, matching
/// the recording upload queue's own cap, which is the one durable queue this
/// shape is generalised from.
const BACKOFF_CAP_MS: i64 = 60 * 60 * 1_000;

/// How long a key with `attempts` failures behind it waits before the next.
///
/// A pure function of the count, so the schedule is read rather than spent:
/// nothing in its tests takes an `Instant`.
pub fn attempt_backoff_ms(attempts: u32) -> i64 {
    BACKOFF_BASE_MS
        .saturating_mul(1i64 << attempts.min(32))
        .min(BACKOFF_CAP_MS)
}

/// Epoch milliseconds, which is the unit every column here is in.
///
/// A clock before the epoch is not a time this store can reason about, so it
/// reads as zero rather than wrapping negative and putting a key into a
/// backoff that ends in 1970.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A job's identity, as the store holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobKey(String);

impl JobKey {
    /// `kind` and its ordered discriminants, joined by colons.
    pub fn new(kind: &str, discriminants: &[&str]) -> Self {
        let mut key = String::from(kind);
        for part in discriminants {
            key.push(':');
            key.push_str(part);
        }
        Self(key)
    }

    /// A key over a list, which is the count and a hash of the list rather
    /// than the list itself.
    ///
    /// `timestreams` is why: its key was `activity_ids.join(",")`, so a queue
    /// of a thousand activities wrote a thousand ids into a `TEXT PRIMARY KEY`.
    /// The count is kept in the clear because it is the part a reader of a log
    /// line can use.
    pub fn over(kind: &str, items: &[String]) -> Self {
        let mut hash = FNV_OFFSET;
        for item in items {
            for byte in item.as_bytes() {
                hash ^= u64::from(*byte);
                hash = hash.wrapping_mul(FNV_PRIME);
            }
            // The separator is part of the hash, or ["ab"] and ["a", "b"]
            // are one key.
            hash ^= 0xff;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        Self(format!("{kind}:{}:{hash:016x}", items.len()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// FNV-1a, written out rather than taken from a crate.
///
/// The hash is written into a database that outlives the process, so it has to
/// be stable across builds for ever. `DefaultHasher` is explicitly not, and a
/// cryptographic hash is not owed by a cache key. Pinned by
/// `the_list_hash_is_stable_across_builds`.
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// The verdict on a claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Claim {
    /// The key is yours until it is released, or until the next launch mints a
    /// generation.
    Taken,
    /// This generation already holds it. `spawn_once`'s `Busy`.
    InFlight,
    /// It failed recently and the backoff has not run out. `until` is when it
    /// becomes claimable, so a caller can say how long rather than only "no".
    BackingOff { until: i64 },
}

/// How a claim ended.
#[derive(Debug, Clone)]
pub enum Release {
    /// The work landed. The row is forgotten, so a key that lands after
    /// failing starts clean and the table cannot grow without bound.
    Done,
    /// The work failed. The attempt count and the backoff grow.
    Failed {
        refusal: FfiStartOutcome,
        error: Option<String>,
    },
}

impl Release {
    pub fn failed(refusal: FfiStartOutcome, error: Option<&str>) -> Self {
        Release::Failed {
            refusal,
            error: error.map(str::to_string),
        }
    }
}

/// One row of the store.
#[derive(Debug, Clone)]
pub struct AttemptRow {
    pub key: String,
    pub attempts: u32,
    pub last_attempt_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_refusal: Option<String>,
    pub lease_gen: i64,
}

impl PersistentEngine {
    /// The generation this install is on.
    ///
    /// One before the first mint, never zero: zero is the `lease_gen` default
    /// and means free, so a generation of zero would read every untouched row
    /// as held by the current run.
    pub fn lease_generation(&self) -> SqlResult<i64> {
        Ok(self
            .db
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = ?",
                params![LEASE_GENERATION_KEY],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .filter(|g| *g > 0)
            .unwrap_or(1))
    }

    /// Mint the next generation, freeing every lease the last one held.
    /// Called exactly once per process, from init.
    pub fn mint_lease_generation(&self) -> SqlResult<i64> {
        let next = self.lease_generation()? + 1;
        self.db.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
            params![LEASE_GENERATION_KEY, next.to_string()],
        )?;
        Ok(next)
    }

    /// Take the lease on `key`, or say why not.
    ///
    /// `now` is epoch milliseconds, handed in rather than read, the same way
    /// `next_pending_recording` takes its clock.
    pub fn claim_job(&self, key: &JobKey, now: i64) -> SqlResult<Claim> {
        let generation = self.lease_generation()?;
        let tx = self.db.unchecked_transaction()?;

        let existing: Option<(u32, Option<i64>, i64)> = tx
            .query_row(
                "SELECT attempts, last_attempt_at, lease_gen FROM job_attempts WHERE key = ?",
                params![key.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        if let Some((attempts, last_attempt_at, lease_gen)) = existing {
            if lease_gen == generation {
                return Ok(Claim::InFlight);
            }
            // Only a failure backs a key off. A row a dead process abandoned
            // carries no failure, so the restart that frees it hands it back
            // immediately.
            if attempts > 0
                && let Some(last) = last_attempt_at
            {
                let until = last.saturating_add(attempt_backoff_ms(attempts - 1));
                if now < until {
                    return Ok(Claim::BackingOff { until });
                }
            }
        }

        tx.execute(
            "INSERT INTO job_attempts (key, attempts, last_attempt_at, lease_gen)
             VALUES (?, 0, ?, ?)
             ON CONFLICT(key) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
                                            lease_gen = excluded.lease_gen",
            params![key.as_str(), now, generation],
        )?;
        tx.commit()?;
        Ok(Claim::Taken)
    }

    /// Give the lease back, saying how the work ended.
    pub fn release_job(&self, key: &JobKey, release: Release, now: i64) -> SqlResult<()> {
        match release {
            Release::Done => {
                self.db.execute(
                    "DELETE FROM job_attempts WHERE key = ?",
                    params![key.as_str()],
                )?;
            }
            Release::Failed { refusal, error } => {
                self.db.execute(
                    "UPDATE job_attempts
                     SET attempts = attempts + 1,
                         last_attempt_at = ?,
                         last_refusal = ?,
                         last_error = ?,
                         lease_gen = 0
                     WHERE key = ?",
                    params![now, format!("{refusal:?}"), error, key.as_str()],
                )?;
            }
        }
        Ok(())
    }

    /// What the store holds for `key`, if anything.
    pub fn job_attempt(&self, key: &JobKey) -> SqlResult<Option<AttemptRow>> {
        self.db
            .query_row(
                "SELECT key, attempts, last_attempt_at, last_error, last_refusal, lease_gen
                 FROM job_attempts WHERE key = ?",
                params![key.as_str()],
                |row| {
                    Ok(AttemptRow {
                        key: row.get(0)?,
                        attempts: row.get(1)?,
                        last_attempt_at: row.get(2)?,
                        last_error: row.get(3)?,
                        last_refusal: row.get(4)?,
                        lease_gen: row.get(5)?,
                    })
                },
            )
            .optional()
    }
}
