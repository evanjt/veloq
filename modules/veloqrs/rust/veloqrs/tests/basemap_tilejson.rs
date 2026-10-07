//! Resolving a vector source's dated tile template from its TileJSON.
//!
//! OpenFreeMap serves its planet tiles from a snapshot segment the TileJSON
//! names, `planet/20260906_080001_pt/{z}/{x}/{y}.pbf`, and answers the
//! unversioned path with a 200 and an empty body. So the template Rust fills a
//! tile from cannot be built at style time: it has to come out of the TileJSON
//! after that resolves.
//!
//! Keeping the resolved template is what makes the store work with the radio
//! off. Measured at this origin on 2026-09-14: an old segment serves its own
//! vintage for at least a week and then falls through to the latest, and tiles
//! carry `cache-control: max-age=315360000`. So a stored template never draws
//! empty, which is the objection that kept this on the page.
//!
//! Run: `cargo test --test app -p veloqrs -- basemap_tilejson::`

use std::sync::MutexGuard;

use tempfile::TempDir;
use veloqrs::basemap::{
    TEMPLATE_REFRESH, TemplateSource, resolve_template_at, resolve_template_with, set_template,
    template_for, tile_template_for,
};

/// The live TileJSON, trimmed to the fields the resolve reads. Taken from
/// tiles.openfreemap.org/planet on 2026-09-14.
const PLANET_TILEJSON: &str = r#"{
  "tilejson": "3.0.0",
  "tiles": ["https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf"],
  "minzoom": 0,
  "maxzoom": 14
}"#;

/// The same document after the next weekly run.
const NEXT_PLANET_TILEJSON: &str = r#"{
  "tilejson": "3.0.0",
  "tiles": ["https://tiles.openfreemap.org/planet/20261004_080001_pt/{z}/{x}/{y}.pbf"],
  "minzoom": 0,
  "maxzoom": 14
}"#;

const SEPTEMBER: &str = "https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf";
const OCTOBER: &str = "https://tiles.openfreemap.org/planet/20261004_080001_pt/{z}/{x}/{y}.pbf";

/// A wall time to resolve at, in seconds since the epoch.
const T0: u64 = 1_790_000_000;

/// The first second a template resolved at `T0` is due a refresh.
fn after_the_interval() -> u64 {
    T0 + TEMPLATE_REFRESH.as_secs()
}

/// Register the vector source the way the page does.
fn planet() {
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );
}

/// The store path, the template registry and the resolved-template map are all
/// process-wide, so these run one at a time or each one reads what another left.
/// A store of this test's own, with no resolved template held over from the
/// last one.
fn store_at(dir: &TempDir) -> MutexGuard<'static, ()> {
    let guard = super::serial_state();
    veloqrs::basemap::set_path(dir.path().to_string_lossy().into_owned());
    veloqrs::basemap::forget_resolved_templates();
    guard
}

#[test]
fn the_dated_template_comes_out_of_the_tilejson() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );

    let resolved = resolve_template_with("openfreemap", |_url| Ok(PLANET_TILEJSON.to_string()));

    assert_eq!(
        resolved.as_deref(),
        Some("https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf")
    );
}

/// The whole point of keeping it: a second tile does not ask again, and a cold
/// start with the radio off still has a template.
#[test]
fn a_resolved_template_is_kept_and_not_asked_for_twice() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );

    let mut asks = 0;
    let first = resolve_template_with("openfreemap", |_url| {
        asks += 1;
        Ok(PLANET_TILEJSON.to_string())
    });
    let second = resolve_template_with("openfreemap", |_url| {
        asks += 1;
        Ok(PLANET_TILEJSON.to_string())
    });

    assert_eq!(first, second, "the same template both times");
    assert_eq!(asks, 1, "the second tile asked upstream again");
}

