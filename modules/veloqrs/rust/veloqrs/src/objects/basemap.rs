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

    /// Where one source's tiles come from, as a `{z}/{x}/{y}` template.
    /// Handed over at style load: the vector snapshot path and the per-country
    /// satellite choice are both decided in the page, not compiled in.
    fn set_source_template(&self, source: String, url_template: String) {
        basemap::set_template(source, url_template);
    }

    /// One tile's bytes, from the store if it is there and from the tile host
    /// if it is not. Blocks until the tile is in hand.
    fn get_or_fetch_tile(&self, source: String, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
        basemap::get_or_fetch(&source, z, x, y)
    }

    // The FFI signature, which takes each field as its own argument.
    #[allow(clippy::too_many_arguments)]
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
    ///
    /// Async because the first read of a session loads every source's sidecar,
    /// and a source with none is rebuilt by walking its tree: about 330 ms on
    /// the S22 at the 400 MB ceiling, on a screen with a 100 ms mount budget.
    async fn get_cache_size(&self) -> f64 {
        off_the_caller(|| Ok(basemap::store().map(|s| s.size()).unwrap_or(0)))
            .await
            .unwrap_or(0) as f64
    }

    /// Bytes held for one source. Async for the reason
    /// [`get_cache_size`](Self::get_cache_size) is.
    async fn get_source_size(&self, source: String) -> f64 {
        off_the_caller(move || Ok(basemap::store().map(|s| s.size_of(&source)).unwrap_or(0)))
            .await
            .unwrap_or(0) as f64
    }

    /// Drop every tile that is not part of the pinned pre-seed, across every
    /// source. Async for the reason [`set_budget`](Self::set_budget) is: it
    /// can delete thousands of files.
    async fn clear_unpinned_tiles(&self) -> Result<u32, VeloqError> {
        let store = store()?;
        off_the_caller(move || store.clear_all_opportunistic().map_err(tile_store_error)).await
    }

    /// Drop every basemap tile, pinned pre-seed included.
    fn clear_tiles(&self) -> Result<u32, VeloqError> {
        store()?.clear().map_err(tile_store_error)
    }

    /// Hits, misses and fetches since start or the last reset, one row per
    /// source. Empty when no path has been set.
    fn tile_counts(&self) -> Vec<basemap::SourceTileCounts> {
        basemap::store()
            .map(|s| s.source_tile_counts())
            .unwrap_or_default()
    }

    /// Zero the tile counters.
    fn reset_tile_counts(&self) {
        if let Some(store) = basemap::store() {
            store.reset_tile_counts();
        }
    }

    /// Drop every tile of one source.
    fn clear_source_tiles(&self, source: String) -> Result<u32, VeloqError> {
        store()?.clear_source(&source).map_err(tile_store_error)
    }

    /// Write every source's sidecar back to disk.
    ///
    /// Called when the app goes to the background. The store writes a sidecar
    /// on its own only every `FLUSH_EVERY` operations, and Android kills the
    /// process without unwinding it, so `Drop` never runs: without this a
    /// source that never crossed the cadence had no sidecar at all, and the
    /// next launch rebuilt its index by walking the whole tree on whichever
    /// thread first asked for a size. Quiet when no path has been set, so a
    /// launch that never opened a map can background without an error.
    fn flush(&self) -> Result<(), VeloqError> {
        match basemap::store() {
            Some(store) => store.flush().map_err(tile_store_error),
            None => Ok(()),
        }
    }

    /// Keep the whole tree under the athlete's ceiling, in bytes, and bring it
    /// under at once. One pool, least recently read first across every source
    /// and the pinned pre-seed last, because the athlete sets one number.
    /// Every tile stored afterwards is held to it too. Answers how many tiles
    /// went.
    ///
    /// Async because lowering the ceiling can delete thousands of files.
    async fn set_budget(&self, budget_bytes: f64) -> Result<u32, VeloqError> {
        let budget_bytes = crate::ffi_types::uint_from_wire(budget_bytes);
        let store = store()?;
        off_the_caller(move || store.set_budget(budget_bytes).map_err(tile_store_error)).await
    }
}

