use super::{PersistentEngine, activity_record, pooled};

/// A body as `GET /activity/{id}` answers it, carrying the keys the detail
/// screen reads that the list request never asks for.
const DETAIL: &str = r#"{
    "id": "i77",
    "icu_athlete_id": "i9",
    "name": "Harbour loop",
    "type": "Run",
    "start_date_local": "2025-03-02T07:15:00",
    "moving_time": 3600,
    "distance": 12000.5,
    "total_elevation_gain": 140.0,
    "average_heartrate": 151.4,
    "max_heartrate": 178,
    "icu_average_watts": 255,
    "icu_pm_p_max": 610,
    "calories": 820,
    "icu_training_load": 74,
    "icu_intensity": 88.2,
    "icu_ftp": 280,
    "icu_pm_ftp_watts": 291,
    "trimp": 112.6,
    "strain_score": 9.4,
    "icu_hrr": {"start_bpm": 170, "end_bpm": 138, "hrr": 32},
    "icu_efficiency_factor": 1.69,
    "decoupling": "-Infinity",
    "has_weather": true,
    "average_weather_temp": 14.5,
    "average_temp": 21.0,
    "apparent_temperature": 12.1,
    "average_feels_like": 11.0,
    "average_temp_feels_like": 10.0,
    "average_wind_speed": 4.2,
    "description": "Tempo in the wind",
    "device_name": "Wrist unit",
    "stream_types": ["time", "latlng", "heartrate"]
}"#;

#[test]
fn a_detail_body_types_every_key_the_screen_reads() {
    let record = activity_record("a1", DETAIL).expect("record");

    assert_eq!(record.id, "a1");
    assert!(record.is_detail);
    assert_eq!(record.name.as_deref(), Some("Harbour loop"));
    assert_eq!(record.sport_type.as_deref(), Some("Run"));
    assert_eq!(
        record.start_date_local.as_deref(),
        Some("2025-03-02T07:15:00")
    );
    assert_eq!(record.moving_time, 3600);
    assert_eq!(record.distance, 12000.5);
    assert_eq!(record.elevation_gain, 140.0);
    assert_eq!(record.avg_hr, Some(151.4));
    assert_eq!(record.max_hr, Some(178.0));
    assert_eq!(record.avg_power, Some(255.0));
    assert_eq!(record.max_power, Some(610.0));
    assert_eq!(record.calories, Some(820.0));
    assert_eq!(record.training_load, Some(74.0));
    assert_eq!(record.intensity, Some(88.2));
    assert_eq!(record.ftp, Some(280.0));
    assert_eq!(record.eftp, Some(291.0));
    assert_eq!(record.trimp, Some(112.6));
    assert_eq!(record.strain_score, Some(9.4));
    assert_eq!(record.hr_recovery, Some(32.0));
    assert_eq!(record.efficiency_factor, Some(1.69));
    assert_eq!(record.decoupling, None);
    assert!(record.has_weather);
    assert_eq!(record.weather_temp, Some(14.5));
    assert_eq!(record.sensor_temp, Some(21.0));
    assert_eq!(record.feels_like, Some(12.1));
    assert_eq!(record.wind_speed, Some(4.2));
    assert_eq!(record.description.as_deref(), Some("Tempo in the wind"));
    assert_eq!(record.device_name.as_deref(), Some("Wrist unit"));
    assert_eq!(record.stream_types, ["time", "latlng", "heartrate"]);
}

#[test]
fn a_finite_decoupling_is_read_as_stored() {
    let decoupling = |body: &str| activity_record("a1", body).expect("record").decoupling;
    assert_eq!(decoupling(r#"{"id":"a1","decoupling":3.4}"#), Some(3.4));
    assert_eq!(decoupling(r#"{"id":"a1","decoupling":-12.5}"#), Some(-12.5));
    assert_eq!(decoupling(r#"{"id":"a1","decoupling":0}"#), Some(0.0));
    assert_eq!(decoupling(r#"{"id":"a1","decoupling":null}"#), None);
    assert_eq!(decoupling(r#"{"id":"a1"}"#), None);
}

#[test]
fn feels_like_falls_back_through_the_older_names_in_order() {
    let feels = |body: &str| activity_record("a1", body).expect("record").feels_like;
    assert_eq!(
        feels(r#"{"id":"a1","average_feels_like":11.0,"average_temp_feels_like":10.0}"#),
        Some(11.0)
    );
    assert_eq!(
        feels(r#"{"id":"a1","average_temp_feels_like":10.0}"#),
        Some(10.0)
    );
    assert_eq!(feels(r#"{"id":"a1"}"#), None);
}

#[test]
fn a_list_body_is_not_the_detail_and_lacks_what_it_never_carried() {
    let list = r#"{"id":"i77","name":"Harbour loop","type":"Run","moving_time":3600}"#;
    let record = activity_record("a1", list).expect("record");
    assert!(!record.is_detail);
    assert_eq!(record.moving_time, 3600);
    assert_eq!(record.trimp, None);
    assert_eq!(record.hr_recovery, None);
    assert!(!record.has_weather);
    assert!(record.stream_types.is_empty());

    for athlete in [r#""""#, "350768", "null"] {
        let body = format!(r#"{{"id":"i77","icu_athlete_id":{athlete}}}"#);
        assert!(
            !activity_record("a1", &body).expect("record").is_detail,
            "{athlete}"
        );
    }
}

#[test]
fn a_key_in_an_unmodelled_shape_costs_that_key_and_not_the_record() {
    let odd = r#"{"id":"i77","name":"Odd","trimp":"high","icu_hrr":[1,2],"strain_score":null}"#;
    let record = activity_record("a1", odd).expect("record");
    assert_eq!(record.name.as_deref(), Some("Odd"));
    assert_eq!(record.trimp, None);
    assert_eq!(record.hr_recovery, None);
    assert_eq!(record.strain_score, None);
}

#[test]
fn a_typeless_body_keeps_its_sport_absent() {
    let record = activity_record("a1", r#"{"id":"a1"}"#).expect("record");
    assert_eq!(record.sport_type, None);
}

#[test]
fn a_body_that_is_not_json_has_no_record() {
    assert!(activity_record("a1", "not json").is_none());
}

#[test]
fn the_stored_record_is_read_by_its_key() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .upsert_activity_bodies_with_metrics(&[("local-1".into(), 1_740_900_000, DETAIL.into())])
        .expect("body");

    let record = pooled::activity_record(&engine.db, "local-1").expect("stored record");
    assert_eq!(record.id, "local-1");
    assert!(record.is_detail);
    assert_eq!(record.trimp, Some(112.6));
    assert!(pooled::activity_record(&engine.db, "absent").is_none());
}
