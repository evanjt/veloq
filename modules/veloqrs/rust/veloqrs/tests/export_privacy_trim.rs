//! An export leaves the athlete's door behind, and the device keeps it.
//!
//! The first and last fix of a ride are the most repeated coordinates in a
//! library, so an archive handed to a coach or attached to a support thread
//! carries where the athlete lives. Trimming happens in the export alone: the
//! stored track, the reference triple and every `start_index` are what they
//! were, so the detector's output does not move.
//!
//! Synthetic coordinates only.

use std::io::Read;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

const HOME_LAT: f64 = 46.2333;
const HOME_LNG: f64 = 7.36;

/// Roughly `metres` north of home.
fn north(metres: f64) -> GpsPoint {
    GpsPoint {
        latitude: HOME_LAT + metres / 111_320.0,
        longitude: HOME_LNG,
        elevation: None,
    }
}

/// A ride out and back from the door, and one that starts a suburb away.
fn engine_with_two_rides(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    let from_the_door: Vec<GpsPoint> = [10.0, 60.0, 400.0, 1200.0, 500.0, 40.0, 8.0]
        .iter()
        .map(|m| north(*m))
        .collect();
    let away: Vec<GpsPoint> = [900.0, 1400.0, 2000.0, 1500.0, 950.0]
        .iter()
        .map(|m| north(*m))
        .collect();

    engine
        .add_activity("door".into(), from_the_door, "Ride".into())
        .expect("add door ride");
    engine
        .add_activity("away".into(), away, "Ride".into())
        .expect("add away ride");
    engine
}

fn set_trim(engine: &PersistentEngine, radius_m: f64) {
    engine
        .set_setting("__export_home_lat", &HOME_LAT.to_string())
        .expect("home lat");
    engine
        .set_setting("__export_home_lng", &HOME_LNG.to_string())
        .expect("home lng");
    engine
        .set_setting("__export_privacy_radius_m", &radius_m.to_string())
        .expect("radius");
}

/// Every `<trkpt lat=...>` in one archive entry, in order.
fn exported_track(zip_path: &std::path::Path, name_contains: &str) -> Vec<f64> {
    let file = std::fs::File::open(zip_path).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();
    let entry = names
        .iter()
        .find(|n| n.contains(name_contains))
        .unwrap_or_else(|| panic!("no entry for {name_contains} in {names:?}"));
    let mut body = String::new();
    archive
        .by_name(entry)
        .expect("entry")
        .read_to_string(&mut body)
        .expect("read entry");
    body.match_indices("<trkpt lat=\"")
        .map(|(i, m)| {
            let rest = &body[i + m.len()..];
            rest[..rest.find('"').unwrap()].parse::<f64>().unwrap()
        })
        .collect()
}

fn metres_from_home(lat: f64) -> f64 {
    (lat - HOME_LAT) * 111_320.0
}

#[test]
fn the_export_leaves_the_door_behind_and_the_device_keeps_it() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 100.0);

    let dest = dir.path().join("export.zip");
    let result = engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");
    assert_eq!(result.exported, 2, "both rides are exported");

    let trimmed = exported_track(&dest, "door");
    assert_eq!(trimmed.len(), 3, "the two ends inside the radius are gone");
    for lat in &trimmed {
        assert!(
            metres_from_home(*lat) > 100.0,
            "an exported point sits {} m from home",
            metres_from_home(*lat)
        );
    }

    // The stored track is what it was, read back rather than inferred.
    let stored = engine.get_gps_track("door").expect("stored track");
    assert_eq!(stored.len(), 7, "the device keeps every point");
    assert!(metres_from_home(stored[0].latitude) < 100.0);
}

#[test]
fn a_ride_that_never_approaches_home_is_exported_whole() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 100.0);

    let dest = dir.path().join("export.zip");
    engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");

    assert_eq!(exported_track(&dest, "away").len(), 5);
}

#[test]
fn an_export_with_no_home_set_is_exactly_what_it_was() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);

    let dest = dir.path().join("export.zip");
    let result = engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");

    assert_eq!(result.exported, 2);
    assert_eq!(result.skipped, 0);
    assert_eq!(exported_track(&dest, "door").len(), 7);
}

#[test]
fn a_radius_of_zero_is_off_rather_than_a_trim_of_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 0.0);

    let dest = dir.path().join("export.zip");
    engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");

    assert_eq!(exported_track(&dest, "door").len(), 7);
}

