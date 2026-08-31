use super::error::VeloqError;
use crate::basemap;
use std::sync::Arc;

/// The basemap tile store's FFI surface.
///
/// Everything here answers from the filesystem, so none of it needs a live
/// WebView, a network or the engine lock. The directory itself is the caller's
/// to choose: a basemap tile cannot be redrawn from local data, so it must not
/// be handed a path the OS purges.
#[derive(uniffi::Object)]
pub struct BasemapManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl BasemapManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Set the filesystem path for the basemap tile tree. Called once at
    /// engine init from JS, the way `setTilesPath` hands over the heatmap path.
    fn set_path(&self, path: String) {
        basemap::set_path(path);
    }

    /// One tile's bytes, or none. A hit moves the tile to the back of the
    /// eviction queue.
    fn get_tile(&self, source: String, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
        basemap::store()?.get(&source, z, x, y)
    }

    /// Store one tile. `pinned` marks the pre-seeded offline base, which
    /// eviction takes last.
    fn put_tile(
        &self,
        source: String,
        z: u8,
        x: u32,
        y: u32,
        ext: String,
        bytes: Vec<u8>,
        pinned: bool,
    ) -> Result<(), VeloqError> {
        store()?
            .put(&source, z, x, y, &ext, &bytes, pinned)
            .map_err(tile_store_error)
    }

    /// Total bytes across every source, answered without a WebView.
    fn get_cache_size(&self) -> u64 {
        basemap::store().map(|s| s.size()).unwrap_or(0)
    }

    /// Bytes held for one source.
    fn get_source_size(&self, source: String) -> u64 {
        basemap::store().map(|s| s.size_of(&source)).unwrap_or(0)
    }

    /// Drop every basemap tile, pinned pre-seed included.
    fn clear_tiles(&self) -> Result<u32, VeloqError> {
        store()?.clear().map_err(tile_store_error)
    }

    /// Drop every tile of one source.
    fn clear_source_tiles(&self, source: String) -> Result<u32, VeloqError> {
        store()?.clear_source(&source).map_err(tile_store_error)
    }

    /// Bring one source under a byte budget, least recently read first and the
    /// pinned pre-seed last.
    fn evict_to(&self, source: String, budget_bytes: u64) -> Result<u32, VeloqError> {
        store()?
            .evict_to(&source, budget_bytes)
            .map_err(tile_store_error)
    }
}

fn store() -> Result<Arc<basemap::TileStore>, VeloqError> {
    basemap::store().ok_or(VeloqError::TileStore {
        msg: "no basemap tile path has been set".to_string(),
    })
}

fn tile_store_error(e: std::io::Error) -> VeloqError {
    VeloqError::TileStore { msg: e.to_string() }
}
