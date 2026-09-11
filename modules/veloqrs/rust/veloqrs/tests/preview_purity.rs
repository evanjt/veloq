//! A preview changes nothing the athlete has saved.
//!
//! The promise, in Evan's words answering `Q236`: "It's about the sections and
//! activities, if you need some caching or storage to assist the preview screen
//! you can write its own stuff, it just mustn't change the user's saved sections
//! or anything until they accept the new one."
//!
//! So the check is every table's rows before and against after, with the
//! preview's own bookkeeping named and excused, plus the section config and the
//! detection slot.
//!
//! **The old form was a SHA-256 of the database file**, beside a length check
//! on the `-wal`. Both are proxies, and both are stricter than the promise in
//! the direction that matters least: a `job_attempts` row the preview claimed
//! and released fails them, and a written section fails them in exactly the same
//! way, so they cannot tell the two apart. SQLite does not hand a page back byte
//! for byte either, so the hash can fail on a write that changed no value at
//! all. Do not restore them.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_purity -p veloqrs`

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::objects::start::FfiStartOutcome;
use veloqrs::objects::start::FfiStartOutcome::Started;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{detection_suspended, with_persistent_engine};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// A ~2.2 km line: 200 points ~11 m apart, laterally jittered per activity
/// within GPS drift.
fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_engine() {
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            // A fortnight apart, clear of the one-week occasion span, so
            // every activity counts as its own occasion.
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .expect("engine installed");
}

fn detect_and_apply() {
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed_ids) = main.expect("real detect result");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply sections");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save processed ids");
    })
    .expect("engine installed");
}

/// The tables a preview is allowed to write, because they are its own
/// bookkeeping rather than anything the athlete has saved. `Q236` allows this
/// in as many words; nothing else on this list gets in without going back to
/// that question.
const PREVIEW_BOOKKEEPING: &[&str] = &["job_attempts"];

/// Every row of every table, as text, keyed by table.
///
/// Rows are sorted rather than read in storage order: a table that holds the
/// same values is unchanged whatever order SQLite hands them back in, and the
/// question here is about values.
fn table_rows(path: &Path, skip: &[&str]) -> BTreeMap<String, Vec<String>> {
    let conn = Connection::open(path).expect("second connection");
    let tables: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master
                  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                  ORDER BY name",
            )
            .expect("prepare table list");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("query table list")
            .collect::<Result<Vec<_>, _>>()
            .expect("table names")
    };

    let mut snapshot = BTreeMap::new();
    for table in tables {
        if skip.contains(&table.as_str()) {
            continue;
        }
        let mut stmt = conn
            .prepare(&format!("SELECT * FROM \"{table}\""))
            .expect("prepare table read");
        let columns = stmt.column_count();
        let mut rows: Vec<String> = stmt
            .query_map([], |row| {
                let mut cells = Vec::with_capacity(columns);
                for i in 0..columns {
                    cells.push(match row.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => "NULL".to_string(),
                        rusqlite::types::ValueRef::Integer(v) => format!("i:{v}"),
                        rusqlite::types::ValueRef::Real(v) => format!("f:{v}"),
                        rusqlite::types::ValueRef::Text(v) => {
                            format!("t:{}", String::from_utf8_lossy(v))
                        }
                        rusqlite::types::ValueRef::Blob(v) => format!("b:{}", v.len()),
                    });
                }
                Ok(cells.join("\u{1f}"))
            })
            .expect("query table")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows");
        rows.sort();
        snapshot.insert(table, rows);
    }
    snapshot
}

/// The tables whose rows differ between two snapshots, named so a failure says
/// what moved rather than that something did.
fn changed_tables(
    before: &BTreeMap<String, Vec<String>>,
    after: &BTreeMap<String, Vec<String>>,
) -> Vec<String> {
    let mut changed: Vec<String> = before
        .keys()
        .chain(after.keys())
        .filter(|t| before.get(*t) != after.get(*t))
        .cloned()
        .collect();
    changed.sort();
    changed.dedup();
    changed
}

/// The catalogue tables as a second connection reads them.
fn catalogue_snapshot(path: &std::path::Path) -> Vec<(String, String, Option<String>, i64)> {
    let conn = Connection::open(path).expect("second connection");
    let mut stmt = conn
        .prepare(
            "SELECT id, sport_type, polyline_json, visit_count
             FROM sections ORDER BY id",
        )
        .expect("prepare");
    stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    })
    .expect("query")
    .collect::<Result<Vec<_>, _>>()
    .expect("rows")
}

