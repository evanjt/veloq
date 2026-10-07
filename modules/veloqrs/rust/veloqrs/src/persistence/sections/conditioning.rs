//! Conditioning cadence for the two-tier ingest.
//!
//! The attach tier gives every stored activity instant junction rows; this
//! module decides when the deferred tier (the order-free detection over the
//! clusters those activities touched) actually runs. During a long backfill
//! a run fires every [`CONDITIONING_BATCH_ADDS`] stored activities, so the
//! catalogue grows while the download continues. Small syncs never reach
//! the threshold and keep the existing sync-end detection flow unchanged.
//!
//! The cached incremental recomputes just the touched clusters, so a run
//! costs a pool load plus the changed ground.
//!
//! A fired run applies on its worker thread, so a mid-backfill catalogue lands
//! even though the TS sync UI only starts following at sync end. Order-freeness
//! makes any interrupted run safely redoable: the next run re-derives the
//! same catalogue from the durable pool.

use crate::objects::detection::{SlotWait, wait_on_slot};
use crate::persistence::attempts::Release;
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

// ============================================================================
// Detection suspension
// ============================================================================

/// Live [`DetectionSuspendGuard`] count. Above zero, no detection run may
/// start on any arm.
///
/// A partly elevated library is worse than a uniformly flat one: a candidate
/// lift span survives when its own track carries no elevation, but a rescuing
/// track without elevation cannot rescue it. Mid-backfill a real climb is
/// therefore vetoed, the spurious section is written, and it takes a durable
/// ledger id that outlives the backfill. Detection has to be all-or-nothing
/// against a backfill, and this counter is how.
///
/// Never persisted, and deliberately so. A process that dies mid-backfill
/// comes back with detection enabled; the backfill's own `elevation_state`
/// provenance is what lets it resume, so nothing is lost by forgetting the
/// suspension. The opposite failure, a suspension that survives a restart,
/// means the user's sections never update again.
static DETECTION_SUSPENSIONS: AtomicUsize = AtomicUsize::new(0);

/// True while any [`DetectionSuspendGuard`] is alive.
pub fn detection_suspended() -> bool {
    DETECTION_SUSPENSIONS.load(Ordering::SeqCst) > 0
}

/// Holds detection suspended for as long as it lives.
///
/// Release is structural: the count falls on drop, so an early return, a `?`
/// or a panic on the backfill path cannot leave detection wedged.
#[must_use = "detection resumes the moment the guard is dropped"]
#[derive(Debug)]
pub struct DetectionSuspendGuard {
    _private: (),
}

impl Drop for DetectionSuspendGuard {
    fn drop(&mut self) {
        // Saturating: an underflow would wrap to a huge count and suspend
        // detection for the rest of the process.
        let _ = DETECTION_SUSPENSIONS.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
            Some(n.saturating_sub(1))
        });
    }
}

/// Suspend detection until the returned guard is dropped. Guards nest: two
/// overlapping backfills both have to finish before detection resumes.
pub fn suspend_detection() -> DetectionSuspendGuard {
    DETECTION_SUSPENSIONS.fetch_add(1, Ordering::SeqCst);
    log::info!("veloqrs: [conditioning] detection suspended");
    DetectionSuspendGuard { _private: () }
}

/// Stored activities between conditioning runs during a backfill. One run
/// costs roughly a pool load plus the touched clusters, so every 50 adds
/// keeps the conditioning overhead well under the download time while the
/// catalogue refreshes about twenty times across a 1,000-activity backfill.
pub const CONDITIONING_BATCH_ADDS: u32 = 50;

/// Adds-since-last-run counter. Counts stored activities, including those
/// that arrive while a conditioning run is in flight (the run snapshotted
/// its pool at spawn, so later adds belong to the next batch).
#[derive(Debug)]
pub struct Conditioner {
    adds_pending: u32,
    install: u64,
}

impl Conditioner {
    pub const fn new() -> Self {
        Self {
            adds_pending: 0,
            install: 0,
        }
    }

    fn for_install(&mut self, install: u64) -> Option<u32> {
        if self.install > install {
            return None;
        }
        if self.install < install {
            self.install = install;
            self.adds_pending = 0;
        }
        Some(self.adds_pending)
    }

