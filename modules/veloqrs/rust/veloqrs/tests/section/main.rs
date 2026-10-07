use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../migration_support/mod.rs"]
mod migration_support;

#[path = "../section_algorithm_change.rs"]
mod section_algorithm_change;

#[path = "../section_anchor_geometry.rs"]
mod section_anchor_geometry;

#[path = "../section_avg_hr.rs"]
mod section_avg_hr;

#[path = "../section_avg_power.rs"]
mod section_avg_power;

#[path = "../section_baseline_geometry.rs"]
mod section_baseline_geometry;

#[path = "../section_blob_authority.rs"]
mod section_blob_authority;

#[path = "../section_blob_internal_readers.rs"]
mod section_blob_internal_readers;

#[path = "../section_config_persistence.rs"]
mod section_config_persistence;

#[path = "../section_coverage_backfill.rs"]
mod section_coverage_backfill;

#[path = "../section_elevation.rs"]
mod section_elevation;

#[path = "../section_geometry_point_count.rs"]
mod section_geometry_point_count;

#[path = "../section_history_time.rs"]
mod section_history_time;

#[path = "../section_id_collision.rs"]
mod section_id_collision;

#[path = "../section_intent_keys.rs"]
mod section_intent_keys;

#[path = "../section_lift_intent.rs"]
mod section_lift_intent;

#[path = "../section_match_candidates.rs"]
mod section_match_candidates;

#[path = "../section_reference_range.rs"]
mod section_reference_range;

#[path = "../section_reference_reanchor.rs"]
mod section_reference_reanchor;

#[path = "../section_summary_sports.rs"]
mod section_summary_sports;

#[path = "../conditioning_single_flight.rs"]
mod conditioning_single_flight;

#[path = "../section_filter_one_call.rs"]
mod section_filter_one_call;

#[path = "../section_combined_filter_floor.rs"]
mod section_combined_filter_floor;
