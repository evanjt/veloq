//! The pinned offline base: the ground an athlete's own regions need.
//!
//! An opportunistic store only ever holds what has already been browsed, so a
//! fresh install that syncs and then loses the radio has nothing to draw. This
//! fetches the low zooms around the athlete's own activity bounds once, pinned,
//! so eviction takes a stray pan long before it takes the world.
//!
//! What it does not do is decide what the ground is made of. The sources, their
//! templates and the zoom band are handed in, the way every other template here
//! is: the page knows which sources draw the basemap and Rust does not.

use std::collections::HashSet;
use std::future::Future;
use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use super::{TileFetchError, TileFetcher, TileStore, notfound, throttle};
use crate::tiles::tiles_for_bounds;
use tracematch::Bounds;

/// The zooms the ground pre-seed covers.
///
/// z0-1 ships in the app rather than being seeded per device, so it is outside
/// the store and outside this budget. The Natural Earth raster is not kept
/// above z6, and z2 belongs to the per-athlete set rather than a global one,
/// since a whole z2 level is 14 MB of vector against the handful of tiles one
/// athlete's bounds touch. That leaves z2 to z5: the world view, plus the
/// region around every activity.
pub const GROUND_ZOOMS: RangeInclusive<u8> = 2..=5;

/// What the ground pre-seed may spend, the top of the 1-10 MB the offline base
/// was scoped to.
///
/// Priced per tile and never per level: a whole z3 level is 18 MB, and the
/// tiles one athlete's bounds touch are a handful of it.
pub const GROUND_BUDGET_BYTES: u64 = 10 * 1024 * 1024;
pub const TERRAIN_ZOOMS: RangeInclusive<u8> = 8..=12;
const TERRAIN_SOURCE: &str = "terrain";

/// The sources the 2D basemap draws its ground from, as the style names them.
///
/// Agreed with `LIBERTY_SOURCES` in `styles/liberty/sources.ts`, the way the
/// heatmap's and satellite's source names already are. The dark style draws the
/// vector source and the light style paints `ne2_shaded` under it below z7, so
/// seeding one of the two leaves the other theme on background colour.
const GROUND_SOURCES: [&str; 2] = ["openmaptiles", "ne2_shaded"];

/// One source the pre-seed covers, as the page named it.
#[derive(Debug, Clone)]
pub struct PreseedSource {
    /// The store's source directory, which is the style's own source key.
    pub name: String,
    /// A resolved `{z}/{x}/{y}` template, never a TileJSON url.
    pub template: String,
    /// What its tiles are filed under.
    pub ext: String,
    /// The zooms to take for this source. Per source rather than per pass, so
    /// a heavier source can stop shallower than the ground does.
    pub zooms: RangeInclusive<u8>,
}

/// One tile the pre-seed will take.
///
/// Carries its own url and extension so the pass that fetches it reads no
/// configuration of its own: the plan is the whole instruction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTile {
    pub source: String,
    pub z: u8,
    pub x: u32,
    pub y: u32,
    pub url: String,
    pub ext: String,
}

/// What one pass did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SeedOutcome {
    /// Tiles taken from the host and stored pinned.
    pub fetched: u32,
    /// Tiles the store already held, pinned where they lay.
    pub kept: u32,
    /// Tiles the host would not answer. The next pass asks again.
    pub failed: u32,
    /// What the seeded set costs on disk.
    pub bytes: u64,
    /// Whether the budget ended the pass before the plan did.
    pub stopped_at_budget: bool,
}

/// Whether a bounding box is a place.
///
/// An activity with no GPS carries the (0, 0, 0, 0) sentinel, which is open
/// ocean off West Africa: seeding it would spend the whole budget on water.
fn is_a_place(b: &Bounds) -> bool {
    !(b.min_lat == 0.0 && b.max_lat == 0.0 && b.min_lng == 0.0 && b.max_lng == 0.0)
}

