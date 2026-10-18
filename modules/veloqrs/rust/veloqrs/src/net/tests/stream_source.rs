//! Scenario: the stream backfill's batch, driven over a source that records
//! what it was asked.
//!
//! Expected behaviour: each gap costs one call for the whole series set,
//! naming the activity by its id upstream, on the sweep lane.

use super::*;
use crate::net::recording_source::{RecordingSource, asked};
use crate::persistence::streams::StreamGap;
use std::collections::HashMap;

#[test]
fn each_gap_is_one_call_for_the_series_set_by_the_upstream_id() {
    let source = RecordingSource::new();
    let upstream = HashMap::from([("k1".to_string(), "u1".to_string())]);
    let batch = [StreamGap {
        activity_id: "k1".into(),
        point_count: Some(4),
    }];

    let fetched = crate::runtime::block_on(fetch_batch(&source, &batch, &upstream));

    assert_eq!(
        source.calls(),
        vec![asked(
            "streams_bytes",
            &["u1", DEFAULT_STREAM_TYPES],
            Lane::Backfill
        )]
    );
    let keys: Vec<&str> = fetched.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(keys, vec!["k1"]);
}
