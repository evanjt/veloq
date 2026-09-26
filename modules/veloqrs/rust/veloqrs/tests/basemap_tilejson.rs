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
//! Run: `cargo test --test basemap_tilejson -p veloqrs`

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use veloqrs::basemap::{
    TemplateSource, resolve_template_with, set_template, template_for, tile_template_for,
};

/// The live TileJSON, trimmed to the fields the resolve reads. Taken from
/// tiles.openfreemap.org/planet on 2026-09-14.
const PLANET_TILEJSON: &str = r#"{
  "tilejson": "3.0.0",
  "tiles": ["https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf"],
  "minzoom": 0,
  "maxzoom": 14
}"#;

/// The store path, the template registry and the resolved-template map are all
/// process-wide, so these run one at a time or each one reads what another left.
static SERIAL: Mutex<()> = Mutex::new(());

/// A store of this test's own, with no resolved template held over from the
/// last one.
fn store_at(dir: &TempDir) -> MutexGuard<'static, ()> {
    let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
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

/// Offline after a resolve: the stored template stands rather than nothing.
#[test]
fn a_failed_refresh_falls_back_to_the_stored_template() {
    let dir = TempDir::new().expect("tempdir");
    let _serial = store_at(&dir);
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );
    let resolved = resolve_template_with("openfreemap", |_url| Ok(PLANET_TILEJSON.to_string()));
    assert!(resolved.is_some());

    // A fresh process: the in-memory registry is empty and only the sidecar
    // the first resolve wrote is left.
    veloqrs::basemap::forget_resolved_templates();
    set_template(
        "openfreemap".to_string(),
        "https://tiles.openfreemap.org/planet".to_string(),
    );

    let offline = resolve_template_with("openfreemap", |_url| Err("offline".to_string()));

    assert_eq!(
        offline, resolved,
        "a refresh that could not reach the host dropped the template it had"
    );
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
/// than on the source's name: a second vector host is the case `B80` left
/// uncached by matching one literal url.
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
