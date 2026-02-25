use crate::persistence::with_persistent_engine;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct RouteManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl RouteManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_all(&self) -> Vec<crate::FfiRouteGroup> {
        with_persistent_engine(|e| {
            e.get_groups()
                .iter()
                .cloned()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
        .unwrap_or_default()
    }

    fn get_by_id(&self, group_id: String) -> Option<crate::FfiRouteGroup> {
        with_persistent_engine(|e| e.get_group_by_id(&group_id).map(crate::FfiRouteGroup::from))
            .flatten()
    }

    fn get_count(&self) -> u32 {
        with_persistent_engine(|e| e.get_group_count()).unwrap_or(0)
    }

    fn get_summaries(&self) -> Vec<crate::GroupSummary> {
        with_persistent_engine(|e| e.get_group_summaries()).unwrap_or_default()
    }

    fn get_consensus_route(&self, group_id: String) -> Vec<f64> {
        with_persistent_engine(|e| {
            e.get_consensus_route(&group_id)
                .map(|points| {
                    points
                        .iter()
                        .flat_map(|p| vec![p.latitude, p.longitude])
                        .collect()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default()
    }

    fn get_performances(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
    ) -> crate::FfiRoutePerformanceResult {
        with_persistent_engine(|e| {
            let _ = e.get_groups();
            crate::FfiRoutePerformanceResult::from(
                e.get_route_performances(&group_id, current_activity_id.as_deref()),
            )
        })
        .unwrap_or_else(|| crate::FfiRoutePerformanceResult {
            performances: vec![],
            activity_metrics: vec![],
            best: None,
            best_forward: None,
            best_reverse: None,
            forward_stats: None,
            reverse_stats: None,
            current_rank: None,
        })
    }

    fn get_screen_data(
        &self,
        group_limit: u32,
        group_offset: u32,
        section_limit: u32,
        section_offset: u32,
        min_group_activity_count: u32,
    ) -> Option<crate::FfiRoutesScreenData> {
        with_persistent_engine(|e| {
            e.get_routes_screen_data(
                group_limit,
                group_offset,
                section_limit,
                section_offset,
                min_group_activity_count,
            )
        })
    }

    fn set_name(&self, route_id: String, name: String) {
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
        with_persistent_engine(|e| {
            e.set_route_name(&route_id, name_opt).ok();
        });
    }

    fn get_all_names(&self) -> std::collections::HashMap<String, String> {
        with_persistent_engine(|e| e.get_all_route_names()).unwrap_or_default()
    }
}
