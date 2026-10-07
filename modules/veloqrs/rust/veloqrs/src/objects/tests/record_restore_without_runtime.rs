use super::VeloqEngine;
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};

#[test]
fn test_record_zip_restore_without_tokio_context() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("record-zip-restore.db");
    crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
        .unwrap();
    let path = tmp.path().join("record.zip");
    with_persistent_engine(|engine| engine.set_setting("units", "miles").unwrap());
    futures::executor::block_on(VeloqEngine.run_record_backup(path.to_string_lossy().into_owned()))
        .expect("back up record ZIP");
    with_persistent_engine(|engine| engine.set_setting("units", "kilometres").unwrap());

    let restored = futures::executor::block_on(
        VeloqEngine.restore_record_zip(path.to_string_lossy().into_owned()),
    );
    crate::objects::sync::clear_test_credentials();

    let result = restored.expect("restore record ZIP");
    assert_eq!((result.placed, result.unplaced), (1, 0));
    let stored = with_persistent_engine(|engine| engine.get_setting("units").unwrap()).unwrap();
    assert_eq!(stored.as_deref(), Some("miles"));
}
