use super::error::{VeloqError, with_reader};
use std::sync::Arc;
#[cfg(test)]
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

    // The FFI signature, which takes each layer switch as its own argument.
    #[allow(clippy::too_many_arguments)]
    /// Everything the map tab paints with: the engine total, the sport types
    /// the filter chips offer, and the activities inside the window.
    ///
    /// `held_route_lines` and `held_sections` are the stamps of the layers the
    /// caller already holds. A layer whose stamp is still current comes back
    /// without its lines, so a filter change does not ship them again.
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
        held_route_lines: Option<f64>,
        held_sections: Option<f64>,
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
                crate::persistence::screens::pooled::MapLayers {
                    route_lines: route_lines.then_some(held_route_lines),
                    sections: sections.then_some(held_sections),
                },
                name_needle,
            )
        })
    }

    /// The library's sections and routes alone, for a detail map that draws
    /// them under its subject: the two layers `get_screen_data` carries, from
    /// the same builders, without the activities.
    ///
    /// `held_sections` and `held_routes` are the stamps of the layers the
    /// caller already holds. A layer whose stamp is still current comes back
    /// without its lines, so a card push re-reads nothing.
    fn get_context_layers(
        &self,
        held_sections: Option<f64>,
        held_routes: Option<f64>,
    ) -> Result<crate::FfiMapContextLayers, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::pooled::map_context_layers(
                conn,
                held_sections,
                held_routes,
            )
        })
    }

    /// The activities whose tracks pass under a point on the heatmap, grouped
    /// by route and capped, newest first.
    ///
    /// Async because it decodes the tracks whose boxes hold the point: 7 to 9
    /// ms in release at the densest cell of a 2,077-activity library, 33 to
    /// 40 ms in debug, on a tap whose transition is already running. It takes
    /// no engine lock. A heatmap that is off answers an empty result.
    async fn activities_under_point(
        &self,
        latitude: f64,
        longitude: f64,
        zoom: u8,
    ) -> Result<crate::FfiActivitiesUnderPoint, VeloqError> {
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                crate::persistence::under_point::activities_under_point(latitude, longitude, zoom)
            })
            .await
            .unwrap_or_else(|e| {
                log::warn!("veloqrs: [MapManager] the under-point thread died: {e}");
                Err(VeloqError::NotInitialized)
            })
    }

    fn get_all_signatures(&self) -> Result<Vec<crate::ffi_types::FfiMapSignature>, VeloqError> {
        with_reader(crate::persistence::activities::pooled::all_map_signatures)
    }
}

