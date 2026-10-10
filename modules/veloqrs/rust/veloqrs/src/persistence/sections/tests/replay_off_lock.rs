use std::sync::mpsc;
use std::time::Duration;

use rusqlite::Connection;
use tempfile::TempDir;

use super::*;

fn line(latitude: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|index| GpsPoint::new(latitude + f64::from(index) * 0.000_1, 7.0))
        .collect()
}

fn cut(latitude: f64, members: &[&str]) -> FrequentSection {
    let polyline = line(latitude);
    FrequentSection {
        id: "raw".into(),
        name: None,
        sport_type: "Ride".into(),
        distance_meters: 440.0,
        point_density: vec![2; polyline.len()],
        polyline,
        representative_activity_id: members[0].into(),
        representative_range: Some((0, 39)),
        activity_ids: members.iter().map(|id| (*id).into()).collect(),
        activity_portions: vec![],
        visit_count: members.len() as u32,
        activity_traces: HashMap::new(),
        confidence: 0.9,
        observation_count: members.len() as u32,
        average_spread: 4.0,
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        version: 0,
        updated_at: None,
        created_at: None,
        enrichment: Default::default(),
        rank: None,
        consensus_state: None,
    }
}

fn replay() -> SectionReplay<&'static str> {
    SectionReplay::new(vec![
        ReplayStep {
            arrival: Arrival::Activity("hill".into()),
            changed: vec![("hill", Some(vec![cut(47.0, &["hill"])]))],
        },
        ReplayStep {
            arrival: Arrival::Activity("valley-1".into()),
            changed: vec![
                ("hill", None),
                ("valley", Some(vec![cut(46.0, &["valley-1"])])),
            ],
        },
        ReplayStep {
            arrival: Arrival::Activity("valley-2".into()),
            changed: vec![("valley", Some(vec![cut(46.0, &["valley-1", "valley-2"])]))],
        },
        ReplayStep {
            arrival: Arrival::Activity("valley-3".into()),
            changed: vec![(
                "valley",
                Some(vec![cut(46.0, &["valley-1", "valley-2", "valley-3"])]),
            )],
        },
    ])
}

fn seeded() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("replay.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    for (id, latitude) in [
        ("hill", 47.0),
        ("valley-1", 46.0),
        ("valley-2", 46.0),
        ("valley-3", 46.0),
    ] {
        engine
            .add_activity(id.into(), line(latitude), "Ride".into())
            .expect("activity");
    }
    (dir, engine)
}

fn normalised(mut identity: SectionIdentity, mut applied: ReplayApplied) -> serde_json::Value {
    for row in identity.rows.values_mut() {
        row.section.created_at = None;
    }
    for grave in identity.graves.values_mut() {
        grave.created_at = None;
    }
    for section in &mut applied.visible {
        section.created_at = None;
    }
    let events: Vec<_> = applied
        .events
        .iter()
        .map(|event| {
            (
                event.real_id.clone(),
                event.kind,
                event.details.clone(),
                event.geometry.clone(),
                event.reference.clone(),
            )
        })
        .collect();
    serde_json::json!({
        "identity": identity,
        "visible": applied.visible,
        "events": events,
        "raw": applied.raw,
    })
}

#[test]
fn test_replay_snapshot_matches_locked_lifecycle() {
    let (_dir, engine) = seeded();
    let mut locked_identity = engine.identity.clone();
    let locked = engine.section_identity_apply_into(&mut locked_identity, replay());
    assert!(!locked.events.is_empty(), "the lifecycle fired no events");

    let snapshot = IdentityReplaySnapshot::capture(&engine);
    let (off_lock_identity, off_lock) = snapshot.replay(&engine.db, replay(), &[]);
    assert_eq!(
        normalised(off_lock_identity, off_lock),
        normalised(locked_identity, locked)
    );
}

#[test]
fn test_replay_snapshot_runs_while_engine_lock_is_held() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = crate::test_globals::init_global_engine("replay-lock.db");
    let snapshot = crate::persistence::with_persistent_engine(|engine| {
        for (id, latitude) in [
            ("hill", 47.0),
            ("valley-1", 46.0),
            ("valley-2", 46.0),
            ("valley-3", 46.0),
        ] {
            engine
                .add_activity(id.into(), line(latitude), "Ride".into())
                .expect("activity");
        }
        IdentityReplaySnapshot::capture(engine)
    })
    .expect("engine");
    let path = dir.path().join("replay-lock.db");
    let (held_tx, held_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        crate::persistence::with_persistent_engine(|_| {
            held_tx.send(()).expect("held signal");
            release_rx.recv_timeout(Duration::from_secs(30)).is_ok()
        })
    });
    held_rx.recv().expect("writer took the lock");

    let (done_tx, done_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let conn = Connection::open(path).expect("read connection");
        let result = snapshot.replay(&conn, replay(), &[]);
        done_tx.send(result.1.events.len()).expect("result signal");
    });
    let finished = done_rx.recv_timeout(Duration::from_secs(10));
    release_tx.send(()).expect("release writer");
    assert_eq!(writer.join().expect("writer"), Some(true));
    worker.join().expect("worker");
    assert!(finished.is_ok(), "replay waited for the engine lock");
}
