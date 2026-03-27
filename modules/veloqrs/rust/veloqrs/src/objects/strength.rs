//! StrengthManager: FFI object for strength training exercise data.
//!
//! Downloads FIT files from intervals.icu, parses exercise sets,
//! caches in SQLite, and returns structured data to TypeScript.

use super::error::{with_engine, VeloqError};
use crate::fit;
use crate::http::ActivityFetcher;
use crate::{FfiExerciseSet, FfiMuscleGroup};
use log::info;
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