/// A poller that cancels and walks away must not occupy the slot forever:
/// the next start reaps the terminal run instead of refusing.
#[test]
fn an_abandoned_preview_does_not_wedge_the_slot() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    seed_engine();

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let ffi_cfg = FfiSectionConfig::from(&cfg);

    let preview = SectionPreview::new();
    assert_eq!(
        preview.start(46.01, 7.0, ffi_cfg.clone()).expect("start"),
        Started
    );
    preview.cancel().expect("cancel");
    // No further polls: the poller is gone, exactly as an unmounted screen.

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if preview.start(46.01, 7.0, ffi_cfg.clone()).expect("restart") == Started {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the abandoned run wedged the slot"
        );
        std::thread::sleep(Duration::from_millis(50));
    }

    // Drive the superseding run to its end so the slot is clean.
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match preview.poll().expect("poll").as_str() {
            "complete" => {
                preview.take_result().expect("take");
                break;
            }
            "cancelled" | "error" | "idle" => break,
            _ => {
                assert!(Instant::now() < deadline, "second preview never ended");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    assert_eq!(preview.poll().expect("final poll"), "idle");
}

/// Scenario: the athlete opens the preview screen, runs a detect over a
/// candidate config and closes it without keeping the result.
///
/// Expected behaviour: nothing they have saved has moved. Every table reads as
/// it did, the catalogue tables included, the section config is the one they
/// set, and the detection slot is free for a real detect. The preview's own
/// bookkeeping is excused by name.
#[test]
fn a_full_preview_run_leaves_everything_the_athlete_saved_alone() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed_engine();
    detect_and_apply();
    let live_count =
        with_persistent_engine(|engine| engine.get_sections().len()).expect("engine installed");
    assert!(live_count > 0, "the seed pool produced no live catalogue");

    let rows_before = table_rows(&path, PREVIEW_BOOKKEEPING);
    assert!(
        rows_before.contains_key("sections") && !rows_before["sections"].is_empty(),
        "the snapshot must reach the catalogue, or it is proving nothing"
    );
    let catalogue_before = catalogue_snapshot(&path);

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let config_before = format!("{cfg:?}");
    let mut ffi_cfg = FfiSectionConfig::from(&cfg);
    ffi_cfg.min_activities = 2;

    let preview = SectionPreview::new();
    assert_eq!(
        preview
            .start(46.01, 7.0, ffi_cfg.clone())
            .expect("start call"),
        Started,
        "a preview over the seeded area must start"
    );
    assert_eq!(
        preview.start(46.01, 7.0, ffi_cfg).expect("second start"),
        FfiStartOutcome::Busy,
        "the slot is occupied, so a second start is busy rather than refused"
    );

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = preview.poll().expect("poll");
        if status == "complete" {
            break;
        }
        assert!(
            status == "running",
            "preview ended in '{status}' instead of completing"
        );
        assert!(Instant::now() < deadline, "preview never completed");
        std::thread::sleep(Duration::from_millis(50));
    }

    let json = preview
        .take_result()
        .expect("take call")
        .expect("a completed preview yields a payload");
    let payload: serde_json::Value = serde_json::from_str(&json).expect("payload parses");
    assert_eq!(
        payload["pool"]["activities"].as_u64(),
        Some(4),
        "the whole component's pool feeds the preview"
    );
    assert!(
        !payload["sections"].as_array().expect("sections").is_empty(),
        "the payload names no sections over a pool the real detect cut one from"
    );
    assert!(
        preview.take_result().expect("second take").is_none(),
        "the payload leaves exactly once"
    );
    assert_eq!(preview.poll().expect("poll after take"), "idle");

    assert_eq!(
        changed_tables(&rows_before, &table_rows(&path, PREVIEW_BOOKKEEPING)),
        Vec::<String>::new(),
        "a preview run wrote to a table that is not its own bookkeeping"
    );
    assert_eq!(
        catalogue_snapshot(&path),
        catalogue_before,
        "a preview run changed the catalogue tables"
    );
    assert_eq!(
        format!(
            "{:?}",
            with_persistent_engine(|engine| engine.get_section_config()).expect("config")
        ),
        config_before,
        "a preview run changed the section config the athlete set"
    );

    // The suspension guard released with the worker, so a real detect runs.
    assert!(
        !detection_suspended(),
        "the preview left detection suspended"
    );
    let real = with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        handle.recv().is_some()
    })
    .expect("engine installed");
    assert!(real, "a real detect after the preview refused to run");
}

/// Scenario: the check above replaced a hash of the whole file. A weaker check
/// that passes because it sees nothing is worse than the proxy it replaced.
///
/// Expected behaviour: a write the athlete would see is named, whichever table
/// it lands in, and a row in the preview's own bookkeeping is not. Each write
/// here is made deliberately, so the test fails if the comparison ever stops
/// reaching that table.
#[test]
fn the_check_names_a_write_the_athlete_would_see_and_excuses_the_previews_own() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed_engine();
    detect_and_apply();

    let before = table_rows(&path, PREVIEW_BOOKKEEPING);
    let conn = Connection::open(&path).expect("second connection");
    let execute = |sql: &str| {
        conn.execute(sql, [])
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    };

    execute("UPDATE sections SET visit_count = visit_count + 1");
    assert_eq!(
        changed_tables(&before, &table_rows(&path, PREVIEW_BOOKKEEPING)),
        vec!["sections".to_string()],
        "a section that moved must be named"
    );

    execute("UPDATE section_activities SET excluded = 1 - excluded");
    execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('c67_probe', '1')");
    let mut named = changed_tables(&before, &table_rows(&path, PREVIEW_BOOKKEEPING));
    named.sort();
    assert_eq!(
        named,
        vec![
            "section_activities".to_string(),
            "sections".to_string(),
            "settings".to_string()
        ],
        "a traversal and a setting must be named too"
    );

    let after_saved = table_rows(&path, PREVIEW_BOOKKEEPING);
    execute(
        "INSERT OR REPLACE INTO job_attempts (key, attempts, last_attempt_at, lease_gen)
         VALUES ('c67_probe', 1, 1, 1)",
    );
    assert_eq!(
        changed_tables(&after_saved, &table_rows(&path, PREVIEW_BOOKKEEPING)),
        Vec::<String>::new(),
        "the preview's own bookkeeping is what Q236 allows, so it must not be named"
    );
}
