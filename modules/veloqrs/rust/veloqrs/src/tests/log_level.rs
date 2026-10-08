use crate::ffi::{EngineLogLevel, set_engine_log_level};

#[test]
fn test_engine_log_level_changes_after_initialisation() {
    let _serial = crate::test_globals::serial_global_state();
    let original = log::max_level();

    crate::initialise_log_level();
    assert_eq!(log::max_level(), crate::log_level());

    set_engine_log_level(EngineLogLevel::Info);
    assert_eq!(log::max_level(), log::LevelFilter::Info);

    set_engine_log_level(EngineLogLevel::Boot);
    assert_eq!(log::max_level(), crate::log_level());
    log::set_max_level(original);
}
