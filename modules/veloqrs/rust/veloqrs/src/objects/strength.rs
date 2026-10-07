//! StrengthManager: FFI object for strength training exercise data.
//!
//! Downloads FIT files from intervals.icu, parses exercise sets,
//! caches in SQLite, and returns structured data to TypeScript.

use super::error::{VeloqError, with_engine, with_reader};
use super::observer;
use super::observer::Announcement;
use super::sync;
use crate::fit;
use crate::http::ActivityFetcher;
use crate::net::transport::NetError;
use crate::persistence::FitOutcome;
use crate::persistence::attempts::JobKey;
use crate::persistence::strength::pooled;
use crate::persistence::with_persistent_engine_blocking_for;
use crate::{
    FfiExerciseActivities, FfiExerciseActivity, FfiExerciseContribution, FfiExerciseGroup,
    FfiExerciseSession, FfiExerciseSet, FfiMuscleGroup, FfiMuscleGroupDetail, FfiMuscleVolume,
    FfiStrengthProgression, FfiStrengthSummary, FfiTimestampRange,
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
    observer::notify(Announcement::FitParsed(activity_id.to_string()));
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
    observer::notify(Announcement::FitParsed(activity_id.to_string()));
    Ok(())
}

/// Whether the failure means the activity has no FIT file to fetch, ever.
fn fit_is_absent_upstream(error: &NetError) -> bool {
    matches!(error, NetError::Http { status, .. } if *status == 404 || *status == 410)
}

async fn drain_fit_batch_with<S, F, Fut>(
    activity_ids: &[String],
    mut still_signed_in: S,
    mut fetch: F,
) -> Result<usize, NetError>
where
    S: FnMut() -> bool,
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<bool, NetError>>,
{
    let mut parsed = 0;
    for activity_id in activity_ids {
        if !still_signed_in() {
            return Ok(parsed);
        }
        if fetch(activity_id.clone()).await? {
            parsed += 1;
        }
    }
    Ok(parsed)
}

#[derive(uniffi::Object)]
pub struct StrengthManager {
    pub(crate) _private: (),
}

