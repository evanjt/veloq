use super::error::{VeloqError, with_engine, with_reader};
use std::sync::Arc;

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

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

    /// Weekly training totals over a range, one entry per Monday-anchored
    /// week that has activities. Derived from `activity_metrics` rather than
    /// fetched, so there is no athlete-summary endpoint to keep in sync.
    ///
    /// `week_starts` are supplied by the caller because week boundaries are a
    /// local-calendar question, and Rust has no view of the device timezone.
    fn get_weekly_summaries(
        &self,
        week_starts: Vec<f64>,
        week_length_secs: f64,
    ) -> Result<Vec<crate::FfiWeeklySummary>, VeloqError> {
        let week_starts = week_starts
            .into_iter()
            .map(crate::ffi_types::int_from_wire)
            .collect::<Vec<_>>();
        let week_length_secs = crate::ffi_types::int_from_wire(week_length_secs);
        with_reader(|conn| {
            crate::persistence::fitness::derivations::pooled::weekly_summaries(
                conn,
                &week_starts,
                week_length_secs,
            )
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
        days: f64,
    ) -> Result<Option<crate::persistence::curves::FfiPowerCurve>, VeloqError> {
        let days = crate::ffi_types::int_from_wire(days);
        let (_, curve) = with_reader(|conn| {
            crate::persistence::curves::pooled::power_curve(conn, &sport, days).map_err(|err| {
                VeloqError::Database {
                    msg: err.to_string(),
                }
            })
        })??;
        Ok(curve)
    }

    /// Everything the Best Efforts screen paints with over the last `days`
    /// days, or all time when `days` is 0. Off the engine lock, since it reads
    /// only committed rows.
    fn get_best_efforts_data(&self, days: f64) -> Result<crate::FfiBestEffortsData, VeloqError> {
        let days = crate::ffi_types::int_from_wire(days);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        with_reader(|conn| {
            crate::persistence::screens::pooled::best_efforts_data(conn, days, now).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
            })
        })?
    }

    /// A stored pace curve, parsed, keyed by sport, window and the gap flag,
    /// with the time it was fetched.
    fn get_pace_curve(
        &self,
        sport: String,
        days: f64,
        gap: bool,
    ) -> Result<Option<crate::persistence::curves::FfiPaceCurve>, VeloqError> {
        let days = crate::ffi_types::int_from_wire(days);
        let (_, curve) = with_reader(|conn| {
            crate::persistence::curves::pooled::pace_curve(conn, &sport, days, gap).map_err(|err| {
                VeloqError::Database {
                    msg: err.to_string(),
                }
            })
        })??;
        Ok(curve)
    }

    /// An activity's stored interval body, or `None` if never fetched.
    fn get_interval_body(&self, activity_id: String) -> Result<Option<String>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::bodies::pooled::interval_body(conn, &activity_id).map_err(|err| {
                VeloqError::Database {
                    msg: format!("{}", err),
                }
            })
        })?
    }

    /// Calendar event bodies over an inclusive window, oldest first.
    fn get_calendar_event_bodies(
        &self,
        oldest_ts: f64,
        newest_ts: f64,
    ) -> Result<Vec<String>, VeloqError> {
        let oldest_ts = crate::ffi_types::int_from_wire(oldest_ts);
        let newest_ts = crate::ffi_types::int_from_wire(newest_ts);
        with_reader(|conn| {
            crate::persistence::bodies::pooled::calendar_event_bodies(conn, oldest_ts, newest_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    fn get_zone_distribution(
        &self,
        sport_type: String,
        zone_type: String,
        start_ts: f64,
        end_ts: f64,
    ) -> Result<crate::FfiZoneDistribution, VeloqError> {
        let start_ts = crate::ffi_types::int_from_wire(start_ts);
        let end_ts = crate::ffi_types::int_from_wire(end_ts);
        with_reader(|conn| {
            crate::persistence::fitness::derivations::pooled::zone_distribution_named(
                conn,
                &sport_type,
                &zone_type,
                start_ts,
                end_ts,
            )
        })
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
        date: f64,
        window_days: f64,
    ) -> Result<(), VeloqError> {
        let date = crate::ffi_types::int_from_wire(date);
        let window_days = crate::ffi_types::int_from_wire(window_days);
        with_engine(|e| {
            e.save_pace_snapshot(&sport_type, critical_speed, d_prime, r2, date, window_days);
        })
    }

    /// Everything the fitness tab paints with that stays fixed while it is
    /// mounted: the cycling eFTP trend over the chart's three months with the
    /// activities that moved it, and the last stored running and swimming
    /// critical speeds. Off the engine lock, since it reads only committed
    /// rows. Stale when the `activities` event fires.
    fn get_fitness_screen_data(&self) -> Result<crate::FfiFitnessScreenData, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::pooled::fitness_screen_data(
                conn,
                &crate::persistence::wellness::today_iso(),
            )
        })
    }

    fn get_available_sport_types(&self) -> Result<Vec<String>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::fitness::derivations::pooled::try_available_sport_types(conn)
                .unwrap_or_default()
        })
    }

    /// Everything the training tab paints with that stays fixed while it is
    /// mounted, over the windows it draws. Off the engine lock, since it reads
    /// only committed rows. Stale when the `activities` event fires.
    fn get_training_screen_data(
        &self,
        windows: crate::FfiTrainingScreenWindows,
    ) -> Result<crate::FfiTrainingScreenData, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::pooled::training_screen_data(conn, &windows).map_err(
                |err| VeloqError::Database {
                    msg: format!("{}", err),
                },
            )
        })?
    }

    fn get_summary_card_data(
        &self,
        current_start: f64,
        current_end: f64,
        prev_start: f64,
        prev_end: f64,
    ) -> Result<crate::FfiSummaryCardData, VeloqError> {
        let current_start = crate::ffi_types::int_from_wire(current_start);
        let current_end = crate::ffi_types::int_from_wire(current_end);
        let prev_start = crate::ffi_types::int_from_wire(prev_start);
        let prev_end = crate::ffi_types::int_from_wire(prev_end);
        with_reader(|conn| {
            crate::persistence::screens::pooled::summary_card(
                conn,
                current_start,
                current_end,
                prev_start,
                prev_end,
            )
        })
    }

    /// Aggregated totals for one date window: count, duration, distance, TSS.
    fn get_period_stats(
        &self,
        start_ts: f64,
        end_ts: f64,
    ) -> Result<crate::FfiPeriodStats, VeloqError> {
        let start_ts = crate::ffi_types::int_from_wire(start_ts);
        let end_ts = crate::ffi_types::int_from_wire(end_ts);
        with_reader(|conn| {
            crate::persistence::fitness::derivations::pooled::period_stats(conn, start_ts, end_ts)
        })
    }

    /// Recorded activity load per local day over an inclusive window of
    /// wall-clock timestamps, oldest first. A day with activities and no load
    /// reads `Unavailable`, one with only some `Partial`; days with no
    /// activities are absent.
    fn get_daily_activity_loads(
        &self,
        start_ts: f64,
        end_ts: f64,
    ) -> Result<Vec<crate::FfiDayLoad>, VeloqError> {
        let start_ts = crate::ffi_types::int_from_wire(start_ts);
        let end_ts = crate::ffi_types::int_from_wire(end_ts);
        with_reader(|conn| {
            crate::persistence::fitness::derivations::pooled::daily_activity_loads(
                conn, start_ts, end_ts,
            )
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
        with_reader(|conn| {
            crate::persistence::wellness::pooled::wellness_days(conn, &oldest, &newest).map_err(
                |err| VeloqError::Database {
                    msg: format!("{}", err),
                },
            )
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
        with_reader(|conn| {
            crate::persistence::wellness::pooled::sparklines_to(
                conn,
                days,
                &crate::persistence::wellness::today_iso(),
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("{}", err),
            })
        })?
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
        let now = unix_now();
        with_reader(|conn| {
            crate::persistence::screens::pooled::startup_data(
                conn,
                params.current_start as i64,
                params.current_end as i64,
                params.prev_start as i64,
                params.prev_end as i64,
                &preview_activity_ids,
                now,
            )
        })
    }

    /// Tell the engine the feed opened, closed or had rings dismissed. It
    /// writes one settings row and decides every ring the next
    /// `get_startup_data` returns.
    fn record_feed_seen(&self, event: crate::FfiFeedSeen) -> Result<(), VeloqError> {
        let now = unix_now();
        with_engine(|e| {
            e.record_feed_seen(&event.into(), now)
                .map_err(|msg| VeloqError::Database { msg })
        })?
    }

    /// The home-screen widget snapshot, as the JSON the widgets read, composed
    /// from the engine's rows and the context the app hands over. The Android
    /// push worker composes the same file from the stored context, so there is
    /// one composer whichever process writes it.
    ///
    /// `now_seconds` stamps the snapshot and `now_wall_seconds` is the same
    /// moment on the zoneless wall clock activity dates are recorded in, which
    /// is what the week bounds and the relative dates are judged on.
    fn compose_widget_snapshot(
        &self,
        context_json: String,
        now_seconds: f64,
        now_wall_seconds: f64,
    ) -> Result<String, VeloqError> {
        let now_seconds = crate::ffi_types::int_from_wire(now_seconds);
        let now_wall_seconds = crate::ffi_types::int_from_wire(now_wall_seconds);
        let ctx: crate::widget_snapshot::WidgetContext = serde_json::from_str(&context_json)
            .map_err(|e| VeloqError::Database {
                msg: format!("widget context: {e}"),
            })?;
        let clock = crate::widget_snapshot::Clock {
            now_seconds,
            now_wall_seconds,
        };
        // Off the engine lock: every read behind this is committed rows. The
        // writer runs on every background transition and every settled sync,
        // which is exactly when the lock is held by the sync itself.
        with_reader(|conn| crate::widget_snapshot::snapshot_json(conn, &ctx, clock))
    }

    /// Store the widget context, so a push handler with no JavaScript can
    /// compose the snapshot the app would. Answers whether anything was
    /// written. A context that does not parse is refused rather than stored.
    ///
    /// The app hands it over on every refresh, so the comparison is read off
    /// the pool first and the engine lock is taken only for a context that
    /// changed, which is a locale, a unit or a setting and not a sync.
    fn set_widget_context(&self, context_json: String) -> Result<bool, VeloqError> {
        serde_json::from_str::<crate::widget_snapshot::WidgetContext>(&context_json).map_err(
            |e| VeloqError::Database {
                msg: format!("widget context: {e}"),
            },
        )?;
        let held = with_reader(|conn| {
            crate::persistence::settings::setting_from(
                conn,
                crate::persistence::settings::settings_keys::WIDGET_CONTEXT,
            )
            .ok()
            .flatten()
        })?;
        if held.as_deref() == Some(context_json.as_str()) {
            return Ok(false);
        }
        with_engine(|e| {
            e.set_widget_context(&context_json)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{e}"),
                })
        })?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scenario: the athlete opens the app and the feed asks for its first
    /// paint while a sync page commits.
    ///
    /// Expected behaviour: the summary card and the preview tracks come back
    /// without waiting for the writer, because the feed reads through the pool
    /// and never asks for the engine lock the writer is holding.
    #[test]
    fn the_feed_first_paint_does_not_wait_for_a_writer() {
        use crate::test_globals::{init_global_engine, serial_global_state};
        let _guard = serial_global_state();
        let _tmp = init_global_engine("feed_under_a_writer.db");
        let fitness = FitnessManager::new();
        let now = 1_700_200_000i64;
        crate::with_persistent_engine(|engine| {
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: "a1".into(),
                    name: "Ride".into(),
                    date: now - 86_400,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("activity metrics");
        });

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
            efficiency_min_hr_change_bpm: 1,
            efficiency_limit: 2,
            efficiency_min_efforts: 3,
            efficiency_declining_min_efforts: 5,
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
            stale_min_traversals: 1,
            recent_pr_window_days: 7,
            recent_pr_min_outings: 3,
        };

        let feed = crate::test_globals::read_while_writer_holds(|| {
            fitness
                .get_startup_data(params, vec!["a1".to_string()])
                .expect("the feed reads while a writer holds the engine")
        });

        assert_eq!(feed.summary_card.current_week.count, 1);
        let direct = fitness
            .get_summary_card_data(
                (now - 7 * 86_400) as f64,
                now as f64,
                (now - 14 * 86_400) as f64,
                (now - 7 * 86_400) as f64,
            )
            .expect("direct summary card");
        assert_eq!(format!("{direct:?}"), format!("{:?}", feed.summary_card));
    }

    /// Scenario: the athlete opens the insights tab while a sync page commits.
    /// The page holds the engine write lock for the length of its transaction
    /// and the whole tab used to wait it out.
    ///
    /// Expected behaviour: the read goes through the pool, so it does not
    /// wait for the writer however long it holds.
    #[test]
    fn the_insights_tab_does_not_wait_for_a_writer() {
        use crate::test_globals::{init_global_engine, serial_global_state};
        let _guard = serial_global_state();
        let _tmp = init_global_engine("insights_under_a_writer.db");
        let fitness = FitnessManager::new();

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
            efficiency_min_hr_change_bpm: 1,
            efficiency_limit: 2,
            efficiency_min_efforts: 3,
            efficiency_declining_min_efforts: 5,
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
            stale_min_traversals: 1,
            recent_pr_window_days: 7,
            recent_pr_min_outings: 3,
        };

        let insights = crate::test_globals::read_while_writer_holds(|| {
            fitness
                .get_insights_data(params)
                .expect("the tab reads while a writer holds the engine")
        });

        assert_eq!(insights.section_count, 0);
    }
}

#[cfg(test)]
#[path = "tests/fitness_interval.rs"]
mod fitness_interval_tests;

#[cfg(test)]
#[path = "tests/fitness_summary_card.rs"]
mod fitness_summary_card_tests;

#[cfg(test)]
#[path = "tests/fitness_pooled.rs"]
mod fitness_pooled_tests;
