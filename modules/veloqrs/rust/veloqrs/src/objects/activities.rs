use super::error::{VeloqError, with_engine};
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct ActivityManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl ActivityManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn add(
        &self,
        activity_ids: Vec<String>,
        all_coords: Vec<f64>,
        offsets: Vec<u32>,
        sport_types: Vec<String>,
    ) -> Result<(), VeloqError> {
        with_engine(|engine| {
            for (i, id) in activity_ids.iter().enumerate() {
                let start = offsets[i] as usize;
                let end = offsets
                    .get(i + 1)
                    .map(|&o| o as usize)
                    .unwrap_or(all_coords.len() / 2);
                let coords: Vec<crate::GpsPoint> = (start..end)
                    .filter_map(|j| {
                        let idx = j * 2;
                        if idx + 1 < all_coords.len() {
                            Some(crate::GpsPoint::new(all_coords[idx], all_coords[idx + 1]))
                        } else {
                            None
                        }
                    })
                    .collect();
                let sport = sport_types.get(i).cloned().unwrap_or_default();
                engine
                    .add_activity(id.clone(), coords, sport)
                    .map_err(|e| VeloqError::Database {
                        msg: format!("{}", e),
                    })?;
            }
            Ok(())
        })?
    }

    fn get_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activity_ids())
    }

    fn get_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.activity_count() as u32)
    }

    fn set_metrics(&self, metrics: Vec<crate::FfiActivityMetrics>) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_activity_metrics_extended(metrics)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_metrics_for_ids(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<crate::FfiActivityMetrics>, VeloqError> {
        with_engine(|engine| {
            ids.iter()
                .filter_map(|id| engine.activity_metrics.get(id).cloned())
                .map(crate::FfiActivityMetrics::from)
                .collect()
        })
    }

    fn set_time_streams(
        &self,
        activity_ids: Vec<String>,
        all_times: Vec<u32>,
        offsets: Vec<u32>,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_time_streams_flat(&activity_ids, &all_times, &offsets);
        })
    }

    fn get_missing_time_streams(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activities_missing_time_streams(&activity_ids))
    }

    fn get_gps_track(&self, activity_id: String) -> Result<Vec<crate::FfiGpsPoint>, VeloqError> {
        with_engine(|e| {
            e.get_gps_track(&activity_id)
                .map(|points| points.into_iter().map(crate::FfiGpsPoint::from).collect())
                .unwrap_or_default()
        })
    }

    fn remove(&self, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.remove_activity(&activity_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn debug_clone(&self, source_id: String, count: u32) -> Result<u32, VeloqError> {
        with_engine(|e| e.debug_clone_activity(&source_id, count))
    }

    /// Combined activity-list highlight bundle: section indicators (PRs +
    /// trends) and route highlights for the same batch of activity IDs in a
    /// single FFI round-trip. Consumed by `useActivitySectionHighlights`.
    fn get_highlights_bundle(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<crate::FfiActivityHighlightsBundle, VeloqError> {
        with_engine(|e| crate::FfiActivityHighlightsBundle {
            indicators: e.get_activity_indicators(&activity_ids),
            route_highlights: e.get_activity_route_highlights(&activity_ids),
        })
    }
}
