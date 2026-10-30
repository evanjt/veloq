//! The pass rule a library's stored traversals were counted and timed under.
//!
//! A section's rows are written once and only ever added to, so a change to
//! what counts as a pass, or to how a pass is timed, leaves every stored row
//! under the old rule.
//! The stamp in `schema_info` says which rule the rows hold, and a build that
//! moves [`PASS_RULE_VERSION`] recounts every section against its stored line
//! on the next open.

use rusqlite::{OptionalExtension, params};

use crate::persistence::PersistentEngine;
use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, record_job_run};

/// Bump this when what counts as a traversal of a section, or the time of one,
/// changes.
pub(crate) const PASS_RULE_VERSION: i32 = 4;

const STAMP_KEY: &str = "pass_rule_version";

/// The libraries whose recount is running now, by file path.
///
/// The background jobs read holds a connection and no engine, so the running
/// flag cannot live on the engine. It is process-global like the other jobs'
/// phases, keyed by path so one library's recount is never another's.
static RECOUNTING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Marks a library's recount as running until it is dropped, so a panic in the
/// recount cannot leave the row spinning.
pub(crate) struct RecountRunning(String);

impl RecountRunning {
    pub(crate) fn begin(path: &str) -> Self {
        RECOUNTING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(path.to_string());
        Self(path.to_string())
    }
}

impl Drop for RecountRunning {
    fn drop(&mut self) {
        let mut running = RECOUNTING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(at) = running.iter().position(|path| *path == self.0) {
            running.swap_remove(at);
        }
    }
}

/// Whether the library at `path` has a recount running.
pub(crate) fn pass_recount_running(path: &str) -> bool {
    RECOUNTING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .any(|running| running == path)
}

/// What one recount did, for the run's last-run row and for tests.
#[derive(Debug, Clone)]
pub struct PassRecountReport {
    /// The thread the recount ran on.
    pub thread: std::thread::ThreadId,
    /// Sections it took on.
    pub sections: usize,
    /// Whether every section recounted and the rule was stamped.
    pub complete: bool,
}

impl PersistentEngine {
    /// Start the recount of every section's rows under the current pass rule,
    /// if the stamp is behind.
    ///
    /// A large upgraded library rewrites its whole junction table, which is far
    /// over the launch budget, so the recount runs on its own thread and
    /// connection, as the backup does. Screens read the stored counts until it
    /// settles, each section swapping atomically from its old rows to its new,
    /// then the engine reloads and announces. The stamp is written only when
    /// every section recounted, so an interrupted or failed run is retried on
    /// the next open. Failure is logged, not propagated: a stale count is a
    /// wrong number, and refusing to open over it would cost the athlete
    /// everything else.
    pub(crate) fn recount_passes_if_stale(&mut self) {
        if self.stored_pass_rule() >= PASS_RULE_VERSION
            || self.pass_recount.is_some()
            || self.db_path == ":memory:"
        {
            return;
        }
        let db_path = self.db_path.clone();
        let install = crate::persistence::engine_install();
        // Taken before the thread starts, so a read right after the open
        // already sees it running.
        let running = RecountRunning::begin(&db_path);
        self.pass_recount = Some(crate::threads::spawn_background(
            "veloq-recount",
            move || run_pass_recount(&db_path, install, running),
        ));
    }

    /// Wait for the recount an open started, and take its result onto this
    /// engine. `None` when no recount was running.
    #[doc(hidden)]
    pub fn wait_for_pass_recount(&mut self) -> Option<PassRecountReport> {
        let report = self.pass_recount.take()?.join().ok()?;
        if report.sections > 0 {
            self.adopt_recounted_sections();
        }
        Some(report)
    }

    fn stored_pass_rule(&self) -> i32 {
        self.db
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = ?",
                params![STAMP_KEY],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .unwrap_or(0)
    }

