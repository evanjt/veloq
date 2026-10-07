use std::time::Duration;

use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};
use crate::with_persistent_engine;

fn coords(base: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(base + f64::from(i) * 0.001, 7.3))
        .collect()
}

fn member_ids(groups: &[RouteGroup], member: &str) -> String {
    groups
        .iter()
        .find(|group| group.activity_ids.iter().any(|id| id == member))
        .map(|group| group.group_id.clone())
        .unwrap_or_else(|| panic!("no group holds {member}"))
}

/// Memory holds `r_1` for activity `m`, and `t` is stored since, so groups are
/// dirty. `commit` stands for a background run that regroups and ends without
/// applying, and returns the id it committed for `t`. The athlete names that
/// route, then `k`, whose members sort before `t`'s, is stored and the
/// foreground regroups.
fn assert_foreground_follows_background_commit(
    commit: impl FnOnce(&std::path::Path, u64, Vec<RouteGroup>) -> String,
) {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, prior) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        let prior = engine.get_groups().to_vec();
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        (crate::persistence::engine_install(), prior)
    })
    .expect("engine");
    assert_eq!(prior.len(), 1);

    let background_id = commit(&path, install, prior);
    assert_eq!(background_id, "r_2");

    let groups = with_persistent_engine(|engine| {
        engine
            .set_route_name(&background_id, Some("Hill loop"))
            .unwrap();
        engine
            .add_activity("k".into(), coords(48.0), "Ride".into())
            .unwrap();
        engine.get_groups().to_vec()
    })
    .expect("engine");

    assert_eq!(member_ids(&groups, "t"), background_id);
    assert_ne!(member_ids(&groups, "k"), background_id);
    let ids: HashSet<&str> = groups.iter().map(|group| group.group_id.as_str()).collect();
    assert_eq!(ids.len(), groups.len(), "no id may repeat");
    let conn = Connection::open(&path).unwrap();
    let named: String = conn
        .query_row(
            "SELECT custom_name FROM route_names WHERE route_id = ?",
            [&background_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(named, "Hill loop");
    let still_named = groups
        .iter()
        .find(|group| group.group_id == background_id)
        .and_then(|group| group.custom_name.as_deref());
    assert_eq!(still_named, Some("Hill loop"));

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// Every exit short of the apply, whether a cancel, an unusable pool or a
/// failed save, runs this step and nothing after it that touches groups.
#[test]
fn test_regroup_on_worker_adopts_commit_when_run_never_applies() {
    assert_foreground_follows_background_commit(|path, install, prior| {
        let conn = Connection::open(path).unwrap();
        let generation = read_group_generation(&conn).unwrap();
        let (committed, _) = regroup_on_worker(
            &conn,
            install,
            &MatchConfig::default(),
            &prior,
            generation,
            ApplyOn::Worker,
        );
        member_ids(&committed, "t")
    });
}

/// A run whose caller was to adopt its groups and never did: the cutover gives
/// up waiting on its detect, and the worker commits after the cutover's adopt.
#[test]
fn test_foreground_regroup_adopts_a_commit_nobody_adopted() {
    assert_foreground_follows_background_commit(|path, install, prior| {
        let conn = Connection::open(path).unwrap();
        let generation = read_group_generation(&conn).unwrap();
        let (committed, _) = regroup_on_worker(
            &conn,
            install,
            &MatchConfig::default(),
            &prior,
            generation,
            ApplyOn::Caller,
        );
        member_ids(&committed, "t")
    });
}

/// The same run through the worker itself, cancelled while its groups are
/// being written, so it commits them and stops before the track load.
#[test]
fn test_cancelled_detection_leaves_engine_on_committed_groups() {
    assert_foreground_follows_background_commit(|path, install, _| {
        let (entered, resume) = pause_next_group_write(path, install);
        let detection = with_persistent_engine(|engine| {
            engine.detect_sections_background_applying(ApplyOn::Worker)
        })
        .expect("engine");
        entered
            .recv_timeout(Duration::from_secs(5))
            .expect("group write reached");
        detection.request_cancel();
        resume.send(()).expect("release group write");
        let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));
        assert!(matches!(state, crate::persistence::WorkerPoll::Died));
        assert_eq!(detection.get_progress().0, PHASE_CANCELLED);
        let conn = Connection::open(path).unwrap();
        member_ids(&load_groups_from_db(&conn), "t")
    });
}

