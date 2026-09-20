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

mod c;
mod fetch;
#[cfg(target_os = "android")]
mod jni;
mod notfound;
mod preseed;
mod store;

pub use fetch::{FILL_PACE, TileFetchError, TileFetcher};
pub use preseed::{
    GROUND_BUDGET_BYTES, GROUND_ZOOMS, PlannedTile, PreseedSource, SeedOutcome, plan_preseed,
    seed_ground_background, seed_preseed,
};
pub use store::{TileStore, is_kept_offline};

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

/// Where a source's tiles are named: by a template the page handed over, or by
/// a TileJSON that has to be fetched to learn one.
///
/// Decided on the template's own shape and never on the source's name. The
/// page used to match one literal `https://tiles.openfreemap.org/planet`, so a
/// second vector host went uncached with nothing saying so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateSource {
    /// `{z}/{x}/{y}` are in the string: it names tiles already.
    Tiles,
    /// No placeholders: it names a TileJSON document, which names the tiles.
    TileJson,
}

impl TemplateSource {
    pub fn of(template: &str) -> Self {
        if template.contains("{z}") && template.contains("{x}") && template.contains("{y}") {
            TemplateSource::Tiles
        } else {
            TemplateSource::TileJson
        }
    }
}

/// Templates resolved out of a TileJSON, by source.
///
/// Kept beside the tile store rather than only in memory, because a cold start
/// with the radio off has to fill tiles from what it already holds and a
/// TileJSON it cannot fetch would leave it with no template at all.
///
/// Serving an old dated segment is safe at this origin, measured 2026-09-14:
/// a segment that no longer exists falls through to the latest run, the
/// previous week's still serves its own vintage, and tiles carry
/// `cache-control: max-age=315360000`. Only the unversioned path answers 200
/// with an empty body, which is the one thing this exists to avoid.
static RESOLVED: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Where the resolved templates are kept between runs.
fn resolved_path() -> Option<PathBuf> {
    Some(store()?.root().join("tile-templates.json"))
}

fn load_resolved(source: &str) -> Option<String> {
    let raw = std::fs::read_to_string(resolved_path()?).ok()?;
    let map: HashMap<String, String> = serde_json::from_str(&raw).ok()?;
    map.get(source).cloned()
}

fn save_resolved(source: &str, template: &str) {
    let Some(path) = resolved_path() else { return };
    let mut map: HashMap<String, String> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    map.insert(source.to_string(), template.to_string());
    if let Ok(raw) = serde_json::to_string(&map)
        && let Err(e) = std::fs::write(&path, raw)
    {
        log::warn!("[basemap] could not keep the resolved template: {e}");
    }
}

