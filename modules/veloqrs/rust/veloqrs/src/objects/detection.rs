use super::error::{VeloqError, with_engine, with_reader};
use super::start::{FfiStartOutcome, FfiStartResult};
use crate::persistence::attempts::{Claim, JobKey, Release, now_ms};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::sections::DetectionRefusal;
use log::{info, warn};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

/// Status of the current or most recently finished run for read-only surfaces.
/// A start resets it to idle until the run ends.
static LAST_DETECTION_OUTCOME: AtomicU8 = AtomicU8::new(OUTCOME_IDLE);
static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);
static RUN_OUTCOMES: LazyLock<Mutex<RunOutcomes>> =
    LazyLock::new(|| Mutex::new(RunOutcomes::default()));

#[derive(Default)]
struct RunOutcomes {
    latest: u64,
    terminal: HashMap<u64, u8>,
}

const OUTCOME_IDLE: u8 = 0;
const OUTCOME_COMPLETE: u8 = 1;
const OUTCOME_ERROR: u8 = 2;

fn record_outcome(outcome: u8) {
    LAST_DETECTION_OUTCOME.store(outcome, Ordering::Relaxed);
}

pub(crate) fn record_started_run(slot: &crate::persistence::CheckpointSlot) {
    slot.mark_run_id(NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed));
    record_outcome(OUTCOME_IDLE);
}

fn record_run_outcome(slot: &crate::persistence::CheckpointSlot, outcome: u8) {
    record_outcome(outcome);
    if outcome == OUTCOME_ERROR {
        crate::persistence::sections::detection::record_failed_run(slot.install());
    }
    let run_id = slot.run_id();
    if run_id != 0 {
        let mut outcomes = RUN_OUTCOMES.lock().unwrap_or_else(|e| e.into_inner());
        outcomes.latest = run_id;
        outcomes.terminal.insert(run_id, outcome);
    }
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
    *RUN_OUTCOMES.lock().unwrap_or_else(|e| e.into_inner()) = RunOutcomes::default();
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
/// Sized on the work, not on any screen: a cold re-cut over a large library
/// legitimately takes minutes, and a limit under that would abandon runs that
/// were going to finish. TypeScript stops watching at two minutes and says the
/// run is still going, which is a screen giving up and not a caller: this wait
/// is off the screen and outlives it.
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
    poll: impl FnMut() -> Result<DetectionPoll, VeloqError>,
    sleep: impl FnMut(Duration),
    elapsed: impl FnMut() -> Duration,
) -> SlotWait {
    wait_on_slot_counting(
        &SLOT_TIMEOUTS,
        limit,
        poll_every,
        stop_at_end,
        poll,
        sleep,
        elapsed,
    )
}

