//! Replay an upgrade from a schema-12 library through migration, the elevation
//! splice and the detector cutover, on copies, to measure how the elevation the
//! backfill writes between engine open and the cutover moves the cutover's
//! outcome.
//!
//! It reads library files named in the environment, works on copies, and
//! writes its snapshots to a scratch directory:
//!
//!     UPGRADE_REPLAY_DB=<schema-12 routes.db>
//!     UPGRADE_REPLAY_ELEVATION_DB=<an upgraded routes.db whose tracks carry elevation>
//!     UPGRADE_REPLAY_OUT=<scratch directory>
//!     UPGRADE_REPLAY_VARIANT=flat|elevated|quantised
//!     UPGRADE_REPLAY_ATTACH=<activity ids, comma separated, or *>   (optional)
//!     UPGRADE_REPLAY_TIMES=1                                        (optional)
//!     cargo run --example upgrade_elevation_replay
//!
//! `flat` runs the cutover on the tracks as migrated. `elevated` splices each
//! track's stored elevation from the second file through
//! `splice_track_elevation`, which is what the backfill does before it hands
//! over to the cutover. `quantised` splices no elevation at all, so the only
//! change is the track blob re-encoded at the quantised codec's step.
//!
//! `UPGRADE_REPLAY_ATTACH` re-attaches activities against the flat-era
//! catalogue first, as the first sync's first-use ingest does, and
//! `UPGRADE_REPLAY_TIMES` stores the second file's time streams where they
//! differ, as the sync's time-stream refetch does. Together with `elevated`
//! they follow the order an upgraded install runs at its first launch.

use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec::TrackRead;
use veloqrs::persistence::persistent_engine_ffi::{last_init_outcome, persistent_engine_init};

fn snapshot(live: &Path, out: &Path) {
    let _ = std::fs::remove_file(out);
    let conn = Connection::open(live).unwrap();
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    conn.execute("VACUUM INTO ?1", [out.to_str().unwrap()])
        .unwrap();
}

fn read_only(path: &str) -> Connection {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// Per activity, the elevation series to splice and the provenance state the
/// second file recorded for it.
fn elevations(path: &str, quantise_only: bool) -> BTreeMap<String, (Vec<f64>, u8)> {
    let conn = read_only(path);
    let mut stmt = conn
        .prepare("SELECT activity_id, track_data, elevation_state FROM gps_tracks")
        .unwrap();
    stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Vec<u8>>(1)?,
            r.get::<_, u8>(2)?,
        ))
    })
    .unwrap()
    .map(Result::unwrap)
    .filter_map(|(id, blob, state)| match TrackRead::from_blob(&blob) {
        TrackRead::Present(points) => {
            let series = points
                .iter()
                .map(|p| match p.elevation {
                    Some(e) if !quantise_only => e,
                    _ => f64::NAN,
                })
                .collect();
            Some((id, (series, state)))
        }
        _ => None,
    })
    .collect()
}

/// The time streams the second file holds that differ from the first's, as the
/// flat buffer `set_time_streams_flat` takes. The sync refetches a stream whose
/// length disagrees with its track, so these are the ones a launch replaces.
fn moved_time_streams(before: &str, after: &str) -> (Vec<String>, Vec<u32>, Vec<u32>) {
    let read = |path: &str| -> BTreeMap<String, Vec<u8>> {
        let conn = read_only(path);
        let mut stmt = conn
            .prepare("SELECT activity_id, times FROM time_streams")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let old = read(before);
    let (mut ids, mut flat, mut offsets) = (Vec::new(), Vec::new(), Vec::new());
    for (id, blob) in read(after) {
        let Some(prior) = old.get(&id) else { continue };
        let times: Vec<u32> = veloqrs::persistence::codec::deserialize(&blob).unwrap();
        let prior: Vec<u32> = veloqrs::persistence::codec::deserialize(prior).unwrap();
        if times == prior {
            continue;
        }
        offsets.push(flat.len() as u32);
        flat.extend(times);
        ids.push(id);
    }
    (ids, flat, offsets)
}

fn report(label: &str, db: &Path) {
    let conn = read_only(db.to_str().unwrap());
    let one = |sql: &str| -> String {
        conn.query_row(sql, [], |r| r.get::<_, Option<String>>(0))
            .ok()
            .flatten()
            .unwrap_or_default()
    };
    println!(
        "[{label}] sections {}",
        one("SELECT CAST(COUNT(*) AS TEXT) FROM sections")
    );
    println!(
        "[{label}] junction rows {}",
        one("SELECT CAST(COUNT(*) AS TEXT) FROM section_activities")
    );
    println!(
        "[{label}] diff {}",
        one("SELECT value FROM settings WHERE key = '__detector_cutover_diff'")
    );
    let mut stmt = conn
        .prepare("SELECT kind, COUNT(*) FROM section_history GROUP BY kind ORDER BY kind")
        .unwrap();
    let kinds: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}={}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    println!("[{label}] history {}", kinds.join(" "));
}

