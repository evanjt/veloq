use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

#[test]
fn test_interval_body_returns_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("interval_body_under_writer.db");
    crate::with_persistent_engine(|engine| engine.set_interval_body("a1", "laps").unwrap());
    let (stored, missing) = read_while_writer_holds(|| {
        let manager = FitnessManager::new();
        (
            manager.get_interval_body("a1".into()),
            manager.get_interval_body("missing".into()),
        )
    });
    assert_eq!(stored.unwrap().as_deref(), Some("laps"));
    assert!(missing.unwrap().is_none());
}