/// Every tile the pre-seed would take, lowest zoom first and each tile once.
///
/// The order is the budget's. Cutting the tail costs the athlete detail around
/// their own regions, never the world view the map opens on.
///
/// Within a zoom the tiles are sorted rather than left in the order the bounds
/// arrived in. Bounds come out of a hash map, so an unsorted plan cut by the
/// budget would seed a different subset on every pass and refetch the ground it
/// dropped last time for ever.
pub fn plan_preseed(bounds: &[Bounds], sources: &[PreseedSource]) -> Vec<PlannedTile> {
    let places: Vec<&Bounds> = bounds.iter().filter(|b| is_a_place(b)).collect();
    let shallowest = sources.iter().map(|s| *s.zooms.start()).min().unwrap_or(1);
    let deepest = sources.iter().map(|s| *s.zooms.end()).max().unwrap_or(0);

    let mut planned = Vec::new();
    // Where this source's slice of this zoom starts, so it can be sorted
    // without disturbing the zooms already queued ahead of it.
    let mut level = 0usize;
    // Two activities in one valley reach the same z2 tile, and a library has
    // hundreds of them, so the whole plan is deduplicated rather than each
    // source's own slice.
    let mut seen: HashSet<(usize, u8, u32, u32)> = HashSet::new();
    for z in shallowest..=deepest {
        for (i, source) in sources.iter().enumerate() {
            if !source.zooms.contains(&z) {
                continue;
            }
            for place in &places {
                for (x, y) in tiles_for_bounds(
                    place.min_lat,
                    place.max_lat,
                    place.min_lng,
                    place.max_lng,
                    z,
                ) {
                    if !seen.insert((i, z, x, y)) {
                        continue;
                    }
                    planned.push(PlannedTile {
                        source: source.name.clone(),
                        z,
                        x,
                        y,
                        url: super::fill_template(&source.template, z, x, y),
                        ext: source.ext.clone(),
                    });
                }
            }
            planned[level..].sort_by_key(|t| (t.x, t.y));
            level = planned.len();
        }
    }
    planned
}

/// Plan one ~5 km riding area at a time, in the caller's ranked order.
/// Earlier areas survive a byte budget cut before less visited ones.
pub fn plan_area_preseed(centres: &[(f64, f64)], source: &PreseedSource) -> Vec<PlannedTile> {
    let mut planned = Vec::new();
    let mut seen = HashSet::new();
    for &(lat, lng) in centres {
        if !lat.is_finite() || !lng.is_finite() {
            continue;
        }
        let half_lat = 2.5 / 111.0;
        let half_lng = 2.5 / (111.0 * lat.to_radians().cos().abs().max(0.01));
        for z in source.zooms.clone() {
            let mut tiles = tiles_for_bounds(
                lat - half_lat,
                lat + half_lat,
                lng - half_lng,
                lng + half_lng,
                z,
            );
            tiles.sort_unstable();
            for (x, y) in tiles {
                if seen.insert((z, x, y)) {
                    planned.push(PlannedTile {
                        source: source.name.clone(),
                        z,
                        x,
                        y,
                        url: super::fill_template(&source.template, z, x, y),
                        ext: source.ext.clone(),
                    });
                }
            }
        }
    }
    planned
}

/// Fetch and pin the plan, up to `budget` bytes.
///
/// A tile the store already holds is pinned where it lies rather than fetched
/// again: the pin is what the pass is for and the bytes are the same bytes. A
/// tile is priced only once it is in hand, so the budget is honoured by
/// dropping the tile that would break it rather than by storing it and
/// reporting the overshoot. The price is the body kept, compressed when the
/// host compressed it, which is what the store counts against its own budget.
pub async fn seed_preseed(
    store: &TileStore,
    fetcher: &TileFetcher,
    plan: &[PlannedTile],
    budget: u64,
) -> SeedOutcome {
    seed_preseed_with(store, plan, budget, |url| fetcher.fetch_as_sent(url)).await
}