/// Offline once the held template is due a refresh: the fetch is tried, fails,
/// and the stored template stands rather than nothing.
#[test]
fn a_failed_refresh_falls_back_to_the_stored_template() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    planet();
    let resolved = resolve_template_at("openfreemap", T0, |_url| Ok(PLANET_TILEJSON.to_string()));
    assert!(resolved.is_some());

    // A fresh process: the in-memory registry is empty and only the sidecar
    // the first resolve wrote is left.
    veloqrs::basemap::forget_resolved_templates();
    planet();

    let mut asks = 0;
    let offline = resolve_template_at("openfreemap", after_the_interval(), |_url| {
        asks += 1;
        Err("offline".to_string())
    });

    assert_eq!(asks, 1, "a template past its interval was not refreshed");
    assert_eq!(
        offline, resolved,
        "a refresh that could not reach the host dropped the template it had"
    );
}

/// A refresh that fails is not tried again on the very next tile, which offline
/// is every tile the map asks for.
#[test]
fn a_failed_refresh_is_not_retried_on_every_tile() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    planet();
    resolve_template_at("openfreemap", T0, |_url| Ok(PLANET_TILEJSON.to_string()));

    let mut asks = 0;
    for tile in 0..20 {
        resolve_template_at("openfreemap", after_the_interval() + tile, |_url| {
            asks += 1;
            Err("offline".to_string())
        });
    }

    assert_eq!(asks, 1);
}

/// The weekly run moves the dated segment. A resolve past the interval takes
/// the newer template and keeps it for the next cold start.
#[test]
fn a_refresh_after_the_interval_replaces_the_template_and_the_sidecar() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    planet();
    resolve_template_at("openfreemap", T0, |_url| Ok(PLANET_TILEJSON.to_string()));

    let within = resolve_template_at("openfreemap", T0 + 60, |_url| {
        Ok(NEXT_PLANET_TILEJSON.to_string())
    });
    assert_eq!(
        within.as_deref(),
        Some(SEPTEMBER),
        "refreshed inside its interval"
    );

    let refreshed = resolve_template_at("openfreemap", after_the_interval(), |_url| {
        Ok(NEXT_PLANET_TILEJSON.to_string())
    });
    assert_eq!(refreshed.as_deref(), Some(OCTOBER));

    veloqrs::basemap::forget_resolved_templates();
    planet();
    assert_eq!(
        tile_template_for("openfreemap").as_deref(),
        Some(OCTOBER),
        "the sidecar still names the old segment"
    );
    let sidecar = std::fs::read_to_string(dir.path().join("tile-templates.json")).unwrap();
    assert!(
        !sidecar.contains("20260906"),
        "the old segment is still on disk: {sidecar}"
    );
}

/// Tiles from the old run are not served beside the new run's under one key.
/// A refresh that finds the same segment keeps them.
#[test]
fn a_refresh_to_a_new_segment_stops_old_tiles_being_served() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    planet();
    resolve_template_at("openfreemap", T0, |_url| Ok(PLANET_TILEJSON.to_string()));
    let store = veloqrs::basemap::store().expect("store");
    store
        .put("openfreemap", 12, 2148, 1436, "pbf", &[1; 64], false)
        .expect("put");
    store
        .put("openfreemap", 2, 1, 1, "pbf", &[2; 64], true)
        .expect("put");

    resolve_template_at("openfreemap", after_the_interval(), |_url| {
        Ok(PLANET_TILEJSON.to_string())
    });
    assert!(
        store.get("openfreemap", 12, 2148, 1436).is_some(),
        "a refresh to the same segment dropped tiles that are still current"
    );
    assert_eq!(
        store.pin("openfreemap", 2, 1, 1),
        Some(64),
        "a refresh to the same segment unpinned a current tile"
    );

    resolve_template_at("openfreemap", 2 * after_the_interval(), |_url| {
        Ok(NEXT_PLANET_TILEJSON.to_string())
    });
    assert_eq!(
        store.get("openfreemap", 12, 2148, 1436),
        None,
        "a September tile is still served under the October template"
    );
    assert!(
        store.get("openfreemap", 2, 1, 1).is_some(),
        "a pinned tile stopped being served before its replacement arrived"
    );
    assert_eq!(
        store.pin("openfreemap", 2, 1, 1),
        None,
        "a pinned September tile is still pinned under the October template"
    );
}

