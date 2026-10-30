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
    assert_eq!(engine.evidence_cache().1, &folded_ids);
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
    assert_eq!(engine.evidence_cache().1, resumed_ids);
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
    assert_eq!(engine.evidence_cache().1, resumed_ids);

    engine.commit_switch().expect("retry switch");
    assert_eq!(
        engine.evidence_cache().1,
        &folded_ids,
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
        engine.evidence_cache().1,
        &folded_ids,
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

/// A detect that answers at once with a fixed result.
struct Answers(std::sync::Mutex<Option<super::super::DetectionOutput>>);

impl super::CutoverDetect for Answers {
    fn receive(
        &self,
        _limit: Duration,
    ) -> (
        super::super::WorkerPoll<super::super::DetectionOutput>,
        Option<super::super::CacheUpdate>,
    ) {
        match self.0.lock().unwrap().take() {
            Some(output) => (super::super::WorkerPoll::Ready(output), None),
            None => (super::super::WorkerPoll::Died, None),
        }
    }

    fn request_cancel(&self) {}
}

impl super::OrphanedDetect for Answers {
    fn still_running(&self) -> bool {
        false
    }
}

fn answering(
    output: super::super::DetectionOutput,
) -> impl Fn(u64) -> Option<Box<dyn super::CutoverWorker>> {
    let worker = std::sync::Mutex::new(Some(Answers(std::sync::Mutex::new(Some(output)))));
    move |_install| {
        worker
            .lock()
            .unwrap()
            .take()
            .map(|w| Box::new(w) as Box<dyn super::CutoverWorker>)
    }
}

fn run_with(
    start: &dyn Fn(u64) -> Option<Box<dyn super::CutoverWorker>>,
) -> Result<super::CutoverOutcome, String> {
    assert!(super::claim_run_slot());
    super::run_cutover_claimed_with(
        crate::persistence::engine_install(),
        &|_: &str| false,
        Duration::from_secs(5),
        start,
    )
}

fn answering_nothing() -> impl Fn(u64) -> Option<Box<dyn super::CutoverWorker>> {
    |_install| Some(Box::new(Answers(std::sync::Mutex::new(None))) as Box<dyn super::CutoverWorker>)
}

fn live_section_ids() -> Vec<String> {
    crate::persistence::with_persistent_engine(|e| {
        let mut stmt =
            e.db.prepare("SELECT id FROM sections ORDER BY id")
                .expect("prepare");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .flatten()
            .collect()
    })
    .unwrap()
}

fn found_section(line: &[tracematch::GpsPoint]) -> crate::FrequentSection {
    crate::FrequentSection {
        id: "found-1".to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        polyline: line.to_vec(),
        representative_activity_id: "a1".to_string(),
        representative_range: None,
        activity_portions: vec![crate::SectionPortion {
            activity_id: "a1".to_string(),
            start_index: 0,
            end_index: 7,
            distance_meters: 1_000.0,
            direction: tracematch::Direction::Same,
        }],
        activity_ids: vec!["a1".to_string()],
        visit_count: 1,
        distance_meters: 1_000.0,
        activity_traces: std::collections::HashMap::new(),
        confidence: 0.8,
        observation_count: 1,
        average_spread: 10.0,
        point_density: vec![1; line.len()],
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
    }
}

/// Opens a fresh engine holding rides over `corridors` separate stretches of
/// ground, detects and saves their sections as an older build would have, and
/// strips the detector marker so the cutover is owed. Returns the live auto
/// section ids and the first ride's track.
fn seed_catalogue(
    dir: &tempfile::TempDir,
    corridors: usize,
) -> (Vec<String>, Vec<tracematch::GpsPoint>) {
    crate::persistence::clear_persistent_engine();
    let path = dir.path().join("routes.db");
    assert!(
        crate::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_str().unwrap().to_string()
        )
    );
    let ride = |corridor: usize, i: usize| -> Vec<tracematch::GpsPoint> {
        (0..200)
            .map(|p| tracematch::GpsPoint {
                latitude: 46.0 + f64::from(p) * 0.0001,
                longitude: 7.0 + corridor as f64 * 0.05 + i as f64 * 0.00002,
                elevation: None,
            })
            .collect()
    };
    crate::persistence::with_persistent_engine(|e| {
        let mut cfg = e.get_section_config();
        cfg.min_activities = 3;
        e.set_section_config(cfg).expect("config");
        for c in 0..corridors {
            for i in 0..4 {
                let id = format!("ride_{c}_{i}");
                e.add_activity(id.clone(), ride(c, i), "Ride".into())
                    .expect("add_activity");
                e.record_elevation_state(&[(
                    id.clone(),
                    crate::persistence::ELEVATION_STATE_UNAVAILABLE,
                )])
                .expect("elevation state");
                e.update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
            }
        }
        let handle = e.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed) = main.expect("detect");
        e.apply_sections_with_cache(sections, cache_update)
            .expect("apply");
        e.save_processed_activity_ids(&processed).expect("save");
        e.db.execute(
            "DELETE FROM schema_info WHERE key = 'catalogue_detection_method'",
            [],
        )
        .expect("strip the detector marker");
    })
    .unwrap();
    (live_section_ids(), ride(0, 0))
}

