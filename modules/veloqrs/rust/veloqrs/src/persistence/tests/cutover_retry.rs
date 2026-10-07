use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::time::Duration;

#[test]
fn test_commit_switch_retry_keeps_detect_checkpoint() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = super::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.commit_switch().expect("initial switch");
    let folded_ids = HashSet::from(["a1".to_string()]);
    engine.persist_evidence_checkpoint(&super::super::CacheUpdate {
        cache: super::super::SectionEvidenceCache::new(),
        folded_ids: folded_ids.clone(),
        checkpoint: true,
        boundaries: Vec::new(),
    });

    engine.commit_switch().expect("retry switch");
    let kept: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM evidence_cache", [], |row| row.get(0))
        .expect("count");
    assert_eq!(kept, 1);
    assert_eq!(engine.cache_folded_ids, folded_ids);
}

struct TimedOutDetect {
    checkpoint: RefCell<Option<super::super::CacheUpdate>>,
    cancelled: Cell<bool>,
}

impl super::CutoverDetect for TimedOutDetect {
    fn receive(
        &self,
        limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        assert_eq!(limit, Duration::ZERO);
        (
            super::super::WorkerPoll::Running,
            self.checkpoint.borrow_mut().take(),
        )
    }

    fn request_cancel(&self) {
        self.cancelled.set(true);
    }
}

fn assert_timeout_then_retry(
    engine: &mut super::PersistentEngine,
    folded_ids: HashSet<String>,
    resumed_ids: &HashSet<String>,
    attempt: usize,
) {
    assert_eq!(&engine.cache_folded_ids, resumed_ids);
    let worker = TimedOutDetect {
        checkpoint: RefCell::new(Some(super::super::CacheUpdate {
            cache: super::super::SectionEvidenceCache::new(),
            folded_ids: folded_ids.clone(),
            checkpoint: true,
            boundaries: Vec::new(),
        })),
        cancelled: Cell::new(false),
    };
    let result = super::wait_for_cutover_detect(&worker, Duration::ZERO, |checkpoint| {
        engine.persist_evidence_checkpoint(&checkpoint);
    });
    assert_eq!(result.err().as_deref(), Some("detect never answered"));
    assert!(
        worker.cancelled.get(),
        "attempt {attempt} left a worker running"
    );
    assert_eq!(&engine.cache_folded_ids, resumed_ids);

    engine.commit_switch().expect("retry switch");
    assert_eq!(
        engine.cache_folded_ids,
        folded_ids,
        "attempt {} did not start with the prior checkpoint's folded ids",
        attempt + 2
    );
}

#[test]
fn test_cutover_detect_two_timeouts_resume_folded_ids_and_cancel_workers() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = super::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), Vec::new(), "Ride".into())
        .expect("activity");
    engine
        .add_activity("a2".into(), Vec::new(), "Ride".into())
        .expect("activity");
    engine.commit_switch().expect("initial switch");
    let first_folded = HashSet::from(["a1".to_string()]);
    let second_folded = HashSet::from(["a1".to_string(), "a2".to_string()]);
    assert_timeout_then_retry(&mut engine, first_folded.clone(), &HashSet::new(), 1);
    assert_timeout_then_retry(&mut engine, second_folded, &first_folded, 2);
}

/// A detect the OS kills `killed_after` into the wait. A wait asked to run past
/// that never returns, so the process is gone and nothing after it runs.
struct KilledDetect {
    checkpoint: RefCell<Option<super::super::CacheUpdate>>,
    waited: Cell<Duration>,
    killed_after: Duration,
}

impl super::CutoverDetect for KilledDetect {
    fn receive(
        &self,
        limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        let waited = self.waited.get() + limit;
        if waited > self.killed_after {
            return (super::super::WorkerPoll::Died, None);
        }
        self.waited.set(waited);
        (
            super::super::WorkerPoll::Running,
            self.checkpoint.borrow_mut().take(),
        )
    }

    fn request_cancel(&self) {}
}

