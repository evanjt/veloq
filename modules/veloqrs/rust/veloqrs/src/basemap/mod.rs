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

mod bundled;
mod c;
mod encoding;
mod fetch;
mod geo;
mod glyphs;
#[cfg(target_os = "android")]
mod jni;
mod notfound;
mod preseed;
mod store;
mod throttle;

pub use fetch::{FILL_PACE, TileFetchError, TileFetcher};
pub use geo::geo_answer;
#[cfg(test)]
pub(crate) use geo::route_lines_collection;
pub use preseed::{
    GROUND_BUDGET_BYTES, GROUND_ZOOMS, PlannedTile, PreseedSource, SeedOutcome, TERRAIN_ZOOMS,
    plan_area_preseed, plan_preseed, seed_preseed, seed_ranked_preseed, seed_terrain_background,
    start_ground_preseed,
};
pub use store::{SourceTileCounts, TileCounts, TileStore, is_kept_offline};

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    drop(guard);
    // A new store has a sidecar of its own that nothing has read yet.
    SIDECAR_READ
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    log::info!("[basemap] Tile store path set to: {}", path);
}

/// Forget the store, as a process no path has been handed to yet.
#[cfg(test)]
pub(crate) fn close() {
    *STORE.lock().unwrap_or_else(|e| e.into_inner()) = None;
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
///
/// Safe is not current, though. An old segment falls through to the latest
/// run once it expires, so misses fetched under it are a newer vintage than
/// the tiles already stored under the same key. Each template is therefore
/// refetched once it is [`TEMPLATE_REFRESH`] old.
static RESOLVED: LazyLock<Mutex<HashMap<String, HeldTemplate>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// How old a resolved template may get before the next miss refetches its
/// TileJSON. The host publishes a run a week, so a day keeps the tiles filed
/// under one segment to within a day of that run.
pub const TEMPLATE_REFRESH: Duration = Duration::from_secs(24 * 60 * 60);

/// How long a refresh that did not come back waits before another is tried.
/// Offline every tile the map asks for is a miss, and each would otherwise
/// cost a TileJSON request that cannot land.
const REFRESH_RETRY: Duration = Duration::from_secs(10 * 60);

/// How long a TileJSON that has never resolved waits before it is asked for
/// again. Shorter than [`REFRESH_RETRY`], because with nothing held the map
/// draws no tiles above the bundled floor until it lands, and a failed request
/// costs only a runtime thread's wait.
const UNRESOLVED_RETRY: Duration = Duration::from_secs(30);

/// When a resolve was last started for each source, in seconds since the
/// epoch. A resolve in flight counts, so a pan's dozens of misses start one.
static REFRESH_STARTED: LazyLock<Mutex<HashMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Sources whose entry in the sidecar has been read since the store was set.
/// The sidecar gains an entry only through a resolve, which holds it in
/// memory too, so a source with nothing held is not read again on every miss.
static SIDECAR_READ: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// One resolve at a time per source. A miss that finds a resolve in flight
/// waits for it here, on the runtime, and then fills from what it resolved.
static RESOLVING: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn resolve_turn(source: &str) -> Arc<tokio::sync::Mutex<()>> {
    Arc::clone(
        RESOLVING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(source.to_string())
            .or_default(),
    )
}

/// A resolved template and when its TileJSON was fetched, in seconds since
/// the epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct HeldTemplate {
    template: String,
    fetched_at: u64,
}

/// A template as `tile-templates.json` holds it. A file written before fetch
/// times were recorded holds the bare string, which reads as fetched at the
/// epoch: it still serves offline and is refreshed at the first chance.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredTemplate {
    Dated(HeldTemplate),
    Bare(String),
}

impl From<StoredTemplate> for HeldTemplate {
    fn from(stored: StoredTemplate) -> Self {
        match stored {
            StoredTemplate::Dated(held) => held,
            StoredTemplate::Bare(template) => HeldTemplate {
                template,
                fetched_at: 0,
            },
        }
    }
}

/// Where the resolved templates are kept between runs.
fn resolved_path() -> Option<PathBuf> {
    Some(store()?.root().join("tile-templates.json"))
}

fn read_resolved(path: &std::path::Path) -> HashMap<String, HeldTemplate> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<HashMap<String, StoredTemplate>>(&raw).ok())
        .map(|map| map.into_iter().map(|(k, v)| (k, v.into())).collect())
        .unwrap_or_default()
}

