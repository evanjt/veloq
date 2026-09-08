use super::error::{VeloqError, with_engine};
use std::sync::Arc;

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
        with_engine(|e| e.clear_heatmap_tiles(&base_path))
    }

    /// Get total size of heatmap tile cache in bytes.
    /// Walks the z/x/y directory tree natively - much faster than JS filesystem calls.
    fn get_cache_size(&self, base_path: String) -> Result<u64, VeloqError> {
        let path = std::path::Path::new(&base_path);
        if !path.exists() {
            return Ok(0);
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
        Ok(total)
    }

    /// Poll tile generation progress: "idle" | "running" | "complete"
    fn poll(&self) -> Result<String, VeloqError> {
        let mut handle_guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

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
            .map_err(|_| VeloqError::LockFailed)?
            .as_ref()
        {
            handle.cancel();
            stopped = true;
        }

        // The handle stays in its slot: the worker is still winding down and
        // `poll` is what clears it, so taking it here would lose the outcome
        // the caller is waiting to read.
        if let Some(token) = crate::persistence::persistent_engine_ffi::TILE_SWEEP_CANCEL
            .lock()
            .map_err(|_| VeloqError::LockFailed)?
            .as_ref()
        {
            token.cancel();
            stopped = true;
        }

        Ok(stopped)
    }

    /// Get tile generation progress: (processed, total). Returns (0, 0) if idle.
    fn get_progress(&self) -> Result<Vec<u32>, VeloqError> {
        let handle_guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

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
