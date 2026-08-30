use super::error::{VeloqError, with_engine};
use std::collections::HashSet;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct FitnessManager {
    pub(crate) _private: (),
}

/// Per-sport-category fitness improvement used by stale-PR detection.
struct FitnessGain {
    metric: &'static str, // "power" | "pace"
    current: f64,
    previous: f64,
    gain_percent: f64,
    unit: &'static str, // "W" | "/km" | "/100m"
}

fn cycling_gain(ftp: &crate::FfiFtpTrend, min_gain_percent: f64) -> Option<FitnessGain> {
    let cur = ftp.latest_ftp? as f64;
    let prev = ftp.previous_ftp? as f64;
    if !cur.is_finite() || !prev.is_finite() || cur <= prev || prev <= 0.0 {
        return None;
    }
    let gain = ((cur - prev) / prev) * 100.0;
    if gain < min_gain_percent {
        return None;
    }
    Some(FitnessGain {
        metric: "power",
        current: cur,
        previous: prev,
        gain_percent: (gain * 10.0).round() / 10.0,
        unit: "W",
    })
}

fn pace_gain(
    pace: &crate::FfiPaceTrend,
    min_gain_percent: f64,
    unit: &'static str,
) -> Option<FitnessGain> {
    let cur = pace.latest_pace?;
    let prev = pace.previous_pace?;
    if !cur.is_finite() || !prev.is_finite() || cur <= prev || prev <= 0.0 {
        return None;
    }
    let gain = ((cur - prev) / prev) * 100.0;
    if gain < min_gain_percent {
        return None;
    }
    Some(FitnessGain {
        metric: "pace",
        current: cur,
        previous: prev,
        gain_percent: (gain * 10.0).round() / 10.0,
        unit,
    })
}

fn gain_for_sport<'a>(
    sport: &str,
    cycling: Option<&'a FitnessGain>,
    running: Option<&'a FitnessGain>,
    swimming: Option<&'a FitnessGain>,
) -> Option<&'a FitnessGain> {
    match sport {
        "Ride" | "VirtualRide" | "MountainBikeRide" | "GravelRide" | "Handcycle" | "Velomobile" => {
            cycling
        }
        "Run" | "VirtualRun" | "TrailRun" => running,
        "Swim" | "OpenWaterSwim" => swimming,
        _ => None,
    }
}

