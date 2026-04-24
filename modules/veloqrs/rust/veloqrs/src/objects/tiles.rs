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
    /// Walks the z/x/y directory tree natively — much faster than JS filesystem calls.
    fn get_cache_size(&self, base_path: String) -> Result<u64, VeloqError> {
        let path = std::path::Path::new(&base_path);
        if !path.exists() {
            return Ok(0);
        }
        let mut total: u64 = 0;
        if let Ok(z_entries) = std::fs::read_dir(path) {
            for z_entry in z_entries.flatten() {
                if !z_entry.path().is_dir() { continue; }
                if let Ok(x_entries) = std::fs::read_dir(z_entry.path()) {
                    for x_entry in x_entries.flatten() {
                        if !x_entry.path().is_dir() { continue; }
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

        // TileGenerationHandle::try_recv() returns Option<u32>
        match handle_guard.as_ref().unwrap().try_recv() {
            Some(_count) => {
                *handle_guard = None;
                Ok("complete".to_string())
            }
            None => Ok("running".to_string()),
        }
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
