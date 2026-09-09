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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};
    use crate::with_persistent_engine;
    use tracematch::GpsPoint;

    #[test]
    fn the_viewport_and_the_screen_read_the_seeded_activity() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("maps.db");
        let maps = MapManager::new();
        assert!(
            maps.query_viewport(46.0, 47.0, 7.0, 8.0)
                .unwrap()
                .is_empty()
        );
        assert!(maps.get_all_signatures().unwrap().is_empty());

        with_persistent_engine(|e| {
            let track: Vec<GpsPoint> = (0..8)
                .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
                .collect();
            e.add_activity("a1".into(), track, "Ride".into()).unwrap();
            e.update_activity_metadata(
                "a1",
                Some(1_700_000_000),
                Some("ride"),
                Some(1000.0),
                Some(600),
            )
            .unwrap();
            // The sport chips and the window read the metrics a sync fills.
            e.set_activity_metrics(vec![crate::types::ActivityMetrics {
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
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .unwrap();
        })
        .unwrap();

        assert_eq!(
            maps.query_viewport(46.0, 47.0, 7.0, 8.0).unwrap(),
            vec!["a1"]
        );
        assert!(
            maps.query_viewport(48.0, 49.0, 7.0, 8.0)
                .unwrap()
                .is_empty()
        );
        assert_eq!(maps.get_all_signatures().unwrap().len(), 1);

        let screen = maps
            .get_screen_data(1_600_000_000, 1_800_000_000, vec!["Ride".into()])
            .unwrap();
        assert_eq!(screen.activity_count, 1);
        assert_eq!(screen.available_sport_types, vec!["Ride"]);
        assert_eq!(screen.activities.len(), 1);
        let outside = maps
            .get_screen_data(1_800_000_000, 1_900_000_000, vec![])
            .unwrap();
        assert_eq!(
            outside.activity_count, 1,
            "the total is the library, not the window"
        );
        assert!(outside.activities.is_empty());
    }
}
