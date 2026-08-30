//! Per-screen data bundles.
//!
//! One method per rendered surface, each composing the reads that screen used
//! to make one at a time. Living on `PersistentRouteEngine` keeps the FFI
//! objects thin and lets tests compare a bundle against the individual calls
//! it replaces without standing up the global engine.

use crate::objects::strength::aggregate_strength_sets;
use crate::sections::SectionType;

impl super::PersistentRouteEngine {
    /// Everything the insights pipeline reads from the engine.
    ///
    /// Period stats, trends and patterns, plus the section and strength tail,
    /// in one call. The efficiency trends arrive already filtered and capped,
    /// so the generator renders what it is given rather than probing sections
    /// one by one.
    pub fn insights_data(&mut self, p: &crate::FfiInsightsParams) -> crate::FfiInsightsData {
        let now_ts = p.current_end;

        // Period stats (4 queries, all in one engine lock)
        let current_week = self.get_period_stats(p.current_start, p.current_end);
        let previous_week = self.get_period_stats(p.prev_start, p.prev_end);
        let chronic_period = self.get_period_stats(p.chronic_start, p.prev_start);
        let today_period = self.get_period_stats(p.today_start, now_ts);

        // Trends
        let ftp_trend = self.get_ftp_trend();
        let run_pace_trend = self.get_pace_trend("Run");

        // Activity patterns
        let all_patterns =
            crate::patterns::compute_activity_patterns(&self.db, &self.activity_metrics);
        let today_pattern =
            crate::patterns::get_pattern_for_today(&self.db, &self.activity_metrics);

        // Recent PRs - loop stays in Rust, never crosses FFI
        let seven_days_ago = now_ts - 7 * 86400;
        let mut recent_prs = Vec::new();
        let available_sports = self.get_available_sport_types();
        // One candidate per (section, sport): shared ground holds a record in
        // each sport that travels it, and neither may be measured against the
        // other's laps.
        let mut all_summaries: Vec<(String, crate::SectionSummary)> = available_sports
            .iter()
            .flat_map(|sport| {
                self.get_section_summaries_for_sport(sport)
                    .into_iter()
                    .map(move |s| (sport.clone(), s))
            })
            // Outings, not passes: a PR slot is earned by returning.
            .filter(|(_, s)| s.activity_count >= 3)
            .collect();
        all_summaries.sort_by_key(|(_, s)| std::cmp::Reverse(s.visit_count));

        for (sport, s) in &all_summaries {
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
                let days_ago = crate::calendar_days_between(record.activity_date, now_ts);
                // One row per section, the freshest. A section holds a record
                // in each sport that travels it, and the surface shows one.
                match recent_prs
                    .iter_mut()
                    .find(|p: &&mut crate::FfiRecentPR| p.section_id == s.id)
                {
                    Some(held) if days_ago < held.days_ago => {
                        held.best_time = record.best_time;
                        held.days_ago = days_ago;
                    }
                    Some(_) => {}
                    None => recent_prs.push(crate::FfiRecentPR {
                        section_id: s.id.clone(),
                        section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                        best_time: record.best_time,
                        days_ago,
                    }),
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

        let ranked_sections: Vec<crate::FfiRankedSectionsBySport> = if sections_ready {
            sport_types
                .iter()
                .map(|sport| crate::FfiRankedSectionsBySport {
                    sections: self.get_ranked_sections(sport, p.ranked_limit),
                    sport_type: sport.clone(),
                })
                .collect()
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

        crate::FfiInsightsData {
            current_week,
            previous_week,
            chronic_period,
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
        }
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
                .get_exercise_sets_in_range(month.start_ts, month.end_ts)
                .ok()?,
        );
        let mut weekly = Vec::with_capacity(weeks.len());
        for range in weeks {
            let sets = self
                .get_exercise_sets_in_range(range.start_ts, range.end_ts)
                .ok()?;
            weekly.push(aggregate_strength_sets(&sets));
        }
        Some(crate::FfiStrengthInsightSeries { monthly, weekly })
    }

    /// Everything the activity detail screen paints with.
    ///
    /// `min_route_activities` filters the route groups the way the screen used
    /// to filter them after the fact.
    pub fn activity_detail_data(
        &mut self,
        activity_id: &str,
        min_route_activities: u32,
    ) -> crate::FfiActivityDetailData {
        let all_groups = self.get_groups().to_vec();
        let total_route_group_count = all_groups.len() as u32;
        let mut route_groups: Vec<crate::FfiRouteGroup> = all_groups
            .into_iter()
            .filter(|g| g.activity_ids.len() as u32 >= min_route_activities)
            .map(crate::FfiRouteGroup::from)
            .collect();
        route_groups.sort_by_key(|g| std::cmp::Reverse(g.activity_ids.len()));

        let matched = self.get_sections_for_activity(activity_id);
        let custom = self.get_sections_by_type(Some(SectionType::Custom));

        // Trace targets mirror what the screen drew: every matched section,
        // then the custom sections naming this activity that the match list
        // did not already cover.
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut targets: Vec<(String, Vec<crate::GpsPoint>)> = Vec::new();
        for s in matched.iter().chain(custom.iter().filter(|s| {
            s.source_activity_id.as_deref() == Some(activity_id)
                || s.activity_ids.iter().any(|a| a == activity_id)
        })) {
            if seen.insert(s.id.as_str()) {
                targets.push((s.id.clone(), s.polyline.clone()));
            }
        }

        let track = self.get_gps_track(activity_id).unwrap_or_default();
        let section_traces: Vec<crate::FfiSectionTrace> = if track.len() < 3 {
            Vec::new()
        } else {
            targets
                .iter()
                .filter(|(_, polyline)| polyline.len() >= 2)
                .filter_map(|(section_id, polyline)| {
                    let tree = tracematch::sections::build_rtree(polyline);
                    let trace =
                        tracematch::sections::extract_activity_trace(&track, polyline, &tree);
                    if trace.is_empty() {
                        return None;
                    }
                    Some(crate::FfiSectionTrace {
                        section_id: section_id.clone(),
                        encoded_coords: crate::coords::encode(&trace),
                    })
                })
                .collect()
        };

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
            total_route_group_count,
            matched_sections: matched.into_iter().map(crate::FfiSection::from).collect(),
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
            group,
        }
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
    ) -> crate::FfiWidgetSnapshotData {
        let sparklines = self.get_wellness_sparklines(sparkline_days).ok().flatten();

        let summary = crate::FfiSummaryCardData {
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
                let is_pr = self
                    .get_activity_route_highlights(&ids)
                    .iter()
                    .any(|r| r.is_pr)
                    || self.get_activity_indicators(&ids).iter().any(|i| {
                        i.indicator_type == "section_pr" || i.indicator_type == "route_pr"
                    });
                let gps = self
                    .get_gps_track(&m.activity_id)
                    .map(|points| points.into_iter().map(crate::FfiGpsPoint::from).collect())
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
        }
    }

    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    pub fn map_screen_data(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> crate::FfiMapScreenData {
        crate::FfiMapScreenData {
            activity_count: self.activity_count() as u32,
            available_sport_types: self.get_available_sport_types(),
            activities: self.map_activities_filtered(start_date, end_date, sport_types),
        }
    }

    /// Activities inside a date window, optionally narrowed to a sport set.
    pub fn map_activities_filtered(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        let sport_filter: Option<std::collections::HashSet<String>> = if sport_types.is_empty() {
            None
        } else {
            Some(sport_types.into_iter().collect())
        };
        self.activity_metadata
            .iter()
            .filter_map(|(id, meta)| {
                let metrics = self.activity_metrics.get(id)?;
                if metrics.date < start_date || metrics.date > end_date {
                    return None;
                }
                if let Some(ref filter) = sport_filter
                    && !filter.contains(&meta.sport_type)
                {
                    return None;
                }
                Some(crate::persistence::MapActivityComplete {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    sport_type: meta.sport_type.clone(),
                    date: metrics.date,
                    distance: metrics.distance,
                    duration: metrics.moving_time,
                    bounds: meta.bounds.into(),
                })
            })
            .collect()
    }
}
