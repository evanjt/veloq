use super::{
    get_elevation_backfill_remaining, get_routes_status_data, get_stream_backfill_remaining,
    start_stream_backfill,
};
use crate::objects::FfiStartOutcome;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

#[test]
fn test_backfill_counts_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("backfill_counts_under_writer.db");

    read_while_writer_holds(|| {
        let status = get_routes_status_data();
        assert_eq!(status.stream_remaining, Some(0));
        assert_eq!(status.elevation_remaining, Some(0));
        assert_eq!(get_stream_backfill_remaining().expect("stream count"), 0);
        assert_eq!(
            get_elevation_backfill_remaining().expect("elevation count"),
            0
        );
    });
}

/// A start asks whether the queue is owed before it claims a slot, and that
/// count is a read. On an empty library it answers `NotOwed` without waiting
/// for a write in flight. The elevation start's twin is beside `start_pass`,
/// since the export also arms a resume ladder that would outlive the test.
#[test]
fn test_stream_backfill_start_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("stream_start_under_writer.db");

    let outcome = read_while_writer_holds(start_stream_backfill);
    assert_eq!(outcome, FfiStartOutcome::NotOwed);
}
