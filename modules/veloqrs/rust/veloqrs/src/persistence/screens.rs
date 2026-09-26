//! Per-screen data bundles.
//!
//! One method per rendered surface, each composing the reads that screen used
//! to make one at a time. Living on `PersistentEngine` keeps the FFI
//! objects thin and lets tests compare a bundle against the individual calls
//! it replaces without standing up the global engine.

use crate::objects::strength::{aggregate_strength_sets, strength_progressions};
use crate::sections::SectionType;
use log::warn;

/// The window the feed card's sparklines cover. The card draws a month and
/// nothing else asks for a different one, so it is a constant here rather
/// than a parameter on the read.
const FEED_SPARKLINE_DAYS: u32 = 30;

/// Every `stride`-th point of a track, plus the last one, so the result is at
/// most `max_points` plus one.
///
/// The same rule the widget's own projection uses, so striding here leaves that
/// pass an identity rather than changing the outline it draws. `max_points` of
/// zero means the whole track, which is what a caller that wants no cap asks
/// for.
fn stride_track(points: Vec<crate::GpsPoint>, max_points: u32) -> Vec<crate::FfiGpsPoint> {
    strided(&points, max_points as usize)
        .into_iter()
        .map(crate::FfiGpsPoint::from)
        .collect()
}

/// The rule itself, over the points rather than the FFI record, so the section
/// thumbnail below draws the same outline as the widget.
fn strided(points: &[crate::GpsPoint], max_points: usize) -> Vec<crate::GpsPoint> {
    if max_points == 0 || points.len() <= max_points {
        return points.to_vec();
    }
    let stride = points.len().div_ceil(max_points).max(1);
    let last = points.len() - 1;
    let mut out: Vec<crate::GpsPoint> = points.iter().step_by(stride).cloned().collect();
    // The end of the ride is the part of the shape a stride is most likely to
    // drop, and the outline closes on it.
    if last % stride != 0 {
        out.push(points[last].clone());
    }
    out
}

/// The weeks the chronic window is read as. The window itself is whatever the
/// caller asked for, and the average is this divisor regardless, which is how
/// the insights screen has always read it.
const CHRONIC_WEEKS: f64 = 4.0;

/// The chronic window as one week of it.
fn chronic_week_average(chronic: &crate::FfiPeriodStats) -> crate::FfiPeriodStats {
    crate::FfiPeriodStats {
        count: (chronic.count as f64 / CHRONIC_WEEKS).round() as u32,
        total_duration: chronic.total_duration / CHRONIC_WEEKS,
        total_distance: chronic.total_distance / CHRONIC_WEEKS,
        total_tss: chronic.total_tss / CHRONIC_WEEKS,
    }
}

/// The chronic window one week at a time, oldest first.
///
/// The comparison card's claim is about the last four weeks, and a total plus
/// an average cannot draw it: four weeks that fell steadily and four that
/// jumped once sum the same. The weeks are cut from the same span the total is
/// read over, so they add back up to it.
fn chronic_weeks(
    chronic_start: i64,
    chronic_end: i64,
    mut stats: impl FnMut(i64, i64) -> crate::FfiPeriodStats,
) -> Vec<crate::FfiPeriodStats> {
    let weeks = CHRONIC_WEEKS as i64;
    let span = chronic_end - chronic_start;
    if span <= 0 || weeks <= 0 {
        return Vec::new();
    }
    let step = span / weeks;
    if step <= 0 {
        return Vec::new();
    }
    (0..weeks)
        .map(|week| {
            let from = chronic_start + week * step;
            // The last week takes the remainder, so the weeks cover the whole
            // window rather than leaving a few seconds of it uncounted.
            let to = if week == weeks - 1 {
                chronic_end
            } else {
                from + step
            };
            stats(from, to)
        })
        .collect()
}

/// One period against an earlier one, on training load where both carry it and
/// on moving time where either does not.
///
/// `None` where there is nothing to divide: an earlier period at zero has no
/// ratio, and a later one at zero is a period that did not happen rather than a
/// fall of 100%.
fn period_comparison(
    current: &crate::FfiPeriodStats,
    previous: &crate::FfiPeriodStats,
) -> Option<crate::FfiPeriodComparison> {
    let metric = if previous.total_tss > 0.0 && current.total_tss > 0.0 {
        crate::FfiLoadMetric::Tss
    } else {
        crate::FfiLoadMetric::Duration
    };
    let (cur, prev) = match metric {
        crate::FfiLoadMetric::Tss => (current.total_tss, previous.total_tss),
        crate::FfiLoadMetric::Duration => (current.total_duration, previous.total_duration),
    };
    if prev <= 0.0 || cur <= 0.0 {
        return None;
    }
    Some(crate::FfiPeriodComparison {
        metric,
        current: cur,
        previous: prev,
        ratio: cur / prev - 1.0,
    })
}

/// Both comparisons the insights screen reads, from the three windows it is
/// given. Each is present when it can be taken, since which of them the screen
/// shows is the screen's own gate.
fn period_comparisons(
    current_week: &crate::FfiPeriodStats,
    previous_week: &crate::FfiPeriodStats,
    chronic_week: &crate::FfiPeriodStats,
) -> (
    Option<crate::FfiPeriodComparison>,
    Option<crate::FfiPeriodComparison>,
) {
    let week_over_week = if current_week.count > 0 {
        period_comparison(current_week, previous_week)
    } else {
        None
    };
    let week_against_chronic = if previous_week.count > 0 {
        period_comparison(previous_week, chronic_week)
    } else {
        None
    };
    (week_over_week, week_against_chronic)
}

/// A partial activity window cannot support a claim about the whole period.
fn complete_period_comparisons(
    conn: &rusqlite::Connection,
    p: &crate::FfiInsightsParams,
    current: &crate::FfiPeriodStats,
    previous: &crate::FfiPeriodStats,
    chronic: &crate::FfiPeriodStats,
) -> (
    Option<crate::FfiPeriodComparison>,
    Option<crate::FfiPeriodComparison>,
) {
    use super::activities::pooled::period_is_covered;

    let current_complete = period_is_covered(conn, p.current_start as i64, p.current_end as i64);
    let previous_complete = period_is_covered(conn, p.prev_start as i64, p.prev_end as i64);
    if !current_complete || !previous_complete {
        // The empty-current-week branch also needs proof of that emptiness.
        return (None, None);
    }
    let (weekly, chronic_comparison) = period_comparisons(current, previous, chronic);
    let chronic_complete = period_is_covered(conn, p.chronic_start as i64, p.prev_start as i64);
    (
        weekly,
        if chronic_complete {
            chronic_comparison
        } else {
            None
        },
    )
}

impl super::PersistentEngine {
    /// Everything the insights pipeline reads from the engine.
    ///
    /// Period stats, trends and patterns, plus the section and strength tail,
    /// in one call. The efficiency trends arrive already filtered and capped,
    /// so the generator renders what it is given rather than probing sections
    /// one by one.
    pub fn insights_data(&mut self, p: &crate::FfiInsightsParams) -> crate::FfiInsightsData {
        let now_ts = p.current_end;

        // Period stats (4 queries, all in one engine lock)
        let current_week = self.get_period_stats(p.current_start as i64, p.current_end as i64);
        let previous_week = self.get_period_stats(p.prev_start as i64, p.prev_end as i64);
        let chronic_period = self.get_period_stats(p.chronic_start as i64, p.prev_start as i64);
        let today_period = self.get_period_stats(p.today_start as i64, now_ts as i64);

        // Trends
        let ftp_trend = self.get_ftp_trend();
        let run_pace_trend = self.get_pace_trend("Run");

        // Activity patterns
        let all_patterns = self.activity_patterns_as_of(now_ts as i64);
        let today_pattern = crate::patterns::pattern_for_today(&all_patterns);

        // Recent PRs - loop stays in Rust, never crosses FFI
        let seven_days_ago = now_ts as i64 - 7 * 86_400;
        let mut recent_prs = Vec::new();
        let available_sports = self.get_available_sport_types();
        // One candidate per (section, sport): shared ground holds a record in
        // each sport that travels it, and neither may be measured against the
        // other's laps.
        // One read, then the fan-out in memory. Asking per sport runs the whole
        // summary query once per sport and throws away every row belonging to
        // the others, which on a fourteen-sport library is thirteen wasted
        // scans and a third of this bundle.
        let all_summaries = crate::persistence::sections::summaries_by_sport(
            &self.get_section_summaries(),
            &available_sports,
            // Outings, not passes: a PR slot is earned by returning.
            3,
        );

        let recent_visits = self.sections_visited_since(seven_days_ago);

        for (sport, s) in &all_summaries {
            // A record inside the window needs an outing inside the window, and
            // computing one section's performances costs tens of milliseconds,
            // so the junction says which sections are worth asking about before
            // any of them is computed.
            if let Some(recent) = &recent_visits
                && !recent.contains(&(s.id.clone(), sport.clone()))
            {
                continue;
            }
            let perf = self.get_section_performances_filtered(&s.id, Some(sport));
            // Prefer per-direction bests: they're computed lap-by-lap and
            // line up with what the section detail page shows. The combined
            // `best_record` is each activity's minimum lap, which can pick
            // a partial / unusually short portion (yielding implausible
            // times like "1:24" for a section that's normally ~6 minutes).
            // Take the faster of forward/reverse so we mirror what the
            // user would see as "the PR" on the section detail screen.
            let best = match (
                perf.best_forward_record.as_ref(),
                perf.best_reverse_record.as_ref(),
            ) {
                (Some(fwd), Some(rev)) => Some(if fwd.best_time <= rev.best_time {
                    fwd
                } else {
                    rev
                }),
                (Some(fwd), None) => Some(fwd),
                (None, Some(rev)) => Some(rev),
                (None, None) => perf.best_record.as_ref(),
            };
            if let Some(record) = best
                && record.activity_date >= seven_days_ago
            {
                let days_ago = crate::calendar_days_between(record.activity_date, now_ts as i64);
                // One row per section, the freshest. A section holds a record
                // in each sport that travels it, and the surface shows one.
                match recent_prs
                    .iter_mut()
                    .find(|p: &&mut crate::FfiRecentPR| p.section_id == s.id)
                {
                    // A fresher record in another sport takes the row whole.
                    // Every field below the section is that sport's, so
                    // carrying the time over on its own is what left a run
                    // record reading against the rides.
                    Some(held) if days_ago < held.days_ago => {
                        held.best_time = record.best_time;
                        held.days_ago = days_ago;
                        held.sport_type = sport.clone();
                        held.traversal_count = perf.records.iter().map(|r| r.lap_count).sum();
                        held.recent_efforts =
                            series_tail(perf.records.iter(), p.history_limit, |r| {
                                (r.best_time, r.activity_date as f64)
                            });
                    }
                    Some(_) => {}
                    None => recent_prs.push(crate::FfiRecentPR {
                        section_id: s.id.clone(),
                        section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                        best_time: record.best_time,
                        days_ago,
                        sport_type: sport.clone(),
                        // This sport's passes, not the section's. `perf` is
                        // already filtered to the sport the record was set
                        // in, and every record carries its laps.
                        traversal_count: perf.records.iter().map(|r| r.lap_count).sum(),
                        // `perf.records` is already computed here, oldest
                        // first, to find the record above. The card draws the
                        // tail of it rather than the sheet reading the whole
                        // bundle back per open.
                        recent_efforts: series_tail(perf.records.iter(), p.history_limit, |r| {
                            (r.best_time, r.activity_date as f64)
                        }),
                        // Filled below, from one query over the rows that
                        // earned a slot rather than a read per pair the loop
                        // meets.
                        encoded_polyline: Vec::new(),
                    }),
                }
            }
        }

        // The card draws the section it names, so each row carries the line.
        // One query over the rows that earned a slot, after the loop, because
        // the loop meets every (section, sport) pair and keeps one row each.
        {
            let ids: Vec<&str> = recent_prs.iter().map(|pr| pr.section_id.as_str()).collect();
            let mut lines = self.get_section_polylines_batch(&ids);
            for pr in &mut recent_prs {
                if let Some(encoded) = lines.remove(&pr.section_id) {
                    pr.encoded_polyline = preview_line(&crate::coords::decode(&encoded));
                }
            }
        }

        // Sport types follow the observed patterns, falling back to whatever
        // the engine holds when no pattern has emerged yet.
        let mut sport_types: Vec<String> = Vec::new();
        for pattern in &all_patterns {
            if !sport_types.contains(&pattern.sport_type) {
                sport_types.push(pattern.sport_type.clone());
            }
        }
        if sport_types.is_empty() {
            sport_types = available_sports;
        }

        let section_count = self.get_section_count();
        let sections_ready = p.include_sections && section_count > 0;

        // One read for every sport, then one ranking per sport. The ranking is
        // within a sport and stays there; the scan it used to repeat per sport
        // grew with the number of sports rather than with the sections.
        let ranked_sections: Vec<crate::FfiRankedSectionsBySport> = if sections_ready {
            self.get_ranked_sections_by_sports(&sport_types, p.ranked_limit)
        } else {
            Vec::new()
        };

        // Efficiency candidates: the most recently visited ranked sections.
        // A trend on a section untouched for months is a curiosity, not an
        // insight, so anything outside the active window is dropped.
        let mut candidate_ids: Vec<String> = Vec::new();
        for batch in &ranked_sections {
            let recent = batch
                .sections
                .iter()
                .filter(|rs| rs.days_since_last <= p.active_window_days)
                .take(p.efficiency_per_sport as usize);
            for rs in recent {
                if !candidate_ids.contains(&rs.section_id) {
                    candidate_ids.push(rs.section_id.clone());
                }
            }
        }

        let mut efficiency_trends: Vec<crate::FfiEfficiencyTrend> = Vec::new();
        for section_id in &candidate_ids {
            if efficiency_trends.len() >= p.efficiency_limit as usize {
                break;
            }
            let Some(trend) = self.get_section_efficiency_trend(section_id) else {
                continue;
            };
            if !trend.is_improving || trend.effort_count < p.efficiency_min_efforts {
                continue;
            }
            // Matches the rounding the generator applied: a sub-1bpm change
            // reads as noise rather than adaptation.
            if (trend.hr_change_bpm + 0.5).floor().abs() < 1.0 {
                continue;
            }
            efficiency_trends.push(trend);
        }

        let has_strength_data = self.get_strength_activity_count().unwrap_or(0) > 0;
        let strength_series = if has_strength_data {
            self.strength_insight_series(&p.strength_month, &p.strength_weeks)
        } else {
            None
        };

        let chronic_week_average = chronic_week_average(&chronic_period);
        let chronic_weeks =
            chronic_weeks(p.chronic_start as i64, p.prev_start as i64, |from, to| {
                self.get_period_stats(from, to)
            });
        let (week_over_week, week_against_chronic) = complete_period_comparisons(
            &self.db,
            p,
            &current_week,
            &previous_week,
            &chronic_week_average,
        );

        let form = crate::persistence::wellness::pooled::latest_form(
            &self.db,
            &p.wellness_oldest,
            &p.wellness_newest,
        );

        // The three tails the insights screen used to reach back for, one
        // engine call each, on top of the heaviest read in the tree.
        //
        // The stale-PR exclusion looked like a caller's argument and was not.
        // The screen passed the sections already carrying a `section_pr-`
        // insight, which come only from `recent_prs`, and this bundle has just
        // built those. Taken here it is the whole list rather than the three
        // the screen surfaces, so a section that set a record and did not make
        // the cut is still not offered as stale. That is the rule the exclusion
        // was always for, stated where the data is.
        let hrv_trend = self.compute_hrv_trend(p.hrv_window_days).unwrap_or(None);
        let recent_section_changes = self
            .recent_section_changes(p.section_change_window_days)
            .into_iter()
            .map(|c| crate::FfiSectionChange {
                section_id: c.section_id,
                kind: c.kind,
                at: c.at,
            })
            .collect();
        let exclude: std::collections::HashSet<String> =
            recent_prs.iter().map(|pr| pr.section_id.clone()).collect();
        let swim_pace_trend = self.get_pace_trend("Swim");
        let stale_pr_opportunities = crate::persistence::fitness::stale_pr::opportunities(
            &crate::persistence::fitness::stale_pr::StalePrTrends {
                ftp: &ftp_trend,
                run_pace: &run_pace_trend,
                swim_pace: &swim_pace_trend,
            },
            &sport_types,
            &crate::persistence::fitness::stale_pr::StalePrRequest {
                stale_threshold_days: p.stale_threshold_days,
                min_gain_percent: p.stale_min_gain_percent,
                max_opportunities: p.stale_max_opportunities,
                exclude_section_ids: &exclude,
            },
            |sport| self.get_stale_ranked_sections(sport, p.stale_threshold_days),
            |sport, at| {
                crate::persistence::fitness::derivations::pooled::fitness_on(&self.db, sport, at)
            },
        );

        crate::FfiInsightsData {
            current_week,
            previous_week,
            chronic_period,
            chronic_week_average,
            chronic_weeks,
            today_period,
            ftp_trend,
            run_pace_trend,
            all_patterns,
            today_pattern,
            recent_prs,
            section_count,
            sport_types,
            ranked_sections,
            efficiency_trends,
            has_strength_data,
            strength_series,
            week_over_week,
            week_against_chronic,
            form,
            hrv_trend,
            recent_section_changes,
            stale_pr_opportunities,
        }
    }

