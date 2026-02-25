use super::error::{with_engine, VeloqError};
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

    fn get_all(&self) -> Result<Vec<crate::FfiRouteGroup>, VeloqError> {
        with_engine(|e| {
            e.get_groups()
                .iter()
                .cloned()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
    }

    fn get_by_id(&self, group_id: String) -> Result<Option<crate::FfiRouteGroup>, VeloqError> {
        with_engine(|e| e.get_group_by_id(&group_id).map(crate::FfiRouteGroup::from))
    }

    fn get_summaries(&self) -> Result<Vec<crate::GroupSummary>, VeloqError> {
        with_engine(|e| e.get_group_summaries())
    }

    fn get_summaries_with_count(&self) -> Result<crate::FfiGroupSummariesResult, VeloqError> {
        with_engine(|e| crate::FfiGroupSummariesResult {
            total_count: e.get_group_count(),
            summaries: e.get_group_summaries(),
        })
    }

    fn get_consensus_route(&self, group_id: String) -> Result<Vec<crate::FfiGpsPoint>, VeloqError> {
        with_engine(|e| {
            e.get_consensus_route(&group_id)
                .map(|points| points.into_iter().map(crate::FfiGpsPoint::from).collect())
                .unwrap_or_default()
        })
    }

    fn get_performances(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
    ) -> Result<crate::FfiRoutePerformanceResult, VeloqError> {
        with_engine(|e| {
            let _ = e.get_groups();
            crate::FfiRoutePerformanceResult::from(
                e.get_route_performances(&group_id, current_activity_id.as_deref()),
            )
        })
    }

    fn get_screen_data(
        &self,
        group_limit: u32,
        group_offset: u32,
        section_limit: u32,
        section_offset: u32,
        min_group_activity_count: u32,
    ) -> Result<crate::FfiRoutesScreenData, VeloqError> {
        with_engine(|e| {
            e.get_routes_screen_data(
                group_limit,
                group_offset,
                section_limit,
                section_offset,
                min_group_activity_count,
            )
        })
    }

    fn set_name(&self, route_id: String, name: String) -> Result<(), VeloqError> {
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
        with_engine(|e| {
            e.set_route_name(&route_id, name_opt)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_all_names(&self) -> Result<std::collections::HashMap<String, String>, VeloqError> {
        with_engine(|e| e.get_all_route_names())
    }
}
