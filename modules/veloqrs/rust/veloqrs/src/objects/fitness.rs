use super::error::{VeloqError, with_engine, with_reader};
use crate::persistence::fitness::stale_pr;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct FitnessManager {
    pub(crate) _private: (),
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
                        week_start: start as f64,
                        count: stats.count,
                        moving_time: stats.total_duration,
                        distance: stats.total_distance,
                        training_load: stats.total_tss,
                    }
                })
                .collect()
        })
    }

    /// A stored power curve, parsed, or `None` when that sport and window have
    /// never been fetched or the body will not parse. `None` means "ask for
    /// it", not "no data".
    ///
    /// The fetch time rides along with the curve rather than answering a second
    /// call, because a curve drawn offline says nothing about its own age and
    /// the screens that draw one already make an FFI hop per mount. The parse
    /// is here rather than in TypeScript because the body is the engine's and
    /// the caller is a chart drawing a frame.
    fn get_power_curve(
        &self,
        sport: String,
        days: i64,
    ) -> Result<Option<crate::persistence::curves::FfiPowerCurve>, VeloqError> {
        let stored = with_engine(|e| {
            e.get_stored_curve(
                crate::persistence::bodies::CurveKind::Power,
                &sport,
                days,
                false,
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })
        })??;
        Ok(stored.and_then(|c| {
            crate::persistence::curves::parse_power_curve(&c.raw, &sport, c.fetched_at as i64)
        }))
    }

    /// A stored pace curve, parsed, keyed by sport, window and the gap flag,
    /// with the time it was fetched.
    fn get_pace_curve(
        &self,
        sport: String,
        days: i64,
        gap: bool,
    ) -> Result<Option<crate::persistence::curves::FfiPaceCurve>, VeloqError> {
        let stored = with_engine(|e| {
            e.get_stored_curve(
                crate::persistence::bodies::CurveKind::Pace,
                &sport,
                days,
                gap,
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })
        })??;
        Ok(stored.and_then(|c| {
            crate::persistence::curves::parse_pace_curve(&c.raw, &sport, c.fetched_at as i64)
        }))
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

    /// Record one critical-speed snapshot under the window it was read over.
    ///
    /// `window_days` is the range the curve behind it covered. It is part of
    /// the key and the trend compares one window only, so a screen showing the
    /// year range no longer overwrites, or is compared with, the sync's
    /// six-week reading.
    fn save_pace_snapshot(
        &self,
        sport_type: String,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
        window_days: i64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.save_pace_snapshot(&sport_type, critical_speed, d_prime, r2, date, window_days);
        })
    }

    /// The activities that moved the accepted eFTP, oldest first. The markers
    /// the fitness plot draws, derived where the sync stores them rather than
    /// from a parsed body per activity on every render.
    fn get_eftp_changes(&self) -> Result<Vec<crate::FfiEftpChange>, VeloqError> {
        with_engine(|e| e.eftp_changes())
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
            wellness: e.wellness_summary(),
            current_week: e.get_period_stats(current_start, current_end),
            prev_week: e.get_period_stats(prev_start, prev_end),
            ftp_trend: e.get_ftp_trend(),
            run_pace_trend: e.get_pace_trend("Run"),
            swim_pace_trend: e.get_pace_trend("Swim"),
        })
    }

    /// Aggregated totals for one date window: count, duration, distance, TSS.
    fn get_period_stats(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<crate::FfiPeriodStats, VeloqError> {
        with_engine(|e| e.get_period_stats(start_ts, end_ts))
    }

    /// A window's totals grouped by calendar month, oldest first. Months with
    /// no activity are absent rather than zero.
    fn get_monthly_stats(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<Vec<crate::FfiMonthlyStats>, VeloqError> {
        with_engine(|e| e.get_monthly_stats(start_ts, end_ts))
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
                    sleep_secs: r.sleep_secs.map(|v| v as i64),
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

    /// Stored wellness days over an inclusive date window, oldest first.
    /// Typed: every field the wellness and fitness screens render, so nothing
    /// parses a body to draw a chart.
    fn get_wellness_days(
        &self,
        oldest: String,
        newest: String,
    ) -> Result<Vec<crate::FfiWellnessDay>, VeloqError> {
        with_engine(|e| {
            e.get_wellness_days(&oldest, &newest)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// The newest stored wellness date, or `None` when nothing has synced.
    /// A scalar the insights panel dates its dropped form cards from, so the
    /// rows themselves never cross the FFI to be quoted as today's figures.
    fn get_wellness_latest_date(&self) -> Result<Option<String>, VeloqError> {
        // Off the engine lock: one committed scalar, read while a sync may
        // well be holding the writer.
        with_reader(|conn| {
            crate::persistence::wellness::pooled::latest_date(conn).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
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
            let exclude: HashSet<String> = exclude_section_ids.into_iter().collect();
            let sport_types = e.get_available_sport_types();

            stale_pr::opportunities(
                &stale_pr::StalePrTrends {
                    ftp: &ftp_trend,
                    run_pace: &run_pace_trend,
                    swim_pace: &swim_pace_trend,
                },
                &sport_types,
                &stale_pr::StalePrRequest {
                    stale_threshold_days,
                    min_gain_percent,
                    max_opportunities,
                    exclude_section_ids: &exclude,
                },
                |sport| e.get_stale_ranked_sections(sport, stale_threshold_days),
                |sport, at| e.fitness_on(sport, at),
            )
        })
    }

    /// Batch insights data: combines period stats, trends, patterns, recent PRs
    /// and the section and strength tail. Reduces the Insights hook to a single
    /// round-trip.
    ///
    /// Read through the pool, so opening the tab while a sync page commits does
    /// not wait out the write. What the engine path answers from memory is the
    /// activity patterns and the section list, and both are loaded from the
    /// rows this reads. The metrics load that replaces the memory tier is
    /// 2.5 ms on a 1,598-activity library against a 100 ms mount budget
    /// (`tests/insights_pool_cost.rs`).
    fn get_insights_data(
        &self,
        params: crate::FfiInsightsParams,
    ) -> Result<crate::FfiInsightsData, VeloqError> {
        with_reader(|conn| crate::persistence::screens::pooled::insights_data(conn, &params))
    }

    /// The feed's first paint in a single engine lock: the summary card and
    /// the GPS preview tracks. `params` supplies the summary card's two week
    /// windows; the rest of the insights bundle is fetched by the insights tab
    /// when it opens, not here.
    fn get_startup_data(
        &self,
        params: crate::FfiInsightsParams,
        preview_activity_ids: Vec<String>,
    ) -> Result<crate::FfiStartupData, VeloqError> {
        // Off the engine lock: the feed's first paint is committed rows and
        // nothing the engine holds in memory, so a sync page mid-transaction
        // does not hold the first screen the athlete sees.
        with_reader(|conn| {
            crate::persistence::screens::pooled::startup_data(
                conn,
                params.current_start as i64,
                params.current_end as i64,
                params.prev_start as i64,
                params.prev_end as i64,
                &preview_activity_ids,
            )
        })
    }

    /// Everything the home-screen widget snapshot is composed from: wellness
    /// sparklines, the summary card, and the latest activity with its record
    /// flag and GPS track, strided to `max_gps_points`. Replaces the six-call
    /// gather in the widget writer. Zero means the whole track.
    fn get_widget_snapshot(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
        max_gps_points: u32,
    ) -> Result<crate::FfiWidgetSnapshotData, VeloqError> {
        // Off the engine lock: every read behind this is committed rows. The
        // writer runs on every background transition and every settled sync,
        // which is exactly when the lock is held by the sync itself.
        with_reader(|conn| {
            crate::persistence::screens::pooled::widget_snapshot_data(
                conn,
                current_start,
                current_end,
                prev_start,
                prev_end,
                sparkline_days,
                max_gps_points,
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scenario: the athlete opens the app and the feed asks for its first
    /// paint while a sync page commits.
    ///
    /// Expected behaviour: the summary card and the preview tracks come back
    /// inside a frame, because the feed reads through the pool and never asks
    /// for the engine lock the writer is holding.
    #[test]
    fn the_feed_first_paint_does_not_wait_for_a_writer() {
        use crate::test_globals::{init_global_engine, serial_global_state};
        use std::sync::Arc as StdArc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};

        /// One 60 Hz frame.
        const FRAME_BUDGET: Duration = Duration::from_millis(16);
        /// Long enough that a wait cannot be read as scheduling noise.
        const WRITE_HOLD: Duration = Duration::from_millis(200);

        let _guard = serial_global_state();
        let _tmp = init_global_engine("feed_under_a_writer.db");
        let fitness = FitnessManager::new();

        let holding = StdArc::new(AtomicBool::new(false));
        let signal = StdArc::clone(&holding);
        let writer = std::thread::spawn(move || {
            crate::with_persistent_engine(|_| {
                signal.store(true, Ordering::SeqCst);
                std::thread::sleep(WRITE_HOLD);
            });
        });
        while !holding.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }

        let now = 1_700_200_000;
        let params = crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: false,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_limit: 2,
            efficiency_min_efforts: 3,
            strength_month: crate::FfiTimestampRange {
                start_ts: (now - 28 * 86_400) as f64,
                end_ts: now as f64,
            },
            strength_weeks: vec![crate::FfiTimestampRange {
                start_ts: (now - 7 * 86_400) as f64,
                end_ts: now as f64,
            }],
            wellness_oldest: "2026-01-01".to_string(),
            wellness_newest: "2026-12-31".to_string(),
            hrv_window_days: 7,
            section_change_window_days: 14,
            stale_threshold_days: 30,
            stale_min_gain_percent: 3.0,
            stale_max_opportunities: 3,
        };

        let started = Instant::now();
        let feed = fitness
            .get_startup_data(params, vec!["a1".to_string()])
            .expect("the feed reads while a writer holds the engine");
        let waited = started.elapsed();

        assert_eq!(feed.summary_card.current_week.count, 0);
        assert!(
            waited < FRAME_BUDGET,
            "the feed's first paint waited {waited:?} behind a writer, which is over a frame"
        );

        writer.join().expect("writer");
    }

    /// Scenario: the athlete opens the insights tab while a sync page commits.
    /// The page holds the engine write lock for the length of its transaction
    /// and the whole tab used to wait it out.
    ///
    /// Expected behaviour: the read goes through the pool, so it is inside a
    /// frame however long the writer holds. The metrics load that replaces the
    /// memory tier is 2.5 ms on a 1,598-activity library, so the budget here is
    /// the lock and not the query.
    #[test]
    fn the_insights_tab_does_not_wait_for_a_writer() {
        use crate::test_globals::{init_global_engine, serial_global_state};
        use std::sync::Arc as StdArc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};

        /// One 60 Hz frame.
        const FRAME_BUDGET: Duration = Duration::from_millis(16);
        /// Long enough that a wait cannot be read as scheduling noise.
        const WRITE_HOLD: Duration = Duration::from_millis(200);

        let _guard = serial_global_state();
        let _tmp = init_global_engine("insights_under_a_writer.db");
        let fitness = FitnessManager::new();

        let holding = StdArc::new(AtomicBool::new(false));
        let signal = StdArc::clone(&holding);
        let writer = std::thread::spawn(move || {
            crate::with_persistent_engine(|_| {
                signal.store(true, Ordering::SeqCst);
                std::thread::sleep(WRITE_HOLD);
            });
        });
        while !holding.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }

        let now = 1_700_200_000;
        let params = crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: false,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_limit: 2,
            efficiency_min_efforts: 3,
            strength_month: crate::FfiTimestampRange {
                start_ts: (now - 28 * 86_400) as f64,
                end_ts: now as f64,
            },
            strength_weeks: vec![crate::FfiTimestampRange {
                start_ts: (now - 7 * 86_400) as f64,
                end_ts: now as f64,
            }],
            wellness_oldest: "2026-01-01".to_string(),
            wellness_newest: "2026-12-31".to_string(),
            hrv_window_days: 7,
            section_change_window_days: 14,
            stale_threshold_days: 30,
            stale_min_gain_percent: 3.0,
            stale_max_opportunities: 3,
        };

        let started = Instant::now();
        let insights = fitness
            .get_insights_data(params)
            .expect("the tab reads while a writer holds the engine");
        let waited = started.elapsed();

        assert_eq!(insights.section_count, 0);
        assert!(
            waited < FRAME_BUDGET,
            "the insights tab waited {waited:?} behind a writer, which is over a frame"
        );

        writer.join().expect("writer");
    }
}
