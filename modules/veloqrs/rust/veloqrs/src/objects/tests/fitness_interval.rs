use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

#[test]
fn test_activity_intervals_return_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("interval_body_under_writer.db");
    crate::with_persistent_engine(|engine| {
        engine
            .set_interval_body(
                "a1",
                r#"{"icu_intervals":[{"id":1,"type":"WORK","start_time":0,"end_time":60,"start_index":0,"end_index":60}]}"#,
            )
            .unwrap()
    });
    let (stored, missing) = read_while_writer_holds(|| {
        let manager = FitnessManager::new();
        (
            manager.get_activity_intervals("a1".into()),
            manager.get_activity_intervals("missing".into()),
        )
    });
    assert_eq!(stored.unwrap().map(|laps| laps.intervals.len()), Some(1));
    assert!(missing.unwrap().is_none());
}
