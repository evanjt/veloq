use super::error::{VeloqError, with_engine};
use super::start::FfiStartOutcome;
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::sections::DetectionRefusal;
use log::info;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::time::Duration;

/// How the last run this process finished ended, for surfaces that may look
/// but must not take.
///
/// The completion itself is a taking read: `poll_detection_once` receives it
/// from the worker's channel and whoever gets there first applies it, so a
/// second caller sees `Idle`. A status screen polling on a timer therefore
/// settles a run the follower is still waiting on, and the rescan behind it
/// reports no change. This is the observable half: written where the outcome
/// is already known, read by anyone, and it consumes nothing.
static LAST_DETECTION_OUTCOME: AtomicU8 = AtomicU8::new(OUTCOME_IDLE);

const OUTCOME_IDLE: u8 = 0;
const OUTCOME_COMPLETE: u8 = 1;
const OUTCOME_ERROR: u8 = 2;

fn record_outcome(outcome: u8) {
    LAST_DETECTION_OUTCOME.store(outcome, Ordering::Relaxed);
}

/// Put the record back to "nothing has finished here".
///
/// The atomic is process-wide and the crate's tests share one process, so a
/// test that finishes a run leaves its outcome standing for whatever runs
/// next. `clear_detection_handle` calls this, since the handle slot and the
/// outcome are the same state described twice.
#[cfg(test)]
pub(crate) fn reset_last_outcome() {
    record_outcome(OUTCOME_IDLE);
}

#[derive(uniffi::Object)]
pub struct DetectionManager {
    pub(crate) _private: (),
}

/// Outcome of one poll of the shared background-detection handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DetectionPoll {
    Idle,
    Running,
    Applied,
    Died,
}

// ============================================================================
// Waiting on the slot
// ============================================================================

/// The longest any caller waits on the detection slot before giving up.
///
/// Matched to what TypeScript already allows a run: `DETECTION_FOLLOW_MS` in
/// `useGpsDataFetcher.ts` follows a detect for 420 s before answering
/// `timeout`, and a cold re-cut over a large library legitimately takes
/// minutes. A limit under that would abandon runs that were going to finish.
pub(crate) const SLOT_WAIT_LIMIT: Duration = Duration::from_secs(420);

/// How often the slot is re-read while a run holds it.
pub(crate) const SLOT_POLL: Duration = Duration::from_millis(100);

/// How a wait on the detection slot ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SlotWait {
    /// Nothing holds the slot.
    Idle,
    /// A run finished and its result was applied.
    Applied,
    /// The worker died without sending a result.
    Died,
    /// The limit ran out with a run still going.
    TimedOut,
    /// The poll itself failed.
    Failed(String),
}

/// Poll the detection slot until it settles, or until the limit runs out.
///
/// Four loops used to do this by hand with no cap and no deadline, one of them
/// on the launch path: `WorkerPoll::Died` only fires on channel disconnect, so
/// a worker that hangs rather than panicking held them open for the life of the
/// process. Every outcome sleeps before the next read, including the terminal
/// ones a drain walks through, so a slot that keeps answering the same thing
/// costs the deadline rather than a core.
///
/// `stop_at_end` is the difference between the two callers. A drain wants the
/// slot empty, so it walks past a run that has just finished and reads again. A
/// follower wants this run's end and stops there.
///
/// The clock and the sleep are handed in so the schedule can be exercised
/// without spending seven minutes on it, the same way `resume_ladder` splits
/// its waits out.
pub(crate) fn wait_on_slot_with(
    limit: Duration,
    poll_every: Duration,
    stop_at_end: bool,
    mut poll: impl FnMut() -> Result<DetectionPoll, VeloqError>,
    mut sleep: impl FnMut(Duration),
    mut elapsed: impl FnMut() -> Duration,
) -> SlotWait {
    loop {
        if elapsed() >= limit {
            return SlotWait::TimedOut;
        }
        match poll() {
            Ok(DetectionPoll::Idle) => return SlotWait::Idle,
            Ok(DetectionPoll::Applied) if stop_at_end => return SlotWait::Applied,
            Ok(DetectionPoll::Died) if stop_at_end => return SlotWait::Died,
            Ok(_) => sleep(poll_every),
            Err(e) => return SlotWait::Failed(format!("{}", e)),
        }
    }
}

/// Detached threads currently polling the shared detection slot.
///
/// Three production paths spawn one and none of them is joined: the
/// conditioning driver (`persistence/sections/conditioning.rs`), the
/// elevation re-cut (`net/elevation_backfill.rs`) and the resume ladder's
/// drain. Each outlives the call that spawned it, and each polls through
/// `poll_detection_once`, which is the call that publishes an outcome. So a
/// driver left over from earlier work can settle a run somebody else started.
static SLOT_DRIVERS: AtomicUsize = AtomicUsize::new(0);

/// How many detached drivers are on the slot right now.
pub(crate) fn slot_drivers() -> usize {
    SLOT_DRIVERS.load(Ordering::SeqCst)
}

/// Counts one detached driver for as long as it lives.
///
/// An RAII guard rather than a pair of calls, so a driver that panics mid-poll
/// still leaves the count where it found it. A leaked count is worse than no
/// count: whoever waits on it waits for a thread that is already dead.
pub(crate) struct SlotDriver;

impl SlotDriver {
    pub(crate) fn started() -> Self {
        SLOT_DRIVERS.fetch_add(1, Ordering::SeqCst);
        Self
    }
}

