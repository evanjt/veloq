use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::objects::observer::{recorder::Recorder, set_observer};
use crate::persistence::sections::detection::ApplyOn;
use crate::persistence::{WorkerPoll, engine_install};
use crate::test_globals::{init_global_engine, serial_global_state};
use crate::with_persistent_engine;

const WAIT: Duration = Duration::from_secs(10);

fn coords(base: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(base + f64::from(i) * 0.001, 7.3))
        .collect()
}

fn store(engine: &mut PersistentEngine, id: &str, base: f64) {
    engine
        .add_activity(id.into(), coords(base), "Ride".into())
        .unwrap();
}

fn holder(groups: &[RouteGroup], member: &str) -> Option<String> {
    groups
        .iter()
        .find(|group| group.activity_ids.iter().any(|id| id == member))
        .map(|group| group.group_id.clone())
}

fn catalogue(groups: &[RouteGroup]) -> Vec<(String, Vec<String>)> {
    let mut rows: Vec<(String, Vec<String>)> = groups
        .iter()
        .map(|group| {
            let mut members = group.activity_ids.clone();
            members.sort();
            (group.group_id.clone(), members)
        })
        .collect();
    rows.sort();
    rows
}

fn generation(path: &std::path::Path) -> u64 {
    read_group_generation(&Connection::open(path).unwrap()).unwrap()
}

/// Schedule under one lock hold and start once it has ended, the way a caller
/// does.
fn schedule() -> bool {
    match with_persistent_engine(|engine| engine.schedule_regroup()).expect("engine") {
        Some(scheduled) => {
            scheduled.start();
            true
        }
        None => false,
    }
}

/// `m` grouped and settled, then each of `stored` added, so the grouping is
/// owed. Returns the install and the settled catalogue.
fn grouped_library(stored: &[(&str, f64)]) -> (u64, Vec<RouteGroup>) {
    with_persistent_engine(|engine| {
        store(engine, "m", 40.0);
        let settled = engine.get_groups().to_vec();
        assert!(!engine.groups_are_dirty());
        for (id, base) in stored {
            store(engine, id, *base);
        }
        assert!(engine.groups_are_dirty());
        (engine_install(), settled)
    })
    .expect("engine")
}

#[test]
fn test_attach_tail_leaves_regroup_for_worker() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, settled) = grouped_library(&[("a", 44.0), ("b", 48.0), ("c", 52.0), ("d", 56.0)]);

    let (entered, resume) = pause_next_group_write(&path, install);
    let (scheduled, dirty) = with_persistent_engine(|engine| {
        let (_, _, scheduled) = engine.attach_finalize(0, false);
        (scheduled, engine.groups_are_dirty())
    })
    .expect("engine");
    assert!(dirty, "the attach tail must leave grouping for the worker");
    scheduled.expect("regroup scheduled").start();
    entered.recv_timeout(WAIT).expect("worker reached compute");
    let reader = std::thread::spawn(|| {
        with_persistent_engine(|engine| engine.groups.clone()).expect("engine lock is free")
    });
    assert_eq!(
        catalogue(&reader.join().expect("reader")),
        catalogue(&settled)
    );
    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    for member in ["a", "b", "c", "d"] {
        assert!(holder(&groups, member).is_some(), "{member} is in no route");
    }
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_index_tail_leaves_regroup_for_worker() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, settled) = grouped_library(&[("a", 44.0)]);

    let (entered, resume) = pause_next_group_write(&path, install);
    let ((summary, scheduled), dirty) = with_persistent_engine(|engine| {
        let indexed = engine.index_new_activity("a").expect("index");
        (indexed, engine.groups_are_dirty())
    })
    .expect("engine");
    assert!(summary.regroup_scheduled);
    assert!(!summary.indicators_recomputed);
    assert!(dirty);
    scheduled.expect("regroup scheduled").start();
    entered.recv_timeout(WAIT).expect("worker reached compute");
    let reader = std::thread::spawn(|| {
        with_persistent_engine(|engine| engine.groups.clone()).expect("engine lock is free")
    });
    assert_eq!(
        catalogue(&reader.join().expect("reader")),
        catalogue(&settled)
    );
    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    assert!(holder(&groups, "a").is_some());
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_regroup_held_in_its_compute_leaves_the_lock_to_readers() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let stored = [("a", 44.0), ("b", 48.0), ("c", 52.0), ("d", 56.0)];
    let (install, settled) = grouped_library(&stored);

    let (entered, resume) = pause_next_group_write(&path, install);
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the worker reached its write");

    let (held, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("the lock is free while the regroup computes");
    assert_eq!(catalogue(&held), catalogue(&settled));
    assert!(dirty);
    assert!(crate::persistence::groups_dirty_for_readers());

    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));

    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    for (id, _) in stored {
        assert!(holder(&groups, id).is_some(), "{id} is in no route");
    }
    assert_eq!(holder(&groups, "m"), holder(&settled, "m"));
    assert!(!dirty);
    assert!(!crate::persistence::groups_dirty_for_readers());
    assert_eq!(
        catalogue(&load_groups_from_db(&Connection::open(&path).unwrap())),
        catalogue(&groups)
    );
}

