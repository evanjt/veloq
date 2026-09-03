use super::error::{VeloqError, with_engine};
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
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| {
            e.query_viewport(&Bounds {
                min_lat,
                max_lat,
                min_lng,
                max_lng,
            })
        })
    }

    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    fn get_screen_data(
        &self,
        start_date: i64,
        end_date: i64,
        sport_types: Vec<String>,
    ) -> Result<crate::FfiMapScreenData, VeloqError> {
        with_engine(|e| e.map_screen_data(start_date, end_date, sport_types))
    }

    fn get_all_signatures(&self) -> Result<Vec<crate::ffi_types::FfiMapSignature>, VeloqError> {
        with_engine(|e| e.get_all_map_signatures())
    }

    fn get_signatures_for_ids(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<crate::ffi_types::FfiMapSignature>, VeloqError> {
        with_engine(|e| e.get_map_signatures_for_ids(&ids))
    }
}