    fn consume(&mut self, install: u64, observed: u32) {
        if self.install == install {
            self.adds_pending = self.adds_pending.saturating_sub(observed);
        }
    }

    pub fn note_stored(&mut self, n: u32) {
        self.adds_pending = self.adds_pending.saturating_add(n);
    }

    /// True when a backfill batch is due; firing resets the counter.
    pub fn take_batch(&mut self) -> bool {
        let due = self.adds_pending >= CONDITIONING_BATCH_ADDS;
        if due {
            self.adds_pending = 0;
        }
        due
    }
}

impl Default for Conditioner {
    fn default() -> Self {
        Self::new()
    }
}

static CONDITIONER: Mutex<Conditioner> = Mutex::new(Conditioner::new());

/// Record stores for the engine install that actually committed them.
pub fn note_stored_for(install: u64, n: u32) {
    let mut conditioner = CONDITIONER.lock().unwrap_or_else(|e| e.into_inner());
    if conditioner.for_install(install).is_some() {
        conditioner.note_stored(n);
    }
}

/// End of a stored batch: whatever is pending below the threshold gets its
/// run now, so a small sync still lands a catalogue without the app asking.
pub fn condition_pending() -> bool {
    condition_pending_for(None)
}

/// Let a Rust sync end ask for work owed by the install it started on.
pub(crate) fn condition_pending_for_install(install: u64) -> bool {
    condition_pending_for(Some(install))
}

fn condition_pending_for(install: Option<u64>) -> bool {
    condition_pending_for_with(install, || {})
}

fn condition_pending_for_with(install: Option<u64>, after_start: impl FnOnce()) -> bool {
    if detection_suspended() {
        return false;
    }
    let install = install.unwrap_or_else(crate::persistence::engine_install);
    let observed = CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .for_install(install)
        .unwrap_or(0);
    // A refused start (a run already active) keeps the count: the driver
    // flushes it when that run applies, so the follow-up fires on its own.
    let started = try_start_conditioning_inner(observed == 0, Some(install));
    after_start();
    if started {
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .consume(install, observed);
    }
    started
}

/// Fire a due backfill batch. A refused start keeps the batch owed.
pub fn maybe_condition_backfill() -> bool {
    if detection_suspended() {
        // Leave the counter standing: the adds are still unprocessed, so the
        // first batch after release covers them.
        return false;
    }
    let install = crate::persistence::engine_install();
    let observed = CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .for_install(install)
        .unwrap_or(0);
    if observed < CONDITIONING_BATCH_ADDS {
        return false;
    }
    let started = try_start_conditioning_inner(false, Some(install));
    if started {
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .consume(install, observed);
    }
    started
}

/// Start a conditioning run unless one is already in flight. The whole
/// single-flight decision lives here, so this is the only start path.
pub fn try_start_conditioning() -> bool {
    try_start_conditioning_inner(false, None)
}

fn try_start_conditioning_inner(owed_only: bool, required_install: Option<u64>) -> bool {
    if detection_suspended() {
        return false;
    }
    let install = required_install.unwrap_or_else(crate::persistence::engine_install);
    // Held across check, spawn and install. Releasing it to spawn lets a
    // loser start a second worker that rewrites `route_groups` on its own
    // connection beside the winner, with both track pools resident.
    // The same key the FFI start claims, so a run that failed holds the
    // conditioner back too: the pending count keeps standing and the next due
    // batch used to start another run at once, with nothing between a failing
    // detect and the next scan of the whole pool.
    if crate::objects::detection::claim_detect_for(install).is_err() {
        return false;
    }

    let mut guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        crate::objects::detection::settle_detect_for(install, Release::Deferred);
        return false;
    }

    let handle = crate::persistence::with_persistent_engine_for(install, |engine| {
        if owed_only && !engine.detection_owed() {
            return None;
        }
        Some((
            crate::persistence::engine_install(),
            engine.detect_sections_background_applying(super::detection::ApplyOn::Worker),
        ))
    })
    .flatten();

    let Some((spawn_install, handle)) = handle else {
        crate::objects::detection::settle_detect_for(install, Release::Deferred);
        return false;
    };

    // A suspension or an owed cutover taken while the engine lock was held
    // gives back a dead handle. Installing it would occupy the slot with a run
    // that never ran, and nothing failed, so the key goes back clean.
    if crate::persistence::sections::detection_was_refused(&handle) {
        crate::objects::detection::settle_detect_for(install, Release::Deferred);
        return false;
    }

    let slot = handle.checkpoint_slot();
    slot.mark_detect_claimed();
    crate::objects::detection::record_started_run(&slot);
    *guard = Some(handle);
    drop(guard);
    slot.mark_installed(spawn_install);

    spawn_conditioning_driver(spawn_install);
    log::info!("veloqrs: [conditioning] backfill run started");
    true
}

