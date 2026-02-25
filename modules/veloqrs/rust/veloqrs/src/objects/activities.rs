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

    fn get_gps_track(&self, activity_id: String) -> Vec<f64> {
        with_persistent_engine(|e| {
            e.get_gps_track(&activity_id)
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
}
