use super::error::{VeloqError, with_engine};
use std::sync::Arc;

/// What one poll of the cache-size walk says. `bytes` is meaningful only
/// while `state` is "complete".
#[derive(Debug, Clone, uniffi::Record)]
pub struct CacheSizePoll {
    pub state: String,
    pub bytes: u64,
}

/// The figure the last walk produced, for the polls that did not observe it.
fn last_cache_size() -> std::sync::MutexGuard<'static, Option<u64>> {
    crate::persistence::persistent_engine_ffi::CACHE_SIZE_LAST
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Total bytes under a `z/x/y` tile tree. A tree that is not there is zero,
/// and anything not under `z/x/` is not a tile and does not count.
fn walk_cache_size(base_path: &str) -> u64 {
    let path = std::path::Path::new(base_path);
    if !path.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    if let Ok(z_entries) = std::fs::read_dir(path) {
        for z_entry in z_entries.flatten() {
            if !z_entry.path().is_dir() {
                continue;
            }
            if let Ok(x_entries) = std::fs::read_dir(z_entry.path()) {
                for x_entry in x_entries.flatten() {
                    if !x_entry.path().is_dir() {
                        continue;
                    }
                    if let Ok(y_entries) = std::fs::read_dir(x_entry.path()) {
                        for y_entry in y_entries.flatten() {
                            if let Ok(meta) = y_entry.metadata() {
                                total += meta.len();
                            }
                        }
                    }
                }
            }
        }
    }
    total
}