impl Drop for SlotDriver {
    fn drop(&mut self) {
        SLOT_DRIVERS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// [`wait_on_slot_with`] against the real clock and the shared poll.
///
/// Counted for the whole wait. Every caller of this is polling the slot on
/// somebody else's behalf, from a thread that outlives the call, and the FFI
/// poll goes straight to `poll_detection_once` instead. So the count is
/// exactly the drivers, which is what a caller needing to be the only poller
/// has to wait out.
pub(crate) fn wait_on_slot(poll_every: Duration, stop_at_end: bool) -> SlotWait {
    let _counted = SlotDriver::started();
    let started = std::time::Instant::now();
    wait_on_slot_with(
        SLOT_WAIT_LIMIT,
        poll_every,
        stop_at_end,
        poll_detection_once,
        std::thread::sleep,
        || started.elapsed(),
    )
}

/// Poll the shared detection handle once and, when the worker has finished,
/// apply its results under the engine lock. Shared by the FFI poll (the TS
/// sync UI) and the conditioning driver: whichever caller polls Ready first
/// applies, the other sees Idle on its next poll.
///
/// Every take of the detection handle recovers a poisoned guard rather than
/// failing: one panic under the lock would otherwise kill detection for the
/// rest of the process with no way back.
pub(crate) fn poll_detection_once() -> Result<DetectionPoll, VeloqError> {
    let mut handle_guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if handle_guard.is_none() {
        return Ok(DetectionPoll::Idle);
    }

    let result = handle_guard.as_ref().unwrap().poll_state();

    match result {
        crate::persistence::WorkerPoll::Died => {
            // The worker thread died without sending (panic or early
            // abort). Clear the handle so the next start() can run,
            // otherwise detection is blocked for the rest of the session.
            *handle_guard = None;
            log::error!("veloqrs: [DetectionManager] Detection thread died without a result");
            record_outcome(OUTCOME_ERROR);
            Ok(DetectionPoll::Died)
        }
        crate::persistence::WorkerPoll::Ready((sections, detection_activity_ids)) => {
            // A self-applying run saved itself on its own thread before it
            // reported finished, so this poll has nothing to write. That is
            // the whole point of the split: the tick that happens to observe
            // completion is a JavaScript frame, and the apply is hundreds of
            // milliseconds of hot save on a real library.
            let worker_apply = handle_guard
                .as_ref()
                .map(|h| h.worker_apply())
                .unwrap_or(crate::persistence::WorkerApply::Caller);
            if worker_apply != crate::persistence::WorkerApply::Caller {
                *handle_guard = None;
                drop(handle_guard);
                if worker_apply == crate::persistence::WorkerApply::Failed {
                    // The result went into the failed attempt, so there is
                    // nothing here to save. Applying the empty message the
                    // worker sends behind it would wipe the catalogue.
                    log::error!(
                        "veloqrs: [DetectionManager] The run could not apply itself, the catalogue is unchanged"
                    );
                    return Err(VeloqError::Database {
                        msg: "detection apply failed on the worker".to_string(),
                    });
                }
                info!("veloqrs: [DetectionManager] Section detection complete");
                record_outcome(OUTCOME_COMPLETE);
                return Ok(DetectionPoll::Applied);
            }

            // Tier 1.1 split: hot save + processed_ids return synchronously
            // (sections are queryable immediately), then run the
            // indicator recompute under the engine lock as the deferred
            // tail. The total wall-clock is unchanged on the write side,
            // but get_progress() callers see the apply tail emit phase
            // events (recomputing_indicators / complete) and the UI can
            // keep showing forward motion instead of freezing on a
            // stalled "100%" bar.
            let progress = handle_guard.as_ref().map(|h| h.progress.clone());

            // Take the Unified evidence-cache update (None for the legacy
            // detectors and the short-circuit) BEFORE clearing the handle. The
            // main result is already Ready, and the worker sends the cache
            // first, so it is present now.
            let cache_update = handle_guard.as_ref().and_then(|h| h.take_cache());

            // The channel message is consumed, so this run is over whatever
            // happens next. Clear the handle before the fallible apply so
            // an apply error cannot leave detection permanently "running"
            // on a drained channel.
            *handle_guard = None;
            drop(handle_guard);

            // Hot save under the write lock - sections are queryable as soon
            // as this returns. The cache is adopted only if the save succeeds
            // and dropped if it fails, so it never outruns the applied
            // catalogue.
            with_engine(|e| {
                if let Err(err) = e.apply_sections_save_with_cache(sections, cache_update) {
                    log::error!("apply_sections_save failed: {}", err);
                    return Err(VeloqError::Database {
                        msg: format!("apply_sections_save failed: {}", err),
                    });
                }
                if let Err(err) = e.save_processed_activity_ids(&detection_activity_ids) {
                    // Non-fatal: sections WERE saved above. The
                    // consequence is that the next sync will re-detect
                    // these activities (wasted work, not data loss).
                    // Logging at warn-level with explicit "partial
                    // success" so it's distinguishable from the fatal
                    // apply_sections_save case above.
                    log::warn!(
                        "veloqrs: [DetectionManager] poll: detection apply partially \
                         succeeded - sections saved but save_processed_activity_ids \
                         failed ({} ids): {}. Next sync will re-process these activities.",
                        detection_activity_ids.len(),
                        err
                    );
                }
                Ok(())
            })??;

            // Release the write lock above before the finalize tail so any
            // queued reads see the saved sections during the indicator
            // recompute, which re-takes a separate lock.
            with_engine(|e| {
                e.apply_sections_finalize_with_progress(progress.as_ref());
                // Reload groups from DB in case the background thread
                // recomputed and saved them.
                e.reload_groups_from_db();
                Ok(())
            })??;

            info!("veloqrs: [DetectionManager] Section detection complete");
            record_outcome(OUTCOME_COMPLETE);
            Ok(DetectionPoll::Applied)
        }
        crate::persistence::WorkerPoll::Running => {
            if let Some(checkpoint) = handle_guard.as_ref().and_then(|h| h.take_checkpoint()) {
                drop(handle_guard);
                with_engine(|e| {
                    e.persist_evidence_checkpoint(&checkpoint);
                    Ok(())
                })??;
            }
            Ok(DetectionPoll::Running)
        }
    }
}

/// Whether a detection run currently holds the shared slot. A snapshot only:
/// callers that must not lose the race hold the guard themselves.
fn detection_running() -> bool {
    SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

/// Ask a running preview to stop. Cooperative and non-blocking: the preview
/// worker aborts at its next cancellation point and its poller reads
/// "cancelled".
fn cancel_running_preview() {
    // Recover the guard from a poisoned lock. Skipping the cancel would let a
    // detect start beside a preview that is still running.
    let slot = crate::persistence::sections::preview::SECTION_PREVIEW_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = slot.as_ref() {
        handle.request_cancel();
        info!("veloqrs: [DetectionManager] Cancelled the running preview");
    }
}

/// The verdict a refusal crosses the FFI as.
///
/// A switch the athlete holds is not a hold that lifts, so it answers
/// `NotConfigured` and reads as not retryable. The other two do lift, one when
/// the backfill's pass ends and one when the cutover has run, which is exactly
/// what `Held` says.
fn refusal_outcome(refusal: DetectionRefusal) -> FfiStartOutcome {
    match refusal {
        DetectionRefusal::SwitchedOff => FfiStartOutcome::NotConfigured,
        DetectionRefusal::Suspended | DetectionRefusal::CutoverOwed => FfiStartOutcome::Held,
    }
}

/// The refusal as one line of log, so the reason is in the log as well as in
/// the return.
fn refusal_reason(refusal: DetectionRefusal) -> &'static str {
    match refusal {
        DetectionRefusal::SwitchedOff => "route matching is switched off",
        DetectionRefusal::Suspended => "an elevation backfill holds the engine",
        DetectionRefusal::CutoverOwed => "a detector cutover is owed",
    }
}

#[uniffi::export]
impl DetectionManager {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    pub fn start(&self) -> Result<FfiStartOutcome, VeloqError> {
        // Refuse before touching the shared handle: installing a refused
        // handle would occupy the slot with a dead run and block the
        // backfill's final re-cut behind it.
        if crate::persistence::detection_suspended() {
            info!("veloqrs: [DetectionManager] Start refused: detection is suspended");
            return Ok(FfiStartOutcome::Held);
        }
        // A cheap refusal before the cancel below, so a start that is going to
        // lose does not cost a running preview its answer. The decision that
        // counts is made under the guard held further down.
        if detection_running() {
            info!("veloqrs: [DetectionManager] Section detection already running");
            return Ok(FfiStartOutcome::Busy);
        }

        // A real detect supersedes any running preview: the preview's answer
        // is for a catalogue that is about to move, so cancel it rather than
        // let the two runs overlap. Done before the guard is taken, because
        // `objects/preview.rs` takes the preview slot then the detection slot
        // and the reverse order here would deadlock the pair.
        cancel_running_preview();

        // Held across check, spawn and install. Releasing it to spawn lets
        // every loser start a worker of its own that rewrites `route_groups`
        // beside the winner, and then overwrite the winner's handle so the
        // run left in the slot is not the one being polled.
        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if handle_guard.is_some() {
            info!("veloqrs: [DetectionManager] Section detection already running");
            return Ok(FfiStartOutcome::Busy);
        }

        let handle = with_engine(|e| {
            e.detect_sections_background_applying(
                crate::persistence::sections::detection::ApplyOn::Worker,
            )
        })?;
        // The funnel refuses with a dead handle when a backfill takes the
        // suspension, or the detector cutover is still owed. Installing it
        // would occupy the slot with a run that never happened.
        if let Some(refusal) = crate::persistence::sections::detection_refusal(&handle) {
            info!(
                "veloqrs: [DetectionManager] Start refused: {}",
                refusal_reason(refusal)
            );
            return Ok(refusal_outcome(refusal));
        }

        *handle_guard = Some(handle);
        // The record describes the last run that finished. A run that has just
        // started has not, so the previous outcome stops being the answer the
        // moment this one takes the slot.
        record_outcome(OUTCOME_IDLE);
        info!("veloqrs: [DetectionManager] Section detection started");
        Ok(FfiStartOutcome::Started)
    }

    /// How the last finished run ended, without taking anything.
    ///
    /// A status surface reads this and `get_progress`: progress says whether a
    /// run holds the slot now, this says how the previous one ended. Neither
    /// touches the worker's channel, so neither can settle a run the follower
    /// is waiting on, which is what `poll` is for and why only the follower
    /// calls it.
    pub fn last_outcome(&self) -> String {
        match LAST_DETECTION_OUTCOME.load(Ordering::Relaxed) {
            OUTCOME_COMPLETE => "complete".to_string(),
            OUTCOME_ERROR => "error".to_string(),
            _ => "idle".to_string(),
        }
    }

    pub fn poll(&self) -> Result<String, VeloqError> {
        Ok(match poll_detection_once()? {
            DetectionPoll::Idle => "idle".to_string(),
            DetectionPoll::Running => "running".to_string(),
            DetectionPoll::Applied => "complete".to_string(),
            DetectionPoll::Died => "error".to_string(),
        })
    }

    pub fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
        let handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        Ok(handle_guard.as_ref().map(|handle| {
            let (phase, completed, total) = handle.get_progress();
            let percent = handle.progress.get_percent();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
                percent,
            }
        }))
    }

