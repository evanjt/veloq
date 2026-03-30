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

    /// Generate heatmap tiles for a bounding box at the specified zoom levels.
    /// Tiles are saved as PNGs at `{base_path}/{z}/{x}/{y}.png`.
    /// Returns the number of non-empty tiles generated.
    fn generate_tiles(
        &self,
        base_path: String,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
        min_zoom: u8,
        max_zoom: u8,
    ) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.generate_heatmap_tiles(&base_path, min_lat, max_lat, min_lng, max_lng, min_zoom, max_zoom)
        })
    }

    /// Delete heatmap tiles that intersect with the given bounds.
    /// Returns the number of tiles deleted.
    fn invalidate_tiles(
        &self,
        base_path: String,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.invalidate_heatmap_tiles(&base_path, min_lat, max_lat, min_lng, max_lng)
        })
    }

    /// Clear all heatmap tiles from disk.
    /// Returns the number of zoom-level directories removed.
    fn clear_tiles(&self, base_path: String) -> Result<u32, VeloqError> {
        with_engine(|e| e.clear_heatmap_tiles(&base_path))
    }
}