/// A run held at its group write while the foreground regroups over a newer
/// store and the athlete names the result. The run grouped an older catalogue,
/// so committing it would move the name onto another route and drop the
/// newcomer from every group.
#[test]
fn test_worker_does_not_commit_over_a_newer_foreground_regroup() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let install = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        assert_eq!(engine.get_groups().len(), 1);
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        crate::persistence::engine_install()
    })
    .expect("engine");

    let (entered, resume) = pause_next_group_write(&path, install);
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    entered
        .recv_timeout(Duration::from_secs(5))
        .expect("group write reached");

    let named_id = with_persistent_engine(|engine| {
        engine
            .add_activity("k".into(), coords(48.0), "Ride".into())
            .unwrap();
        let groups = engine.get_groups().to_vec();
        let id = member_ids(&groups, "k");
        engine.set_route_name(&id, Some("Hill loop")).unwrap();
        id
    })
    .expect("engine");

    detection.request_cancel();
    resume.send(()).expect("release group write");
    let _ = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));

    let conn = Connection::open(&path).unwrap();
    let stored = load_groups_from_db(&conn);
    assert_eq!(member_ids(&stored, "k"), named_id);
    let named: String = conn
        .query_row(
            "SELECT custom_name FROM route_names WHERE route_id = ?",
            [&named_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(named, "Hill loop");

    let groups = with_persistent_engine(|engine| engine.get_groups().to_vec()).expect("engine");
    for member in ["m", "t", "k"] {
        member_ids(&groups, member);
    }
    assert_eq!(member_ids(&groups, "k"), named_id);
    let ids: HashSet<&str> = groups.iter().map(|group| group.group_id.as_str()).collect();
    assert_eq!(ids.len(), groups.len(), "no id may repeat");
    let still_named = groups
        .iter()
        .find(|group| group.group_id == named_id)
        .and_then(|group| group.custom_name.as_deref());
    assert_eq!(still_named, Some("Hill loop"));

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A run held at its group write while the athlete chooses a route's
/// representative. The run carries the representative it snapshotted, so
/// committing would put the old one back.
#[test]
fn test_worker_does_not_commit_over_a_representative_chosen_during_its_run() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, route, chosen) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        engine
            .add_activity("n".into(), coords(40.0), "Ride".into())
            .unwrap();
        let groups = engine.get_groups().to_vec();
        assert_eq!(groups.len(), 1);
        let chosen = if groups[0].representative_id == "m" {
            "n"
        } else {
            "m"
        };
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        (
            crate::persistence::engine_install(),
            groups[0].group_id.clone(),
            chosen.to_string(),
        )
    })
    .expect("engine");

    let (entered, resume) = pause_next_group_write(&path, install);
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    entered
        .recv_timeout(Duration::from_secs(5))
        .expect("group write reached");

    with_persistent_engine(|engine| engine.set_route_representative(&route, &chosen))
        .expect("engine")
        .unwrap();

    detection.request_cancel();
    resume.send(()).expect("release group write");
    let _ = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));

    let conn = Connection::open(&path).unwrap();
    let stored: String = conn
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = ?",
            [&route],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, chosen);

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A run held at its group write while the athlete chooses a route's
/// representative, then let finish. The choice refuses the run's write but
/// regroups nothing, so `t`, stored before the run, is still owed a route once
/// the run has applied.
#[test]
fn test_refused_worker_regroup_leaves_the_regroup_owed() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, route, chosen) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        engine
            .add_activity("n".into(), coords(40.0), "Ride".into())
            .unwrap();
        let groups = engine.get_groups().to_vec();
        assert_eq!(groups.len(), 1);
        let chosen = if groups[0].representative_id == "m" {
            "n"
        } else {
            "m"
        };
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        (
            crate::persistence::engine_install(),
            groups[0].group_id.clone(),
            chosen.to_string(),
        )
    })
    .expect("engine");

    let (entered, resume) = pause_next_group_write(&path, install);
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    entered
        .recv_timeout(Duration::from_secs(5))
        .expect("group write reached");
    with_persistent_engine(|engine| engine.set_route_representative(&route, &chosen))
        .expect("engine")
        .unwrap();
    resume.send(()).expect("release group write");
    let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(30)));
    assert!(matches!(state, crate::persistence::WorkerPoll::Ready(_)));

    let (dirty, groups) = with_persistent_engine(|engine| {
        let dirty = engine.groups_are_dirty();
        (dirty, engine.get_groups().to_vec())
    })
    .expect("engine");
    assert!(dirty, "the refused regroup is still owed after the apply");
    member_ids(&groups, "t");
    let representative = groups
        .iter()
        .find(|group| group.group_id == route)
        .map(|group| group.representative_id.clone());
    assert_eq!(representative.as_deref(), Some(chosen.as_str()));

    crate::persistence::clear_persistent_engine();
}

