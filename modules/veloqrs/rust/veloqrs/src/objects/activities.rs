use crate::persistence::with_persistent_engine;
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
    ) {
        with_persistent_engine(|engine| {
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
                engine.add_activity(id.clone(), coords, sport).ok();
            }
        });
    }

    fn get_ids(&self) -> Vec<String> {
        with_persistent_engine(|e| e.get_activity_ids()).unwrap_or_default()
    }

    fn get_count(&self) -> u32 {
        with_persistent_engine(|e| e.activity_count() as u32).unwrap_or(0)
    }

    fn set_metrics(&self, metrics: Vec<crate::FfiActivityMetrics>) {
        with_persistent_engine(|e| {
            e.set_activity_metrics_extended(metrics).ok();
        });
    }

    fn get_metrics_for_ids(&self, ids: Vec<String>) -> Vec<crate::FfiActivityMetrics> {
        with_persistent_engine(|engine| {
            ids.iter()
                .filter_map(|id| engine.activity_metrics.get(id).cloned())
                .map(crate::FfiActivityMetrics::from)
                .collect()
        })
        .unwrap_or_default()
    }

    fn set_time_streams(&self, activity_ids: Vec<String>, all_times: Vec<u32>, offsets: Vec<u32>) {
        with_persistent_engine(|e| {
            e.set_time_streams_flat(&activity_ids, &all_times, &offsets);
        });
    }

    fn get_missing_time_streams(&self, activity_ids: Vec<String>) -> Vec<String> {
        with_persistent_engine(|e| e.get_activities_missing_time_streams(&activity_ids))
            .unwrap_or(activity_ids)
    }

    fn get_gps_track(&self, activity_id: String) -> Vec<crate::FfiGpsPoint> {
        with_persistent_engine(|e| {
            e.get_gps_track(&activity_id)
                .map(|points| points.into_iter().map(crate::FfiGpsPoint::from).collect())
                .unwrap_or_default()
        })
        .unwrap_or_default()
    }

    fn remove(&self, activity_id: String) -> bool {
        with_persistent_engine(|e| e.remove_activity(&activity_id).is_ok()).unwrap_or(false)
    }

    fn debug_clone(&self, source_id: String, count: u32) -> u32 {
        with_persistent_engine(|e| e.debug_clone_activity(&source_id, count)).unwrap_or(0)
    }
}
