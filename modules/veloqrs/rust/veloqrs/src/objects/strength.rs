//! StrengthManager: FFI object for strength training exercise data.
//!
//! Downloads FIT files from intervals.icu, parses exercise sets,
//! caches in SQLite, and returns structured data to TypeScript.

use super::error::{VeloqError, with_engine};
use super::sync;
use crate::fit;
use crate::http::ActivityFetcher;
use crate::net::transport::NetError;
use crate::persistence::FitOutcome;
use crate::{
    FfiExerciseActivities, FfiExerciseActivity, FfiExerciseContribution, FfiExerciseSet,
    FfiExerciseSummary, FfiMuscleExerciseSummary, FfiMuscleGroup, FfiMuscleGroupDetail,
    FfiMuscleVolume, FfiStrengthInsightSeries, FfiStrengthSummary, FfiTimestampRange,
};
use log::info;
use std::collections::HashMap;
use std::sync::Arc;

/// Parse a downloaded FIT file, store whatever sets it holds, and settle the
/// activity. Both fetch paths share it so one download can only ever produce one
/// verdict, written the same way.
fn store_parsed_sets(activity_id: &str, data: &[u8]) {
    let sets = fit::parse_fit_sets(data);
    let outcome = if sets.is_empty() {
        FitOutcome::Empty
    } else {
        FitOutcome::Parsed
    };
    info!(
        "[Strength] Parsed {} sets for {} ({} bytes)",
        sets.len(),
        activity_id,
        data.len()
    );

    let stored = with_engine(|e| -> Result<(), VeloqError> {
        if !sets.is_empty() {
            e.store_exercise_sets(activity_id, &sets)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;
        }
        e.mark_fit_outcome(activity_id, outcome)
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })?;
        Ok(())
    });
    if let Err(e) = stored {
        log::error!("[Strength] Failed to store sets for {}: {}", activity_id, e);
    }
}

/// Decide what a failed download means for the activity.
///
/// Only a 404 or 410 settles it: upstream holds no FIT file and a later attempt
/// would fetch the same nothing. Every other failure is the network, the token
/// or the server, so nothing is recorded and the activity stays in
/// `get_unprocessed_strength_ids` for the next attempt. Marking those settled is
/// what deleted a user's strength data for good.
fn settle_failed_download(activity_id: &str, error: NetError) -> Result<(), NetError> {
    if !fit_is_absent_upstream(&error) {
        log::warn!(
            "[Strength] FIT download failed for {}, will retry: {}",
            activity_id,
            error
        );
        return Err(error);
    }

    info!(
        "[Strength] No FIT file upstream for {} ({}), settling",
        activity_id, error
    );
    if let Err(e) = with_engine(|engine| {
        engine
            .mark_fit_outcome(activity_id, FitOutcome::Absent)
            .map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
    }) {
        log::error!("[Strength] Failed to settle {}: {}", activity_id, e);
    }
    Ok(())
}

