//! Scenario: one track of the GPS download, driven over a source that records
//! what it was asked.
//!
//! Expected behaviour: a track costs one call, naming the activity by its id
//! upstream, asking the track's series or the whole set when widened, on the
//! lane the caller passed.

use super::*;
use crate::net::recording_source::{RecordingSource, asked};

#[test]
fn a_track_is_one_call_by_the_upstream_id_on_the_callers_lane() {
    for (wide, lane, types) in [
        (
            false,
            Lane::Backfill,
            crate::net::intervals::endpoints::TRACK_STREAM_TYPES,
        ),
        (
            true,
            Lane::Interactive,
            crate::net::intervals::endpoints::DEFAULT_STREAM_TYPES,
        ),
    ] {
        let source = RecordingSource::new();

        let result = crate::runtime::block_on(ActivityFetcher::fetch_single_track(
            &source, "k1", "u1", wide, lane,
        ));

        assert_eq!(
            source.calls(),
            vec![asked("streams_bytes", &["u1", types], lane)]
        );
        assert_eq!(result.activity_id, "k1");
    }
}
