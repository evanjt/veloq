use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::params;

use super::super::codec;
use super::tests::engine_with_null_laps;

struct StreamReads {
    times: Arc<AtomicUsize>,
    series_data: Arc<AtomicUsize>,
}

fn count_stream_reads(engine: &super::PersistentEngine) -> StreamReads {
    engine.db.flush_prepared_statement_cache();
    let reads = StreamReads {
        times: Arc::new(AtomicUsize::new(0)),
        series_data: Arc::new(AtomicUsize::new(0)),
    };
    let times = Arc::clone(&reads.times);
    let series_data = Arc::clone(&reads.series_data);
    engine.db.authorizer(Some(move |context: AuthContext<'_>| {
        if let AuthAction::Read {
            table_name,
            column_name,
            ..
        } = context.action
        {
            if table_name == "time_streams" && column_name == "times" {
                times.fetch_add(1, Ordering::Relaxed);
            }
            if table_name == "activity_streams" && column_name == "data" {
                series_data.fetch_add(1, Ordering::Relaxed);
            }
        }
        Authorization::Allow
    }));
    reads
}

fn stop_counting(engine: &super::PersistentEngine) {
    engine
        .db
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
}

#[test]
fn test_backfill_strapless_second_pass_skips_time_stream() {
    let engine = engine_with_null_laps(3);
    assert_eq!(engine.backfill_null_lap_times().unwrap(), 3);

    let reads = count_stream_reads(&engine);

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 0);
    stop_counting(&engine);
    assert_eq!(reads.times.load(Ordering::Relaxed), 0);
    assert_eq!(reads.series_data.load(Ordering::Relaxed), 0);
}

#[test]
fn test_backfill_late_heart_rate_skips_filled_time_stream() {
    let engine = engine_with_null_laps(2);
    assert_eq!(engine.backfill_null_lap_times().unwrap(), 2);
    let values = vec![Some(150.0); 8];
    let blob = codec::encode_series(&values, codec::series_scale("heartrate"));
    engine
        .db
        .execute(
            "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
             VALUES ('a1', 'heartrate', ?, 8)",
            params![blob],
        )
        .unwrap();
    let reads = count_stream_reads(&engine);

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 2);
    stop_counting(&engine);
    assert_eq!(reads.times.load(Ordering::Relaxed), 0);
    assert!(reads.series_data.load(Ordering::Relaxed) >= 1);
    let avg_hr: f64 = engine
        .db
        .query_row(
            "SELECT avg_hr FROM section_activities WHERE section_id = 's0'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(avg_hr, 150.0);
}

fn store_series(engine: &super::PersistentEngine, kind: &str, values: Vec<Option<f64>>) {
    engine
        .store_activity_streams(
            "a1",
            &[crate::net::types::StreamDto {
                kind: kind.to_string(),
                data: values,
                data2: None,
            }],
        )
        .unwrap();
}

fn dropout_series(tail: f64) -> Vec<Option<f64>> {
    vec![
        Some(150.0),
        None,
        None,
        None,
        None,
        Some(tail),
        Some(tail),
        Some(tail),
    ]
}

#[test]
fn test_backfill_dropout_lap_is_not_decoded_again() {
    let engine = engine_with_null_laps(1);
    store_series(&engine, "heartrate", dropout_series(150.0));
    engine.backfill_null_lap_times().unwrap();
    engine.backfill_null_lap_times().unwrap();
    let reads = count_stream_reads(&engine);

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 0);
    stop_counting(&engine);
    assert_eq!(reads.series_data.load(Ordering::Relaxed), 0);
}

#[test]
fn test_backfill_dropout_lap_is_filled_when_the_series_is_replaced() {
    let engine = engine_with_null_laps(1);
    store_series(&engine, "heartrate", dropout_series(150.0));
    engine.backfill_null_lap_times().unwrap();
    engine.backfill_null_lap_times().unwrap();

    store_series(&engine, "heartrate", vec![Some(140.0); 8]);

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 1);
    let avg_hr: f64 = engine
        .db
        .query_row(
            "SELECT avg_hr FROM section_activities WHERE section_id = 's0'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(avg_hr, 140.0);
}

#[test]
fn test_backfill_power_dropout_lap_is_not_decoded_again() {
    let engine = engine_with_null_laps(1);
    store_series(&engine, "watts", dropout_series(200.0));
    engine.backfill_null_lap_times().unwrap();
    engine.backfill_null_lap_times().unwrap();
    let reads = count_stream_reads(&engine);

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 0);
    stop_counting(&engine);
    assert_eq!(reads.series_data.load(Ordering::Relaxed), 0);
}

#[test]
fn test_backfill_untimeable_lap_does_not_reread_time_stream() {
    let engine = engine_with_null_laps(2);
    engine
        .store_time_stream("a1", &[0, 10, 20, 30, 40])
        .unwrap();
    engine.backfill_null_lap_times().unwrap();

    let reads = count_stream_reads(&engine);

    engine.backfill_null_lap_times().unwrap();
    engine.backfill_null_lap_times().unwrap();
    stop_counting(&engine);
    assert_eq!(reads.times.load(Ordering::Relaxed), 0);
}

#[test]
fn test_backfill_untimeable_lap_is_retried_when_a_new_stream_lands() {
    let engine = engine_with_null_laps(1);
    engine
        .store_time_stream("a1", &[0, 10, 20, 30, 40])
        .unwrap();
    engine.backfill_null_lap_times().unwrap();

    engine
        .store_time_stream("a1", &[0, 10, 20, 30, 40, 50, 60, 70])
        .unwrap();

    assert_eq!(engine.backfill_null_lap_times().unwrap(), 1);
    let lap_time: f64 = engine
        .db
        .query_row("SELECT lap_time FROM section_activities", [], |r| r.get(0))
        .unwrap();
    assert_eq!(lap_time, 30.0);
}