/// Whether the failure means the activity has no FIT file to fetch, ever.
fn fit_is_absent_upstream(error: &NetError) -> bool {
    matches!(error, NetError::Http { status, .. } if *status == 404 || *status == 410)
}

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
            let sets = e
                .get_exercise_sets(&activity_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(sets_to_ffi(&activity_id, &sets))
        })?
    }

    /// Check if FIT file has been processed for this activity.
    fn is_fit_processed(&self, activity_id: String) -> Result<bool, VeloqError> {
        with_engine(|e| {
            e.is_fit_processed(&activity_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Start a FIT download for one activity, parse its exercise sets and store
    /// them. Returns false when a download for this activity is already in
    /// flight or there are no credentials.
    ///
    /// Nothing is returned to the caller: the download ran on the JS thread
    /// before, so a black-hole network froze the UI for as long as the request
    /// took. The sets land in SQLite and are read back through
    /// `get_exercise_sets`, the same path a cache hit takes.
    fn fetch_and_parse_exercise_sets(&self, activity_id: String) -> bool {
        info!("[Strength] Fetching FIT file for {}", activity_id);
        sync::spawn_once(
            format!("fit:{}", activity_id),
            move |transport, _athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let data = match fetcher.download_fit_file(&activity_id).await {
                    Ok(data) => data,
                    Err(e) => return settle_failed_download(&activity_id, e),
                };
                store_parsed_sets(&activity_id, &data);
                Ok(())
            },
        )
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

    /// Start FIT downloads for a batch of activities. Returns false when a batch
    /// is already in flight or there are no credentials.
    ///
    /// Runs in the background for the same reason the single fetch does: the
    /// caller is the sync path on the JS thread, and this loop is one blocking
    /// request per activity.
    fn batch_fetch_exercise_sets(&self, activity_ids: Vec<String>) -> bool {
        if activity_ids.is_empty() {
            return false;
        }

        info!(
            "[Strength] Batch fetching FIT files for {} activities",
            activity_ids.len()
        );

        sync::spawn_once(
            "fit:batch".to_string(),
            move |transport, _athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let total = activity_ids.len();
                let mut parsed = 0usize;

                for activity_id in &activity_ids {
                    match fetcher.download_fit_file(activity_id).await {
                        Ok(data) => {
                            store_parsed_sets(activity_id, &data);
                            parsed += 1;
                        }
                        Err(NetError::Unauthorized) => {
                            // The whole batch shares one credential, so the rest
                            // would fail the same way. Surface it once and stop
                            // rather than log the same 401 per activity.
                            return Err(NetError::Unauthorized);
                        }
                        Err(e) => {
                            let _ = settle_failed_download(activity_id, e);
                        }
                    }
                }

                info!("[Strength] Batch complete: {}/{} downloaded", parsed, total);
                Ok(())
            },
        )
    }

    /// Get aggregated strength training volume for a date range.
    /// Uses weighted set counting: primary=1.0, secondary=0.5.
    /// Timestamps are Unix seconds.
    fn get_strength_summary(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<FfiStrengthSummary, VeloqError> {
        with_engine(|e| {
            let sets = e
                .get_exercise_sets_in_range(start_ts, end_ts)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(aggregate_strength_sets(&sets))
        })?
    }

    /// Batch variant of `get_strength_summary`. Aggregates each range under a
    /// single engine lock, so the insights hook can request a monthly window
    /// plus N trailing weekly windows in one FFI round-trip.
    fn get_strength_summary_batch(
        &self,
        ranges: Vec<FfiTimestampRange>,
    ) -> Result<Vec<FfiStrengthSummary>, VeloqError> {
        with_engine(|e| {
            ranges
                .into_iter()
                .map(|range| {
                    e.get_exercise_sets_in_range(range.start_ts, range.end_ts)
                        .map(|sets| aggregate_strength_sets(&sets))
                        .map_err(|err| VeloqError::Database {
                            msg: format!("{}", err),
                        })
                })
                .collect()
        })?
    }

    /// Bundled strength payload for insights: one monthly summary + N weekly
    /// summaries, computed in a single lock. Superseded by the insights
    /// bundle, which builds the same series through
    /// `PersistentRouteEngine::strength_insight_series` without crossing FFI.
    fn get_strength_insight_series(
        &self,
        monthly: FfiTimestampRange,
        weekly: Vec<FfiTimestampRange>,
    ) -> Result<FfiStrengthInsightSeries, VeloqError> {
        with_engine(|e| {
            let monthly_sets = e
                .get_exercise_sets_in_range(monthly.start_ts, monthly.end_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;
            let monthly_summary = aggregate_strength_sets(&monthly_sets);

            let weekly_summaries: Result<Vec<_>, VeloqError> = weekly
                .into_iter()
                .map(|range| {
                    e.get_exercise_sets_in_range(range.start_ts, range.end_ts)
                        .map(|sets| aggregate_strength_sets(&sets))
                        .map_err(|err| VeloqError::Database {
                            msg: format!("{}", err),
                        })
                })
                .collect();

            Ok(FfiStrengthInsightSeries {
                monthly: monthly_summary,
                weekly: weekly_summaries?,
            })
        })?
    }

    /// Get exercise summaries for a specific muscle group within a date range.
    /// Returns exercises grouped by frequency, sorted by activity count descending.
    fn get_exercises_for_muscle(
        &self,
        start_ts: i64,
        end_ts: i64,
        muscle_slug: String,
    ) -> Result<FfiMuscleExerciseSummary, VeloqError> {
        with_engine(|e| {
            let sets = e
                .get_exercise_sets_in_range(start_ts, end_ts)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;

            let period_days = ((end_ts - start_ts) / 86400).max(1) as u32;

            // Per-exercise aggregation
            struct ExAgg {
                total_sets: u32,
                total_weight_kg: f64,
                activity_ids: std::collections::HashSet<String>,
                has_primary: bool,
            }
            let mut exercise_map: std::collections::HashMap<u16, ExAgg> =
                std::collections::HashMap::new();

            for (_activity_id, set) in &sets {
                let muscles = fit::exercise_muscle_groups(set.exercise_category);
                let muscle_match = muscles.iter().find(|m| m.slug == muscle_slug);
                if muscle_match.is_none() {
                    continue;
                }

                let is_primary = muscle_match.unwrap().intensity == 2;
                let agg = exercise_map.entry(set.exercise_category).or_insert(ExAgg {
                    total_sets: 0,
                    total_weight_kg: 0.0,
                    activity_ids: std::collections::HashSet::new(),
                    has_primary: false,
                });

                agg.total_sets += 1;
                agg.total_weight_kg +=
                    set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;
                agg.activity_ids.insert(_activity_id.clone());
                if is_primary {
                    agg.has_primary = true;
                }
            }

            let mut exercises: Vec<FfiExerciseSummary> = exercise_map
                .into_iter()
                .map(|(category, agg)| {
                    let activity_count = agg.activity_ids.len() as u32;
                    let frequency_days = if activity_count > 0 {
                        period_days as f64 / activity_count as f64
                    } else {
                        0.0
                    };
                    FfiExerciseSummary {
                        exercise_name: fit::exercise_display_name(category, None),
                        exercise_category: category,
                        frequency_days,
                        total_sets: agg.total_sets,
                        total_weight_kg: agg.total_weight_kg,
                        activity_count,
                        is_primary: agg.has_primary,
                    }
                })
                .collect();

            // Sort by activity count descending, then by total sets
            exercises.sort_by(|a, b| {
                b.activity_count
                    .cmp(&a.activity_count)
                    .then_with(|| b.total_sets.cmp(&a.total_sets))
            });

            Ok(FfiMuscleExerciseSummary {
                exercises,
                period_days,
            })
        })?
    }

    /// Get activities for a specific exercise filtered by muscle group.
    /// Returns activities sorted by date descending with per-activity stats.
    fn get_activities_for_exercise(
        &self,
        start_ts: i64,
        end_ts: i64,
        muscle_slug: String,
        exercise_category: u16,
    ) -> Result<FfiExerciseActivities, VeloqError> {
        with_engine(|e| {
            let sets = e
                .get_exercise_sets_in_range(start_ts, end_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;

            // Per-activity aggregation, filtered by muscle + exercise
            struct ActAgg {
                total_sets: u32,
                total_weight_kg: f64,
                has_primary: bool,
            }
            let mut activity_map: std::collections::HashMap<String, ActAgg> =
                std::collections::HashMap::new();

            for (activity_id, set) in &sets {
                if set.exercise_category != exercise_category {
                    continue;
                }

                let muscles = fit::exercise_muscle_groups(set.exercise_category);
                let muscle_match = muscles.iter().find(|m| m.slug == muscle_slug);
                if muscle_match.is_none() {
                    continue;
                }

                let is_primary = muscle_match.unwrap().intensity == 2;
                let agg = activity_map.entry(activity_id.clone()).or_insert(ActAgg {
                    total_sets: 0,
                    total_weight_kg: 0.0,
                    has_primary: false,
                });

                agg.total_sets += 1;
                agg.total_weight_kg +=
                    set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;
                if is_primary {
                    agg.has_primary = true;
                }
            }

            // Fetch activity names
            let activity_ids: Vec<String> = activity_map.keys().cloned().collect();
            let names =
                e.get_activity_names(&activity_ids)
                    .map_err(|err| VeloqError::Database {
                        msg: format!("{}", err),
                    })?;

            let mut activities: Vec<FfiExerciseActivity> = activity_map
                .into_iter()
                .filter_map(|(id, agg)| {
                    let (name, date) = names.get(&id)?;
                    Some(FfiExerciseActivity {
                        activity_id: id,
                        activity_name: name.clone(),
                        date: *date,
                        sets: agg.total_sets,
                        total_weight_kg: agg.total_weight_kg,
                        is_primary: agg.has_primary,
                    })
                })
                .collect();

            // Sort by date descending
            activities.sort_by(|a, b| b.date.cmp(&a.date));

            Ok(FfiExerciseActivities { activities })
        })?
    }

    /// Parse raw FIT bytes locally and store any strength sets for this
    /// activity. Returns the number of sets inserted. No network access -
    /// callers supply the bytes (e.g. just-recorded FIT buffer, downloaded
    /// file, backup). Also marks the activity as FIT-processed so the
    /// network path won't attempt to re-download.
    fn import_sets_from_fit(
        &self,
        activity_id: String,
        fit_bytes: Vec<u8>,
    ) -> Result<u32, VeloqError> {
        let sets =
            fit::parse_fit_strength_sets(&fit_bytes).map_err(|e| VeloqError::ParseError {
                msg: format!("{}", e),
            })?;
        let count = sets.len() as u32;
        let has_sets = !sets.is_empty();
        let outcome = if has_sets {
            FitOutcome::Parsed
        } else {
            FitOutcome::Empty
        };

        info!(
            "[Strength] Imported {} sets from FIT bytes for {}",
            count, activity_id
        );

        with_engine(|e| -> Result<(), VeloqError> {
            if has_sets {
                e.store_exercise_sets(&activity_id, &sets)
                    .map_err(|err| VeloqError::Database {
                        msg: format!("{}", err),
                    })?;
            }
            e.mark_fit_outcome(&activity_id, outcome)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;
            Ok(())
        })??;

        Ok(count)
    }

    /// Insert pre-parsed exercise sets for an activity without touching the
    /// network or FIT-file pipeline. Demo mode uses this to seed synthetic
    /// WeightTraining activities; the production path still goes through
    /// fetch_and_parse_exercise_sets. Also marks the activity as FIT-processed
    /// so the normal code path won't attempt to re-download.
    fn bulk_insert_exercise_sets(
        &self,
        activity_id: String,
        sets: Vec<FfiExerciseSet>,
    ) -> Result<(), VeloqError> {
        let internal: Vec<fit::FitExerciseSet> = sets
            .iter()
            .map(|s| fit::FitExerciseSet {
                set_order: s.set_order,
                exercise_category: s.exercise_category,
                exercise_name: s.exercise_name,
                set_type: s.set_type,
                repetitions: s.repetitions,
                weight_kg: s.weight_kg,
                duration_secs: s.duration_secs,
                start_time: None,
            })
            .collect();
        let has_sets = !internal.is_empty();
        let outcome = if has_sets {
            FitOutcome::Parsed
        } else {
            FitOutcome::Empty
        };
        with_engine(|e| -> Result<(), VeloqError> {
            if has_sets {
                e.store_exercise_sets(&activity_id, &internal)
                    .map_err(|err| VeloqError::Database {
                        msg: format!("{}", err),
                    })?;
            }
            e.mark_fit_outcome(&activity_id, outcome)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;
            Ok(())
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
            let sets = e
                .get_exercise_sets(&activity_id)
                .map_err(|e| VeloqError::Database {
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

    /// Per-activity muscle detail: groups exercise sets by display name,
    /// classifies primary/secondary role, returns totals + sorted exercise
    /// list. Replaces the group-by/reduce loop in `useMuscleDetail.ts`.
    fn get_muscle_detail(
        &self,
        activity_id: String,
        muscle_slug: String,
    ) -> Result<FfiMuscleGroupDetail, VeloqError> {
        with_engine(|e| {
            let sets = e
                .get_exercise_sets(&activity_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(aggregate_muscle_detail(&muscle_slug, &sets))
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

/// Aggregate a slice of (activity_id, exercise_set) into a strength summary.
/// Extracted from `get_strength_summary` so batch callers can reuse the loop
/// without paying N engine locks.
pub(crate) fn aggregate_strength_sets(
    sets: &[(String, fit::FitExerciseSet)],
) -> FfiStrengthSummary {
    struct MuscleAgg {
        primary_sets: u32,
        secondary_sets: u32,
        total_reps: u32,
        total_weight_kg: f64,
        exercise_names: std::collections::HashSet<String>,
    }

    let mut activity_ids = std::collections::HashSet::new();
    let mut total_active_sets: u32 = 0;
    let mut muscle_map: HashMap<String, MuscleAgg> = HashMap::new();

    for (activity_id, set) in sets {
        activity_ids.insert(activity_id.clone());
        total_active_sets += 1;

        let display_name = fit::exercise_display_name(set.exercise_category, set.exercise_name);
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
                agg.primary_sets += 1;
                agg.total_reps += set.repetitions.unwrap_or(0) as u32;
                agg.total_weight_kg +=
                    set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;
            } else {
                agg.secondary_sets += 1;
            }
        }
    }

    let mut muscle_volumes: Vec<FfiMuscleVolume> = muscle_map
        .into_iter()
        .map(|(slug, agg)| {
            let weighted_sets = agg.primary_sets as f64 + agg.secondary_sets as f64 * 0.5;
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

    muscle_volumes.sort_by(|a, b| {
        b.weighted_sets
            .partial_cmp(&a.weighted_sets)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    FfiStrengthSummary {
        muscle_volumes,
        activity_count: activity_ids.len() as u32,
        total_sets: total_active_sets,
    }
}

/// Group active sets by exercise display name, resolve primary/secondary
/// role per exercise against `muscle_slug`, and return aggregated totals.
/// Skips warmup/cooldown/rest sets (`set_type != 0`). Primary role wins
/// over secondary when an exercise has multiple sets with differing roles.
fn aggregate_muscle_detail(
    muscle_slug: &str,
    sets: &[fit::FitExerciseSet],
) -> FfiMuscleGroupDetail {
    struct ExAgg {
        role: String, // "primary" | "secondary"
        sets: u32,
        reps: u32,
        volume_kg: f64,
    }

    let mut by_name: std::collections::BTreeMap<String, ExAgg> = std::collections::BTreeMap::new();

    for set in sets {
        if set.set_type != 0 {
            continue;
        }
        let muscles = fit::exercise_muscle_groups(set.exercise_category);
        let hit = muscles.iter().find(|m| m.slug == muscle_slug);
        let Some(muscle) = hit else { continue };

        let role = if muscle.intensity == 2 {
            "primary"
        } else {
            "secondary"
        };

        let name = fit::exercise_display_name(set.exercise_category, set.exercise_name);
        let reps = set.repetitions.unwrap_or(0) as u32;
        let volume = set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;

        let entry = by_name.entry(name).or_insert(ExAgg {
            role: role.to_string(),
            sets: 0,
            reps: 0,
            volume_kg: 0.0,
        });
        entry.sets += 1;
        entry.reps += reps;
        entry.volume_kg += volume;
        if role == "primary" {
            entry.role = "primary".to_string();
        }
    }

    let mut exercises: Vec<FfiExerciseContribution> = by_name
        .into_iter()
        .map(|(name, agg)| FfiExerciseContribution {
            name,
            role: agg.role,
            sets: agg.sets,
            reps: agg.reps,
            volume_kg: agg.volume_kg,
        })
        .collect();

    // Primary first, then by volume descending.
    exercises.sort_by(|a, b| match (a.role.as_str(), b.role.as_str()) {
        ("primary", "secondary") => std::cmp::Ordering::Less,
        ("secondary", "primary") => std::cmp::Ordering::Greater,
        _ => b
            .volume_kg
            .partial_cmp(&a.volume_kg)
            .unwrap_or(std::cmp::Ordering::Equal),
    });

    let total_sets: u32 = exercises.iter().map(|e| e.sets).sum();
    let total_reps: u32 = exercises.iter().map(|e| e.reps).sum();
    let total_volume_kg: f64 = exercises.iter().map(|e| e.volume_kg).sum();
    let primary_exercises = exercises.iter().filter(|e| e.role == "primary").count() as u32;
    let secondary_exercises = exercises.iter().filter(|e| e.role == "secondary").count() as u32;

    FfiMuscleGroupDetail {
        slug: muscle_slug.to_string(),
        exercises,
        total_sets,
        total_reps,
        total_volume_kg,
        primary_exercises,
        secondary_exercises,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A settled verdict permanently excludes an activity from the retry paths,
    /// so only a failure that will repeat forever may produce one. Recording a
    /// transport blip or an expired token is what destroyed a user's strength
    /// data with no way back short of wiping the database.
    #[test]
    fn only_a_missing_file_upstream_settles_an_activity() {
        assert!(fit_is_absent_upstream(&NetError::Http {
            status: 404,
            body: String::new(),
        }));
        assert!(fit_is_absent_upstream(&NetError::Http {
            status: 410,
            body: String::new(),
        }));

        for retryable in [
            NetError::Unauthorized,
            NetError::RateLimited,
            NetError::Transport("connection reset".to_string()),
            NetError::Io("read failed".to_string()),
            NetError::Http {
                status: 500,
                body: String::new(),
            },
            NetError::Http {
                status: 403,
                body: String::new(),
            },
        ] {
            assert!(
                !fit_is_absent_upstream(&retryable),
                "{retryable} must leave the activity queued for another attempt"
            );
        }
    }
}
