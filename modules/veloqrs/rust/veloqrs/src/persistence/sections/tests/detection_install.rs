use super::*;
use std::thread;

fn old_group() -> RouteGroup {
    RouteGroup {
        group_id: "r_1".into(),
        representative_id: "old-athlete".into(),
        activity_ids: vec!["old-athlete".into()],
        sport_type: "Ride".into(),
        bounds: None,
        custom_name: None,
        best_time: None,
        avg_time: None,
        best_pace: None,
        best_activity_id: None,
    }
}

#[test]
fn test_stale_group_writer_cannot_repopulate_wiped_library() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = crate::test_globals::init_global_engine("stale-groups.db");
    let path = dir.path().join("stale-groups.db");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let worker_barrier = std::sync::Arc::clone(&barrier);
    let worker_path = path.clone();
    let install = crate::persistence::engine_install();
    let generation =
        crate::persistence::with_persistent_engine(|engine| engine.group_generation).unwrap();
    let worker = thread::spawn(move || {
        let conn = Connection::open(worker_path).unwrap();
        worker_barrier.wait();
        save_groups_to_db(
            &conn,
            install,
            &[old_group()],
            &RouteIdentity::default(),
            &HashMap::new(),
            &tracematch::MatchConfig::default(),
            generation,
        )
    });

    crate::persistence::with_persistent_engine(|engine| engine.clear().unwrap()).unwrap();
    assert!(
        crate::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_string_lossy().into_owned()
        )
    );
    barrier.wait();
    let _ = worker.join().unwrap();
    let conn = Connection::open(path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn test_closed_install_refuses_raw_group_write_before_reopen() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = crate::test_globals::init_global_engine("closing-groups.db");
    let path = dir.path().join("closing-groups.db");
    let install = crate::persistence::engine_install();
    let generation =
        crate::persistence::with_persistent_engine(|engine| engine.group_generation).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let worker_barrier = std::sync::Arc::clone(&barrier);
    let worker_path = path.clone();
    let worker = thread::spawn(move || {
        let conn = Connection::open(worker_path).unwrap();
        worker_barrier.wait();
        save_groups_to_db(
            &conn,
            install,
            &[old_group()],
            &RouteIdentity::default(),
            &HashMap::new(),
            &tracematch::MatchConfig::default(),
            generation,
        )
    });

    crate::persistence::close_for_restore();
    barrier.wait();
    let _ = worker.join().unwrap();
    let conn = Connection::open(path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}
