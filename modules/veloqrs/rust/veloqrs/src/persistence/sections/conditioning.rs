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

use crate::objects::detection::{DetectionPoll, poll_detection_once};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::with_persistent_engine;
use std::sync::Mutex;
use std::time::Duration;

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
pub fn maybe_condition_backfill() -> bool {
    let due = CONDITIONER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take_batch();
    if !due {
        return false;
    }
    try_start_conditioning()
}

fn try_start_conditioning() -> bool {
    {
        let guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return false;
        }
    }

    // Unified-only: gate before spawning the worker. Same lock the spawn
    // takes, so this costs one extra acquisition per fired batch only.
    let handle = with_persistent_engine(|engine| {
        if matches!(
            engine.section_config.detection_method,
            tracematch::DetectionMethod::Unified
        ) {
            Some(engine.detect_sections_background(None))
        } else {
            None
        }
    })
    .flatten();

    let Some(handle) = handle else {
        return false;
    };

    {
        let mut guard = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            // Lost the start race. Drop our handle: the orphaned worker's
            // sends fail harmlessly and the winning run covers the pool.
            return false;
        }
        *guard = Some(handle);
    }

    spawn_conditioning_driver();
    log::info!("tracematch: [conditioning] backfill run started");
    true
}

/// Drive the in-flight run to completion. Shares `poll_detection_once`
/// with the FFI poll: if the TS side polls first (sync end reached), it
/// applies and this thread sees Idle and exits.
fn spawn_conditioning_driver() {
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(Duration::from_millis(250));
            match poll_detection_once() {
                Ok(DetectionPoll::Running) => continue,
                Ok(DetectionPoll::Applied) => {
                    log::info!("tracematch: [conditioning] run applied");
                    // Adds that landed during the run may already make the
                    // next batch due; chain immediately so a fast download
                    // never outpaces the cadence unboundedly.
                    if maybe_condition_backfill() {
                        // The fresh run spawned its own driver.
                    }
                    break;
                }
                Ok(DetectionPoll::Idle) | Ok(DetectionPoll::Died) => break,
                Err(e) => {
                    log::warn!("tracematch: [conditioning] driver poll failed: {}", e);
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn undue_batch_is_a_cheap_no_op() {
        let mut c = Conditioner::new();
        c.note_stored(1);
        assert!(!c.take_batch());
        c.note_stored(0);
        assert!(!c.take_batch());
    }
}