/// The same wait, counting its give-ups where it is told to.
///
/// Production counts into `SLOT_TIMEOUTS`, which is process-wide and which
/// every caller and every other test reaches. A test that asserts one wait
/// counted once needs a counter nobody else holds, or it reads a neighbour's
/// increment and fails in a full run rather than on the test that caused it.
pub(crate) fn wait_on_slot_counting(
    timeouts: &AtomicU32,
    limit: Duration,
    poll_every: Duration,
    stop_at_end: bool,
    mut poll: impl FnMut() -> Result<DetectionPoll, VeloqError>,
    mut sleep: impl FnMut(Duration),
    mut elapsed: impl FnMut() -> Duration,
) -> SlotWait {
    loop {
        if elapsed() >= limit {
            timeouts.fetch_add(1, Ordering::Relaxed);
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
/// drain. Each outlives the call that spawned it. A following driver uses
/// `poll_detection_once_for_follower` and a draining driver uses
/// `poll_detection_once`, so either can settle a run somebody else started.
static SLOT_DRIVERS: AtomicUsize = AtomicUsize::new(0);

/// Waits on the slot that ran out of time rather than reaching an end.
///
/// `wait_on_slot` answers `SlotWait::TimedOut` properly and three of its four
/// callers fold it into a `warn!` and carry on, so a seven-minute wait that
/// expired and one that succeeded were the same thing to everything
/// downstream, on a build where the log line is stripped or unread. Counting
/// it here covers every caller at once and changes none of their behaviour:
/// the give-up becomes a fact somebody can read rather than only a line
/// somebody has to be watching for.
static SLOT_TIMEOUTS: AtomicU32 = AtomicU32::new(0);

/// How many detached drivers are on the slot right now. Read by the test
/// globals alone: production never waits on this, it only counts.
#[cfg(test)]
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
/// polls use `poll_detection_once_for_follower` or a recorded verdict without
/// entering this wait. The count is exactly the drivers a caller must wait out.
pub(crate) fn wait_on_slot(poll_every: Duration, stop_at_end: bool) -> SlotWait {
    let _counted = SlotDriver::started();
    let started = std::time::Instant::now();
    wait_on_slot_with(
        SLOT_WAIT_LIMIT,
        poll_every,
        stop_at_end,
        || {
            if stop_at_end {
                poll_detection_once_for_follower()
            } else {
                poll_detection_once()
            }
        },
        std::thread::sleep,
        || started.elapsed(),
    )
}

/// Section detection's identity on the attempt store. One key: there is one
/// detection slot for the whole catalogue, so there is nothing to discriminate
/// on.
pub(crate) fn detect_key() -> JobKey {
    JobKey::new("section_detect", &[])
}

/// What a claim on that key means for a start.
///
/// A pure mapping, so the taxonomy is read rather than exercised through a
/// worker. `BackingOff` is `Held` and not `Busy`: nothing else holds the key,
/// the last run failed, and this one would too. `Held` is the answer for work
/// a stage that does finish is keeping back, and it is retryable.
fn outcome_for_claim(claim: Claim) -> Result<(), FfiStartResult> {
    match claim {
        Claim::Taken => Ok(()),
        Claim::InFlight => Err(FfiStartOutcome::Busy.into()),
        Claim::BackingOff { until } => {
            info!("veloqrs: [DetectionManager] section_detect is backing off until {until}");
            Err(FfiStartResult::backing_off(until))
        }
    }
}

/// Claim the detect key, or say why the start does not happen.
///
/// An engine that is not open yet is `NotReady` rather than a refusal that
/// will never lift: the lease lives in the engine, so nothing is known about
/// the key until it opens. Same reading as `spawn_once`.
pub(crate) fn claim_detect() -> Result<(), FfiStartResult> {
    claim_detect_for(crate::persistence::engine_install())
}

pub(crate) fn claim_detect_for(install: u64) -> Result<(), FfiStartResult> {
    match crate::persistence::with_persistent_engine_for(install, |engine| {
        engine.claim_job(&detect_key(), now_ms())
    }) {
        None => Err(FfiStartOutcome::NotReady.into()),
        Some(Err(e)) => {
            log::warn!("veloqrs: [DetectionManager] could not claim section_detect: {e}");
            Err(FfiStartOutcome::NotReady.into())
        }
        Some(Ok(claim)) => outcome_for_claim(claim),
    }
}

/// Give the detect key back, saying how the run ended.
///
/// Called at every terminal transition of a run, which is the same set of
/// points that records the outcome. A key never released is detection wedged
/// for the session, so a path that clears the handle clears this too.
pub(crate) fn settle_detect(release: Release) {
    settle_detect_for(crate::persistence::engine_install(), release);
}

pub(crate) fn settle_detect_for(install: u64, release: Release) {
    crate::persistence::with_persistent_engine_for(install, |engine| {
        if let Err(e) = engine.release_job(&detect_key(), release, now_ms()) {
            log::warn!("veloqrs: [DetectionManager] could not release section_detect: {e}");
        }
    });
}

fn settle_claimed_detect(slot: &crate::persistence::CheckpointSlot, release: Release) {
    if slot.detect_claimed() {
        settle_detect_for(slot.install(), release);
    }
}

/// Settle only the self-applying run that still owns this slot.
pub(crate) fn settle_finished_worker(slot: &Arc<crate::persistence::CheckpointSlot>) {
    let mut guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(handle) = guard.as_ref() else {
        return;
    };
    if !Arc::ptr_eq(&handle.checkpoint_slot(), slot) {
        return;
    }
    let cancelled =
        handle.get_progress().0 == crate::persistence::sections::detection::PHASE_CANCELLED;
    let applied = handle.worker_apply() == crate::persistence::WorkerApply::Landed;
    *guard = None;
    if cancelled {
        record_run_outcome(slot, OUTCOME_IDLE);
        settle_claimed_detect(slot, Release::Done);
    } else if applied {
        record_run_outcome(slot, OUTCOME_COMPLETE);
        settle_claimed_detect(slot, Release::Done);
    } else {
        record_run_outcome(slot, OUTCOME_ERROR);
        settle_claimed_detect(
            slot,
            Release::failed(
                FfiStartOutcome::Failed,
                Some("the detection worker ended without applying"),
            ),
        );
    }
}

/// Poll the shared detection handle once. The worker applies and settles its
/// own run, so a poll after completion reads an empty slot.
///
/// Every take of the detection handle recovers a poisoned guard rather than
/// failing: one panic under the lock would otherwise kill detection for the
/// rest of the process with no way back.
pub(crate) fn poll_detection_once() -> Result<DetectionPoll, VeloqError> {
    poll_detection_once_with(|| {})
}

fn poll_detection_once_for_follower() -> Result<DetectionPoll, VeloqError> {
    poll_detection_once_inner(|| {}, true)
}

fn poll_followed_run(run_id: &str) -> Result<String, VeloqError> {
    poll_followed_run_with(run_id, || {})
}

fn poll_followed_run_with(run_id: &str, after_prior: impl FnOnce()) -> Result<String, VeloqError> {
    let current = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|handle| handle.checkpoint_slot().run_id())
        .unwrap_or(0);
    let latest = RUN_OUTCOMES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .latest;
    let expected = if run_id.is_empty() {
        if current == 0 { latest } else { current }
    } else {
        run_id.parse::<u64>().unwrap_or(0)
    };
    let prior = recorded_run_outcome(expected);
    if let Some(outcome) = prior {
        return Ok(format!("{expected}:{}", outcome_name(outcome)));
    }
    after_prior();
    let polled = match poll_detection_once_for_follower() {
        Ok(polled) => polled,
        Err(error) => {
            if let Some(outcome) = recorded_run_outcome(expected) {
                return Ok(format!("{expected}:{}", outcome_name(outcome)));
            }
            return Err(error);
        }
    };
    let terminal = recorded_run_outcome(expected);
    let status = match terminal {
        Some(outcome) => outcome_name(outcome),
        _ if expected == current && current != 0 => "running",
        _ if expected == 0 => match polled {
            DetectionPoll::Applied => "complete",
            DetectionPoll::Died => "error",
            DetectionPoll::Running => "running",
            DetectionPoll::Idle => "idle",
        },
        _ => "error",
    };
    Ok(format!("{expected}:{status}"))
}

fn recorded_run_outcome(run_id: u64) -> Option<u8> {
    RUN_OUTCOMES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .terminal
        .get(&run_id)
        .copied()
}

fn outcome_name(outcome: u8) -> &'static str {
    match outcome {
        OUTCOME_COMPLETE => "complete",
        OUTCOME_ERROR => "error",
        _ => "idle",
    }
}

fn poll_detection_once_with(after_slot_clear: impl FnOnce()) -> Result<DetectionPoll, VeloqError> {
    poll_detection_once_inner(after_slot_clear, false)
}

fn poll_detection_once_inner(
    after_slot_clear: impl FnOnce(),
    follow_idle: bool,
) -> Result<DetectionPoll, VeloqError> {
    let mut handle_guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if handle_guard.is_none() {
        return Ok(if follow_idle {
            match LAST_DETECTION_OUTCOME.load(Ordering::Relaxed) {
                OUTCOME_COMPLETE => DetectionPoll::Applied,
                OUTCOME_ERROR => DetectionPoll::Died,
                _ => DetectionPoll::Idle,
            }
        } else {
            DetectionPoll::Idle
        });
    }

    let slot = handle_guard.as_ref().unwrap().checkpoint_slot();
    let install = slot.install();
    // Zero is the gap between publishing a handle and `mark_installed`. A
    // settle against it is refused and the lease would stay taken for the
    // session, so the run is left for `mark_installed`, which settles a worker
    // that finished first.
    if install == 0 {
        return Ok(DetectionPoll::Running);
    }
    let result = handle_guard.as_ref().unwrap().poll_state();

    match result {
        crate::persistence::WorkerPoll::Died => {
            // A run that was asked to stop leaves the channel gone too, and it
            // is not a failure: the worker did what it was told. Read the phase
            // before clearing the handle, since that is what tells the two
            // apart.
            let cancelled = handle_guard.as_ref().is_some_and(|h| {
                h.get_progress().0 == crate::persistence::sections::detection::PHASE_CANCELLED
            });
            // The worker thread died without sending (panic or early
            // abort). Clear the handle so the next start() can run,
            // otherwise detection is blocked for the rest of the session.
            *handle_guard = None;
            if cancelled {
                info!("veloqrs: [DetectionManager] Detection cancelled, the slot is free");
                record_run_outcome(&slot, OUTCOME_IDLE);
                // A run that was asked to stop did what it was told, so the
                // key starts clean: backing it off would hold the next detect
                // back for a cancel the athlete made.
                settle_claimed_detect(&slot, Release::Done);
            } else {
                log::error!("veloqrs: [DetectionManager] Detection thread died without a result");
                record_run_outcome(&slot, OUTCOME_ERROR);
                settle_claimed_detect(
                    &slot,
                    Release::failed(
                        FfiStartOutcome::Failed,
                        Some("the detection thread died without a result"),
                    ),
                );
            }
            Ok(DetectionPoll::Died)
        }
        crate::persistence::WorkerPoll::Ready(_) => {
            let worker_apply = handle_guard
                .as_ref()
                .map(|h| h.worker_apply())
                .unwrap_or(crate::persistence::WorkerApply::Caller);
            *handle_guard = None;
            // A new start publishes Idle under this same slot lock. Publish
            // this run's verdict before the slot is free for that start.
            record_run_outcome(
                &slot,
                if worker_apply == crate::persistence::WorkerApply::Landed {
                    OUTCOME_COMPLETE
                } else {
                    OUTCOME_ERROR
                },
            );
            drop(handle_guard);
            after_slot_clear();
            match worker_apply {
                crate::persistence::WorkerApply::Landed => {
                    info!("veloqrs: [DetectionManager] Section detection complete");
                    settle_claimed_detect(&slot, Release::Done);
                    Ok(DetectionPoll::Applied)
                }
                crate::persistence::WorkerApply::Caller
                | crate::persistence::WorkerApply::Failed => {
                    log::error!(
                        "veloqrs: [DetectionManager] Run in shared slot did not apply on worker"
                    );
                    settle_claimed_detect(
                        &slot,
                        Release::failed(
                            FfiStartOutcome::Failed,
                            Some("the run did not apply on its worker"),
                        ),
                    );
                    Err(VeloqError::Database {
                        msg: "detection did not apply on worker".to_string(),
                    })
                }
            }
        }
        crate::persistence::WorkerPoll::Running => {
            if let Some((install, checkpoint)) = handle_guard.as_ref().and_then(|h| {
                h.take_checkpoint()
                    .map(|checkpoint| (h.checkpoint_slot().install(), checkpoint))
            }) {
                drop(handle_guard);
                persist_checkpoint(install, checkpoint);
            }
            Ok(DetectionPoll::Running)
        }
    }
}

/// Persist the checkpoints of a run started from TypeScript.
///
/// The conditioning path has had a driver since it was written; `start` and
/// `force_redetect` had none, and TypeScript's follower reads the engine once
/// at start and once on `detectionApplied`, never on the clock. So
/// `persist_evidence_checkpoint` never ran on the one path that most needs it:
/// a `force_redetect` clears the processed set and the evidence cache, so it is
/// a cold rebatch of minutes that resumed from nothing when the OS killed it.
///
/// It writes checkpoints and nothing else. The worker applies and settles
/// the run, so this thread never needs to read the result channel.
///
/// It follows the run it was spawned for and no other, by holding that run's
/// own checkpoint slot: a handle in the shared slot whose slot is a different
/// one is somebody else's run, and this thread is done.
fn spawn_checkpoint_driver(install: u64) {
    const DRIVER_POLL: Duration = Duration::from_millis(250);

    let Some(slot) = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|h| h.checkpoint_slot())
    else {
        return;
    };

    // Counted before the thread starts, so a caller that asks straight after
    // the start does not race the spawn and read no driver at all.
    let counted = SlotDriver::started();
    crate::threads::spawn_named("veloq-ckpt", move || {
        let _counted = counted;
        let started = std::time::Instant::now();
        loop {
            std::thread::sleep(DRIVER_POLL);
            if !still_running(&slot) {
                return;
            }
            if let Some(checkpoint) = slot.take() {
                persist_checkpoint(install, checkpoint);
            }
            if started.elapsed() > SLOT_WAIT_LIMIT {
                log::warn!(
                    "veloqrs: [DetectionManager] checkpoint driver gave up after {:?}",
                    started.elapsed()
                );
                return;
            }
        }
    });
}