/// This source's entry in the sidecar, read once per store.
fn load_resolved(source: &str) -> Option<HeldTemplate> {
    let path = resolved_path()?;
    if !SIDECAR_READ
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(source.to_string())
    {
        return None;
    }
    read_resolved(&path).remove(source)
}

fn save_resolved(source: &str, held: &HeldTemplate) {
    let Some(path) = resolved_path() else { return };
    let mut map = read_resolved(&path);
    map.insert(source.to_string(), held.clone());
    if let Ok(raw) = serde_json::to_string(&map)
        && let Err(e) = std::fs::write(&path, raw)
    {
        log::warn!("[basemap] could not keep the resolved template: {e}");
    }
}

/// Drop every resolved template held in memory, and every refresh started, so
/// the next resolve reads the sidecar the way a fresh process does.
#[doc(hidden)]
pub fn forget_resolved_templates() {
    RESOLVED.lock().unwrap_or_else(|e| e.into_inner()).clear();
    REFRESH_STARTED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    SIDECAR_READ
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

/// The wall clock in seconds since the epoch. A clock set before it reads as
/// zero, which makes every held template due and so refreshes it.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Whether a template fetched at `fetched_at` is due a refresh at `now`. A
/// clock that went backwards past the fetch counts as due, or a template
/// stamped in the future would never be refreshed.
fn is_due(fetched_at: u64, now: u64) -> bool {
    now < fetched_at || now - fetched_at >= TEMPLATE_REFRESH.as_secs()
}

/// Whether a resolve of `source` was started inside `retry` before `now`.
fn started_within(started: &HashMap<String, u64>, source: &str, now: u64, retry: Duration) -> bool {
    matches!(started.get(source), Some(&at) if at <= now && now - at < retry.as_secs())
}

/// Claim the resolve for `source` at `now`, or `false` when one was started
/// inside `retry`.
fn claim_refresh(source: &str, now: u64, retry: Duration) -> bool {
    let mut started = REFRESH_STARTED.lock().unwrap_or_else(|e| e.into_inner());
    if started_within(&started, source, now, retry) {
        return false;
    }
    started.insert(source.to_string(), now);
    true
}

/// The held template for a source that names a TileJSON, from memory or from
/// the sidecar a previous run wrote.
fn held_template(source: &str) -> Option<HeldTemplate> {
    // The held lock is dropped before the sidecar read, which takes it again
    // to fill: one statement holding both is a self-deadlock, and the reader
    // is a mutex rather than a reentrant lock.
    let held = RESOLVED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .cloned();
    match held {
        Some(held) => Some(held),
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

/// The `{z}/{x}/{y}` template a tile fill uses, or `None` when the source names
/// a TileJSON nothing has resolved yet.
///
/// Never the TileJSON url itself: filling a tile from that would fetch a
/// document per tile and answer no bytes.
pub fn tile_template_for(source: &str) -> Option<String> {
    let template = template_for(source)?;
    match TemplateSource::of(&template) {
        TemplateSource::Tiles => Some(template),
        TemplateSource::TileJson => held_template(source).map(|held| held.template),
    }
}

/// The template to fill a tile from, resolving the TileJSON if that is what
/// the source names and refreshing it once it is due.
///
/// `fetch_text` is handed in so the resolve can be exercised without a host.
pub fn resolve_template_with(
    source: &str,
    fetch_text: impl FnOnce(&str) -> Result<String, String>,
) -> Option<String> {
    resolve_template_at(source, now_secs(), fetch_text)
}

/// [`resolve_template_with`] at a given wall time, in seconds since the epoch.
///
/// A refresh that cannot reach the host keeps whatever was resolved before:
/// dropping it would leave an offline map with no template at all, and an old
/// dated segment still serves tiles at this origin. A refresh that names a
/// different template drops the tiles this source holds opportunistically and
/// demotes its pinned ones to superseded, and a demoted ground source starts
/// the pre-seed, which fetches the new segment's tiles over them. A demoted
/// tile keeps serving until it is evicted or replaced.
pub fn resolve_template_at(
    source: &str,
    now: u64,
    fetch_text: impl FnOnce(&str) -> Result<String, String>,
) -> Option<String> {
    match resolve_step(source, now)? {
        ResolveStep::Ready(template) => Some(template),
        ResolveStep::Unavailable => None,
        ResolveStep::Fetch { url, held } => {
            let fetched = fetch_text(&url);
            finish_resolve(source, &url, now, held, fetched)
        }
    }
}

/// What a resolve does next, decided without asking any host.
enum ResolveStep {
    /// The template to fill from, with nothing to fetch.
    Ready(String),
    /// Fetch the TileJSON at `url`. `held` serves if the fetch fails.
    Fetch {
        url: String,
        held: Option<HeldTemplate>,
    },
    /// Nothing is held and a resolve was started inside [`UNRESOLVED_RETRY`],
    /// so there is no template and no request is made for one.
    Unavailable,
}

/// The next step of a resolve at `now`, claiming the fetch when it is one.
/// Only one resolve per source is started inside the retry window, whether or
/// not a template is held, so a pan's misses never ask for the TileJSON
/// together and a host that failed is not asked again on the next miss.
fn resolve_step(source: &str, now: u64) -> Option<ResolveStep> {
    let template = template_for(source)?;
    if TemplateSource::of(&template) == TemplateSource::Tiles {
        return Some(ResolveStep::Ready(template));
    }
    let step = match held_template(source) {
        Some(held) => {
            if is_due(held.fetched_at, now) && claim_refresh(source, now, REFRESH_RETRY) {
                ResolveStep::Fetch {
                    url: template,
                    held: Some(held),
                }
            } else {
                ResolveStep::Ready(held.template)
            }
        }
        None => {
            if claim_refresh(source, now, UNRESOLVED_RETRY) {
                ResolveStep::Fetch {
                    url: template,
                    held: None,
                }
            } else {
                ResolveStep::Unavailable
            }
        }
    };
    Some(step)
}

/// Keep what a TileJSON fetch named, or fall back to what was held before.
fn finish_resolve(
    source: &str,
    tilejson_url: &str,
    now: u64,
    held: Option<HeldTemplate>,
    fetched: Result<String, String>,
) -> Option<String> {
    let fetched = fetched.and_then(|body| {
        tiles_template_of(&body, tilejson_url)
            .ok_or_else(|| "the TileJSON named no tiles template".to_string())
    });
    match fetched {
        Ok(resolved) => {
            let fresh = HeldTemplate {
                template: resolved.clone(),
                fetched_at: now,
            };
            RESOLVED
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(source.to_string(), fresh.clone());
            save_resolved(source, &fresh);
            log::info!("[basemap] {source} resolved to {resolved}");
            if let Some(held) = held
                && held.template != resolved
                && let Some(store) = store()
            {
                match store.supersede(source) {
                    Ok((dropped, demoted)) => {
                        log::info!(
                            "[basemap] {source} moved off {}, dropped {dropped} tiles, demoted {demoted} pinned tiles",
                            held.template
                        );
                        if demoted > 0 && preseed::is_ground_source(source) {
                            start_ground_preseed();
                        }
                    }
                    Err(e) => log::warn!("[basemap] {source} kept tiles of the old run: {e}"),
                }
            }
            Some(resolved)
        }
        Err(e) => {
            log::warn!("[basemap] {source} TileJSON did not resolve: {e}");
            held.map(|held| held.template)
        }
    }
}

/// The template a tile fill uses, or the status the page is to be answered
/// with when the TileJSON could not be had and none is held. Blocks the
/// caller until the resolve ends, so it is for the engine's own background
/// threads and never for one the page is waiting on or one on the runtime.
fn resolve_template(source: &str) -> Result<String, u16> {
    crate::runtime::block_on(resolve_template_now(source))
}

/// [`resolve_template`] for a caller already on the runtime.
async fn resolve_template_now(source: &str) -> Result<String, u16> {
    resolve_template_status(source, |url| async move {
        let fetcher = INTERACTIVE
            .as_ref()
            .ok_or(TileFetchError::Unreachable("no tile fetcher".to_string()))?;
        fetcher.fetch_tilejson(&url).await
    })
    .await
}

/// [`resolve_template_now`] with the fetch handed in, so the status can be
/// exercised without a host. A resolve already in flight for the source is
/// waited for rather than repeated. A host asking to be left alone crosses as
/// itself, as it does for a tile, so the page backs off rather than retrying
/// as for an outage.
pub(crate) async fn resolve_template_status<F, Fut>(source: &str, fetch: F) -> Result<String, u16>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, TileFetchError>>,
{
    let turn = resolve_turn(source);
    let _turn = turn.lock().await;
    let now = now_secs();
    match resolve_step(source, now) {
        None => Err(NO_TILE),
        Some(ResolveStep::Ready(template)) => Ok(template),
        Some(ResolveStep::Unavailable) => Err(UPSTREAM_FAILED),
        Some(ResolveStep::Fetch { url, held }) => {
            let mut failure = UPSTREAM_FAILED;
            let body = match fetch(url.clone()).await {
                Ok(bytes) => String::from_utf8(bytes).map_err(|e| e.to_string()),
                Err(e) => {
                    failure = page_status(&e);
                    Err(e.to_string())
                }
            };
            finish_resolve(source, &url, now, held, body).ok_or(failure)
        }
    }
}

/// The template a miss fills from without asking any host: `Ok(None)` when
/// the TileJSON is to be resolved on the runtime first, and the status to
/// answer at once when nothing is held and the last resolve failed.
fn template_in_hand(source: &str, registered: String) -> Result<Option<String>, u16> {
    if TemplateSource::of(&registered) == TemplateSource::Tiles {
        return Ok(Some(registered));
    }
    let now = now_secs();
    match held_template(source) {
        Some(held) if !is_due(held.fetched_at, now) => Ok(Some(held.template)),
        Some(_) => Ok(None),
        None => {
            // A resolve in flight is waited for. One that has finished inside
            // the window failed, or a template would be held.
            let in_flight = resolve_turn(source).try_lock().is_err();
            let started = REFRESH_STARTED.lock().unwrap_or_else(|e| e.into_inner());
            if !in_flight && started_within(&started, source, now, UNRESOLVED_RETRY) {
                Err(UPSTREAM_FAILED)
            } else {
                Ok(None)
            }
        }
    }
}

/// The first `tiles` entry of a TileJSON document, refused when it is
/// cleartext and the document came over HTTPS. The template serves every later
/// fill of the source, so one naming `http` would move all of them off TLS on
/// the word of the document.
fn tiles_template_of(body: &str, tilejson_url: &str) -> Option<String> {
    let doc: serde_json::Value = serde_json::from_str(body).ok()?;
    let template = doc.get("tiles")?.as_array()?.first()?.as_str()?;
    if is_https(tilejson_url) && !is_https(template) {
        return None;
    }
    Some(template.to_string())
}

fn is_https(url: &str) -> bool {
    url.get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
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

/// What the page is told when there is no tile to be had: nothing lies there,
/// or nothing ever will. The page skips it as out of coverage.
pub const NO_TILE: u16 = 404;

/// What the page is told when the tile host failed in a way that is not a
/// refusal: it could not be reached, or answered with an error of its own. The
/// page counts it as a tile error rather than a hole in coverage.
pub const UPSTREAM_FAILED: u16 = 502;

/// The status a failed fetch reaches the page as. A 429 and a 503 are the host
/// asking to be left alone and cross as themselves, because that is what the
/// page's throttle backoff counts. A 404 is a refusal. An empty body is a tile
/// with nothing to draw. Anything else is the host failing.
pub fn page_status(error: &TileFetchError) -> u16 {
    match error {
        TileFetchError::Rejected { status: 429 } => 429,
        TileFetchError::Rejected { status: 503 } => 503,
        TileFetchError::Rejected { status: 404 } | TileFetchError::Empty => NO_TILE,
        TileFetchError::Rejected { .. }
        | TileFetchError::Unreachable(_)
        | TileFetchError::TooLarge { .. }
        | TileFetchError::Garbled(_)
        | TileFetchError::Store(_) => UPSTREAM_FAILED,
    }
}

/// Keep a tile fetched under `template`, unless a refresh has since moved the
/// source to another template. That refresh dropped the tiles of the run
/// `template` names, so keeping this one would serve it beside the new run's
/// under one key. The refresh records the new template before it drops, so a
/// tile that passes this check is taken by the drop or belongs to the new run.
#[allow(clippy::too_many_arguments)]
pub fn store_fetched(
    store: &TileStore,
    source: &str,
    template: &str,
    z: u8,
    x: u32,
    y: u32,
    ext: &str,
    bytes: &[u8],
) -> std::io::Result<()> {
    if tile_template_for(source).as_deref() != Some(template) {
        return Ok(());
    }
    store.put(source, z, x, y, ext, bytes, false)
}

/// One tile's bytes, from the store if it is there and from the tile host if
/// it is not, or `None` when there is no tile to be had.
pub fn get_or_fetch(source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
    fetch_tile(source, z, x, y).ok()
}

/// One tile's bytes, from the store if it is there and from the tile host if
/// it is not, or the status the page is to be answered with. A miss is
/// fetched on the caller's thread.
///
/// This is the whole point of the store being Rust's: the page asks for a
/// tile and never learns whether it was on disk, so cache-first, fetch-on-miss
/// and eviction stay in one place instead of being split across a WebView's
/// per-origin storage.
pub fn fetch_tile(source: &str, z: u8, x: u32, y: u32) -> Result<Vec<u8>, u16> {
    match lookup_tile(source, z, x, y) {
        TileLookup::Ready(bytes) => Ok(bytes),
        TileLookup::Refused(status) => Err(status),
        TileLookup::Miss(miss) => crate::runtime::block_on(miss.fetch()),
    }
}

/// What can be said about a tile without asking its host.
pub enum TileLookup {
    /// The bytes are in hand: from the store, the bundled floor or the
    /// heatmap.
    Ready(Vec<u8>),
    /// There is no tile, and this is the status the page is answered with.
    Refused(u16),
    /// The host is to be asked.
    Miss(TileMiss),
}

/// One tile the host is to be asked for, with everything asking it needs.
pub struct TileMiss {
    store: Arc<TileStore>,
    source: String,
    /// `None` when the source's TileJSON is to be resolved first.
    template: Option<String>,
    z: u8,
    x: u32,
    y: u32,
}

/// Answer a tile from what is already held, and say when the host has to be
/// asked. Only reads: the store, the bundled floor, the ground the host has
/// refused and a host that asked to be left alone. Never asks a host: a source
/// naming a TileJSON that is not resolved, or is due a refresh, resolves it in
/// [`TileMiss::fetch`] on the runtime.
pub fn lookup_tile(source: &str, z: u8, x: u32, y: u32) -> TileLookup {
    // The heatmap is drawn here rather than fetched from a host, so it is not a
    // basemap source and has no template: a deep tile is drawn on the miss,
    // and any other miss means the pass has not reached that tile, which is a
    // 404.
    if source == HEATMAP_SOURCE {
        return match crate::persistence::tiles::heatmap_tile_bytes(z, x, y) {
            Some(bytes) => TileLookup::Ready(bytes),
            None => TileLookup::Refused(NO_TILE),
        };
    }

    // The allowlist first, and before the store is touched. The WebView passes
    // whatever source name the page asked for, so a read came first and the
    // store admitted the name: it joined it onto the tile root, read an
    // `index.json`, walked the subdirectories and kept a `SourceIndex` under
    // that string, which nothing ever removes.
    // The bundled floor needs neither a template nor a store: it is a fixed
    // set of names, so answering from it admits nothing the page chose.
    let floor = bundled::tile(source, z, x, y);
    let held_or_floor = |floor: Option<&[u8]>| match floor {
        Some(bytes) => TileLookup::Ready(bytes.to_vec()),
        None => TileLookup::Refused(NO_TILE),
    };
    let Some(registered) = template_for(source) else {
        return held_or_floor(floor);
    };

    let Some(store) = store() else {
        return held_or_floor(floor);
    };
    if let Some(bytes) = store.get(source, z, x, y) {
        return TileLookup::Ready(bytes);
    }
    // Under the store and over the network, and never written back.
    if let Some(bytes) = floor {
        return TileLookup::Ready(bytes.to_vec());
    }

    // Ground this source's host has already refused, for this tile or for one
    // it sits under. Asking again cannot produce a tile, and near a border it
    // is most of what a pan asks for.
    if notfound::is_refused(source, z, x, y) {
        return TileLookup::Refused(NO_TILE);
    }

    if let Some(status) = throttle::holding(source, Instant::now()) {
        return TileLookup::Refused(status);
    }

    // A source that names a TileJSON is resolved rather than templated at
    // style time, because the dated snapshot segment the tiles live under is
    // only in that document. Resolved and kept, so the miss is the only
    // request a tile costs until the template is due a refresh. The resolve
    // itself runs with the miss on the runtime, never on the caller's thread.
    let template = match template_in_hand(source, registered) {
        Ok(template) => template,
        Err(status) => return TileLookup::Refused(status),
    };

    TileLookup::Miss(TileMiss {
        store,
        source: source.to_string(),
        template,
        z,
        x,
        y,
    })
}

impl TileMiss {
    /// Resolve the TileJSON if the source names one that is not in hand, ask
    /// the host, and keep what it sends. A 404 is remembered as refused
    /// ground, and a 429 or a 503 holds the source's next misses.
    pub async fn fetch(self) -> Result<Vec<u8>, u16> {
        let Self {
            store,
            source,
            template,
            z,
            x,
            y,
        } = self;
        let template = match template {
            Some(template) => template,
            None => match resolve_template_now(&source).await {
                Ok(template) => template,
                Err(status) => {
                    throttle::remember(&source, status, Instant::now());
                    return Err(status);
                }
            },
        };
        let url = fill_template(&template, z, x, y);
        let fetcher = INTERACTIVE.as_ref().ok_or(UPSTREAM_FAILED)?;
        let sent = match fetcher.fetch_as_sent(&url).await {
            Ok(sent) => sent,
            Err(e) => {
                if matches!(e, TileFetchError::Rejected { status: 404 }) {
                    notfound::remember_refused(&source, z, x, y);
                }
                log::warn!(
                    "[basemap] {} {}/{}/{} did not fetch: {}",
                    source,
                    z,
                    x,
                    y,
                    e
                );
                let status = page_status(&e);
                throttle::remember(&source, status, Instant::now());
                return Err(status);
            }
        };

        // Decompressed before it is kept, so a body that will not decompress
        // is neither drawn nor kept.
        let tile = if encoding::is_gzip(&sent) {
            match encoding::gunzip(&sent) {
                Ok(tile) => Some(tile),
                Err(e) => {
                    log::warn!(
                        "[basemap] {} {}/{}/{} did not decompress: {}",
                        source,
                        z,
                        x,
                        y,
                        e
                    );
                    return Err(UPSTREAM_FAILED);
                }
            }
        } else {
            None
        };

        store.record_fetch(&source);
        if let Err(e) = store_fetched(
            &store,
            &source,
            &template,
            z,
            x,
            y,
            &extension_of(&url),
            &sent,
        ) {
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
        Ok(tile.unwrap_or(sent))
    }

    /// Ask the host on the engine's runtime and hand the answer to `done`,
    /// without holding the caller's thread. `done` is called exactly once,
    /// with a 502 if the fetch panicked, so a page waiting on it is never left
    /// waiting for good.
    pub fn spawn(self, done: impl FnOnce(Result<Vec<u8>, u16>) + Send + 'static) {
        let fetch = crate::runtime::spawn(self.fetch());
        crate::runtime::spawn(async move {
            done(fetch.await.unwrap_or(Err(UPSTREAM_FAILED)));
        });
    }
}

#[cfg(test)]
mod template_tests {
    use super::*;

    #[test]
    fn a_ground_tile_at_z0_is_answered_from_the_app_with_nothing_fetched() {
        let bytes = fetch_tile("openmaptiles", 0, 0, 0).expect("bundled floor");
        assert!(!bytes.is_empty());
    }

    #[test]
    fn a_rate_limited_tilejson_with_nothing_held_reaches_the_page_as_429() {
        set_template(
            "limited-source".to_string(),
            "https://tiles.example.test/planet".to_string(),
        );
        let status =
            crate::runtime::block_on(resolve_template_status("limited-source", |_| async {
                Err(TileFetchError::Rejected { status: 429 })
            }));
        assert_eq!(status, Err(429));
    }

    #[test]
    fn an_unreachable_tilejson_with_nothing_held_reaches_the_page_as_502() {
        set_template(
            "down-source".to_string(),
            "https://tiles.example.test/planet".to_string(),
        );
        let status = crate::runtime::block_on(resolve_template_status("down-source", |_| async {
            Err(TileFetchError::Unreachable("offline".to_string()))
        }));
        assert_eq!(status, Err(UPSTREAM_FAILED));
    }

    /// Offline on a fresh install every tile the map asks for is a miss, and
    /// with nothing held each one used to ask for the TileJSON again.
    #[test]
    fn a_tilejson_that_never_resolved_is_asked_once_inside_the_retry() {
        const AT: u64 = 1_790_000_000;
        set_template(
            "never-resolved".to_string(),
            "https://tiles.example.test/never-resolved".to_string(),
        );

        let mut asks = 0;
        for _ in 0..20 {
            let resolved = resolve_template_at("never-resolved", AT, |_| {
                asks += 1;
                Err("offline".to_string())
            });
            assert_eq!(resolved, None);
        }
        assert_eq!(asks, 1, "every miss asked for the TileJSON again");

        let retried =
            resolve_template_at("never-resolved", AT + UNRESOLVED_RETRY.as_secs(), |_| {
                asks += 1;
                Err("offline".to_string())
            });
        assert_eq!(retried, None);
        assert_eq!(asks, 2, "a failed resolve was never tried again");
    }

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