    /// The (section, sport) pairs travelled on or after `since`, or `None` when
    /// the junction cannot be read, which leaves the caller computing every
    /// section as it did before.
    fn sections_visited_since(
        &self,
        since: i64,
    ) -> Option<std::collections::HashSet<(String, String)>> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT DISTINCT sa.section_id, am.sport_type
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0 AND am.date >= ?1",
            )
            .map_err(|e| log::warn!("[screens] recent visit prepare failed: {}", e))
            .ok()?;
        let rows = stmt
            .query_map(rusqlite::params![since], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| log::warn!("[screens] recent visit query failed: {}", e))
            .ok()?;
        Some(rows.flatten().collect())
    }

    /// Strength volume over one month and a set of weeks, or `None` when a
    /// range cannot be read.
    fn strength_insight_series(
        &self,
        month: &crate::FfiTimestampRange,
        weeks: &[crate::FfiTimestampRange],
    ) -> Option<crate::FfiStrengthInsightSeries> {
        let monthly = aggregate_strength_sets(
            &self
                .get_exercise_sets_in_range(month.start_ts as i64, month.end_ts as i64)
                .ok()?,
        );
        let mut weekly = Vec::with_capacity(weeks.len());
        for range in weeks {
            let sets = self
                .get_exercise_sets_in_range(range.start_ts as i64, range.end_ts as i64)
                .ok()?;
            weekly.push(aggregate_strength_sets(&sets));
        }
        let progressions = strength_progressions(&monthly, &weekly);
        Some(crate::FfiStrengthInsightSeries {
            monthly,
            weekly,
            progressions,
        })
    }

    /// Everything the activity detail screen paints with.
    ///
    /// `min_route_activities` filters the route groups the way the screen used
    /// to filter them after the fact.
    ///
    /// Both catalogues are narrowed to this activity before they cross the
    /// FFI. The screen asks one question of the route groups, which one holds
    /// this activity, and one of the custom sections, which of them name it,
    /// so handing over the whole of either made the payload and the work grow
    /// with the library on the mount path of every activity opened. The
    /// answers are unchanged: the group is the one the screen's own search
    /// would have found, and the custom list is the same filter it re-ran
    /// against what it was already given.
    ///
    /// **The GPS track and the stored upstream bodies are deliberately not
    /// here, and this is where that is written down.** The screen reads them
    /// through `get_gps_track`, `get_activity_body`, `get_activity_bodies`,
    /// `get_interval_body` and `get_stream_body`, and it should keep doing so.
    /// A track is the largest thing an activity owns and a body is the
    /// upstream JSON whole; pulling either in here would put both on the mount
    /// path of every activity opened, which is the cost the narrowing above
    /// exists to avoid. It would also buy nothing measurable: on the S22, over
    /// eight opens of a real screen, everything the engine answers, this read
    /// and the stored track together, took 2 to 103 ms of an open that reached
    /// a usable map at 1.4 to 4.3 s. The wait is the WebView and its tiles.
    /// `get_gps_track` is read by four areas besides this one, so it is not
    /// one screen's read to fold in.
    pub fn activity_detail_data(
        &mut self,
        activity_id: &str,
        min_route_activities: u32,
    ) -> crate::FfiActivityDetailData {
        let route_groups: Vec<crate::FfiRouteGroup> = self
            .get_groups()
            .iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_route_activities)
            .find(|g| g.activity_ids.iter().any(|a| a == activity_id))
            .cloned()
            .map(crate::FfiRouteGroup::from)
            .into_iter()
            .collect();

        let matched = self.get_sections_for_activity(activity_id);
        // The dedup the screen ran: a custom section this activity traverses is
        // already in `matched_sections`, so sending it again sent it twice.
        let matched_ids: std::collections::HashSet<&str> =
            matched.iter().map(|s| s.id.as_str()).collect();
        let custom: Vec<_> = self
            .get_sections_by_type(Some(SectionType::Custom))
            .into_iter()
            .filter(|s| {
                !matched_ids.contains(s.id.as_str())
                    && (s.source_activity_id.as_deref() == Some(activity_id)
                        || s.activity_ids.iter().any(|a| a == activity_id))
            })
            .collect();

        // Trace targets mirror what the screen drew: every matched section,
        // then the custom sections naming this activity that the match list
        // did not already cover.
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut targets: Vec<(String, Vec<crate::GpsPoint>)> = Vec::new();
        for s in matched.iter().chain(custom.iter()) {
            if seen.insert(s.id.as_str()) {
                targets.push((s.id.clone(), s.polyline.clone()));
            }
        }

        let track = self.get_gps_track(activity_id).unwrap_or_default();
        let section_traces = section_traces(&track, &targets);

        // A record is held against the same sport's efforts, so the activity's
        // own sport decides which efforts it is measured against.
        let activity_sport = self.sport_of_activity(activity_id);
        let pr_section_ids: Vec<String> = targets
            .iter()
            .filter(|(section_id, _)| {
                self.get_section_performances_filtered(section_id, activity_sport.as_deref())
                    .best_record
                    .as_ref()
                    .is_some_and(|r| r.activity_id == activity_id)
            })
            .map(|(section_id, _)| section_id.clone())
            .collect();

        let ids = [activity_id.to_string()];
        crate::FfiActivityDetailData {
            activity_count: self.activity_count() as u32,
            section_count: self.get_section_count(),
            route_groups,
            matched_sections: matched.into_iter().map(Self::matched_section).collect(),
            custom_sections: custom.into_iter().map(crate::FfiSection::from).collect(),
            encounters: self.get_activity_section_encounters(activity_id),
            highlights: crate::FfiActivityHighlightsBundle {
                indicators: self.get_activity_indicators(&ids),
                route_highlights: self.get_activity_route_highlights(&ids),
            },
            section_traces,
            pr_section_ids,
        }
    }

    /// A matched section in the light record the detail screen draws from.
    ///
    /// `bounds` is the polyline's own extent rather than the catalogue's stored
    /// one, and `sport_types` is the section's own sport: the screen reads
    /// neither, and computing them here keeps the record one shape everywhere.
    fn matched_section(s: crate::sections::Section) -> crate::FfiSectionWithPolyline {
        let bounds = s
            .polyline
            .iter()
            .fold(None, |acc: Option<crate::FfiBounds>, p| {
                Some(match acc {
                    None => crate::FfiBounds {
                        min_lat: p.latitude,
                        max_lat: p.latitude,
                        min_lng: p.longitude,
                        max_lng: p.longitude,
                    },
                    Some(b) => crate::FfiBounds {
                        min_lat: b.min_lat.min(p.latitude),
                        max_lat: b.max_lat.max(p.latitude),
                        min_lng: b.min_lng.min(p.longitude),
                        max_lng: b.max_lng.max(p.longitude),
                    },
                })
            });
        crate::FfiSectionWithPolyline {
            id: s.id,
            name: s.name,
            sport_types: vec![s.sport_type.clone()],
            sport_type: s.sport_type,
            visit_count: s.visit_count,
            distance_meters: s.distance_meters,
            activity_count: s.activity_ids.len() as u32,
            confidence: s.confidence.unwrap_or(0.0),
            scale: s.scale,
            bounds,
            encoded_polyline: crate::coords::encode(&s.polyline),
            is_user_defined: s.is_user_defined,
            disabled: s.disabled,
            superseded_by: s.superseded_by,
            elevation_gain_m: s.elevation_gain_m,
            elevation_loss_m: s.elevation_loss_m,
            avg_grade_percent: s.avg_grade_percent,
            max_grade_percent: s.max_grade_percent,
            klass: s.klass,
            is_lift: s.is_lift,
            rank_score: s.rank_score,
            sport_rank_score: s.sport_rank_score,
            // The detail screen marks the encounter from the activity's own
            // indicators, so this record carries no section-level claim: only
            // the sections list asks for one, and only the paged read fills it.
            latest_is_record: false,
        }
    }

    /// Everything the section detail screen can paint before time streams land.
    ///
    /// The stream sync is asynchronous, so the reads that depend on lap times
    /// live in [`Self::section_detail_performance`] instead. This half covers
    /// the section itself, its neighbours, its activities and the stream gap
    /// the caller has to close.
    pub fn section_detail_data(
        &mut self,
        section_id: &str,
        nearby_radius_meters: f64,
    ) -> crate::FfiSectionDetailData {
        let section = self.get_section_by_id(section_id);

        let activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| s.activity_ids.clone())
            .unwrap_or_default();
        let portion_activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| {
                let mut seen = std::collections::HashSet::new();
                s.activity_portions
                    .iter()
                    .filter(|p| seen.insert(p.activity_id.clone()))
                    .map(|p| p.activity_id.clone())
                    .collect()
            })
            .unwrap_or_default();

        let activity_metrics: Vec<crate::FfiActivityMetrics> = activity_ids
            .iter()
            .filter_map(|id| self.activity_metrics.get(id).cloned())
            .map(crate::FfiActivityMetrics::from)
            .collect();

        // Read once: `get_geometry_versions` did this per call to flag the
        // pinned row, and the bundle returns the version in its own right.
        let pinned_version = self.pinned_section_version(section_id);

        crate::FfiSectionDetailData {
            activity_count: self.activity_count() as u32,
            nearby: self.get_nearby_sections(section_id, nearby_radius_meters),
            merge_candidates: self.get_merge_candidates(section_id),
            excluded_activity_ids: self.get_excluded_activity_ids(section_id),
            has_original_bounds: self.has_original_bounds(section_id),
            activity_metrics,
            map_signatures: self.get_map_signatures_for_ids(&activity_ids),
            missing_time_stream_ids: self
                .get_activities_missing_time_streams(&portion_activity_ids),
            history: self
                .section_history(section_id)
                .into_iter()
                .map(|h| crate::FfiSectionHistoryEvent {
                    id: h.id as f64,
                    at: h.at,
                    kind: h.kind,
                    details: h.details,
                    geometry_version: h.geometry_version.map(|v| v as f64),
                })
                .collect(),
            geometry_versions: self
                .section_geometry_versions(section_id)
                .into_iter()
                .map(|v| crate::FfiSectionGeometryVersion {
                    pinned: pinned_version == Some(v.version),
                    version: v.version as f64,
                    created_at: v.created_at,
                    milestone: v.milestone,
                })
                .collect(),
            pinned_version: pinned_version.map(|v| v as f64),
            excluded_laps: self
                .get_excluded_section_laps(section_id)
                .into_iter()
                .map(|(activity_id, start_index)| crate::FfiExcludedLap {
                    activity_id,
                    start_index,
                })
                .collect(),
            efficiency_trend: self.get_section_efficiency_trend(section_id),
            section: section.map(crate::FfiSection::from),
        }
    }

    /// The section detail reads that need lap times, so the caller runs this
    /// once the missing time streams have been fetched.
    ///
    /// Every read here takes the same `sport_filter`, so the calendar, the lap
    /// list and the chart describe one sport's efforts.
    pub fn section_detail_performance(
        &mut self,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        let calendar_summary = self
            .get_section_calendar_summary(section_id, sport_filter)
            .map(crate::FfiCalendarSummary::from);
        let performances = crate::FfiSectionPerformanceResult::from(
            self.get_section_performances_filtered(section_id, sport_filter),
        );
        let chart_data = self.get_section_chart_data(section_id, time_range_days, sport_filter);

        crate::FfiSectionPerformanceData {
            calendar_summary,
            performances,
            chart_data,
        }
    }

    /// Everything the route detail screen paints with.
    ///
    /// The performances come back unfiltered so the screen can build its sport
    /// pills without a second read. A sport-filtered read is only worth making
    /// once the user picks one.
    pub fn route_detail_data(
        &mut self,
        group_id: &str,
        current_activity_id: Option<&str>,
        min_group_activities: u32,
    ) -> crate::FfiRouteDetailData {
        let all_groups = self.get_groups().to_vec();
        let mut groups: Vec<crate::FfiRouteGroup> = all_groups
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_group_activities)
            .map(crate::FfiRouteGroup::from)
            .collect();
        groups.sort_by_key(|g| std::cmp::Reverse(g.activity_ids.len()));

        let group = self
            .get_group_by_id(group_id)
            .map(crate::FfiRouteGroup::from);
        let activity_ids: Vec<String> = group
            .as_ref()
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();

        let encoded_consensus = self
            .get_consensus_route(group_id)
            .map(|points| crate::coords::encode(points.as_slice()))
            .unwrap_or_default();

        crate::FfiRouteDetailData {
            activity_count: self.activity_count() as u32,
            groups,
            performances: crate::FfiRoutePerformanceResult::from(self.get_route_performances(
                group_id,
                current_activity_id,
                None,
            )),
            encoded_consensus,
            route_names: self.get_all_route_names(),
            excluded_activity_ids: self.get_excluded_route_activity_ids(group_id),
            map_signatures: self.get_map_signatures_for_ids(&activity_ids),
            section_ids: self.section_ids_for_route(group_id),
            group,
        }
    }

    /// One card's preview track, from the cached signature.
    ///
    /// The same line [`startup_data`] hands the first cards, so a card further
    /// down the feed draws from a hundred points rather than reading and
    /// boxing the four thousand of the stored track. `None` for an activity
    /// with no signature or an empty one: there is nothing to draw.
    pub fn preview_track(&mut self, activity_id: &str) -> Option<crate::FfiPreviewTrack> {
        let sig = self.get_signature(activity_id)?;
        if sig.points.is_empty() {
            return None;
        }
        Some(crate::FfiPreviewTrack {
            activity_id: activity_id.to_string(),
            encoded_coords: crate::coords::encode(&sig.points),
        })
    }

    /// The feed's first paint: the summary card and the preview tracks.
    ///
    /// Both are cheap, so this can run before the screen has anything to show.
    /// Preview tracks come from the cached route signatures rather than the
    /// full GPS track, which is a hundred points instead of four thousand.
    pub fn startup_data(
        &mut self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        preview_activity_ids: &[String],
    ) -> crate::FfiStartupData {
        // The card is the same query either side of the lock. The preview
        // lines are not: here they come through the engine's own signature
        // LRU, which a caller holding the engine is entitled to and a pooled
        // reader cannot reach.
        let summary_card =
            pooled::summary_card(&self.db, current_start, current_end, prev_start, prev_end);

        let preview_tracks = preview_activity_ids
            .iter()
            .filter_map(|id| self.preview_track(id))
            .collect();

        let sparklines = self
            .get_wellness_sparklines(FEED_SPARKLINE_DAYS)
            .ok()
            .flatten();

        crate::FfiStartupData {
            summary_card,
            preview_tracks,
            sparklines,
        }
    }

    /// Everything launch writes and reads on the engine once the library's
    /// identity is settled.
    ///
    /// Launch took five round trips through the binding for this, and every one
    /// of them is a place a sync page write can hold first paint behind the
    /// write lock. The writes go first, so the stats come back from a library
    /// already carrying them.
    ///
    /// `athlete_id` is the signed-in athlete, or `None` when launch has no
    /// credentials: the stored value is what the backup's cross-athlete guard
    /// reads, so it is left alone rather than blanked.
    /// `heatmap_tiles_path` is the path when the athlete has heatmap tiles on
    /// and `None` when they do not, and the engine's copy goes with a clear or
    /// a reopen, which is why launch sets it every time.
    pub fn launch_data(
        &mut self,
        athlete_id: Option<String>,
        heatmap_tiles_path: Option<String>,
    ) -> super::PersistentEngineStats {
        if let Some(id) = athlete_id.as_deref() {
            if let Err(e) = self.set_setting("__athlete_id", id) {
                warn!("[launch] Could not store the athlete id: {}", e);
            }
        }
        match heatmap_tiles_path {
            Some(path) => self.set_heatmap_tiles_path(path),
            None => self.clear_heatmap_tiles_path(),
        }
        self.stats()
    }

    /// Everything the home-screen widget snapshot is composed from.
    ///
    /// The latest activity is picked here rather than by handing every metric
    /// row across the boundary for the widget writer to scan.
    pub fn widget_snapshot_data(
        &mut self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
        max_gps_points: u32,
    ) -> crate::FfiWidgetSnapshotData {
        let sparklines = self.get_wellness_sparklines(sparkline_days).ok().flatten();
        // The stored figure, not one derived from the sparkline: the widget and
        // the fitness tab have to agree, and only one of them can be right about
        // a number intervals.icu already computed.
        let ramp_rate = self.latest_ramp_rate(sparkline_days);

        let summary = crate::FfiSummaryCardData {
            wellness: self.wellness_summary(),
            current_week: self.get_period_stats(current_start, current_end),
            prev_week: self.get_period_stats(prev_start, prev_end),
            ftp_trend: self.get_ftp_trend(),
            run_pace_trend: self.get_pace_trend("Run"),
            swim_pace_trend: self.get_pace_trend("Swim"),
        };

        // Strictly-greater keeps the first of any tie, matching the scan this
        // replaces.
        let mut latest: Option<crate::ActivityMetrics> = None;
        for id in self.get_activity_ids() {
            let Some(m) = self.activity_metrics.get(&id) else {
                continue;
            };
            if latest.as_ref().is_none_or(|best| m.date > best.date) {
                latest = Some(m.clone());
            }
        }

        let (latest_is_pr, latest_gps) = match latest.as_ref() {
            Some(m) => {
                let ids = [m.activity_id.clone()];
                let is_pr = pooled::holds_a_record(
                    &self.get_activity_route_highlights(&ids),
                    &self.get_activity_indicators(&ids),
                );
                // Strided here rather than in JavaScript. The widget draws 150
                // points and the writer runs on every background transition and
                // every settled sync, so the whole track crossed the boundary
                // to have 150 of it kept.
                let gps = self
                    .get_gps_track(&m.activity_id)
                    .map(|points| stride_track(points, max_gps_points))
                    .unwrap_or_default();
                (is_pr, gps)
            }
            None => (false, Vec::new()),
        };

        crate::FfiWidgetSnapshotData {
            sparklines,
            summary,
            latest: latest.map(crate::FfiActivityMetrics::from),
            latest_is_pr,
            latest_gps,
            ramp_rate,
        }
    }

    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    ///
    /// The app reads this through the pool, off the engine lock. This method
    /// is the same query on the write connection, for a caller that already
    /// holds the engine and for the tests that seed one.
    pub fn map_screen_data(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        // The write connection asks for the chips rather than taking them off
        // the read cache: a caller here may be part-way through a write, and
        // the cache only ever holds what is committed.
        let chips = pooled::available_sport_types(&self.db);
        pooled::screen_data(&self.db, start_date, end_date, sport_types, chips)
    }

    /// Activities inside a date window, optionally narrowed to a sport set.
    pub fn map_activities_filtered(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        pooled::map_activities_filtered(&self.db, start_date, end_date, sport_types)
    }
}

