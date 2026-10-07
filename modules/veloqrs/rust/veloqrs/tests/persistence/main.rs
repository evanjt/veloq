use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../migration_support/mod.rs"]
mod migration_support;

#[path = "../activity_census_coverage.rs"]
mod activity_census_coverage;

#[path = "../activity_distance_from_metrics.rs"]
mod activity_distance_from_metrics;

#[path = "../activity_intervals_id.rs"]
mod activity_intervals_id;

#[path = "../activity_metrics_heatmap.rs"]
mod activity_metrics_heatmap;

#[path = "../activity_range_coverage.rs"]
mod activity_range_coverage;

#[path = "../activity_window_coverage.rs"]
mod activity_window_coverage;

#[path = "../backup_off_the_lock.rs"]
mod backup_off_the_lock;

#[path = "../clear_wipes_every_table.rs"]
mod clear_wipes_every_table;

#[path = "../corrupt_pool.rs"]
mod corrupt_pool;

#[path = "../derived_data_clear.rs"]
mod derived_data_clear;

#[path = "../journal_mode.rs"]
mod journal_mode;

#[path = "../orphan_supersession_repair.rs"]
mod orphan_supersession_repair;

#[path = "../recording_athlete_stamp.rs"]
mod recording_athlete_stamp;

#[path = "../recording_kind_column.rs"]
mod recording_kind_column;

#[path = "../recording_upload_recovery.rs"]
mod recording_upload_recovery;

#[path = "../settings_batch_write.rs"]
mod settings_batch_write;

#[path = "../settings_write_skip.rs"]
mod settings_write_skip;

#[path = "../sync_activity_census.rs"]
mod sync_activity_census;

#[path = "../clear_runs_off_the_calling_thread.rs"]
mod clear_runs_off_the_calling_thread;

#[path = "../engine_init_failover.rs"]
mod engine_init_failover;

#[path = "../engine_init_outcome.rs"]
mod engine_init_outcome;

#[path = "../engine_poison_reload.rs"]
mod engine_poison_reload;

#[path = "../engine_write_off_async_workers.rs"]
mod engine_write_off_async_workers;

#[path = "../missing_time_streams_off_the_lock.rs"]
mod missing_time_streams_off_the_lock;

#[path = "../read_pool_does_not_wait_on_the_writer.rs"]
mod read_pool_does_not_wait_on_the_writer;

#[path = "../reference_activity_guard.rs"]
mod reference_activity_guard;
