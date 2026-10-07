use super::*;

#[test]
fn test_bucket_splits_on_edges() {
    assert_eq!(bucket(Duration::from_micros(999)), 0);
    assert_eq!(bucket(Duration::from_millis(1)), 1);
    assert_eq!(bucket(Duration::from_millis(3)), 1);
    assert_eq!(bucket(Duration::from_millis(8)), 3);
    assert_eq!(bucket(Duration::from_millis(255)), 5);
    assert_eq!(bucket(Duration::from_millis(256)), 6);
    assert_eq!(bucket(Duration::from_secs(9)), 6);
}

#[test]
fn test_lock_take_records_calling_site() {
    let _serial = crate::test_globals::serial_global_state();
    let line = line!() + 1;
    crate::persistence::with_persistent_engine(|_| ());
    let table = TABLE.lock().unwrap();
    let hit = table
        .by_caller
        .keys()
        .find(|loc| loc.line() == line && loc.file().ends_with("tests/lock_trace.rs"));
    assert!(
        hit.is_some(),
        "no row for line {line}: {:?}",
        table.by_caller.keys()
    );
}

#[test]
fn test_install_pinned_lock_take_records_calling_site() {
    let _serial = crate::test_globals::serial_global_state();
    let line = line!() + 1;
    crate::persistence::with_persistent_engine_for(0, |_| ());
    let table = TABLE.lock().unwrap();
    let hit = table
        .by_caller
        .keys()
        .find(|loc| loc.line() == line && loc.file().ends_with("tests/lock_trace.rs"));
    assert!(
        hit.is_some(),
        "no row for line {line}: {:?}",
        table.by_caller.keys()
    );
}