/// This activity's own line through each section it traversed.
///
/// Shared by the engine path and the pooled one: the arithmetic is over a track
/// and a set of polylines, and neither of those is a tier.
fn section_traces(
    track: &[crate::GpsPoint],
    targets: &[(String, Vec<crate::GpsPoint>)],
) -> Vec<crate::FfiSectionTrace> {
    if track.len() < 3 {
        return Vec::new();
    }
    targets
        .iter()
        .filter(|(_, polyline)| polyline.len() >= 2)
        .filter_map(|(section_id, polyline)| {
            let tree = tracematch::sections::build_rtree(polyline);
            let trace = tracematch::sections::extract_activity_trace(track, polyline, &tree);
            if trace.is_empty() {
                return None;
            }
            Some(crate::FfiSectionTrace {
                section_id: section_id.clone(),
                encoded_coords: crate::coords::encode(&trace),
            })
        })
        .collect()
}

/// History points a trend carries. The graphic is a strip a few dozen pixels
/// wide, and a trend's series is read whole for its own arithmetic anyway, so
/// the cap is on what crosses the bridge rather than on what is read.
pub(crate) const TREND_HISTORY_POINTS: u32 = 30;

/// The section's line as a card thumbnail draws it. The strip is 48 by 36
/// points, so a six-hundred-point consensus line is six hundred coordinates
/// crossing the FFI on the slowest screen read to paint the same forty pixels.
const PREVIEW_POINTS: usize = 64;

pub(crate) fn preview_line(points: &[crate::GpsPoint]) -> Vec<u8> {
    crate::coords::encode(&strided(points, PREVIEW_POINTS))
}

/// The tail of a series, oldest first, capped.
///
/// Every insight card draws a graphic of its own history, and the points come
/// from whatever the generator already holds: a section's laps, a trend's daily
/// estimates. Taking the tail rather than the head because a card shows the
/// run-up to now, and capping because the graphic is a strip a few dozen pixels
/// wide and the bridge is not free.
///
/// A non-finite value is left out rather than carried: the strip is drawn from
/// these and one NaN takes the whole path with it.
pub(crate) fn series_tail<T>(
    points: impl IntoIterator<Item = T>,
    limit: u32,
    mut point: impl FnMut(T) -> (f64, f64),
) -> Vec<crate::FfiSeriesPoint> {
    let mut all: Vec<crate::FfiSeriesPoint> = points
        .into_iter()
        .map(|p| {
            let (value, date) = point(p);
            crate::FfiSeriesPoint { value, date }
        })
        .filter(|p| p.value.is_finite() && p.date.is_finite())
        .collect();
    if limit == 0 {
        return Vec::new();
    }
    let keep = limit as usize;
    if all.len() > keep {
        all.drain(..all.len() - keep);
    }
    all
}

/// Screen reads that need no engine, only its database.
///
/// These take a `Connection` rather than `&PersistentEngine`, which is what
/// lets the app run them on a pooled read-only connection while a write is in
/// flight. The cost of that, and the reason each one has to be moved
/// deliberately rather than swept: a pooled connection sees committed rows
/// only, never the engine's in-memory tier and never a write still inside its
/// transaction. So each function here reads the tables the memory tier is
/// loaded from, and the engine methods above are the same query on the write
/// connection.
pub mod pooled {
    use rusqlite::Connection;

    /// Everything the map tab paints with.
    ///
    /// The chips come from the read cache, which holds them until something
    /// commits: they are a `DISTINCT` over every metrics row, asked on every
    /// read of this screen, and they change only when a sync lands.
    pub fn map_screen_data(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        let chips = crate::persistence::read_cache::sport_types(|| available_sport_types(conn));
        screen_data(conn, start_date, end_date, sport_types, chips)
    }

    /// The section detail screen's performance bundle, read from SQLite alone.
    ///
    /// Every part of it is arithmetic over one set of performances, so the
    /// engine method and this one share the same three functions and differ
    /// only in where the performances come from: the engine's LRU and memory
    /// tier on one path, a pooled connection on the other.
    pub fn section_detail_performance(
        conn: &Connection,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        let performances = crate::persistence::fitness::performances::pooled::section_performances(
            conn,
            section_id,
            sport_filter,
        );
        crate::FfiSectionPerformanceData {
            calendar_summary: crate::persistence::fitness::derivations::calendar_from(
                &performances,
            )
            .map(crate::FfiCalendarSummary::from),
            chart_data: crate::persistence::sections::chart_from(&performances, time_range_days),
            performances: crate::FfiSectionPerformanceResult::from(performances),
        }
    }

