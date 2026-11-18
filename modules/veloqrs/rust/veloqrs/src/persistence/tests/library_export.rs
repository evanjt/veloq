//! Scenario: the athlete exports the whole library as one plain zip: the
//! record, the library tables and every ride's packed bytes.
//!
//! Expected behaviour: the index lists every ride with what it carries, a ride
//! with a kept original carries it byte for byte, nothing the library keeps
//! private or can recompute is in the file, a start date keeps only the rides
//! from then on, and a second write names the same entries.

use std::collections::BTreeSet;
use std::io::Read;

use rusqlite::{Connection, params};

use crate::persistence::PersistentEngine;
use crate::persistence::export::BulkExportProgress;
use crate::persistence::library_export::{LibraryExportOptions, write_library_export};
use crate::persistence::originals::keep_original;
use crate::persistence::tables::{TableClass, declared_tables};

const SYNCED: &str = "i-1001";
const IMPORTED: &str = "file-1";
const SYNCED_START: i64 = 1_699_950_000;
const IMPORTED_START: i64 = 1_700_050_000;
const CERTIFICATE: &[u8] = b"CERTIFICATE-SENTINEL-5f3a9c0e1b";

fn fit_file() -> Vec<u8> {
    (0..4000u32).map(|i| (i % 251) as u8).collect()
}

fn seed_ride(db: &Connection, key: &str, intervals_id: Option<&str>, start: i64) {
    db.execute(
        "INSERT INTO activities
            (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng,
             created_at, start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?2, 'Ride', 46.2, 46.3, 7.3, 7.4, ?3, ?3, 'Lake loop', 42100.5, 5400)",
        params![key, intervals_id, start],
    )
    .unwrap();
    db.execute(
        "INSERT INTO activity_bodies (activity_id, date, raw, intervals_id)
         VALUES (?1, ?2, '{\"type\":\"Ride\"}', ?3)",
        params![key, start, intervals_id],
    )
    .unwrap();
}

fn seed_detail(db: &Connection, key: &str) {
    let points: Vec<tracematch::GpsPoint> = (0..30)
        .map(|i| tracematch::GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
        .collect();
    db.execute(
        "INSERT INTO gps_tracks
            (activity_id, track_data, point_count, elevation_source,
             elevation_settled_version, elevation_state, elevation_attempts)
         VALUES (?1, ?2, 30, 2, 'v7', 1, 0)",
        params![key, crate::persistence::codec::encode_polyline(&points)],
    )
    .unwrap();
    let samples: Vec<Option<f64>> = (0..30).map(|i| Some(100.0 + f64::from(i))).collect();
    db.execute(
        "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
         VALUES (?1, 'heartrate', ?2, 30)",
        params![key, crate::persistence::codec::encode_series(&samples, 1.0)],
    )
    .unwrap();
    db.execute(
        "INSERT INTO interval_bodies (activity_id, raw) VALUES (?1, '[{\"type\":\"WORK\"}]')",
        params![key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO activity_census
            (athlete_id, intervals_id, start_date_local, created, icu_sync_date,
             fetched_sync_date, has_latlng, has_series)
         VALUES ('i-athlete', ?1, '2023-11-14T09:00:00', '2023-11-14T10:00:00',
                 '2023-11-14T11:00:00', '2023-11-14T11:00:00', 1, 1)",
        params![key],
    )
    .unwrap();
}

/// A library with a synced ride holding every kind of row, an imported ride
/// with its original, a named pinned section, two wellness days and a linked
/// device with its certificate.
fn seeded() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_ride(&engine.db, SYNCED, Some(SYNCED), SYNCED_START);
    seed_detail(&engine.db, SYNCED);
    seed_ride(&engine.db, IMPORTED, None, IMPORTED_START);
    keep_original(&engine.db, IMPORTED, "import", "fit", &fit_file(), 1).unwrap();

    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('sec-1', 'custom', NULL, 'Ride', '[]', 400.0, 1, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
    engine
        .set_section_name("sec-1", Some("Hill repeat"))
        .unwrap();
    engine
        .db
        .execute(
            "INSERT OR IGNORE INTO section_pins (section_id, version) VALUES ('sec-1', 1)",
            [],
        )
        .unwrap();

    for day in ["2026-03-01", "2026-03-02"] {
        engine
            .db
            .execute("INSERT INTO wellness (date, ctl) VALUES (?1, 42.0)", [day])
            .unwrap();
    }

    crate::persistence::linked_devices::add(&engine.db, "Laptop", "ab:cd:ef", None, 1).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO remote_identity (id, certificate) VALUES (1, ?1)",
            [CERTIFICATE],
        )
        .unwrap();
    engine
}

fn export(
    engine: &PersistentEngine,
    dir: &std::path::Path,
    name: &str,
    options: LibraryExportOptions,
) -> std::path::PathBuf {
    let path = dir.join(name);
    write_library_export(
        &engine.db,
        path.to_str().unwrap(),
        options,
        &BulkExportProgress::default(),
    )
    .unwrap();
    path
}

fn all() -> LibraryExportOptions {
    LibraryExportOptions {
        since: None,
        originals: true,
    }
}

fn names(path: &std::path::Path) -> Vec<String> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|i| archive.by_index_raw(i).unwrap().name().unwrap().to_string())
        .collect()
}

