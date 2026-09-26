//! Scenario: the Android WebView client passes any `/veloq-tile/` source name
//! straight through to `get_or_fetch`, which asked the store for the tile
//! before it consulted the template allowlist. The store admits every name but
//! the satellite one, joins it onto the tile root, reads an `index.json`, walks
//! the subdirectories and keeps a `SourceIndex` under that string, which
//! nothing removes.
//!
//! Expected behaviour: a source TypeScript never registered a template for is
//! refused before the store is touched at all.

use std::fs;

use tempfile::TempDir;
use veloqrs::basemap::{get_or_fetch, set_path, set_template};

const SECRET: &[u8] = b"not a tile";

/// One test, not two: the store path and the template table are process-wide,
/// so two tests would race each other's `set_path`.
#[test]
fn only_a_source_with_a_registered_template_reaches_the_store() {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join("basemap-tiles");
    fs::create_dir_all(&root).expect("root");

    // A tree beside the tile root, reachable only by climbing out of it.
    let outside = tmp.path().join("outside").join("3").join("2");
    fs::create_dir_all(&outside).expect("outside");
    fs::write(outside.join("1.png"), SECRET).expect("write");

    set_path(root.to_string_lossy().into_owned());

    assert_eq!(
        get_or_fetch("../outside", 3, 2, 1),
        None,
        "a name with no template must not read a file outside the tile root"
    );

    // And the gate is the template, not the path: a registered source still
    // reads its own tiles from inside the root.
    let tile_dir = root.join("ground").join("3").join("2");
    fs::create_dir_all(&tile_dir).expect("tile dir");
    fs::write(tile_dir.join("1.png"), SECRET).expect("write");
    set_template(
        "ground".to_string(),
        "https://tiles.example/{z}/{x}/{y}.png".to_string(),
    );

    assert_eq!(get_or_fetch("ground", 3, 2, 1).as_deref(), Some(SECRET));
}