    /// Everything the home-screen widget snapshot is composed from.
    ///
    /// The widget writer runs on every background transition and every settled
    /// sync, so it used to take the engine write lock behind whatever the sync
    /// was committing. Every read here is committed rows.
    pub fn widget_snapshot_data(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        sparkline_days: u32,
        max_gps_points: u32,
    ) -> crate::FfiWidgetSnapshotData {
        use crate::persistence::wellness::pooled as wellness;

        let today = crate::persistence::wellness::today_iso();
        let latest = crate::persistence::activities::pooled::latest_metrics(conn);

        let (latest_is_pr, latest_gps) = match latest.as_ref() {
            Some(m) => {
                let ids = [m.activity_id.clone()];
                let is_pr = holds_a_record(
                    &crate::persistence::fitness::derivations::pooled::route_highlights(conn, &ids),
                    &crate::persistence::indicators::pooled::activity_indicators(conn, &ids),
                );
                let gps = crate::persistence::activities::pooled::gps_track(conn, &m.activity_id)
                    .map(|points| super::stride_track(points, max_gps_points))
                    .unwrap_or_default();
                (is_pr, gps)
            }
            None => (false, Vec::new()),
        };

        crate::FfiWidgetSnapshotData {
            sparklines: wellness::sparklines_to(conn, sparkline_days, &today)
                .ok()
                .flatten(),
            summary: summary_card(conn, current_start, current_end, prev_start, prev_end),
            latest: latest.map(crate::FfiActivityMetrics::from),
            latest_is_pr,
            ramp_rate: wellness::latest_ramp_rate_to(conn, sparkline_days, &today),
            latest_gps,
        }
    }

    /// Whether the activity holds a record, by either of the two things that
    /// say so: the route highlight computed from its group, or an indicator a
    /// detection run recorded against it.
    pub(super) fn holds_a_record(
        route_highlights: &[crate::FfiActivityRouteHighlight],
        indicators: &[crate::FfiActivityIndicator],
    ) -> bool {
        route_highlights.iter().any(|r| r.is_pr)
            || indicators
                .iter()
                .any(|i| i.indicator_type == "section_pr" || i.indicator_type == "route_pr")
    }

    /// Everything the route detail screen paints with.
    ///
    /// The groups it lists are the last saved grouping rather than one the
    /// engine would regroup on the way past: a pooled reader sees committed
    /// rows, and `route_groups` holds the previous grouping until something on
    /// the write lock asks for a regroup. That deferred-regroup staleness is
    /// accepted and announced to the athlete elsewhere, so this read inherits
    /// it rather than fixing it.
    pub fn route_detail_data(
        conn: &Connection,
        group_id: &str,
        current_activity_id: Option<&str>,
        min_group_activities: u32,
    ) -> crate::FfiRouteDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::routes::pooled as routes;