fn cutover_job_outcome() -> Option<crate::persistence::job_runs::RunOutcome> {
    crate::persistence::with_persistent_engine(|e| {
        crate::persistence::job_runs::job_runs(&e.db)
            .expect("job runs")
            .into_iter()
            .find(|run| run.job == crate::persistence::job_runs::BackgroundJob::Cutover)
            .map(|run| run.outcome)
    })
    .unwrap()
}

/// Scenario: the cold detect completes with no sections for a library whose
/// catalogue held auto sections over four stretches of ground.
/// Expected behaviour: the empty result is applied and the token promoted, no
/// auto section is live, every one is on the retired list with a version to
/// restore, the stored diff counts them all current and gone with none
/// proposed, and the run is recorded as complete. The decision is that a
/// completed run is taken at its word, so this pins the decision rather than a
/// defect.
#[test]
fn test_an_empty_detect_that_completes_is_applied_and_promoted() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let (before, _) = seed_catalogue(&dir, 4);
    assert!(!before.is_empty(), "the seed produced no sections");

    let result = run_with(&answering((Vec::new(), vec!["ride_0_0".to_string()])));

    let Ok(super::CutoverOutcome::Completed(diff)) = result else {
        panic!("an empty result that completed was not taken: {result:?}");
    };
    assert!(live_section_ids().is_empty(), "an auto section stayed live");
    assert!(!crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
    let retired = crate::persistence::with_persistent_engine(|e| e.retired_sections()).unwrap();
    let mut retired_ids: Vec<String> = retired.iter().map(|r| r.section_id.clone()).collect();
    retired_ids.sort();
    assert_eq!(retired_ids, before);
    assert!(retired.iter().all(|r| r.restorable_version.is_some()));
    let counts = serde_json::from_str::<serde_json::Value>(&diff).unwrap()["counts"].clone();
    assert_eq!(counts["current"], before.len());
    assert_eq!(counts["proposed"], 0);
    assert_eq!(counts["gone"], before.len());
    assert_eq!(
        cutover_job_outcome(),
        Some(crate::persistence::job_runs::RunOutcome::Complete)
    );
}

/// Scenario: the same empty re-cut over a catalogue holding a pinned section.
/// Expected behaviour: the pinned section keeps its row and the others are
/// retired.
#[test]
fn test_an_empty_detect_keeps_a_pinned_section() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let (before, _) = seed_catalogue(&dir, 4);
    let pinned = before[0].clone();
    crate::persistence::with_persistent_engine(|e| {
        e.db.execute(
            "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
            [&pinned],
        )
        .expect("pin");
    })
    .unwrap();

    let result = run_with(&answering((Vec::new(), vec!["ride_0_0".to_string()])));

    assert!(matches!(result, Ok(super::CutoverOutcome::Completed(_))));
    assert_eq!(live_section_ids(), vec![pinned]);
}

/// Scenario: the detect worker dies before it answers, for a library holding
/// auto sections.
/// Expected behaviour: the run fails and records it as failed, nothing is
/// promoted, the sections are still live, and a later run whose detect
/// completes is taken.
#[test]
fn test_a_detect_that_dies_leaves_the_catalogue_live_and_the_cutover_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let (before, line) = seed_catalogue(&dir, 4);
    assert!(!before.is_empty(), "the seed produced no sections");

    let result = run_with(&answering_nothing());

    assert!(result.is_err(), "a dead worker was taken as a result");
    assert_eq!(live_section_ids(), before, "the catalogue was replaced");
    assert!(
        crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap(),
        "the token was promoted past a dead worker"
    );
    assert_eq!(
        cutover_job_outcome(),
        Some(crate::persistence::job_runs::RunOutcome::Failed)
    );

    let found = found_section(&line);
    let result = run_with(&answering((vec![found], vec!["ride_0_0".to_string()])));
    assert!(matches!(result, Ok(super::CutoverOutcome::Completed(_))));
    assert!(!crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
}