/// Scenario: Android kills the backgrounded process four minutes into a
/// six-minute cold detect, with a checkpoint already in the run's slot.
/// Expected behaviour: the checkpoint reached disk before the kill, so the next
/// launch's switch resumes from its folded ids rather than from zero.
#[test]
fn test_cutover_detect_killed_before_the_limit_resumes_from_its_checkpoint() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = super::PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), Vec::new(), "Ride".into())
        .expect("activity");
    engine
        .add_activity("a2".into(), Vec::new(), "Ride".into())
        .expect("activity");
    engine.commit_switch().expect("initial switch");
    let folded_ids = HashSet::from(["a1".to_string()]);
    let worker = KilledDetect {
        checkpoint: RefCell::new(Some(super::super::CacheUpdate {
            cache: super::super::SectionEvidenceCache::new(),
            folded_ids: folded_ids.clone(),
            checkpoint: true,
            boundaries: Vec::new(),
        })),
        waited: Cell::new(Duration::ZERO),
        killed_after: Duration::from_secs(240),
    };

    let result = super::wait_for_cutover_detect(
        &worker,
        crate::objects::detection::SLOT_WAIT_LIMIT,
        |checkpoint| engine.persist_evidence_checkpoint(&checkpoint),
    );
    assert!(result.is_err());
    drop(engine);

    let mut engine = super::PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.commit_switch().expect("next launch's switch");
    assert_eq!(
        engine.cache_folded_ids, folded_ids,
        "the killed run's checkpoint never reached disk"
    );
}

/// A detect whose authoritative update lands while the wait still reads it as
/// running, and whose answer follows on the next step.
struct LateAnswer {
    polls: Cell<usize>,
    final_update: RefCell<Option<super::super::CacheUpdate>>,
}

impl super::CutoverDetect for LateAnswer {
    fn receive(
        &self,
        _limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        self.polls.set(self.polls.get() + 1);
        if self.polls.get() == 1 {
            return (
                super::super::WorkerPoll::Running,
                self.final_update.borrow_mut().take(),
            );
        }
        (
            super::super::WorkerPoll::Ready((Vec::new(), vec!["a1".to_string()])),
            None,
        )
    }

    fn request_cancel(&self) {}
}

/// Scenario: the worker sends its final cache update just before its answer,
/// and a step of the wait reads the update before the answer arrives.
/// Expected behaviour: the update is the answer's, not a checkpoint: it is not
/// persisted as one, and the apply receives it.
#[test]
fn test_a_final_update_read_mid_wait_travels_with_the_answer() {
    let worker = LateAnswer {
        polls: Cell::new(0),
        final_update: RefCell::new(Some(super::super::CacheUpdate {
            cache: super::super::SectionEvidenceCache::new(),
            folded_ids: HashSet::from(["a1".to_string()]),
            checkpoint: false,
            boundaries: Vec::new(),
        })),
    };
    let persisted = Cell::new(0);

    let (_, update) =
        super::wait_for_cutover_detect(&worker, crate::objects::detection::SLOT_WAIT_LIMIT, |_| {
            persisted.set(persisted.get() + 1)
        })
        .expect("the detect answered");

    assert_eq!(
        persisted.get(),
        0,
        "the final update was persisted as a checkpoint"
    );
    let update = update.expect("the final update went missing");
    assert!(!update.checkpoint);
    assert_eq!(update.folded_ids, HashSet::from(["a1".to_string()]));
}

