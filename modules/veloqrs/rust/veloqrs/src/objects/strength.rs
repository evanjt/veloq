//! StrengthManager: FFI object for strength training exercise data.
//!
//! Downloads FIT files from intervals.icu, parses exercise sets,
//! caches in SQLite, and returns structured data to TypeScript.

use super::error::{VeloqError, with_engine};
use super::observer;
use super::observer::Announcement;
use super::sync;
use crate::fit;
use crate::http::ActivityFetcher;
use crate::net::transport::NetError;
use crate::persistence::FitOutcome;
use crate::persistence::attempts::JobKey;
use crate::persistence::with_persistent_engine_blocking_for;
use crate::{
    FfiExerciseActivities, FfiExerciseActivity, FfiExerciseContribution, FfiExerciseSet,
    FfiMuscleGroup, FfiMuscleGroupDetail, FfiMuscleVolume, FfiStrengthProgression,
    FfiStrengthSummary, FfiTimestampRange,
};
use log::info;
use std::collections::HashMap;
use std::sync::Arc;

/// Parse a downloaded FIT file, store whatever sets it holds, and settle the
/// activity. Both fetch paths share it so one download can only ever produce one
/// verdict, written the same way.
async fn store_parsed_sets(install: u64, activity_id: &str, data: &[u8]) {
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

    // Off the tokio workers: the write lock is blocking and there are eight
    // workers, so taking it from inside the download future parks one for the
    // whole transaction. The closure is `'static`, so it takes owned data.
    let id = activity_id.to_string();
    let stored = with_persistent_engine_blocking_for(install, move |e| -> Result<(), VeloqError> {
        if !sets.is_empty() {
            e.store_exercise_sets(&id, &sets)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;
        }
        e.mark_fit_outcome(&id, outcome)
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })?;
        Ok(())
    })
    .await;
    match stored {
        Some(Ok(())) => {}
        Some(Err(e)) => {
            log::error!("[Strength] Failed to store sets for {}: {}", activity_id, e);
            return;
        }
        None => {
            log::error!("[Strength] No engine to store sets for {}", activity_id);
            return;
        }
    }
    // Announced only once the verdict is committed and the lock is released: an
    // event without a row would send the reader straight back for another fetch.
    // On a blocking thread, because the observer calls into JS and a worker
    // parked on that is a worker not polling the rest of the batch.
    let announced = activity_id.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        observer::notify(Announcement::FitParsed(announced.clone()));
    })
    .await;
}