#[uniffi::export]
impl FitnessManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Get all activity IDs that have metrics stored (GPS and non-GPS).
    fn get_activity_metric_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activity_metric_ids())
    }

    /// Weekly training totals over a range, one entry per Monday-anchored
    /// week that has activities. Derived from `activity_metrics` rather than
    /// fetched, so there is no athlete-summary endpoint to keep in sync.
    ///
    /// `week_starts` are supplied by the caller because week boundaries are a
    /// local-calendar question, and Rust has no view of the device timezone.
    fn get_weekly_summaries(
        &self,
        week_starts: Vec<i64>,
        week_length_secs: i64,
    ) -> Result<Vec<crate::FfiWeeklySummary>, VeloqError> {
        with_engine(|e| {
            week_starts
                .into_iter()
                .map(|start| {
                    let stats = e.get_period_stats(start, start + week_length_secs);
                    crate::FfiWeeklySummary {
                        week_start: start,
                        count: stats.count,
                        moving_time: stats.total_duration,
                        distance: stats.total_distance,
                        training_load: stats.total_tss,
                    }
                })
                .collect()
        })
    }

    /// A stored power curve body, or `None` when that sport and window have
    /// never been fetched. `None` means "ask for it", not "no data".
    fn get_power_curve_body(&self, sport: String, days: i64) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.get_curve_body(
                crate::persistence::bodies::CurveKind::Power,
                &sport,
                days,
                false,
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })
        })?
    }

    /// A stored pace curve body, keyed by sport, window and the gap flag.
    fn get_pace_curve_body(
        &self,
        sport: String,
        days: i64,
        gap: bool,
    ) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.get_curve_body(
                crate::persistence::bodies::CurveKind::Pace,
                &sport,
                days,
                gap,
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })
        })?
    }

    /// An activity's stored interval body, or `None` if never fetched.
    fn get_interval_body(&self, activity_id: String) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.get_interval_body(&activity_id)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Calendar event bodies over an inclusive window, oldest first.
    fn get_calendar_event_bodies(
        &self,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| {
            e.get_calendar_event_bodies(oldest_ts, newest_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    fn get_zone_distribution(
        &self,
        sport_type: String,
        zone_type: String,
    ) -> Result<Vec<f64>, VeloqError> {
        with_engine(|e| e.get_zone_distribution(&sport_type, &zone_type))
    }

    fn save_pace_snapshot(
        &self,
        sport_type: String,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.save_pace_snapshot(&sport_type, critical_speed, d_prime, r2, date);
        })
    }

    fn get_available_sport_types(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_available_sport_types())
    }

    fn get_activity_heatmap(
        &self,
        start_date: String,
        end_date: String,
    ) -> Result<Vec<crate::FfiHeatmapDay>, VeloqError> {
        with_engine(|e| e.get_activity_heatmap(&start_date, &end_date))
    }

    fn get_summary_card_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
    ) -> Result<crate::FfiSummaryCardData, VeloqError> {
        with_engine(|e| crate::FfiSummaryCardData {
            current_week: e.get_period_stats(current_start, current_end),
            prev_week: e.get_period_stats(prev_start, prev_end),
            ftp_trend: e.get_ftp_trend(),
            run_pace_trend: e.get_pace_trend("Run"),
            swim_pace_trend: e.get_pace_trend("Swim"),
        })
    }

    /// Combined patterns query: today's pattern + full pattern set in one lock.
    /// Collapses the two-call sequence in `useActivityPatterns`.
    fn get_activity_patterns_with_today(
        &self,
    ) -> Result<crate::FfiActivityPatternsBundle, VeloqError> {
        with_engine(|e| crate::FfiActivityPatternsBundle {
            today: crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics),
            all: crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics),
        })
    }

    /// Sync a batch of wellness rows from the intervals.icu API into SQLite.
    /// Idempotent on `date`; call whenever the TS wellness query refreshes.
    fn upsert_wellness(&self, rows: Vec<crate::FfiWellnessRow>) -> Result<(), VeloqError> {
        with_engine(|e| {
            let mapped: Vec<crate::persistence::wellness::WellnessRow> = rows
                .into_iter()
                .map(|r| crate::persistence::wellness::WellnessRow {
                    date: r.date,
                    ctl: r.ctl,
                    atl: r.atl,
                    ramp_rate: r.ramp_rate,
                    hrv: r.hrv,
                    resting_hr: r.resting_hr,
                    weight: r.weight,
                    sleep_secs: r.sleep_secs,
                    sleep_score: r.sleep_score,
                    soreness: r.soreness,
                    fatigue: r.fatigue,
                    stress: r.stress,
                    mood: r.mood,
                    motivation: r.motivation,
                    raw: r.raw,
                })
                .collect();
            e.upsert_wellness(&mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Untyped wellness bodies over an inclusive date window, oldest first.
    /// The wellness screens read fields the typed row does not model, so they
    /// parse these rather than a reconstruction.
    fn get_wellness_bodies(
        &self,
        oldest: String,
        newest: String,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| {
            e.get_wellness_bodies(&oldest, &newest)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Sparkline arrays (fitness/fatigue/form/hrv/rhr) over the trailing
    /// `days` window. Returns `None` until wellness has been synced at
    /// least once. Replaces the 5 parallel useMemo passes in
    /// `useSummaryCardData.ts` - TS is now a thin pass-through.
    fn get_wellness_sparklines(
        &self,
        days: u32,
    ) -> Result<Option<crate::FfiWellnessSparklines>, VeloqError> {
        with_engine(|e| {
            e.get_wellness_sparklines(days)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// HRV trend (label + averages + sparkline) over the trailing `days`
    /// window. Returns `None` when there are <5 valid HRV days. TS maps
    /// the returned label to an i18n key and renders.
    fn compute_hrv_trend(&self, days: u32) -> Result<Option<crate::FfiHrvTrend>, VeloqError> {
        with_engine(|e| {
            e.compute_hrv_trend(days)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Stale-PR opportunity detection.
    ///
    /// Pure pattern recognition: flags sections whose PR might be beatable
    /// because the user's threshold fitness (FTP for cycling, critical speed
    /// for run/swim) has improved by at least `min_gain_percent` since the
    /// PR was set, and the section hasn't been visited in `stale_threshold_days+`
    /// days. Sport-aware: cycling sections look at FTP, running at run pace,
    /// swimming at swim pace.
    ///
    /// `exclude_section_ids` is the set of section IDs already surfaced by
    /// other insights (e.g. recent section_pr cards) - we don't want to
    /// double-surface the same section in the same insights feed.
    ///
    /// Returns up to `max_opportunities` opportunities, sorted by
    /// traversal_count DESC (more-frequented sections first).
    fn find_stale_pr_opportunities(
        &self,
        stale_threshold_days: u32,
        min_gain_percent: f64,
        max_opportunities: u32,
        exclude_section_ids: Vec<String>,
    ) -> Result<Vec<crate::FfiStalePrOpportunity>, VeloqError> {
        with_engine(|e| {
            let ftp_trend = e.get_ftp_trend();
            let run_pace_trend = e.get_pace_trend("Run");
            let swim_pace_trend = e.get_pace_trend("Swim");

            let cycling = cycling_gain(&ftp_trend, min_gain_percent);
            let running = pace_gain(&run_pace_trend, min_gain_percent, "/km");
            let swimming = pace_gain(&swim_pace_trend, min_gain_percent, "/100m");

            if cycling.is_none() && running.is_none() && swimming.is_none() {
                return Vec::new();
            }

            let exclude: HashSet<String> = exclude_section_ids.into_iter().collect();
            let sport_types = e.get_available_sport_types();
            let mut opportunities: Vec<crate::FfiStalePrOpportunity> = Vec::new();

            for sport in &sport_types {
                let Some(gain) =
                    gain_for_sport(sport, cycling.as_ref(), running.as_ref(), swimming.as_ref())
                else {
                    continue;
                };

                // Relevance order is discarded below, so a cut here only hides
                // eligible sections. Ranking favours recent traversals, which is
                // the opposite of what staleness selects for.
                for section in e.get_ranked_sections(sport, u32::MAX) {
                    if exclude.contains(&section.section_id) {
                        continue;
                    }
                    if section.traversal_count == 0 || !section.best_time_secs.is_finite() {
                        continue;
                    }
                    if section.days_since_last < stale_threshold_days {
                        continue;
                    }

                    opportunities.push(crate::FfiStalePrOpportunity {
                        section_id: section.section_id,
                        section_name: section.section_name,
                        best_time_secs: section.best_time_secs,
                        traversal_count: section.traversal_count,
                        days_since_last: section.days_since_last,
                        fitness_metric: gain.metric.to_string(),
                        current_value: gain.current,
                        previous_value: gain.previous,
                        gain_percent: gain.gain_percent,
                        unit: gain.unit.to_string(),
                    });
                }
            }

            opportunities.sort_by(|a, b| b.traversal_count.cmp(&a.traversal_count));
            opportunities.truncate(max_opportunities as usize);
            opportunities
        })
    }

    /// Batch insights data: combines period stats, trends, patterns, recent PRs
    /// and the section and strength tail the pipeline used to fetch one call at
    /// a time. Reduces the Insights hook to a single round-trip.
    fn get_insights_data(
        &self,
        params: crate::FfiInsightsParams,
    ) -> Result<crate::FfiInsightsData, VeloqError> {
        with_engine(|e| e.insights_data(&params))
    }

    /// All data the feed screen needs in a single engine lock.
    /// Combines insights + summary card + GPS preview tracks + cached metric IDs.
    /// Reduces 20+ FFI calls to 1.
    fn get_startup_data(
        &self,
        params: crate::FfiInsightsParams,
        preview_activity_ids: Vec<String>,
    ) -> Result<crate::FfiStartupData, VeloqError> {
        with_engine(|e| {
            let insights = e.insights_data(&params);

            // Summary card reuses the period stats and trends just computed.
            let summary_card = crate::FfiSummaryCardData {
                current_week: insights.current_week.clone(),
                prev_week: insights.previous_week.clone(),
                ftp_trend: insights.ftp_trend.clone(),
                run_pace_trend: insights.run_pace_trend.clone(),
                swim_pace_trend: e.get_pace_trend("Swim"),
            };

            // === GPS preview tracks (simplified ~100 points via Douglas-Peucker) ===
            // Uses route signatures instead of full GPS tracks (4000+ → ~100 points)
            let preview_tracks: Vec<crate::FfiPreviewTrack> = preview_activity_ids
                .iter()
                .filter_map(|id| {
                    let sig = e.get_signature(id)?;
                    if sig.points.is_empty() {
                        return None;
                    }
                    Some(crate::FfiPreviewTrack {
                        activity_id: id.clone(),
                        encoded_coords: crate::coords::encode(&sig.points),
                    })
                })
                .collect();

            // === Cached metric IDs (for sync skip check) ===
            let cached_metric_ids = e.get_activity_metric_ids();

            crate::FfiStartupData {
                insights,
                summary_card,
                preview_tracks,
                cached_metric_ids,
            }
        })
    }

    /// Everything the home-screen widget snapshot is composed from: wellness
    /// sparklines, the summary card, and the latest activity with its record
    /// flag and GPS track. Replaces the six-call gather in the widget writer.
    fn get_widget_snapshot(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
    ) -> Result<crate::FfiWidgetSnapshotData, VeloqError> {
        with_engine(|e| {
            e.widget_snapshot_data(
                current_start,
                current_end,
                prev_start,
                prev_end,
                sparkline_days,
            )
        })
    }
}
