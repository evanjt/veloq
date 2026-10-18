//! Scenario: the elevation backfill's batch, driven over a source that records
//! what it was asked, once for each of its three asks.
//!
//! Expected behaviour: each track costs one call, naming the activity by its
//! id upstream, or by its key when none is stored, on the sweep lane, and the
//! answer stays filed under the local key.

use super::*;
use crate::net::recording_source::{RecordingSource, asked};
use std::collections::HashMap;

fn upstream() -> HashMap<String, String> {
    HashMap::from([("k1".to_string(), "u1".to_string())])
}

#[test]
fn each_ask_is_one_call_by_the_upstream_id_on_the_sweep_lane() {
    for (ask, expected) in [
        (Ask::Elevation, asked("altitude", &["u1"], Lane::Backfill)),
        (
            Ask::Track,
            asked("streams", &["u1", TRACK_STREAM_TYPES], Lane::Backfill),
        ),
        (
            Ask::Wide,
            asked(
                "stream_series",
                &["u1", DEFAULT_STREAM_TYPES],
                Lane::Backfill,
            ),
        ),
    ] {
        let source = RecordingSource::new();

        let fetched =
            crate::runtime::block_on(fetch_batch(&source, &["k1".to_string()], ask, &upstream()));

        assert_eq!(source.calls(), vec![expected], "{ask:?}");
        let keys: Vec<&str> = fetched.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(keys, vec!["k1"], "{ask:?}");
    }
}

#[test]
fn a_key_with_no_stored_upstream_id_is_asked_by_its_key() {
    let source = RecordingSource::new();

    crate::runtime::block_on(fetch_batch(
        &source,
        &["k2".to_string()],
        Ask::Elevation,
        &upstream(),
    ));

    assert_eq!(
        source.calls(),
        vec![asked("altitude", &["k2"], Lane::Backfill)]
    );
}
