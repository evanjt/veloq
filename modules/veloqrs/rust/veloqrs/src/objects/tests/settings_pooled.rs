use super::*;
use crate::GpsPoint;
use crate::ffi_types::FfiGpsPoint;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

const HOME_LAT: f64 = 46.2333;
const HOME_LNG: f64 = 7.36;

fn near_home(offset_m: f64) -> GpsPoint {
    GpsPoint::new(HOME_LAT + offset_m / 111_320.0, HOME_LNG)
}

fn away(km: f64) -> GpsPoint {
    GpsPoint::new(HOME_LAT + km * 1000.0 / 111_320.0, HOME_LNG)
}

/// Four rides that start and finish at one door, and one that does neither.
fn seed_rides_from_home() {
    crate::with_persistent_engine(|engine| {
        for (i, offset) in [5.0, 20.0, 40.0, 15.0].iter().enumerate() {
            engine
                .add_activity(
                    format!("ride{i}"),
                    vec![near_home(*offset), away(3.0), near_home(offset + 10.0)],
                    "Ride".into(),
                )
                .expect("add");
        }
        engine
            .add_activity(
                "elsewhere".into(),
                vec![away(40.0), away(41.0), away(40.5)],
                "Ride".into(),
            )
            .expect("add");
        engine
            .db
            .execute(
                "INSERT INTO activity_streams (activity_id, kind, data, sample_count) VALUES ('ride0', 'watts', X'0102030405', 5)",
                [],
            )
            .expect("a stored series");
    })
    .expect("engine");
}

#[test]
fn test_get_setting_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("setting_under_writer.db");
    let settings = SettingsManager::new();
    settings.set_setting("theme".into(), "dark".into()).unwrap();
    let value = read_while_writer_holds(|| settings.get_setting("theme".into()).unwrap());
    assert_eq!(value.as_deref(), Some("dark"));
    let absent = read_while_writer_holds(|| settings.get_setting("absent".into()).unwrap());
    assert_eq!(absent, None);
}

#[test]
fn test_get_athlete_profile_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("profile_under_writer.db");
    let settings = SettingsManager::new();
    assert_eq!(
        read_while_writer_holds(|| settings.get_athlete_profile().unwrap()),
        None
    );
    settings
        .set_athlete_profile("{\"id\":\"i1\"}".into())
        .unwrap();
    let profile = read_while_writer_holds(|| settings.get_athlete_profile().unwrap());
    assert_eq!(profile.as_deref(), Some("{\"id\":\"i1\"}"));
}

#[test]
fn test_get_sport_settings_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("sport_under_writer.db");
    let settings = SettingsManager::new();
    assert_eq!(
        read_while_writer_holds(|| settings.get_sport_settings().unwrap()),
        None
    );
    settings.set_sport_settings("{\"ftp\":200}".into()).unwrap();
    let sport = read_while_writer_holds(|| settings.get_sport_settings().unwrap());
    assert_eq!(sport.as_deref(), Some("{\"ftp\":200}"));
}

#[test]
fn test_stream_retention_days_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("retention_under_writer.db");
    let settings = SettingsManager::new();
    assert_eq!(
        read_while_writer_holds(|| settings.stream_retention_days().unwrap()),
        0.0
    );
    settings.set_stream_retention_days(30.0).unwrap();
    assert_eq!(
        read_while_writer_holds(|| settings.stream_retention_days().unwrap()),
        30.0
    );
}

#[test]
fn test_stream_store_bytes_writer_held_matches_locked() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("store_bytes_under_writer.db");
    seed_rides_from_home();
    let settings = SettingsManager::new();
    let expected = crate::with_persistent_engine(|e| e.stream_store_bytes().unwrap()).unwrap();
    let actual = read_while_writer_holds(|| settings.stream_store_bytes().unwrap());
    assert_eq!(actual, 5.0);
    assert_eq!(actual, expected as f64);
}

#[test]
fn test_suggest_export_home_writer_held_matches_locked() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("home_under_writer.db");
    let settings = SettingsManager::new();
    assert!(read_while_writer_holds(|| settings.suggest_export_home().unwrap()).is_none());
    seed_rides_from_home();
    let expected = crate::with_persistent_engine(|e| e.suggest_export_home())
        .unwrap()
        .expect("a home from the locked path");
    let actual = read_while_writer_holds(|| settings.suggest_export_home().unwrap())
        .expect("a home from the pooled path");
    assert_eq!(actual.activity_count, 8);
    assert_eq!(actual.activity_count, expected.activity_count);
    assert_eq!(actual.latitude, expected.latitude);
    assert_eq!(actual.longitude, expected.longitude);
    assert_eq!(actual.endpoint_share, expected.endpoint_share);
}

#[test]
fn test_export_privacy_preview_writer_held_matches_locked() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("preview_under_writer.db");
    seed_rides_from_home();
    let settings = SettingsManager::new();
    let expected =
        crate::with_persistent_engine(|e| e.export_privacy_preview(HOME_LAT, HOME_LNG, 100.0))
            .unwrap()
            .unwrap();
    let actual = read_while_writer_holds(|| {
        settings
            .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
            .unwrap()
    });
    assert_eq!((actual.with_track, actual.touched), (5, 4));
    assert_eq!(
        (actual.with_track, actual.touched, actual.dropped),
        (expected.with_track, expected.touched, expected.dropped)
    );
    let off = settings
        .export_privacy_preview(HOME_LAT, HOME_LNG, 0.0)
        .unwrap();
    assert_eq!((off.with_track, off.touched, off.dropped), (5, 0, 0));
}

#[test]
fn a_shared_track_loses_the_points_inside_the_configured_radius() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("trim_single_export.db");
    let settings = SettingsManager::new();
    let track: Vec<FfiGpsPoint> = vec![
        near_home(5.0),
        near_home(60.0),
        away(1.0),
        away(2.0),
        near_home(40.0),
        near_home(3.0),
    ]
    .into_iter()
    .map(Into::into)
    .collect();

    let build = |points: Vec<FfiGpsPoint>| {
        settings
            .build_gpx_file("Morning ride".into(), None, None, points)
            .unwrap()
    };
    let untrimmed = build(track.clone()).unwrap();
    assert_eq!(untrimmed.content.matches("<trkpt").count(), track.len());
    assert_eq!(untrimmed.filename, "Morning_ride.gpx");

    for (key, value) in [
        ("__export_home_lat", HOME_LAT.to_string()),
        ("__export_home_lng", HOME_LNG.to_string()),
        ("__export_privacy_radius_m", "100".to_string()),
    ] {
        settings.set_setting(key.into(), value).unwrap();
    }
    let trimmed = build(track).expect("a track that leaves the radius survives");
    assert_eq!(trimmed.content.matches("<trkpt").count(), 2);
    assert!(
        !trimmed
            .content
            .contains(&format!("lat=\"{:.6}\"", HOME_LAT))
    );

    let backyard: Vec<FfiGpsPoint> = [5.0, 30.0, 10.0]
        .iter()
        .map(|m| near_home(*m).into())
        .collect();
    assert!(build(backyard).is_none());

    let no_fix: Vec<FfiGpsPoint> = vec![FfiGpsPoint {
        latitude: f64::NAN,
        longitude: 7.36,
        elevation: None,
    }];
    assert!(build(no_fix).is_none());
}