/// A store made while the first pass is held runs one more pass, and a store
/// made during that one is left for the next store to schedule.
#[test]
fn test_store_during_a_pass_runs_one_more_and_no_third() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, _) = grouped_library(&[("t", 44.0)]);
    let before = generation(&path);

    let (first, resume_first) = pause_next_group_write(&path, install);
    assert!(schedule());
    first
        .recv_timeout(WAIT)
        .expect("the first pass reached its write");
    let (second, resume_second) = pause_next_group_write(&path, install);
    with_persistent_engine(|engine| store(engine, "e", 48.0)).expect("engine");
    resume_first.send(()).unwrap();

    second.recv_timeout(WAIT).expect("a second pass ran");
    with_persistent_engine(|engine| store(engine, "f", 52.0)).expect("engine");
    resume_second.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));

    assert_eq!(
        generation(&path),
        before + 2,
        "exactly two passes committed"
    );
    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some());
    assert!(holder(&groups, "e").is_some());
    assert!(holder(&groups, "f").is_none());
    assert!(dirty, "the store made during the second pass is still owed");
}

#[test]
fn test_swap_against_a_replaced_install_changes_nothing() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let (_, _) = grouped_library(&[("t", 44.0)]);

    let (entered, resume) = pause_next_regroup_swap();
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its swap");

    let _other = init_global_engine("other.db");
    let settled = with_persistent_engine(|engine| {
        store(engine, "x", 60.0);
        engine.get_groups().to_vec()
    })
    .expect("engine");
    with_persistent_engine(|engine| store(engine, "y", 64.0)).expect("engine");

    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));

    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert_eq!(catalogue(&groups), catalogue(&settled));
    assert!(dirty, "the other library's store is still owed");
    drop(dir);
}

/// A detection run that captured the flag takes the regroup, and a schedule
/// made during it does nothing.
#[test]
fn test_detection_with_owed_groups_and_a_schedule_write_once() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, _) = grouped_library(&[("t", 44.0)]);
    let before = generation(&path);

    let (entered, resume) = pause_next_group_write(&path, install);
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    entered
        .recv_timeout(WAIT)
        .expect("the run reached its group write");
    assert!(!schedule(), "the run in flight holds the regroup");
    resume.send(()).unwrap();
    let (state, _) = detection.recv_state_with_cache_within(Some(WAIT));
    assert!(!matches!(state, WorkerPoll::Running));
    crate::test_globals::wait_for_detection_workers();
    assert!(wait_for_regroup(WAIT));

    assert_eq!(generation(&path), before + 1);
    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some());
    assert!(!dirty);
}

/// The other order: a worker pass in flight, then a detection run that
/// captured the flag. The run leaves the regroup to the pass.
#[test]
fn test_detection_started_during_a_pass_leaves_it_the_regroup() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, _) = grouped_library(&[("t", 44.0)]);
    let before = generation(&path);

    let (entered, resume) = pause_next_group_write(&path, install);
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its write");
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    let _ = detection.recv_state_with_cache_within(Some(WAIT));
    crate::test_globals::wait_for_detection_workers();
    assert!(
        with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine"),
        "the run regrouped nothing, so the grouping is still owed"
    );
    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));

    assert_eq!(generation(&path), before + 1);
    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some());
    assert!(!dirty);
}

#[test]
fn test_failed_save_keeps_the_prior_catalogue_and_the_flag() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (_, settled) = grouped_library(&[("t", 44.0)]);
    with_persistent_engine(|engine| {
        engine
            .db
            .execute_batch(
                "CREATE TRIGGER refuse_groups BEFORE INSERT ON route_groups
                 BEGIN SELECT RAISE(ABORT, 'refused'); END;",
            )
            .unwrap();
    })
    .expect("engine");
    let before = generation(&path);

    assert!(schedule());
    assert!(wait_for_regroup(WAIT));

    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert_eq!(catalogue(&groups), catalogue(&settled));
    assert!(holder(&groups, "t").is_none());
    assert!(dirty);
    assert_eq!(generation(&path), before);
    assert_eq!(
        catalogue(&load_groups_from_db(&Connection::open(&path).unwrap())),
        catalogue(&settled)
    );
}

#[test]
fn test_nothing_owed_schedules_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    with_persistent_engine(|engine| {
        store(engine, "m", 40.0);
        engine.get_groups();
    })
    .expect("engine");
    assert!(!schedule());
}

/// The readers of the catalogue hear of a regroup that landed, once, and the
/// catalogue they then read is the new one.
#[test]
fn test_committed_swap_announces_the_new_groups_once() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    assert!(schedule());
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert_eq!(events, vec!["groups_changed"]);
    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    assert!(holder(&groups, "t").is_some());
}

