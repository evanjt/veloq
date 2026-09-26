use super::error::{VeloqError, with_engine, with_reader};
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
        // Off the engine lock: the map tab is dragged, and this read needs
        // nothing the engine holds in memory.
        with_reader(|conn| {
            crate::persistence::screens::pooled::map_screen_data(
                conn,
                start_date,
                end_date,
                sport_types,
            )
        })
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
    use std::sync::Arc as StdArc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tracematch::GpsPoint;

    /// One 60 Hz frame. The map tab is dragged, so a read over this drops a
    /// frame the athlete sees.
    const FRAME_BUDGET: Duration = Duration::from_millis(16);

    /// Long enough that a wait on the writer cannot be read as scheduling
    /// noise.
    const WRITE_HOLD: Duration = Duration::from_millis(200);

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

    /// Scenario: the athlete drags the map while a sync page commits.
    ///
    /// Expected behaviour: the map tab's read is served inside a frame,
    /// because it goes to the read pool and never asks for the engine lock the
    /// writer is holding.
    #[test]
    fn the_map_screen_read_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("maps_under_a_writer.db");
        let maps = MapManager::new();

        let holding = StdArc::new(AtomicBool::new(false));
        let signal = StdArc::clone(&holding);
        let writer = std::thread::spawn(move || {
            with_persistent_engine(|_| {
                signal.store(true, Ordering::SeqCst);
                std::thread::sleep(WRITE_HOLD);
            });
        });
        while !holding.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }

        let started = Instant::now();
        let screen = maps
            .get_screen_data(1_600_000_000, 1_800_000_000, Vec::new())
            .expect("the map tab reads while a writer holds the engine");
        let waited = started.elapsed();

        assert_eq!(screen.activity_count, 0);
        assert!(
            waited < FRAME_BUDGET,
            "the map screen read waited {waited:?} behind a writer, which is over a frame"
        );

        writer.join().expect("writer");
    }
}
