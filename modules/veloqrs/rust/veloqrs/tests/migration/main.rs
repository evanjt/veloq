#[path = "../migration_support/mod.rs"]
mod migration_support;

use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../migration_activity_census_has_series.rs"]
mod migration_activity_census_has_series;

#[path = "../migration_catalogue_archive.rs"]
mod migration_catalogue_archive;

#[path = "../migration_checksums.rs"]
mod migration_checksums;

#[path = "../migration_from_released_v12.rs"]
mod migration_from_released_v12;

#[path = "../migration_route_numbers.rs"]
mod migration_route_numbers;

#[path = "../migration_representative_choice.rs"]
mod migration_representative_choice;

#[path = "../migration_section_line_blobs.rs"]
mod migration_section_line_blobs;

#[path = "../migration_section_numbers.rs"]
mod migration_section_numbers;

#[path = "../migration_hr_zone_backfill.rs"]
mod migration_hr_zone_backfill;

#[path = "../migration_geocoded_names.rs"]
mod migration_geocoded_names;

#[path = "../migration_geocoded_places.rs"]
mod migration_geocoded_places;

#[path = "../migration_job_runs.rs"]
mod migration_job_runs;

#[path = "../migration_route_list_counts.rs"]
mod migration_route_list_counts;

#[path = "../migration_metrics_caches.rs"]
mod migration_metrics_caches;

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

#[path = "../upgrade_timing.rs"]
mod upgrade_timing;