fn read(path: &std::path::Path, entry: &str) -> Vec<u8> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut out = Vec::new();
    archive
        .by_name(entry)
        .unwrap_or_else(|e| panic!("{entry}: {e}"))
        .read_to_end(&mut out)
        .unwrap();
    out
}

fn index(path: &std::path::Path) -> serde_json::Value {
    serde_json::from_slice(&read(path, "library.json")).unwrap()
}

fn rides_in(index: &serde_json::Value) -> Vec<(String, Vec<String>)> {
    index["rides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["key"].as_str().unwrap().to_string(),
                r["kinds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|k| k.as_str().unwrap().to_string())
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn the_index_lists_every_ride_and_each_entry_is_there() {
    let dir = tempfile::tempdir().unwrap();
    let path = export(&seeded(), dir.path(), "all.zip", all());

    let index = index(&path);
    assert_eq!(index["format"], 1);
    let mut rides = rides_in(&index);
    rides.sort();
    assert_eq!(
        rides,
        vec![
            (
                IMPORTED.to_string(),
                vec!["original.fit".into(), "streams.bin".into()]
            ),
            (SYNCED.to_string(), vec!["streams.bin".into()]),
        ]
    );
    let entries = names(&path);
    assert_eq!(entries[0], "library.json", "the index comes first");
    for entry in [
        "record.json",
        "tables/wellness.jsonl",
        &format!("rides/{SYNCED}/streams.bin"),
        &format!("rides/{IMPORTED}/streams.bin"),
        &format!("rides/{IMPORTED}/original.fit"),
    ] {
        assert!(entries.contains(&entry.to_string()), "missing {entry}");
    }
    assert!(!entries.contains(&format!("rides/{SYNCED}/original.fit")));
}

#[test]
fn the_original_is_the_file_that_was_kept() {
    let dir = tempfile::tempdir().unwrap();
    let path = export(&seeded(), dir.path(), "all.zip", all());

    assert_eq!(
        read(&path, &format!("rides/{IMPORTED}/original.fit")),
        fit_file()
    );
}

#[test]
fn the_original_is_copied_from_the_stored_body_not_compressed_again() {
    let engine = seeded();
    let stored: Vec<u8> = engine
        .db
        .query_row(
            "SELECT body FROM ride_originals WHERE activity_id = ?1",
            [IMPORTED],
            |r| r.get(0),
        )
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = export(&engine, dir.path(), "all.zip", all());

    let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
    let entry = archive
        .by_name(&format!("rides/{IMPORTED}/original.fit"))
        .unwrap();
    assert_eq!(entry.compression(), zip::CompressionMethod::Deflated);
    assert_eq!(entry.compressed_size(), stored.len() as u64);
}

#[test]
fn the_record_carries_the_pin_and_the_table_file_its_two_rows() {
    let dir = tempfile::tempdir().unwrap();
    let path = export(&seeded(), dir.path(), "all.zip", all());

    let record: serde_json::Value = serde_json::from_slice(&read(&path, "record.json")).unwrap();
    let pinned = record["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["table"] == "section_pins" && row["values"]["section_id"] == "sec-1");
    assert!(pinned, "the pin is in the record");
    let named = record["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["values"].to_string().contains("Hill repeat"));
    assert!(named, "the section's name is in the record");
    let wellness = read(&path, "tables/wellness.jsonl");
    assert_eq!(String::from_utf8(wellness).unwrap().lines().count(), 2);
}

#[test]
fn the_private_and_recomputable_stay_out_and_the_certificate_is_nowhere() {
    let dir = tempfile::tempdir().unwrap();
    let path = export(&seeded(), dir.path(), "all.zip", all());

    let left_out: BTreeSet<&str> = declared_tables()
        .iter()
        .filter(|t| {
            matches!(
                t.class,
                TableClass::Derived | TableClass::Identity | TableClass::Meta | TableClass::Device
            ) && t.name != "ride_originals"
        })
        .map(|t| t.name)
        .collect();
    for entry in names(&path) {
        if let Some(table) = entry
            .strip_prefix("tables/")
            .and_then(|e| e.split('.').next())
        {
            assert!(
                !left_out.contains(table),
                "{entry} is a table the export leaves out"
            );
        }
    }
    let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
    for index in 0..archive.len() {
        let mut bytes = Vec::new();
        archive
            .by_index(index)
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert!(
            !bytes.windows(CERTIFICATE.len()).any(|w| w == CERTIFICATE),
            "the certificate is in entry {index}"
        );
    }
}

#[test]
fn a_start_date_keeps_the_rides_from_then_on_and_the_record_whole() {
    let dir = tempfile::tempdir().unwrap();
    let options = LibraryExportOptions {
        since: Some(1_700_000_000.0),
        originals: true,
    };
    let path = export(&seeded(), dir.path(), "since.zip", options);

    let rides = rides_in(&index(&path));
    assert_eq!(rides.len(), 1);
    assert_eq!(rides[0].0, IMPORTED);
    let entries = names(&path);
    assert!(
        !entries
            .iter()
            .any(|e| e.starts_with(&format!("rides/{SYNCED}/")))
    );
    assert!(entries.contains(&format!("rides/{IMPORTED}/streams.bin")));
    assert!(entries.contains(&"tables/wellness.jsonl".to_string()));
    assert!(entries.contains(&"record.json".to_string()));
}

#[test]
fn a_second_write_names_the_same_entries() {
    let dir = tempfile::tempdir().unwrap();
    let engine = seeded();
    let first = export(&engine, dir.path(), "a.zip", all());
    let second = export(&engine, dir.path(), "b.zip", all());

    assert_eq!(names(&first), names(&second));
}

#[test]
fn without_originals_no_original_is_written_or_listed() {
    let dir = tempfile::tempdir().unwrap();
    let options = LibraryExportOptions {
        since: None,
        originals: false,
    };
    let path = export(&seeded(), dir.path(), "light.zip", options);

    assert!(!names(&path).iter().any(|e| e.ends_with("original.fit")));
    let mut rides = rides_in(&index(&path));
    rides.sort();
    assert!(rides.iter().all(|(_, kinds)| kinds == &["streams.bin"]));
}

#[test]
fn an_empty_library_writes_the_index_and_the_record_alone() {
    let dir = tempfile::tempdir().unwrap();
    let engine = PersistentEngine::in_memory().unwrap();
    let path = export(&engine, dir.path(), "empty.zip", all());

    assert_eq!(names(&path), vec!["library.json", "record.json"]);
    assert!(rides_in(&index(&path)).is_empty());
}

#[test]
fn a_stop_asked_for_leaves_no_file() {
    let dir = tempfile::tempdir().unwrap();
    let engine = seeded();
    let path = dir.path().join("stopped.zip");
    let progress = BulkExportProgress::default();
    progress.cancel();

    let outcome = write_library_export(&engine.db, path.to_str().unwrap(), all(), &progress);

    assert_eq!(
        outcome.unwrap_err(),
        crate::persistence::export::JOB_CANCELLED
    );
    assert!(!path.exists());
}

/// Scenario: the volume fills while the writer is mid-library.
/// Expected behaviour: the guard's reason is the failure and no file stays.
#[test]
fn a_guard_that_stops_the_run_fails_it_with_its_reason_and_leaves_no_file() {
    let dir = tempfile::tempdir().unwrap();
    let engine = seeded();
    let path = dir.path().join("full.zip");
    let progress = BulkExportProgress::default();
    progress.set_guard(Box::new(|| Some("no room left".to_string())));

    let outcome = write_library_export(&engine.db, path.to_str().unwrap(), all(), &progress);

    assert_eq!(outcome.unwrap_err(), "no room left");
    assert!(!path.exists());
}

/// One row in `table`, with a placeholder in each column that must hold one.
fn placeholder_row(db: &Connection, table: &str) {
    let columns: Vec<(String, String)> = db
        .prepare(&format!(
            "SELECT name, type FROM pragma_table_info('{table}')
             WHERE (\"notnull\" = 1 AND dflt_value IS NULL) OR (pk > 0 AND type = 'TEXT')"
        ))
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let names: Vec<&str> = columns.iter().map(|(name, _)| name.as_str()).collect();
    let values: Vec<String> = columns
        .iter()
        .map(|(_, kind)| match kind.as_str() {
            "INTEGER" => "1".to_string(),
            "REAL" => "1.0".to_string(),
            "BLOB" => "X'00'".to_string(),
            _ => "'placeholder'".to_string(),
        })
        .collect();
    let sql = if names.is_empty() {
        format!("INSERT INTO {table} DEFAULT VALUES")
    } else {
        format!(
            "INSERT OR IGNORE INTO {table} ({}) VALUES ({})",
            names.join(", "),
            values.join(", ")
        )
    };
    let _ = db.execute(&sql, []);
}

fn has_column(db: &Connection, table: &str, column: &str) -> bool {
    db.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        > 0
}

/// Scenario: a table is added to the schema and declared in `tables.rs`.
/// Expected behaviour: the export carries it as a table file when it is a
/// library-wide mirror, and names no file for any other class.
#[test]
fn the_tables_written_are_the_ones_the_declaration_calls_library_wide_mirror() {
    let dir = tempfile::tempdir().unwrap();
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .db
        .execute_batch("PRAGMA foreign_keys = OFF")
        .unwrap();
    // The record's own tables carry their rows in `record.json`, which reads
    // them as the app wrote them and refuses a placeholder.
    for table in declared_tables()
        .iter()
        .filter(|t| t.class != TableClass::Record && t.record_part.is_none())
    {
        placeholder_row(&engine.db, table.name);
    }
    let path = export(&engine, dir.path(), "tables.zip", all());

    let written: BTreeSet<String> = names(&path)
        .iter()
        .filter_map(|e| e.strip_prefix("tables/"))
        .filter_map(|e| e.strip_suffix(".jsonl"))
        .map(str::to_string)
        .collect();
    let declared: BTreeSet<String> = declared_tables()
        .iter()
        .filter(|t| t.class == TableClass::Mirror)
        .filter(|t| t.name != "activities" && !has_column(&engine.db, t.name, "activity_id"))
        .map(|t| t.name.to_string())
        .collect();
    assert!(!declared.is_empty());
    let seeded_declared: BTreeSet<String> = declared
        .into_iter()
        .filter(|t| {
            engine
                .db
                .query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap()
                > 0
        })
        .collect();
    assert_eq!(written, seeded_declared);
}

/// One row in each ride-keyed mirror table the ride's packed rows do not
/// carry, so a table added later with no export path is caught by the next test.
fn seed_ride_tables(db: &Connection, key: &str) {
    db.execute(
        "INSERT INTO stream_bodies (activity_id, types, raw) VALUES (?1, 'heartrate,time', '{\"a\":1}')",
        [key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO swim_lengths (activity_id, length_index, elapsed_secs, total_strokes)
         VALUES (?1, 0, 31.5, 18), (?1, 1, 33.0, 19)",
        [key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO pool_swims (activity_id, pool_length_m) VALUES (?1, 25.0)",
        [key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO exercise_sets (activity_id, set_order, exercise_category, set_type, repetitions, weight_kg)
         VALUES (?1, 0, 5, 1, 8, 60.0)",
        [key],
    )
    .unwrap();
}

fn lines(path: &std::path::Path, entry: &str) -> Vec<serde_json::Value> {
    read(path, entry)
        .split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice(l).unwrap())
        .collect()
}

/// Scenario: a swim, a strength session and a cached stream pull belong to a ride.
/// Expected behaviour: each ride-keyed mirror table the packed rows do not
/// carry is a table file under the ride, and the index names it.
#[test]
fn a_ride_keyed_mirror_table_the_pack_does_not_carry_is_written_under_the_ride() {
    let dir = tempfile::tempdir().unwrap();
    let engine = seeded();
    seed_ride_tables(&engine.db, SYNCED);
    let path = export(&engine, dir.path(), "all.zip", all());

    let lengths = lines(&path, &format!("rides/{SYNCED}/tables/swim_lengths.jsonl"));
    assert_eq!(lengths.len(), 2);
    assert_eq!(lengths[1]["total_strokes"], 19);
    let pool = lines(&path, &format!("rides/{SYNCED}/tables/pool_swims.jsonl"));
    assert_eq!(pool[0]["pool_length_m"], 25.0);
    let sets = lines(&path, &format!("rides/{SYNCED}/tables/exercise_sets.jsonl"));
    assert_eq!(sets[0]["weight_kg"], 60.0);
    let bodies = lines(&path, &format!("rides/{SYNCED}/tables/stream_bodies.jsonl"));
    assert_eq!(bodies[0]["types"], "heartrate,time");

    let (_, kinds) = rides_in(&index(&path))
        .into_iter()
        .find(|(k, _)| k == SYNCED)
        .unwrap();
    assert!(kinds.contains(&"tables/swim_lengths.jsonl".to_string()));
    let other = names(&path)
        .into_iter()
        .any(|n| n.starts_with(&format!("rides/{IMPORTED}/tables/")));
    assert!(!other, "a ride with no such rows gets no table files");
}

/// Scenario: a table keyed by `activity_id` is declared mirror.
/// Expected behaviour: it is packed in the ride's rows or written as a table
/// file; the set comes from the declaration with no list of exceptions.
#[test]
fn every_ride_keyed_mirror_table_is_packed_or_written() {
    let engine = PersistentEngine::in_memory().unwrap();
    let ride_keyed: BTreeSet<&str> = declared_tables()
        .iter()
        .filter(|t| t.class == TableClass::Mirror && t.name != "activities")
        .filter(|t| has_column(&engine.db, t.name, "activity_id"))
        .map(|t| t.name)
        .collect();
    let packed: BTreeSet<&str> = crate::persistence::seal::ride_bytes::PACKED_RIDE_TABLES
        .iter()
        .copied()
        .collect();
    let written: BTreeSet<&str> = crate::persistence::library_export::ride_tables(&engine.db)
        .unwrap()
        .into_iter()
        .collect();
    assert!(
        packed.is_subset(&ride_keyed),
        "{packed:?} names a table that is not ride-keyed mirror"
    );
    assert!(packed.is_disjoint(&written));
    let covered: BTreeSet<&str> = packed.union(&written).copied().collect();
    assert_eq!(covered, ride_keyed);
}

/// Scenario: a ride read from a file carries its device's serial number.
/// Expected behaviour: the plain export, which leaves identity tables out,
/// carries neither the serial nor the file time.
#[test]
fn the_device_serial_is_not_in_the_plain_export() {
    let dir = tempfile::tempdir().unwrap();
    let engine = seeded();
    engine
        .db
        .execute(
            "INSERT OR REPLACE INTO ride_identity (activity_id, device_serial, created_unix, start_local)
             VALUES (?1, 3987654321, 1700000123, 1700050000)",
            [IMPORTED],
        )
        .unwrap();
    let path = export(&engine, dir.path(), "all.zip", all());

    let rows = crate::persistence::seal::ride_bytes::unpack_rows(&read(
        &path,
        &format!("rides/{IMPORTED}/streams.bin"),
    ))
    .unwrap();
    assert_eq!(rows.identity, None);
}
