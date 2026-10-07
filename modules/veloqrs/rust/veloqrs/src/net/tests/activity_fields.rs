use super::{ACTIVITY_FIELDS, ActivityRecord};

#[test]
fn test_activity_fields_request_and_parse_peak_metrics() {
    let fields: Vec<&str> = ACTIVITY_FIELDS.split(',').collect();
    assert!(fields.contains(&"max_heartrate"));
    assert!(fields.contains(&"icu_pm_p_max"));
    for absent in [
        "icu_average_hr",
        "icu_max_hr",
        "average_watts",
        "max_watts",
        "locality",
        "country",
    ] {
        assert!(!fields.contains(&absent));
    }

    let record: ActivityRecord = serde_json::from_str(
        r#"{"id":"42","max_heartrate":184,"icu_average_watts":210,"icu_pm_p_max":1012}"#,
    )
    .unwrap();
    assert_eq!(record.max_heartrate, Some(184.0));
    assert_eq!(record.icu_average_watts, Some(210.0));
    assert_eq!(record.icu_pm_p_max, Some(1012.0));
}

/// Scenario: the list request named no `decoupling`, so no list body carried
/// intervals.icu's stored value, and the Fitness card, which reads stored
/// bodies, had nothing for a ride the athlete never opened.
#[test]
fn the_list_request_asks_for_the_stored_decoupling() {
    let fields: Vec<&str> = ACTIVITY_FIELDS.split(',').collect();
    assert!(fields.contains(&"decoupling"));
    assert!(
        super::stored_activity_fields()
            .split(',')
            .any(|field| field == "decoupling")
    );
}
