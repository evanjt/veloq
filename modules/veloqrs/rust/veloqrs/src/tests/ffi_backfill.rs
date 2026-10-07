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

/// Scenario: an athlete stops the pass and later opens Settings, where the row
/// shows how many activities are owed and no size.
///
/// Expected behaviour: the status read carries the queue's bytes beside its
/// count, priced from the same rows, none while a pass is fetching, and none
/// when the engine cannot answer.
#[test]
fn test_status_read_prices_the_owed_queue_at_rest() {
    use crate::net::stream_backfill::{
        STREAM_PHASE_FETCHING, STREAM_PHASE_IDLE, estimate_bytes, set_phase,
    };

    let _serial = serial_global_state();
    let _tmp = init_global_engine("stream_status_bytes.db");

    let empty = get_routes_status_data();
    assert_eq!(empty.stream_remaining, Some(0));
    assert_eq!(empty.stream_remaining_bytes, Some(0.0));

    crate::objects::error::with_engine(|e| {
        for (id, secs) in [("a", 600), ("b", 1800)] {
            e.db.execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?, 'Ride', 0, 0, 0, 0, strftime('%s', 'now') - 86400)",
                rusqlite::params![id],
            )
            .unwrap();
            e.db.execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES (?, X'00', 10)",
                rusqlite::params![id],
            )
            .unwrap();
            e.db.execute(
                "INSERT INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, sport_type)
                 VALUES (?, 'r', 0, 0, ?, ?, 0, 'Ride')",
                rusqlite::params![id, secs, secs],
            )
            .unwrap();
        }
    })
    .expect("seed");

    let rest = get_routes_status_data();
    assert_eq!(rest.stream_remaining, Some(2));
    assert_eq!(
        rest.stream_remaining_bytes,
        Some(estimate_bytes(2400) as f64)
    );

    set_phase(STREAM_PHASE_FETCHING);
    let fetching = get_routes_status_data();
    set_phase(STREAM_PHASE_IDLE);
    assert_eq!(fetching.stream_remaining, None);
    assert_eq!(fetching.stream_remaining_bytes, None);
}
