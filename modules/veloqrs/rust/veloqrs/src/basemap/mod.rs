//! The Rust-owned basemap tile store.
//!
//! Basemap bytes used to live in three Cache API buckets created inside the
//! map page, which is per-origin browser storage: Rust could not enumerate it,
//! size it, evict from it or pre-seed it, and neither could the backup. This
//! module owns the same bytes as a plain `<source>/<z>/<x>/<y>.<ext>` tree, so
//! every one of those questions is answerable with the radio off.
//!
//! The tree sits beside the heatmap tile tree and copies its shape, with three
//! differences the heatmap does not have to carry.
//!
//! - The directory comes from TypeScript through [`set_path`], the way
//!   `setTilesPath` already hands over the heatmap path. A basemap tile cannot
//!   be redrawn from local data, so it must not live anywhere the OS purges,
//!   but which durable directory it lands in is the caller's decision.
//! - Eviction is least-recently-read, and the pre-seeded offline base is
//!   pinned so opportunistic tiles are scrubbed first. That needs a read order
//!   a bare tree cannot record, so each source carries a sidecar index.
//! - Fetching does not go through the intervals.icu governor. Tile hosts are
//!   unauthenticated third parties on other domains, so they get their own
//!   client and their own pace, and never touch that budget.

mod fetch;
mod store;

pub use fetch::{FILL_PACE, TileFetchError, TileFetcher};
pub use store::TileStore;

use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The one store for the process, once TypeScript has said where it lives.
///
/// Held here rather than on `PersistentEngine` because a tile read must not
/// queue behind the engine lock: a single map pan asks for dozens of tiles
/// while a sync or a detect may be holding that lock for seconds.
static STORE: Lazy<Mutex<Option<Arc<TileStore>>>> = Lazy::new(|| Mutex::new(None));

/// Point the store at a directory. Called once at engine init from JS.
pub fn set_path(path: String) {
    let store = Arc::new(TileStore::new(PathBuf::from(&path)));
    let mut guard = STORE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(previous) = guard.take() {
        // The outgoing store may hold read stamps nothing has written yet.
        let _ = previous.flush();
    }
    *guard = Some(store);
    log::info!("[basemap] Tile store path set to: {}", path);
}

/// The live store, or `None` when no path has been handed over yet.
pub fn store() -> Option<Arc<TileStore>> {
    STORE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(Arc::clone)
}
