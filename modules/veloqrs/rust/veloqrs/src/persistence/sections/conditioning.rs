//! Conditioning cadence for the two-tier ingest.
//!
//! The attach tier gives every stored activity instant junction rows; this
//! module decides when the deferred tier (the order-free detection over the
//! clusters those activities touched) actually runs. During a long backfill
//! a run fires every [`CONDITIONING_BATCH_ADDS`] stored activities, so the
//! catalogue grows while the download continues. Small syncs never reach
//! the threshold and keep the existing sync-end detection flow unchanged.
//!
//! Only the Unified detector conditions mid-backfill: its cached
//! incremental recomputes just the touched clusters, so a run costs a pool
//! load plus the changed ground. The legacy detectors re-detect the whole
//! pool per run and stay on the one-detect-per-sync cadence.
//!
//! A fired run is driven to completion by a Rust polling thread that shares
//! the apply path with the FFI poll, so a mid-backfill catalogue lands even
//! though the TS sync UI only starts polling at sync end. Order-freeness
//! makes any interrupted run safely redoable: the next run re-derives the
//! same catalogue from the durable pool.

use crate::objects::detection::{SlotWait, wait_on_slot};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::with_persistent_engine;
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
}

impl Conditioner {
    pub const fn new() -> Self {
        Self { adds_pending: 0 }
    }

    pub fn note_stored(&mut self, n: u32) {
        self.adds_pending = self.adds_pending.saturating_add(n);
    }

    /// True when a backfill batch is due; firing resets the counter.
    pub fn take_batch(&mut self) -> bool {
        if self.adds_pending >= CONDITIONING_BATCH_ADDS {
            self.adds_pending = 0;
            true
        } else {
            false
        }
    }
}

impl Default for Conditioner {
    fn default() -> Self {
        Self::new()
    }
}

static CONDITIONER: Mutex<Conditioner> = Mutex::new(Conditioner::new());

/// Record `n` freshly stored activities against the conditioning cadence.
pub fn note_stored(n: u32) {
    CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .note_stored(n);
}

/// Fire a conditioning run if the backfill cadence is due. Returns true
/// when a run was started. A due batch that loses the single-flight race
/// (detection already running) is dropped, not carried: its activities are
/// still unprocessed, so they simply count toward the next batch or the
/// sync-end detect.
/// End of a stored batch: whatever is pending below the threshold gets its
/// run now, so a small sync still lands a catalogue without the app asking.
pub fn condition_pending() -> bool {
    if detection_suspended() {
        return false;
    }
    let due = CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .adds_pending
        > 0;
    if !due {
        return false;
    }
    // A refused start (a run already active) keeps the count: the driver
    // flushes it when that run applies, so the follow-up fires on its own.
    let started = try_start_conditioning();
    if started {
        CONDITIONER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .adds_pending = 0;
    }
    started
}

pub fn maybe_condition_backfill() -> bool {
    if detection_suspended() {
        // Leave the counter standing: the adds are still unprocessed, so the
        // first batch after release covers them.
        return false;
    }
    let due = CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take_batch();
    if !due {
        return false;
    }
    try_start_conditioning()
}

/// Start a conditioning run unless one is already in flight. The whole
/// single-flight decision lives here, so this is the only start path.
pub fn try_start_conditioning() -> bool {
    if detection_suspended() {
        return false;
    }
    // Held across check, spawn and install. Releasing it to spawn lets a
    // loser start a second worker that rewrites `route_groups` on its own
    // connection beside the winner, with both track pools resident.
    let mut guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return false;
    }

    let handle = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(super::detection::ApplyOn::Worker)
    });

    let Some(handle) = handle else {
        return false;
    };

    // A suspension or an owed cutover taken while the engine lock was held
    // gives back a dead handle. Installing it would occupy the slot with a run
    // that never ran.
    if crate::persistence::sections::detection_was_refused(&handle) {
        return false;
    }

    *guard = Some(handle);
    drop(guard);

    spawn_conditioning_driver();
    log::info!("veloqrs: [conditioning] backfill run started");
    true
}

/// Drive the in-flight run to completion. Shares `poll_detection_once`
/// with the FFI poll: if the TS side polls first (sync end reached), it
/// applies and this thread sees Idle and exits.
/// Put a batch back that its driver stopped following.
///
/// A run whose driver timed out may still be going, and may still apply. The
/// count is what decides whether the next store fires a run, so restoring it
/// costs at worst one redundant conditioning pass, which is order-free and
/// safely redoable. Losing it costs the catalogue the batch until enough
/// further activities arrive to reach the threshold again.
fn requeue_abandoned_batch() {
    CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .note_stored(CONDITIONING_BATCH_ADDS);
}

fn spawn_conditioning_driver() {
    const DRIVER_POLL: Duration = Duration::from_millis(250);

    // Counted before the thread starts. `wait_on_slot` counts its own caller,
    // but not until the thread has reached it, so a caller that asks straight
    // after `try_start_conditioning` would otherwise race the spawn and read
    // no driver at all.
    let counted = crate::objects::detection::SlotDriver::started();
    std::thread::spawn(move || {
        let _counted = counted;
        // Bounded: a worker that hangs rather than panicking never reports
        // `Died`, and this thread outlives the call that spawned it.
        match wait_on_slot(DRIVER_POLL, true) {
            SlotWait::Applied => {
                log::info!("veloqrs: [conditioning] run applied");
                // Adds that landed during the run get their run now,
                // threshold or not: a flush this run refused was kept
                // for exactly this moment.
                if condition_pending() {
                    // The fresh run spawned its own driver.
                }
            }
            SlotWait::Idle | SlotWait::Died => {}
            // The two elevation paths have the resume ladder above them, so a
            // give-up there is asked again on its own. This one has nothing
            // above it: the batch that timed out is simply not conditioned,
            // and the only thing that would notice is the next batch. So the
            // adds are put back, and the next store fires a run for them.
            other => {
                log::warn!("veloqrs: [conditioning] driver gave up: {:?}", other);
                requeue_abandoned_batch();
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
        let running =
            with_persistent_engine(|engine| engine.detect_sections_background()).expect("engine");
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(running);

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
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take_batch();

            requeue_abandoned_batch();

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
            CONDITIONER
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take_batch();

            requeue_abandoned_batch();
            requeue_abandoned_batch();

            let mut guard = CONDITIONER.lock().unwrap_or_else(|e| e.into_inner());
            assert!(guard.take_batch(), "the batch is due");
            assert!(!guard.take_batch(), "and firing it consumes the count");
        }
    }
}
