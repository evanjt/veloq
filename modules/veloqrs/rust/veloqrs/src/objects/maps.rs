use crate::persistence::with_persistent_engine;
use std::sync::Arc;
use tracematch::Bounds;

#[derive(uniffi::Object)]
pub struct MapManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl MapManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn query_viewport(
        &self,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Vec<String> {
        with_persistent_engine(|e| {
            e.query_viewport(&Bounds {
                min_lat,
                max_lat,
                min_lng,
                max_lng,
            })
        })
        .unwrap_or_default()
    }

    fn get_filtered(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types_json: String,
    ) -> Vec<crate::persistence::MapActivityComplete> {
        with_persistent_engine(|e| {
            let sport_filter: Option<std::collections::HashSet<String>> =
                if sport_types_json.is_empty() {
                    None
                } else {
                    serde_json::from_str::<Vec<String>>(&sport_types_json)
                        .ok()
                        .map(|v| v.into_iter().collect())
                };
            e.activity_metadata
                .iter()
                .filter_map(|(id, meta)| {
                    let metrics = e.activity_metrics.get(id)?;
                    if metrics.date < start_date || metrics.date > end_date {
                        return None;
                    }
                    if let Some(ref filter) = sport_filter {
                        if !filter.contains(&meta.sport_type) {
                            return None;
                        }
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
        })
        .unwrap_or_default()
    }

    fn get_all_signatures(&self) -> Vec<crate::ffi_types::FfiMapSignature> {
        with_persistent_engine(|e| e.get_all_map_signatures()).unwrap_or_default()
    }
}
