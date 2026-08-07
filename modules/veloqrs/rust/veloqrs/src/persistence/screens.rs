//! Per-screen data bundles.
//!
//! One method per rendered surface, each composing the reads that screen used
//! to make one at a time. Living on `PersistentRouteEngine` keeps the FFI
//! objects thin and lets tests compare a bundle against the individual calls
//! it replaces without standing up the global engine.

use crate::sections::SectionType;

impl super::PersistentRouteEngine {
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

        let pr_section_ids: Vec<String> = targets
            .iter()
            .filter(|(section_id, _)| {
                self.get_section_performances(section_id)
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
            section: section.map(crate::FfiFrequentSection::from),
        }
    }

    /// The section detail reads that need lap times, so the caller runs this
    /// once the missing time streams have been fetched.
    ///
    /// The calendar summary is computed first because it reads the unfiltered
    /// performances; the filtered read that follows then hits the performance
    /// cache whenever no sport filter is in play.
    pub fn section_detail_performance(
        &mut self,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionPerformanceData {
        let calendar_summary = self
            .get_section_calendar_summary(section_id)
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
}
