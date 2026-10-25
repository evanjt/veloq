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

/// Scenario: a lock take adopts a commit the pass made before its swap runs,
/// so readers are told of the new catalogue while the regroup is still owed,
/// and the swap that finds the generation current then clears the flag.
/// Expected behaviour: readers are told again once the flag has cleared, so a
/// screen that read the owed flag on the first announcement is not left
/// reading it after the regroup has settled.
#[test]
fn test_swap_clearing_the_flag_a_lock_take_announced_announces_again() {
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
    let read_on_adopt = with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine");
    let before_swap = recorder.events();
    resume.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    let events = recorder.events();
    set_observer(None);

    assert_eq!(before_swap, vec!["groups_changed"]);
    assert!(
        read_on_adopt,
        "the adopting take reads the regroup still owed"
    );
    assert!(!with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine"));
    assert_eq!(events, vec!["groups_changed", "groups_changed"]);
}

/// Scenario: a pass commits, but a store lands before its swap, so the swap
/// leaves the regroup owed and runs a second pass.
/// Expected behaviour: the flag never cleared, so no swap announces a clear;
/// readers hear only of the catalogues that were adopted.
#[test]
fn test_swap_leaving_the_flag_owed_announces_no_clear() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let (entered, resume) = pause_next_regroup_swap();
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its swap");
    with_persistent_engine(|engine| store(engine, "u", 48.0)).expect("engine");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));
    let (entered_second, resume_second) = pause_next_regroup_swap();
    resume.send(()).unwrap();
    entered_second
        .recv_timeout(WAIT)
        .expect("the second pass reached its swap");
    let between_passes = recorder.events();
    resume_second.send(()).unwrap();
    assert!(wait_for_regroup(WAIT));
    set_observer(None);

    assert!(between_passes.is_empty(), "announced {between_passes:?}");
}

/// Scenario: a detection run that regroups and commits on its own worker
/// adopts the groups in the hold that saves its sections, with the regroup
/// still owed, and clears the flag in the later hold that finalizes the run.
/// Expected behaviour: readers hear of the adopted groups and again of the
/// cleared flag, since a reader woken by the first can read between the holds.
#[test]
fn test_worker_detection_regroup_announces_the_groups_and_the_settled_flag() {
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

    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some());
    assert!(!dirty);
    // Announcements pushed before the delivery thread takes its batch collapse
    // into one, so the count of deliveries is one or two; the finalising
    // announcement is pinned on its own below.
    assert!(
        events.iter().any(|e| e == "groups_changed"),
        "announced {events:?}"
    );
}

/// Scenario: one hold adopts the committed groups with the regroup still owed,
/// and a later hold finalizes the run and clears the flag.
/// Expected behaviour: the later hold announces again, and the first delivery
/// has finished before it, so the two cannot collapse into one.
#[test]
fn test_finalizing_hold_announces_the_cleared_flag_after_the_adopting_hold() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    grouped_library(&[("t", 44.0)]);
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let epoch = with_persistent_engine(|engine| {
        engine.adopt_committed_groups();
        engine.groups_dirty_epoch
    })
    .expect("engine");
    crate::objects::observer::flush();
    let after_adopting_hold = recorder.events();
    with_persistent_engine(|engine| {
        engine.adopt_run_groups(false, epoch);
        assert!(!engine.groups_are_dirty());
    })
    .expect("engine");
    crate::objects::observer::flush();
    let events = recorder.events();
    set_observer(None);

    assert_eq!(after_adopting_hold, vec!["groups_changed"]);
    assert_eq!(events, vec!["groups_changed", "groups_changed"]);
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

/// A reader that settles the grouping waits on the pass in flight, gives up at
/// its limit while that pass is held, and finds the stored activity in a route
/// once it has swapped.
#[test]
fn test_settle_waits_on_the_pass_in_flight_up_to_its_limit() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    let (install, _) = grouped_library(&[("t", 40.0)]);

    let (entered, resume) = pause_next_regroup_swap();
    assert!(schedule());
    entered
        .recv_timeout(WAIT)
        .expect("the pass reached its swap");
    assert!(
        !settle_regroup(install, Duration::from_millis(50)),
        "a held pass outlasts the limit"
    );
    resume.send(()).unwrap();

    assert!(settle_regroup(install, WAIT));
    let groups = with_persistent_engine(|engine| engine.groups.clone()).expect("engine");
    assert!(holder(&groups, "t").is_some(), "t is in no route");
}

/// A store made while another regroup holds the slot schedules nothing, so a
/// reader that only waited for the slot would find the activity in no route.
/// Settling schedules the pass that is still owed and waits on it too.
#[test]
fn test_settle_schedules_what_a_held_slot_left_owed() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    let claim = claim_regroup().expect("the slot is free");
    let (install, _) = grouped_library(&[("t", 40.0)]);
    assert!(!schedule(), "the held slot takes the schedule");

    let settler = std::thread::spawn(move || settle_regroup(install, WAIT));
    drop(claim);

    assert!(settler.join().expect("settler"));
    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some(), "t is in no route");
    assert!(!dirty);
}