/// An engine opened over a library that has regrouped must start on the
/// stored generation, or every background regroup until the first foreground
/// one is refused as superseded.
#[test]
fn test_reopened_engine_takes_the_stored_group_generation() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        assert_eq!(engine.get_groups().len(), 1);
    })
    .expect("engine");
    crate::persistence::clear_persistent_engine();

    assert!(
        crate::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_string_lossy().into_owned()
        )
    );
    let conn = Connection::open(&path).unwrap();
    let stored = read_group_generation(&conn).unwrap();
    assert!(stored > 0, "the foreground regroup advanced the generation");
    let (install, generation, prior) = with_persistent_engine(|engine| {
        let generation = engine.group_generation;
        let prior = engine.groups.clone();
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        (crate::persistence::engine_install(), generation, prior)
    })
    .expect("engine");
    assert_eq!(generation, stored);

    regroup_on_worker(
        &conn,
        install,
        &MatchConfig::default(),
        &prior,
        generation,
        ApplyOn::Caller,
    );
    member_ids(&load_groups_from_db(&conn), "t");

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A wipe deletes the stored generation with the registry, so the engine's
/// own goes back to zero beside it.
#[test]
fn test_clear_resets_the_group_generation() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, generation) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        assert_eq!(engine.get_groups().len(), 1);
        engine.clear().unwrap();
        engine
            .add_activity("a".into(), coords(44.0), "Ride".into())
            .unwrap();
        (
            crate::persistence::engine_install(),
            engine.group_generation,
        )
    })
    .expect("engine");

    let conn = Connection::open(&path).unwrap();
    assert_eq!(generation, read_group_generation(&conn).unwrap());
    regroup_on_worker(
        &conn,
        install,
        &MatchConfig::default(),
        &[],
        generation,
        ApplyOn::Caller,
    );
    let stored = load_groups_from_db(&conn);
    assert_eq!(stored.len(), 1);
    member_ids(&stored, "a");

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// Memory holds `r_1` for `m`, `t` is stored, and a run whose caller never
/// applies commits `t` under `r_2`, as when the cutover gives up waiting on
/// its detect. Returns the database path, with the engine still on `r_1`.
fn commit_nobody_adopts(dir: &tempfile::TempDir, t_track: f64) -> std::path::PathBuf {
    let path = dir.path().join("regroup.db");
    let (install, prior) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        let prior = engine.get_groups().to_vec();
        assert_eq!(
            crate::persistence::routes::pooled::group_by_id(&engine.db, "r_1")
                .unwrap()
                .activity_ids
                .len(),
            1
        );
        engine
            .add_activity("t".into(), coords(t_track), "Ride".into())
            .unwrap();
        (crate::persistence::engine_install(), prior)
    })
    .expect("engine");
    let conn = Connection::open(&path).unwrap();
    let generation = read_group_generation(&conn).unwrap();
    regroup_on_worker(
        &conn,
        install,
        &MatchConfig::default(),
        &prior,
        generation,
        ApplyOn::Caller,
    );
    path
}

#[test]
fn test_representative_choice_reaches_a_route_committed_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = commit_nobody_adopts(&dir, 44.0);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(member_ids(&load_groups_from_db(&conn), "t"), "r_2");

    let chosen = with_persistent_engine(|engine| engine.set_route_representative("r_2", "t"))
        .expect("engine");
    assert_eq!(chosen, Ok(()));
    let stored: String = conn
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = 'r_2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "t");

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_route_name_reaches_a_route_committed_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    commit_nobody_adopts(&dir, 44.0);

    let named = with_persistent_engine(|engine| {
        engine.set_route_name("r_2", Some("Hill loop")).unwrap();
        engine.get_route_name("r_2")
    })
    .expect("engine");
    assert_eq!(named.as_deref(), Some("Hill loop"));

    crate::persistence::clear_persistent_engine();
}

/// The flag is forced clean so the read cannot reach the regroup, which adopts
/// on its own.
#[test]
fn test_clean_group_read_follows_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    commit_nobody_adopts(&dir, 44.0);

    let groups = with_persistent_engine(|engine| {
        engine.groups_dirty = false;
        engine.get_groups().to_vec()
    })
    .expect("engine");
    assert_eq!(member_ids(&groups, "t"), "r_2");

    crate::persistence::clear_persistent_engine();
}

