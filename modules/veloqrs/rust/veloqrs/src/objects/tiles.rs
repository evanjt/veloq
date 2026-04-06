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

    /// Clear all heatmap tiles from disk.
    fn clear_tiles(&self, base_path: String) -> Result<u32, VeloqError> {
        with_engine(|e| e.clear_heatmap_tiles(&base_path))
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
}