        let mut groups: Vec<crate::FfiRouteGroup> = routes::all_groups(conn)
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_group_activities)
            .map(crate::FfiRouteGroup::from)
            .collect();
        groups.sort_by_key(|g| std::cmp::Reverse(g.activity_ids.len()));

        let group = routes::group_by_id(conn, group_id);
        let activity_ids: Vec<String> = group
            .as_ref()
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();
        let excluded = routes::excluded_route_activity_ids(conn, group_id);

        let match_info = routes::match_info(conn, group_id);
        let performances = crate::persistence::fitness::performances::route_performances(
            &activity_ids,
            Some(&match_info),
            &excluded,
            |id| activities::metrics_of(conn, id),
            current_activity_id,
            None,
        );

        crate::FfiRouteDetailData {
            activity_count: activity_count(conn),
            groups,
            performances: crate::FfiRoutePerformanceResult::from(performances),
            encoded_consensus: routes::consensus_route(conn, group_id)
                .map(|points| crate::coords::encode(points.as_slice()))
                .unwrap_or_default(),
            route_names: routes::all_route_names(conn),
            excluded_activity_ids: excluded,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            section_ids: routes::section_ids_for_route(conn, group_id),
            group: group.map(crate::FfiRouteGroup::from),
        }
    }

    /// Everything the activity detail screen paints with.
    ///
    /// The engine path answers the counts and the sport from the memory tier and
    /// the group from the lazily regrouped list; this one has committed rows
    /// only, so it inherits the same deferred-regroup staleness the route detail
    /// read above records.
    pub fn activity_detail_data(
        conn: &Connection,
        activity_id: &str,
        min_route_activities: u32,
    ) -> crate::FfiActivityDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::derivations::pooled as derivations;
        use crate::persistence::indicators::pooled as indicators;
        use crate::persistence::routes::pooled as routes;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::queries::pooled as sections;

        let names = named::overlay_names(conn);

        let route_groups: Vec<crate::FfiRouteGroup> = routes::all_groups(conn)
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_route_activities)
            .find(|g| g.activity_ids.iter().any(|a| a == activity_id))
            .map(crate::FfiRouteGroup::from)
            .into_iter()
            .collect();

        let matched = sections::sections_for_activity(conn, activity_id, &names);
        // The same dedup the engine path does: a custom section this activity
        // traverses is already in `matched_sections`.
        let matched_ids: std::collections::HashSet<&str> =
            matched.iter().map(|s| s.id.as_str()).collect();
        let custom: Vec<_> =
            sections::sections_by_type(conn, Some(crate::sections::SectionType::Custom), &names)
                .into_iter()
                .filter(|s| {
                    !matched_ids.contains(s.id.as_str())
                        && (s.source_activity_id.as_deref() == Some(activity_id)
                            || s.activity_ids.iter().any(|a| a == activity_id))
                })
                .collect();

        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut targets: Vec<(String, Vec<crate::GpsPoint>)> = Vec::new();
        for section in matched.iter().chain(custom.iter()) {
            if seen.insert(section.id.as_str()) {
                targets.push((section.id.clone(), section.polyline.clone()));
            }
        }

        let track = activities::gps_track(conn, activity_id).unwrap_or_default();
        let section_traces = super::section_traces(&track, &targets);

        let activity_sport = sections::sport_of_activity(conn, activity_id);
        let pr_section_ids: Vec<String> = targets
            .iter()
            .filter(|(section_id, _)| {
                crate::persistence::fitness::performances::pooled::section_performances(
                    conn,
                    section_id,
                    activity_sport.as_deref(),
                )
                .best_record
                .as_ref()
                .is_some_and(|r| r.activity_id == activity_id)
            })
            .map(|(section_id, _)| section_id.clone())
            .collect();

        let ids = [activity_id.to_string()];
        crate::FfiActivityDetailData {
            activity_count: activity_count(conn),
            section_count: sections::section_count(conn),
            route_groups,
            matched_sections: matched
                .into_iter()
                .map(crate::persistence::PersistentEngine::matched_section)
                .collect(),
            custom_sections: custom.into_iter().map(crate::FfiSection::from).collect(),
            encounters: derivations::activity_section_encounters(conn, activity_id),
            highlights: crate::FfiActivityHighlightsBundle {
                indicators: indicators::activity_indicators(conn, &ids),
                route_highlights: derivations::route_highlights(conn, &ids),
            },
            section_traces,
            pr_section_ids,
        }
    }

    /// Everything the insights tab is computed from.
    ///
    /// The engine path answers the activity patterns off `activity_metrics`
    /// held in memory and the section list off the in-memory catalogue; this
    /// one loads both from the rows they were loaded from. The metrics load is
    /// 2.5 ms on a 1,598-activity library (`tests/insights_pool_cost.rs`),
    /// against a 100 ms mount budget. It inherits the same deferred-regroup
    /// staleness the other pooled screens record.
    pub fn insights_data(
        conn: &Connection,
        p: &crate::FfiInsightsParams,
    ) -> crate::FfiInsightsData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::derivations::pooled as derivations;
        use crate::persistence::fitness::performances::pooled as performances;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::queries::pooled as sections;
        use crate::persistence::sections::ranking::pooled as ranking;
        use crate::persistence::strength::pooled as strength;

        let names = named::overlay_names(conn);
        let now_ts = p.current_end;

        // Period stats (4 queries, all in one engine lock)
        let current_week =
            derivations::period_stats(conn, p.current_start as i64, p.current_end as i64);
        let previous_week = derivations::period_stats(conn, p.prev_start as i64, p.prev_end as i64);
        let chronic_period =
            derivations::period_stats(conn, p.chronic_start as i64, p.prev_start as i64);
        let today_period = derivations::period_stats(conn, p.today_start as i64, now_ts as i64);

        // Trends
        let ftp_trend = derivations::ftp_trend_to(conn, &crate::persistence::wellness::today_iso());
        let run_pace_trend = derivations::pace_trend(conn, "Run");

        // Activity patterns
        let all_patterns =
            crate::patterns::compute_activity_patterns(conn, &activities::all_metrics(conn));
        let today_pattern = crate::patterns::pattern_for_today(&all_patterns);

        // Recent PRs - loop stays in Rust, never crosses FFI
        let seven_days_ago = now_ts as i64 - 7 * 86_400;
        let mut recent_prs = Vec::new();
        let available_sports = available_sport_types(conn);
        // One candidate per (section, sport): shared ground holds a record in
        // each sport that travels it, and neither may be measured against the
        // other's laps.
        // One read, then the fan-out in memory. Asking per sport runs the whole
        // summary query once per sport and throws away every row belonging to
        // the others, which on a fourteen-sport library is thirteen wasted
        // scans and a third of this bundle.
        let all_summaries = crate::persistence::sections::summaries_by_sport(
            &sections::section_summaries_filtered(conn, None, true, &names),
            &available_sports,
            // Outings, not passes: a PR slot is earned by returning.
            3,
        );

        let recent_visits = sections_visited_since(conn, seven_days_ago);

        for (sport, s) in &all_summaries {
            // A record inside the window needs an outing inside the window, and
            // computing one section's performances costs tens of milliseconds,
            // so the junction says which sections are worth asking about before
            // any of them is computed.
            if let Some(recent) = &recent_visits
                && !recent.contains(&(s.id.clone(), sport.clone()))
            {
                continue;
            }
            let perf = performances::section_performances(conn, &s.id, Some(sport));
            // Prefer per-direction bests: they're computed lap-by-lap and
            // line up with what the section detail page shows. The combined
            // `best_record` is each activity's minimum lap, which can pick
            // a partial / unusually short portion (yielding implausible
            // times like "1:24" for a section that's normally ~6 minutes).
            // Take the faster of forward/reverse so we mirror what the
            // user would see as "the PR" on the section detail screen.
            let best = match (
                perf.best_forward_record.as_ref(),
                perf.best_reverse_record.as_ref(),
            ) {
                (Some(fwd), Some(rev)) => Some(if fwd.best_time <= rev.best_time {
                    fwd
                } else {
                    rev
                }),
                (Some(fwd), None) => Some(fwd),
                (None, Some(rev)) => Some(rev),
                (None, None) => perf.best_record.as_ref(),
            };
            if let Some(record) = best
                && record.activity_date >= seven_days_ago
            {
                let days_ago = crate::calendar_days_between(record.activity_date, now_ts as i64);
                // One row per section, the freshest. A section holds a record
                // in each sport that travels it, and the surface shows one.
                match recent_prs
                    .iter_mut()
                    .find(|p: &&mut crate::FfiRecentPR| p.section_id == s.id)
                {
                    // A fresher record in another sport takes the row whole.
                    // Every field below the section is that sport's, so
                    // carrying the time over on its own is what left a run
                    // record reading against the rides.
                    Some(held) if days_ago < held.days_ago => {
                        held.best_time = record.best_time;
                        held.days_ago = days_ago;
                        held.sport_type = sport.clone();
                        held.traversal_count = perf.records.iter().map(|r| r.lap_count).sum();
                        held.recent_efforts =
                            super::series_tail(perf.records.iter(), p.history_limit, |r| {
                                (r.best_time, r.activity_date as f64)
                            });
                    }
                    Some(_) => {}
                    None => recent_prs.push(crate::FfiRecentPR {
                        section_id: s.id.clone(),
                        section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                        best_time: record.best_time,
                        days_ago,
                        sport_type: sport.clone(),
                        // This sport's passes, not the section's. `perf` is
                        // already filtered to the sport the record was set
                        // in, and every record carries its laps.
                        traversal_count: perf.records.iter().map(|r| r.lap_count).sum(),
                        // `perf.records` is already computed here, oldest
                        // first, to find the record above. The card draws the
                        // tail of it rather than the sheet reading the whole
                        // bundle back per open.
                        recent_efforts: super::series_tail(
                            perf.records.iter(),
                            p.history_limit,
                            |r| (r.best_time, r.activity_date as f64),
                        ),
                        // Filled below, from one query over the rows that
                        // earned a slot rather than a read per pair the loop
                        // meets.
                        encoded_polyline: Vec::new(),
                    }),
                }
            }
        }

        // The card draws the section it names, so each row carries the line.
        // One query over the rows that earned a slot, after the loop, because
        // the loop meets every (section, sport) pair and keeps one row each.
        {
            let ids: Vec<&str> = recent_prs.iter().map(|pr| pr.section_id.as_str()).collect();
            let mut lines = crate::persistence::sections::pooled::section_polylines(conn, &ids);
            for pr in &mut recent_prs {
                if let Some(encoded) = lines.remove(&pr.section_id) {
                    pr.encoded_polyline = super::preview_line(&crate::coords::decode(&encoded));
                }
            }
        }

        // Sport types follow the observed patterns, falling back to whatever
        // the engine holds when no pattern has emerged yet.
        let mut sport_types: Vec<String> = Vec::new();
        for pattern in &all_patterns {
            if !sport_types.contains(&pattern.sport_type) {
                sport_types.push(pattern.sport_type.clone());
            }
        }
        if sport_types.is_empty() {
            sport_types = available_sports;
        }

        let section_count = sections::section_count(conn);
        let sections_ready = p.include_sections && section_count > 0;

        // One read for every sport, then one ranking per sport. The ranking is
        // within a sport and stays there; the scan it used to repeat per sport
        // grew with the number of sports rather than with the sections.
        let ranked_sections: Vec<crate::FfiRankedSectionsBySport> = if sections_ready {
            ranking::ranked_sections_by_sports(conn, &sport_types, p.ranked_limit, &names)
        } else {
            Vec::new()
        };

        // Efficiency candidates: the most recently visited ranked sections.
        // A trend on a section untouched for months is a curiosity, not an
        // insight, so anything outside the active window is dropped.
        let mut candidate_ids: Vec<String> = Vec::new();
        for batch in &ranked_sections {
            let recent = batch
                .sections
                .iter()
                .filter(|rs| rs.days_since_last <= p.active_window_days)
                .take(p.efficiency_per_sport as usize);
            for rs in recent {
                if !candidate_ids.contains(&rs.section_id) {
                    candidate_ids.push(rs.section_id.clone());
                }
            }
        }

        let mut efficiency_trends: Vec<crate::FfiEfficiencyTrend> = Vec::new();
        for section_id in &candidate_ids {
            if efficiency_trends.len() >= p.efficiency_limit as usize {
                break;
            }
            let Some(trend) = section_efficiency_trend_of(conn, section_id, &names) else {
                continue;
            };
            if !trend.is_improving || trend.effort_count < p.efficiency_min_efforts {
                continue;
            }
            // Matches the rounding the generator applied: a sub-1bpm change
            // reads as noise rather than adaptation.
            if (trend.hr_change_bpm + 0.5).floor().abs() < 1.0 {
                continue;
            }
            efficiency_trends.push(trend);
        }

        let has_strength_data = strength::strength_activity_count(conn).unwrap_or(0) > 0;
        let strength_series = if has_strength_data {
            strength_insight_series(conn, &p.strength_month, &p.strength_weeks)
        } else {
            None
        };

        let chronic_week_average = super::chronic_week_average(&chronic_period);
        let chronic_weeks =
            super::chronic_weeks(p.chronic_start as i64, p.prev_start as i64, |from, to| {
                derivations::period_stats(conn, from, to)
            });
        let (week_over_week, week_against_chronic) = super::complete_period_comparisons(
            conn,
            p,
            &current_week,
            &previous_week,
            &chronic_week_average,
        );
        let form = crate::persistence::wellness::pooled::latest_form(
            conn,
            &p.wellness_oldest,
            &p.wellness_newest,
        );

        // The three tails the insights screen used to reach back for, one
        // engine call each, on top of the heaviest read in the tree.
        //
        // The stale-PR exclusion looked like a caller's argument and was not.
        // The screen passed the sections already carrying a `section_pr-`
        // insight, which come only from `recent_prs`, and this bundle has just
        // built those. Taken here it is the whole list rather than the three
        // the screen surfaces, so a section that set a record and did not make
        // the cut is still not offered as stale. That is the rule the exclusion
        // was always for, stated where the data is.
        let hrv_trend = crate::persistence::wellness::pooled::hrv_trend_to(
            conn,
            p.hrv_window_days,
            &crate::persistence::wellness::today_iso(),
        )
        .unwrap_or(None);
        let recent_section_changes =
            crate::persistence::sections::history::pooled::recent_section_changes(
                conn,
                p.section_change_window_days,
            )
            .into_iter()
            .map(|c| crate::FfiSectionChange {
                section_id: c.section_id,
                kind: c.kind,
                at: c.at,
            })
            .collect();
        let exclude: std::collections::HashSet<String> =
            recent_prs.iter().map(|pr| pr.section_id.clone()).collect();
        let swim_pace_trend = derivations::pace_trend(conn, "Swim");
        let stale_pr_opportunities = crate::persistence::fitness::stale_pr::opportunities(
            &crate::persistence::fitness::stale_pr::StalePrTrends {
                ftp: &ftp_trend,
                run_pace: &run_pace_trend,
                swim_pace: &swim_pace_trend,
            },
            &sport_types,
            &crate::persistence::fitness::stale_pr::StalePrRequest {
                stale_threshold_days: p.stale_threshold_days,
                min_gain_percent: p.stale_min_gain_percent,
                max_opportunities: p.stale_max_opportunities,
                exclude_section_ids: &exclude,
            },
            |sport| ranking::stale_ranked_sections(conn, sport, p.stale_threshold_days, &names),
            |sport, at| {
                crate::persistence::fitness::derivations::pooled::fitness_on(conn, sport, at)
            },
        );

        crate::FfiInsightsData {
            current_week,
            previous_week,
            chronic_period,
            chronic_week_average,
            chronic_weeks,
            today_period,
            ftp_trend,
            run_pace_trend,
            all_patterns,
            today_pattern,
            recent_prs,
            section_count,
            sport_types,
            ranked_sections,
            efficiency_trends,
            has_strength_data,
            strength_series,
            week_over_week,
            week_against_chronic,
            form,
            hrv_trend,
            recent_section_changes,
            stale_pr_opportunities,
        }
    }

    /// The (section, sport) pairs travelled on or after `since`, or `None`
    /// when the junction cannot be read, which leaves the caller computing
    /// every section as it did before.
    fn sections_visited_since(
        conn: &Connection,
        since: i64,
    ) -> Option<std::collections::HashSet<(String, String)>> {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT sa.section_id, am.sport_type
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0 AND am.date >= ?1",
            )
            .map_err(|e| log::warn!("[screens] recent visit prepare failed: {}", e))
            .ok()?;
        let rows = stmt
            .query_map(rusqlite::params![since], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| log::warn!("[screens] recent visit query failed: {}", e))
            .ok()?;
        Some(rows.flatten().collect())
    }

    /// Strength volume over one month and a set of weeks, or `None` when a
    /// range cannot be read.
    fn strength_insight_series(
        conn: &Connection,
        month: &crate::FfiTimestampRange,
        weeks: &[crate::FfiTimestampRange],
    ) -> Option<crate::FfiStrengthInsightSeries> {
        let monthly = crate::objects::strength::aggregate_strength_sets(
            &crate::persistence::strength::pooled::exercise_sets_in_range(
                conn,
                month.start_ts as i64,
                month.end_ts as i64,
            )
            .ok()?,
        );
        let mut weekly = Vec::with_capacity(weeks.len());
        for range in weeks {
            let sets = crate::persistence::strength::pooled::exercise_sets_in_range(
                conn,
                range.start_ts as i64,
                range.end_ts as i64,
            )
            .ok()?;
            weekly.push(crate::objects::strength::aggregate_strength_sets(&sets));
        }
        let progressions = crate::objects::strength::strength_progressions(&monthly, &weekly);
        Some(crate::FfiStrengthInsightSeries {
            monthly,
            weekly,
            progressions,
        })
    }

    /// One section's efficiency trend, with its name and length read from the
    /// row rather than the in-memory catalogue the engine path uses.
    fn section_efficiency_trend_of(
        conn: &Connection,
        section_id: &str,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Option<crate::FfiEfficiencyTrend> {
        let section =
            crate::persistence::sections::queries::pooled::section(conn, section_id, names)?;
        crate::persistence::fitness::derivations::pooled::section_efficiency_trend(
            conn,
            section_id,
            section.name.as_deref().unwrap_or("Section"),
            section.distance_meters,
        )
    }

    /// Everything the section detail screen paints with.
    ///
    /// Every read here is committed rows. What the engine path answers from
    /// memory is the activity count, the per-activity metrics and the section
    /// record itself, and each of those is loaded from the same table at init,
    /// so the pooled answers are the rows the memory tier is a copy of. The
    /// one place the two can differ is a catalogue a detection has computed
    /// and not yet saved, which is the deferred-regroup staleness the route
    /// detail read above already records.
    pub fn section_detail_data(
        conn: &Connection,
        section_id: &str,
        nearby_radius_meters: f64,
    ) -> crate::FfiSectionDetailData {
        use crate::persistence::activities::pooled as activities;
        use crate::persistence::fitness::derivations::pooled as derivations;
        use crate::persistence::sections::merging::pooled as merging;
        use crate::persistence::sections::named::pooled as named;
        use crate::persistence::sections::pooled as sections_mod;
        use crate::persistence::sections::queries::pooled as sections;

        let names = named::overlay_names(conn);
        let section = sections::section(conn, section_id, &names).map(|raw| {
            let portions = sections_mod::section_portions(conn, section_id);
            sections_mod::to_frequent(raw, portions)
        });

        let activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| s.activity_ids.clone())
            .unwrap_or_default();
        let portion_activity_ids: Vec<String> = section
            .as_ref()
            .map(|s| {
                let mut seen = std::collections::HashSet::new();
                s.activity_portions
                    .iter()
                    .filter(|p| seen.insert(p.activity_id.clone()))
                    .map(|p| p.activity_id.clone())
                    .collect()
            })
            .unwrap_or_default();

        let activity_metrics: Vec<crate::FfiActivityMetrics> = activity_ids
            .iter()
            .filter_map(|id| activities::metrics_of(conn, id))
            .map(crate::FfiActivityMetrics::from)
            .collect();

        let pinned_version =
            crate::persistence::sections::history::pooled::pinned_section_version(conn, section_id);

        let efficiency_trend = section.as_ref().and_then(|s| {
            derivations::section_efficiency_trend(
                conn,
                section_id,
                s.name.as_deref().unwrap_or("Section"),
                s.distance_meters,
            )
        });

        crate::FfiSectionDetailData {
            activity_count: activity_count(conn),
            nearby: sections_mod::nearby_sections(conn, section_id, nearby_radius_meters),
            merge_candidates: merging::merge_candidates(conn, section_id, &names),
            excluded_activity_ids: sections::excluded_activity_ids(conn, section_id),
            has_original_bounds: sections::has_original_bounds(conn, section_id),
            activity_metrics,
            map_signatures: activities::map_signatures_for_ids(conn, &activity_ids),
            missing_time_stream_ids: activities::activities_missing_time_streams(
                conn,
                &portion_activity_ids,
            ),
            history: crate::persistence::sections::history::pooled::section_history(
                conn, section_id,
            )
            .into_iter()
            .map(|h| crate::FfiSectionHistoryEvent {
                id: h.id as f64,
                at: h.at,
                kind: h.kind,
                details: h.details,
                geometry_version: h.geometry_version.map(|v| v as f64),
            })
            .collect(),
            geometry_versions:
                crate::persistence::sections::history::pooled::section_geometry_versions(
                    conn, section_id,
                )
                .into_iter()
                .map(|v| crate::FfiSectionGeometryVersion {
                    pinned: pinned_version == Some(v.version),
                    version: v.version as f64,
                    created_at: v.created_at,
                    milestone: v.milestone,
                })
                .collect(),
            pinned_version: pinned_version.map(|v| v as f64),
            excluded_laps: sections::excluded_section_laps(conn, section_id)
                .into_iter()
                .map(|(activity_id, start_index)| crate::FfiExcludedLap {
                    activity_id,
                    start_index,
                })
                .collect(),
            efficiency_trend,
            section: section.map(crate::FfiSection::from),
        }
    }

    /// The feed's first paint: the summary card and the preview tracks.
    ///
    /// Both halves are committed rows, so a sync page mid-transaction delays
    /// neither. What a card drawn here cannot show is the activity that sync
    /// is still writing, which is the same thing it could not show a moment
    /// earlier.
    pub fn startup_data(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        preview_activity_ids: &[String],
    ) -> crate::FfiStartupData {
        crate::FfiStartupData {
            summary_card: summary_card(conn, current_start, current_end, prev_start, prev_end),
            preview_tracks: preview_activity_ids
                .iter()
                .filter_map(|id| preview_track(conn, id))
                .collect(),
            sparklines: crate::persistence::wellness::pooled::sparklines_to(
                conn,
                super::FEED_SPARKLINE_DAYS,
                &crate::persistence::wellness::today_iso(),
            )
            .ok()
            .flatten(),
        }
    }

    /// The week against the week before it, plus the three trends beside them.
    pub fn summary_card(
        conn: &Connection,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
    ) -> crate::FfiSummaryCardData {
        use crate::persistence::fitness::derivations::pooled as fitness;
        crate::FfiSummaryCardData {
            wellness: crate::persistence::wellness::pooled::summary(conn),
            current_week: fitness::period_stats(conn, current_start, current_end),
            prev_week: fitness::period_stats(conn, prev_start, prev_end),
            ftp_trend: fitness::ftp_trend_to(conn, &crate::persistence::wellness::today_iso()),
            run_pace_trend: fitness::pace_trend(conn, "Run"),
            swim_pace_trend: fitness::pace_trend(conn, "Swim"),
        }
    }

    /// One card's preview line, from the signature the read cache holds.
    ///
    /// `None` for an activity with no signature or an empty one: there is
    /// nothing to draw.
    pub fn preview_track(conn: &Connection, activity_id: &str) -> Option<crate::FfiPreviewTrack> {
        let sig = crate::persistence::read_cache::signature(activity_id, || {
            crate::persistence::activities::pooled::signature(conn, activity_id)
        })?;
        if sig.points.is_empty() {
            return None;
        }
        Some(crate::FfiPreviewTrack {
            activity_id: activity_id.to_string(),
            encoded_coords: crate::coords::encode(&sig.points),
        })
    }

    /// The screen itself, given the chips whoever asked for it is entitled to.
    pub(crate) fn screen_data(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
        available_sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        crate::FfiMapScreenData {
            activity_count: activity_count(conn),
            available_sport_types,
            activities: map_activities_filtered(conn, start_date, end_date, sport_types),
        }
    }

    /// The library total, which is the whole of `activities` and not the
    /// window.
    fn activity_count(conn: &Connection) -> u32 {
        conn.query_row("SELECT COUNT(*) FROM activities", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|n| n as u32)
        .unwrap_or_else(|e| {
            log::warn!("[map] activity count: {e:?}");
            0
        })
    }

    /// The sports the filter chips offer.
    pub(crate) fn available_sport_types(conn: &Connection) -> Vec<String> {
        let mut stmt = match conn
            .prepare("SELECT DISTINCT sport_type FROM activity_metrics ORDER BY sport_type")
        {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("[map] sport types: {e:?}");
                return Vec::new();
            }
        };
        let rows = match stmt.query_map([], |row| row.get(0)) {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[map] sport types: {e:?}");
                return Vec::new();
            }
        };
        rows.flatten().collect()
    }

    /// Activities inside a date window, optionally narrowed to a sport set.
    ///
    /// The window is the query's, because `activity_metrics` is indexed by
    /// date. The sport set is the caller's and is applied here rather than as
    /// an `IN`, so the statement is one cached form whatever chips are on.
    ///
    /// `sport_type` is read from `activities` and not from `activity_metrics`,
    /// which carries one of its own: the chips are built from the metrics
    /// column and the filter has always compared against the activity's, and
    /// making them one question is not this move's to make.
    pub fn map_activities_filtered(
        conn: &Connection,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        let sport_filter: Option<std::collections::HashSet<String>> = if sport_types.is_empty() {
            None
        } else {
            Some(sport_types.into_iter().collect())
        };

        // The join is what the memory read did by looking an id up in both
        // maps: an activity with no metrics row has no date to place it in the
        // window, so it is not on the map. The signature is a left join, since
        // one that has not been derived yet still draws, without its marker.
        let mut stmt = match conn.prepare(
            "SELECT a.id, m.name, a.sport_type, m.date, m.distance, m.moving_time,
                    a.min_lat, a.max_lat, a.min_lng, a.max_lng,
                    s.start_point_lat, s.start_point_lng
             FROM activity_metrics m
             JOIN activities a ON a.id = m.activity_id
             LEFT JOIN signatures s ON s.activity_id = m.activity_id
             WHERE m.date >= ?1 AND m.date <= ?2
             ORDER BY m.date DESC, a.id",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("[map] window: {e:?}");
                return Vec::new();
            }
        };

        let rows = stmt.query_map(rusqlite::params![start_date, end_date], |row| {
            let start_lat: Option<f64> = row.get(10)?;
            let start_lng: Option<f64> = row.get(11)?;
            Ok(crate::persistence::MapActivityComplete {
                activity_id: row.get(0)?,
                name: row.get(1)?,
                sport_type: row.get(2)?,
                date: row.get(3)?,
                distance: row.get(4)?,
                duration: row.get(5)?,
                bounds: crate::FfiBounds {
                    min_lat: row.get(6)?,
                    max_lat: row.get(7)?,
                    min_lng: row.get(8)?,
                    max_lng: row.get(9)?,
                },
                start_lat: start_lat.filter(|_| start_lng.is_some()),
                start_lng: start_lng.filter(|_| start_lat.is_some()),
            })
        });
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[map] window: {e:?}");
                return Vec::new();
            }
        };

        rows.flatten()
            .filter(|a| {
                sport_filter
                    .as_ref()
                    .is_none_or(|filter| filter.contains(&a.sport_type))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scenario: an insight card draws a graphic of its own history, and the
    /// engine read carried a series for two of eight generators. The points a
    /// card needs are already held wherever the generator computed its
    /// summary: a section's laps, a trend's daily estimates.
    ///
    /// Expected behaviour: the tail of them, oldest first, capped, with
    /// anything undrawable left out rather than carried into a path.
    mod series_tail {
        use super::*;

        fn values(points: &[crate::FfiSeriesPoint]) -> Vec<f64> {
            points.iter().map(|p| p.value).collect()
        }

        #[test]
        fn takes_the_newest_points_and_keeps_them_oldest_first() {
            let got = series_tail(
                [(1.0, 10.0), (2.0, 20.0), (3.0, 30.0), (4.0, 40.0)],
                3,
                |p| p,
            );

            assert_eq!(values(&got), vec![2.0, 3.0, 4.0]);
            assert_eq!(got[0].date, 20.0);
        }

        #[test]
        fn keeps_everything_when_there_is_less_than_the_cap() {
            let got = series_tail([(1.0, 10.0), (2.0, 20.0)], 10, |p| p);

            assert_eq!(values(&got), vec![1.0, 2.0]);
        }

        #[test]
        fn leaves_out_a_point_that_cannot_be_drawn() {
            let got = series_tail(
                [
                    (1.0, 10.0),
                    (f64::NAN, 20.0),
                    (3.0, f64::INFINITY),
                    (4.0, 40.0),
                ],
                10,
                |p| p,
            );

            assert_eq!(values(&got), vec![1.0, 4.0]);
        }

        /// The cap is applied after the undrawable ones are dropped, so a
        /// series holding a NaN still fills the strip.
        #[test]
        fn caps_what_is_left_rather_than_what_arrived() {
            let got = series_tail(
                [(1.0, 10.0), (f64::NAN, 20.0), (3.0, 30.0), (4.0, 40.0)],
                2,
                |p| p,
            );

            assert_eq!(values(&got), vec![3.0, 4.0]);
        }

        #[test]
        fn a_cap_of_nothing_carries_nothing() {
            assert!(series_tail([(1.0, 10.0)], 0, |p| p).is_empty());
        }

        #[test]
        fn an_empty_series_is_empty_rather_than_a_point_of_zeroes() {
            let none: [(f64, f64); 0] = [];
            assert!(series_tail(none, 5, |p| p).is_empty());
        }
    }

    /// A section with two traversals, written the way the detector writes one.
    /// Enough for the performance bundle: a distance, a lap time per activity
    /// and metrics rows to name them by.
    fn engine_with_a_traversed_section(path: &str) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        for (id, date) in [("a1", 1_700_000_000i64), ("a2", 1_700_086_400)] {
            engine
                .add_activity(id.into(), track(60), "Ride".into())
                .expect("add");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id.into(),
                    name: format!("Fixture {id}"),
                    date,
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
                .expect("metrics");
        }
        let polyline = serde_json::to_string(&track(30)).expect("polyline");
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, source_activity_id)
                 VALUES ('auto1', 'auto', 'Auto Climb', 'Ride', ?1, 800.0, 0, 1, NULL)",
                rusqlite::params![polyline],
            )
            .expect("section");
        for (activity_id, lap_time) in [("a1", 200.0f64), ("a2", 240.0)] {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                         start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                     VALUES ('auto1', ?1, 'same', 0, 40, 800.0, ?2, ?3, 0)",
                    rusqlite::params![activity_id, lap_time, 800.0 / lap_time],
                )
                .expect("traversal");
        }
        engine
    }

    fn coverage_params() -> crate::FfiInsightsParams {
        let now = 1_700_200_000i64;
        crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: true,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_limit: 2,
            efficiency_min_efforts: 1,
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
        }
    }

    fn coverage_engine(path: &str, empty: Option<usize>) -> crate::persistence::PersistentEngine {
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");
        engine.set_setting("__athlete_id", "i1").expect("athlete");
        let p = coverage_params();
        let mut census = Vec::new();
        for (i, (from, to)) in [
            (p.current_start, p.current_end),
            (p.prev_start, p.prev_end),
            (p.chronic_start, p.prev_start),
        ]
        .into_iter()
        .enumerate()
        {
            if empty == Some(i) {
                continue;
            }
            let id = format!("a{i}");
            let date = ((from + to) / 2.0) as i64;
            let local = chrono::DateTime::from_timestamp(date, 0)
                .expect("date")
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            census.push(crate::net::types::ActivityCensusEntry {
                id: id.clone(),
                start_date_local: Some(local),
                created: None,
                icu_sync_date: Some("v1".into()),
                has_latlng: false,
            });
            engine
                .upsert_activity_bodies(&[(id.clone(), date, "{}".into())])
                .expect("body");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: id,
                    name: "Ride".into(),
                    date,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: Some(100.0),
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
        }
        engine.record_activity_census("i1", &census);
        engine.mark_census_fetched(
            "i1",
            &census.iter().map(|e| e.id.clone()).collect::<Vec<_>>(),
        );
        engine
    }

    #[test]
    fn test_insights_comparisons_need_the_current_athletes_census() {
        let dir = tempfile::TempDir::new().expect("directory");
        let mut engine = coverage_engine(dir.path().join("insights.db").to_str().unwrap(), None);
        let p = coverage_params();
        for athlete in ["", "another-athlete"] {
            engine
                .set_setting("__athlete_id", athlete)
                .expect("athlete");
            for data in [
                engine.insights_data(&p),
                pooled::insights_data(&engine.db, &p),
            ] {
                assert!(data.week_over_week.is_none());
                assert!(data.week_against_chronic.is_none());
            }
        }
    }

    // Each missing row leaves plausible nonzero totals behind, so only the
    // census can say the denominator or numerator is still incomplete.
    #[test]
    fn test_insights_comparisons_wait_for_each_required_window() {
        for missing in 0..3 {
            let dir = tempfile::TempDir::new().expect("directory");
            let mut engine =
                coverage_engine(dir.path().join("insights.db").to_str().unwrap(), None);
            let p = coverage_params();
            let range = [
                (p.current_start, p.current_end),
                (p.prev_start, p.prev_end),
                (p.chronic_start, p.prev_start),
            ][missing];
            let date = ((range.0 + range.1) / 2.0) as i64;
            let local = chrono::DateTime::from_timestamp(date, 0)
                .unwrap()
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            engine.db.execute("INSERT INTO activity_census (athlete_id, intervals_id, start_date_local, icu_sync_date) VALUES ('i1', 'owed', ?1, 'v1')", rusqlite::params![local]).expect("owed row");
            for data in [
                engine.insights_data(&p),
                pooled::insights_data(&engine.db, &p),
            ] {
                assert_eq!(
                    data.week_over_week.is_some(),
                    missing == 2,
                    "window {missing}"
                );
                assert!(data.week_against_chronic.is_none(), "window {missing}");
            }
            engine
                .upsert_activity_bodies(&[("owed".into(), date, "{}".into())])
                .expect("body");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: "owed".into(),
                    name: "Downloaded ride".into(),
                    date,
                    distance: 1000.0,
                    moving_time: 300,
                    elapsed_time: 300,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: Some(100.0),
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("downloaded metrics");
            engine.mark_census_fetched("i1", &["owed".into()]);
            for data in [
                engine.insights_data(&p),
                pooled::insights_data(&engine.db, &p),
            ] {
                let weekly = data.week_over_week.expect("complete weeks");
                let chronic = data.week_against_chronic.expect("complete chronic window");
                assert_eq!(weekly.ratio, [1.0, -0.5, 0.0][missing]);
                assert_eq!(chronic.ratio, [3.0, 7.0, 1.0][missing]);
            }
        }
    }

    #[test]
    fn test_insights_comparisons_preserve_confirmed_empty_windows() {
        for empty in 0..3 {
            let dir = tempfile::TempDir::new().expect("directory");
            let mut engine = coverage_engine(
                dir.path().join("insights.db").to_str().unwrap(),
                Some(empty),
            );
            let p = coverage_params();
            for data in [
                engine.insights_data(&p),
                pooled::insights_data(&engine.db, &p),
            ] {
                assert_eq!(data.week_over_week.is_some(), empty == 2);
                assert_eq!(data.week_against_chronic.is_some(), empty == 0);
            }
        }
    }

    /// Scenario: the insights tab is opened while a sync page holds the engine
    /// write lock.
    ///
    /// Expected behaviour: the bundle is committed rows, so it goes through the
    /// reader pool. The engine path answers the patterns off the in-memory
    /// metrics and the section list off the in-memory catalogue, and the pooled
    /// one off the rows both were loaded from, so the two have to agree.
    #[test]
    fn the_pooled_insights_match_the_ones_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("insights_parity.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let mut engine = engine_with_a_traversed_section(db_path);

        let now = 1_700_200_000i64;
        let params = crate::FfiInsightsParams {
            history_limit: 20,
            current_start: (now - 7 * 86_400) as f64,
            current_end: now as f64,
            prev_start: (now - 14 * 86_400) as f64,
            prev_end: (now - 7 * 86_400) as f64,
            chronic_start: (now - 35 * 86_400) as f64,
            today_start: (now - 86_400) as f64,
            include_sections: true,
            ranked_limit: 50,
            active_window_days: 90,
            efficiency_per_sport: 5,
            efficiency_limit: 2,
            efficiency_min_efforts: 1,
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

        let through_the_lock = engine.insights_data(&params);
        let through_the_pool = pooled::insights_data(&engine.db, &params);

        assert_eq!(
            through_the_pool.current_week.count, through_the_lock.current_week.count,
            "the same week"
        );
        assert_eq!(
            through_the_pool.section_count, through_the_lock.section_count,
            "the same catalogue size"
        );
        assert_eq!(
            through_the_pool.sport_types, through_the_lock.sport_types,
            "the same sports"
        );
        assert_eq!(
            through_the_pool.today_pattern.is_some(),
            through_the_lock.today_pattern.is_some(),
            "the same pattern verdict"
        );
        assert_eq!(
            through_the_pool.has_strength_data, through_the_lock.has_strength_data,
            "the same strength answer"
        );
        assert_eq!(
            through_the_pool.ranked_sections.len(),
            through_the_lock.ranked_sections.len(),
            "the same ranked sports"
        );
        assert_eq!(
            through_the_pool.recent_prs.len(),
            through_the_lock.recent_prs.len(),
            "the same recent PRs"
        );
        assert_eq!(
            through_the_pool.ftp_trend.latest_ftp, through_the_lock.ftp_trend.latest_ftp,
            "and the same FTP"
        );

        assert_eq!(
            through_the_lock.section_count, 1,
            "the fixture has a section, so the equalities above compare something"
        );

        assert_eq!(
            through_the_pool
                .week_over_week
                .as_ref()
                .map(|c| c.ratio.to_bits()),
            through_the_lock
                .week_over_week
                .as_ref()
                .map(|c| c.ratio.to_bits()),
            "the same week against last"
        );
        assert_eq!(
            through_the_pool.chronic_week_average.total_tss.to_bits(),
            through_the_lock.chronic_week_average.total_tss.to_bits(),
            "and the same chronic average"
        );

        // The three tails the insights screen used to reach back for. Each was
        // a read of its own with no pooled half, so the two paths could only be
        // compared once both had one.
        assert_eq!(
            through_the_pool.hrv_trend.as_ref().map(|h| h.label.clone()),
            through_the_lock.hrv_trend.as_ref().map(|h| h.label.clone()),
            "the same HRV verdict"
        );
        assert_eq!(
            through_the_pool
                .recent_section_changes
                .iter()
                .map(|c| (c.section_id.as_str(), c.kind.as_str()))
                .collect::<Vec<_>>(),
            through_the_lock
                .recent_section_changes
                .iter()
                .map(|c| (c.section_id.as_str(), c.kind.as_str()))
                .collect::<Vec<_>>(),
            "the same ledger changes"
        );
        assert_eq!(
            through_the_pool
                .stale_pr_opportunities
                .iter()
                .map(|o| (o.section_id.as_str(), o.sport_type.as_str()))
                .collect::<Vec<_>>(),
            through_the_lock
                .stale_pr_opportunities
                .iter()
                .map(|o| (o.section_id.as_str(), o.sport_type.as_str()))
                .collect::<Vec<_>>(),
            "and the same stale-PR opportunities"
        );
    }

    fn period(count: u32, total_duration: f64, total_tss: f64) -> crate::FfiPeriodStats {
        crate::FfiPeriodStats {
            count,
            total_duration,
            total_distance: 0.0,
            total_tss,
        }
    }

    /// Scenario: a week is compared against the one before it.
    ///
    /// Expected behaviour: the ratio and the metric are the engine's, so a
    /// reader divides nothing. Load is the metric where both weeks carry some
    /// and moving time where either does not, and a period with nothing to
    /// divide gets no comparison rather than one reading minus a hundred
    /// percent.
    #[test]
    fn a_comparison_is_taken_on_load_where_both_weeks_carry_it() {
        let current = period(5, 7_200.0, 320.0);
        let previous = period(4, 5_000.0, 250.0);

        let comparison = period_comparison(&current, &previous).expect("a comparison");

        assert!(matches!(comparison.metric, crate::FfiLoadMetric::Tss));
        assert_eq!(comparison.current, 320.0);
        assert_eq!(comparison.previous, 250.0);
        assert!(
            (comparison.ratio - 0.28).abs() < 1e-9,
            "{}",
            comparison.ratio
        );
    }

    #[test]
    fn a_week_without_load_is_compared_on_moving_time() {
        let comparison =
            period_comparison(&period(5, 7_200.0, 0.0), &period(4, 5_000.0, 250.0)).expect("one");

        assert!(matches!(comparison.metric, crate::FfiLoadMetric::Duration));
        assert_eq!(comparison.current, 7_200.0);
        assert_eq!(comparison.previous, 5_000.0);
    }

    #[test]
    fn nothing_to_divide_is_no_comparison() {
        assert!(period_comparison(&period(5, 7_200.0, 320.0), &period(0, 0.0, 0.0)).is_none());
        assert!(period_comparison(&period(0, 0.0, 0.0), &period(4, 5_000.0, 250.0)).is_none());
    }

    #[test]
    fn a_week_with_no_activity_gets_no_comparison_but_the_one_before_it_still_does() {
        let (week_over_week, week_against_chronic) = period_comparisons(
            &period(0, 0.0, 0.0),
            &period(4, 5_000.0, 250.0),
            &chronic_week_average(&period(12, 20_000.0, 1_000.0)),
        );

        assert!(week_over_week.is_none(), "no week to compare");
        let chronic = week_against_chronic.expect("last week against the average");
        assert_eq!(
            chronic.previous, 250.0,
            "the chronic window over four weeks"
        );
        assert_eq!(chronic.ratio, 0.0);
    }

    #[test]
    fn the_chronic_window_is_averaged_over_four_weeks() {
        let average = chronic_week_average(&period(12, 20_000.0, 1_000.0));

        assert_eq!(average.count, 3);
        assert_eq!(average.total_duration, 5_000.0);
        assert_eq!(average.total_tss, 250.0);
    }

    /// Scenario: the section detail screen asks for everything it can paint
    /// before its streams land, while a sync page holds the engine write lock.
    ///
    /// Expected behaviour: the bundle is committed rows, so it goes through the
    /// reader pool and takes no engine lock. The engine path answers the count,
    /// the per-activity metrics and the section record from memory, and the
    /// pooled one from the rows that memory was loaded from, so the two have to
    /// agree or the screen shows one of two libraries depending on which served
    /// it.
    #[test]
    fn the_pooled_section_detail_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("section_detail_parity.db");
        let db_path = path.to_str().expect("utf-8");
        // The pooled overlay resolves through `read_cache`, whose stamp is one
        // process-wide path. Bind it to this database or the read answers with
        // whatever the last test left in the slot.
        crate::persistence::read_pool::bind(db_path);
        let mut engine = engine_with_a_traversed_section(db_path);

        let through_the_lock = engine.section_detail_data("auto1", 500.0);
        let through_the_pool = pooled::section_detail_data(&engine.db, "auto1", 500.0);

        assert_eq!(
            through_the_pool.activity_count, through_the_lock.activity_count,
            "the same library size"
        );
        assert_eq!(
            through_the_pool.section.as_ref().map(|s| s.id.clone()),
            through_the_lock.section.as_ref().map(|s| s.id.clone()),
            "the same section"
        );
        assert_eq!(
            through_the_pool.section.as_ref().map(|s| s.name.clone()),
            through_the_lock.section.as_ref().map(|s| s.name.clone()),
            "and the same name, overlay included"
        );
        assert_eq!(
            through_the_pool
                .activity_metrics
                .iter()
                .map(|m| m.activity_id.clone())
                .collect::<Vec<_>>(),
            through_the_lock
                .activity_metrics
                .iter()
                .map(|m| m.activity_id.clone())
                .collect::<Vec<_>>(),
            "the same activities, in the same order"
        );
        assert_eq!(
            through_the_pool.excluded_activity_ids, through_the_lock.excluded_activity_ids,
            "the same exclusions"
        );
        assert_eq!(
            through_the_pool.has_original_bounds, through_the_lock.has_original_bounds,
            "the same bounds state"
        );
        assert_eq!(
            through_the_pool.map_signatures.len(),
            through_the_lock.map_signatures.len(),
            "the same signatures"
        );
        assert_eq!(
            through_the_pool.missing_time_stream_ids, through_the_lock.missing_time_stream_ids,
            "the same streams still owed"
        );
        assert_eq!(
            through_the_pool.history.len(),
            through_the_lock.history.len(),
            "the same lifecycle events"
        );
        assert_eq!(
            through_the_pool.geometry_versions.len(),
            through_the_lock.geometry_versions.len(),
            "the same geometry versions"
        );
        assert_eq!(
            through_the_pool.pinned_version, through_the_lock.pinned_version,
            "and the same pin"
        );
        assert_eq!(
            through_the_pool.excluded_laps.len(),
            through_the_lock.excluded_laps.len(),
            "the same excluded laps"
        );
        assert_eq!(
            through_the_pool.nearby.len(),
            through_the_lock.nearby.len(),
            "the same neighbours"
        );
        assert_eq!(
            through_the_pool.merge_candidates.len(),
            through_the_lock.merge_candidates.len(),
            "the same merge candidates"
        );

        assert_eq!(
            through_the_lock.activity_metrics.len(),
            2,
            "the fixture has two traversals, so the equalities above compare something"
        );
    }

    /// Scenario: the section detail screen asks for its performance bundle
    /// while a sync page holds the engine write lock, and waits out the commit.
    ///
    /// Expected behaviour: the bundle is readable from SQLite alone, so it goes
    /// through the reader pool and takes no engine lock. The pooled answer has
    /// to be the same answer, or the screen shows one of two libraries
    /// depending on which path served it.
    #[test]
    fn the_pooled_section_performance_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("section_perf_parity.db");
        let mut engine = engine_with_a_traversed_section(path.to_str().expect("utf-8"));

        for sport in [None, Some("Ride"), Some("Run")] {
            let through_the_lock = engine.section_detail_performance("auto1", 0, sport);
            let through_the_pool =
                pooled::section_detail_performance(&engine.db, "auto1", 0, sport);

            assert_eq!(
                through_the_pool.performances.records.len(),
                through_the_lock.performances.records.len(),
                "the same efforts for {sport:?}"
            );
            assert_eq!(
                through_the_pool
                    .performances
                    .best_record
                    .as_ref()
                    .map(|r| r.best_time),
                through_the_lock
                    .performances
                    .best_record
                    .as_ref()
                    .map(|r| r.best_time),
                "and the same PR for {sport:?}"
            );
            assert_eq!(
                through_the_pool.chart_data.points.len(),
                through_the_lock.chart_data.points.len(),
                "the same scatter for {sport:?}"
            );
            assert_eq!(
                through_the_pool.chart_data.best_pace, through_the_lock.chart_data.best_pace,
                "the same fastest run for {sport:?}"
            );
            assert_eq!(
                through_the_pool.calendar_summary.is_some(),
                through_the_lock.calendar_summary.is_some(),
                "a calendar on one path is a calendar on both for {sport:?}"
            );
        }
    }

    /// A window that excludes every effort is the empty answer on both paths,
    /// not a panic and not the unfiltered one.
    #[test]
    fn the_pooled_section_performance_honours_the_time_range() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("section_perf_window.db");
        let mut engine = engine_with_a_traversed_section(path.to_str().expect("utf-8"));

        // The fixture's efforts are from 2023, so a one-day window holds none.
        let through_the_lock = engine.section_detail_performance("auto1", 1, None);
        let through_the_pool = pooled::section_detail_performance(&engine.db, "auto1", 1, None);

        assert!(
            through_the_lock.chart_data.points.is_empty(),
            "nothing inside a one-day window"
        );
        assert_eq!(
            through_the_pool.chart_data.points.len(),
            through_the_lock.chart_data.points.len()
        );
    }

    fn track(n: usize) -> Vec<crate::GpsPoint> {
        (0..n)
            .map(|i| crate::GpsPoint {
                latitude: 46.0 + i as f64 * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// Scenario: the widget draws 150 points, and the writer runs on every
    /// background transition and every settled sync. The whole track crossed
    /// the FFI boundary each time so JavaScript could keep 150 of it.
    ///
    /// Expected behaviour: the stride happens before the crossing, and produces
    /// the same points the projection would have kept.
    #[test]
    fn a_long_track_crosses_at_the_cap_not_at_its_length() {
        let strided = stride_track(track(5_000), 150);

        assert!(
            strided.len() <= 151,
            "150 points, plus the last one the stride missed: {}",
            strided.len()
        );
        assert_eq!(strided[0].latitude, 46.0, "it starts where the ride did");
        assert_eq!(
            strided.last().unwrap().latitude,
            46.0 + 4_999.0 * 0.001,
            "and ends where it did: the outline closes on that point"
        );
    }

    /// A track already under the cap is handed over whole. Striding it would
    /// throw away detail for nothing.
    #[test]
    fn a_short_track_is_not_strided() {
        assert_eq!(stride_track(track(100), 150).len(), 100);
        assert_eq!(stride_track(track(150), 150).len(), 150);
    }

    /// Zero is a caller asking for no cap, not for no points.
    #[test]
    fn no_cap_means_the_whole_track() {
        assert_eq!(stride_track(track(5_000), 0).len(), 5_000);
    }

    /// An empty track strides to nothing rather than panicking on its last
    /// index.
    #[test]
    fn an_empty_track_strides_to_nothing() {
        assert!(stride_track(Vec::new(), 150).is_empty());
    }

    /// Scenario: the feed card drew its sparklines from a second engine call
    /// beside the bundle it had already read.
    ///
    /// Expected behaviour: the bundle carries them, and a pooled reader and a
    /// lock holder answer the same. An athlete with no wellness gets `None`,
    /// which is an answer rather than an empty chart.
    #[test]
    fn the_startup_bundle_carries_the_card_sparklines() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("sparkline_bundle.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let window = (1_699_000_000, 1_701_000_000, 1_698_000_000, 1_699_000_000);
        let ids: Vec<String> = Vec::new();

        assert!(
            engine
                .startup_data(window.0, window.1, window.2, window.3, &ids)
                .sparklines
                .is_none(),
            "an athlete with no wellness has no line to draw"
        );

        let today = crate::persistence::wellness::today_iso();
        engine
            .db
            .execute(
                "INSERT INTO wellness (date, ctl, atl, hrv, resting_hr) VALUES (?1, 70.0, 60.0, 55.0, 48.0)",
                rusqlite::params![today],
            )
            .expect("wellness");

        let through_the_lock = engine.startup_data(window.0, window.1, window.2, window.3, &ids);
        let through_the_pool =
            pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids);

        let locked = through_the_lock.sparklines.expect("a day of wellness");
        let pooled_lines = through_the_pool.sparklines.expect("a day of wellness");
        assert_eq!(pooled_lines.fitness, locked.fitness);
        assert_eq!(pooled_lines.fatigue, locked.fatigue);
        assert_eq!(pooled_lines.form, locked.form);
        assert_eq!(pooled_lines.hrv, locked.hrv);
        assert_eq!(pooled_lines.rhr, locked.rhr);
        assert_eq!(locked.fitness, vec![70]);
        assert_eq!(locked.form, vec![10], "form is fitness less fatigue");

        crate::persistence::read_cache::close();
    }

    /// Scenario: the feed's first paint now exists twice, once for a caller
    /// holding the engine and once for a pooled reader, and the two read
    /// different caches.
    ///
    /// Expected behaviour: the same library gives the same bundle either way.
    /// Two answers to one question is the failure this guards, and it is the
    /// price of moving a screen off the lock one screen at a time.
    #[test]
    fn the_pooled_feed_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("feed_parity.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        engine
            .add_activity("a1".into(), track(60), "Ride".into())
            .expect("add");
        engine
            .set_activity_metrics(vec![crate::types::ActivityMetrics {
                activity_id: "a1".into(),
                name: "ride".into(),
                date: 1_700_000_000,
                distance: 1000.0,
                moving_time: 600,
                elapsed_time: 600,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: Some(42.0),
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("metrics");

        let ids = vec!["a1".to_string(), "missing".to_string()];
        let window = (1_699_000_000, 1_701_000_000, 1_698_000_000, 1_699_000_000);
        let through_the_lock = engine.startup_data(window.0, window.1, window.2, window.3, &ids);
        let through_the_pool =
            pooled::startup_data(&engine.db, window.0, window.1, window.2, window.3, &ids);

        assert_eq!(
            through_the_pool.summary_card.current_week.count,
            through_the_lock.summary_card.current_week.count
        );
        assert_eq!(
            through_the_pool.summary_card.current_week.total_tss,
            through_the_lock.summary_card.current_week.total_tss
        );
        assert_eq!(
            through_the_pool.preview_tracks.len(),
            through_the_lock.preview_tracks.len(),
            "an id with no signature is left out on both paths"
        );
        assert_eq!(through_the_pool.preview_tracks.len(), 1);
        assert_eq!(
            through_the_pool.preview_tracks[0].encoded_coords,
            through_the_lock.preview_tracks[0].encoded_coords,
            "the same signature has to encode to the same line"
        );

        crate::persistence::read_cache::close();
    }

    /// Scenario: the widget snapshot now exists twice, once for a caller
    /// holding the engine and once for a pooled reader, and the two read
    /// different tiers.
    ///
    /// Expected behaviour: the same library gives the same snapshot either
    /// way. Two answers to one question is the failure this guards, and it is
    /// the price of moving a read off the lock one read at a time.
    #[test]
    fn the_pooled_widget_snapshot_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_parity.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        engine
            .add_activity("a1".into(), track(60), "Ride".into())
            .expect("add");
        engine
            .add_activity("a2".into(), track(80), "Ride".into())
            .expect("add");
        engine
            .set_activity_metrics(vec![
                widget_metric("a1", 1_700_000_000, 3_600),
                widget_metric("a2", 1_700_086_400, 3_500),
            ])
            .expect("metrics");

        let window = (1_699_000_000, 1_701_000_000, 1_698_000_000, 1_699_000_000);
        let through_the_lock =
            engine.widget_snapshot_data(window.0, window.1, window.2, window.3, 42, 150);
        let through_the_pool = pooled::widget_snapshot_data(
            &engine.db, window.0, window.1, window.2, window.3, 42, 150,
        );

        assert_eq!(
            through_the_pool
                .latest
                .as_ref()
                .map(|m| m.activity_id.clone()),
            through_the_lock
                .latest
                .as_ref()
                .map(|m| m.activity_id.clone()),
            "both paths call the newest activity the latest one"
        );
        assert_eq!(through_the_pool.latest.as_ref().unwrap().activity_id, "a2");
        assert_eq!(through_the_pool.latest_is_pr, through_the_lock.latest_is_pr);
        assert_eq!(
            through_the_pool.latest_gps.len(),
            through_the_lock.latest_gps.len(),
            "the same track strides to the same number of points"
        );
        assert_eq!(
            through_the_pool.summary.current_week.count,
            through_the_lock.summary.current_week.count
        );
        assert_eq!(through_the_pool.ramp_rate, through_the_lock.ramp_rate);
        assert_eq!(
            through_the_pool.sparklines.is_some(),
            through_the_lock.sparklines.is_some()
        );

        crate::persistence::read_cache::close();
    }

    /// An empty library answers the same on both paths, rather than one of
    /// them panicking on the activity that is not there.
    #[test]
    fn the_pooled_widget_snapshot_survives_an_empty_library() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("widget_empty.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let through_the_lock = engine.widget_snapshot_data(0, 1, 0, 1, 42, 150);
        let through_the_pool = pooled::widget_snapshot_data(&engine.db, 0, 1, 0, 1, 42, 150);

        assert!(through_the_lock.latest.is_none());
        assert!(through_the_pool.latest.is_none());
        assert!(!through_the_pool.latest_is_pr);
        assert!(through_the_pool.latest_gps.is_empty());

        crate::persistence::read_cache::close();
    }

    /// A ride of `moving_time` seconds over a fixed distance.
    fn widget_metric(id: &str, date: i64, moving_time: u32) -> crate::types::ActivityMetrics {
        crate::types::ActivityMetrics {
            activity_id: id.into(),
            name: id.into(),
            date,
            distance: 40_000.0,
            moving_time,
            elapsed_time: moving_time + 100,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".into(),
            training_load: Some(42.0),
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    /// Scenario: the route detail screen now exists twice, once for a caller
    /// holding the engine and once for a pooled reader, and the two read
    /// different tiers.
    ///
    /// Expected behaviour: the same library gives the same screen either way,
    /// down to which attempt is the best and what the consensus line encodes
    /// to.
    #[test]
    fn the_pooled_route_detail_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_parity.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        for (id, points) in [("a1", 60), ("a2", 80)] {
            engine
                .add_activity(id.into(), track(points), "Ride".into())
                .expect("add");
        }
        engine
            .set_activity_metrics(vec![
                widget_metric("a1", 1_700_000_000, 3_600),
                widget_metric("a2", 1_700_086_400, 3_500),
            ])
            .expect("metrics");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        let through_the_lock = engine.route_detail_data("g1", Some("a2"), 1);
        let through_the_pool = pooled::route_detail_data(&engine.db, "g1", Some("a2"), 1);

        assert_eq!(
            through_the_pool.activity_count,
            through_the_lock.activity_count
        );
        assert_eq!(through_the_pool.groups.len(), through_the_lock.groups.len());
        assert_eq!(
            through_the_pool.group.as_ref().map(|g| g.group_id.clone()),
            through_the_lock.group.as_ref().map(|g| g.group_id.clone())
        );
        assert_eq!(
            through_the_pool.performances.performances.len(),
            through_the_lock.performances.performances.len()
        );
        assert_eq!(
            through_the_pool
                .performances
                .best
                .as_ref()
                .map(|p| p.activity_id.clone()),
            through_the_lock
                .performances
                .best
                .as_ref()
                .map(|p| p.activity_id.clone()),
            "the quickest attempt is the same on both paths"
        );
        assert_eq!(
            through_the_pool.performances.current_rank,
            through_the_lock.performances.current_rank
        );
        assert_eq!(
            through_the_pool.encoded_consensus, through_the_lock.encoded_consensus,
            "the same member track is the medoid either way"
        );
        assert_eq!(
            through_the_pool.map_signatures.len(),
            through_the_lock.map_signatures.len()
        );
        assert_eq!(through_the_pool.section_ids, through_the_lock.section_ids);
        assert_eq!(
            through_the_pool.excluded_activity_ids,
            through_the_lock.excluded_activity_ids
        );

        crate::persistence::read_cache::close();
    }

    /// A route id nobody has is empty on both paths, rather than one of them
    /// answering with a shape full of zeroes.
    #[test]
    fn the_pooled_route_detail_is_empty_for_a_route_that_is_not_there() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("route_missing.db");
        let path = path.to_str().expect("utf-8");
        let mut engine = crate::persistence::PersistentEngine::new(path).expect("engine");

        let through_the_lock = engine.route_detail_data("nope", None, 1);
        let through_the_pool = pooled::route_detail_data(&engine.db, "nope", None, 1);

        assert!(through_the_lock.group.is_none());
        assert!(through_the_pool.group.is_none());
        assert!(through_the_pool.performances.performances.is_empty());
        assert!(through_the_pool.encoded_consensus.is_empty());

        crate::persistence::read_cache::close();
    }

    /// Scenario: the activity detail screen is the next read to exist twice, once
    /// for a caller holding the engine and once for a pooled reader. The engine
    /// path answers the counts and the sport from the memory tier; the pooled one
    /// has committed rows only.
    ///
    /// Expected behaviour: the same library gives the same screen either way,
    /// down to which section this activity holds the record on and what its own
    /// portion of each section encodes to.
    #[test]
    fn the_pooled_activity_detail_matches_the_one_a_lock_holder_gets() {
        use tempfile::TempDir;

        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("activity_parity.db");
        let path = path.to_str().expect("utf-8");
        // Two activities over one detected section, each with a lap time, so the
        // matched list, the traces and the record are all non-empty: a fixture
        // with no sections would let this pass on three empty vectors.
        let mut engine = engine_with_a_traversed_section(path);
        engine.load_sections().expect("sections");
        seed_route_group(&engine, "g1", &["a1", "a2"]);
        engine.load_groups().expect("groups");
        engine.load_activity_matches().expect("matches");

        // a1 is the quicker of the two traversals, so it is the one holding the
        // record the screen marks.
        let through_the_lock = engine.activity_detail_data("a1", 1);
        let through_the_pool = pooled::activity_detail_data(&engine.db, "a1", 1);

        assert!(
            !through_the_lock.matched_sections.is_empty()
                && !through_the_lock.section_traces.is_empty()
                && !through_the_lock.pr_section_ids.is_empty(),
            "the fixture has to exercise the matched sections, the traces and the record: \
             {} matched, {} traces, {} records",
            through_the_lock.matched_sections.len(),
            through_the_lock.section_traces.len(),
            through_the_lock.pr_section_ids.len()
        );
        assert_eq!(
            through_the_pool.activity_count, through_the_lock.activity_count,
            "the library is the same size through either tier"
        );
        assert_eq!(
            through_the_pool.section_count,
            through_the_lock.section_count
        );
        assert_eq!(
            through_the_pool
                .route_groups
                .iter()
                .map(|g| g.group_id.clone())
                .collect::<Vec<_>>(),
            through_the_lock
                .route_groups
                .iter()
                .map(|g| g.group_id.clone())
                .collect::<Vec<_>>(),
            "the group this activity belongs to is found either way"
        );
        assert_eq!(
            through_the_pool
                .matched_sections
                .iter()
                .map(|s| (s.id.clone(), s.encoded_polyline.clone()))
                .collect::<Vec<_>>(),
            through_the_lock
                .matched_sections
                .iter()
                .map(|s| (s.id.clone(), s.encoded_polyline.clone()))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            through_the_pool
                .custom_sections
                .iter()
                .map(|s| s.id.clone())
                .collect::<Vec<_>>(),
            through_the_lock
                .custom_sections
                .iter()
                .map(|s| s.id.clone())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            through_the_pool.encounters.len(),
            through_the_lock.encounters.len()
        );
        assert_eq!(
            through_the_pool
                .section_traces
                .iter()
                .map(|t| (t.section_id.clone(), t.encoded_coords.clone()))
                .collect::<Vec<_>>(),
            through_the_lock
                .section_traces
                .iter()
                .map(|t| (t.section_id.clone(), t.encoded_coords.clone()))
                .collect::<Vec<_>>(),
            "this activity's portion of each section encodes to the same line"
        );
        assert_eq!(
            through_the_pool.pr_section_ids, through_the_lock.pr_section_ids,
            "the records this activity holds are the same on both paths"
        );
        assert_eq!(
            through_the_pool.highlights.route_highlights.len(),
            through_the_lock.highlights.route_highlights.len()
        );
        assert_eq!(
            through_the_pool.highlights.indicators.len(),
            through_the_lock.highlights.indicators.len()
        );
    }

    /// One group holding `members`, each matched forward, as detection writes
    /// it.
    fn seed_route_group(
        engine: &crate::persistence::PersistentEngine,
        group_id: &str,
        members: &[&str],
    ) {
        let ids: Vec<String> = members.iter().map(|m| m.to_string()).collect();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES (?1, ?2, ?3, 'Ride')",
                rusqlite::params![group_id, members[0], serde_json::to_string(&ids).unwrap()],
            )
            .unwrap();
        for m in members {
            engine
                .db
                .execute(
                    "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                     VALUES (?1, ?2, 0.95, 'same')",
                    rusqlite::params![group_id, m],
                )
                .unwrap();
        }
    }
}