#[cfg(test)]
impl MapManager {
    pub(crate) fn query_viewport(
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
                None,
                None,
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
                None,
                None,
            )
            .unwrap();
        assert_eq!(
            outside.activity_count, 1,
            "the total is the library, not the window"
        );
        assert!(outside.activities.is_empty());
    }

    /// Scenario: the athlete taps the map with the heatmap off.
    ///
    /// Expected behaviour: the export resolves with an empty result, not an
    /// error, so the page opens nothing.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tap_with_the_heatmap_off_answers_an_empty_result() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("under_point_off.db");
        with_persistent_engine(|e| {
            seed_box(e, "a1", 46.2, 7.3);
            e.clear_heatmap_tiles_path();
        })
        .unwrap();

        let found =
            crate::runtime::block_on(MapManager::new().activities_under_point(46.2, 7.3, 14))
                .expect("an empty answer");

        assert_eq!(found, crate::FfiActivitiesUnderPoint::default());
    }

    /// Scenario: the athlete drags the map while a sync page commits.
    ///
    /// Expected behaviour: the map tab's read does not wait for the writer,
    /// because it goes to the read pool and never asks for the engine lock the
    /// writer is holding. A wait would cost the athlete frames on a drag.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
                None,
                None,
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    /// Two places ridden four times each, a section on each place, so the map
    /// read carries both layers.
    fn seed_layers(e: &mut crate::persistence::PersistentEngine) {
        for i in 0..8u32 {
            let id = format!("a{i}");
            let base = f64::from(i / 4) * 0.05;
            let track: Vec<GpsPoint> = (0..100)
                .map(|p| GpsPoint {
                    latitude: 46.0 + base + f64::from(p) * 0.0001,
                    longitude: 7.0,
                    elevation: Some(500.0 + f64::from(p)),
                })
                .collect();
            e.add_activity(id.clone(), track.clone(), "Ride".into())
                .unwrap();
            // The map's window reads the metrics a sync fills.
            e.set_activity_metrics(vec![crate::types::ActivityMetrics {
                activity_id: id.clone(),
                name: format!("ride {i}"),
                date: 1_700_000_000 - i64::from(i) * 86_400,
                distance: 12_345.0,
                moving_time: 3_600,
                elapsed_time: 3_600,
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
            if i % 4 == 0 {
                e.create_section(crate::sections::CreateSectionParams {
                    sport_type: "Ride".into(),
                    polyline: track,
                    distance_meters: 1_100.0,
                    name: Some(format!("Section {i}")),
                    source_activity_id: Some(id.clone()),
                    start_index: Some(0),
                    end_index: Some(99),
                })
                .unwrap();
            }
        }
        assert!(!e.get_groups().is_empty(), "the seed has no route groups");
    }

    fn read_layers(
        maps: &MapManager,
        needle: &str,
        held_route_lines: Option<f64>,
        held_sections: Option<f64>,
    ) -> crate::FfiMapScreenData {
        maps.get_screen_data(
            1_600_000_000.0,
            1_800_000_000.0,
            Vec::new(),
            crate::MapDistanceBand::All,
            true,
            true,
            true,
            needle.into(),
            held_route_lines,
            held_sections,
        )
        .unwrap()
    }

    fn stamps(screen: &crate::FfiMapScreenData) -> (Option<f64>, Option<f64>) {
        (
            screen.route_lines.as_ref().and_then(|layer| layer.stamp),
            screen.sections.as_ref().and_then(|layer| layer.stamp),
        )
    }

    /// Scenario: the athlete types a name into the map's search, each letter
    /// a new map read, with both layers shown and nothing written meanwhile.
    ///
    /// Expected behaviour: the first read ships both layers; a read that
    /// passes their stamps back narrows the activities and ships neither
    /// layer again, while its counts and the route generation stay as they
    /// were. A stamp that is not current ships the layer.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_filter_change_ships_no_layer_the_caller_holds() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("map_layers_held.db");
        let maps = MapManager::new();
        with_persistent_engine(seed_layers).unwrap();

        let first = read_layers(&maps, "", None, None);
        let routes = first.route_lines.as_ref().expect("the route layer is on");
        let drawn = routes.routes.as_ref().expect("first read ships the lines");
        assert!(!drawn.is_empty());
        let sections = first.sections.as_ref().expect("the overlay is on");
        assert_eq!(
            sections
                .sections
                .as_ref()
                .expect("first read ships the overlay")
                .len(),
            2
        );
        let (route_stamp, section_stamp) = stamps(&first);
        assert!(route_stamp.is_some() && section_stamp.is_some());
        assert_eq!(first.activities.len(), 8);

        let typed = read_layers(&maps, "ride 3", route_stamp, section_stamp);
        assert_eq!(typed.activities.len(), 1, "the needle still narrows");
        let held_routes = typed.route_lines.as_ref().expect("the route layer is on");
        assert!(
            held_routes.routes.is_none(),
            "held route lines shipped again"
        );
        assert_eq!(held_routes.generation, routes.generation);
        assert_eq!(held_routes.stamp, route_stamp);
        assert_eq!(typed.route_count, first.route_count);
        let held_sections = typed.sections.as_ref().expect("the overlay is on");
        assert!(
            held_sections.sections.is_none(),
            "held overlay shipped again"
        );
        assert_eq!(held_sections.stamp, section_stamp);
        assert_eq!(typed.section_count, first.section_count);

        let unknown = read_layers(
            &maps,
            "ride",
            route_stamp.map(|stamp| stamp + 1.0),
            section_stamp.map(|stamp| stamp + 1.0),
        );
        assert!(unknown.route_lines.and_then(|layer| layer.routes).is_some());
        assert!(unknown.sections.and_then(|layer| layer.sections).is_some());
    }

    /// Scenario: a detail map draws the library's sections and routes under
    /// its subject and asks for those two layers alone.
    ///
    /// Expected behaviour: the read returns the same sections and routes the
    /// map read returns for the same library, ships neither layer when handed
    /// the stamps it returned, and ships the one whose stamp is not current.
    #[test]
    fn the_context_layers_are_the_map_reads_layers_and_honour_held_stamps() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("map_context_layers.db");
        let maps = MapManager::new();
        with_persistent_engine(seed_layers).unwrap();

        let screen = read_layers(&maps, "", None, None);
        let context = maps.get_context_layers(None, None).unwrap();

        let ids = |sections: &Option<crate::FfiMapSectionLayer>| {
            sections
                .as_ref()
                .and_then(|layer| layer.sections.as_ref())
                .map(|list| list.iter().map(|s| s.id.clone()).collect::<Vec<_>>())
        };
        assert_eq!(ids(&context.sections), ids(&screen.sections));
        assert_eq!(ids(&context.sections).map(|list| list.len()), Some(2));
        let route_ids = |layer: &Option<crate::ffi_types::FfiRouteLineLayer>| {
            layer
                .as_ref()
                .and_then(|layer| layer.routes.as_ref())
                .map(|list| list.iter().map(|r| r.route_id.clone()).collect::<Vec<_>>())
        };
        assert_eq!(route_ids(&context.routes), route_ids(&screen.route_lines));
        assert!(route_ids(&context.routes).is_some_and(|list| !list.is_empty()));
        let (route_stamp, section_stamp) = stamps(&screen);
        assert_eq!(context.sections.as_ref().unwrap().stamp, section_stamp);
        assert_eq!(context.routes.as_ref().unwrap().stamp, route_stamp);

        let held = maps.get_context_layers(section_stamp, route_stamp).unwrap();
        assert!(held.sections.unwrap().sections.is_none());
        assert!(held.routes.unwrap().routes.is_none());

        let stale = maps
            .get_context_layers(
                section_stamp.map(|stamp| stamp + 1.0),
                route_stamp.map(|stamp| stamp + 1.0),
            )
            .unwrap();
        assert!(stale.sections.unwrap().sections.is_some());
        assert!(stale.routes.unwrap().routes.is_some());
    }

    /// Scenario: the map holds both layers, then a section and a route are
    /// renamed, each a commit that rebuilds nothing the layers are stamped
    /// with on their own.
    ///
    /// Expected behaviour: each write moves the stamp, so the next read ships
    /// the layer again carrying the new name rather than leaving the old one
    /// on the map.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_rename_ships_the_layer_it_names_again() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("map_layers_renamed.db");
        let maps = MapManager::new();
        with_persistent_engine(seed_layers).unwrap();

        let first = read_layers(&maps, "", None, None);
        let (route_stamp, section_stamp) = stamps(&first);
        let section_id = first.sections.as_ref().unwrap().sections.as_ref().unwrap()[0]
            .id
            .clone();
        with_persistent_engine(|e| e.set_section_name(&section_id, Some("Quarry climb")))
            .unwrap()
            .unwrap();

        let renamed = read_layers(&maps, "", route_stamp, section_stamp);
        let (route_stamp, _) = stamps(&renamed);
        let overlay = renamed.sections.expect("the overlay is on");
        assert_ne!(overlay.stamp, section_stamp, "a rename left the stamp");
        let shipped = overlay.sections.expect("a rename ships the overlay");
        let named = shipped
            .iter()
            .find(|section| section.id == section_id)
            .expect("still drawn");
        assert_eq!(named.name.as_deref(), Some("Quarry climb"));

        let route_id = renamed.route_lines.unwrap().routes.unwrap()[0]
            .route_id
            .clone();
        with_persistent_engine(|e| e.set_route_name(&route_id, Some("Orchard loop")))
            .unwrap()
            .unwrap();
        let lines = read_layers(&maps, "", route_stamp, None)
            .route_lines
            .and_then(|layer| layer.routes)
            .expect("a rename ships the route lines");
        let named = lines
            .iter()
            .find(|line| line.route_id == route_id)
            .expect("still drawn");
        assert_eq!(named.name, "Orchard loop");
    }

    /// Scenario: the overlay is hidden and shown again, which drops what the
    /// caller held, with nothing written in between, and then a section is
    /// renamed.
    ///
    /// Expected behaviour: the overlay's lines are decoded and re-encoded once
    /// per database state, not once per read, and a commit builds them again.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn the_overlay_is_built_once_per_database_state() {
        use crate::persistence::sections::pooled::MAP_SECTION_BUILDS;
        let _guard = serial_global_state();
        let _tmp = init_global_engine("map_overlay_built_once.db");
        let maps = MapManager::new();
        with_persistent_engine(seed_layers).unwrap();
        let builds = || MAP_SECTION_BUILDS.with(std::cell::Cell::get);

        let start = builds();
        let first = read_layers(&maps, "", None, None);
        read_layers(&maps, "ride", None, None);
        read_layers(&maps, "ride 1", None, None);
        assert_eq!(builds(), start + 1, "one database state, one overlay build");

        let section_id = first.sections.unwrap().sections.unwrap()[0].id.clone();
        with_persistent_engine(|e| e.set_section_name(&section_id, Some("Quarry climb")))
            .unwrap()
            .unwrap();
        read_layers(&maps, "", None, None);
        read_layers(&maps, "", None, None);
        assert_eq!(builds(), start + 2, "a commit builds the overlay again");
    }
}