/// Whether the run that owns `slot` still holds the shared handle.
fn still_running(slot: &Arc<crate::persistence::CheckpointSlot>) -> bool {
    SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|h| Arc::ptr_eq(&h.checkpoint_slot(), slot))
}

/// Write one checkpoint, paying the encode off the engine lock.
///
/// The encode is the expensive half, about 75 ms at 1,000 activities. Run under
/// the lock it was that long a hold every two seconds for the length of the
/// detect, and every screen read arriving inside one waited it out. So the lock
/// is taken twice and briefly instead: once for the digest, once for the write.
pub(crate) fn persist_checkpoint(install: u64, checkpoint: crate::persistence::CacheUpdate) {
    persist_checkpoint_with(install, checkpoint, || {});
}

fn persist_checkpoint_with(
    install: u64,
    checkpoint: crate::persistence::CacheUpdate,
    after_digest: impl FnOnce(),
) {
    if checkpoint.folded_ids.is_empty() {
        return;
    }
    let Some(digest) =
        crate::persistence::with_persistent_engine_for(install, |e| e.evidence_config_digest())
    else {
        return;
    };
    after_digest();
    let row = crate::persistence::sections::detection::encode_evidence_row(
        &checkpoint.cache,
        &checkpoint.folded_ids,
        digest,
    );
    if let Some(row) = row {
        let _ = crate::persistence::with_persistent_engine_for(install, |e| {
            e.write_evidence_row(&row);
        });
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

fn refusal_result(refusal: DetectionRefusal) -> FfiStartResult {
    refusal_outcome(refusal).into()
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

fn start_with(after_claim: impl FnOnce()) -> Result<FfiStartResult, VeloqError> {
    // Refuse before touching the shared handle: installing a refused
    // handle would occupy the slot with a dead run and block the
    // backfill's final re-cut behind it.
    if crate::persistence::detection_suspended() {
        log::warn!(
            "veloqrs: [DetectionManager] Start refused: {}",
            refusal_reason(DetectionRefusal::Suspended)
        );
        return Ok(FfiStartOutcome::Held.into());
    }
    // A cheap refusal before the cancel below, so a start that is going to
    // lose does not cost a running preview its answer. The decision that
    // counts is made under the guard held further down.
    if detection_running() {
        info!("veloqrs: [DetectionManager] Section detection already running");
        return Ok(FfiStartOutcome::Busy.into());
    }
    // Before the preview is cancelled and before the pool is read: a run
    // inside its backoff is not going to happen, so it must not cost a
    // running preview its answer either.
    if let Err(refusal) = claim_detect() {
        return Ok(refusal);
    }
    after_claim();

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
        // This start did no work. Preserve an earlier failure count when
        // the run holding the slot did not claim the key.
        settle_detect(Release::Deferred);
        return Ok(FfiStartOutcome::Busy.into());
    }

    let (install, handle) = with_engine(|e| {
        (
            crate::persistence::engine_install(),
            e.detect_sections_background_applying(
                crate::persistence::sections::detection::ApplyOn::Worker,
            ),
        )
    })?;
    // The funnel refuses with a dead handle when a backfill takes the
    // suspension, or the detector cutover is still owed. Installing it
    // would occupy the slot with a run that never happened.
    if let Some(refusal) = crate::persistence::sections::detection_refusal(&handle) {
        // `warn!` rather than `info!`: a release build filters the
        // engine's log at Warn (`log_level` in `lib.rs`), so at `info!` this
        // said nothing on the CI runner, where detection is held for a
        // whole flow and the only evidence was a screenshot.
        warn!(
            "veloqrs: [DetectionManager] Start refused: {}",
            refusal_reason(refusal)
        );
        // Nothing ran, so nothing failed. A backoff for a suspension or an
        // owed cutover would hold detection back after the stage that
        // refused it has finished.
        settle_detect(Release::Deferred);
        return Ok(refusal_result(refusal));
    }

    let slot = handle.checkpoint_slot();
    slot.mark_detect_claimed();
    // The record describes the last run that finished. A run that has just
    // started has not, so the previous outcome stops being the answer the
    // moment this one takes the slot.
    record_started_run(&slot);
    *handle_guard = Some(handle);
    drop(handle_guard);
    slot.mark_installed(install);
    spawn_checkpoint_driver(install);
    info!("veloqrs: [DetectionManager] Section detection started");
    Ok(FfiStartOutcome::Started.into())
}

fn force_redetect_with(after_claim: impl FnOnce()) -> Result<FfiStartResult, VeloqError> {
    // Refuse before clearing the processed set: a refused run must not
    // cost the evidence cache, and must not park a dead handle in the
    // slot the backfill's final re-cut needs.
    if crate::persistence::detection_suspended() {
        log::warn!(
            "veloqrs: [DetectionManager] Force redetect refused: {}",
            refusal_reason(DetectionRefusal::Suspended)
        );
        return Ok(FfiStartOutcome::Held.into());
    }
    if detection_running() {
        info!("veloqrs: [DetectionManager] Cannot force redetect: detection already running");
        return Ok(FfiStartOutcome::Busy.into());
    }

    let install = crate::persistence::engine_install();
    if let Err(refusal) = claim_detect_for(install) {
        return Ok(refusal);
    }
    after_claim();

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
        settle_detect_for(install, Release::Deferred);
        return Ok(FfiStartOutcome::Busy.into());
    }

    // Clear and spawn against the engine that owns the claim. A refusal
    // leaves the processed set intact.
    let started = crate::persistence::with_persistent_engine_for(install, |e| {
        e.force_detect_sections_background_applying()
    });
    let handle = match started {
        Some(Ok(handle)) => handle,
        Some(Err(refusal)) => {
            warn!(
                "veloqrs: [DetectionManager] Force redetect refused: {}",
                refusal_reason(refusal)
            );
            settle_detect_for(install, Release::Deferred);
            return Ok(refusal_result(refusal));
        }
        None => {
            settle_detect_for(install, Release::Deferred);
            return Ok(FfiStartOutcome::NotReady.into());
        }
    };
    let slot = handle.checkpoint_slot();
    slot.mark_detect_claimed();
    record_started_run(&slot);
    *handle_guard = Some(handle);
    drop(handle_guard);
    slot.mark_installed(install);
    spawn_checkpoint_driver(install);
    info!("veloqrs: [DetectionManager] Forced full section re-detection started");
    Ok(FfiStartOutcome::Started.into())
}

#[uniffi::export]
impl DetectionManager {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    pub fn start(&self) -> Result<FfiStartResult, VeloqError> {
        start_with(|| {})
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
        Ok(match poll_detection_once_for_follower()? {
            DetectionPoll::Idle => "idle".to_string(),
            DetectionPoll::Running => "running".to_string(),
            DetectionPoll::Applied => "complete".to_string(),
            DetectionPoll::Died => "error".to_string(),
        })
    }

    /// Polls the run named by `run_id`, or binds to the current run when empty.
    pub fn poll_followed(&self, run_id: String) -> Result<String, VeloqError> {
        poll_followed_run(&run_id)
    }

    /// How many stored activities have never been through a detect.
    ///
    /// `get_progress` answers only for a run holding the slot now, and the
    /// phase behind it is process-global and starts at idle, so a relaunch with
    /// work outstanding reads as nothing to report. This is the durable half,
    /// counted against the persisted processed set, and it is what a resting
    /// row on the jobs screen rests on.
    pub fn awaiting_count(&self) -> Result<u32, VeloqError> {
        let owed = crate::objects::error::with_reader(
            crate::persistence::sections::pooled::activities_awaiting_detection,
        )?
        .map_err(|e| VeloqError::Database {
            msg: format!("{}", e),
        })?;
        Ok(owed.try_into().unwrap_or(u32::MAX))
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

    /// Ask a running detection to stop. Returns whether there was one.
    ///
    /// Cooperative: the call returns at once and the run ends on its own
    /// clock, at the next stage check or the next cluster the fold cuts. The
    /// run is discarded rather than saved as a partial catalogue.
    pub fn cancel(&self) -> bool {
        let guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(handle) => {
                handle.request_cancel();
                info!("veloqrs: [DetectionManager] Cancel requested");
                true
            }
            None => false,
        }
    }

    /// Force full re-detection by clearing processed activity IDs first.
    /// This ensures all activities are re-evaluated against sections.
    /// Refuses, and says why, if detection is suspended or already running.
    pub fn force_redetect(&self) -> Result<FfiStartResult, VeloqError> {
        force_redetect_with(|| {})
    }

    pub fn set_config(&self, config: crate::FfiSectionConfig) -> Result<(), VeloqError> {
        with_engine(|e| e.set_section_config(config.into()))?.map_err(|refusal| VeloqError::Busy {
            msg: refusal_reason(refusal).to_string(),
        })
    }

    pub fn get_config(&self) -> Result<crate::FfiSectionConfig, VeloqError> {
        with_reader(|conn| {
            crate::persistence::settings::section_config_from(conn)
                .map(|config| crate::FfiSectionConfig::from(&config))
                .map_err(|e| VeloqError::Database { msg: e.to_string() })
        })?
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
        with_reader(|conn| {
            crate::persistence::settings::match_config_from(conn)
                .map(|config| crate::FfiMatchStrictness {
                    min_match_pct: config.min_match_percentage,
                    endpoint_threshold: config.endpoint_threshold,
                })
                .map_err(|e| VeloqError::Database { msg: e.to_string() })
        })?
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
            timeouts: AtomicU32,
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
                    timeouts: AtomicU32::new(0),
                }
            }

            fn run(&self, stop_at_end: bool) -> SlotWait {
                wait_on_slot_counting(
                    &self.timeouts,
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

        /// Scenario: three of the four callers fold a timeout into a `warn!`
        /// and carry on, and a release build strips or never reads that line.
        ///
        /// Expected behaviour: the give-up is a fact, counted where every
        /// caller passes rather than at each of them, so a wait that expired
        /// and one that succeeded are not the same thing to everything
        /// downstream.
        #[test]
        fn a_wait_that_ran_out_of_time_is_counted() {
            let hung = Fake::new(vec![], Ok(DetectionPoll::Running));
            assert_eq!(hung.run(false), SlotWait::TimedOut);

            assert_eq!(hung.timeouts.load(Ordering::Relaxed), 1);
        }

        #[test]
        fn a_wait_that_ended_is_not_counted() {
            let empty = Fake::new(vec![], Ok(DetectionPoll::Idle));
            assert_eq!(empty.run(false), SlotWait::Idle);
            let applied = Fake::new(vec![], Ok(DetectionPoll::Applied));
            assert_eq!(applied.run(true), SlotWait::Applied);

            assert_eq!(
                empty.timeouts.load(Ordering::Relaxed) + applied.timeouts.load(Ordering::Relaxed),
                0,
                "an ended wait is not a give-up"
            );
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
        clear_detection_handle, drain_detection, hold_detection_workers, race,
        seeded_global_engine, serial_global_state, wait_for_slot_drivers,
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

    /// Scenario: a detect dies on one unreadable track. The handle is cleared,
    /// the conditioner's pending count is still standing, and the next due
    /// batch starts another run at once. The whole pool is scanned again, it
    /// dies again, and nothing slows it down for the life of the process.
    ///
    /// Expected behaviour: a run that failed backs its key off on the attempt
    /// store, so the next start is `Held` and installs nothing. A restart is
    /// what clears it, which is the store's lease generation rather than a
    /// clock.
    mod the_attempt_store_bounds_a_failing_detect {
        use super::*;
        use crate::persistence::attempts::{Claim, Release, now_ms};
        use crate::persistence::with_persistent_engine;

        /// The taxonomy, read rather than exercised through a worker.
        #[test]
        pub fn a_claim_maps_to_one_start_outcome_each() {
            assert!(outcome_for_claim(Claim::Taken).is_ok());
            assert_eq!(
                outcome_for_claim(Claim::InFlight).unwrap_err(),
                FfiStartOutcome::Busy,
                "somebody else holds the key"
            );
            assert_eq!(
                outcome_for_claim(Claim::BackingOff { until: 42 }).unwrap_err(),
                FfiStartOutcome::Held,
                "nothing holds it, the last run failed, and this one would too"
            );
            assert_eq!(
                outcome_for_claim(Claim::BackingOff { until: 42 })
                    .unwrap_err()
                    .retry_at_ms,
                Some(42.0),
            );
            assert_eq!(
                refusal_result(DetectionRefusal::Suspended).retry_at_ms,
                None,
            );
            assert!(
                FfiStartOutcome::Held.is_retryable(),
                "a backoff ends, so the caller has somewhere to put the retry"
            );
        }

        fn claim_state(now: i64) -> Claim {
            with_persistent_engine(|engine| engine.claim_job(&detect_key(), now))
                .expect("engine")
                .expect("claim")
        }

        #[test]
        pub fn a_failed_run_holds_the_next_start_back() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();
            // The sequence a died worker leaves: the run claimed the key, then
            // the poll that found the thread gone released it as a failure.
            // Written directly so the test does not have to kill a thread.
            with_persistent_engine(|engine| {
                engine.claim_job(&detect_key(), now_ms()).expect("claim");
                engine
                    .release_job(
                        &detect_key(),
                        Release::failed(FfiStartOutcome::Failed, Some("the thread died")),
                        now_ms(),
                    )
                    .expect("release");
            })
            .expect("engine");

            let outcome = DetectionManager::new().start().expect("start");

            assert_eq!(
                outcome,
                FfiStartOutcome::Held,
                "a key inside its backoff holds the start rather than refusing it for ever"
            );
            let row = with_persistent_engine(|engine| {
                engine
                    .job_attempt(&detect_key())
                    .expect("read")
                    .expect("row")
            })
            .expect("engine");
            assert_eq!(
                outcome.retry_at_ms,
                Some((row.last_attempt_at.expect("failure time") + 1_000) as f64),
            );
            assert!(
                SECTION_DETECTION_HANDLE
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_none(),
                "nothing was installed, so the slot is free for the run that follows the backoff"
            );
            with_persistent_engine(|engine| {
                engine
                    .release_job(&detect_key(), Release::Done, now_ms())
                    .expect("release");
            })
            .expect("engine");
        }

        #[test]
        pub fn a_started_run_holds_the_key_until_it_settles() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();
            with_persistent_engine(|engine| {
                engine
                    .release_job(&detect_key(), Release::Done, now_ms())
                    .expect("clear");
            })
            .expect("engine");

            let manager = DetectionManager::new();
            assert!(manager.start().expect("start").started(), "the run starts");

            assert!(
                matches!(claim_state(now_ms()), Claim::InFlight),
                "the run holds its key while it is in the slot"
            );

            drain_detection();
            clear_detection_handle();
            assert!(
                matches!(claim_state(now_ms()), Claim::InFlight | Claim::Taken),
                "a settled run leaves no backoff behind"
            );
            with_persistent_engine(|engine| {
                engine
                    .release_job(&detect_key(), Release::Done, now_ms())
                    .expect("release");
            })
            .expect("engine");
        }

        /// A suspension is not a failure. Backing the key off for one would
        /// hold detection back after the backfill that took it has finished,
        /// which is the opposite of what the suspension is for.
        #[test]
        pub fn a_suspension_refuses_without_taking_the_key() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();
            with_persistent_engine(|engine| {
                engine
                    .release_job(&detect_key(), Release::Done, now_ms())
                    .expect("clear");
            })
            .expect("engine");

            let guard = crate::persistence::suspend_detection();
            let outcome = DetectionManager::new().start().expect("start");
            drop(guard);

            assert_eq!(
                outcome,
                FfiStartOutcome::Held,
                "a suspension holds the work"
            );
            assert!(
                matches!(claim_state(now_ms()), Claim::Taken),
                "the key was never claimed, so nothing is backing off"
            );
            with_persistent_engine(|engine| {
                engine
                    .release_job(&detect_key(), Release::Done, now_ms())
                    .expect("release");
            })
            .expect("engine");
        }
    }

    #[test]
    pub fn concurrent_starts_spawn_exactly_one_worker() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let hold = hold_detection_workers();
        let won = race(|| DetectionManager::new().start().expect("start").started());
        drop(hold);

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

        let hold = hold_detection_workers();
        let won = race(|| {
            DetectionManager::new()
                .force_redetect()
                .expect("redetect")
                .started()
        });
        drop(hold);

        assert_eq!(won, 1, "exactly one force redetect may win the race");
        assert_eq!(
            detection_workers_started() - before,
            1,
            "a losing force redetect must not leave an orphan worker behind"
        );

        drain_detection();
    }

    fn busy_ffi_refusal_keeps_an_aged_failure(force: bool) {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        assert!(claim_detect_for(install).is_ok());
        settle_detect_for(
            install,
            Release::failed(FfiStartOutcome::Failed, Some("earlier failure")),
        );
        let earlier = now_ms() - 86_400_000;
        with_engine(|e| {
            e.db.execute(
                "UPDATE job_attempts SET last_attempt_at = ? WHERE key = ?",
                rusqlite::params![earlier, detect_key().as_str()],
            )
        })
        .expect("engine")
        .expect("age failure");

        let install_unclaimed_recut = || {
            let handle = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
            let slot = handle.checkpoint_slot();
            *SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(handle);
            slot.mark_installed(install);
        };
        let outcome = if force {
            force_redetect_with(install_unclaimed_recut)
        } else {
            start_with(install_unclaimed_recut)
        };
        assert_eq!(outcome.expect("refusal"), FfiStartOutcome::Busy);
        let row = with_engine(|e| {
            e.db.query_row(
                "SELECT attempts, last_attempt_at FROM job_attempts WHERE key = ?",
                [detect_key().as_str()],
                |row| Ok((row.get::<_, u32>(0)?, row.get::<_, i64>(1)?)),
            )
        })
        .expect("engine")
        .expect("attempt row");
        assert_eq!(
            row,
            (1, earlier),
            "the busy refusal keeps the failure ladder"
        );
        clear_detection_handle();
    }

    #[test]
    fn test_start_busy_unclaimed_recut_keeps_failure() {
        busy_ffi_refusal_keeps_an_aged_failure(false);
    }

    #[test]
    fn test_force_redetect_busy_unclaimed_recut_keeps_failure() {
        busy_ffi_refusal_keeps_an_aged_failure(true);
    }

    fn followed_run_keeps_its_verdict_after_a_successor(first_applied: bool) {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        let first = if first_applied {
            crate::persistence::SectionDetectionHandle::finished_after_worker_apply()
        } else {
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply()
        };
        let first_slot = first.checkpoint_slot();
        record_started_run(&first_slot);
        let followed_id = first_slot.run_id();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(first);
        first_slot.mark_installed(install);
        first_slot.mark_worker_finished();

        let successor = if first_applied {
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply()
        } else {
            crate::persistence::SectionDetectionHandle::finished_after_worker_apply()
        };
        let successor_slot = successor.checkpoint_slot();
        record_started_run(&successor_slot);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(successor);
        successor_slot.mark_installed(install);
        assert_eq!(
            poll_followed_run(&followed_id.to_string()).expect("followed verdict"),
            format!(
                "{followed_id}:{}",
                if first_applied { "complete" } else { "error" }
            ),
            "a successor cannot change the followed run's verdict"
        );
        clear_detection_handle();
    }

    #[test]
    fn test_poll_followed_complete_survives_failing_successor() {
        followed_run_keeps_its_verdict_after_a_successor(true);
    }

    #[test]
    fn test_poll_followed_error_survives_successful_successor() {
        followed_run_keeps_its_verdict_after_a_successor(false);
    }

    #[test]
    fn test_poll_followed_running_binds_before_successor() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        let (first, sender, cache_sender) =
            crate::persistence::SectionDetectionHandle::worker_that_never_answers();
        let first_slot = first.checkpoint_slot();
        record_started_run(&first_slot);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(first);
        first_slot.mark_installed(install);
        let bound = poll_followed_run("").expect("first poll");
        assert_eq!(bound, format!("{}:running", first_slot.run_id()));

        drop(sender);
        drop(cache_sender);
        assert_eq!(
            poll_detection_once().expect("failed first run"),
            DetectionPoll::Died
        );
        let successor = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let successor_slot = successor.checkpoint_slot();
        record_started_run(&successor_slot);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(successor);
        successor_slot.mark_installed(install);
        assert_eq!(
            poll_followed_run(&first_slot.run_id().to_string()).expect("followed poll"),
            format!("{}:error", first_slot.run_id())
        );
        clear_detection_handle();
    }

    #[test]
    fn test_poll_followed_handoff_keeps_completed_verdict() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        let first = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let first_slot = first.checkpoint_slot();
        record_started_run(&first_slot);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(first);
        first_slot.mark_installed(install);
        let followed_id = first_slot.run_id();

        let verdict = poll_followed_run_with(&followed_id.to_string(), || {
            first_slot.mark_worker_finished();
            let successor =
                crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply();
            let successor_slot = successor.checkpoint_slot();
            record_started_run(&successor_slot);
            *SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(successor);
            successor_slot.mark_installed(install);
        });
        assert_eq!(
            verdict.expect("followed verdict"),
            format!("{followed_id}:complete")
        );
        clear_detection_handle();
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
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        with_engine(|e| e.set_detection_enabled(false))
            .expect("engine")
            .expect("switch off");
        with_engine(|e| e.save_processed_activity_ids(&["a0".to_string()]))
            .expect("engine")
            .expect("processed marker");
        with_engine(|e| {
            e.db.execute(
                "INSERT INTO evidence_cache (id, config_digest, folded_ids, cache, updated_at)
                 VALUES (1, 'digest', x'00', x'00', 0)",
                [],
            )
        })
        .expect("engine")
        .expect("evidence row");
        let install = crate::persistence::engine_install();
        assert!(claim_detect_for(install).is_ok());
        settle_detect_for(
            install,
            Release::failed(FfiStartOutcome::Failed, Some("earlier failure")),
        );
        let earlier = now_ms() - 86_400_000;
        with_engine(|e| {
            e.db.execute(
                "UPDATE job_attempts SET last_attempt_at = ? WHERE key = ?",
                rusqlite::params![earlier, detect_key().as_str()],
            )
        })
        .expect("engine")
        .expect("age failure");

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
        let conn = rusqlite::Connection::open(tmp.path().join("detection.db")).expect("db");
        assert_eq!(
            conn.query_row(
                "SELECT attempts, last_attempt_at FROM job_attempts WHERE key = ?",
                [detect_key().as_str()],
                |row| Ok((row.get::<_, u32>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("earlier failure retained"),
            (1, earlier),
            "no-work refusals preserve the prior backoff ladder"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM processed_activities WHERE activity_id = 'a0'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("processed marker"),
            1,
            "a refused force must preserve the processed set"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM evidence_cache", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("evidence row"),
            1,
            "a refused force must preserve the evidence cache"
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
        let held = manager.start().expect("start");
        assert_eq!(
            held,
            FfiStartOutcome::Held,
            "suspended start names the hold"
        );
        assert_eq!(held.retry_at_ms, None);
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
    ///
    /// A run reads complete before its worker has settled it and let go of
    /// the slot, so on complete this also waits for the worker to exit. A
    /// caller that reads the outcome, polls or starts the next run straight
    /// after would otherwise meet the run still going whenever the machine
    /// is busy enough to hold the worker back between the two.
    pub fn wait_for_the_run_to_apply(manager: &DetectionManager) -> String {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if manager.last_outcome() == "complete" {
                crate::test_globals::wait_for_detection_workers();
                return "complete".to_string();
            }
            let phase = manager
                .get_progress()
                .expect("progress")
                .map(|p| p.phase)
                .unwrap_or_default();
            if phase == "complete" {
                crate::test_globals::wait_for_detection_workers();
                return phase;
            }
            if Instant::now() >= deadline {
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

        // The worker settles its own run and has exited, so a poll that still
        // had a write to do would wait for this writer.
        let poll = crate::test_globals::read_while_writer_holds(poll_to_completion);
        assert!(matches!(poll, DetectionPoll::Applied | DetectionPoll::Idle));

        assert_eq!(
            poll_detection_once().expect("second poll"),
            DetectionPoll::Idle,
            "the applied run leaves the slot free"
        );
    }

    #[test]
    pub fn a_finished_run_releases_its_slot_without_a_poll() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started());
        let deadline = Instant::now() + Duration::from_secs(30);
        while detection_running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!detection_running(), "the worker frees its own slot");
        assert_eq!(manager.last_outcome(), "complete");
        assert!(manager.get_progress().expect("progress").is_none());
        assert!(manager.start().expect("restart").started());
        poll_to_completion();
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

        // Read it as often as a one second timer would, without taking a result.
        for _ in 0..5 {
            assert_eq!(
                manager.last_outcome(),
                "complete",
                "the worker has settled its own run"
            );
        }

        assert_eq!(poll_to_completion(), DetectionPoll::Idle);
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
        poll_to_completion();
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
        assert_eq!(poll_to_completion(), DetectionPoll::Idle);
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

    /// Scenario: a rescan started from TypeScript parked a checkpoint every two
    /// seconds and nothing drained or persisted it. The follower reads the
    /// engine once at start and once on `detectionApplied`, never on the clock,
    /// so `persist_evidence_checkpoint` never ran on the path that most needs
    /// it: a `force_redetect` clears the processed set and the evidence cache,
    /// so it is a cold rebatch of minutes that resumed from nothing.
    ///
    /// Expected behaviour: both start paths leave a follower behind that writes
    /// the checkpoints.
    #[test]
    fn a_rescan_started_from_typescript_leaves_a_checkpoint_follower() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        wait_for_slot_drivers();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started());

        assert!(
            slot_drivers() >= 1,
            "the run is followed, so its checkpoints reach the database"
        );

        manager.cancel();
        drain_detection();
        wait_for_slot_drivers();
    }

    /// A checkpoint follower keeps watching only its own live slot. Once the
    /// worker has settled, the follower leaves its outcome and slot alone.
    #[test]
    fn the_checkpoint_follower_leaves_a_finished_run_settled() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        wait_for_slot_drivers();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started());
        // The follower counts as a slot driver until it stops at the run's
        // end, so this returns once it has taken the outcome if it ever will.
        wait_for_slot_drivers();

        assert_eq!(
            manager.last_outcome(),
            "complete",
            "the worker's outcome stays visible after the follower stops"
        );
        assert!(!detection_running());

        manager.cancel();
        drain_detection();
        wait_for_slot_drivers();
    }

    #[test]
    fn a_replacement_between_checkpoint_reads_receives_no_old_row() {
        let _serial = serial_global_state();
        let tmp = init_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        let checkpoint = crate::persistence::CacheUpdate {
            cache: crate::SectionEvidenceCache::new(),
            folded_ids: std::collections::HashSet::from(["old-activity".to_string()]),
            checkpoint: true,
            boundaries: Vec::new(),
        };

        persist_checkpoint_with(old_install, checkpoint, || {
            crate::persistence::clear_persistent_engine();
            assert!(
                crate::persistence::persistent_engine_ffi::persistent_engine_init(
                    tmp.path()
                        .join("replacement.db")
                        .to_string_lossy()
                        .into_owned()
                )
            );
        });

        let rows: i64 = with_engine(|e| {
            e.db.query_row("SELECT COUNT(*) FROM evidence_cache", [], |r| r.get(0))
        })
        .expect("engine")
        .expect("count");
        assert_eq!(
            rows, 0,
            "the replacement has no checkpoint from the old run"
        );
    }

    /// A checkpoint from a run that has already left the slot belongs to
    /// nobody: the follower holds its own run's slot and stops when the shared
    /// handle is somebody else's.
    #[test]
    fn a_follower_stops_when_its_own_run_leaves_the_slot() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        wait_for_slot_drivers();

        let mine = Arc::new(crate::persistence::CheckpointSlot::default());
        assert!(
            !still_running(&mine),
            "an empty slot is not this run still going"
        );

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started());
        assert!(
            !still_running(&mine),
            "and neither is somebody else's run holding it"
        );

        manager.cancel();
        drain_detection();
        wait_for_slot_drivers();
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

    /// Scenario: a detection run started from a screen cannot be stopped. The
    /// worker loads every track and detects over all of them whatever the
    /// athlete does next, and `DetectionManager` exposed no cancel at all, so
    /// no screen could ask.
    ///
    /// Expected behaviour: a run can be asked to stop, the ask reaches the
    /// worker, and the slot it held is free afterwards so the next detection
    /// can start. A cancel is not an error: the run did what it was told.
    #[test]
    fn a_running_detection_can_be_cancelled_and_frees_its_slot() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        wait_for_slot_drivers();

        let manager = DetectionManager::new();
        assert!(manager.start().expect("start").started(), "the run starts");
        assert!(manager.cancel(), "a running detection is there to cancel");

        // The worker checks between stages, so the run ends on its own clock.
        let deadline = Instant::now() + Duration::from_secs(30);
        while detection_running() && Instant::now() < deadline {
            let _ = poll_detection_once();
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!detection_running(), "the slot is free again");

        assert!(
            manager.start().expect("second start").started(),
            "and the next detection can start"
        );
        wait_for_the_run_to_apply(&manager);
        poll_to_completion();
    }

    /// Cancelling when nothing is running says so, rather than arming a flag
    /// the next run would read.
    #[test]
    fn cancelling_an_idle_detection_says_there_was_nothing_to_stop() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        assert!(
            !DetectionManager::new().cancel(),
            "there is no run to cancel"
        );
    }

    /// The poll that observes completion. A `Running` poll or two can
    /// precede it: the worker posts its result just after the last phase
    /// marker, so the phase leads the channel by a hair.
    pub fn poll_to_completion() -> DetectionPoll {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let poll = poll_detection_once().expect("poll");
            if poll != DetectionPoll::Running || Instant::now() >= deadline {
                return poll;
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

        // The worker settles its own run and has exited, so a poll that still
        // had a write to do would wait for this writer.
        let poll = crate::test_globals::read_while_writer_holds(poll_to_completion);
        assert_eq!(poll, DetectionPoll::Idle, "the echo settled on its worker");
        assert_eq!(
            with_engine(|e| e.get_sections().len()).expect("engine"),
            found,
            "the echo leaves the catalogue where it stood"
        );
    }

    #[test]
    fn an_empty_new_ride_settles_a_warm_worker_without_replacing_its_catalogue() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let manager = DetectionManager::new();
        with_engine(|e| {
            for i in 0..24 {
                let points = (0..64)
                    .map(|j| {
                        tracematch::GpsPoint::new(
                            46.2 + f64::from(j) * 0.0002,
                            7.35 + f64::from(i) * 0.000001,
                        )
                    })
                    .collect();
                e.add_activity(format!("overlap_{i}"), points, "Ride".into())
                    .expect("overlapping ride");
            }
        })
        .expect("engine");
        assert!(manager.start().expect("seed detect").started());
        assert_eq!(wait_for_the_run_to_apply(&manager), "complete");

        let before = with_engine(|e| serde_json::to_value(e.get_sections()).expect("catalogue"))
            .expect("engine");
        assert!(!before.as_array().expect("catalogue array").is_empty());
        for i in 0..4 {
            with_engine(|e| {
                e.add_activity(format!("indoor_{i}"), Vec::new(), "VirtualRide".into())
                    .expect("indoor ride");
            })
            .expect("engine");
            assert!(manager.start().expect("warm detect").started());
            assert_eq!(wait_for_the_run_to_apply(&manager), "complete");
            assert_eq!(manager.poll().expect("follower"), "complete");
            assert_eq!(
                with_engine(|e| serde_json::to_value(e.get_sections()).expect("catalogue"))
                    .expect("engine"),
                before,
                "indoor ride {i} must preserve the catalogue"
            );
            assert!(!with_engine(|e| e.detection_owed()).expect("engine"));
        }
        let install = crate::persistence::engine_install();
        assert!(
            claim_detect_for(install).is_ok(),
            "the completed run releases its key"
        );
        settle_detect_for(install, Release::Done);
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

        let handle =
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply();
        let slot = handle.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        slot.mark_installed(crate::persistence::engine_install());

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
    fn polling_an_old_handle_does_not_release_the_replacements_lease() {
        let _serial = serial_global_state();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        let handle =
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply();
        handle.checkpoint_slot().mark_installed(old_install);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);

        crate::persistence::clear_persistent_engine();
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init(
                tmp.path()
                    .join("detection.db")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        let new_install = crate::persistence::engine_install();
        assert_ne!(old_install, new_install);
        assert!(claim_detect_for(new_install).is_ok());

        assert!(
            poll_detection_once().is_err(),
            "the old handle still fails its own poll"
        );
        assert_eq!(
            crate::persistence::with_persistent_engine_for(new_install, |engine| {
                engine
                    .claim_job(&detect_key(), now_ms())
                    .expect("claim state")
            }),
            Some(Claim::InFlight),
            "polling the old handle cannot settle the new engine's lease"
        );
        settle_detect_for(new_install, Release::Done);
    }

    /// Every install publishes the handle and drops the slot lock before
    /// `mark_installed` stores its install, and a worker over a small pool can
    /// finish inside that gap. A poll there has no install to settle against.
    #[test]
    fn a_poll_before_mark_installed_leaves_the_lease_to_the_install() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        assert!(claim_detect_for(install).is_ok());
        let handle = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let slot = handle.checkpoint_slot();
        slot.mark_detect_claimed();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        slot.mark_worker_finished();

        assert_eq!(
            poll_detection_once().expect("poll"),
            DetectionPoll::Running,
            "a run not yet installed is still its starter's to settle"
        );

        slot.mark_installed(install);
        assert!(!detection_running(), "the install settles the finished run");
        assert_eq!(DetectionManager::new().last_outcome(), "complete");
        assert!(
            claim_detect_for(install).is_ok(),
            "the lease went back with the run"
        );
        settle_detect_for(install, Release::Done);
    }

    fn ready_verdict_precedes_the_next_runs_idle(applied: bool) {
        let _serial = serial_global_state();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        let old_handle = if applied {
            crate::persistence::SectionDetectionHandle::finished_after_worker_apply()
        } else {
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply()
        };
        old_handle.checkpoint_slot().mark_installed(old_install);
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(old_handle);

        crate::persistence::clear_persistent_engine();
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init(
                tmp.path()
                    .join("detection.db")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        let new_install = crate::persistence::engine_install();
        assert!(claim_detect_for(new_install).is_ok());
        let (next_handle, next_tx, next_cache_tx) =
            crate::persistence::SectionDetectionHandle::worker_that_never_answers();
        next_handle.checkpoint_slot().mark_installed(new_install);

        let first = poll_detection_once_with(|| {
            let mut slot = match SECTION_DETECTION_HANDLE.try_lock() {
                Ok(guard) => guard,
                Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => {
                    panic!("the Ready poll kept the slot locked through the next start")
                }
            };
            assert!(slot.is_none(), "the finished handle left the slot");
            // The same slot and outcome update DetectionManager::start uses,
            // with a held sender so the next poll stays Running.
            *slot = Some(next_handle);
            record_outcome(OUTCOME_IDLE);
        });
        if applied {
            assert_eq!(first.expect("applied poll"), DetectionPoll::Applied);
        } else {
            assert!(first.is_err(), "unapplied poll reports its failure");
        }
        assert_eq!(
            DetectionManager::new().last_outcome(),
            "idle",
            "the old Ready verdict cannot overwrite the new run's reset"
        );
        assert_eq!(
            poll_detection_once().expect("second poll"),
            DetectionPoll::Running,
            "the second poll observes the new run"
        );
        assert_eq!(DetectionManager::new().last_outcome(), "idle");
        clear_detection_handle();
        drop(next_tx);
        drop(next_cache_tx);
    }

    #[test]
    fn a_ready_success_cannot_overwrite_a_new_runs_idle() {
        ready_verdict_precedes_the_next_runs_idle(true);
    }

    #[test]
    fn a_ready_failure_cannot_overwrite_a_new_runs_idle() {
        ready_verdict_precedes_the_next_runs_idle(false);
    }

    #[test]
    pub fn a_failed_worker_releases_its_slot_without_a_poll() {
        let _serial = serial_global_state();
        let _tmp = engine_with_a_catalogue();
        clear_detection_handle();
        let held = with_engine(|e| e.get_sections().len()).expect("engine");
        let handle =
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply();
        let slot = handle.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);

        slot.mark_installed(crate::persistence::engine_install());
        slot.mark_worker_finished();

        assert!(!detection_running(), "the failed worker frees its slot");
        assert_eq!(DetectionManager::new().last_outcome(), "error");
        assert_eq!(
            with_engine(|e| e.get_sections().len()).expect("engine"),
            held
        );
    }

    #[test]
    fn a_failed_claimed_worker_keeps_its_detect_key_in_backoff() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();
        assert!(claim_detect_for(install).is_ok());
        let handle =
            crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply();
        let slot = handle.checkpoint_slot();
        slot.mark_detect_claimed();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);

        slot.mark_installed(install);
        slot.mark_worker_finished();

        assert!(!detection_running());
        assert_eq!(DetectionManager::new().last_outcome(), "error");
        assert!(
            claim_detect_for(install).is_err(),
            "a claimed failure backs off the next start"
        );
        settle_detect_for(install, Release::Done);
    }

    #[test]
    fn a_follower_reads_the_recorded_outcome_after_the_worker_frees_its_slot() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = crate::persistence::engine_install();

        for (applied, expected) in [(false, SlotWait::Died), (true, SlotWait::Applied)] {
            assert!(claim_detect_for(install).is_ok());
            let handle = if applied {
                crate::persistence::SectionDetectionHandle::finished_after_worker_apply()
            } else {
                crate::persistence::SectionDetectionHandle::finished_without_its_worker_apply()
            };
            let slot = handle.checkpoint_slot();
            slot.mark_detect_claimed();
            *SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(handle);
            slot.mark_installed(install);
            slot.mark_worker_finished();

            assert_eq!(
                DetectionManager::new().poll().expect("FFI poll"),
                if applied { "complete" } else { "error" },
                "the FFI follower reads the terminal outcome with the empty slot"
            );

            assert_eq!(
                wait_on_slot(Duration::from_millis(1), true),
                expected,
                "the follower reads the outcome after the slot is empty"
            );
            assert_eq!(
                wait_on_slot(Duration::from_millis(1), true),
                expected,
                "a second follower gets the same result"
            );
            assert_eq!(
                wait_on_slot(Duration::from_millis(1), false),
                SlotWait::Idle,
                "a drain only waits for an empty slot"
            );
            if !applied {
                settle_detect_for(install, Release::Done);
            }
        }
    }

    #[test]
    fn an_indoor_library_completes_detection_without_backoff() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();
        with_engine(|engine| {
            engine
                .add_activity("indoor".into(), Vec::new(), "Run".into())
                .expect("indoor activity");
        })
        .expect("engine");

        let manager = DetectionManager::new();
        assert_eq!(manager.start().expect("start"), FfiStartOutcome::Started);
        drain_detection();
        assert_eq!(manager.last_outcome(), "complete");
        assert!(
            claim_detect().is_ok(),
            "an empty usable pool has no backoff"
        );
        settle_detect(Release::Done);
    }

    #[test]
    fn an_empty_library_completes_detection_without_backoff() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert_eq!(manager.start().expect("start"), FfiStartOutcome::Started);
        drain_detection();
        assert_eq!(manager.last_outcome(), "complete");
        assert!(claim_detect().is_ok(), "an empty library has no backoff");
        settle_detect(Release::Done);
    }

    #[test]
    fn a_failed_track_pool_read_cannot_be_saved_as_empty() {
        let _serial = serial_global_state();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        rusqlite::Connection::open(tmp.path().join("detection.db"))
            .expect("db")
            .execute("DROP TABLE gps_tracks", [])
            .expect("remove track table");

        let manager = DetectionManager::new();
        assert_eq!(manager.start().expect("start"), FfiStartOutcome::Started);
        drain_detection();
        assert_eq!(manager.last_outcome(), "error");
        assert_eq!(manager.start().expect("retry"), FfiStartOutcome::Held);
        settle_detect(Release::Done);
    }

    #[test]
    fn an_unreadable_track_is_not_an_empty_usable_pool() {
        let _serial = serial_global_state();
        let tmp = init_global_engine();
        clear_detection_handle();
        with_engine(|engine| {
            let points = (0..32)
                .map(|i| crate::GpsPoint::new(46.0 + f64::from(i) * 0.0001, 7.0))
                .collect();
            engine
                .add_activity("broken".into(), points, "Ride".into())
                .expect("activity");
        })
        .expect("engine");
        rusqlite::Connection::open(tmp.path().join("poison.db"))
            .expect("db")
            .execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = 'broken'",
                rusqlite::params![&[0x7f_u8, 1, 2, 3][..]],
            )
            .expect("corrupt track");

        let manager = DetectionManager::new();
        assert_eq!(manager.start().expect("start"), FfiStartOutcome::Started);
        drain_detection();
        assert_eq!(manager.last_outcome(), "error");
        assert_eq!(manager.start().expect("retry"), FfiStartOutcome::Held);
        settle_detect(Release::Done);
    }

    #[test]
    fn a_failed_forced_run_backs_off_without_clearing_a_refused_retry() {
        let _serial = serial_global_state();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        with_engine(|engine| {
            for i in 6..12 {
                engine
                    .add_activity(
                        format!("a{i}"),
                        vec![crate::GpsPoint::new(46.0, 7.0)],
                        "Ride".into(),
                    )
                    .expect("activity");
            }
        })
        .expect("engine");
        let conn = rusqlite::Connection::open(tmp.path().join("detection.db")).expect("db");
        for i in 0..12 {
            conn.execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = ?",
                rusqlite::params![&[0x7f_u8, 1, 2, 3][..], format!("a{i}")],
            )
            .expect("corrupt track");
        }

        let manager = DetectionManager::new();
        assert_eq!(
            manager.force_redetect().expect("first"),
            FfiStartOutcome::Started
        );
        drain_detection();
        assert_eq!(manager.last_outcome(), "error");
        with_engine(|engine| {
            engine
                .save_processed_activity_ids(&["a0".to_string()])
                .expect("processed marker");
        })
        .expect("engine");

        assert_eq!(
            manager.force_redetect().expect("retry"),
            FfiStartOutcome::Held
        );
        assert!(
            conn.query_row(
                "SELECT COUNT(*) FROM processed_activities WHERE activity_id = 'a0'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("processed marker")
                > 0,
            "a refused retry preserves processed evidence"
        );
        settle_detect(Release::Done);
        assert_eq!(
            manager.force_redetect().expect("after release"),
            FfiStartOutcome::Started,
            "a released key admits the next forced run"
        );
        drain_detection();
        settle_detect(Release::Done);
    }

    #[test]
    pub fn a_caller_applied_handle_in_the_shared_slot_is_rejected() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let handle = with_engine(|e| e.detect_sections_background()).expect("engine");
        let slot = handle.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        slot.mark_installed(crate::persistence::engine_install());

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            match poll_detection_once() {
                Ok(DetectionPoll::Running) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                result => {
                    assert!(result.is_err(), "caller apply must not run from the slot");
                    break;
                }
            }
        }
        assert!(!detection_running());
    }

    #[test]
    pub fn detection_survives_a_poisoned_handle_lock() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();

        poison(&SECTION_DETECTION_HANDLE);

        assert_eq!(
            poll_detection_once().expect("poll must not fail"),
            DetectionPoll::Idle,
            "an empty handle reads Idle through a poisoned lock"
        );

        let manager = DetectionManager::new();
        assert!(
            manager.start().expect("start must not fail").started(),
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
            manager.start().expect("start must not fail").started(),
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
        use crate::persistence::sections::conditioning::try_start_conditioning;

        #[test]
        pub fn does_not_outlive_the_reset() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            clear_detection_handle();

            assert!(try_start_conditioning(), "a conditioning run starts");
            assert!(slot_drivers() > 0, "its driver is polling the slot");

            clear_detection_handle();

            assert_eq!(
                slot_drivers(),
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
                "complete",
                "the worker settles this run without a poll"
            );
            assert_eq!(
                poll_to_completion(),
                DetectionPoll::Idle,
                "and the caller sees the freed slot"
            );
        }
    }
}

#[cfg(test)]
#[path = "tests/detection_pooled.rs"]
mod detection_pooled_tests;
