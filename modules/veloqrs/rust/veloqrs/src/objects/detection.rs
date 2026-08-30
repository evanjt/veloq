use super::error::{VeloqError, with_engine};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use log::info;
use std::sync::Arc;

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
            log::error!("tracematch: [DetectionManager] Detection thread died without a result");
            Ok(DetectionPoll::Died)
        }
        crate::persistence::WorkerPoll::Ready((sections, detection_activity_ids)) => {
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
                        "tracematch: [DetectionManager] poll: detection apply partially \
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

            info!("tracematch: [DetectionManager] Section detection complete");
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
        info!("tracematch: [DetectionManager] Cancelled the running preview");
    }
}

#[uniffi::export]
impl DetectionManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn start(&self) -> Result<bool, VeloqError> {
        // Refuse before touching the shared handle: installing a refused
        // handle would occupy the slot with a dead run and block the
        // backfill's final re-cut behind it.
        if crate::persistence::detection_suspended() {
            info!("tracematch: [DetectionManager] Start refused: detection is suspended");
            return Ok(false);
        }
        // A cheap refusal before the cancel below, so a start that is going to
        // lose does not cost a running preview its answer. The decision that
        // counts is made under the guard held further down.
        if detection_running() {
            info!("tracematch: [DetectionManager] Section detection already running");
            return Ok(false);
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
            info!("tracematch: [DetectionManager] Section detection already running");
            return Ok(false);
        }

        let handle = with_engine(|e| e.detect_sections_background())?;
        // The funnel refuses with a dead handle when a backfill takes the
        // suspension between the check above and here. Installing it would
        // occupy the slot with a run that never happened.
        if handle.get_progress().0 == crate::persistence::sections::DETECTION_PHASE_SUSPENDED {
            info!("tracematch: [DetectionManager] Start refused: detection is suspended");
            return Ok(false);
        }

        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Section detection started");
        Ok(true)
    }

    fn poll(&self) -> Result<String, VeloqError> {
        Ok(match poll_detection_once()? {
            DetectionPoll::Idle => "idle".to_string(),
            DetectionPoll::Running => "running".to_string(),
            DetectionPoll::Applied => "complete".to_string(),
            DetectionPoll::Died => "error".to_string(),
        })
    }

    fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
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
    /// Returns false if detection is already running.
    fn force_redetect(&self) -> Result<bool, VeloqError> {
        // Refuse before clearing the processed set: a refused run must not
        // cost the evidence cache, and must not park a dead handle in the
        // slot the backfill's final re-cut needs.
        if crate::persistence::detection_suspended() {
            info!("tracematch: [DetectionManager] Force redetect refused: detection is suspended");
            return Ok(false);
        }
        if detection_running() {
            info!(
                "tracematch: [DetectionManager] Cannot force redetect: detection already running"
            );
            return Ok(false);
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
            info!(
                "tracematch: [DetectionManager] Cannot force redetect: detection already running"
            );
            return Ok(false);
        }

        // Clear processed activity IDs to force full re-evaluation
        with_engine(|e| {
            e.clear_processed_activity_ids();
        })?;

        let handle = with_engine(|e| e.detect_sections_background())?;
        if handle.get_progress().0 == crate::persistence::sections::DETECTION_PHASE_SUSPENDED {
            info!("tracematch: [DetectionManager] Force redetect refused: detection is suspended");
            return Ok(false);
        }

        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Forced full section re-detection started");
        Ok(true)
    }

    fn set_config(&self, config: crate::FfiSectionConfig) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_section_config(config.into());
        })
    }

    fn get_config(&self) -> Result<crate::FfiSectionConfig, VeloqError> {
        with_engine(|e| crate::FfiSectionConfig::from(&e.section_config))
    }

    fn set_match_strictness(
        &self,
        min_match_pct: f64,
        endpoint_threshold: f64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.match_config.min_match_percentage = min_match_pct;
            e.match_config.endpoint_threshold = endpoint_threshold;
            e.set_setting(
                crate::persistence::settings_keys::MATCH_MIN_MATCH_PCT,
                &min_match_pct.to_string(),
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("persist match_min_match_pct failed: {}", err),
            })?;
            e.set_setting(
                crate::persistence::settings_keys::MATCH_ENDPOINT_THRESHOLD,
                &endpoint_threshold.to_string(),
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("persist match_endpoint_threshold failed: {}", err),
            })?;
            Ok::<(), VeloqError>(())
        })??;
        Ok(())
    }

    fn get_match_strictness(&self) -> Result<crate::FfiMatchStrictness, VeloqError> {
        with_engine(|e| crate::FfiMatchStrictness {
            min_match_pct: e.match_config.min_match_percentage,
            endpoint_threshold: e.match_config.endpoint_threshold,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::sections::detection_workers_started;
    use crate::persistence::sections::preview::SECTION_PREVIEW_HANDLE;
    use crate::test_globals::{
        clear_detection_handle, drain_detection, race, seeded_global_engine, serial_global_state,
    };
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::Mutex;
    use tempfile::TempDir;

    fn init_global_engine() -> TempDir {
        crate::test_globals::init_global_engine("poison.db")
    }

    /// Panic under a lock, swallowing the unwind and the hook's output.
    fn poison<T>(lock: &Mutex<T>) {
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
    fn concurrent_starts_spawn_exactly_one_worker() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(|| DetectionManager::new().start().expect("start"));

        assert_eq!(won, 1, "exactly one start may win the race");
        assert_eq!(
            detection_workers_started() - before,
            1,
            "a losing start must not leave an orphan worker behind"
        );

        drain_detection();
    }

    #[test]
    fn concurrent_force_redetects_spawn_exactly_one_worker() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(|| DetectionManager::new().force_redetect().expect("redetect"));

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
    fn a_second_start_while_running_costs_nothing() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let manager = DetectionManager::new();
        assert!(
            manager.start().expect("first start"),
            "the first start wins"
        );

        let before = detection_workers_started();
        assert!(!manager.start().expect("second start"), "the slot is taken");
        assert!(
            !manager.force_redetect().expect("second redetect"),
            "the slot is taken"
        );
        assert_eq!(
            detection_workers_started() - before,
            0,
            "a refused start must not spawn a worker"
        );

        drain_detection();
    }

    /// Expected behaviour: a suspension refuses every arm, and a refusal must
    /// leave the slot empty so the backfill's own re-cut can take it.
    #[test]
    fn a_suspended_start_installs_nothing() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let _suspension = crate::persistence::suspend_detection();
        let manager = DetectionManager::new();
        assert!(!manager.start().expect("start"), "suspended start refuses");
        assert!(
            !manager.force_redetect().expect("redetect"),
            "suspended force redetect refuses"
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

    #[test]
    fn detection_survives_a_poisoned_handle_lock() {
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
            manager.start().expect("start must not answer LockFailed"),
            "detection still starts after the handle lock is poisoned"
        );
        assert!(
            manager.get_progress().is_ok(),
            "progress still reads after the handle lock is poisoned"
        );

        clear_detection_handle();
    }

    #[test]
    fn a_poisoned_preview_lock_still_cancels() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine();
        clear_detection_handle();

        poison(&SECTION_PREVIEW_HANDLE);

        // Silently skipping the cancel is the failure this guards: a detect
        // would then start beside a preview that is still running.
        cancel_running_preview();

        let manager = DetectionManager::new();
        assert!(
            manager.start().expect("start must not answer LockFailed"),
            "a detect starts after cancelling through a poisoned preview lock"
        );

        clear_detection_handle();
    }
}