/// Run `work` on a blocking thread of the shared runtime, so the JS thread
/// that awaits it is free while the filesystem is walked.
async fn off_the_caller<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, VeloqError> + Send + 'static,
) -> Result<T, VeloqError> {
    crate::runtime::ASYNC_RUNTIME
        .spawn_blocking(work)
        .await
        .unwrap_or_else(|e| {
            Err(VeloqError::TileStore {
                msg: format!("the tile store thread died without a result: {e}"),
            })
        })
}

fn store() -> Result<Arc<basemap::TileStore>, VeloqError> {
    basemap::store().ok_or(VeloqError::TileStore {
        msg: "no basemap tile path has been set".to_string(),
    })
}

fn tile_store_error(e: std::io::Error) -> VeloqError {
    VeloqError::TileStore { msg: e.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::block_on;
    use crate::test_globals::serial_global_state;

    #[test]
    fn a_tile_round_trips_and_the_store_answers_sizes_and_clears() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let manager = BasemapManager::new();
        manager.set_path(tmp.path().to_string_lossy().into_owned());

        assert_eq!(manager.get_tile("osm".into(), 3, 4, 2), None);
        manager
            .put_tile("osm".into(), 3, 4, 2, "pbf".into(), vec![1, 2, 3, 4], false)
            .unwrap();
        manager
            .put_tile("osm".into(), 3, 4, 3, "pbf".into(), vec![5, 6], true)
            .unwrap();
        manager
            .put_tile("sat".into(), 3, 4, 2, "jpg".into(), vec![7, 8, 9], false)
            .unwrap();
        assert_eq!(
            manager.get_tile("osm".into(), 3, 4, 2),
            Some(vec![1, 2, 3, 4])
        );
        assert_eq!(block_on(manager.get_source_size("osm".into())), 6.0);
        assert_eq!(block_on(manager.get_source_size("sat".into())), 3.0);
        assert_eq!(block_on(manager.get_cache_size()), 9.0);

        // One budget over the whole tree. The other source's tile is the
        // least recently read, so it goes even though this source is the one
        // that is over.
        assert_eq!(block_on(manager.set_budget(6.0)).unwrap(), 1);
        assert_eq!(block_on(manager.get_cache_size()), 6.0);
        assert_eq!(block_on(manager.get_source_size("sat".into())), 0.0);
        assert_eq!(
            manager.get_tile("osm".into(), 3, 4, 2),
            Some(vec![1, 2, 3, 4]),
            "the re-read tile stays, whichever source is over"
        );
        assert_eq!(manager.get_tile("osm".into(), 3, 4, 3), Some(vec![5, 6]));

        assert_eq!(manager.clear_source_tiles("osm".into()).unwrap(), 2);
        assert_eq!(block_on(manager.get_source_size("osm".into())), 0.0);
        assert_eq!(block_on(manager.get_cache_size()), 0.0);
    }

    /// The ceiling holds for every tile stored after it is set, and survives a
    /// clear of the whole store.
    #[test]
    fn a_budget_holds_the_tiles_stored_after_it_and_outlives_a_clear() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let manager = BasemapManager::new();
        manager.set_path(tmp.path().to_string_lossy().into_owned());

        assert_eq!(block_on(manager.set_budget(100.0)).unwrap(), 0);
        for y in 0..4u32 {
            manager
                .put_tile("osm".into(), 10, 1, y, "pbf".into(), vec![7; 40], false)
                .unwrap();
        }
        assert_eq!(block_on(manager.get_cache_size()), 80.0);

        assert_eq!(manager.clear_tiles().unwrap(), 2);
        assert_eq!(block_on(manager.get_cache_size()), 0.0);
        for y in 0..4u32 {
            manager
                .put_tile("osm".into(), 10, 1, y, "pbf".into(), vec![7; 40], false)
                .unwrap();
        }
        assert_eq!(block_on(manager.get_cache_size()), 80.0);
    }

    #[test]
    fn a_store_with_no_path_refuses_a_budget_and_sizes_as_empty() {
        let _guard = serial_global_state();
        basemap::close();
        let manager = BasemapManager::new();

        assert!(block_on(manager.set_budget(100.0)).is_err());
        assert!(manager.clear_tiles().is_err());
        assert_eq!(block_on(manager.get_cache_size()), 0.0);
    }

    /// Scenario: Android kills the app process without unwinding the store, so
    /// the `Drop` that writes the sidecars back never runs. A source written
    /// fewer than `FLUSH_EVERY` times therefore had no `index.json` at all, and
    /// the next launch rebuilt its index by walking the whole tree, blocking,
    /// on the thread the settings hub mounts on. Expected behaviour: the app
    /// can flush on backgrounding, which leaves every source a sidecar.
    #[test]
    fn flushing_leaves_a_sidecar_for_a_source_under_the_flush_cadence() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path();
        let manager = BasemapManager::new();
        manager.set_path(root.to_string_lossy().into_owned());

        // Five puts, under the cadence that writes the sidecar on its own.
        for y in 0..5u32 {
            manager
                .put_tile("osm".into(), 10, 1, y, "pbf".into(), vec![7; 64], false)
                .unwrap();
        }
        let sidecar = root.join("osm").join("index.json");
        assert!(
            !sidecar.exists(),
            "five puts are under the cadence, so nothing is owed to disk yet"
        );

        manager.flush().unwrap();

        assert!(
            sidecar.exists(),
            "a flush has to leave a sidecar, or the next launch walks the tree"
        );
    }

    /// The sidecar has to carry every tile, not just the ones since the last
    /// write: a source the parse path misses is a tile nothing counts or ever
    /// evicts.
    #[test]
    fn a_flushed_sidecar_carries_every_tile_the_source_holds() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path();
        let manager = BasemapManager::new();
        manager.set_path(root.to_string_lossy().into_owned());
        for y in 0..5u32 {
            manager
                .put_tile("osm".into(), 10, 1, y, "pbf".into(), vec![7; 64], false)
                .unwrap();
        }
        manager.flush().unwrap();

        // A second manager over the same root reads the sidecar back. Every
        // tile answering proves the parsed index is complete.
        let reopened = BasemapManager::new();
        reopened.set_path(root.to_string_lossy().into_owned());
        assert_eq!(block_on(reopened.get_source_size("osm".into())), 5.0 * 64.0);
        for y in 0..5u32 {
            assert!(
                reopened.get_tile("osm".into(), 10, 1, y).is_some(),
                "tile {} is on disk and has to be in the parsed index",
                y
            );
        }
    }

    /// Backgrounding happens far more often than a tile is written, so the
    /// second flush and the flush of an empty store both have to be quiet.
    #[test]
    fn flushing_is_safe_with_nothing_owed_and_with_nothing_stored() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path();
        let manager = BasemapManager::new();
        manager.set_path(root.to_string_lossy().into_owned());

        manager.flush().unwrap();
        assert!(
            !root.join("osm").join("index.json").exists(),
            "a source nothing has written has no tree and needs no index"
        );

        manager
            .put_tile("osm".into(), 10, 1, 0, "pbf".into(), vec![7; 64], false)
            .unwrap();
        manager.flush().unwrap();
        manager.flush().unwrap();
        manager
            .put_tile("osm".into(), 10, 1, 1, "pbf".into(), vec![8; 32], false)
            .unwrap();
        manager.flush().unwrap();

        let reopened = BasemapManager::new();
        reopened.set_path(root.to_string_lossy().into_owned());
        assert_eq!(
            block_on(reopened.get_source_size("osm".into())),
            64.0 + 32.0
        );
    }
}
