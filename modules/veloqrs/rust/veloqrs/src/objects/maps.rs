use super::error::{VeloqError, with_reader};
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
        // Off the engine lock: this runs on every viewport change of a pan,
        // and the stored bounds it reads are indexed columns.
        with_reader(|conn| {
            crate::persistence::activities::pooled::activities_in_viewport(
                conn,
                &Bounds {
                    min_lat,
                    max_lat,
                    min_lng,
                    max_lng,
                },
            )
        })
    }

    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    // The FFI signature, which takes each layer switch as its own argument.
    #[allow(clippy::too_many_arguments)]
    fn get_screen_data(
        &self,
        start_date: f64,
        end_date: f64,
        sport_types: Vec<String>,
        distance_band: crate::MapDistanceBand,
        is_metric: bool,
        route_lines: bool,
        sections: bool,
        name_needle: String,
    ) -> Result<crate::FfiMapScreenData, VeloqError> {
        let start_date = crate::ffi_types::int_from_wire(start_date);
        let end_date = crate::ffi_types::int_from_wire(end_date);
        // Off the engine lock: the map tab is dragged, and this read needs
        // nothing the engine holds in memory.
        with_reader(|conn| {
            crate::persistence::screens::pooled::map_screen_data(
                conn,
                start_date,
                end_date,
                sport_types,
                distance_band,
                is_metric,
                route_lines,
                sections,
                name_needle,
            )
        })
    }

    fn get_all_signatures(&self) -> Result<Vec<crate::ffi_types::FfiMapSignature>, VeloqError> {
        with_reader(crate::persistence::activities::pooled::all_map_signatures)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
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
            .get_screen_data(
                1_600_000_000.0,
                1_800_000_000.0,
                vec!["Ride".into()],
                crate::MapDistanceBand::All,
                true,
                false,
                false,
                String::new(),
            )
            .unwrap();
        assert_eq!(screen.activity_count, 1);
        assert_eq!(screen.available_sport_types, vec!["Ride"]);
        assert_eq!(screen.activities.len(), 1);
        let outside = maps
            .get_screen_data(
                1_800_000_000.0,
                1_900_000_000.0,
                vec![],
                crate::MapDistanceBand::All,
                true,
                false,
                false,
                String::new(),
            )
            .unwrap();
        assert_eq!(
            outside.activity_count, 1,
            "the total is the library, not the window"
        );
        assert!(outside.activities.is_empty());
    }

    /// Scenario: the athlete drags the map while a sync page commits.
    ///
    /// Expected behaviour: the map tab's read does not wait for the writer,
    /// because it goes to the read pool and never asks for the engine lock the
    /// writer is holding. A wait would cost the athlete frames on a drag.
    #[test]
    fn the_map_screen_read_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("maps_under_a_writer.db");
        let maps = MapManager::new();

        let screen = read_while_writer_holds(|| {
            maps.get_screen_data(
                1_600_000_000.0,
                1_800_000_000.0,
                Vec::new(),
                crate::MapDistanceBand::All,
                true,
                false,
                false,
                String::new(),
            )
            .expect("the map tab reads while a writer holds the engine")
        });

        assert_eq!(screen.activity_count, 0);
    }

    fn seed_box(e: &mut crate::persistence::PersistentEngine, id: &str, lat: f64, lng: f64) {
        let track: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint::new(lat + f64::from(i) * 0.01, lng + f64::from(i) * 0.01))
            .collect();
        e.add_activity(id.into(), track, "Ride".into()).unwrap();
    }

    /// Scenario: the athlete pans the regional map while a sync page commits.
    ///
    /// Expected behaviour: the viewport query goes to the read pool, so it
    /// does not wait out the writer.
    #[test]
    fn the_viewport_query_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("viewport_under_a_writer.db");
        let maps = MapManager::new();
        with_persistent_engine(|e| seed_box(e, "a1", 46.2, 7.3)).unwrap();

        let ids = read_while_writer_holds(|| {
            maps.query_viewport(46.0, 47.0, 7.0, 8.0)
                .expect("the viewport reads while a writer holds the engine")
        });

        assert_eq!(ids, vec!["a1"]);
    }

    /// Expected behaviour: the stored-bounds query returns the same set as the
    /// engine's in-memory index for empty, edge-touching, inverted and
    /// all-covering windows.
    #[test]
    fn the_viewport_query_matches_the_in_memory_index() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("viewport_parity.db");
        let maps = MapManager::new();
        with_persistent_engine(|e| {
            seed_box(e, "a1", 46.2, 7.3);
            seed_box(e, "a2", 46.5, 7.6);
            seed_box(e, "a3", 10.0, 10.0);
        })
        .unwrap();

        let windows = [
            (0.0, 1.0, 0.0, 1.0),
            (46.0, 47.0, 7.0, 8.0),
            (45.0, 46.2, 7.0, 8.0),
            (46.27, 46.4, 7.0, 8.0),
            (46.28, 46.4, 7.0, 8.0),
            (47.0, 46.0, 8.0, 7.0),
            (-90.0, 90.0, -180.0, 180.0),
            (46.2, 46.2, 7.3, 7.3),
        ];
        for (min_lat, max_lat, min_lng, max_lng) in windows {
            let mut want = with_persistent_engine(|e| {
                e.query_viewport(&Bounds {
                    min_lat,
                    max_lat,
                    min_lng,
                    max_lng,
                })
            })
            .unwrap();
            let mut got = maps
                .query_viewport(min_lat, max_lat, min_lng, max_lng)
                .unwrap();
            want.sort();
            got.sort();
            assert_eq!(got, want, "window {min_lat},{max_lat},{min_lng},{max_lng}");
        }
        assert_eq!(
            maps.query_viewport(-90.0, 90.0, -180.0, 180.0)
                .unwrap()
                .len(),
            3
        );
        assert!(maps.query_viewport(0.0, 1.0, 0.0, 1.0).unwrap().is_empty());
        assert_eq!(
            maps.query_viewport(45.0, 46.2, 7.0, 8.0).unwrap(),
            vec!["a1"]
        );
    }

    /// Expected behaviour: the bounds query is answered from the bounds index
    /// rather than a scan of the activities table.
    #[test]
    fn the_viewport_query_plan_uses_the_bounds_index() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("viewport_plan.db");
        let plan =
            with_reader(crate::persistence::activities::pooled::viewport_query_plan).unwrap();
        assert!(
            plan.iter().any(|d| d.contains("idx_activities_bounds")),
            "plan: {plan:?}"
        );
    }

    /// Scenario: the map tab asks for every activity's line while a sync page
    /// commits.
    ///
    /// Expected behaviour: the lines come from the read pool, so the read
    /// does not wait out the writer, and they are the lines the engine's own
    /// read gives.
    #[test]
    fn every_signature_reads_without_waiting_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("map_signatures_under_a_writer.db");
        let maps = MapManager::new();
        with_persistent_engine(|e| {
            for (id, lng) in [("a1", 7.35), ("a2", 7.45)] {
                let track: Vec<GpsPoint> = (0..8)
                    .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, lng))
                    .collect();
                e.add_activity(id.into(), track, "Ride".into()).unwrap();
            }
        })
        .unwrap();
        let expected = with_persistent_engine(|e| e.get_all_map_signatures()).unwrap();

        let mut lines = read_while_writer_holds(|| maps.get_all_signatures().expect("signatures"));

        let mut expected = expected;
        lines.sort_by(|a, b| a.activity_id.cmp(&b.activity_id));
        expected.sort_by(|a, b| a.activity_id.cmp(&b.activity_id));
        assert_eq!(lines.len(), 2);
        for (line, want) in lines.iter().zip(&expected) {
            assert_eq!(line.activity_id, want.activity_id);
            assert_eq!(line.encoded_coords, want.encoded_coords);
            assert_eq!(line.center_lat, want.center_lat);
            assert_eq!(line.center_lng, want.center_lng);
        }
    }
}
