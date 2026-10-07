use std::sync::atomic::Ordering;

use super::{ENGINE_INSTALL, with_persistent_engine_blocking, with_persistent_engine_blocking_for};
use crate::test_globals::{init_global_engine, serial_global_state};

#[test]
fn test_blocking_engine_without_tokio_context() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("blocking-engine.db");

    let stored = futures::executor::block_on(with_persistent_engine_blocking(|engine| {
        engine.set_setting("units", "miles").unwrap();
        engine.get_setting("units").unwrap()
    }));

    assert_eq!(stored.flatten().as_deref(), Some("miles"));
}

#[test]
fn test_install_bound_blocking_engine_without_tokio_context() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("blocking-engine-install.db");
    let install = ENGINE_INSTALL.load(Ordering::Acquire);

    let stored =
        futures::executor::block_on(with_persistent_engine_blocking_for(install, |engine| {
            engine.set_setting("units", "kilometres").unwrap();
            engine.get_setting("units").unwrap()
        }));

    assert_eq!(stored.flatten().as_deref(), Some("kilometres"));
}
