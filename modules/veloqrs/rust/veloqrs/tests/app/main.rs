use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../migration_support/mod.rs"]
mod migration_support;

#[path = "../attempt_store.rs"]
mod attempt_store;

#[path = "../basemap_preseed.rs"]
mod basemap_preseed;

#[path = "../basemap_tile_store.rs"]
mod basemap_tile_store;

#[path = "../census_fetch_marks_survive.rs"]
mod census_fetch_marks_survive;

#[path = "../track_refusal.rs"]
mod track_refusal;

#[path = "../track_fetch_failures.rs"]
mod track_fetch_failures;

#[path = "../clone_preserves_lap_time.rs"]
mod clone_preserves_lap_time;

#[path = "../custom_section_provenance.rs"]
mod custom_section_provenance;

#[path = "../efficiency_trend_direction.rs"]
mod efficiency_trend_direction;

#[path = "../efficiency_trend_signal.rs"]
mod efficiency_trend_signal;

#[path = "../elevation_ingest.rs"]
mod elevation_ingest;

#[path = "../elevation_resume_ladder.rs"]
mod elevation_resume_ladder;

#[path = "../elevation_state.rs"]
mod elevation_state;

#[path = "../encounters.rs"]
mod encounters;

#[path = "../every_table_declares_an_owner.rs"]
mod every_table_declares_an_owner;

#[path = "../export_privacy_preview.rs"]
mod export_privacy_preview;

#[path = "../export_privacy_trim.rs"]
mod export_privacy_trim;

#[path = "../external_write_reload.rs"]
mod external_write_reload;

#[path = "../fit_strength_candidates.rs"]
mod fit_strength_candidates;

#[path = "../indicators.rs"]
mod indicators;

#[path = "../insights_summary_fanout.rs"]
mod insights_summary_fanout;

#[path = "../lap_time_backfill_scope.rs"]
mod lap_time_backfill_scope;

#[path = "../lazy_statics_are_std.rs"]
mod lazy_statics_are_std;

#[path = "../library_coverage.rs"]
mod library_coverage;

#[path = "../match_percentage_persistence.rs"]
mod match_percentage_persistence;

#[path = "../match_strictness_invalidates.rs"]
mod match_strictness_invalidates;

#[path = "../match_strictness_persistence.rs"]
mod match_strictness_persistence;

#[path = "../merge_sections.rs"]
mod merge_sections;

#[path = "../mint_avoids_pins_and_archive.rs"]
mod mint_avoids_pins_and_archive;

#[path = "../notification_templates.rs"]
mod notification_templates;

#[path = "../offline_estimate.rs"]
mod offline_estimate;

#[path = "../per_lap_exclude.rs"]
mod per_lap_exclude;

#[path = "../pinned_section_support_floor.rs"]
mod pinned_section_support_floor;

#[path = "../polyline_json_nullable.rs"]
mod polyline_json_nullable;

#[path = "../ranked_sections_complete_traversals.rs"]
mod ranked_sections_complete_traversals;

#[path = "../ranked_sections_one_read.rs"]
mod ranked_sections_one_read;

#[path = "../restore_summaries.rs"]
mod restore_summaries;

#[path = "../route_attempt_standing.rs"]
mod route_attempt_standing;

#[path = "../route_name_sport_prefix.rs"]
mod route_name_sport_prefix;

#[path = "../routes_screen_query.rs"]
mod routes_screen_query;

#[path = "../set_route_representative.rs"]
mod set_route_representative;

#[path = "../stale_pr_candidates.rs"]
mod stale_pr_candidates;

#[path = "../stream_alignment.rs"]
mod stream_alignment;

#[path = "../strength_fit_parser.rs"]
mod strength_fit_parser;

#[path = "../superseded_lookup_is_one_call.rs"]
mod superseded_lookup_is_one_call;

#[path = "../thread_names.rs"]
mod thread_names;

#[path = "../tied_row_ordering.rs"]
mod tied_row_ordering;

#[path = "../transport_pool_sharing.rs"]
mod transport_pool_sharing;

#[path = "../visit_count_invariant.rs"]
mod visit_count_invariant;

#[path = "../basemap_not_found.rs"]
mod basemap_not_found;

#[path = "../basemap_source_allowlist.rs"]
mod basemap_source_allowlist;

#[path = "../basemap_tilejson.rs"]
mod basemap_tilejson;

#[path = "../catalogue_provenance.rs"]
mod catalogue_provenance;

#[path = "../routes_status_data.rs"]
mod routes_status_data;

#[path = "../screen_bundles.rs"]
mod screen_bundles;
