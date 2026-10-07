//! Each background job's last run: when it finished, how it ended and what it
//! handled and changed.
//!
//! The phases the jobs report while running are process-global and start at
//! idle on every launch, and the attempt store forgets a key once its work
//! lands, so neither can say what the last run did after a relaunch. This is
//! the one durable answer. One row per job, replaced on each run, so the table
//! never grows past one row for each job there is.
//!
//! The summary annotates the work, it is not the work. A write that fails is
//! logged and the job carries on as if it had landed.

use rusqlite::{Connection, Result as SqlResult, params};

/// A job that records its last run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundJob {
    Detection,
    ElevationBackfill,
    StreamBackfill,
    Cutover,
}

impl BackgroundJob {
    /// The stored token, which is also the id the app names the job by.
    pub fn token(self) -> &'static str {
        match self {
            Self::Detection => "detection",
            Self::ElevationBackfill => "elevationBackfill",
            Self::StreamBackfill => "streamBackfill",
            Self::Cutover => "cutover",
        }
    }
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOutcome {
    /// Everything it set out to do landed.
    Complete,
    /// It finished and left items a later run retries.
    Partial,
    /// It ended without finishing.
    Failed,
    /// The athlete held it until the app is next opened.
    Paused,
    /// The athlete stopped it.
    Stopped,
}

impl RunOutcome {
    pub fn token(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::Failed => "failed",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
        }
    }
}

/// One job's last run. A job leaves at zero the counts it has no measure of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobRun {
    pub job: BackgroundJob,
    /// Epoch milliseconds, from [`super::attempts::now_ms`].
    pub finished_at: i64,
    pub outcome: RunOutcome,
    /// Items the run took on.
    pub handled: u32,
    pub added: u32,
    pub changed: u32,
    pub retired: u32,
    pub failed: u32,
}

/// Store `run` as its job's last run, replacing the one before.
///
/// Never fails its caller: a summary that cannot be written is logged, and the
/// job it describes has already done its work.
pub fn record_job_run(conn: &Connection, run: &JobRun) {
    let written = conn.execute(
        "INSERT OR REPLACE INTO job_runs
             (job, finished_at, outcome, handled, added, changed, retired, failed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            run.job.token(),
            run.finished_at,
            run.outcome.token(),
            run.handled,
            run.added,
            run.changed,
            run.retired,
            run.failed,
        ],
    );
    if let Err(e) = written {
        log::warn!(
            "veloqrs: [job_runs] Could not record the last {} run: {}",
            run.job.token(),
            e
        );
    }
}

/// Every job's last run, in job order. A job that has never run on this
/// install has no row.
pub fn job_runs(conn: &Connection) -> SqlResult<Vec<crate::FfiJobRun>> {
    let mut stmt = conn.prepare_cached(
        "SELECT job, finished_at, outcome, handled, added, changed, retired, failed
         FROM job_runs ORDER BY job",
    )?;
    stmt.query_map([], |row| {
        Ok(crate::FfiJobRun {
            job: row.get(0)?,
            finished_at: row.get::<_, i64>(1)? as f64,
            outcome: row.get(2)?,
            handled: row.get(3)?,
            added: row.get(4)?,
            changed: row.get(5)?,
            retired: row.get(6)?,
            failed: row.get(7)?,
        })
    })?
    .collect()
}

#[cfg(test)]
#[path = "tests/job_runs.rs"]
mod tests;