/// A pass that saved nothing leaves the catalogue as it was, so a reader has
/// nothing new to fetch.
#[test]
fn test_swap_of_a_failed_save_announces_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    with_persistent_engine(|engine| {
        engine
            .db
            .execute_batch(
                "CREATE TRIGGER refuse_groups BEFORE INSERT ON route_groups
                 BEGIN SELECT RAISE(ABORT, 'refused'); END;",
            )
            .unwrap();
    })
    .expect("engine");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    assert!(schedule());
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert!(events.is_empty(), "announced {events:?}");
}

/// A swap the lock refuses because the library was replaced adopts nothing, so
/// it announces nothing about the library that replaced it.
#[test]
fn test_swap_against_a_replaced_install_announces_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let (entered, resume) = pause_next_regroup_swap();
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its swap");
    let _other = init_global_engine("other.db");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert!(events.is_empty(), "announced {events:?}");
}

/// A lock take adopts a commit the pass made before its swap runs. That is the
/// moment the catalogue changes, so it is the moment readers are told, and the
/// swap that finds the generation current says nothing more.
#[test]
fn test_lock_take_adopting_the_commit_announces_before_the_swap_runs() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let (entered, resume) = pause_next_regroup_swap();
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its swap");
    with_persistent_engine(|_| ()).expect("engine");
    let before_swap = recorder.events();
    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert_eq!(before_swap, vec!["groups_changed"]);
    assert_eq!(events, vec!["groups_changed"]);
}

/// A detection run that regroups and commits on its own worker adopts the
/// result through the lock, and that adoption is what readers hear of.
#[test]
fn test_worker_detection_regroup_announces_the_adopted_groups_once() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    let (state, _) = detection.recv_state_with_cache_within(Some(WAIT));
    assert!(!matches!(state, WorkerPoll::Running));
    crate::test_globals::wait_for_detection_workers();
    let events = recorder.events();
    set_observer(None);

    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    assert!(holder(&groups, "t").is_some());
    assert_eq!(
        events.iter().filter(|e| *e == "groups_changed").count(),
        1,
        "announced {events:?}"
    );
}

/// A pass whose save lost to a write that committed in the engine's own hold
/// adopts nothing, since the engine already holds that catalogue. The pass that
/// then re-runs over it commits one of its own, and that is the only change
/// readers are told of.
#[test]
fn test_superseded_pass_is_silent_and_its_rerun_announces_once() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, _) = grouped_library(&[("t", 44.0)]);
    let before = generation(&path);
    let (entered, resume) = pause_next_group_write(&path, install);
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its write");
    with_persistent_engine(|engine| {
        engine.get_groups();
    })
    .expect("engine");
    assert_eq!(
        generation(&path),
        before + 1,
        "the engine's own regroup committed"
    );
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert_eq!(generation(&path), before + 2, "the rerun committed");
    assert_eq!(events, vec!["groups_changed"]);
}

/// The announcement is queued from inside the lock hold that adopted the
/// groups, and delivered on the announce thread. A listener that reads the
/// engine in its callback waits for that hold to end rather than deadlocking
/// with it, and reads the catalogue that was adopted.
mod reads_the_engine_when_told {
    use super::*;
    use crate::objects::observer::EngineObserver;
    use std::sync::Mutex;

    type Catalogue = Vec<(String, Vec<String>)>;

    #[derive(Default)]
    pub(super) struct Reader {
        pub(super) heard: Mutex<Vec<Catalogue>>,
    }

    impl EngineObserver for Reader {
        fn groups_changed(&self) {
            let read = with_persistent_engine(|engine| catalogue(&engine.groups)).expect("engine");
            self.heard.lock().unwrap().push(read);
        }
        fn sync_progress(&self) {}
        fn sync_settled(&self) {}
        fn activities_stored(&self) {}
        fn body_stored(&self, _kind: String, _activity_id: String) {}
        fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
        fn gps_track_stored(&self, _activity_id: String) {}
        fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
        fn fit_parsed(&self, _activity_id: String) {}
        fn detection_applied(&self) {}
        fn tiles_generated(&self) {}
        fn backfill_phase(&self, _phase: String) {}
        fn stream_backfill_phase(&self, _phase: String) {}
        fn cutover_settled(&self) {}
        fn preview_phase(&self, _phase: String) {}
        fn preview_finished(&self) {}
        fn recordings_changed(&self) {}
        fn upload_permission_refused(&self) {}
    }
}

#[test]
fn test_listener_reading_the_engine_when_told_sees_the_adopted_groups() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let reader = Arc::new(reads_the_engine_when_told::Reader::default());
    set_observer(Some(reader.clone()));

    assert!(schedule());
    assert!(wait_for_regroup(WAIT));
    crate::objects::observer::flush();
    set_observer(None);

    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    let heard = reader.heard.lock().unwrap();
    assert_eq!(*heard, vec![catalogue(&groups)]);
}
