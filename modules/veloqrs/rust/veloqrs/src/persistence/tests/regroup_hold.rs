//! Scenario: a library upgraded from an older build owes the detector cutover,
//! and the launch leaves the owed regroup to that cutover, which waits behind
//! the elevation download for as long as the download takes. Meanwhile the
//! routes screen reads the catalogue the older build cut.
//!
//! Expected behaviour: the read keeps the old routes and sections, and names
//! what holds the owed regroup, so the screen says the rebuild is waiting
//! rather than that routes are being computed. A regroup in flight, a regroup
//! nothing holds and a library that owes none name no hold.

use crate::objects::error::with_reader;
use crate::test_globals::{init_global_engine, serial_global_state};
use crate::{FfiDetectionHold, FfiRoutesScreenData, FfiRoutesScreenQuery, with_persistent_engine};

fn seed_older_build_catalogue(cut_by_older_build: bool) {
    with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s_old', 'auto', 'Ridge', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count)
             VALUES ('g_old', 'a0', '[\"a0\",\"a1\",\"a2\"]', 'Ride', 3)",
            [],
        )
        .unwrap();
        if !cut_by_older_build {
            e.db.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?1, ?2)",
                rusqlite::params![
                    crate::persistence::sections::CATALOGUE_METHOD_KEY,
                    crate::persistence::sections::DETECTOR_METHOD
                ],
            )
            .unwrap();
        }
        e.set_groups_dirty(true);
    })
    .unwrap();
}

/// The read on the engine's own connection and the pooled read the export
/// takes, which must agree.
fn read_both() -> (FfiRoutesScreenData, FfiRoutesScreenData) {
    let own = with_persistent_engine(|e| e.get_routes_screen_data(FfiRoutesScreenQuery::default()))
        .unwrap();
    let pooled = with_reader(|conn| {
        crate::persistence::pooled_routes_screen_data(conn, FfiRoutesScreenQuery::default())
    })
    .unwrap();
    (own, pooled)
}

#[test]
fn an_owed_cutover_keeps_the_old_catalogue_and_names_the_hold_on_the_regroup() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup_hold_cutover_owed.db");
    seed_older_build_catalogue(true);

    for data in <[_; 2]>::from(read_both()) {
        assert_eq!(data.section_count, 1, "the old section is still read");
        assert_eq!(data.groups.len(), 1, "the old route is still read");
        assert!(data.section_empty_reason.is_none());
        assert!(data.group_empty_reason.is_none());
        assert!(data.groups_dirty, "the regroup is still owed");
        assert_eq!(data.groups_hold, Some(FfiDetectionHold::Cutover));
    }
}

#[test]
fn a_regroup_in_flight_names_no_hold() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup_hold_in_flight.db");
    seed_older_build_catalogue(true);

    let claim = crate::persistence::regroup::claim_regroup().expect("the slot is free");
    let (own, pooled) = read_both();
    drop(claim);

    for data in [own, pooled] {
        assert!(data.groups_dirty);
        assert_eq!(data.groups_hold, None, "a regroup is running");
    }
}

#[test]
fn a_regroup_no_cutover_holds_names_no_hold() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup_hold_no_cutover.db");
    seed_older_build_catalogue(false);

    for data in <[_; 2]>::from(read_both()) {
        assert!(data.groups_dirty);
        assert_eq!(data.groups_hold, None);
    }
}

#[test]
fn a_library_that_owes_no_regroup_names_no_hold() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup_hold_settled.db");
    seed_older_build_catalogue(true);
    with_persistent_engine(|e| e.set_groups_dirty(false)).unwrap();

    for data in <[_; 2]>::from(read_both()) {
        assert!(!data.groups_dirty);
        assert_eq!(
            data.groups_hold, None,
            "the cutover holds no regroup that is not owed"
        );
    }
}

#[test]
fn a_cutover_behind_owed_elevation_names_the_elevation_wait() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup_hold_elevation_owed.db");
    seed_older_build_catalogue(true);
    with_persistent_engine(|e| {
        for (id, lng) in [("ride_north", 7.0), ("ride_south", 7.01)] {
            let track = (0..20)
                .map(|n| crate::GpsPoint::new(46.0 + f64::from(n) * 0.0001, lng))
                .collect();
            e.add_activity(id.into(), track, "Ride".into()).unwrap();
        }
    })
    .unwrap();

    for data in <[_; 2]>::from(read_both()) {
        assert_eq!(data.section_count, 1, "the old section is still read");
        assert_eq!(data.groups.len(), 1, "the old route is still read");
        assert_eq!(
            data.groups_hold,
            Some(FfiDetectionHold::ElevationWaiting { remaining: 2 })
        );
    }
}
