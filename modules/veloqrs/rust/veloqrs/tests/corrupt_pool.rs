//! A stored track that will not decode is never absorbed as an empty one.
//!
//! Detection records the pool it was cut over and abandons the run only when
//! enough of the library is unreadable to rule out isolated rot, the heatmap
//! redraws the tiles an unreadable activity reaches without paying a full pass
//! per launch, and both exports name every omission.
//!
//! Run: `cargo test --test corrupt_pool -p veloqrs`

use rusqlite::{Connection, OptionalExtension, params};
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE;

/// Not framed postcard, not unframed postcard, not an rmp array header: no
/// container claims it, so every decode path must report it as unreadable.
const UNDECODABLE: &[u8] = &[0x7f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];

const POOL_INTEGRITY_KEY: &str = "detection_pool_integrity";
const ABANDONED_POOL_KEY: &str = "detection_abandoned_pool";

/// `set_heatmap_tiles_path` parks its own run in a process-wide handle, so the
/// tile tests take turns rather than draining each other's.
static TILE_TEST: Mutex<()> = Mutex::new(());

fn count_tiles(base: &std::path::Path) -> usize {
    let Ok(entries) = std::fs::read_dir(base) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_tiles(&path)
            } else if path.extension().is_some_and(|ext| ext == "png") {
                1
            } else {
                0
            }
        })
        .sum()
}

fn track(seed: usize, n: usize) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| GpsPoint {
            latitude: 46.2 + i as f64 * 0.000_09 + seed as f64 * 0.000_001,
            longitude: 7.36 - i as f64 * 0.000_113 + seed as f64 * 0.000_001,
            elevation: None,
        })
        .collect()
}

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    dir: TempDir,
}