fn main() {
    let _ = env_logger::builder().try_init();
    let Ok(src) = std::env::var("UPGRADE_REPLAY_DB") else {
        eprintln!("set UPGRADE_REPLAY_DB, UPGRADE_REPLAY_ELEVATION_DB and UPGRADE_REPLAY_OUT");
        std::process::exit(2);
    };
    let elevation_db = std::env::var("UPGRADE_REPLAY_ELEVATION_DB").expect("elevation db");
    let variant = std::env::var("UPGRADE_REPLAY_VARIANT").unwrap_or_else(|_| "elevated".into());
    let out = PathBuf::from(std::env::var("UPGRADE_REPLAY_OUT").expect("out dir")).join(&variant);
    let work = out.join("work");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    let live = work.join("routes.db");
    std::fs::copy(&src, &live).unwrap();
    let mut perms = std::fs::metadata(&live).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&live, perms).unwrap();

    {
        let mut engine = PersistentEngine::new(live.to_str().unwrap()).expect("open");
        engine.load().expect("load");
    }
    assert!(
        persistent_engine_init(live.to_str().unwrap().to_string()),
        "engine init"
    );
    println!("[{variant}] init {:?}", last_init_outcome());

    // Attach the named activities against the flat-era catalogue, as the
    // first sync's first-use ingest does for the newest activities, before the
    // time streams and the elevation land. `*` attaches
    // each activity in turn and prints every one whose junction rows change.
    if let Ok(list) = std::env::var("UPGRADE_REPLAY_ATTACH") {
        let conn = Connection::open(&live).unwrap();
        let rows_of = |id: &str| -> Vec<String> {
            let mut stmt = conn
                .prepare(
                    "SELECT section_id || ' ' || direction || ' ' || start_index || '..' || end_index
                     FROM section_activities WHERE activity_id = ? ORDER BY 1",
                )
                .unwrap();
            stmt.query_map([id], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        let ids: Vec<String> = if list == "*" {
            veloqrs::persistence::with_persistent_engine(|e| e.get_activity_ids()).unwrap()
        } else {
            list.split(',').map(str::to_string).collect()
        };
        for id in ids {
            let before = rows_of(&id);
            veloqrs::persistence::with_persistent_engine(|e| e.attach_stored_activity(&id));
            let after = rows_of(&id);
            if before != after {
                println!("[{variant}] attach {id}: {before:?} -> {after:?}");
            }
        }
    }
    if std::env::var("UPGRADE_REPLAY_TIMES").is_ok() {
        let (ids, flat, offsets) = moved_time_streams(&src, &elevation_db);
        let stored = veloqrs::persistence::with_persistent_engine(|engine| {
            engine.set_time_streams_flat(&ids, &flat, &offsets);
            ids.len()
        })
        .expect("engine");
        println!("[{variant}] time streams replaced {stored}");
    }

    if variant != "flat" {
        let series = elevations(&elevation_db, variant == "quantised");
        let (spliced, refused, states) = veloqrs::persistence::with_persistent_engine(|engine| {
            let ids = engine.get_activity_ids();
            let (mut spliced, mut refused) = (0, 0);
            let mut states = Vec::new();
            for id in &ids {
                let Some((elevation, state)) = series.get(id) else {
                    continue;
                };
                if *state != 1 {
                    states.push((id.clone(), *state));
                    continue;
                }
                match engine.splice_track_elevation(
                    id,
                    elevation,
                    veloqrs::persistence::ElevationSeries::Corrected,
                ) {
                    Ok(true) => spliced += 1,
                    _ => refused += 1,
                }
            }
            engine.record_elevation_state(&states).unwrap();
            (spliced, refused, states.len())
        })
        .expect("engine");
        println!("[{variant}] spliced {spliced}, refused {refused}, other states {states}");
    }
    snapshot(&live, &out.join("before_cutover.db"));

    let outcome = veloqrs::persistence::cutover::run_cutover();
    println!(
        "[{variant}] cutover {}",
        format!("{outcome:?}").chars().take(200).collect::<String>()
    );
    snapshot(&live, &out.join("cutover.db"));
    report(&variant, &out.join("cutover.db"));
}