/// A timed-out detect whose fold goes on until the test says it has settled.
struct FoldingOrphan(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl super::OrphanedDetect for FoldingOrphan {
    fn still_running(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Scenario: a cutover detect timed out inside the fold, which reads no
/// cancel, and a foreground retry arrives while it is still folding.
/// Expected behaviour: the retry is refused until the orphaned worker has
/// settled, so two track pools are never resident at once, and the refusal
/// leaves the run slot free.
#[test]
fn test_a_retry_is_refused_while_the_timed_out_detect_still_folds() {
    let _serial = crate::test_globals::serial_global_state();
    crate::persistence::clear_persistent_engine();
    let folding = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    super::adopt_orphaned_detect(Box::new(FoldingOrphan(std::sync::Arc::clone(&folding))));
    let ask = |_: &str| false;

    assert_eq!(
        super::run_cutover_with(&ask).err().as_deref(),
        Some("cutover already running"),
        "a retry started beside the orphaned fold"
    );
    assert!(!super::cutover_running(), "the refusal kept the slot");

    folding.store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        super::run_cutover_with(&ask).err().as_deref(),
        Some("no engine"),
        "the settled orphan still refused the run"
    );
    assert!(!super::cutover_running());
}

/// Scenario: a caller asks for the cutover before the engine is open.
/// Expected behaviour: not ready, and no run is started.
#[test]
fn test_start_without_an_engine_is_not_ready() {
    let _serial = crate::test_globals::serial_global_state();
    crate::persistence::clear_persistent_engine();

    assert_eq!(
        super::start_cutover(),
        crate::objects::FfiStartOutcome::NotReady
    );
    assert!(!super::cutover_running());
}

/// A real run's detect: answers nothing within the limit, hands over one
/// checkpoint, and keeps folding until the test says it has settled.
struct StuckFold {
    checkpoint: std::sync::Mutex<Option<super::super::CacheUpdate>>,
    folding: std::sync::Arc<std::sync::atomic::AtomicBool>,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl super::CutoverDetect for StuckFold {
    fn receive(
        &self,
        _limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        (
            super::super::WorkerPoll::Running,
            self.checkpoint.lock().unwrap().take(),
        )
    }

    fn request_cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl super::OrphanedDetect for StuckFold {
    fn still_running(&self) -> bool {
        self.folding.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Scenario: a cutover run's detect outlasts the wait limit while folding.
/// Expected behaviour: the run fails and asks the worker to stop, the
/// checkpoint the worker produced is on disk, and a retry is refused until
/// the worker has settled.
#[test]
fn test_a_run_that_times_out_adopts_its_worker_and_keeps_its_checkpoint() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let _serial = crate::test_globals::serial_global_state();
    crate::persistence::clear_persistent_engine();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(
        crate::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_str().unwrap().to_string()
        )
    );
    crate::persistence::with_persistent_engine(|e| e.commit_switch().expect("switch")).unwrap();

    let folding = std::sync::Arc::new(AtomicBool::new(true));
    let cancelled = std::sync::Arc::new(AtomicBool::new(false));
    let worker = StuckFold {
        checkpoint: std::sync::Mutex::new(Some(super::super::CacheUpdate {
            cache: super::super::SectionEvidenceCache::new(),
            folded_ids: HashSet::from(["a1".to_string()]),
            checkpoint: true,
            boundaries: Vec::new(),
        })),
        folding: std::sync::Arc::clone(&folding),
        cancelled: std::sync::Arc::clone(&cancelled),
    };
    let worker = std::sync::Mutex::new(Some(worker));
    let start = |_install: u64| {
        worker
            .lock()
            .unwrap()
            .take()
            .map(|w| Box::new(w) as Box<dyn super::CutoverWorker>)
    };

    assert!(super::claim_run_slot());
    let result = super::run_cutover_claimed_with(
        crate::persistence::engine_install(),
        &|_: &str| false,
        Duration::from_millis(1),
        &start,
    );

    assert_eq!(result.err().as_deref(), Some("detect never answered"));
    assert!(
        cancelled.load(Ordering::SeqCst),
        "the worker was not asked to stop"
    );
    assert!(!super::cutover_running());
    let stored: i64 = crate::persistence::with_persistent_engine(|e| {
        e.db.query_row("SELECT COUNT(*) FROM evidence_cache", [], |r| r.get(0))
            .expect("count")
    })
    .unwrap();
    assert_eq!(stored, 1, "the worker's checkpoint never reached disk");
    assert_eq!(
        super::run_cutover_with(&|_: &str| false).err().as_deref(),
        Some("cutover already running"),
        "a retry started beside the folding worker"
    );

    folding.store(false, Ordering::SeqCst);
    assert!(
        super::claim_run_slot(),
        "the settled worker still held the slot"
    );
    super::CUTOVER_RUNNING.store(false, Ordering::SeqCst);
}

/// A detect that keeps folding until it is asked to stop, then settles dead
/// the way a stopped fold does.
struct StoppableFold {
    stop_requests: Cell<usize>,
    polls: Cell<usize>,
}

impl super::CutoverDetect for StoppableFold {
    fn receive(
        &self,
        _limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        self.polls.set(self.polls.get() + 1);
        if self.polls.get() == 1 {
            super::cancel_cutover();
        }
        if self.stop_requests.get() > 0 {
            return (super::super::WorkerPoll::Died, None);
        }
        (super::super::WorkerPoll::Running, None)
    }

    fn request_cancel(&self) {
        self.stop_requests.set(self.stop_requests.get() + 1);
    }
}

/// Scenario: the athlete cancels the cutover while its detect is folding.
/// Expected behaviour: the wait forwards the cancel to the worker once, within
/// a poll, and returns the cancelled error when the worker settles, instead of
/// waiting out the limit.
#[test]
fn test_a_cancel_during_the_detect_is_forwarded_to_the_worker() {
    let _serial = crate::test_globals::serial_global_state();
    let worker = StoppableFold {
        stop_requests: Cell::new(0),
        polls: Cell::new(0),
    };

    let result =
        super::wait_for_cutover_detect(&worker, crate::objects::detection::SLOT_WAIT_LIMIT, |_| {});
    super::CUTOVER_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);

    assert_eq!(result.err().as_deref(), Some(super::DETECT_CANCELLED));
    assert_eq!(worker.stop_requests.get(), 1);
    assert!(
        worker.polls.get() <= 3,
        "the wait kept polling after the cancel"
    );
}