fn detect_on_the_real_worker(_install: u64) -> Option<Box<dyn super::CutoverWorker>> {
    crate::persistence::with_persistent_engine(|e| e.detect_sections_background_unchecked())
        .map(|handle| Box::new(handle) as Box<dyn super::CutoverWorker>)
}

fn assert_failed_and_owed(before: &[String]) {
    assert_eq!(live_section_ids(), before, "the catalogue was replaced");
    assert!(
        crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap(),
        "the token was promoted past a failed run"
    );
    assert!(
        crate::persistence::with_persistent_engine(|e| e.retired_sections())
            .unwrap()
            .is_empty(),
        "a section was retired by a run that failed"
    );
    assert_eq!(
        cutover_job_outcome(),
        Some(crate::persistence::job_runs::RunOutcome::Failed)
    );
}

/// Scenario: the real detect worker reads a track pool it cannot decode and
/// ends without a result, for a library holding auto sections.
/// Expected behaviour: the run fails with a reason, no section is retired or
/// replaced, the token stays owed, the run is recorded as failed, and a later
/// run over a readable pool is taken.
#[test]
fn test_a_detect_that_cannot_read_its_tracks_leaves_the_catalogue_live_and_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let (before, line) = seed_catalogue(&dir, 4);
    assert!(!before.is_empty(), "the seed produced no sections");
    let readable: Vec<(String, Vec<u8>)> = crate::persistence::with_persistent_engine(|e| {
        let mut stmt =
            e.db.prepare("SELECT activity_id, track_data FROM gps_tracks")
                .expect("prepare");
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .flatten()
            .collect();
        e.db.execute("UPDATE gps_tracks SET track_data = x'01'", [])
            .expect("garble every track");
        rows
    })
    .unwrap();

    let result = run_with(&detect_on_the_real_worker);

    let reason = result.expect_err("an unreadable pool was taken as a result");
    assert!(!reason.is_empty());
    assert_failed_and_owed(&before);

    crate::persistence::with_persistent_engine(|e| {
        for (id, blob) in &readable {
            e.db.execute(
                "UPDATE gps_tracks SET track_data = ?1 WHERE activity_id = ?2",
                rusqlite::params![blob, id],
            )
            .expect("restore");
        }
        e.db.execute("DELETE FROM schema_info WHERE key LIKE '%abandoned%'", [])
            .expect("clear the abandon record");
    })
    .unwrap();
    let result = run_with(&answering((
        vec![found_section(&line)],
        vec!["ride_0_0".to_string()],
    )));
    assert!(matches!(result, Ok(super::CutoverOutcome::Completed(_))));
    assert!(!crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
}

/// Scenario: the detect answers with sections, and the write of the new
/// catalogue then fails.
/// Expected behaviour: the write rolls back whole, so every old section is
/// still live and none is retired, the token stays owed, and the run is
/// recorded as failed with the apply as its reason.
#[test]
fn test_an_apply_that_fails_after_a_good_detect_leaves_the_catalogue_live_and_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let (before, line) = seed_catalogue(&dir, 4);
    assert!(!before.is_empty(), "the seed produced no sections");
    crate::persistence::with_persistent_engine(|e| {
        e.db.execute_batch(
            "CREATE TRIGGER refuse_the_ledger BEFORE INSERT ON section_history
             WHEN NEW.kind <> 'archived'
             BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .expect("trigger");
    })
    .unwrap();

    let result = run_with(&answering((
        vec![found_section(&line)],
        vec!["ride_0_0".to_string()],
    )));

    let reason = result.expect_err("a failed write was taken as a result");
    assert!(
        reason.contains("apply"),
        "the reason names no apply: {reason}"
    );
    assert_failed_and_owed(&before);

    crate::persistence::with_persistent_engine(|e| {
        e.db.execute_batch("DROP TRIGGER refuse_the_ledger;")
            .expect("drop trigger");
    })
    .unwrap();
    let result = run_with(&answering((
        vec![found_section(&line)],
        vec!["ride_0_0".to_string()],
    )));
    assert!(matches!(result, Ok(super::CutoverOutcome::Completed(_))));
    assert!(!crate::persistence::with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
}