/// Drop every resolved template held in memory, so the next resolve reads the
/// sidecar the way a fresh process does.
#[doc(hidden)]
pub fn forget_resolved_templates() {
    RESOLVED.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// The `{z}/{x}/{y}` template a tile fill uses, or `None` when the source names
/// a TileJSON nothing has resolved yet.
///
/// Never the TileJSON url itself: filling a tile from that would fetch a
/// document per tile and answer no bytes.
pub fn tile_template_for(source: &str) -> Option<String> {
    let template = template_for(source)?;
    match TemplateSource::of(&template) {
        TemplateSource::Tiles => Some(template),
        TemplateSource::TileJson => {
            // The held lock is dropped before the sidecar read, which takes it
            // again to fill: one statement holding both is a self-deadlock, and
            // the reader is a mutex rather than a reentrant lock.
            let held = RESOLVED
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(source)
                .cloned();
            match held {
                Some(template) => Some(template),
                None => {
                    let stored = load_resolved(source)?;
                    RESOLVED
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(source.to_string(), stored.clone());
                    Some(stored)
                }
            }
        }
    }
}

/// The template to fill a tile from, resolving the TileJSON once if that is
/// what the source names.
///
/// `fetch_text` is handed in so the resolve can be exercised without a host.
/// A refresh that cannot reach the host keeps whatever was resolved before:
/// dropping it would leave an offline map with no template at all, and an old
/// dated segment still serves tiles at this origin.
pub fn resolve_template_with(
    source: &str,
    fetch_text: impl FnOnce(&str) -> Result<String, String>,
) -> Option<String> {
    let template = template_for(source)?;
    if TemplateSource::of(&template) == TemplateSource::Tiles {
        return Some(template);
    }
    if let Some(held) = tile_template_for(source) {
        return Some(held);
    }
    match fetch_text(&template) {
        Ok(body) => match tiles_template_of(&body) {
            Some(resolved) => {
                RESOLVED
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(source.to_string(), resolved.clone());
                save_resolved(source, &resolved);
                log::info!("[basemap] {source} resolved to {resolved}");
                Some(resolved)
            }
            None => {
                log::warn!("[basemap] {source} TileJSON named no tiles template");
                None
            }
        },
        Err(e) => {
            log::warn!("[basemap] {source} TileJSON did not fetch: {e}");
            None
        }
    }
}

/// [`resolve_template_with`] against the tile fetcher, which is what a real
/// fill uses. Split so the resolve itself can be exercised without a host.
fn resolve_template(source: &str) -> Option<String> {
    resolve_template_with(source, |url| {
        let fetcher = INTERACTIVE.as_ref().ok_or("no tile fetcher")?;
        let bytes = crate::runtime::block_on(fetcher.fetch(url)).map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    })
}

/// The first `tiles` entry of a TileJSON document.
fn tiles_template_of(body: &str) -> Option<String> {
    let doc: serde_json::Value = serde_json::from_str(body).ok()?;
    doc.get("tiles")?
        .as_array()?
        .first()?
        .as_str()
        .map(str::to_string)
}

pub fn template_for(source: &str) -> Option<String> {
    TEMPLATES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .cloned()
}

/// A `{z}/{x}/{y}` template with one tile's coordinates in it.
pub(crate) fn fill_template(template: &str, z: u8, x: u32, y: u32) -> String {
    template
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
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

/// The source name the map page asks the heatmap's own tiles under.
const HEATMAP_SOURCE: &str = "heatmap";

/// One tile's bytes for whatever source the page named, or `None` when there
/// is no tile to be had. The two entry points, JNI and C, share this so they
/// differ only in how the bytes cross.
///
/// The heatmap is drawn here rather than fetched from a host, so it is not a
/// basemap source and has no template: a miss means the pass has not reached
/// that tile, which the caller answers as a 404.
pub(crate) fn tile_bytes(source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
    if source == HEATMAP_SOURCE {
        crate::persistence::tiles::heatmap_tile_bytes(z, x, y)
    } else {
        get_or_fetch(source, z, x, y)
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
    // The allowlist first, and before the store is touched. The WebView passes
    // whatever source name the page asked for, so a read came first and the
    // store admitted the name: it joined it onto the tile root, read an
    // `index.json`, walked the subdirectories and kept a `SourceIndex` under
    // that string, which nothing ever removes.
    template_for(source)?;

    let store = store()?;
    if let Some(bytes) = store.get(source, z, x, y) {
        return Some(bytes);
    }

    // Ground this source's host has already refused, for this tile or for one
    // it sits under. Asking again cannot produce a tile, and near a border it
    // is most of what a pan asks for.
    if notfound::is_refused(source, z, x, y) {
        return None;
    }

    // A source that names a TileJSON is resolved here rather than at style
    // time, because the dated snapshot segment the tiles live under is only in
    // that document. Resolved once and kept, so the miss below is the only
    // request a tile costs.
    let template = resolve_template(source)?;

    let url = fill_template(&template, z, x, y);

    let bytes = match crate::runtime::block_on(INTERACTIVE.as_ref()?.fetch(&url)) {
        Ok(bytes) => bytes,
        Err(e) => {
            if matches!(e, TileFetchError::Rejected { status: 404 }) {
                notfound::remember_refused(source, z, x, y);
            }
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
