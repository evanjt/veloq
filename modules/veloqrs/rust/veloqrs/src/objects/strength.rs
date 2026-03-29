//! StrengthManager: FFI object for strength training exercise data.
//!
//! Downloads FIT files from intervals.icu, parses exercise sets,
//! caches in SQLite, and returns structured data to TypeScript.

use super::error::{with_engine, VeloqError};
use crate::fit;
use crate::http::ActivityFetcher;
use crate::{FfiExerciseSet, FfiMuscleGroup, FfiMuscleVolume, FfiStrengthSummary};
use log::info;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct StrengthManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl StrengthManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Get cached exercise sets for an activity (from SQLite).
    /// Returns empty vec if not yet downloaded/parsed.
    fn get_exercise_sets(&self, activity_id: String) -> Result<Vec<FfiExerciseSet>, VeloqError> {
        with_engine(|e| {
            let sets = e.get_exercise_sets(&activity_id).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })?;
            Ok(sets_to_ffi(&activity_id, &sets))
        })?
    }

    /// Check if FIT file has been processed for this activity.
    fn is_fit_processed(&self, activity_id: String) -> Result<bool, VeloqError> {
        with_engine(|e| {
            e.is_fit_processed(&activity_id).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Download FIT file, parse exercise sets, store in SQLite, return results.
    /// The FIT binary is held in memory only — not persisted to disk.
    fn fetch_and_parse_exercise_sets(
        &self,
        auth_header: String,
        activity_id: String,
    ) -> Result<Vec<FfiExerciseSet>, VeloqError> {
        info!("[Strength] Fetching FIT file for {}", activity_id);

        // Download FIT file in a blocking tokio runtime
        let fit_data = {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| VeloqError::Database {
                    msg: format!("Failed to create runtime: {}", e),
                })?;

            let fetcher = ActivityFetcher::with_auth_header(auth_header)
                .map_err(|e| VeloqError::Database { msg: e })?;

            rt.block_on(fetcher.download_fit_file(&activity_id))
        };

        match fit_data {
            Ok(data) => {
                info!("[Strength] Downloaded {} bytes for {}", data.len(), activity_id);

                // Parse exercise sets
                let sets = fit::parse_fit_sets(&data);
                let has_sets = !sets.is_empty();

                info!("[Strength] Parsed {} sets for {}", sets.len(), activity_id);

                // Store in SQLite and mark as processed
                with_engine(|e| {
                    if has_sets {
                        e.store_exercise_sets(&activity_id, &sets)
                            .map_err(|e| VeloqError::Database {
                                msg: format!("{}", e),
                            })?;
                    }
                    e.mark_fit_processed(&activity_id, has_sets)
                        .map_err(|e| VeloqError::Database {
                            msg: format!("{}", e),
                        })?;
                    Ok(sets_to_ffi(&activity_id, &sets))
                })?
            }
            Err(e) => {
                info!("[Strength] FIT download failed for {}: {}", activity_id, e);

                // Mark as processed (no sets) so we don't retry on 404
                let _ = with_engine(|engine| {
                    let _ = engine.mark_fit_processed(&activity_id, false);
                });

                Ok(Vec::new())
            }
        }
    }

    /// Get activity IDs from the input list that have not been FIT-processed yet.
    fn get_unprocessed_strength_ids(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| {
            e.get_unprocessed_strength_ids(&activity_ids)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Batch download and parse FIT files for multiple activities.
    /// Returns the list of successfully processed activity IDs.
    fn batch_fetch_exercise_sets(
        &self,
        auth_header: String,
        activity_ids: Vec<String>,
    ) -> Result<Vec<String>, VeloqError> {
        if activity_ids.is_empty() {
            return Ok(Vec::new());
        }

        info!(
            "[Strength] Batch fetching FIT files for {} activities",
            activity_ids.len()
        );

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| VeloqError::Database {
                msg: format!("Failed to create runtime: {}", e),
            })?;

        let fetcher =
            ActivityFetcher::with_auth_header(auth_header).map_err(|e| VeloqError::Database {
                msg: e,
            })?;

        let mut processed = Vec::new();

        for activity_id in &activity_ids {
            let fit_result = rt.block_on(fetcher.download_fit_file(activity_id));

            match fit_result {
                Ok(data) => {
                    let sets = fit::parse_fit_sets(&data);
                    let has_sets = !sets.is_empty();

                    info!(
                        "[Strength] Parsed {} sets for {}",
                        sets.len(),
                        activity_id
                    );

                    let store_result = with_engine(|e| {
                        if has_sets {
                            e.store_exercise_sets(activity_id, &sets)
                                .map_err(|e| VeloqError::Database {
                                    msg: format!("{}", e),
                                })?;
                        }
                        e.mark_fit_processed(activity_id, has_sets)
                            .map_err(|e| VeloqError::Database {
                                msg: format!("{}", e),
                            })?;
                        Ok(())
                    })?;

                    if store_result.is_ok() {
                        processed.push(activity_id.clone());
                    }
                }
                Err(e) => {
                    info!(
                        "[Strength] FIT download failed for {}: {}",
                        activity_id, e
                    );
                    // Mark as processed so we don't retry on 404
                    let _ = with_engine(|e| {
                        let _ = e.mark_fit_processed(activity_id, false);
                    });
                }
            }
        }

        info!(
            "[Strength] Batch complete: {}/{} successful",
            processed.len(),
            activity_ids.len()
        );

        Ok(processed)
    }

    /// Get aggregated strength training volume for a date range.
    /// Uses weighted set counting: primary=1.0, secondary=0.5.
    fn get_strength_summary(
        &self,
        start_date: String,
        end_date: String,
    ) -> Result<FfiStrengthSummary, VeloqError> {
        with_engine(|e| {
            let sets = e
                .get_exercise_sets_in_range(&start_date, &end_date)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;

            // Count unique activities and total sets
            let mut activity_ids = std::collections::HashSet::new();
            let mut total_active_sets: u32 = 0;

            // Per-muscle aggregation
            struct MuscleAgg {
                primary_sets: u32,
                secondary_sets: u32,
                total_reps: u32,
                total_weight_kg: f64,
                exercise_names: std::collections::HashSet<String>,
            }
            let mut muscle_map: HashMap<String, MuscleAgg> = HashMap::new();

            for (activity_id, set) in &sets {
                activity_ids.insert(activity_id.clone());
                total_active_sets += 1;

                let display_name =
                    fit::exercise_display_name(set.exercise_category, set.exercise_name);
                let muscles = fit::exercise_muscle_groups(set.exercise_category);

                for muscle in &muscles {
                    let agg = muscle_map.entry(muscle.slug.clone()).or_insert(MuscleAgg {
                        primary_sets: 0,
                        secondary_sets: 0,
                        total_reps: 0,
                        total_weight_kg: 0.0,
                        exercise_names: std::collections::HashSet::new(),
                    });

                    agg.exercise_names.insert(display_name.clone());

                    if muscle.intensity == 2 {
                        // Primary
                        agg.primary_sets += 1;
                        agg.total_reps += set.repetitions.unwrap_or(0) as u32;
                        agg.total_weight_kg +=
                            set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;
                    } else {
                        // Secondary
                        agg.secondary_sets += 1;
                    }
                }
            }

            let mut muscle_volumes: Vec<FfiMuscleVolume> = muscle_map
                .into_iter()
                .map(|(slug, agg)| {
                    let weighted_sets =
                        agg.primary_sets as f64 + agg.secondary_sets as f64 * 0.5;
                    let mut names: Vec<String> = agg.exercise_names.into_iter().collect();
                    names.sort();
                    FfiMuscleVolume {
                        slug,
                        primary_sets: agg.primary_sets,
                        secondary_sets: agg.secondary_sets,
                        weighted_sets,
                        total_reps: agg.total_reps,
                        total_weight_kg: agg.total_weight_kg,
                        exercise_names: names,
                    }
                })
                .collect();

            // Sort by weighted sets descending
            muscle_volumes
                .sort_by(|a, b| b.weighted_sets.partial_cmp(&a.weighted_sets).unwrap());

            Ok(FfiStrengthSummary {
                muscle_volumes,
                activity_count: activity_ids.len() as u32,
                total_sets: total_active_sets,
            })
        })?
    }

    /// Check if there are any strength activities with exercise data.
    fn has_strength_data(&self) -> Result<bool, VeloqError> {
        with_engine(|e| {
            let count = e
                .get_strength_activity_count()
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(count > 0)
        })?
    }

    /// Get aggregated muscle groups for an activity.
    /// Returns slugs matching react-native-body-highlighter format.
    fn get_muscle_groups(&self, activity_id: String) -> Result<Vec<FfiMuscleGroup>, VeloqError> {
        with_engine(|e| {
            let sets = e.get_exercise_sets(&activity_id).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })?;

            let groups = fit::aggregate_muscle_groups(&sets);
            Ok(groups
                .into_iter()
                .map(|g| FfiMuscleGroup {
                    slug: g.slug,
                    intensity: g.intensity,
                })
                .collect())
        })?
    }
}

/// Convert internal FitExerciseSet to FFI-safe FfiExerciseSet with display names.
fn sets_to_ffi(activity_id: &str, sets: &[fit::FitExerciseSet]) -> Vec<FfiExerciseSet> {
    sets.iter()
        .map(|s| FfiExerciseSet {
            activity_id: activity_id.to_string(),
            set_order: s.set_order,
            exercise_category: s.exercise_category,
            exercise_name: s.exercise_name,
            display_name: fit::exercise_display_name(s.exercise_category, s.exercise_name),
            set_type: s.set_type,
            repetitions: s.repetitions,
            weight_kg: s.weight_kg,
            duration_secs: s.duration_secs,
        })
        .collect()
}