#[derive(uniffi::Object)]
pub struct HeatmapManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl HeatmapManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Set the filesystem path for heatmap tile storage.
    /// Called once at engine init from JS (documentDirectory + "heatmap-tiles/").
    fn set_tiles_path(&self, path: String) -> Result<(), VeloqError> {
        with_engine(|e| e.set_heatmap_tiles_path(path))
    }

    /// Disable heatmap tile generation by clearing the tiles path.
    fn clear_tiles_path(&self) -> Result<(), VeloqError> {
        with_engine(|e| e.clear_heatmap_tiles_path())
    }

    /// Clear all heatmap tiles from disk.
    fn clear_tiles(&self, base_path: String) -> Result<u32, VeloqError> {
        let cleared = with_engine(|e| e.clear_heatmap_tiles(&base_path))?;
        // The remembered figure describes a tree that is gone, and the row
        // that reads it is the same row the athlete just cleared from.
        *last_cache_size() = None;
        Ok(cleared)
    }

    /// Get total size of heatmap tile cache in bytes.
    /// Walks the z/x/y directory tree natively - much faster than JS filesystem calls.
    ///
    /// Blocking, and linear in cached tiles: 40,061 of them measured 170 ms on
    /// the CPH2653, against a 100 ms mount budget. Every mount path uses
    /// `start_cache_size` and `poll_cache_size` instead. This stays for the
    /// callers that are already off the JS thread and for the tests.
    fn get_cache_size(&self, base_path: String) -> Result<u64, VeloqError> {
        Ok(walk_cache_size(&base_path))
    }

    /// Start the cache-size walk on its own thread. Poll `poll_cache_size`
    /// for the figure.
    ///
    /// A walk already running is not an error: the answer it will give is the
    /// answer this caller wants, and three settings mount effects ask for it
    /// at once. Starting a second one would walk the same tree twice for one
    /// number.
    fn start_cache_size(&self, base_path: String) -> Result<(), VeloqError> {
        let mut guard = crate::persistence::persistent_engine_ffi::CACHE_SIZE_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return Ok(());
        }
        *guard = Some(crate::persistence::walk_cache_size_background(
            base_path,
            walk_cache_size,
        ));
        Ok(())
    }

    /// Poll the running walk. `state` is "idle", "running" or "complete", and
    /// `bytes` is the last figure walked, whichever of the three it is.
    ///
    /// The figure outlives the poll that observed it. Only one poll gets the
    /// message off the channel, and three mount effects share one walk, so a
    /// figure that vanished with the first reader would leave the other two
    /// showing nothing.
    ///
    /// A walk that died reports "complete" against whatever was last known
    /// rather than erroring: this is a storage readout, and a screen that
    /// cannot show one is not a screen that should refuse to open.
    fn poll_cache_size(&self) -> Result<CacheSizePoll, VeloqError> {
        let mut guard = crate::persistence::persistent_engine_ffi::CACHE_SIZE_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        let state = match guard.as_ref().map(|h| h.poll_state()) {
            None => "idle",
            Some(crate::persistence::WorkerPoll::Running) => "running",
            Some(crate::persistence::WorkerPoll::Ready(bytes)) => {
                *guard = None;
                *last_cache_size() = Some(bytes);
                "complete"
            }
            Some(crate::persistence::WorkerPoll::Died) => {
                *guard = None;
                log::error!("veloqrs: [HeatmapManager] Cache-size walk died without a figure");
                "complete"
            }
        };

        Ok(CacheSizePoll {
            state: state.to_string(),
            bytes: last_cache_size().unwrap_or(0),
        })
    }

    /// Poll tile generation progress: "idle" | "running" | "complete"
    fn poll(&self) -> Result<String, VeloqError> {
        let mut handle_guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        if handle_guard.is_none() {
            return Ok("idle".to_string());
        }

        match handle_guard.as_ref().unwrap().poll_state() {
            crate::persistence::WorkerPoll::Ready(_count) => {
                *handle_guard = None;
                Ok("complete".to_string())
            }
            crate::persistence::WorkerPoll::Running => Ok("running".to_string()),
            crate::persistence::WorkerPoll::Died => {
                // Worker died without sending. Clear the handle so the next
                // generation attempt can start instead of blocking forever.
                *handle_guard = None;
                log::error!("veloqrs: [TileManager] Tile generation thread died");
                Ok("error".to_string())
            }
        }
    }

    /// Stop the heatmap work the athlete has lost interest in.
    ///
    /// Both the tile pass and the invalidation sweep, because both are
    /// heatmap work and neither is worth finishing once the screen that wanted
    /// it is gone. Cancelling costs a stale heatmap that the next pass redraws,
    /// which is the whole reason this is the cheapest thing in the engine to
    /// make cancellable. Returns whether anything was running to stop.
    fn cancel(&self) -> Result<bool, VeloqError> {
        let mut stopped = false;

        if let Some(handle) = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            handle.cancel();
            stopped = true;
        }

        // The handle stays in its slot: the worker is still winding down and
        // `poll` is what clears it, so taking it here would lose the outcome
        // the caller is waiting to read.
        if crate::persistence::cancel_tile_sweeps() {
            stopped = true;
        }

        Ok(stopped)
    }

    /// Get tile generation progress: (processed, total). Returns (0, 0) if idle.
    fn get_progress(&self) -> Result<Vec<u32>, VeloqError> {
        let handle_guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        match handle_guard.as_ref() {
            Some(handle) => {
                let (processed, total) = handle.get_progress();
                Ok(vec![processed, total])
            }
            None => Ok(vec![0, 0]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};

    #[test]
    fn cache_size_walks_the_zxy_tree_and_a_missing_tree_is_zero() {
        let tmp = tempfile::TempDir::new().unwrap();
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("tiles");
        let base_str = base.to_string_lossy().into_owned();
        assert_eq!(heatmap.get_cache_size(base_str.clone()).unwrap(), 0);

        std::fs::create_dir_all(base.join("12").join("2130")).unwrap();
        std::fs::write(base.join("12").join("2130").join("1450.png"), [0u8; 300]).unwrap();
        std::fs::write(base.join("12").join("2130").join("1451.png"), [0u8; 200]).unwrap();
        std::fs::write(base.join("version.txt"), "ignored, not under z/x/").unwrap();
        assert_eq!(heatmap.get_cache_size(base_str).unwrap(), 500);
    }

    /// Scenario: three settings mount effects each called `get_cache_size`,
    /// which walks the whole z/x/y tree synchronously. At 40,061 tiles that
    /// was measured at 170 ms on the CPH2653, against a 100 ms mount budget.
    ///
    /// Expected behaviour: the mount starts the walk and polls it, the
    /// `start_backup` shape, and the figure it eventually reads is the same
    /// figure the blocking walk gives.
    #[test]
    fn the_walk_runs_off_the_calling_thread_and_gives_the_same_figure() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("tiles");
        let base_str = base.to_string_lossy().into_owned();
        std::fs::create_dir_all(base.join("12").join("2130")).unwrap();
        std::fs::write(base.join("12").join("2130").join("1450.png"), [0u8; 300]).unwrap();
        std::fs::write(base.join("12").join("2130").join("1451.png"), [0u8; 200]).unwrap();
        clear_cache_size_slot();

        assert_eq!(heatmap.poll_cache_size().unwrap().state, "idle");
        heatmap.start_cache_size(base_str.clone()).unwrap();

        let done = poll_until_complete(&heatmap);
        assert_eq!(done.bytes, 500);
        assert_eq!(done.bytes, heatmap.get_cache_size(base_str).unwrap());
        // The slot is released, and the figure outlives the poll that took it:
        // two of the three mount effects only ever see this.
        let after = heatmap.poll_cache_size().unwrap();
        assert_eq!(after.state, "idle");
        assert_eq!(after.bytes, 500);
    }

    /// Scenario: three mount effects share one walk, and only the first poll
    /// to observe completion takes the message off the channel.
    ///
    /// Expected behaviour: the two that missed it read the same figure, not
    /// zero.
    #[test]
    fn a_poll_that_missed_the_completion_still_reads_the_figure() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("tiles");
        std::fs::create_dir_all(base.join("11").join("5")).unwrap();
        std::fs::write(base.join("11").join("5").join("9.png"), [0u8; 128]).unwrap();
        clear_cache_size_slot();

        heatmap
            .start_cache_size(base.to_string_lossy().into_owned())
            .unwrap();
        assert_eq!(poll_until_complete(&heatmap).bytes, 128);

        assert_eq!(heatmap.poll_cache_size().unwrap().bytes, 128);
        assert_eq!(heatmap.poll_cache_size().unwrap().bytes, 128);
    }

    #[test]
    fn a_second_mount_joins_the_walk_already_running_rather_than_starting_another() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("tiles");
        std::fs::create_dir_all(base.join("9").join("3")).unwrap();
        std::fs::write(base.join("9").join("3").join("7.png"), [0u8; 64]).unwrap();
        let base_str = base.to_string_lossy().into_owned();
        clear_cache_size_slot();

        heatmap.start_cache_size(base_str.clone()).unwrap();
        heatmap.start_cache_size(base_str.clone()).unwrap();
        heatmap.start_cache_size(base_str).unwrap();

        assert_eq!(poll_until_complete(&heatmap).bytes, 64);
        // One walk answered all three, so there is no second figure behind it.
        assert_eq!(heatmap.poll_cache_size().unwrap().state, "idle");
    }

    #[test]
    fn a_tree_that_is_not_there_walks_to_zero_off_the_thread_too() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let heatmap = HeatmapManager::new();
        clear_cache_size_slot();

        heatmap
            .start_cache_size(
                tmp.path()
                    .join("never-written")
                    .to_string_lossy()
                    .into_owned(),
            )
            .unwrap();

        assert_eq!(poll_until_complete(&heatmap).bytes, 0);
    }

    /// Scenario: the athlete clears the tile cache and the settings row keeps
    /// showing the figure the last walk produced.
    ///
    /// Expected behaviour: a clear forgets it, so the row reads zero rather
    /// than a size for a tree that is gone.
    #[test]
    fn clearing_the_tiles_forgets_the_remembered_figure() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("tiles-forget.db");
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("heat");
        let base_str = base.to_string_lossy().into_owned();
        heatmap.set_tiles_path(base_str.clone()).unwrap();
        std::fs::create_dir_all(base.join("10").join("1")).unwrap();
        std::fs::write(base.join("10").join("1").join("1.png"), [0u8; 42]).unwrap();
        clear_cache_size_slot();

        heatmap.start_cache_size(base_str.clone()).unwrap();
        assert_eq!(poll_until_complete(&heatmap).bytes, 42);

        heatmap.clear_tiles(base_str).unwrap();
        assert_eq!(heatmap.poll_cache_size().unwrap().bytes, 0);
        heatmap.clear_tiles_path().unwrap();
    }

    /// The two slots are process-wide, so every test here takes
    /// `serial_global_state` before touching them: two walks at once and each
    /// clears the other's handle out from under it.
    fn clear_cache_size_slot() {
        *crate::persistence::persistent_engine_ffi::CACHE_SIZE_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        *crate::persistence::persistent_engine_ffi::CACHE_SIZE_LAST
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn poll_until_complete(heatmap: &HeatmapManager) -> CacheSizePoll {
        for _ in 0..2000 {
            let poll = heatmap.poll_cache_size().unwrap();
            if poll.state == "complete" {
                return poll;
            }
            assert_eq!(poll.state, "running");
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        panic!("the walk never completed");
    }

    #[test]
    fn the_path_is_set_and_cleared_on_the_engine_and_a_clear_counts_files() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("tiles.db");
        let heatmap = HeatmapManager::new();
        let base = tmp.path().join("heat");
        let base_str = base.to_string_lossy().into_owned();

        heatmap.set_tiles_path(base_str.clone()).unwrap();
        std::fs::create_dir_all(base.join("10").join("1")).unwrap();
        std::fs::write(base.join("10").join("1").join("1.png"), [0u8; 10]).unwrap();
        assert_eq!(heatmap.clear_tiles(base_str.clone()).unwrap(), 1);
        assert_eq!(heatmap.get_cache_size(base_str).unwrap(), 0);
        heatmap.clear_tiles_path().unwrap();
    }

    /// Scenario: a panic inside a tile job poisons the handle or the sweep
    /// cancel slot, and both were read with `map_err(|_| LockFailed)`. Every
    /// later call answered `LockFailed`, so heatmap generation was over for the
    /// life of the process. Every other slot in this file already recovers.
    ///
    /// Expected behaviour: a poisoned lock is taken anyway, the same way the
    /// engine's other failover paths take theirs.
    #[test]
    fn a_poisoned_tile_lock_is_recovered_rather_than_reported_forever() {
        let _guard = serial_global_state();
        let heatmap = HeatmapManager::new();
        *crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        // Poison both slots the way a panicking tile job would.
        let _ = std::panic::catch_unwind(|| {
            let _held = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock();
            panic!("a tile job unwound");
        });
        assert!(
            crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
                .lock()
                .is_err(),
            "the slot has to be poisoned for this to test anything"
        );

        assert_eq!(heatmap.poll().unwrap(), "idle");
        assert_eq!(heatmap.get_progress().unwrap(), vec![0, 0]);
        assert!(!heatmap.cancel().unwrap(), "nothing was running to stop");
    }

    /// Scenario: two tile sweeps are in flight. `add_activities_batch` spawns
    /// one for new and mutated activities and the removal path spawns another,
    /// and the elevation backfill stores through the same batch while a GPS
    /// sync stores its own.
    ///
    /// Expected behaviour: a cancel reaches both. One slot holds one token, so
    /// the second spawn overwrote the first and the first swept on unstoppably.
    #[test]
    fn a_cancel_reaches_every_running_sweep_and_not_only_the_last() {
        let _guard = serial_global_state();
        let heatmap = HeatmapManager::new();

        let first = crate::persistence::register_tile_sweep();
        let second = crate::persistence::register_tile_sweep();

        assert!(heatmap.cancel().unwrap(), "two sweeps were running");
        assert!(
            second.token().is_cancelled(),
            "the last sweep was not stopped"
        );
        assert!(first.token().is_cancelled(), "the first sweep kept running");
    }

    /// Scenario: the sweep that finishes first used to clear the one slot, so a
    /// cancel after it reached neither the sweep still running nor anything at
    /// all.
    ///
    /// Expected behaviour: a sweep ending takes its own registration and leaves
    /// its sibling's, and a cancel with none left is a no-op rather than a lie.
    #[test]
    fn a_sweep_ending_leaves_its_siblings_cancellable() {
        let _guard = serial_global_state();
        let heatmap = HeatmapManager::new();

        let first = crate::persistence::register_tile_sweep();
        let second = crate::persistence::register_tile_sweep();
        let still_running = second.token();
        drop(first);

        assert!(heatmap.cancel().unwrap(), "one sweep was still running");
        assert!(
            still_running.is_cancelled(),
            "the survivor was not reachable"
        );

        drop(second);
        assert!(!heatmap.cancel().unwrap(), "nothing was left to stop");
    }

    #[test]
    fn generation_reads_idle_with_no_worker() {
        let _guard = serial_global_state();
        let heatmap = HeatmapManager::new();
        *crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        assert_eq!(heatmap.poll().unwrap(), "idle");
        assert_eq!(heatmap.get_progress().unwrap(), vec![0, 0]);
    }
}
