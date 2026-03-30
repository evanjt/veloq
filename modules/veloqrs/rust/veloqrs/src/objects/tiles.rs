use super::error::{with_engine, VeloqError};
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
}