/// `seed_preseed` with the request handed in, so a test can stand in for the
/// host.
async fn seed_preseed_with<'a, F, Fut>(
    store: &TileStore,
    plan: &'a [PlannedTile],
    budget: u64,
    mut fetch: F,
) -> SeedOutcome
where
    F: FnMut(&'a str) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, TileFetchError>>,
{
    let mut outcome = SeedOutcome::default();
    let generation = store.generation();
    // Sources whose host asked to be left alone during this pass. Kept for the
    // whole pass rather than read off the hold alone, because the hold lapses
    // in seconds and a long plan would then ask the same host again.
    let mut refused_sources: HashSet<&str> = HashSet::new();
    for tile in plan {
        if outcome.bytes >= budget {
            outcome.stopped_at_budget = true;
            break;
        }
        if let Some(bytes) = store.pin(&tile.source, tile.z, tile.x, tile.y) {
            if outcome.bytes + bytes > budget {
                outcome.stopped_at_budget = true;
                break;
            }
            outcome.kept += 1;
            outcome.bytes += bytes;
            continue;
        }
        // A host that has asked to be left alone, or ground it has said it
        // has not got, is not asked again. The tile counts as failed, so a
        // ranked pass keeps its old pins and the next pass asks again.
        if refused_sources.contains(tile.source.as_str())
            || throttle::holding(&tile.source, Instant::now()).is_some()
            || notfound::is_refused(&tile.source, tile.z, tile.x, tile.y)
        {
            outcome.failed += 1;
            continue;
        }
        let bytes = match fetch(&tile.url).await {
            Ok(bytes) => bytes,
            Err(e) => {
                match e {
                    TileFetchError::Rejected { status: 404 } => {
                        notfound::remember_refused(&tile.source, tile.z, tile.x, tile.y);
                    }
                    TileFetchError::Rejected {
                        status: status @ (429 | 503),
                    } => {
                        throttle::remember(&tile.source, status, Instant::now());
                        refused_sources.insert(&tile.source);
                    }
                    _ => {}
                }
                log::warn!(
                    "[basemap] pre-seed {} {}/{}/{} did not fetch: {}",
                    tile.source,
                    tile.z,
                    tile.x,
                    tile.y,
                    e
                );
                outcome.failed += 1;
                continue;
            }
        };
        if outcome.bytes + bytes.len() as u64 > budget {
            outcome.stopped_at_budget = true;
            break;
        }
        match store.put_in_generation(
            generation,
            &tile.source,
            tile.z,
            tile.x,
            tile.y,
            &tile.ext,
            &bytes,
            true,
        ) {
            Ok(true) => {
                outcome.fetched += 1;
                outcome.bytes += bytes.len() as u64;
            }
            // A clear ran mid-pass: the rest of the plan is the athlete's
            // ground that was just taken.
            Ok(false) => break,
            Err(e) => {
                log::warn!(
                    "[basemap] pre-seed {} {}/{}/{} did not store: {}",
                    tile.source,
                    tile.z,
                    tile.x,
                    tile.y,
                    e
                );
                outcome.failed += 1;
            }
        }
    }
    outcome
}

/// Refresh a ranked source's pins only after a successful pass. If the host
/// goes offline during a sync, its previous offline tiles stay protected.
pub async fn seed_ranked_preseed(
    store: &TileStore,
    fetcher: &TileFetcher,
    plan: &[PlannedTile],
    budget: u64,
    source: &str,
) -> SeedOutcome {
    let outcome = seed_preseed(store, fetcher, plan, budget).await;
    if outcome.failed == 0 && outcome.fetched + outcome.kept > 0 {
        store.unpin_source(source);
        let mut pinned = 0;
        for tile in plan {
            if pinned >= budget {
                break;
            }
            if let Some(bytes) = store.pin(source, tile.z, tile.x, tile.y) {
                if pinned + bytes > budget {
                    break;
                }
                pinned += bytes;
            }
        }
    }
    outcome
}

/// The ground sources the page has named a template for, resolved and ready.
///
/// Empty until a template has been handed over, which launch does before any
/// map page exists. The extension comes off the resolved template rather than
/// being stated here, so the vector source's dated snapshot path names it.
fn ground_sources() -> Vec<PreseedSource> {
    GROUND_SOURCES
        .iter()
        .filter_map(|name| {
            let template = super::resolve_template(name).ok()?;
            Some(PreseedSource {
                name: (*name).to_string(),
                ext: super::extension_of(&template),
                template,
                zooms: GROUND_ZOOMS,
            })
        })
        .collect()
}

/// Whether a pass is running. One at a time: two would fetch the same tiles
/// twice and race each other onto one sidecar.
static RUNNING: AtomicBool = AtomicBool::new(false);
static TERRAIN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Frees the slot however the pass ends, a panic included.
struct RunningGuard;

impl Drop for RunningGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

struct TerrainRunningGuard;

impl Drop for TerrainRunningGuard {
    fn drop(&mut self) {
        TERRAIN_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Seed DEM around ranked riding areas, spending at most 40% of the live pool.
pub fn seed_terrain_background(centres: Vec<(f64, f64)>) {
    if centres.is_empty() || super::store().is_none() {
        return;
    }
    if TERRAIN_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    crate::threads::spawn_named("veloq-dem-seed", move || {
        let _running = TerrainRunningGuard;
        let Some(store) = super::store() else { return };
        let Some(pool_budget) = store.budget() else {
            return;
        };
        let Ok(template) = super::resolve_template(TERRAIN_SOURCE) else {
            return;
        };
        let source = PreseedSource {
            name: TERRAIN_SOURCE.into(),
            ext: super::extension_of(&template),
            template,
            zooms: TERRAIN_ZOOMS,
        };
        let plan = plan_area_preseed(&centres, &source);
        let Ok(fetcher) = TileFetcher::for_fill() else {
            return;
        };
        let outcome = crate::runtime::block_on(seed_ranked_preseed(
            &store,
            &fetcher,
            &plan,
            pool_budget * 2 / 5,
            TERRAIN_SOURCE,
        ));
        log::info!(
            "[basemap] DEM pre-seed over {} tiles: {} fetched, {} kept, {} failed, {} bytes{}",
            plan.len(),
            outcome.fetched,
            outcome.kept,
            outcome.failed,
            outcome.bytes,
            if outcome.stopped_at_budget {
                ", stopped at the budget"
            } else {
                ""
            }
        );
        let _ = store.flush();
        if let Err(e) = store.enforce_budget() {
            log::warn!("[basemap] DEM pre-seed could not bring the store under its budget: {e}");
        }
    });
}

/// Whether the pre-seed pins this source as part of the ground.
pub(super) fn is_ground_source(source: &str) -> bool {
    GROUND_SOURCES.contains(&source)
}

/// Seed the ground around every activity's bounds, on a thread of its own.
///
/// The one way the pass starts, so its triggers cannot drift apart. A sync
/// that stored a track starts it, because that is what moves an athlete's
/// bounds. A segment change that demoted pinned ground starts it too, because
/// otherwise nothing fetches the new segment's copies until the athlete next
/// rides, and the demoted ones are evicted as opportunistic meanwhile.
///
/// The bounds are read on the pass's own thread from a pooled connection, so
/// neither the caller nor the pass waits on the engine lock. Paced well under
/// what a map pan asks for, since it is background work on someone else's
/// servers.
pub fn start_ground_preseed() {
    if super::store().is_none() {
        return;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        log::info!("[basemap] A ground pre-seed is already running - not starting another");
        return;
    }
    crate::threads::spawn_named("veloq-seed", move || {
        let _running = RunningGuard;
        let Some(store) = super::store() else { return };
        let bounds = crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::activities::pooled::activity_bounds(conn)
        });
        let bounds = match bounds {
            Some(Ok(bounds)) => bounds,
            Some(Err(e)) => {
                log::warn!("[basemap] pre-seed could not read the activity bounds: {e}");
                return;
            }
            None => return,
        };
        if bounds.is_empty() {
            return;
        }
        let sources = ground_sources();
        if sources.is_empty() {
            log::info!("[basemap] No ground template has been handed over, nothing to pre-seed");
            return;
        }
        let fetcher = match TileFetcher::for_fill() {
            Ok(fetcher) => fetcher,
            Err(e) => {
                log::warn!("[basemap] pre-seed has no tile client: {e}");
                return;
            }
        };
        let plan = plan_preseed(&bounds, &sources);
        let outcome =
            crate::runtime::block_on(seed_preseed(&store, &fetcher, &plan, GROUND_BUDGET_BYTES));
        log::info!(
            "[basemap] Ground pre-seed over {} tiles: {} fetched, {} kept, {} failed, {} bytes{}",
            plan.len(),
            outcome.fetched,
            outcome.kept,
            outcome.failed,
            outcome.bytes,
            if outcome.stopped_at_budget {
                ", stopped at the budget"
            } else {
                ""
            }
        );
        // The pass pins as it goes, so the sidecars are already on disk. This
        // is for the read stamps the pins did not carry.
        let _ = store.flush();
        // Every put already holds the ceiling. A pin of a tile already held
        // stores nothing, so the pass ends by checking it once more.
        if let Err(e) = store.enforce_budget() {
            log::warn!("[basemap] pre-seed could not bring the store under its budget: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use tempfile::TempDir;

    fn planned(source: &str, count: u32) -> Vec<PlannedTile> {
        (0..count)
            .map(|x| PlannedTile {
                source: source.to_string(),
                z: 5,
                x,
                y: 0,
                url: format!("https://tiles.test/{source}/5/{x}/0.png"),
                ext: "png".to_string(),
            })
            .collect()
    }

    /// Runs a pass against a host that answers each request with the next of
    /// `answers`, then with a tile, and returns the urls it was asked for.
    fn seed_against(
        plan: &[PlannedTile],
        answers: Vec<Result<Vec<u8>, TileFetchError>>,
    ) -> (SeedOutcome, Vec<String>) {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let asked = RefCell::new(Vec::new());
        let answers = RefCell::new(answers.into_iter());
        let outcome = crate::runtime::block_on(seed_preseed_with(&store, plan, u64::MAX, |url| {
            asked.borrow_mut().push(url.to_string());
            let answer = answers.borrow_mut().next().unwrap_or_else(|| Ok(vec![1]));
            std::future::ready(answer)
        }));
        (outcome, asked.into_inner())
    }

    #[test]
    fn a_429_stops_the_pass_asking_that_host_and_holds_it() {
        let plan = planned("seed-busy-429", 5);

        let (outcome, asked) =
            seed_against(&plan, vec![Err(TileFetchError::Rejected { status: 429 })]);

        assert_eq!(asked.len(), 1);
        assert_eq!(
            throttle::holding("seed-busy-429", Instant::now()),
            Some(429)
        );
        assert_eq!(outcome.fetched, 0);
        assert_eq!(outcome.failed, 5);
    }

    #[test]
    fn a_503_stops_the_pass_asking_that_host_and_holds_it() {
        let plan = planned("seed-busy-503", 5);

        let (_, asked) = seed_against(&plan, vec![Err(TileFetchError::Rejected { status: 503 })]);

        assert_eq!(asked.len(), 1);
        assert_eq!(
            throttle::holding("seed-busy-503", Instant::now()),
            Some(503)
        );
    }

    #[test]
    fn a_refusal_mid_pass_leaves_the_tiles_already_taken() {
        let plan = planned("seed-busy-later", 5);

        let (outcome, asked) = seed_against(
            &plan,
            vec![
                Ok(vec![1]),
                Ok(vec![1]),
                Err(TileFetchError::Rejected { status: 429 }),
            ],
        );

        assert_eq!(asked.len(), 3);
        assert_eq!(outcome.fetched, 2);
        assert_eq!(outcome.failed, 3);
    }

    #[test]
    fn a_held_host_is_not_asked_at_all() {
        throttle::remember("seed-already-held", 429, Instant::now());
        let plan = planned("seed-already-held", 3);

        let (outcome, asked) = seed_against(&plan, Vec::new());

        assert!(asked.is_empty());
        assert_eq!(outcome.failed, 3);
    }

    #[test]
    fn a_refused_host_leaves_the_other_sources_asked() {
        let mut plan = planned("seed-refusing", 3);
        plan.extend(planned("seed-answering", 3));

        let (outcome, asked) =
            seed_against(&plan, vec![Err(TileFetchError::Rejected { status: 429 })]);

        assert_eq!(asked.len(), 4);
        assert!(
            asked
                .iter()
                .skip(1)
                .all(|url| url.contains("seed-answering"))
        );
        assert_eq!(outcome.fetched, 3);
        assert_eq!(outcome.failed, 3);
    }

    #[test]
    fn a_host_failing_otherwise_is_asked_for_the_next_tile() {
        let plan = planned("seed-flaky", 3);

        let (outcome, asked) =
            seed_against(&plan, vec![Err(TileFetchError::Rejected { status: 500 })]);

        assert_eq!(asked.len(), 3);
        assert_eq!(throttle::holding("seed-flaky", Instant::now()), None);
        assert_eq!(outcome.fetched, 2);
        assert_eq!(outcome.failed, 1);
    }

    #[test]
    fn ground_already_refused_is_not_asked_for_and_a_404_is_remembered() {
        notfound::remember_refused("seed-border", 5, 1, 0);
        let plan = planned("seed-border", 3);

        let (outcome, asked) =
            seed_against(&plan, vec![Err(TileFetchError::Rejected { status: 404 })]);

        assert_eq!(asked, vec![plan[0].url.clone(), plan[2].url.clone()]);
        assert!(notfound::is_refused("seed-border", 5, 0, 0));
        assert_eq!(outcome.fetched, 1);
        assert_eq!(outcome.failed, 2);
    }

    fn source(name: &str, zooms: RangeInclusive<u8>) -> PreseedSource {
        PreseedSource {
            name: name.to_string(),
            template: format!("https://tiles.test/{name}/{{z}}/{{x}}/{{y}}.png"),
            ext: "png".to_string(),
            zooms,
        }
    }

    #[test]
    fn a_source_takes_only_its_own_zooms() {
        let bounds = Bounds {
            min_lat: 46.5,
            max_lat: 46.6,
            min_lng: 7.5,
            max_lng: 7.6,
        };

        let planned = plan_preseed(
            &[bounds],
            &[source("shallow", 2..=3), source("deep", 2..=5)],
        );

        assert!(
            planned
                .iter()
                .filter(|t| t.source == "shallow")
                .all(|t| t.z <= 3)
        );
        assert!(planned.iter().any(|t| t.source == "deep" && t.z == 5));
    }

    #[test]
    fn no_bounds_at_all_plans_nothing() {
        assert!(plan_preseed(&[], &[source("ground", GROUND_ZOOMS)]).is_empty());
    }

    #[test]
    fn no_sources_at_all_plans_nothing() {
        let bounds = Bounds {
            min_lat: 46.5,
            max_lat: 46.6,
            min_lng: 7.5,
            max_lng: 7.6,
        };

        assert!(plan_preseed(&[bounds], &[]).is_empty());
    }
}