/// Follow the in-flight run and flush work added while it ran.
/// Put a batch back that its driver stopped following.
///
/// A run whose driver timed out may still be going, and may still apply. The
/// count is what decides whether the next store fires a run, so restoring it
/// costs at worst one redundant conditioning pass, which is order-free and
/// safely redoable. Losing it costs the catalogue the batch until enough
/// further activities arrive to reach the threshold again.
fn requeue_abandoned_batch(install: u64) {
    requeue_after_check_with(install, || {});
}

fn requeue_after_check_with(install: u64, after_check: impl FnOnce()) {
    if crate::persistence::engine_install() == install {
        after_check();
        crate::persistence::with_persistent_engine_for(install, |_| {
            let mut conditioner = CONDITIONER.lock().unwrap_or_else(|e| e.into_inner());
            if conditioner.for_install(install).is_some() {
                conditioner.note_stored(CONDITIONING_BATCH_ADDS);
            }
        });
    }
}

fn flush_after_run(install: u64) -> bool {
    flush_after_run_with(install, || {})
}

fn flush_after_run_with(install: u64, after_check: impl FnOnce()) -> bool {
    if crate::persistence::engine_install() != install {
        return false;
    }
    after_check();
    condition_pending_for(Some(install))
}

fn spawn_conditioning_driver(install: u64) {
    const DRIVER_POLL: Duration = Duration::from_millis(250);

    // Counted before the thread starts. `wait_on_slot` counts its own caller,
    // but not until the thread has reached it, so a caller that asks straight
    // after `try_start_conditioning` would otherwise race the spawn and read
    // no driver at all.
    let counted = crate::objects::detection::SlotDriver::started();
    crate::threads::spawn_named("veloq-cond", move || {
        let _counted = counted;
        // Bounded: a worker that hangs rather than panicking never reports
        // `Died`, and this thread outlives the call that spawned it.
        match wait_on_slot(DRIVER_POLL, true) {
            SlotWait::Applied | SlotWait::Idle => {
                // Adds that landed during the run get their run now,
                // threshold or not: a flush this run refused was kept
                // for exactly this moment.
                if flush_after_run(install) {
                    // The fresh run spawned its own driver.
                }
            }
            SlotWait::Died => {}
            // The two elevation paths have the resume ladder above them, so a
            // give-up there is asked again on its own. This one has nothing
            // above it: the batch that timed out is simply not conditioned,
            // and the only thing that would notice is the next batch. So the
            // adds are put back, and the next store fires a run for them.
            other => {
                log::warn!("veloqrs: [conditioning] driver gave up: {:?}", other);
                requeue_abandoned_batch(install);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
    use crate::persistence::with_persistent_engine;
    use crate::test_globals::{
        clear_detection_handle, drain_detection, seeded_global_engine,
        serial_global_state as serial,
    };

    fn note_stored(n: u32) {
        note_stored_for(crate::persistence::engine_install(), n);
    }

    #[test]
    fn batch_fires_at_threshold_and_resets() {
        let mut c = Conditioner::new();
        c.note_stored(CONDITIONING_BATCH_ADDS - 1);
        assert!(!c.take_batch(), "below threshold must not fire");
        c.note_stored(1);
        assert!(c.take_batch(), "threshold reached must fire");
        assert!(!c.take_batch(), "firing resets the counter");
    }

    #[test]
    fn adds_during_a_run_count_toward_the_next_batch() {
        let mut c = Conditioner::new();
        c.note_stored(CONDITIONING_BATCH_ADDS);
        assert!(c.take_batch());
        c.note_stored(CONDITIONING_BATCH_ADDS + 3);
        assert!(c.take_batch(), "a full batch accumulated mid-run fires");
        assert!(!c.take_batch());
    }

    /// Expected behaviour: a process that has never suspended detects. A
    /// suspension is process-lifetime only, so a fresh process starts here.
    #[test]
    fn a_fresh_process_is_not_suspended() {
        let _serial = serial();
        assert!(!detection_suspended());
    }

    #[test]
    fn the_guard_releases_on_drop() {
        let _serial = serial();
        {
            let _guard = suspend_detection();
            assert!(detection_suspended());
        }
        assert!(!detection_suspended());
    }

    /// Expected behaviour: an early return out of a suspended scope still
    /// releases, because release is the guard's drop and not a matched call.
    #[test]
    fn the_guard_releases_on_an_early_return() {
        let _serial = serial();
        fn bails_out() -> Option<()> {
            let _guard = suspend_detection();
            assert!(detection_suspended());
            None?;
            unreachable!()
        }
        assert!(bails_out().is_none());
        assert!(!detection_suspended());
    }

    #[test]
    fn the_guard_releases_on_a_panic() {
        let _serial = serial();
        let outcome = std::panic::catch_unwind(|| {
            let _guard = suspend_detection();
            panic!("backfill blew up");
        });
        assert!(outcome.is_err());
        assert!(!detection_suspended());
    }

    #[test]
    fn nested_guards_hold_until_the_last_one_drops() {
        let _serial = serial();
        let outer = suspend_detection();
        let inner = suspend_detection();
        drop(inner);
        assert!(detection_suspended(), "the outer guard still holds");
        drop(outer);
        assert!(!detection_suspended());
    }

    /// The conditioning arm: a due batch is refused while suspended, and the
    /// adds it was going to cover still fire once detection resumes.
    #[test]
    fn conditioning_refuses_while_suspended() {
        let _serial = serial();
        let guard = suspend_detection();
        note_stored(CONDITIONING_BATCH_ADDS);
        assert!(
            !maybe_condition_backfill(),
            "suspended must not start a run"
        );
        drop(guard);
        assert!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take_batch(),
            "the refused batch is still pending after release"
        );
    }

    #[test]
    fn a_batch_end_flushes_whatever_is_pending_and_nothing_else() {
        let _serial = serial();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        with_persistent_engine(|engine| {
            let ids: Vec<String> = (0..6).map(|i| format!("a{i}")).collect();
            engine.save_processed_activity_ids(&ids).expect("processed");
        })
        .expect("engine");
        let pending_now = || {
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending
        };
        {
            let mut c = CONDITIONER.lock().unwrap_or_else(|e| e.into_inner());
            c.adds_pending = 0;
        }
        assert!(!condition_pending(), "nothing pending, nothing to flush");

        // A run already in the slot refuses the start. The pending count has
        // to survive that refusal, because the driver flushes it when the
        // active run applies.
        // A worker that has sent its result and not yet settled, so the slot
        // stays held until the drain reads it. A live worker installed with
        // its install settles itself whenever it finishes, which is a race
        // with the refusal this checks.
        let running = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let slot = running.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(running);
        slot.mark_installed(crate::persistence::engine_install());

        note_stored(3);
        assert!(!condition_pending(), "a refused flush starts nothing");
        assert_eq!(pending_now(), 3, "a refused flush keeps its count");

        drain_detection();

        assert!(condition_pending(), "the flush fires once the slot frees");
        assert_eq!(pending_now(), 0, "a flush that started zeroes its count");

        drain_detection();
        assert!(!condition_pending(), "nothing left to flush");
    }

    #[test]
    fn a_conditioning_install_clears_the_previous_runs_outcome() {
        let _serial = serial();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let manager = crate::objects::DetectionManager::new();
        assert!(manager.start().expect("first run").started());
        drain_detection();
        assert_eq!(manager.last_outcome(), "complete");

        with_persistent_engine(|engine| {
            for i in 0..30 {
                let points = (0..32)
                    .map(|j| {
                        tracematch::GpsPoint::new(
                            46.0 + f64::from(j) * 0.0001,
                            7.0 + f64::from(i) * 0.001,
                        )
                    })
                    .collect();
                engine
                    .add_activity(format!("next_{i}"), points, "Ride".into())
                    .expect("activity");
            }
        })
        .expect("engine");
        let install = crate::persistence::engine_install();
        note_stored_for(install, 1);
        assert!(condition_pending_for_with(None, || {
            assert_eq!(
                manager.last_outcome(),
                "idle",
                "the earlier verdict cannot describe the new run"
            );
        }));
        drain_detection();
        assert!(
            crate::objects::detection::claim_detect_for(install).is_ok(),
            "the completed conditioning run releases its own detect claim"
        );
        crate::objects::detection::settle_detect_for(install, Release::Done);
    }

    #[test]
    fn test_condition_pending_failed_run_backs_off_claim() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        rusqlite::Connection::open(tmp.path().join("detection.db"))
            .expect("db")
            .execute("DROP TABLE gps_tracks", [])
            .expect("remove track table");

        let install = crate::persistence::engine_install();
        note_stored_for(install, 1);
        assert!(condition_pending_for(Some(install)));
        drain_detection();
        let held = crate::objects::detection::claim_detect_for(install).unwrap_err();
        assert_eq!(
            held.outcome,
            crate::objects::start::FfiStartOutcome::Held,
            "a failed conditioning run backs off rather than wedging the key"
        );
        let row = crate::persistence::with_persistent_engine_for(install, |engine| {
            engine
                .job_attempt(&crate::objects::detection::detect_key())
                .expect("read")
                .expect("row")
        })
        .expect("engine");
        assert_eq!(
            held.retry_at_ms,
            Some(
                (row.last_attempt_at.expect("failure time")
                    + crate::persistence::attempts::attempt_backoff_ms(row.attempts - 1))
                    as f64
            )
        );
    }

    #[test]
    fn a_due_backfill_batch_survives_a_busy_slot() {
        let _serial = serial();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;
        // A worker that has sent its result and not yet settled, so the slot
        // stays held until the drain reads it. A live worker installed with
        // its install settles itself whenever it finishes, which is a race
        // with the refusal this checks.
        let running = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let slot = running.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(running);
        slot.mark_installed(crate::persistence::engine_install());

        note_stored(CONDITIONING_BATCH_ADDS);
        assert!(!maybe_condition_backfill(), "busy slot refuses the batch");
        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            CONDITIONING_BATCH_ADDS,
            "the refused batch is still owed"
        );

        drain_detection();
        assert!(condition_pending(), "the freed slot starts the owed batch");
        drain_detection();
    }

    #[test]
    fn a_sync_without_new_stores_starts_durable_owed_detection() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        crate::persistence::clear_persistent_engine();
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init(
                tmp.path()
                    .join("detection.db")
                    .to_string_lossy()
                    .into_owned()
            ),
            "the library reopens after a killed run"
        );
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;

        assert!(
            condition_pending(),
            "unprocessed GPS survives a lost counter"
        );
        drain_detection();
    }

    #[test]
    fn an_old_driver_does_not_flush_the_next_engine() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        crate::persistence::clear_persistent_engine();
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init(
                tmp.path()
                    .join("detection.db")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert_ne!(crate::persistence::engine_install(), old_install);
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;

        assert!(!flush_after_run(old_install));
        assert!(
            with_persistent_engine(|engine| engine.detection_owed()).expect("engine"),
            "the next engine still owns its unprocessed activities"
        );
        assert!(condition_pending(), "its own sync can start detection");
        drain_detection();
    }

    #[test]
    fn a_replacement_between_driver_check_and_start_keeps_its_debt() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;

        let started = flush_after_run_with(old_install, || {
            crate::persistence::clear_persistent_engine();
            assert!(
                crate::persistence::persistent_engine_ffi::persistent_engine_init(
                    tmp.path()
                        .join("detection.db")
                        .to_string_lossy()
                        .into_owned()
                )
            );
            note_stored(7);
        });

        assert!(!started, "an old driver cannot start a replacement engine");
        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            7,
            "the old flush must not consume the replacement's count"
        );
        assert!(
            with_persistent_engine(|engine| engine.detection_owed()).expect("engine"),
            "the replacement keeps its own durable work"
        );
    }

    #[test]
    fn a_replacement_between_driver_check_and_requeue_gets_no_old_batch() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;

        requeue_after_check_with(old_install, || {
            crate::persistence::clear_persistent_engine();
            assert!(
                crate::persistence::persistent_engine_ffi::persistent_engine_init(
                    tmp.path()
                        .join("detection.db")
                        .to_string_lossy()
                        .into_owned()
                )
            );
        });

        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            0,
            "a timed-out old driver cannot requeue into the replacement"
        );
    }

    #[test]
    fn a_new_install_store_during_start_survives_old_batch_consumption() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;
        note_stored(3);

        assert!(condition_pending_for_with(None, || {
            crate::persistence::clear_persistent_engine();
            assert!(
                crate::persistence::persistent_engine_ffi::persistent_engine_init(
                    tmp.path()
                        .join("detection.db")
                        .to_string_lossy()
                        .into_owned()
                )
            );
            note_stored(7);
        }));
        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            7,
            "the old run must not consume the replacement's new stores"
        );
        clear_detection_handle();
        assert!(
            condition_pending(),
            "the replacement's seven stores still start their own run"
        );
        drain_detection();
        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            0,
            "the replacement consumes its batch only after starting"
        );
    }

    #[test]
    fn a_store_from_an_old_install_cannot_count_for_its_replacement() {
        let _serial = serial();
        let tmp = seeded_global_engine();
        clear_detection_handle();
        let old_install = crate::persistence::engine_install();
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
        note_stored_for(new_install, 7);
        note_stored_for(old_install, 1);
        assert_eq!(
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .adds_pending,
            7,
            "a store that finished against the old engine cannot join the new batch"
        );
    }

    #[test]
    fn undue_batch_is_a_cheap_no_op() {
        let mut c = Conditioner::new();
        c.note_stored(1);
        assert!(!c.take_batch());
        c.note_stored(0);
        assert!(!c.take_batch());
    }

    /// Scenario: the conditioning driver is the one caller of `wait_on_slot`
    /// with no retry above it. The two elevation paths have the resume ladder,
    /// which asks again on its own; a batch this driver stops following is
    /// simply not conditioned, and the only thing that would notice is the
    /// next batch reaching the threshold on its own.
    ///
    /// Expected behaviour: the adds go back, so the next store fires a run for
    /// them. A redundant conditioning pass costs a pool load and is order-free
    /// and safely redoable; a lost batch costs the catalogue those activities
    /// until enough further ones arrive.
    mod a_batch_whose_driver_gave_up {
        use super::*;

        #[test]
        fn is_put_back_rather_than_lost() {
            let _serial = serial();
            let _tmp = seeded_global_engine();
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take_batch();

            requeue_abandoned_batch(crate::persistence::engine_install());

            assert!(
                CONDITIONER
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take_batch(),
                "the batch the driver abandoned is not due again"
            );
        }

        /// It puts back a batch, and `take_batch` zeroes rather than
        /// subtracts, so putting one back twice still owes one run. That is
        /// the Conditioner's existing rule and this does not change it: the
        /// point is that the batch is due at all, not how many are owed.
        #[test]
        fn owes_a_run_however_many_times_it_is_put_back() {
            let _serial = serial();
            let _tmp = seeded_global_engine();
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take_batch();

            requeue_abandoned_batch(crate::persistence::engine_install());
            requeue_abandoned_batch(crate::persistence::engine_install());

            let mut guard = CONDITIONER.lock().unwrap_or_else(|e| e.into_inner());
            assert!(guard.take_batch(), "the batch is due");
            assert!(!guard.take_batch(), "and firing it consumes the count");
        }
    }
}