/// A library with nothing owed is settled at once, and one whose detection is
/// off never groups, so the reader is not held for the limit.
#[test]
fn test_settle_returns_at_once_when_nothing_will_regroup() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    let (install, _) = grouped_library(&[("t", 40.0)]);
    with_persistent_engine(|engine| engine.get_groups().len()).expect("engine");
    assert!(settle_regroup(install, Duration::ZERO));

    let dirty = with_persistent_engine(|engine| {
        engine.set_detection_enabled(false).unwrap();
        store(engine, "u", 44.0);
        engine.groups_are_dirty()
    })
    .expect("engine");
    assert!(dirty);
    assert!(settle_regroup(install, Duration::ZERO));
}

/// `m` grouped and `stored` added after it, then the engine closed, so the
/// file it reopens on holds signatures in no group.
fn closed_with_stored_in_no_group(stored: &[(&str, f64)]) {
    grouped_library(stored);
    crate::persistence::clear_persistent_engine();
}

fn reopen(path: &std::path::Path) {
    assert!(
        crate::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_string_lossy().into_owned()
        )
    );
}

/// Whether the open left a regroup in flight. The open takes the slot before
/// it returns, so a free slot here is a regroup it never scheduled.
fn open_scheduled_a_regroup() -> bool {
    claim_regroup().is_none()
}

/// Scenario: a library is opened with an activity stored after its last
/// regroup, and no sync follows.
/// Expected behaviour: the open schedules the regroup it finds owed, so the
/// activity joins a route and the flag clears without a sync.
#[test]
fn test_open_schedules_the_regroup_its_load_finds_owed() {
    let _serial = serial_global_state();
    let dir = init_global_engine("reopen.db");
    let path = dir.path().join("reopen.db");
    closed_with_stored_in_no_group(&[("t", 44.0)]);

    reopen(&path);
    assert!(open_scheduled_a_regroup());
    assert!(wait_for_regroup(WAIT));

    let (groups, dirty) =
        with_persistent_engine(|engine| (engine.groups.clone(), engine.groups_are_dirty()))
            .expect("engine");
    assert!(holder(&groups, "t").is_some(), "t is in no route");
    assert!(!dirty);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_open_with_route_matching_off_schedules_no_regroup() {
    let _serial = serial_global_state();
    let dir = init_global_engine("reopen.db");
    let path = dir.path().join("reopen.db");
    grouped_library(&[("t", 44.0)]);
    with_persistent_engine(|engine| engine.set_detection_enabled(false).unwrap()).expect("engine");
    crate::persistence::clear_persistent_engine();

    reopen(&path);
    assert!(!open_scheduled_a_regroup());
    assert!(with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine"));
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the library still owes the detector cutover when it opens.
/// Expected behaviour: the open leaves the owed regroup to the cutover, whose
/// own detect regroups, rather than starting one the cutover's would be
/// refused over.
#[test]
fn test_open_with_the_cutover_owed_leaves_the_regroup_to_it() {
    let _serial = serial_global_state();
    let dir = init_global_engine("reopen.db");
    let path = dir.path().join("reopen.db");
    grouped_library(&[("t", 44.0)]);
    with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO sections
                     (id, section_type, name, sport_type, polyline_json, polyline_blob,
                      distance_meters, representative_activity_id, rep_start_index,
                      rep_end_index, geometry_source, created_at, is_user_defined,
                      bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s_old', 'auto', 'Old cut', 'Ride', NULL, ?1, 700.0,
                         'm', 0, 7, 'exact', '2026-01-01T00:00:00Z', 0,
                         40.0, 40.01, 7.3, 7.31)",
                rusqlite::params![crate::persistence::codec::serialize_track_points(&coords(
                    40.0
                ))],
            )
            .expect("a catalogue another detector cut");
        assert!(engine.cutover_is_owed());
    })
    .expect("engine");
    crate::persistence::clear_persistent_engine();

    reopen(&path);
    assert!(!open_scheduled_a_regroup());
    assert!(crate::persistence::cutover::cutover_held());
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_open_of_a_settled_library_schedules_no_regroup() {
    let _serial = serial_global_state();
    let dir = init_global_engine("reopen.db");
    let path = dir.path().join("reopen.db");
    with_persistent_engine(|engine| {
        store(engine, "m", 40.0);
        engine.get_groups();
        assert!(!engine.groups_are_dirty());
    })
    .expect("engine");
    crate::persistence::clear_persistent_engine();

    reopen(&path);
    assert!(!open_scheduled_a_regroup());
    assert!(!with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine"));
    crate::persistence::clear_persistent_engine();
}