/// `t` rides `m`'s track, so the commit puts it in `r_1`, which the engine had
/// already cached with `m` alone.
#[test]
fn test_group_by_id_follows_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = commit_nobody_adopts(&dir, 40.0);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(member_ids(&load_groups_from_db(&conn), "t"), "r_1");

    let members = with_persistent_engine(|engine| {
        crate::persistence::routes::pooled::group_by_id(&engine.db, "r_1")
    })
    .expect("engine")
    .expect("r_1 is stored")
    .activity_ids;
    assert_eq!(members.len(), 2);

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A background regroup commits `t` into `r_1` after the representative choice
/// has followed the database and before its own write. Taking that commit's
/// generation as its own would leave the engine on `r_1` with `m` alone for
/// good, since no later read sees the generation move.
#[test]
fn test_representative_choice_follows_a_commit_landing_before_its_write() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, prior) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        let prior = engine.get_groups().to_vec();
        engine
            .add_activity("t".into(), coords(40.0), "Ride".into())
            .unwrap();
        (crate::persistence::engine_install(), prior)
    })
    .expect("engine");
    assert_eq!(prior.len(), 1);

    let commit_path = path.clone();
    crate::persistence::routes::before_next_representative_write(move || {
        let conn = Connection::open(&commit_path).unwrap();
        let generation = read_group_generation(&conn).unwrap();
        regroup_on_worker(
            &conn,
            install,
            &MatchConfig::default(),
            &prior,
            generation,
            ApplyOn::Caller,
        );
    });

    let (chosen, members, generation) = with_persistent_engine(|engine| {
        engine.groups_dirty = false;
        let chosen = engine.set_route_representative("r_1", "m");
        let members = engine
            .groups
            .iter()
            .find(|group| group.group_id == "r_1")
            .map(|group| group.activity_ids.len());
        (chosen, members, engine.group_generation)
    })
    .expect("engine");

    let conn = Connection::open(&path).unwrap();
    assert_eq!(member_ids(&load_groups_from_db(&conn), "t"), "r_1");
    assert_eq!(chosen, Ok(()));
    assert_eq!(members, Some(2), "memory holds the commit's member");
    assert_eq!(generation, read_group_generation(&conn).unwrap());
    let stored: String = conn
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = 'r_1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "m");

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A background regroup commits before every attempt at the write.
fn commit_before_each_representative_write(path: std::path::PathBuf, install: u64, left: u32) {
    crate::persistence::routes::before_next_representative_write(move || {
        let conn = Connection::open(&path).unwrap();
        let generation = read_group_generation(&conn).unwrap();
        let prior = load_groups_from_db(&conn);
        regroup_on_worker(
            &conn,
            install,
            &MatchConfig::default(),
            &prior,
            generation,
            ApplyOn::Caller,
        );
        if left > 1 {
            commit_before_each_representative_write(path, install, left - 1);
        }
    });
}

/// Commits keep landing before the write, so the choice gives up rather than
/// writing over any of them, and the next read follows the last.
#[test]
fn test_representative_choice_refuses_when_commits_keep_landing() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = dir.path().join("regroup.db");
    let (install, chosen) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        engine
            .add_activity("n".into(), coords(40.0), "Ride".into())
            .unwrap();
        let groups = engine.get_groups().to_vec();
        assert_eq!(groups.len(), 1);
        let chosen = if groups[0].representative_id == "m" {
            "n"
        } else {
            "m"
        };
        (crate::persistence::engine_install(), chosen.to_string())
    })
    .expect("engine");

    commit_before_each_representative_write(path.clone(), install, 3);
    let refused = with_persistent_engine(|engine| engine.set_route_representative("r_1", &chosen))
        .expect("engine");
    assert!(refused.is_err());

    let conn = Connection::open(&path).unwrap();
    let stored: String = conn
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = 'r_1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(stored, chosen);
    let generation = with_persistent_engine(|engine| engine.group_generation).expect("engine");
    assert_eq!(generation, read_group_generation(&conn).unwrap());

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

fn timed(id: &str, date: i64) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.into(),
        name: id.into(),
        date,
        distance: 8_000.0,
        moving_time: 1_200,
        elapsed_time: 1_300,
        sport_type: "Ride".into(),
        ..Default::default()
    }
}

/// `commit_nobody_adopts` with both activities timed, so `t`, the newer, is
/// the only attempt on its route.
fn timed_commit_nobody_adopts(dir: &tempfile::TempDir) {
    with_persistent_engine(|engine| {
        engine
            .set_activity_metrics(vec![timed("m", 1_000), timed("t", 2_000)])
            .unwrap();
    })
    .expect("engine");
    commit_nobody_adopts(dir, 44.0);
}

