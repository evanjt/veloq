#[path = "../migration_support/mod.rs"]
mod migration_support;

use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../migration_activity_census_has_series.rs"]
mod migration_activity_census_has_series;

#[path = "../migration_carry.rs"]
mod migration_carry;

#[path = "../migration_catalogue_archive.rs"]
mod migration_catalogue_archive;

#[path = "../migration_checksums.rs"]
mod migration_checksums;

#[path = "../migration_from_released_v12.rs"]
mod migration_from_released_v12;

#[path = "../migration_route_numbers.rs"]
mod migration_route_numbers;

#[path = "../migration_pre_upgrade_copy.rs"]
mod migration_pre_upgrade_copy;

#[path = "../migration_representative_choice.rs"]
mod migration_representative_choice;

#[path = "../migration_section_line_blobs.rs"]
mod migration_section_line_blobs;

#[path = "../migration_section_numbers.rs"]
mod migration_section_numbers;

#[path = "../migration_hr_zone_backfill.rs"]
mod migration_hr_zone_backfill;

#[path = "../migration_drop_geocoding.rs"]
mod migration_drop_geocoding;

#[path = "../migration_job_runs.rs"]
mod migration_job_runs;

#[path = "../migration_route_list_counts.rs"]
mod migration_route_list_counts;

#[path = "../migration_metrics_caches.rs"]
mod migration_metrics_caches;

#[path = "../migration_pool_swims.rs"]
mod migration_pool_swims;

#[path = "../migration_activity_sync_failures.rs"]
mod migration_activity_sync_failures;

#[path = "../migration_activity_held_back.rs"]
mod migration_activity_held_back;

#[path = "../migration_garmin_link_unresolved.rs"]
mod migration_garmin_link_unresolved;

#[path = "../migration_push_runs_posted_entry.rs"]
mod migration_push_runs_posted_entry;

#[path = "../migration_upgrade.rs"]
mod migration_upgrade;

#[path = "../migration_v02x_to_current.rs"]
mod migration_v02x_to_current;

#[path = "../schema_golden.rs"]
mod schema_golden;

#[path = "../schema_overstated_version.rs"]
mod schema_overstated_version;

#[path = "../schema_version_divergence.rs"]
mod schema_version_divergence;

#[path = "../migration_open_off_thread.rs"]
mod migration_open_off_thread;

#[path = "../upgrade_scale.rs"]
mod upgrade_scale;

#[path = "../upgrade_timing.rs"]
mod upgrade_timing;
