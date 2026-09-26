//! Scenario: a regional orthophoto source is asked for a tile outside the
//! country it serves, so the host answers 404. The map pans, zooms and comes
//! back, and every one of those asks the host again.
//!
//! Expected behaviour: a 404 is remembered for that tile and for everything
//! under it. Panning back to a tile the host has already refused costs nothing,
//! and zooming into a refused tile costs nothing either, because no child of a
//! tile a source has not got can exist.

use httpmock::prelude::*;
use tempfile::TempDir;
use veloqrs::basemap::{get_or_fetch, set_path, set_template};

/// One test: the store path and the template table are process-wide, so two
/// would race each other's `set_path`.
#[test]
fn a_refused_tile_is_asked_for_once_and_its_children_never() {
    let host = MockServer::start();
    let refused = host.mock(|when, then| {
        when.method(GET)
            .path_matches(Regex::new(r"^/\d+/\d+/\d+\.png$").unwrap());
        then.status(404);
    });

    let tmp = TempDir::new().expect("tempdir");
    set_path(
        tmp.path()
            .join("basemap-tiles")
            .to_string_lossy()
            .into_owned(),
    );
    set_template("ign_test".to_string(), host.url("/{z}/{x}/{y}.png"));

    assert_eq!(get_or_fetch("ign_test", 10, 512, 340), None);
    refused.assert_hits(1);

    // The same tile again, which is a pan back to where the map just was.
    assert_eq!(get_or_fetch("ign_test", 10, 512, 340), None);
    refused.assert_hits(1);

    // A child of it, which is a zoom in.
    assert_eq!(get_or_fetch("ign_test", 12, 2048, 1360), None);
    refused.assert_hits(1);

    // A neighbour is not implied by it: nothing was learnt about that ground.
    assert_eq!(get_or_fetch("ign_test", 10, 513, 340), None);
    refused.assert_hits(2);

    // Nor is the parent, which covers ground the refusal said nothing about.
    assert_eq!(get_or_fetch("ign_test", 9, 256, 170), None);
    refused.assert_hits(3);
}