#[test]
fn test_route_name_read_follows_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    commit_nobody_adopts(&dir, 44.0);

    let named = with_persistent_engine(|engine| engine.get_route_name("r_2")).expect("engine");
    assert!(named.is_some(), "r_2 is stored and named");

    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_excluded_performances_follow_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    timed_commit_nobody_adopts(&dir);
    let conn = Connection::open(dir.path().join("regroup.db")).unwrap();
    conn.execute(
        "UPDATE activity_matches SET excluded = 1 WHERE route_id = 'r_2' AND activity_id = 't'",
        [],
    )
    .unwrap();
    assert_eq!(conn.changes(), 1, "the worker wrote the row");

    let excluded =
        with_persistent_engine(|engine| engine.get_excluded_route_performances("r_2", None))
            .expect("engine");
    let ids: Vec<&str> = excluded
        .performances
        .iter()
        .map(|performance| performance.activity_id.as_str())
        .collect();
    assert_eq!(ids, ["t"]);

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_route_highlights_follow_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    timed_commit_nobody_adopts(&dir);

    let highlights =
        with_persistent_engine(|engine| engine.get_activity_route_highlights(&["t".into()]))
            .expect("engine");
    let routes: Vec<&str> = highlights
        .iter()
        .map(|highlight| highlight.route_id.as_str())
        .collect();
    assert_eq!(routes, ["r_2"]);

    crate::persistence::clear_persistent_engine();
}

/// `t` rides `m`'s track faster, so the commit puts it in `r_1` as that
/// route's record.
#[test]
fn test_widget_snapshot_follows_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    with_persistent_engine(|engine| {
        let faster = crate::ActivityMetrics {
            moving_time: 1_000,
            ..timed("t", 2_000)
        };
        engine
            .set_activity_metrics(vec![timed("m", 1_000), faster])
            .unwrap();
    })
    .expect("engine");
    commit_nobody_adopts(&dir, 40.0);

    let snapshot = with_persistent_engine(|engine| engine.widget_snapshot_data(0, 1, 0, 1, 7, 10))
        .expect("engine");
    assert_eq!(
        snapshot.latest.map(|latest| latest.activity_id).as_deref(),
        Some("t")
    );
    assert!(snapshot.latest_is_pr, "t is the record on r_1");

    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_engine_stats_follow_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    commit_nobody_adopts(&dir, 44.0);

    let groups = with_persistent_engine(|engine| engine.stats().group_count).expect("engine");
    assert_eq!(groups, 2);

    crate::persistence::clear_persistent_engine();
}

/// A run spawned over the groups the commit replaced is refused as superseded,
/// so `k` would wait for a later regroup to be grouped at all.
#[test]
fn test_detection_spawn_follows_a_commit_behind_the_engine() {
    let _serial = serial_global_state();
    let dir = init_global_engine("regroup.db");
    let path = commit_nobody_adopts(&dir, 44.0);

    let detection = with_persistent_engine(|engine| {
        engine
            .add_activity("k".into(), coords(48.0), "Ride".into())
            .unwrap();
        engine.detect_sections_background_applying(ApplyOn::Caller)
    })
    .expect("engine");
    let _ = detection.recv_state_with_cache_within(Some(Duration::from_secs(30)));

    let conn = Connection::open(&path).unwrap();
    let stored = load_groups_from_db(&conn);
    for member in ["m", "t", "k"] {
        member_ids(&stored, member);
    }

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

/// A worker-applied run that regroups with nothing stored while it ran leaves
/// no regroup owed, so the next read does not regroup the whole library again.
#[test]
fn test_worker_applied_run_that_regrouped_leaves_nothing_owed() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        engine.get_groups();
        engine
            .add_activity("t".into(), coords(44.0), "Ride".into())
            .unwrap();
        assert!(engine.groups_are_dirty());
    })
    .expect("engine");

    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(30)));
    assert!(matches!(state, crate::persistence::WorkerPoll::Ready(_)));

    let dirty = with_persistent_engine(|engine| engine.groups_are_dirty()).expect("engine");
    assert!(!dirty, "nothing was stored during the run");
    crate::persistence::clear_persistent_engine();
}

/// Adopting a commit while a regroup is owed keeps it owed without counting as
/// a new store, which a run reads a moved epoch as.
#[test]
fn test_adopting_a_commit_keeps_an_owed_regroup_without_moving_the_epoch() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("regroup.db");
    let (before, after, dirty) = with_persistent_engine(|engine| {
        engine
            .add_activity("m".into(), coords(40.0), "Ride".into())
            .unwrap();
        assert!(engine.groups_are_dirty());
        let before = engine.groups_dirty_epoch;
        engine.adopt_committed_groups();
        (before, engine.groups_dirty_epoch, engine.groups_are_dirty())
    })
    .expect("engine");
    assert_eq!(before, after);
    assert!(dirty);
    crate::persistence::clear_persistent_engine();
}