    /// Force full re-detection by clearing processed activity IDs first.
    /// This ensures all activities are re-evaluated against sections.
    /// Refuses, and says why, if detection is suspended or already running.
    pub fn force_redetect(&self) -> Result<FfiStartOutcome, VeloqError> {
        // Refuse before clearing the processed set: a refused run must not
        // cost the evidence cache, and must not park a dead handle in the
        // slot the backfill's final re-cut needs.
        if crate::persistence::detection_suspended() {
            info!("veloqrs: [DetectionManager] Force redetect refused: detection is suspended");
            return Ok(FfiStartOutcome::Held);
        }
        if detection_running() {
            info!("veloqrs: [DetectionManager] Cannot force redetect: detection already running");
            return Ok(FfiStartOutcome::Busy);
        }

        cancel_running_preview();

        // Held across check, clear, spawn and install, for the same reason as
        // `start`. The clear belongs inside it too: two losers clearing the
        // processed set behind the winner would throw away the evidence cache
        // a run that is already going has been folding into.
        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if handle_guard.is_some() {
            info!("veloqrs: [DetectionManager] Cannot force redetect: detection already running");
            return Ok(FfiStartOutcome::Busy);
        }

        // Clear processed activity IDs to force full re-evaluation
        with_engine(|e| {
            e.clear_processed_activity_ids();
        })?;

        let handle = with_engine(|e| {
            e.detect_sections_background_applying(
                crate::persistence::sections::detection::ApplyOn::Worker,
            )
        })?;
        if let Some(refusal) = crate::persistence::sections::detection_refusal(&handle) {
            info!(
                "veloqrs: [DetectionManager] Force redetect refused: {}",
                refusal_reason(refusal)
            );
            return Ok(refusal_outcome(refusal));
        }

        *handle_guard = Some(handle);
        record_outcome(OUTCOME_IDLE);
        info!("veloqrs: [DetectionManager] Forced full section re-detection started");
        Ok(FfiStartOutcome::Started)
    }