/// A ride that never leaves the radius is named in the ledger, so an export
/// never silently differs from the library.
#[test]
fn a_ride_entirely_inside_the_radius_is_named_in_the_ledger() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let doorstep: Vec<GpsPoint> = [5.0, 30.0, 60.0, 20.0].iter().map(|m| north(*m)).collect();
    engine
        .add_activity("doorstep".into(), doorstep, "Walk".into())
        .expect("add walk");
    set_trim(&engine, 100.0);

    let dest = dir.path().join("export.zip");
    let result = engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");

    assert_eq!(result.exported, 0);
    assert_eq!(result.skipped, 1);

    let file = std::fs::File::open(&dest).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    let mut body = String::new();
    archive
        .by_name("skipped.json")
        .expect("skipped.json present")
        .read_to_string(&mut body)
        .expect("read skipped.json");
    assert!(body.contains("doorstep"), "the ledger names it: {body}");
    assert!(body.contains("trimmed"), "and says why: {body}");
}

// The GeoJSON writer queries the same tracks and the setting names no format,
// so the two have to redact the same thing. They did not: the radius was read
// by the GPX path alone, and an athlete who picked GeoJSON got the door.

/// The latitudes of one feature's LineString, in order.
fn exported_geojson_track(path: &std::path::Path, activity_id: &str) -> Vec<f64> {
    let body = std::fs::read_to_string(path).expect("read geojson");
    let doc: serde_json::Value = serde_json::from_str(&body).expect("parse geojson");
    let feature = doc["features"]
        .as_array()
        .expect("features")
        .iter()
        .find(|f| f["properties"]["id"] == activity_id)
        .unwrap_or_else(|| panic!("no feature for {activity_id} in {body}"));
    feature["geometry"]["coordinates"]
        .as_array()
        .expect("coordinates")
        .iter()
        .map(|c| c[1].as_f64().expect("latitude"))
        .collect()
}

#[test]
fn the_geojson_export_leaves_the_door_behind_too() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 100.0);

    let dest = dir.path().join("export.geojson");
    let result = engine
        .bulk_export_geojson(dest.to_str().unwrap())
        .expect("geojson export");
    assert_eq!(result.exported, 2, "both rides are exported");

    let trimmed = exported_geojson_track(&dest, "door");
    assert_eq!(trimmed.len(), 3, "the two ends inside the radius are gone");
    for lat in &trimmed {
        assert!(
            metres_from_home(*lat) > 100.0,
            "an exported point sits {} m from home",
            metres_from_home(*lat)
        );
    }

    let stored = engine.get_gps_track("door").expect("stored track");
    assert_eq!(stored.len(), 7, "the device keeps every point");
}

/// The one that stops the two drifting again: one library, one home, and the
/// same coordinates in both files.
#[test]
fn both_formats_redact_the_same_library_the_same_way() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 100.0);

    let zip = dir.path().join("export.zip");
    let geojson = dir.path().join("export.geojson");
    engine.bulk_export_gpx(zip.to_str().unwrap()).expect("gpx");
    engine
        .bulk_export_geojson(geojson.to_str().unwrap())
        .expect("geojson");

    for id in ["door", "away"] {
        assert_eq!(
            exported_track(&zip, id),
            exported_geojson_track(&geojson, id),
            "the two formats disagree about {id}"
        );
    }
}

#[test]
fn a_geojson_export_with_no_home_set_is_exactly_what_it_was() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);

    let dest = dir.path().join("export.geojson");
    let result = engine
        .bulk_export_geojson(dest.to_str().unwrap())
        .expect("geojson export");

    assert_eq!(result.exported, 2);
    assert_eq!(result.skipped, 0);
    assert_eq!(exported_geojson_track(&dest, "door").len(), 7);
}

#[test]
fn a_geojson_radius_of_zero_is_off_rather_than_a_trim_of_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with_two_rides(&dir);
    set_trim(&engine, 0.0);

    let dest = dir.path().join("export.geojson");
    engine
        .bulk_export_geojson(dest.to_str().unwrap())
        .expect("geojson export");

    assert_eq!(exported_geojson_track(&dest, "door").len(), 7);
}

/// The ledger is already a foreign member of the FeatureCollection, so a ride
/// the trim removes has somewhere to be named.
#[test]
fn a_geojson_ride_entirely_inside_the_radius_is_named_in_the_ledger() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let doorstep: Vec<GpsPoint> = [5.0, 30.0, 60.0, 20.0].iter().map(|m| north(*m)).collect();
    engine
        .add_activity("doorstep".into(), doorstep, "Walk".into())
        .expect("add walk");
    set_trim(&engine, 100.0);

    let dest = dir.path().join("export.geojson");
    let result = engine
        .bulk_export_geojson(dest.to_str().unwrap())
        .expect("geojson export");

    assert_eq!(result.exported, 0);
    assert_eq!(result.skipped, 1);

    let body = std::fs::read_to_string(&dest).expect("read geojson");
    assert!(body.contains("doorstep"), "the ledger names it: {body}");
    assert!(body.contains("trimmed"), "and says why: {body}");
}