/// Parse a recorded session's FIT bytes and store its strength sets under the
/// activity the upload created, marking it FIT-processed either way. Returns
/// the number of sets stored. No network access: the bytes are the device's own
/// copy, and intervals.icu sends nothing back down the sync for them.
///
/// The write runs only while `install` is open, the one the upload captured,
/// so a restore that lands meanwhile is not written into.
pub(crate) fn import_fit_sets_under(
    install: u64,
    activity_id: &str,
    fit_bytes: &[u8],
) -> Result<u32, VeloqError> {
    let sets = fit::parse_fit_strength_sets(fit_bytes).map_err(|e| VeloqError::ParseError {
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

    let store = |e: &mut crate::persistence::PersistentEngine| -> Result<(), VeloqError> {
        if has_sets {
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
    };
    crate::persistence::with_persistent_engine_for(install, store)
        .ok_or(VeloqError::NotInitialized)??;

    // Every card on the activity reads the verdict, and none carries a timer
    // to find out on its own.
    observer::notify(Announcement::FitParsed(activity_id.to_string()));

    Ok(count)
}

#[uniffi::export]
impl StrengthManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// One exercise's best set per session and estimated one-rep-max trend.
    fn get_exercise_detail_data(
        &self,
        exercise_category: u16,
    ) -> Result<crate::FfiExerciseDetailData, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::exercise_detail_data(conn, exercise_category)
        })?
    }

    /// Get cached exercise sets for an activity (from SQLite).
    /// Returns empty vec if not yet downloaded/parsed.
    fn get_exercise_sets(&self, activity_id: String) -> Result<FfiExerciseSession, VeloqError> {
        with_reader(|conn| {
            let sets =
                pooled::exercise_sets(conn, &activity_id).map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(summarise_session(sets_to_ffi(&activity_id, &sets)))
        })?
    }

    /// Check if FIT file has been processed for this activity.
    fn is_fit_processed(&self, activity_id: String) -> Result<bool, VeloqError> {
        with_reader(|conn| {
            pooled::is_fit_processed(conn, &activity_id).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Start a FIT download for one activity, parse its exercise sets and store
    /// them. Returns the start verdict and any backoff deadline.
    ///
    /// Nothing is returned to the caller: the download ran on the JS thread
    /// before, so a black-hole network froze the UI for as long as the request
    /// took. The sets land in SQLite and are read back through
    /// `get_exercise_sets`, the same path a cache hit takes.
    fn fetch_and_parse_exercise_sets(
        &self,
        activity_id: String,
    ) -> crate::objects::start::FfiStartResult {
        info!("[Strength] Fetching FIT file for {}", activity_id);
        sync::spawn_once(
            JobKey::new("fit", &[&activity_id]),
            move |install, transport, _athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let Some(upstream) = sync::upstream_id(install, &activity_id).await else {
                    return Ok(());
                };
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

    /// Every strength activity owed a FIT download: a `WeightTraining` activity
    /// with no recorded outcome, newest first.
    fn get_unprocessed_strength_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_reader(|conn| {
            pooled::unprocessed_strength_queue(conn).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Start FIT downloads for a batch of activities. Returns the start
    /// verdict and any backoff deadline.
    ///
    /// Runs in the background for the same reason the single fetch does: the
    /// caller is the sync path on the JS thread, and this loop is one blocking
    /// request per activity.
    fn batch_fetch_exercise_sets(
        &self,
        activity_ids: Vec<String>,
    ) -> crate::objects::start::FfiStartResult {
        if activity_ids.is_empty() {
            // An empty list is not a refusal to work, it is no work.
            return crate::objects::start::FfiStartOutcome::NotOwed.into();
        }

        info!(
            "[Strength] Batch fetching FIT files for {} activities",
            activity_ids.len()
        );

        sync::spawn_once(
            JobKey::new("fit", &["batch"]),
            move |install, transport, athlete_id| async move {
                let fetcher = ActivityFetcher::with_transport(transport);
                let total = activity_ids.len();
                let parsed = drain_fit_batch_with(
                    &activity_ids,
                    || sync::still_signed_in(&athlete_id),
                    |activity_id| {
                        let fetcher = &fetcher;
                        async move {
                            let Some(upstream) = sync::upstream_id(install, &activity_id).await
                            else {
                                return Ok(false);
                            };
                            match fetcher
                                .download_fit_file(&upstream, crate::governor::Lane::Backfill)
                                .await
                            {
                                Ok(data) => {
                                    store_parsed_sets(install, &activity_id, &data).await;
                                    Ok(true)
                                }
                                Err(NetError::Unauthorized) => Err(NetError::Unauthorized),
                                Err(e) => {
                                    let _ = settle_failed_download(install, &activity_id, e).await;
                                    Ok(false)
                                }
                            }
                        }
                    },
                )
                .await?;

                info!("[Strength] Batch complete: {}/{} downloaded", parsed, total);
                Ok(())
            },
        )
    }

    /// Get aggregated strength training volume for a date range.
    /// Credits sets, reps and volume to each muscle: primary=1.0, secondary=0.5.
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
        start_ts: f64,
        end_ts: f64,
        week_ranges: Vec<FfiTimestampRange>,
    ) -> Result<crate::FfiStrengthScreenData, VeloqError> {
        let start_ts = crate::ffi_types::int_from_wire(start_ts);
        let end_ts = crate::ffi_types::int_from_wire(end_ts);
        with_reader(|conn| {
            let period = pooled::exercise_sets_in_range(conn, start_ts, end_ts).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
            })?;

            let weekly = week_ranges
                .into_iter()
                .map(|range| {
                    pooled::exercise_sets_in_range(conn, range.start_ts as i64, range.end_ts as i64)
                        .map(|sets| aggregate_strength_sets(&sets))
                        .map_err(|err| VeloqError::Database {
                            msg: format!("{}", err),
                        })
                })
                .collect::<Result<Vec<FfiStrengthSummary>, VeloqError>>()?;

            let owed_count = pooled::unprocessed_strength_count_in_range(conn, start_ts, end_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })?;

            Ok(crate::FfiStrengthScreenData {
                owed_count,
                ..strength_screen_data(&period, weekly)
            })
        })?
    }

    /// Get activities for a specific exercise filtered by muscle group.
    /// Returns activities sorted by date descending with per-activity stats.
    fn get_activities_for_exercise(
        &self,
        start_ts: f64,
        end_ts: f64,
        muscle_slug: String,
        exercise_category: u16,
    ) -> Result<FfiExerciseActivities, VeloqError> {
        let start_ts = crate::ffi_types::int_from_wire(start_ts);
        let end_ts = crate::ffi_types::int_from_wire(end_ts);
        with_reader(|conn| {
            let sets = pooled::exercise_sets_in_range(conn, start_ts, end_ts).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
            })?;

            // Per-activity aggregation, filtered by muscle + exercise
            struct ActAgg {
                total_sets: f64,
                total_reps: f64,
                volume_kg: f64,
                has_primary: bool,
            }
            let mut activity_map: std::collections::HashMap<String, ActAgg> =
                std::collections::HashMap::new();

            for (activity_id, set) in &sets {
                if set.exercise_category != exercise_category {
                    continue;
                }

                let muscles = fit::exercise_muscle_groups(set.exercise_category);
                let Some(muscle) = muscles.iter().find(|m| m.slug == muscle_slug) else {
                    continue;
                };

                let is_primary = muscle.intensity == 2;
                let agg = activity_map.entry(activity_id.clone()).or_insert(ActAgg {
                    total_sets: 0.0,
                    total_reps: 0.0,
                    volume_kg: 0.0,
                    has_primary: false,
                });

                let contribution = muscle_contribution(set, muscle.intensity);
                agg.total_sets += contribution.sets;
                agg.total_reps += contribution.reps;
                agg.volume_kg += contribution.volume_kg;
                if is_primary {
                    agg.has_primary = true;
                }
            }

            // Fetch activity names
            let activity_ids: Vec<String> = activity_map.keys().cloned().collect();
            let names = pooled::activity_names(conn, &activity_ids).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
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
                        reps: agg.total_reps,
                        volume_kg: agg.volume_kg,
                        is_primary: agg.has_primary,
                    })
                })
                .collect();

            // Sort by date descending
            activities.sort_by(|a, b| b.date.total_cmp(&a.date));

            Ok(FfiExerciseActivities { activities })
        })?
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
                start_time: s.start_time.map(|time| time as i64),
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
        with_reader(|conn| {
            let count =
                pooled::strength_activity_count(conn).map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(count > 0)
        })?
    }

    /// Get aggregated muscle groups for an activity.
    /// Returns slugs matching react-native-body-highlighter format.
    fn get_muscle_groups(&self, activity_id: String) -> Result<Vec<FfiMuscleGroup>, VeloqError> {
        with_reader(|conn| {
            let sets =
                pooled::exercise_sets(conn, &activity_id).map_err(|e| VeloqError::Database {
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
        with_reader(|conn| {
            let sets =
                pooled::exercise_sets(conn, &activity_id).map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(aggregate_muscle_detail(&muscle_slug, &sets))
        })?
    }
}

/// Convert internal FitExerciseSet to FFI-safe FfiExerciseSet with display names.
pub(crate) fn sets_to_ffi(activity_id: &str, sets: &[fit::FitExerciseSet]) -> Vec<FfiExerciseSet> {
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
            start_time: s.start_time.map(|time| time as f64),
        })
        .collect()
}

/// The one rule for what a session's active sets, exercise groups and totals
/// are. Rest, warmup and cooldown sets (`set_type != 0`) never count.
pub fn summarise_session(sets: Vec<FfiExerciseSet>) -> FfiExerciseSession {
    let mut groups: Vec<FfiExerciseGroup> = Vec::new();
    let mut names = std::collections::HashSet::new();
    let mut active_set_count = 0u32;
    let mut total_volume_kg = 0.0;
    let mut total_duration_secs = 0.0;

    for set in sets.iter().filter(|s| s.set_type == 0) {
        active_set_count += 1;
        total_volume_kg += set.weight_kg.unwrap_or(0.0) * f64::from(set.repetitions.unwrap_or(1));
        total_duration_secs += set.duration_secs.unwrap_or(0.0);
        names.insert(set.display_name.clone());
        match groups.last_mut() {
            Some(g) if g.name == set.display_name => {
                add_to_group(g, set);
            }
            _ => groups.push(FfiExerciseGroup {
                name: set.display_name.clone(),
                exercise_category: set.exercise_category,
                sets: vec![set.clone()],
                best_set: set
                    .weight_kg
                    .filter(|weight| weight.is_finite())
                    .map(|_| set.clone()),
                rest_seconds: Vec::new(),
            }),
        }
    }

    FfiExerciseSession {
        sets,
        groups,
        active_set_count,
        exercise_count: names.len() as u32,
        total_volume_kg,
        total_duration_secs,
    }
}

fn add_to_group(group: &mut FfiExerciseGroup, set: &FfiExerciseSet) {
    if let Some(previous) = group.sets.last() {
        if let (Some(start), Some(next)) = (previous.start_time, set.start_time) {
            let end = start + previous.duration_secs.unwrap_or(0.0);
            if next >= end {
                group.rest_seconds.push(next - end);
            }
        }
    }
    if let Some(weight) = set.weight_kg.filter(|weight| weight.is_finite()) {
        let best = group.best_set.as_ref();
        if best.is_none_or(|current| {
            weight > current.weight_kg.unwrap_or(0.0)
                || (weight == current.weight_kg.unwrap_or(0.0)
                    && set.repetitions.unwrap_or(0) > current.repetitions.unwrap_or(0))
        }) {
            group.best_set = Some(set.clone());
        }
    }
    group.sets.push(set.clone());
}

#[cfg(test)]
#[path = "tests/strength_history.rs"]
mod history_tests;

struct MuscleContribution {
    sets: f64,
    reps: f64,
    volume_kg: f64,
}

fn muscle_contribution(set: &fit::FitExerciseSet, intensity: u8) -> MuscleContribution {
    let share = match intensity {
        2 => 1.0,
        1 => 0.5,
        _ => 0.0,
    };
    let reps = set.repetitions.unwrap_or(0) as f64 * share;
    MuscleContribution {
        sets: share,
        reps,
        volume_kg: set.weight_kg.unwrap_or(0.0) * reps,
    }
}

/// Aggregate a slice of (activity_id, exercise_set) into a strength summary.
/// It takes the rows rather than the engine, so the screen read aggregates
/// every window it was asked for under one lock.
pub fn aggregate_strength_sets(sets: &[(String, fit::FitExerciseSet)]) -> FfiStrengthSummary {
    struct MuscleAgg {
        primary_sets: u32,
        secondary_sets: u32,
        total_reps: f64,
        volume_kg: f64,
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
                total_reps: 0.0,
                volume_kg: 0.0,
                exercise_names: std::collections::HashSet::new(),
            });

            agg.exercise_names.insert(display_name.clone());

            let contribution = muscle_contribution(set, muscle.intensity);
            if muscle.intensity == 2 {
                agg.primary_sets += 1;
            } else {
                agg.secondary_sets += 1;
            }
            agg.total_reps += contribution.reps;
            agg.volume_kg += contribution.volume_kg;
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
                volume_kg: agg.volume_kg,
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
) -> Vec<crate::FfiMuscleExercises> {
    struct ExAgg {
        total_sets: f64,
        total_reps: f64,
        volume_kg: f64,
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
                    total_sets: 0.0,
                    total_reps: 0.0,
                    volume_kg: 0.0,
                    activity_ids: std::collections::HashSet::new(),
                    has_primary: false,
                });

            let contribution = muscle_contribution(set, muscle.intensity);
            agg.total_sets += contribution.sets;
            agg.total_reps += contribution.reps;
            agg.volume_kg += contribution.volume_kg;
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
                        total_sets: agg.total_sets,
                        total_reps: agg.total_reps,
                        volume_kg: agg.volume_kg,
                        activity_count,
                        is_primary: agg.has_primary,
                    }
                })
                .collect();

            exercises.sort_by(|a, b| {
                b.activity_count
                    .cmp(&a.activity_count)
                    .then_with(|| b.total_sets.total_cmp(&a.total_sets))
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

/// The strength tab's whole payload, out of the rows already read. The owed
/// count is a read of its own, so the caller sets it.
pub fn strength_screen_data(
    period_sets: &[(String, fit::FitExerciseSet)],
    weekly: Vec<FfiStrengthSummary>,
) -> crate::FfiStrengthScreenData {
    let progressions = strength_progressions_across(&weekly);
    crate::FfiStrengthScreenData {
        summary: aggregate_strength_sets(period_sets),
        exercises: exercises_by_muscle(period_sets),
        weekly,
        progressions,
        owed_count: 0,
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
            let recent_average = round_to_one(recent_average);
            let baseline_average = round_to_one(baseline_average);
            // Over the figures the record reports, so the reading and the card
            // agree number for number.
            let signal_delta =
                crate::signal::signal_delta(recent_average, baseline_average, &weeks);

            FfiStrengthProgression {
                muscle_slug: slug.to_string(),
                weekly_weighted_sets: weeks,
                recent_average,
                baseline_average,
                peak_weighted_sets,
                change_pct,
                trend: trend.to_string(),
                signal_delta,
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
        sets: f64,
        reps: f64,
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
        let contribution = muscle_contribution(set, muscle.intensity);

        let entry = by_name.entry(name).or_insert(ExAgg {
            role: role.to_string(),
            sets: 0.0,
            reps: 0.0,
            volume_kg: 0.0,
        });
        entry.sets += contribution.sets;
        entry.reps += contribution.reps;
        entry.volume_kg += contribution.volume_kg;
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

    let total_sets: f64 = exercises.iter().map(|e| e.sets).sum();
    let total_reps: f64 = exercises.iter().map(|e| e.reps).sum();
    let total_volume_kg: f64 = exercises.iter().map(|e| e.volume_kg).sum();
    let primary_exercises = exercises.iter().filter(|e| e.role == "primary").count() as u32;
    let secondary_exercises = exercises.iter().filter(|e| e.role == "secondary").count() as u32;

    FfiMuscleGroupDetail {
        slug: muscle_slug.to_string(),
        exercises,
        total_sets,
        total_reps,
        volume_kg: total_volume_kg,
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

    fn ffi_set(
        order: u32,
        name: &str,
        set_type: u8,
        reps: Option<u16>,
        kg: Option<f64>,
    ) -> FfiExerciseSet {
        FfiExerciseSet {
            activity_id: "act-1".to_string(),
            set_order: order,
            exercise_category: 0,
            exercise_name: None,
            display_name: name.to_string(),
            set_type,
            repetitions: reps,
            weight_kg: kg,
            duration_secs: Some(30.0),
            start_time: None,
        }
    }

    #[test]
    fn session_totals_skip_rest_sets_and_count_a_missing_rep_count_as_one() {
        let session = summarise_session(vec![
            ffi_set(0, "Squat", 2, Some(5), Some(20.0)),
            ffi_set(1, "Squat", 0, Some(10), Some(50.0)),
            ffi_set(2, "Squat", 1, None, None),
            ffi_set(3, "Squat", 0, None, Some(30.0)),
            ffi_set(4, "Press", 0, Some(8), None),
            ffi_set(5, "Squat", 0, Some(5), Some(60.0)),
        ]);
        assert_eq!(session.sets.len(), 6);
        assert_eq!(session.active_set_count, 4);
        assert_eq!(session.exercise_count, 2);
        assert_eq!(session.total_volume_kg, 500.0 + 30.0 + 0.0 + 300.0);
        assert_eq!(session.total_duration_secs, 120.0);
        let shape: Vec<(&str, usize)> = session
            .groups
            .iter()
            .map(|g| (g.name.as_str(), g.sets.len()))
            .collect();
        assert_eq!(shape, vec![("Squat", 2), ("Press", 1), ("Squat", 1)]);
    }

    #[test]
    fn a_session_of_only_rest_sets_has_no_groups() {
        let session = summarise_session(vec![ffi_set(0, "Squat", 1, None, None)]);
        assert_eq!(session.active_set_count, 0);
        assert!(session.groups.is_empty());
        assert_eq!(session.total_volume_kg, 0.0);
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

    #[test]
    fn secondary_work_has_the_same_reps_and_volume_in_every_muscle_read() {
        let mut sets: Vec<_> = (0..3).map(|i| a_set(i, 0)).collect();
        for (_, set) in &mut sets {
            set.repetitions = Some(10);
            set.weight_kg = Some(60.0);
        }
        let summary = aggregate_strength_sets(&sets);
        let deltoids = summary
            .muscle_volumes
            .iter()
            .find(|m| m.slug == "deltoids")
            .unwrap();
        assert_eq!(deltoids.weighted_sets, 1.5);
        assert_eq!(deltoids.total_reps, 15.0);
        assert_eq!(deltoids.volume_kg, 900.0);

        let exercises = exercises_by_muscle(&sets);
        let exercise = &for_muscle(&exercises, "deltoids")[0];
        assert_eq!(exercise.total_sets, 1.5);
        assert_eq!(exercise.total_reps, 15.0);
        assert_eq!(exercise.volume_kg, 900.0);

        let detail_sets: Vec<_> = sets.into_iter().map(|(_, set)| set).collect();
        let detail = aggregate_muscle_detail("deltoids", &detail_sets);
        assert_eq!(detail.total_sets, 1.5);
        assert_eq!(detail.total_reps, 15.0);
        assert_eq!(detail.volume_kg, 900.0);
    }

    #[test]
    fn a_set_without_reps_adds_no_volume() {
        let mut set = a_set(0, 0);
        set.1.repetitions = None;
        set.1.weight_kg = Some(60.0);
        let summary = aggregate_strength_sets(&[set.clone()]);
        let chest = summary
            .muscle_volumes
            .iter()
            .find(|m| m.slug == "chest")
            .unwrap();
        assert_eq!(chest.total_reps, 0.0);
        assert_eq!(chest.volume_kg, 0.0);
        assert_eq!(
            for_muscle(&exercises_by_muscle(&[set.clone()]), "chest")[0].volume_kg,
            0.0
        );
        assert_eq!(aggregate_muscle_detail("chest", &[set.1]).volume_kg, 0.0);
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
        crate::objects::observer::flush();
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
        crate::objects::observer::flush();
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
        crate::objects::observer::flush();
        set_observer(None);

        assert!(recorder.events().is_empty());
        assert!(!with_engine(|e| e.is_fit_processed("a3").unwrap()).unwrap());
    }

    /// The upload's import and the demo seed both settle an activity, and every
    /// card on it, the demo seed's own reader among them, hears nothing
    /// without the announcement.
    #[test]
    fn test_importing_fit_bytes_announces_the_verdict() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_import.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));

        // Not a FIT file, so the parse fails and nothing is committed.
        let manager = StrengthManager::new();
        let install = crate::persistence::engine_install();
        assert!(import_fit_sets_under(install, "a4", b"not a fit file").is_err());
        assert!(
            recorder.events().is_empty(),
            "a parse that committed nothing has nothing to announce"
        );

        manager
            .bulk_insert_exercise_sets("a5".to_string(), vec![])
            .expect("an empty seed still settles the activity");
        crate::objects::observer::flush();
        set_observer(None);

        assert_eq!(recorder.events(), vec!["fit_parsed:a5"]);
        assert!(
            with_engine(|e| e.is_fit_processed("a5").unwrap()).unwrap(),
            "the verdict must be committed before the announcement"
        );
    }

    fn fit_crc(bytes: &[u8]) -> u16 {
        const TABLE: [u16; 16] = [
            0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800,
            0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
        ];
        bytes.iter().fold(0u16, |crc, byte| {
            let tmp = TABLE[(crc & 0xF) as usize];
            let crc = (crc >> 4) & 0x0FFF;
            let crc = crc ^ tmp ^ TABLE[(byte & 0xF) as usize];
            let tmp = TABLE[(crc & 0xF) as usize];
            let crc = (crc >> 4) & 0x0FFF;
            crc ^ tmp ^ TABLE[((byte >> 4) & 0xF) as usize]
        })
    }

    /// A valid FIT file whose body is `data`, with both CRCs written.
    fn fit_file_of(data: &[u8]) -> Vec<u8> {
        let mut file = vec![14, 0x20];
        file.extend_from_slice(&2132u16.to_le_bytes());
        file.extend_from_slice(&(data.len() as u32).to_le_bytes());
        file.extend_from_slice(b".FIT");
        let header_crc = fit_crc(&file);
        file.extend_from_slice(&header_crc.to_le_bytes());
        file.extend_from_slice(data);
        let file_crc = fit_crc(&file);
        file.extend_from_slice(&file_crc.to_le_bytes());
        file
    }

    /// Scenario: a recording upload imports a valid FIT file that holds no set
    /// messages, or one set.
    ///
    /// Expected behaviour: either way the activity is settled and a second
    /// subscriber on it hears the verdict once.
    #[test]
    fn test_importing_a_valid_fit_file_announces_the_verdict() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("fit_import_valid.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));
        let install = crate::persistence::engine_install();

        let empty = fit_file_of(&[]);
        assert_eq!(import_fit_sets_under(install, "a6", &empty).unwrap(), 0);

        // One `Set` message (225): set_type, repetitions.
        let mut body = vec![0x40, 0, 0];
        body.extend_from_slice(&225u16.to_le_bytes());
        body.push(2);
        body.extend_from_slice(&[5, 1, 0x00, 3, 2, 0x84]);
        body.push(0);
        body.push(1);
        body.extend_from_slice(&5u16.to_le_bytes());
        assert_eq!(
            import_fit_sets_under(install, "a7", &fit_file_of(&body)).unwrap(),
            1
        );
        crate::objects::observer::flush();
        set_observer(None);

        let mut events = recorder.events();
        events.sort();
        assert_eq!(events, vec!["fit_parsed:a6", "fit_parsed:a7"]);
        assert!(with_engine(|e| e.is_fit_processed("a6").unwrap()).unwrap());
        assert!(with_engine(|e| e.is_fit_processed("a7").unwrap()).unwrap());
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
            total_reps: 0.0,
            volume_kg: 0.0,
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

    /// Scenario: the HRV and efficiency insights take their distance from
    /// `crate::signal::signal_delta`, and strength progression computed its own
    /// copy in TypeScript, so a change to the rule moved two categories and not
    /// the third.
    ///
    /// Expected behaviour: the progression carries the engine's reading, taken
    /// over the rounded weeks and the rounded averages it already reports.
    #[test]
    fn test_a_progression_carries_the_engine_signal_delta() {
        let weekly = vec![
            summary(vec![volume("biceps", 2.0)]),
            summary(vec![volume("biceps", 3.0)]),
            summary(vec![volume("biceps", 5.0)]),
            summary(vec![volume("biceps", 6.0)]),
        ];
        let monthly = summary(vec![volume("biceps", 16.0)]);

        let progressions = strength_progressions(&monthly, &weekly);
        let biceps = progression_for(&progressions, "biceps");

        // Weeks 2, 3, 5, 6: mean 4, population variance 2.5, so the 3-set
        // rise from 2.5 to 5.5 is 3 / sqrt(2.5) deviations.
        let expected = 3.0 / 2.5_f64.sqrt();
        let delta = biceps
            .signal_delta
            .expect("a series with spread has a reading");
        assert!(
            (delta - expected).abs() < 1e-12,
            "{delta} against {expected}"
        );
        assert_eq!(
            biceps.signal_delta,
            crate::signal::signal_delta(
                biceps.recent_average,
                biceps.baseline_average,
                &biceps.weekly_weighted_sets
            )
        );
    }

    #[test]
    fn test_a_flat_or_single_week_series_carries_no_signal_delta() {
        let flat = vec![
            summary(vec![volume("chest", 4.0)]),
            summary(vec![volume("chest", 4.0)]),
            summary(vec![volume("chest", 4.0)]),
            summary(vec![volume("chest", 4.0)]),
        ];
        let progressions = strength_progressions(&summary(vec![volume("chest", 16.0)]), &flat);
        assert_eq!(progression_for(&progressions, "chest").signal_delta, None);

        let single = vec![summary(vec![volume("hamstring", 3.0)])];
        let progressions = strength_progressions(&summary(vec![volume("hamstring", 3.0)]), &single);
        assert_eq!(
            progression_for(&progressions, "hamstring").signal_delta,
            None
        );
    }

    /// The rounded weeks are the samples, so an unrounded week does not move
    /// the reading off the figures the card shows.
    #[test]
    fn test_the_signal_delta_reads_the_rounded_weeks() {
        let weekly = vec![
            summary(vec![volume("quadriceps", 1.25)]),
            summary(vec![volume("quadriceps", 1.25)]),
            summary(vec![volume("quadriceps", 2.0)]),
            summary(vec![volume("quadriceps", 2.04)]),
        ];
        let progressions =
            strength_progressions(&summary(vec![volume("quadriceps", 6.5)]), &weekly);
        let quads = progression_for(&progressions, "quadriceps");

        assert_eq!(
            quads.signal_delta,
            crate::signal::signal_delta(2.0, 1.3, &[1.3, 1.3, 2.0, 2.0])
        );
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

        let by_muscle = exercises_by_muscle(&sets);

        let biceps = for_muscle(&by_muscle, "biceps");
        assert_eq!(biceps.len(), 1);
        assert_eq!(biceps[0].exercise_category, 7);
        assert_eq!(biceps[0].total_sets, 3.0);
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

        let by_muscle = exercises_by_muscle(&sets);
        let biceps = for_muscle(&by_muscle, "biceps");

        assert_eq!(
            biceps
                .iter()
                .map(|e| e.exercise_category)
                .collect::<Vec<_>>(),
            vec![7, 21]
        );
        assert_eq!(biceps[0].activity_count, 2);
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

        let data = strength_screen_data(&period, weekly);

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
        assert_eq!(
            progression_for(&data.progressions, "biceps").weekly_weighted_sets,
            vec![1.0, 4.0]
        );
        assert_eq!(for_muscle(&data.exercises, "biceps")[0].total_sets, 4.0);
    }
}

#[cfg(test)]
#[path = "tests/strength_auth.rs"]
mod auth_tests;

#[cfg(test)]
#[path = "tests/strength_pooled.rs"]
mod pooled_tests;