    pub fn set_config(&self, config: crate::FfiSectionConfig) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_section_config(config.into());
        })
    }

    pub fn get_config(&self) -> Result<crate::FfiSectionConfig, VeloqError> {
        with_engine(|e| crate::FfiSectionConfig::from(&e.section_config))
    }

    pub fn set_match_strictness(
        &self,
        min_match_pct: f64,
        endpoint_threshold: f64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| e.set_match_strictness(min_match_pct, endpoint_threshold))?;
        Ok(())
    }

    pub fn get_match_strictness(&self) -> Result<crate::FfiMatchStrictness, VeloqError> {
        with_engine(|e| crate::FfiMatchStrictness {
            min_match_pct: e.match_config.min_match_percentage,
            endpoint_threshold: e.match_config.endpoint_threshold,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The deadline on every wait for the detection slot.
    ///
    /// `WorkerPoll::Died` only fires on channel disconnect, so a worker that
    /// hangs rather than panicking answers `Running` for ever. Four loops
    /// polled it with no cap and no deadline, and one of them, the cutover's
    /// drain, is on the launch path.
    mod slot_wait {
        use super::super::*;
        use std::cell::{Cell, RefCell};

        const LIMIT: Duration = Duration::from_secs(420);
        const POLL: Duration = Duration::from_millis(100);
        const RUNGS: usize = 4200;

        /// Drives the wait with a fake clock the sleeps advance, so a
        /// seven-minute deadline is exercised without waiting seven minutes.
        struct Fake {
            answers: RefCell<Vec<Result<DetectionPoll, String>>>,
            last: Result<DetectionPoll, String>,
            now: Cell<Duration>,
            slept: Cell<usize>,
        }

        impl Fake {
            fn new(
                answers: Vec<Result<DetectionPoll, String>>,
                last: Result<DetectionPoll, String>,
            ) -> Self {
                Self {
                    answers: RefCell::new(answers.into_iter().rev().collect()),
                    last,
                    now: Cell::new(Duration::ZERO),
                    slept: Cell::new(0),
                }
            }

            fn run(&self, stop_at_end: bool) -> SlotWait {
                wait_on_slot_with(
                    LIMIT,
                    POLL,
                    stop_at_end,
                    || {
                        let next = self.answers.borrow_mut().pop().unwrap_or(self.last.clone());
                        next.map_err(|msg| VeloqError::Database { msg })
                    },
                    |d| {
                        self.slept.set(self.slept.get() + 1);
                        self.now.set(self.now.get() + d);
                    },
                    || self.now.get(),
                )
            }
        }

        #[test]
        fn an_empty_slot_answers_at_once_and_sleeps_none() {
            let fake = Fake::new(vec![], Ok(DetectionPoll::Idle));
            assert_eq!(fake.run(false), SlotWait::Idle);
            assert_eq!(fake.slept.get(), 0);
        }

        #[test]
        fn a_run_that_finishes_is_waited_out() {
            let fake = Fake::new(
                vec![
                    Ok(DetectionPoll::Running),
                    Ok(DetectionPoll::Running),
                    Ok(DetectionPoll::Applied),
                ],
                Ok(DetectionPoll::Idle),
            );
            assert_eq!(fake.run(false), SlotWait::Idle);
            assert_eq!(
                fake.slept.get(),
                3,
                "the applied read sleeps too, or it spins"
            );
        }

        /// The defect itself: this used to never return.
        #[test]
        fn a_run_that_hangs_costs_the_limit_and_no_more() {
            let fake = Fake::new(vec![], Ok(DetectionPoll::Running));
            assert_eq!(fake.run(false), SlotWait::TimedOut);
            assert!(fake.now.get() >= LIMIT, "gave up before the limit");
            assert_eq!(fake.slept.get(), RUNGS, "one sleep a rung, no spinning");
        }

        #[test]
        fn a_follower_stops_at_the_end_of_its_own_run() {
            let fake = Fake::new(
                vec![Ok(DetectionPoll::Running), Ok(DetectionPoll::Applied)],
                Ok(DetectionPoll::Idle),
            );
            assert_eq!(fake.run(true), SlotWait::Applied);
        }

        #[test]
        fn a_follower_stops_on_a_worker_that_died() {
            let fake = Fake::new(vec![Ok(DetectionPoll::Died)], Ok(DetectionPoll::Idle));
            assert_eq!(fake.run(true), SlotWait::Died);
        }

        /// A drain wants the slot empty, not this run's end, so it reads again
        /// past a run that has just finished and past a worker that died.
        #[test]
        fn a_drain_walks_past_an_end_to_the_empty_slot() {
            let fake = Fake::new(
                vec![Ok(DetectionPoll::Died), Ok(DetectionPoll::Applied)],
                Ok(DetectionPoll::Idle),
            );
            assert_eq!(fake.run(false), SlotWait::Idle);
            assert_eq!(fake.slept.get(), 2);
        }

        /// A slot that keeps answering the same terminal read is the hot-loop
        /// shape. The deadline holds it, and every read sleeps, so it costs no
        /// core while it waits.
        #[test]
        fn a_drain_that_never_empties_still_ends_without_spinning() {
            let fake = Fake::new(vec![], Ok(DetectionPoll::Applied));
            assert_eq!(fake.run(false), SlotWait::TimedOut);
            assert_eq!(fake.slept.get(), RUNGS);
        }

        #[test]
        fn a_failed_poll_ends_the_wait_and_carries_the_reason() {
            let fake = Fake::new(vec![Err("locked".to_string())], Ok(DetectionPoll::Idle));
            match fake.run(false) {
                SlotWait::Failed(msg) => assert!(msg.contains("locked"), "{}", msg),
                other => panic!("expected a failure, got {:?}", other),
            }
        }

        #[test]
        fn a_limit_of_zero_gives_up_before_it_polls_at_all() {
            let answered = wait_on_slot_with(
                Duration::ZERO,
                POLL,
                false,
                || panic!("must not poll"),
                |_| panic!("must not sleep"),
                || Duration::ZERO,
            );
            assert_eq!(answered, SlotWait::TimedOut);
        }
    }

    use crate::persistence::sections::detection_workers_started;
    use crate::persistence::sections::preview::SECTION_PREVIEW_HANDLE;
    use crate::test_globals::{
        clear_detection_handle, drain_detection, race, seeded_global_engine, serial_global_state,
        wait_for_slot_drivers,
    };
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::{Barrier, Mutex};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;

    pub fn init_global_engine() -> TempDir {
        crate::test_globals::init_global_engine("poison.db")
    }

    /// Panic under a lock, swallowing the unwind and the hook's output.
    pub fn poison<T>(lock: &Mutex<T>) {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            panic!("blew up under the lock");
        }));
        std::panic::set_hook(previous);
        assert!(result.is_err(), "the closure was supposed to panic");
        assert!(lock.is_poisoned(), "the lock must be poisoned now");
    }

    #[test]
    pub fn concurrent_starts_spawn_exactly_one_worker() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(|| DetectionManager::new().start().expect("start").started());

        assert_eq!(won, 1, "exactly one start may win the race");
        assert_eq!(
            detection_workers_started() - before,
            1,
            "a losing start must not leave an orphan worker behind"
        );

        drain_detection();
    }

    #[test]
    pub fn concurrent_force_redetects_spawn_exactly_one_worker() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(|| {
            DetectionManager::new()
                .force_redetect()
                .expect("redetect")
                .started()
        });

        assert_eq!(won, 1, "exactly one force redetect may win the race");
        assert_eq!(
            detection_workers_started() - before,
            1,
            "a losing force redetect must not leave an orphan worker behind"
        );

        drain_detection();
    }

    /// Expected behaviour: the second caller of an idle-then-busy slot is
    /// refused without paying for a worker, which is the non-racing shape of
    /// the same guarantee.
    #[test]
    pub fn a_second_start_while_running_costs_nothing() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert_eq!(
            manager.start().expect("first start"),
            FfiStartOutcome::Started,
            "the first start wins"
        );

        let before = detection_workers_started();
        // A held slot frees on its own, so the refusal has to say so: a caller
        // that cannot tell this from a suspension has no way to decide to wait.
        assert_eq!(
            manager.start().expect("second start"),
            FfiStartOutcome::Busy,
            "the slot is taken"
        );
        assert_eq!(
            manager.force_redetect().expect("second redetect"),
            FfiStartOutcome::Busy,
            "the slot is taken"
        );
        assert_eq!(
            detection_workers_started() - before,
            0,
            "a refused start must not spawn a worker"
        );

        drain_detection();
    }

    /// Scenario: the athlete has switched route matching off, and a screen
    /// asks for a scan anyway.
    ///
    /// Expected behaviour: the refusal says the work is switched off rather
    /// than held. A hold lifts on its own and is worth waiting for; a switch
    /// never lifts until the athlete moves it, so a caller that reads the two
    /// as one verdict either waits for ever or says nothing at all.
    #[test]
    pub fn a_start_with_detection_switched_off_says_so() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        with_engine(|e| e.set_detection_enabled(false))
            .expect("engine")
            .expect("switch off");

        let manager = DetectionManager::new();
        assert_eq!(
            manager.start().expect("start"),
            FfiStartOutcome::NotConfigured,
            "a switched-off library is not a hold that lifts"
        );
        assert_eq!(
            manager.force_redetect().expect("redetect"),
            FfiStartOutcome::NotConfigured,
            "the force path answers the same way"
        );
        assert!(
            !manager.start().expect("start").is_retryable(),
            "nothing changes by asking again"
        );

        assert!(
            SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_none(),
            "a refused run must not occupy the slot"
        );
        assert_eq!(
            detection_workers_started() - before,
            0,
            "a refused run must not spawn a worker"
        );

        with_engine(|e| e.set_detection_enabled(true))
            .expect("engine")
            .expect("switch back on");
    }

    /// Expected behaviour: a suspension refuses every arm, and a refusal must
    /// leave the slot empty so the backfill's own re-cut can take it.
    #[test]
    pub fn a_suspended_start_installs_nothing() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let _suspension = crate::persistence::suspend_detection();
        let manager = DetectionManager::new();
        assert_eq!(
            manager.start().expect("start"),
            FfiStartOutcome::Held,
            "suspended start refuses, and names the hold"
        );
        assert_eq!(
            manager.force_redetect().expect("redetect"),
            FfiStartOutcome::Held,
            "suspended force redetect refuses, and names the hold"
        );

        assert!(
            SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_none(),
            "a refused run must not occupy the slot"
        );
        assert_eq!(
            detection_workers_started() - before,
            0,
            "a refused run must not spawn a worker"
        );
    }

    /// Watch a run to its end through its own progress, never through
    /// `poll_detection_once`: the poll is what applied the result under the
    /// old shape, so polling here would hide the thing under test. Returns
    /// the last phase seen.
    pub fn wait_for_the_run_to_apply(manager: &DetectionManager) -> String {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let phase = manager
                .get_progress()
                .expect("progress")
                .map(|p| p.phase)
                .unwrap_or_default();
            if phase == "complete" || Instant::now() >= deadline {
                return phase;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Expected behaviour: a run applies its own result before it reports
    /// finished, so the 500 ms tick that happens to observe completion has no
    /// write to do on the thread that called it.
    #[test]
    pub fn a_run_applies_before_it_reports_finished() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started(), "the run starts");

        let phase = wait_for_the_run_to_apply(&manager);
        assert_eq!(
            phase, "complete",
            "the run has to apply itself with nothing polling it, it stalled at {:?}",
            phase
        );

        let (poll, held) = timed_poll_to_completion();
        assert_eq!(
            poll,
            DetectionPoll::Applied,
            "the poll that observes completion still reports the run applied"
        );
        assert!(
            held < Duration::from_millis(16),
            "the poll that observes completion has to stay inside one frame, it held {:?}",
            held
        );

        assert_eq!(
            poll_detection_once().expect("second poll"),
            DetectionPoll::Idle,
            "the applied run leaves the slot free"
        );
    }

    /// Scenario: the background-jobs screen polled the completion on a one
    /// second timer, so with that screen open it took the result and the
    /// follower waiting on the same run saw idle and called it a clean settle.
    ///
    /// Expected behaviour: how the last run ended is readable without taking
    /// anything, so a status surface can show it and the follower still gets
    /// the completion.
    #[test]
    pub fn the_last_outcome_is_readable_without_taking_the_completion() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        // The five reads below assert that nothing has polled yet, which only
        // holds while this test is the only poller. A detached driver from an
        // earlier test polls the same slot and would take this run's
        // completion out from under them.
        wait_for_slot_drivers();

        let manager = DetectionManager::new();
        assert_eq!(
            manager.last_outcome(),
            "idle",
            "nothing has finished in this process yet"
        );

        assert!(manager.start().expect("start").started(), "the run starts");
        wait_for_the_run_to_apply(&manager);

        // Read it as often as a one second timer would, before anything polls.
        for _ in 0..5 {
            assert_eq!(
                manager.last_outcome(),
                "idle",
                "the run has not settled yet"
            );
        }

        assert_eq!(
            timed_poll_to_completion().0,
            DetectionPoll::Applied,
            "the completion is still there for the caller that follows the run"
        );
        assert_eq!(
            manager.last_outcome(),
            "complete",
            "and how it ended is readable afterwards"
        );
        assert_eq!(
            manager.last_outcome(),
            "complete",
            "reading it does not consume it either"
        );

        assert!(
            manager.start().expect("second start").started(),
            "a second run starts"
        );
        assert_eq!(
            manager.last_outcome(),
            "idle",
            "a started run has not finished, so the previous outcome stops being the answer"
        );
        wait_for_the_run_to_apply(&manager);
        timed_poll_to_completion();
    }

    /// Scenario: the outcome is a process-wide atomic and the crate's tests
    /// share one process, so a test that finishes a run leaves its result
    /// standing for whatever runs next. `serial_global_state()` orders nothing,
    /// it only serialises, so which test that is comes down to cargo's
    /// scheduling.
    ///
    /// Expected behaviour: the fixture that clears the handle clears the
    /// outcome with it. They are one state, "no run has happened here", and a
    /// fixture that resets half of it hands the next test the other half.
    #[test]
    fn clearing_the_handle_clears_the_outcome_that_belongs_to_it() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started(), "the run starts");
        wait_for_the_run_to_apply(&manager);
        assert_eq!(timed_poll_to_completion().0, DetectionPoll::Applied);
        assert_eq!(manager.last_outcome(), "complete", "the run finished");

        clear_detection_handle();
        assert_eq!(
            manager.last_outcome(),
            "idle",
            "the outcome outlived the handle, so the next test to clear the \
             handle starts on this run's result"
        );
    }

    /// Scenario: `wait_on_slot` is what three detached production threads run,
    /// and each of them polls the shared slot. A driver spawned by an earlier
    /// test outlives the test that spawned it, so it is still polling when the
    /// next one starts, takes that run's completion and publishes `complete`
    /// while the next test is still asserting the run has not settled.
    ///
    /// Expected behaviour: a driver on the slot is counted while it runs, so a
    /// test that needs to be the only poller can wait for the count to reach
    /// zero instead of hoping.
    #[test]
    fn a_driver_on_the_slot_is_counted_while_it_runs() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        wait_for_slot_drivers();

        let at_work = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let (started, freed) = (at_work.clone(), release.clone());
        let driver = std::thread::spawn(move || {
            let _counted = SlotDriver::started();
            started.wait();
            freed.wait();
        });

        at_work.wait();
        assert_eq!(slot_drivers(), 1, "the driver is counted while it lives");

        release.wait();
        wait_for_slot_drivers();
        assert_eq!(
            slot_drivers(),
            0,
            "and the wait does not return until it is gone"
        );
        driver.join().expect("the driver ends");
    }

    /// A driver that panics still leaves the count where it found it, or the
    /// next test waits forever on a thread that is already dead.
    #[test]
    fn a_driver_that_panics_is_still_uncounted() {
        let _serial = serial_global_state();
        wait_for_slot_drivers();

        let before = slot_drivers();
        let died = std::thread::spawn(|| {
            let _counted = SlotDriver::started();
            panic!("the driver dies mid-poll");
        });
        assert!(died.join().is_err(), "the driver panicked");

        assert_eq!(slot_drivers(), before, "an unwind drops the guard");
    }

    /// The poll that observes completion, timed. A `Running` poll or two can
    /// precede it: the worker posts its result just after the last phase
    /// marker, so the phase leads the channel by a hair.
    pub fn timed_poll_to_completion() -> (DetectionPoll, Duration) {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let started = Instant::now();
            let poll = poll_detection_once().expect("poll");
            let held = started.elapsed();
            if poll != DetectionPoll::Running || Instant::now() >= deadline {
                return (poll, held);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// A section standing on the fixture's own activities, so a catalogue can
    /// be seeded without a detector run finding one.
    pub fn seeded_section() -> crate::FrequentSection {
        let activity_ids = vec!["a0".to_string(), "a1".to_string()];
        crate::FrequentSection {
            id: "seeded-1".to_string(),
            name: None,
            sport_type: "Ride".to_string(),
            polyline: (0..50)
                .map(|i| tracematch::GpsPoint::new(46.2 + f64::from(i) * 0.0002, 7.35))
                .collect(),
            representative_activity_id: "a0".to_string(),
            representative_range: None,
            activity_portions: activity_ids
                .iter()
                .map(|id| crate::SectionPortion {
                    activity_id: id.clone(),
                    start_index: 0,
                    end_index: 7,
                    distance_meters: 1_000.0,
                    direction: tracematch::Direction::Same,
                })
                .collect(),
            activity_ids,
            visit_count: 2,
            distance_meters: 1_000.0,
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.8,
            observation_count: 2,
            average_spread: 10.0,
            point_density: vec![2; 50],
            scale: Some(tracematch::sections::ScaleName::Medium),
            is_user_defined: false,
            stability: 0.0,
            elevation_gain_m: None,
            avg_grade_percent: None,
            version: 1,
            updated_at: None,
            created_at: Some("2026-01-28T00:00:00Z".to_string()),
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        }
    }

    /// A global engine holding a catalogue with every activity already
    /// processed, which is what the no-new-activities echo needs: it re-sends
    /// the last batch rather than folding anything.
    pub fn engine_with_a_catalogue() -> TempDir {
        let tmp = seeded_global_engine();
        with_engine(|engine| {
            engine
                .apply_sections(vec![seeded_section()])
                .expect("seed the catalogue");
            let ids: Vec<String> = (0..6).map(|i| format!("a{}", i)).collect();
            engine
                .save_processed_activity_ids(&ids)
                .expect("nothing is left unprocessed");
        })
        .expect("engine");
        assert_eq!(
            with_engine(|e| e.get_sections().len()).expect("engine"),
            1,
            "the fixture has to leave a catalogue for the echo to write"
        );
        tmp
    }

    /// Expected behaviour: the start that finds nothing new echoes the last
    /// batch, which is still a full catalogue write. It applies on a thread
    /// of its own too, so the poll behind it is as cheap as the first.
    #[test]
    pub fn a_run_with_nothing_new_applies_off_the_poller_as_well() {
        let _serial = serial_global_state();
        let _tmp = engine_with_a_catalogue();
        clear_detection_handle();

        let found = with_engine(|e| e.get_sections().len()).expect("engine");
        let manager = DetectionManager::new();
        assert!(
            manager.start().expect("start").started(),
            "the echo run starts"
        );
        assert_eq!(
            wait_for_the_run_to_apply(&manager),
            "complete",
            "the echo applies with nothing polling it"
        );

        let (poll, held) = timed_poll_to_completion();
        assert_eq!(poll, DetectionPoll::Applied, "the echo reports applied");
        assert!(
            held < Duration::from_millis(16),
            "the poll behind the echo has to stay inside one frame, it held {:?}",
            held
        );
        assert_eq!(
            with_engine(|e| e.get_sections().len()).expect("engine"),
            found,
            "the echo leaves the catalogue where it stood"
        );
    }

    /// Expected behaviour: a run that could not apply itself reports the
    /// failure. Its result went with the attempt, so saving the empty message
    /// it sends behind would replace the catalogue with nothing.
    #[test]
    pub fn a_run_that_could_not_apply_itself_saves_nothing() {
        let _serial = serial_global_state();
        let _tmp = engine_with_a_catalogue();
        clear_detection_handle();

        let held = with_engine(|e| e.get_sections().len()).expect("engine");

        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) =
            Some(crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply());

        assert!(
            poll_detection_once().is_err(),
            "the poll has to report an apply that never landed"
        );
        assert_eq!(
            with_engine(|e| e.get_sections().len()).expect("engine"),
            held,
            "a failed apply leaves the catalogue alone"
        );
        assert_eq!(
            poll_detection_once().expect("second poll"),
            DetectionPoll::Idle,
            "the failed run still frees the slot"
        );
    }

    #[test]
    pub fn detection_survives_a_poisoned_handle_lock() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();

        poison(&SECTION_DETECTION_HANDLE);

        assert_eq!(
            poll_detection_once().expect("poll must not answer LockFailed"),
            DetectionPoll::Idle,
            "an empty handle reads Idle through a poisoned lock"
        );

        let manager = DetectionManager::new();
        assert!(
            manager
                .start()
                .expect("start must not answer LockFailed")
                .started(),
            "detection still starts after the handle lock is poisoned"
        );
        assert!(
            manager.get_progress().is_ok(),
            "progress still reads after the handle lock is poisoned"
        );

        clear_detection_handle();
    }

    #[test]
    pub fn a_poisoned_preview_lock_still_cancels() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();

        poison(&SECTION_PREVIEW_HANDLE);

        // Silently skipping the cancel is the failure this guards: a detect
        // would then start beside a preview that is still running.
        cancel_running_preview();

        let manager = DetectionManager::new();
        assert!(
            manager
                .start()
                .expect("start must not answer LockFailed")
                .started(),
            "a detect starts after cancelling through a poisoned preview lock"
        );

        clear_detection_handle();
    }

    /// Scenario: a conditioning run spawns a driver thread that polls the
    /// shared detection slot every 250 ms until it reads idle. The thread
    /// outlives the test that started it, and the crate's tests share one
    /// process, so it is still polling when the next test installs a run of
    /// its own. That poll applies the result and records the outcome, which is
    /// the completion the next test was waiting to take.
    mod a_driver_from_an_earlier_run {
        use super::*;
        use crate::persistence::sections::conditioning::{
            conditioning_drivers_live, try_start_conditioning,
        };

        #[test]
        pub fn does_not_outlive_the_reset() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();

            assert!(try_start_conditioning(), "a conditioning run starts");
            assert!(
                conditioning_drivers_live() > 0,
                "its driver is polling the slot"
            );

            clear_detection_handle();

            assert_eq!(
                conditioning_drivers_live(),
                0,
                "a driver left polling takes the next run's completion"
            );
            drain_detection();
        }

        #[test]
        pub fn cannot_take_the_next_run_s_completion() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();

            assert!(try_start_conditioning(), "a conditioning run starts");
            clear_detection_handle();

            let manager = DetectionManager::new();
            assert!(manager.start().expect("start").started(), "the run starts");
            wait_for_the_run_to_apply(&manager);

            assert_eq!(
                manager.last_outcome(),
                "idle",
                "nothing has polled this run, so nothing has settled it"
            );
            assert_eq!(
                timed_poll_to_completion().0,
                DetectionPoll::Applied,
                "and the completion is still there for the caller that follows it"
            );
        }
    }
}
