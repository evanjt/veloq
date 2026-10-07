//! Activity display names, read while a writer holds the engine.

use super::ActivityManager;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

fn metrics(id: &str, name: &str, date: i64) -> crate::types::ActivityMetrics {
    crate::types::ActivityMetrics {
        activity_id: id.into(),
        name: name.into(),
        date,
        distance: 1_000.0,
        moving_time: 300,
        elapsed_time: 300,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".into(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

#[test]
fn test_get_activity_names_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_names_under_a_writer.db");
    let names = read_while_writer_holds(|| {
        ActivityManager::new()
            .get_activity_names(vec!["a1".into()])
            .expect("names")
    });

    assert!(names.is_empty());
}

/// Scenario: a batch of ids, one of them unknown, asked out of date order.
///
/// Expected behaviour: the names come back in the order asked for, the
/// unknown id is absent, an empty batch is empty, and the answer is what the
/// engine's own read says.
#[test]
fn test_get_activity_names_pooled_matches_locked() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_names_parity.db");
    crate::with_persistent_engine(|engine| {
        engine
            .set_activity_metrics(vec![
                metrics("a1", "Morning ride", 1_700_000_000),
                metrics("a2", "Evening ride", 1_700_086_400),
            ])
            .expect("metrics");
    })
    .expect("engine");
    let activities = ActivityManager::new();

    let asked: Vec<String> = vec!["a2".into(), "missing".into(), "a1".into()];
    let names = activities.get_activity_names(asked.clone()).expect("names");
    assert_eq!(
        names
            .iter()
            .map(|n| (n.activity_id.as_str(), n.name.as_str(), n.date))
            .collect::<Vec<_>>(),
        vec![
            ("a2", "Evening ride", 1_700_086_400.0),
            ("a1", "Morning ride", 1_700_000_000.0),
        ]
    );
    let locked = crate::with_persistent_engine(|e| e.get_activity_names(&asked).expect("locked"))
        .expect("engine");
    for n in &names {
        assert_eq!(
            locked.get(&n.activity_id),
            Some(&(n.name.clone(), n.date as i64))
        );
    }
    assert_eq!(locked.len(), names.len());
    assert!(
        activities
            .get_activity_names(Vec::new())
            .expect("empty")
            .is_empty()
    );
}