/// A sidecar written before fetch times were recorded holds a bare template.
/// It still serves offline, and it is refreshed at the first chance.
#[test]
fn a_template_kept_without_a_fetch_time_serves_and_is_refreshed() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    std::fs::write(
        dir.path().join("tile-templates.json"),
        format!(r#"{{"openfreemap":"{SEPTEMBER}"}}"#),
    )
    .unwrap();
    planet();

    let offline = resolve_template_at("openfreemap", T0, |_url| Err("offline".to_string()));
    assert_eq!(offline.as_deref(), Some(SEPTEMBER));

    veloqrs::basemap::forget_resolved_templates();
    planet();
    let mut asks = 0;
    let online = resolve_template_at("openfreemap", T0, |_url| {
        asks += 1;
        Ok(NEXT_PLANET_TILEJSON.to_string())
    });
    assert_eq!(asks, 1);
    assert_eq!(online.as_deref(), Some(OCTOBER));
}

/// A source whose template already names a tile path is not a TileJSON, and
/// asking its host for one would be a request per tile that answers nothing.
#[test]
fn a_tile_template_is_not_treated_as_a_tilejson() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    let template = "https://example.test/sat/{z}/{x}/{y}.jpg";
    set_template("satellite".to_string(), template.to_string());

    let mut asks = 0;
    let resolved = resolve_template_with("satellite", |_url| {
        asks += 1;
        Ok(PLANET_TILEJSON.to_string())
    });

    assert_eq!(resolved.as_deref(), Some(template));
    assert_eq!(asks, 0, "a tile template was sent to a TileJSON resolve");
}

/// Which of the two a registered template is, decided on its own shape rather
/// than on the source's name: a second vector host is the case that was
/// left uncached when one literal url was matched.
#[test]
fn the_shape_of_the_template_says_which_it_is() {
    assert_eq!(
        TemplateSource::of("https://tiles.openfreemap.org/planet"),
        TemplateSource::TileJson
    );
    assert_eq!(
        TemplateSource::of("https://other.test/vector/planet"),
        TemplateSource::TileJson,
        "a second vector host resolves the same way, by shape and not by name"
    );
    assert_eq!(
        TemplateSource::of("https://example.test/sat/{z}/{x}/{y}.jpg"),
        TemplateSource::Tiles
    );
}

/// What a tile fill reads. Unresolved and with no way to ask, it answers
/// nothing rather than the TileJSON url, which would fetch a document per tile.
#[test]
fn an_unresolved_tilejson_source_has_no_tile_template() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    veloqrs::basemap::forget_resolved_templates();
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );

    assert_eq!(tile_template_for("openfreemap"), None);
    assert_eq!(
        template_for("openfreemap").as_deref(),
        Some("https://tiles.openfreemap.org/planet"),
        "the registry still holds what the page handed over"
    );
}

/// A tile fetched under the old segment, finishing after a refresh moved the
/// source to a new one and dropped the old run's tiles, is not kept.
#[test]
fn a_tile_fetched_under_the_old_segment_is_not_kept_after_the_refresh() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    planet();
    resolve_template_at("openfreemap", T0, |_url| Ok(PLANET_TILEJSON.to_string()));
    let store = veloqrs::basemap::store().expect("store");
    let old = tile_template_for("openfreemap").expect("old template");

    resolve_template_at("openfreemap", after_the_interval(), |_url| {
        Ok(NEXT_PLANET_TILEJSON.to_string())
    });

    veloqrs::basemap::store_fetched(&store, "openfreemap", &old, 12, 2148, 1436, "pbf", &[1; 64])
        .expect("store");
    assert_eq!(
        store.get("openfreemap", 12, 2148, 1436),
        None,
        "a September tile was kept under the October template"
    );

    let current = tile_template_for("openfreemap").expect("new template");
    veloqrs::basemap::store_fetched(
        &store,
        "openfreemap",
        &current,
        12,
        2148,
        1437,
        "pbf",
        &[2; 64],
    )
    .expect("store");
    assert!(store.get("openfreemap", 12, 2148, 1437).is_some());
}