fn setup(activities: usize) -> Setup {
    let dir = TempDir::new().expect("temp dir");
    let path: PathBuf = dir.path().join("test.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let batch: Vec<(String, Vec<GpsPoint>, String)> = (0..activities)
        .map(|i| (format!("a{i}"), track(i, 80), "Ride".to_string()))
        .collect();
    engine.add_activities_batch(batch).expect("add activities");
    let raw = Connection::open(&path).expect("raw open");
    Setup { engine, raw, dir }
}

impl Setup {
    fn blob(&self, id: &str) -> Vec<u8> {
        self.raw
            .query_row(
                "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
                params![id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .expect("stored blob")
    }

    fn set_blob(&self, id: &str, blob: &[u8]) {
        let n = self
            .raw
            .execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = ?",
                params![blob, id],
            )
            .expect("blob update");
        assert_eq!(n, 1, "expected one gps_tracks row for {id}");
    }

    fn corrupt(&self, id: &str) {
        self.set_blob(id, UNDECODABLE);
    }

    fn record(&self, key: &str) -> Option<serde_json::Value> {
        self.raw
            .query_row(
                "SELECT value FROM schema_info WHERE key = ?",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .expect("schema_info read")
            .map(|v| serde_json::from_str(&v).expect("record json"))
    }

    fn integrity_record(&self) -> Option<serde_json::Value> {
        self.record(POOL_INTEGRITY_KEY)
    }

    fn forget(&self, key: &str) {
        self.raw
            .execute("DELETE FROM schema_info WHERE key = ?", params![key])
            .expect("schema_info delete");
    }

    /// Configure the tiles directory and wait out the run `set_heatmap_tiles_path`
    /// starts by itself, so a test's own run is the only one in flight.
    fn tiles_dir(&mut self) -> PathBuf {
        let tiles_path = self.dir.path().join("tiles");
        std::fs::create_dir_all(&tiles_path).expect("tiles dir");
        self.engine
            .set_heatmap_tiles_path(tiles_path.to_string_lossy().to_string());
        let parked = TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(handle) = parked {
            handle.recv_blocking();
        }
        tiles_path
    }

    /// Run one tile pass to completion and report the tiles it drew.
    fn generate_tiles(&self) -> u32 {
        self.engine.mark_heatmap_dirty();
        let handle = self
            .engine
            .generate_tiles_background()
            .expect("tile handle")
            .recv_blocking();
        handle.expect("tile run result")
    }
}

// ------------------------------------------------------------ detection

/// Scenario: one unreadable track in a pool of twelve.
/// Expected behaviour: the detect still runs, and the reduced pool is a
/// durable record naming the activity, not an anonymous empty track.
#[test]
fn one_unreadable_track_is_named_in_the_pool_record() {
    let mut s = setup(12);
    s.corrupt("a3");

    let handle = s.engine.detect_sections_background();
    assert!(handle.recv().is_some(), "detect should still complete");

    let record = s
        .integrity_record()
        .expect("an incomplete pool must be recorded");
    assert_eq!(record["corrupt"], 1);
    assert_eq!(record["readable"], 11);
    assert_eq!(record["abandoned"], false);
    assert_eq!(record["activity_ids"][0], "a3");
    assert!(
        record["first_reason"]
            .as_str()
            .expect("reason")
            .contains("unrecognised container"),
        "the record must carry a diagnosable reason, got {}",
        record["first_reason"]
    );
}

/// Scenario: one unreadable track in a library of nine, which is 11% of the
/// pool and so past the fraction on its own.
/// Expected behaviour: detection runs. One bad row is isolated rot, and a
/// small library must not lose its catalogue to it.
#[test]
fn a_single_bad_row_on_a_small_library_still_detects() {
    let mut s = setup(9);
    s.corrupt("a3");

    let handle = s.engine.detect_sections_background();
    assert!(
        handle.recv().is_some(),
        "one bad row must not abandon detection"
    );
    assert_eq!(
        s.integrity_record().expect("record")["abandoned"],
        false,
        "a run that completed must not be recorded as abandoned"
    );
}

/// Scenario: the whole pool is unreadable, the shape a codec change takes.
/// Expected behaviour: the run is abandoned rather than cutting a catalogue
/// over a corpus smaller than the library. The worker sends nothing, so the
/// poll reports a dead worker and the stored catalogue stands.
#[test]
fn an_unreadable_pool_abandons_the_detect() {
    let mut s = setup(12);
    for i in 0..12 {
        s.corrupt(&format!("a{i}"));
    }

    let handle = s.engine.detect_sections_background();
    assert!(
        handle.recv().is_none(),
        "an unreadable pool must not yield a catalogue"
    );

    let record = s
        .integrity_record()
        .expect("an incomplete pool must be recorded");
    assert_eq!(record["corrupt"], 12);
    assert_eq!(record["readable"], 0);
    assert_eq!(record["abandoned"], true);
    assert!(
        s.record(ABANDONED_POOL_KEY).is_some(),
        "the abandoned pool must be named so the next sync can recognise it"
    );
}

/// Scenario: a sync repeats over a pool that was already decoded and rejected.
/// Expected behaviour: the second run gives up before loading anything, so an
/// unreadable library costs one full decode per window rather than one per
/// sync. The integrity record, written only by a run that got as far as
/// loading, stays absent.
#[test]
fn an_abandoned_pool_is_not_reloaded_until_it_changes() {
    let mut s = setup(12);
    for i in 0..12 {
        s.corrupt(&format!("a{i}"));
    }
    s.engine.detect_sections_background().recv();
    s.forget(POOL_INTEGRITY_KEY);

    assert!(
        s.engine.detect_sections_background().recv().is_none(),
        "the pool is still unreadable"
    );
    assert!(
        s.integrity_record().is_none(),
        "the second run must return before loading the pool again"
    );

    s.engine
        .add_activities_batch(vec![("a12".to_string(), track(12, 80), "Ride".to_string())])
        .expect("add activity");
    s.engine.detect_sections_background().recv();
    assert!(
        s.integrity_record().is_some(),
        "a changed pool must be loaded again rather than held off by the window"
    );
}

/// Scenario: a pool that was incomplete becomes readable again.
/// Expected behaviour: the record describes the live catalogue, so a clean
/// pool clears it rather than leaving a stale warning behind.
#[test]
fn a_clean_pool_clears_the_record() {
    let mut s = setup(4);
    s.raw
        .execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
            params![POOL_INTEGRITY_KEY, "{\"corrupt\":9}"],
        )
        .expect("seed record");

    let handle = s.engine.detect_sections_background();
    handle.recv();

    assert!(
        s.integrity_record().is_none(),
        "a clean pool must clear the record"
    );
}

// ------------------------------------------------------------ heatmap

/// Scenario: an activity's track will not decode while tiles are generated.
/// Expected behaviour: the pass completes and clears the marker, so a
/// permanently bad row does not cost a full tile pass at every launch. The
/// activity is named on disk instead, which is what buys the redraw.
#[test]
fn an_incomplete_tile_set_names_the_activity_and_clears_the_marker() {
    let _serialise = TILE_TEST.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = setup(4);
    s.corrupt("a1");

    let tiles_path = s.tiles_dir();
    s.generate_tiles();

    assert!(
        !tiles_path.join(".dirty").exists(),
        "a completed pass clears the marker whether or not a row was unreadable"
    );
    let recorded: Vec<String> = serde_json::from_str(
        &std::fs::read_to_string(tiles_path.join("corrupt-activities.json"))
            .expect("corrupt record present"),
    )
    .expect("corrupt record json");
    assert_eq!(recorded, vec!["a1".to_string()]);
}

/// Scenario: the tiles an unreadable activity belongs in were already drawn
/// without it, then the track is repaired.
/// Expected behaviour: those tiles are redrawn. Left to `tile_exists` they
/// would be served forever and the repaired ride would never reach the map.
#[test]
fn a_repaired_track_redraws_the_tiles_it_reaches() {
    let _serialise = TILE_TEST.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = setup(4);
    let original = s.blob("a1");
    s.corrupt("a1");

    let tiles_path = s.tiles_dir();
    assert!(
        tiles_path.join("corrupt-activities.json").exists(),
        "the first pass drew the library without a1 and must say so"
    );

    s.set_blob("a1", &original);
    assert!(
        s.generate_tiles() > 0,
        "the tiles a1 reaches must be redrawn once its track is readable"
    );
    assert!(
        !tiles_path.join("corrupt-activities.json").exists(),
        "a readable library must stop paying for the record"
    );
}

/// The control for the redraw: with nothing unreadable, a second pass over an
/// unchanged library draws nothing.
#[test]
fn a_readable_library_redraws_nothing() {
    let _serialise = TILE_TEST.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = setup(4);

    let tiles_path = s.tiles_dir();
    assert!(
        count_tiles(&tiles_path) > 0,
        "the first pass must draw tiles"
    );
    assert_eq!(
        s.generate_tiles(),
        0,
        "an unchanged readable library must not redraw a single tile"
    );
}

// ------------------------------------------------------------ exports

#[test]
fn the_gpx_archive_names_the_activity_it_could_not_read() {
    let s = setup(4);
    s.corrupt("a2");

    let dest = s.dir.path().join("export.zip");
    let result = s
        .engine
        .bulk_export_gpx(dest.to_str().unwrap())
        .expect("gpx export");
    assert_eq!(result.exported, 3);
    assert_eq!(result.skipped, 1);

    let file = std::fs::File::open(&dest).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    let mut body = String::new();
    archive
        .by_name("skipped.json")
        .expect("skipped.json present")
        .read_to_string(&mut body)
        .expect("read skipped.json");

    let entries: serde_json::Value = serde_json::from_str(&body).expect("skip json");
    assert_eq!(entries[0]["id"], "a2");
    assert!(
        entries[0]["reason"]
            .as_str()
            .expect("reason")
            .starts_with("unreadable track:"),
        "the skip must say why, got {}",
        entries[0]["reason"]
    );
}

#[test]
fn the_geojson_export_carries_its_omissions() {
    let s = setup(4);
    s.corrupt("a2");

    let dest = s.dir.path().join("export.geojson");
    let result = s
        .engine
        .bulk_export_geojson(dest.to_str().unwrap())
        .expect("geojson export");
    assert_eq!(result.exported, 3);
    assert_eq!(result.skipped, 1);

    let body = std::fs::read_to_string(&dest).expect("read geojson");
    let doc: serde_json::Value = serde_json::from_str(&body).expect("geojson parses");
    assert_eq!(doc["features"].as_array().expect("features").len(), 3);
    assert_eq!(doc["skipped"][0]["id"], "a2");
    assert!(
        doc["skipped"][0]["reason"]
            .as_str()
            .expect("reason")
            .starts_with("unreadable track:"),
    );
}
