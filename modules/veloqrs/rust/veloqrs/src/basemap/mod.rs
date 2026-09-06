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
#[cfg(target_os = "android")]
mod jni;
mod store;

pub use fetch::{FILL_PACE, TileFetchError, TileFetcher};
pub use store::TileStore;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The one store for the process, once TypeScript has said where it lives.
///
/// Held here rather than on `PersistentEngine` because a tile read must not
/// queue behind the engine lock: a single map pan asks for dozens of tiles
/// while a sync or a detect may be holding that lock for seconds.
static STORE: LazyLock<Mutex<Option<Arc<TileStore>>>> = LazyLock::new(|| Mutex::new(None));

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

/// The upstream URL template for each source, as `{z}/{x}/{y}` placeholders.
///
/// Handed over by TypeScript at style load rather than compiled in, because
/// two of the sources cannot be known statically: the openfreemap vector
/// source resolves a dated snapshot path from its TileJSON, and the satellite
/// source is chosen per country from the viewport. Once Rust has the template
/// it can fill a tile without asking the page anything.
static TEMPLATES: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The fetcher a map pan uses. Unpaced, unlike [`TileFetcher::for_fill`]: a
/// single pan asks for dozens of tiles at once and the user is waiting on all
/// of them, so spacing them 100 ms apart would serve the viewport in seconds.
static INTERACTIVE: LazyLock<Option<TileFetcher>> =
    LazyLock::new(|| TileFetcher::new(Duration::ZERO).ok());

/// Record where one source's tiles come from.
pub fn set_template(source: String, template: String) {
    log::info!("[basemap] {} <- {}", source, template);
    TEMPLATES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(source, template);
}

fn template_for(source: &str) -> Option<String> {
    TEMPLATES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .cloned()
}

/// The file extension a URL stores under, ignoring any query string. Tile
/// hosts that carry z/x/y in query parameters have no extension at all, so
/// there is a fallback rather than a failure.
fn extension_of(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    match path.rsplit_once('.') {
        Some((_, ext))
            if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_alphanumeric()) =>
        {
            ext.to_ascii_lowercase()
        }
        _ => "bin".to_string(),
    }
}

/// One tile's bytes, from the store if it is there and from the tile host if
/// it is not.
///
/// This is the whole point of the store being Rust's: the page asks for a
/// tile and never learns whether it was on disk, so cache-first, fetch-on-miss
/// and eviction stay in one place instead of being split across a WebView's
/// per-origin storage.
pub fn get_or_fetch(source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
    let store = store()?;
    if let Some(bytes) = store.get(source, z, x, y) {
        return Some(bytes);
    }

    let url = template_for(source)?
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string());

    let bytes = match crate::runtime::block_on(INTERACTIVE.as_ref()?.fetch(&url)) {
        Ok(bytes) => bytes,
        Err(e) => {
            log::warn!(
                "[basemap] {} {}/{}/{} did not fetch: {}",
                source,
                z,
                x,
                y,
                e
            );
            return None;
        }
    };

    if let Err(e) = store.put(source, z, x, y, &extension_of(&url), &bytes, false) {
        // The tile is still good to draw even if it could not be kept.
        log::warn!(
            "[basemap] {} {}/{}/{} did not store: {}",
            source,
            z,
            x,
            y,
            e
        );
    }
    Some(bytes)
}

#[cfg(test)]
mod template_tests {
    use super::*;

    #[test]
    fn a_template_fills_placeholders_in_whatever_order_the_host_uses() {
        set_template(
            "eox".to_string(),
            "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
                .to_string(),
        );
        let url = template_for("eox")
            .unwrap()
            .replace("{z}", "9")
            .replace("{x}", "268")
            .replace("{y}", "180");
        assert!(url.ends_with("/9/180/268.jpg"), "got {}", url);
    }

    #[test]
    fn an_extension_ignores_a_query_string_and_falls_back_when_there_is_none() {
        assert_eq!(extension_of("https://h/1/2/3.jpg"), "jpg");
        assert_eq!(extension_of("https://h/1/2/3.PNG?v=2"), "png");
        assert_eq!(extension_of("https://h/wmts?TILEROW=3&TILECOL=4"), "bin");
    }
}