/// Decide what a failed download means for the activity.
///
/// Only a 404 or 410 settles it: upstream holds no FIT file and a later attempt
/// would fetch the same nothing. Every other failure is the network, the token
/// or the server, so nothing is recorded and the activity stays in
/// `get_unprocessed_strength_ids` for the next attempt. Marking those settled is
/// what deleted a user's strength data for good.
async fn settle_failed_download(
    install: u64,
    activity_id: &str,
    error: NetError,
) -> Result<(), NetError> {
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
    let id = activity_id.to_string();
    let settled = with_persistent_engine_blocking_for(install, move |engine| {
        engine
            .mark_fit_outcome(&id, FitOutcome::Absent)
            .map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
    })
    .await;
    match settled {
        Some(Ok(())) => {}
        Some(Err(e)) => {
            log::error!("[Strength] Failed to settle {}: {}", activity_id, e);
            return Ok(());
        }
        None => {
            log::error!("[Strength] No engine to settle {}", activity_id);
            return Ok(());
        }
    }
    // On a blocking thread for the same reason the store path is: the observer
    // calls into JS, and a parked worker is a worker not polling the batch.
    let announced = activity_id.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        observer::notify(Announcement::FitParsed(announced.clone()));
    })
    .await;
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
    fn fetch_and_parse_exercise_sets(
        &self,
        activity_id: String,
    ) -> crate::objects::start::FfiStartOutcome {
        info!("[Strength] Fetching FIT file for {}", activity_id);
        sync::spawn_once(
            JobKey::new("fit", &[&activity_id]),
            move |install, transport, _athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let upstream = sync::upstream_id(install, &activity_id).await;
                // A card the athlete has open is waiting on this one.
                let data = match fetcher
                    .download_fit_file(&upstream, crate::governor::Lane::Interactive)
                    .await
                {
                    Ok(data) => data,
                    Err(e) => return settle_failed_download(install, &activity_id, e).await,
                };
                store_parsed_sets(install, &activity_id, &data).await;
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
    fn batch_fetch_exercise_sets(
        &self,
        activity_ids: Vec<String>,
    ) -> crate::objects::start::FfiStartOutcome {
        if activity_ids.is_empty() {
            // An empty list is not a refusal to work, it is no work.
            return crate::objects::start::FfiStartOutcome::NotOwed;
        }

        info!(
            "[Strength] Batch fetching FIT files for {} activities",
            activity_ids.len()
        );

        sync::spawn_once(
            JobKey::new("fit", &["batch"]),
            move |install, transport, _athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let total = activity_ids.len();
                let mut parsed = 0usize;

                for activity_id in &activity_ids {
                    let upstream = sync::upstream_id(install, activity_id).await;
                    // Behind a sync and nobody waiting, so it yields to the
                    // foreground rather than competing with it for the pace.
                    match fetcher
                        .download_fit_file(&upstream, crate::governor::Lane::Backfill)
                        .await
                    {
                        Ok(data) => {
                            store_parsed_sets(install, activity_id, &data).await;
                            parsed += 1;
                        }
                        Err(NetError::Unauthorized) => {
                            // The whole batch shares one credential, so the rest
                            // would fail the same way. Surface it once and stop
                            // rather than log the same 401 per activity.
                            return Err(NetError::Unauthorized);
                        }
                        Err(e) => {
                            let _ = settle_failed_download(install, activity_id, e).await;
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
    /// Everything the strength tab paints with, over the chosen period and the
    /// trailing weeks behind the progression charts.
    ///
    /// The four aggregates it carries all read the same rows: the period
    /// summary, the exercises behind every muscle, and one summary per week
    /// with the ranking across them. Three separate reads meant three passes
    /// over one window, and the exercise list meant one more for every muscle a
    /// finger crossed.
    fn get_screen_data(
        &self,
        start_ts: i64,
        end_ts: i64,
        week_ranges: Vec<FfiTimestampRange>,
    ) -> Result<crate::FfiStrengthScreenData, VeloqError> {
        with_engine(|e| {
            let period = e
                .get_exercise_sets_in_range(start_ts, end_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;

            let weekly = week_ranges
                .into_iter()
                .map(|range| {
                    e.get_exercise_sets_in_range(range.start_ts as i64, range.end_ts as i64)
                        .map(|sets| aggregate_strength_sets(&sets))
                        .map_err(|err| VeloqError::Database {
                            msg: format!("{}", err),
                        })
                })
                .collect::<Result<Vec<FfiStrengthSummary>, VeloqError>>()?;

            let period_days = ((end_ts - start_ts) / 86400).max(1) as u32;
            Ok(strength_screen_data(&period, period_days, weekly))
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
                        date: *date as f64,
                        sets: agg.total_sets,
                        total_weight_kg: agg.total_weight_kg,
                        is_primary: agg.has_primary,
                    })
                })
                .collect();

            // Sort by date descending
            activities.sort_by(|a, b| b.date.total_cmp(&a.date));

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

        // The caller reads the count back on this tick, so the card that asked
        // is served. Every other card on the same activity is not, and the
        // reader carries no timer to find out on its own.
        observer::notify(Announcement::FitParsed(activity_id.clone()));

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
        })??;

        // Same reason as the import above, and it is the demo seed's only
        // signal that its synthetic sets have landed.
        observer::notify(Announcement::FitParsed(activity_id.clone()));

        Ok(())
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
/// It takes the rows rather than the engine, so the screen read aggregates
/// every window it was asked for under one lock.
pub fn aggregate_strength_sets(sets: &[(String, fit::FitExerciseSet)]) -> FfiStrengthSummary {
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

    let balance = balance_pairs(&muscle_volumes);

    FfiStrengthSummary {
        muscle_volumes,
        activity_count: activity_ids.len() as u32,
        total_sets: total_active_sets,
        balance,
    }
}

/// Every muscle's exercises over one window, in one pass over the sets.
///
/// A set counts under each muscle its exercise reaches, primary or secondary,
/// and `is_primary` says whether any occurrence worked that muscle primarily.
pub fn exercises_by_muscle(
    sets: &[(String, fit::FitExerciseSet)],
    period_days: u32,
) -> Vec<crate::FfiMuscleExercises> {
    struct ExAgg {
        total_sets: u32,
        total_weight_kg: f64,
        activity_ids: std::collections::HashSet<String>,
        has_primary: bool,
    }

    let mut by_muscle: std::collections::HashMap<String, std::collections::HashMap<u16, ExAgg>> =
        std::collections::HashMap::new();

    for (activity_id, set) in sets {
        for muscle in fit::exercise_muscle_groups(set.exercise_category) {
            let agg = by_muscle
                .entry(muscle.slug.to_string())
                .or_default()
                .entry(set.exercise_category)
                .or_insert(ExAgg {
                    total_sets: 0,
                    total_weight_kg: 0.0,
                    activity_ids: std::collections::HashSet::new(),
                    has_primary: false,
                });

            agg.total_sets += 1;
            agg.total_weight_kg +=
                set.weight_kg.unwrap_or(0.0) * set.repetitions.unwrap_or(1) as f64;
            agg.activity_ids.insert(activity_id.clone());
            if muscle.intensity == 2 {
                agg.has_primary = true;
            }
        }
    }

    let mut muscles: Vec<crate::FfiMuscleExercises> = by_muscle
        .into_iter()
        .map(|(slug, exercise_map)| {
            let mut exercises: Vec<crate::FfiExerciseSummary> = exercise_map
                .into_iter()
                .map(|(category, agg)| {
                    let activity_count = agg.activity_ids.len() as u32;
                    crate::FfiExerciseSummary {
                        exercise_name: fit::exercise_display_name(category, None),
                        exercise_category: category,
                        frequency_days: if activity_count > 0 {
                            period_days as f64 / activity_count as f64
                        } else {
                            0.0
                        },
                        total_sets: agg.total_sets,
                        total_weight_kg: agg.total_weight_kg,
                        activity_count,
                        is_primary: agg.has_primary,
                    }
                })
                .collect();

            exercises.sort_by(|a, b| {
                b.activity_count
                    .cmp(&a.activity_count)
                    .then_with(|| b.total_sets.cmp(&a.total_sets))
            });

            crate::FfiMuscleExercises {
                muscle_slug: slug,
                exercises,
            }
        })
        .collect();

    // The order is the reader's own, by slug, so two reads of one library agree.
    muscles.sort_by(|a, b| a.muscle_slug.cmp(&b.muscle_slug));
    muscles
}

/// The strength tab's whole payload, out of the rows already read.
pub fn strength_screen_data(
    period_sets: &[(String, fit::FitExerciseSet)],
    period_days: u32,
    weekly: Vec<FfiStrengthSummary>,
) -> crate::FfiStrengthScreenData {
    let progressions = strength_progressions_across(&weekly);
    crate::FfiStrengthScreenData {
        summary: aggregate_strength_sets(period_sets),
        exercises: exercises_by_muscle(period_sets, period_days),
        weekly,
        progressions,
        period_days,
    }
}

/// The opposing pairs the balance verdict is read over.
const BALANCE_PAIRS: [(&str, &str, &str); 3] = [
    ("quads_hamstrings", "quadriceps", "hamstring"),
    ("chest_back", "chest", "upper-back"),
    ("biceps_triceps", "biceps", "triceps"),
];

/// Below this many weighted sets across a pair there is nothing to judge: two
/// sets against one is the same ratio as twenty against ten and says far less.
const MIN_BALANCE_SIGNAL: f64 = 4.0;
/// Worth naming, not worth calling wrong.
const WATCH_RATIO: f64 = 1.35;
/// Twice the volume on one side of a pair.
const IMBALANCED_RATIO: f64 = 2.0;

/// Round to one decimal the way the reader did, so the two agree figure for
/// figure.
fn round_to_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Rank every muscle in `monthly` over `weekly`, oldest week first.
///
/// The trailing two weeks against the leading two. Fewer than four weeks
/// overlaps the two halves rather than refusing, which is what the slices in
/// the reader did, and a muscle absent from a week counts as zero that week.
pub(crate) fn strength_progressions(
    monthly: &FfiStrengthSummary,
    weekly: &[FfiStrengthSummary],
) -> Vec<FfiStrengthProgression> {
    progressions_for(
        monthly.muscle_volumes.iter().map(|m| m.slug.as_str()),
        weekly,
    )
}

/// The same ranking for a caller that has no monthly window, which is the
/// volume screen: the muscles are whichever appear in any of the weeks, most
/// trained across them first. A muscle in no week at all is not a row, so the
/// screen never draws an empty chart for one.
pub(crate) fn strength_progressions_across(
    weekly: &[FfiStrengthSummary],
) -> Vec<FfiStrengthProgression> {
    let mut totals: Vec<(String, f64)> = Vec::new();
    for week in weekly {
        for muscle in &week.muscle_volumes {
            match totals.iter_mut().find(|(slug, _)| slug == &muscle.slug) {
                Some((_, total)) => *total += muscle.weighted_sets,
                None => totals.push((muscle.slug.clone(), muscle.weighted_sets)),
            }
        }
    }
    totals.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    progressions_for(totals.iter().map(|(slug, _)| slug.as_str()), weekly)
}

/// One progression per slug given, in the order given.
fn progressions_for<'a>(
    slugs: impl Iterator<Item = &'a str>,
    weekly: &[FfiStrengthSummary],
) -> Vec<FfiStrengthProgression> {
    slugs
        .map(|slug| {
            let weeks: Vec<f64> = weekly
                .iter()
                .map(|week| {
                    round_to_one(
                        week.muscle_volumes
                            .iter()
                            .find(|v| v.slug == slug)
                            .map(|v| v.weighted_sets)
                            .unwrap_or(0.0),
                    )
                })
                .collect();

            let half = |slice: &[f64]| slice.iter().sum::<f64>() / slice.len().max(1) as f64;
            let baseline_average = half(&weeks[..weeks.len().min(2)]);
            let recent_average = half(&weeks[weeks.len().saturating_sub(2)..]);

            let mut change_pct = None;
            let mut trend = "flat";
            if baseline_average > 0.0 {
                let change = (recent_average - baseline_average) / baseline_average * 100.0;
                change_pct = Some(round_to_one(change));
                if change >= 15.0 {
                    trend = "up";
                } else if change <= -15.0 {
                    trend = "down";
                }
            } else if recent_average > 0.0 {
                trend = "up";
            }

            let peak_weighted_sets = weeks.iter().fold(0.0_f64, |peak, week| peak.max(*week));

            FfiStrengthProgression {
                muscle_slug: slug.to_string(),
                weekly_weighted_sets: weeks,
                recent_average: round_to_one(recent_average),
                baseline_average: round_to_one(baseline_average),
                peak_weighted_sets,
                change_pct,
                trend: trend.to_string(),
            }
        })
        .collect()
}

/// The verdict for every pair, trained or not. A pair nobody trained is
/// reported as `insufficient` rather than omitted, so the screen draws the same
/// three rows whatever the month held.
fn balance_pairs(muscle_volumes: &[FfiMuscleVolume]) -> Vec<crate::FfiStrengthBalancePair> {
    let weighted = |slug: &str| -> f64 {
        muscle_volumes
            .iter()
            .find(|m| m.slug == slug)
            .map(|m| round_to_one(m.weighted_sets))
            .unwrap_or(0.0)
    };

    BALANCE_PAIRS
        .iter()
        .map(|(id, left_slug, right_slug)| {
            let left = weighted(left_slug);
            let right = weighted(right_slug);
            let total = left + right;
            let max_side = left.max(right);
            let min_side = left.min(right);

            let ratio = if min_side > 0.0 {
                Some(max_side / min_side)
            } else {
                None
            };

            let status = if total < MIN_BALANCE_SIGNAL {
                "insufficient"
            } else if min_side == 0.0 {
                "one-sided"
            } else if ratio.is_some_and(|r| r >= IMBALANCED_RATIO) {
                "imbalanced"
            } else if ratio.is_some_and(|r| r >= WATCH_RATIO) {
                "watch"
            } else {
                "balanced"
            };

            let dominant_slug = if left == right {
                None
            } else if left > right {
                Some((*left_slug).to_string())
            } else {
                Some((*right_slug).to_string())
            };

            crate::FfiStrengthBalancePair {
                id: (*id).to_string(),
                left_slug: (*left_slug).to_string(),
                right_slug: (*right_slug).to_string(),
                left_weighted_sets: left,
                right_weighted_sets: right,
                dominant_slug,
                ratio,
                status: status.to_string(),
            }
        })
        .collect()
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
    use super::observer::{recorder::Recorder, set_observer};
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};

    /// One set of an exercise in `category`, active rather than warmup.
    fn a_set(order: u32, category: u16) -> (String, fit::FitExerciseSet) {
        (
            "act-1".to_string(),
            fit::FitExerciseSet {
                set_order: order,
                exercise_category: category,
                exercise_name: None,
                set_type: 0,
                repetitions: Some(8),
                weight_kg: Some(40.0),
                duration_secs: None,
                start_time: None,
            },
        )
    }

    /// The same set, recorded against a second activity.
    fn other_activity(set: (String, fit::FitExerciseSet)) -> (String, fit::FitExerciseSet) {
        ("act-2".to_string(), set.1)
    }

    fn for_muscle<'a>(
        by_muscle: &'a [crate::FfiMuscleExercises],
        slug: &str,
    ) -> &'a [crate::FfiExerciseSummary] {
        &by_muscle
            .iter()
            .find(|m| m.muscle_slug == slug)
            .expect("a muscle the sets reached is a row")
            .exercises
    }

    fn pair<'a>(summary: &'a FfiStrengthSummary, id: &str) -> &'a crate::FfiStrengthBalancePair {
        summary
            .balance
            .iter()
            .find(|p| p.id == id)
            .expect("every pair is reported, whether or not it was trained")
    }

    /// The verdict is what the screen reads, so it belongs beside the volumes
    /// it is a function of rather than being re-derived per mount.
    #[test]
    fn a_muscle_trained_far_more_than_its_opposite_reads_imbalanced() {
        // Curl is biceps primary; Triceps Extension (category 30) is triceps.
        let mut sets: Vec<_> = (0..8).map(|i| a_set(i, 7)).collect();
        sets.push(a_set(8, 30));

        let summary = aggregate_strength_sets(&sets);
        let arms = pair(&summary, "biceps_triceps");

        assert_eq!(arms.status, "imbalanced");
        assert_eq!(arms.dominant_slug.as_deref(), Some("biceps"));
        assert_eq!(arms.ratio, Some(8.0));
    }

    #[test]
    fn a_pair_trained_on_one_side_alone_is_one_sided_and_carries_no_ratio() {
        let sets: Vec<_> = (0..6).map(|i| a_set(i, 7)).collect();

        let summary = aggregate_strength_sets(&sets);
        let arms = pair(&summary, "biceps_triceps");

        assert_eq!(arms.status, "one-sided");
        assert_eq!(arms.ratio, None, "a ratio against zero is not a number");
        assert_eq!(arms.dominant_slug.as_deref(), Some("biceps"));
    }

    #[test]
    fn a_pair_with_too_few_sets_behind_it_says_so_rather_than_judging() {
        let sets = vec![a_set(0, 7), a_set(1, 30)];

        let summary = aggregate_strength_sets(&sets);

        assert_eq!(pair(&summary, "biceps_triceps").status, "insufficient");
        assert_eq!(
            pair(&summary, "quads_hamstrings").status,
            "insufficient",
            "a pair nobody trained is reported, not omitted"
        );
    }

    #[test]
    fn two_sides_within_a_third_of_each_other_are_balanced() {
        let mut sets: Vec<_> = (0..4).map(|i| a_set(i, 7)).collect();
        sets.extend((4..8).map(|i| a_set(i, 30)));

        let summary = aggregate_strength_sets(&sets);
        let arms = pair(&summary, "biceps_triceps");

        assert_eq!(arms.status, "balanced");
        assert_eq!(
            arms.dominant_slug, None,
            "an even pair has no dominant side"
        );
    }

    /// The reader carries no timer, so an activity that settles without
    /// announcing leaves the strength card waiting for as long as it is open.
    #[test]
    fn test_store_parsed_sets_announces_the_committed_verdict() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_parsed.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));

        // A FIT file carrying no sets settles the activity all the same. On the
        // shared runtime, because the store now hands the write and the
        // announcement to blocking threads rather than parking a worker.
        crate::runtime::block_on(store_parsed_sets(
            crate::persistence::engine_install(),
            "a1",
            &[],
        ));
        set_observer(None);

        assert_eq!(recorder.events(), vec!["fit_parsed:a1"]);
        assert!(
            with_engine(|e| e.is_fit_processed("a1").unwrap()).unwrap(),
            "the verdict must be committed before the announcement"
        );
    }

    #[test]
    fn test_a_file_absent_upstream_announces_its_settle() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_absent.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));

        crate::runtime::block_on(settle_failed_download(
            crate::persistence::engine_install(),
            "a2",
            NetError::Http {
                status: 404,
                body: String::new(),
            },
        ))
        .expect("an absent file settles rather than fails");
        set_observer(None);

        assert_eq!(recorder.events(), vec!["fit_parsed:a2"]);
        assert!(with_engine(|e| e.is_fit_processed("a2").unwrap()).unwrap());
    }

    /// A retryable failure records nothing, so announcing one would send the
    /// reader back for a fetch that is already queued for the next visit.
    #[test]
    fn test_a_retryable_failure_announces_nothing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_retry.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));

        assert!(
            crate::runtime::block_on(settle_failed_download(
                crate::persistence::engine_install(),
                "a3",
                NetError::RateLimited
            ))
            .is_err()
        );
        set_observer(None);

        assert!(recorder.events().is_empty());
        assert!(!with_engine(|e| e.is_fit_processed("a3").unwrap()).unwrap());
    }

    /// Both of these are called from TypeScript and return the verdict to the
    /// caller, so the card that asked is served either way. Any other card on
    /// the same activity, and the demo seed's own reader, hear nothing without
    /// the announcement.
    #[test]
    fn test_importing_fit_bytes_announces_the_verdict() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_import.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));

        // Not a FIT file, so the parse fails and nothing is committed.
        let manager = StrengthManager::new();
        assert!(
            manager
                .import_sets_from_fit("a4".to_string(), b"not a fit file".to_vec())
                .is_err()
        );
        assert!(
            recorder.events().is_empty(),
            "a parse that committed nothing has nothing to announce"
        );

        manager
            .bulk_insert_exercise_sets("a5".to_string(), vec![])
            .expect("an empty seed still settles the activity");
        set_observer(None);

        assert_eq!(recorder.events(), vec!["fit_parsed:a5"]);
        assert!(
            with_engine(|e| e.is_fit_processed("a5").unwrap()).unwrap(),
            "the verdict must be committed before the announcement"
        );
    }

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

    fn volume(slug: &str, weighted_sets: f64) -> FfiMuscleVolume {
        FfiMuscleVolume {
            slug: slug.to_string(),
            primary_sets: 0,
            secondary_sets: 0,
            weighted_sets,
            total_reps: 0,
            total_weight_kg: 0.0,
            exercise_names: Vec::new(),
        }
    }

    fn summary(volumes: Vec<FfiMuscleVolume>) -> FfiStrengthSummary {
        FfiStrengthSummary {
            balance: balance_pairs(&volumes),
            muscle_volumes: volumes,
            activity_count: 1,
            total_sets: 1,
        }
    }

    fn progression_for<'a>(
        progressions: &'a [FfiStrengthProgression],
        slug: &str,
    ) -> &'a FfiStrengthProgression {
        progressions
            .iter()
            .find(|p| p.muscle_slug == slug)
            .unwrap_or_else(|| panic!("no progression for {slug}"))
    }

    /// Scenario: the four trailing weeks of one muscle, rising.
    /// Expected behaviour: the same figures `buildStrengthProgression` returned
    /// in TypeScript, which rounds each week to one decimal before averaging.
    #[test]
    fn test_progression_ranks_the_trailing_pair_against_the_leading_pair() {
        let weekly = vec![
            summary(vec![volume("biceps", 2.0)]),
            summary(vec![volume("biceps", 3.0)]),
            summary(vec![volume("biceps", 5.0)]),
            summary(vec![volume("biceps", 6.0)]),
        ];
        let monthly = summary(vec![volume("biceps", 16.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let biceps = progression_for(&progressions, "biceps");

        assert_eq!(biceps.weekly_weighted_sets, vec![2.0, 3.0, 5.0, 6.0]);
        assert_eq!(biceps.baseline_average, 2.5);
        assert_eq!(biceps.recent_average, 5.5);
        assert_eq!(biceps.peak_weighted_sets, 6.0);
        assert_eq!(biceps.change_pct, Some(120.0));
        assert_eq!(biceps.trend, "up");
    }

    /// A week the muscle was not trained at all is a zero in the series, not a
    /// gap: the TypeScript built the points from the monthly muscle list.
    #[test]
    fn test_a_muscle_missing_from_a_week_counts_as_zero_that_week() {
        let weekly = vec![
            summary(vec![volume("chest", 4.0)]),
            summary(vec![volume("chest", 4.0)]),
            summary(Vec::new()),
            summary(vec![volume("chest", 1.0)]),
        ];
        let monthly = summary(vec![volume("chest", 9.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let chest = progression_for(&progressions, "chest");

        assert_eq!(chest.weekly_weighted_sets, vec![4.0, 4.0, 0.0, 1.0]);
        assert_eq!(chest.baseline_average, 4.0);
        assert_eq!(chest.recent_average, 0.5);
        assert_eq!(chest.change_pct, Some(-87.5));
        assert_eq!(chest.trend, "down");
    }

    /// A baseline of zero has no percentage to report, and any recent volume
    /// at all is a rise rather than a flat month.
    #[test]
    fn test_a_zero_baseline_reports_no_change_pct_and_still_rises() {
        let weekly = vec![
            summary(Vec::new()),
            summary(Vec::new()),
            summary(vec![volume("triceps", 2.0)]),
            summary(vec![volume("triceps", 3.0)]),
        ];
        let monthly = summary(vec![volume("triceps", 5.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let triceps = progression_for(&progressions, "triceps");

        assert_eq!(triceps.baseline_average, 0.0);
        assert_eq!(triceps.change_pct, None);
        assert_eq!(triceps.trend, "up");
    }

    /// A zero baseline with nothing recent either is flat, not a rise.
    #[test]
    fn test_a_month_with_no_volume_at_all_is_flat() {
        let weekly = vec![summary(Vec::new()), summary(Vec::new())];
        let monthly = summary(vec![volume("calves", 0.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let calves = progression_for(&progressions, "calves");

        assert_eq!(calves.change_pct, None);
        assert_eq!(calves.trend, "flat");
    }

    /// Fewer than four weeks overlaps the two halves, which is what the
    /// TypeScript slices did, so the averages are equal rather than absent.
    #[test]
    fn test_a_single_week_compares_against_itself() {
        let weekly = vec![summary(vec![volume("hamstring", 3.0)])];
        let monthly = summary(vec![volume("hamstring", 3.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let hamstring = progression_for(&progressions, "hamstring");

        assert_eq!(hamstring.weekly_weighted_sets, vec![3.0]);
        assert_eq!(hamstring.baseline_average, 3.0);
        assert_eq!(hamstring.recent_average, 3.0);
        assert_eq!(hamstring.change_pct, Some(0.0));
        assert_eq!(hamstring.trend, "flat");
    }

    /// The rounding order is part of the contract: each week is rounded to one
    /// decimal before the averages, so rounding after would disagree.
    #[test]
    fn test_each_week_is_rounded_before_the_averages() {
        let weekly = vec![
            summary(vec![volume("quadriceps", 1.25)]),
            summary(vec![volume("quadriceps", 1.25)]),
            summary(vec![volume("quadriceps", 2.0)]),
            summary(vec![volume("quadriceps", 2.0)]),
        ];
        let monthly = summary(vec![volume("quadriceps", 6.5)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let quads = progression_for(&progressions, "quadriceps");

        assert_eq!(quads.weekly_weighted_sets, vec![1.3, 1.3, 2.0, 2.0]);
        assert_eq!(quads.baseline_average, 1.3);
        assert_eq!(quads.recent_average, 2.0);
    }

    /// One entry per muscle in the monthly aggregate, in its order, so the
    /// caller does not re-find anything.
    #[test]
    fn test_one_progression_per_muscle_in_the_monthly_order() {
        let weekly = vec![summary(vec![volume("chest", 2.0), volume("biceps", 1.0)])];
        let monthly = summary(vec![volume("chest", 2.0), volume("biceps", 1.0)]);

        let progressions = strength_progressions(&monthly, &weekly);

        let slugs: Vec<&str> = progressions
            .iter()
            .map(|p| p.muscle_slug.as_str())
            .collect();
        assert_eq!(slugs, vec!["chest", "biceps"]);
    }

    /// Scenario: the volume screen reads four trailing weeks and no monthly
    /// window, so the muscles to rank are whichever appear across the weeks.
    /// Expected behaviour: one progression per muscle seen in any week, most
    /// trained first, with the weeks it was absent from counted as zero.
    #[test]
    fn test_every_muscle_across_the_ranges_is_ranked() {
        let weekly = vec![
            summary(vec![volume("chest", 2.0)]),
            summary(vec![volume("chest", 3.0), volume("biceps", 1.0)]),
            summary(vec![volume("biceps", 4.0)]),
            summary(vec![volume("chest", 6.0), volume("biceps", 5.0)]),
        ];

        let progressions = strength_progressions_across(&weekly);

        let slugs: Vec<&str> = progressions
            .iter()
            .map(|p| p.muscle_slug.as_str())
            .collect();
        assert_eq!(slugs, vec!["chest", "biceps"]);

        let chest = progression_for(&progressions, "chest");
        assert_eq!(chest.weekly_weighted_sets, vec![2.0, 3.0, 0.0, 6.0]);
        assert_eq!(chest.baseline_average, 2.5);
        assert_eq!(chest.recent_average, 3.0);

        let biceps = progression_for(&progressions, "biceps");
        assert_eq!(biceps.weekly_weighted_sets, vec![0.0, 1.0, 4.0, 5.0]);
        assert_eq!(biceps.baseline_average, 0.5);
        assert_eq!(biceps.recent_average, 4.5);
        assert_eq!(biceps.trend, "up");
    }

    /// A muscle trained in no week at all is not a row: the screen would draw
    /// an empty chart for it.
    #[test]
    fn test_ranges_with_no_sets_rank_nothing() {
        let progressions =
            strength_progressions_across(&[summary(Vec::new()), summary(Vec::new())]);
        assert!(progressions.is_empty());
    }

    /// The two entry points agree. Given a monthly window naming the same
    /// muscles, the union ranking is the monthly ranking, so the insights
    /// series and the volume screen never disagree about one muscle's trend.
    #[test]
    fn test_the_union_ranking_matches_the_monthly_ranking() {
        let weekly = vec![
            summary(vec![volume("chest", 1.0)]),
            summary(vec![volume("chest", 2.0)]),
            summary(vec![volume("chest", 5.0)]),
            summary(vec![volume("chest", 6.0)]),
        ];
        let monthly = summary(vec![volume("chest", 14.0)]);

        let from_monthly = strength_progressions(&monthly, &weekly);
        let across = strength_progressions_across(&weekly);

        assert_eq!(across.len(), from_monthly.len());
        assert_eq!(
            across[0].weekly_weighted_sets,
            from_monthly[0].weekly_weighted_sets
        );
        assert_eq!(across[0].change_pct, from_monthly[0].change_pct);
        assert_eq!(across[0].trend, from_monthly[0].trend);
    }

    /// Averages that differ by less than the threshold are flat, even when the
    /// weeks themselves move about. Under 15 per cent either way is noise.
    #[test]
    fn test_similar_averages_are_flat_not_a_trend() {
        let weekly = vec![
            summary(vec![volume("upper-back", 4.0)]),
            summary(vec![volume("upper-back", 5.0)]),
            summary(vec![volume("upper-back", 4.0)]),
            summary(vec![volume("upper-back", 5.0)]),
        ];

        let progressions = strength_progressions_across(&weekly);
        let back = progression_for(&progressions, "upper-back");

        assert_eq!(back.baseline_average, 4.5);
        assert_eq!(back.recent_average, 4.5);
        assert_eq!(back.change_pct, Some(0.0));
        assert_eq!(back.trend, "flat");
    }

    /// Scenario: the diagram is scrubbed across one muscle after another, and
    /// each muscle's exercise list was its own pass over the same sets.
    ///
    /// Expected behaviour: one pass answers for every muscle, and a set counts
    /// under each muscle its exercise reaches.
    #[test]
    fn test_every_muscle_s_exercises_come_out_of_one_pass() {
        // Curl is biceps primary and forearm secondary; Triceps Extension is
        // triceps, so no muscle here reads both exercises.
        let mut sets: Vec<_> = (0..3).map(|i| a_set(i, 7)).collect();
        sets.extend((3..5).map(|i| a_set(i, 30)));

        let by_muscle = exercises_by_muscle(&sets, 30);

        let biceps = for_muscle(&by_muscle, "biceps");
        assert_eq!(biceps.len(), 1);
        assert_eq!(biceps[0].exercise_category, 7);
        assert_eq!(biceps[0].total_sets, 3);
        assert!(biceps[0].is_primary);

        let forearm = for_muscle(&by_muscle, "forearm");
        assert_eq!(forearm.len(), 1);
        assert_eq!(
            forearm[0].exercise_category, 7,
            "the curl works the forearm too, secondarily"
        );
        assert!(!forearm[0].is_primary);

        assert!(
            by_muscle.iter().all(|m| !m.exercises.is_empty()),
            "a muscle no set reached is not a row"
        );
    }

    /// The most frequent exercise reads first, and sets break a tie.
    #[test]
    fn test_a_muscle_s_exercises_read_most_frequent_first() {
        let mut sets = vec![a_set(0, 7)];
        sets.push(other_activity(a_set(1, 7)));
        sets.push(a_set(2, 21)); // Pull Up, biceps primary alongside the upper back

        let by_muscle = exercises_by_muscle(&sets, 30);
        let biceps = for_muscle(&by_muscle, "biceps");

        assert_eq!(
            biceps
                .iter()
                .map(|e| e.exercise_category)
                .collect::<Vec<_>>(),
            vec![7, 21]
        );
        assert_eq!(biceps[0].activity_count, 2);
        assert_eq!(biceps[0].frequency_days, 15.0);
    }

    /// The screen reads once, so the four things it draws are four aggregates
    /// of the one set of rows rather than four trips through the engine.
    #[test]
    fn test_the_screen_read_carries_the_period_the_weeks_and_the_ranking() {
        let period: Vec<_> = (0..4).map(|i| a_set(i, 7)).collect();
        let weekly = vec![
            summary(vec![volume("biceps", 1.0)]),
            summary(vec![volume("biceps", 4.0)]),
        ];

        let data = strength_screen_data(&period, 30, weekly);

        let direct = aggregate_strength_sets(&period);
        assert_eq!(
            data.summary
                .muscle_volumes
                .iter()
                .map(|m| (m.slug.as_str(), m.weighted_sets))
                .collect::<Vec<_>>(),
            direct
                .muscle_volumes
                .iter()
                .map(|m| (m.slug.as_str(), m.weighted_sets))
                .collect::<Vec<_>>()
        );
        assert_eq!(data.weekly.len(), 2);
        assert_eq!(data.period_days, 30);
        assert_eq!(
            progression_for(&data.progressions, "biceps").weekly_weighted_sets,
            vec![1.0, 4.0]
        );
        assert_eq!(for_muscle(&data.exercises, "biceps")[0].total_sets, 4);
    }
}
