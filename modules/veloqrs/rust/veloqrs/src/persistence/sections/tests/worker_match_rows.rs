//! Scenario: the background regroup commits route groups and must commit the
//! measured match rows with them. A missing row is backfilled on reload as
//! forward at 0 per cent, and a row left under a route the member left names
//! that route for its sections.
//!
//! Expected behaviour: after the worker commits, every non-representative
//! member has its measured direction and a non-zero percentage under its own
//! route, and no row names a route the member is not in.

use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};
use crate::with_persistent_engine;

fn line(lat: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(lat + f64::from(i) * 0.001, 7.3))
        .collect()
}

fn reversed(lat: f64) -> Vec<GpsPoint> {
    let mut points = line(lat);
    points.reverse();
    points
}

fn rows(conn: &Connection) -> Vec<(String, String, f64, String)> {
    let mut stmt = conn
        .prepare("SELECT route_id, activity_id, match_percentage, direction FROM activity_matches")
        .unwrap();
    stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    })
    .unwrap()
    .map(|r| r.unwrap())
    .collect()
}

fn row_of(
    rows: &[(String, String, f64, String)],
    route: &str,
    activity: &str,
) -> Option<(f64, String)> {
    rows.iter()
        .find(|r| r.0 == route && r.1 == activity)
        .map(|r| (r.2, r.3.clone()))
}

/// Four forward rides of one line are grouped and stored. `x` is then added
/// reversed over the same line, and a stale row puts `x` under a second live
/// route it never belonged to. The worker regroups with `incremental` choosing
/// the arm: a prior catalogue takes the incremental arm, none takes the full one.
fn run_worker(incremental: bool) {
    let _serial = serial_global_state();
    let dir = init_global_engine("matches.db");
    let path = dir.path().join("matches.db");
    let (install, prior) = with_persistent_engine(|engine| {
        for (i, id) in ["a1", "a2", "a3", "a4"].iter().enumerate() {
            engine
                .add_activity(
                    (*id).into(),
                    line(40.0 + i as f64 * 0.000_01),
                    "Ride".into(),
                )
                .unwrap();
        }
        engine
            .add_activity("far".into(), line(44.0), "Ride".into())
            .unwrap();
        let prior = engine.get_groups().to_vec();
        engine
            .add_activity("x".into(), reversed(40.0), "Ride".into())
            .unwrap();
        (crate::persistence::engine_install(), prior)
    })
    .expect("engine");

    let near = prior
        .iter()
        .find(|g| g.activity_ids.iter().any(|id| id == "a1"))
        .unwrap()
        .group_id
        .clone();
    let other = prior
        .iter()
        .find(|g| g.activity_ids.iter().any(|id| id == "far"))
        .unwrap()
        .group_id
        .clone();
    assert_ne!(near, other);

    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO activity_matches (route_id, activity_id, match_percentage, direction)
         VALUES (?, 'x', 55.0, 'same')",
        [&other],
    )
    .unwrap();
    let generation = read_group_generation(&conn).unwrap();
    let existing = if incremental { prior } else { Vec::new() };
    let (committed, save) = regroup_on_worker(
        &conn,
        install,
        &MatchConfig::default(),
        &existing,
        generation,
        ApplyOn::Caller,
    );
    assert_eq!(save, GroupSave::Committed);
    let route = committed
        .iter()
        .find(|g| g.activity_ids.iter().any(|id| id == "x"))
        .expect("x is grouped")
        .group_id
        .clone();

    let check = |rows: &[(String, String, f64, String)]| {
        let (pct, direction) = row_of(rows, &route, "x").expect("a row for x under its route");
        assert_eq!(direction, "reverse");
        assert!(pct > 0.0, "x measured, not defaulted: {pct}");
        for group in &committed {
            for member in &group.activity_ids {
                if *member == group.representative_id {
                    continue;
                }
                let (pct, _) = row_of(rows, &group.group_id, member).expect("member row");
                assert!(pct > 0.0, "{member} has no measured percentage");
            }
        }
        for (route_id, activity, ..) in rows {
            let held = committed
                .iter()
                .find(|g| g.group_id == *route_id)
                .is_some_and(|g| g.activity_ids.contains(activity));
            assert!(held, "stale row ({route_id}, {activity})");
        }
    };
    check(&rows(&conn));

    with_persistent_engine(|engine| engine.follow_committed_groups()).expect("engine");
    check(&rows(&conn));

    drop(conn);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn test_incremental_worker_regroup_writes_measured_match_rows() {
    run_worker(true);
}

#[test]
fn test_full_worker_regroup_writes_measured_match_rows() {
    run_worker(false);
}