    /// Recount every section, each in one transaction so a reader sees a
    /// section's old rows or its new and never half. Auto, pinned and
    /// user-defined sections all go through the edit path's rematch, so
    /// exclusions and hand-attached rides carry across.
    fn recount_every_section(&mut self) -> PassRecountReport {
        let thread = std::thread::current().id();
        let ids: Vec<String> = match self.section_ids_for_recount() {
            Ok(ids) => ids,
            Err(e) => {
                log::warn!("veloqrs: [pass rule] could not list sections: {e}");
                return PassRecountReport {
                    thread,
                    sections: 0,
                    complete: false,
                };
            }
        };
        let mut complete = true;
        for id in &ids {
            let recounted = self.stored_section_polyline(id).and_then(|line| {
                self.in_write_txn(|engine| engine.rematch_section_activities(id, &line))
            });
            if let Err(e) = recounted {
                log::warn!("veloqrs: [pass rule] recount of {id} failed: {e}");
                complete = false;
            }
        }
        // The rematch writes rows with no lap time. The backfill times them
        // between the section's gates before any badge reads them.
        self.backfill_section_performance_cache();
        if !ids.is_empty()
            && let Err(e) = self.recompute_activity_indicators()
        {
            log::warn!("veloqrs: [pass rule] indicators not recomputed: {e}");
            complete = false;
        }
        if complete
            && let Err(e) = self.db.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                params![STAMP_KEY, PASS_RULE_VERSION.to_string()],
            )
        {
            log::warn!("veloqrs: [pass rule] could not stamp v{PASS_RULE_VERSION}: {e}");
            complete = false;
        }
        PassRecountReport {
            thread,
            sections: ids.len(),
            complete,
        }
    }

    /// Put this engine's memory on the rows a recount wrote on another
    /// connection.
    pub(crate) fn adopt_recounted_sections(&mut self) {
        if let Err(e) = self.load_sections() {
            log::warn!("veloqrs: [pass rule] reloading sections failed: {e}");
        }
        self.clear_memory_caches();
        self.refresh_section_rank_inputs();
    }

    /// A library with no sections holds nothing counted under any rule, so a
    /// new install is stamped at its first open and never recounts.
    pub(crate) fn stamp_pass_rule_on_empty_library(&self) {
        if let Err(e) = self.db.execute(
            "INSERT OR IGNORE INTO schema_info (key, value)
             SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sections)",
            params![STAMP_KEY, PASS_RULE_VERSION.to_string()],
        ) {
            log::warn!("veloqrs: [pass rule] could not stamp a new library: {e}");
        }
    }

    fn section_ids_for_recount(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.db.prepare("SELECT id FROM sections ORDER BY id")?;
        stmt.query_map([], |r| r.get(0))?.collect()
    }
}

fn run_pass_recount(db_path: &str, install: u64, running: RecountRunning) -> PassRecountReport {
    let thread = std::thread::current().id();
    let opened = PersistentEngine::new_for_push(db_path).and_then(|mut engine| {
        engine.load_for_push()?;
        Ok(engine)
    });
    let (report, summary_db) = match opened {
        Ok(mut engine) => {
            let report = engine.recount_every_section();
            record_pass_recount(&engine, &report);
            (report, Some(engine))
        }
        Err(e) => {
            log::warn!("veloqrs: [pass rule] recount could not open the library: {e}");
            (
                PassRecountReport {
                    thread,
                    sections: 0,
                    complete: false,
                },
                None,
            )
        }
    };
    drop(summary_db);
    if report.sections > 0 {
        crate::persistence::with_persistent_engine_for(install, |e| {
            e.adopt_recounted_sections();
        });
    }
    // Settled before the announcement, so the read it prompts sees the job
    // finished. Announced even for an empty library, which still wrote a run.
    drop(running);
    crate::objects::observer::notify(crate::objects::observer::Announcement::DetectionApplied);
    report
}

fn record_pass_recount(engine: &PersistentEngine, report: &PassRecountReport) {
    let handled = u32::try_from(report.sections).unwrap_or(u32::MAX);
    record_job_run(
        &engine.db,
        &JobRun {
            job: BackgroundJob::PassRecount,
            finished_at: crate::persistence::attempts::now_ms().into(),
            outcome: if report.complete {
                RunOutcome::Complete
            } else {
                RunOutcome::Partial
            },
            handled,
            added: 0,
            changed: handled,
            retired: 0,
            failed: 0,
        },
    );
}
