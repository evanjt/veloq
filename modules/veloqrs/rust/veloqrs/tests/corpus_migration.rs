//! Scenario: a library built by the released detector, then migrated by the
//! cutover, measured on the owner's real corpora.
//! Expected behaviour: every section carries a resolvable reference to a real
//! activity, and the migration neither loses traversal evidence nor leaves a
//! stored line that only a blob can explain.
//!
//! This is a measuring instrument as much as a test. Run it with `--nocapture`
//! to read the report; the assertions below are the parts that must not drift.
//!
//!     TRACEMATCH_CORPUS=<dir> cargo test -p veloqrs --features real-corpus \
//!         --test corpus_migration -- --nocapture
//!
//! No tag checkout is needed to reproduce the released era. Every old path is
//! still compiled: `DetectionMethod::Corridor`, `detect_sections_multiscale`,
//! and the `BATCH_CAP` batching that was already present at 0.3.8. Above the
//! cap the configured method is bypassed entirely (`detection.rs`), so a large
//! library's catalogue came from multiscale plus incremental whatever its
//! settings said. Both classes are exercised below.
//!
//! The corpora are personal activity history and never enter the repository.
//! Nothing here prints a coordinate, an activity id, a section name or a corpus
//! directory name. The report is counts only, and must stay that way.

#![cfg(feature = "real-corpus")]

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::sections::DetectionMethod;
use veloqrs::persistence::with_persistent_engine;

// Both tests drive the one process-wide engine and each runs a cutover, so a
// concurrent pair sees the other's switched config and reports no migration
// owed.
static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

const ENV: &str = "TRACEMATCH_CORPUS";

/// Detection dispatch bypasses the configured method above this many tracks.
const BATCH_CAP: usize = 500;

fn corpus_root() -> PathBuf {
    match std::env::var(ENV) {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tracematch")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(".")),
    }
}

/// Every corpus directory holding GPX, largest first. Names are never printed:
/// a corpus directory name can encode where the owner rides.
fn corpora() -> Vec<(PathBuf, usize)> {
    let root = corpus_root();
    let mut found: Vec<(PathBuf, usize)> = std::fs::read_dir(&root)
        .unwrap_or_else(|e| panic!("cannot read {ENV} root ({e}). Set {ENV}."))
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| {
            let n = gpx_paths(&p).len();
            (n > 0).then_some((p, n))
        })
        .collect();
    found.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    found
}

fn gpx_paths(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "gpx"))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// Points and the first timestamp, which detection needs for occasion spans.
fn load_gpx(path: &Path) -> (Vec<GpsPoint>, Option<i64>) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (Vec::new(), None);
    };
    let mut points = Vec::new();
    let mut first_time = None;

    for line in content.lines() {
        if first_time.is_none()
            && let Some(open) = line.find("<time>")
            && let Some(close) = line.find("</time>")
            && close > open + 6
        {
            first_time = chrono::DateTime::parse_from_rfc3339(&line[open + 6..close])
                .ok()
                .map(|t| t.timestamp());
        }
        if !line.contains("<trkpt") {
            continue;
        }
        let (Some(lat_at), Some(lon_at)) = (line.find("lat=\""), line.find("lon=\"")) else {
            continue;
        };
        let lat_s = &line[lat_at + 5..];
        let lon_s = &line[lon_at + 5..];
        let (Some(lat_end), Some(lon_end)) = (lat_s.find('"'), lon_s.find('"')) else {
            continue;
        };
        if let (Ok(lat), Ok(lon)) = (
            lat_s[..lat_end].parse::<f64>(),
            lon_s[..lon_end].parse::<f64>(),
        ) {
            points.push(GpsPoint::new(lat, lon));
        }
    }
    (points, first_time)
}

/// What one catalogue looks like, in integers only.
#[derive(Debug, Default, PartialEq, Eq)]
struct Shape {
    sections: u32,
    exact: u32,
    consensus: u32,
    orphaned: u32,
    no_source: u32,
    /// Sections naming an activity that is still in the pool.
    rep_present: u32,
    /// Sections naming no activity at all.
    rep_missing: u32,
    /// Sections whose named activity has a stored stream.
    rep_track_present: u32,
    members: u32,
    excluded_members: u32,
}

fn shape_of(db: &Connection) -> Shape {
    let mut s = Shape::default();
    let mut stmt = db
        .prepare(
            "SELECT COALESCE(geometry_source, ''),
                    COALESCE(representative_activity_id, ''),
                    EXISTS(SELECT 1 FROM activities a
                           WHERE a.id = sections.representative_activity_id),
                    EXISTS(SELECT 1 FROM gps_tracks g
                           WHERE g.activity_id = sections.representative_activity_id)
             FROM sections WHERE section_type = 'auto'",
        )
        .expect("prepare");
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .expect("query");
    for row in rows {
        let (source, rep, in_pool, has_track) = row.expect("row");
        s.sections += 1;
        match source.as_str() {
            "exact" => s.exact += 1,
            "consensus" => s.consensus += 1,
            "orphaned" => s.orphaned += 1,
            _ => s.no_source += 1,
        }
        if rep.is_empty() {
            s.rep_missing += 1;
        } else if in_pool == 1 {
            s.rep_present += 1;
        }
        if has_track == 1 {
            s.rep_track_present += 1;
        }
    }

    s.members = db
        .query_row(
            "SELECT COUNT(*) FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE s.section_type = 'auto'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    s.excluded_members = db
        .query_row(
            "SELECT COUNT(*) FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE s.section_type = 'auto' AND sa.excluded = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    s
}

fn report(label: &str, s: &Shape) {
    println!(
        "  {label:<22} sections {:>5} | exact {:>5} consensus {:>5} orphaned {:>4} unset {:>5} \
         | rep in pool {:>5} missing {:>4} with stream {:>5} | members {:>6} excluded {:>4}",
        s.sections,
        s.exact,
        s.consensus,
        s.orphaned,
        s.no_source,
        s.rep_present,
        s.rep_missing,
        s.rep_track_present,
        s.members,
        s.excluded_members,
    );
}

/// Ingest a corpus and cut it the way the released build did.
fn released_era_catalogue(dir: &Path, db_path: &Path) -> usize {
    assert!(
        veloqrs::persistence::persistent_engine_ffi::persistent_engine_init(
            db_path.to_str().unwrap().to_string()
        ),
        "engine init failed"
    );

    let paths = gpx_paths(dir);
    let mut ingested = 0usize;
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        // What a released install persisted. Above BATCH_CAP the dispatch
        // ignores it, which is the point.
        cfg.detection_method = DetectionMethod::Corridor;
        engine.set_section_config(cfg);

        for (i, path) in paths.iter().enumerate() {
            let (points, time) = load_gpx(path);
            if points.len() < 2 {
                continue;
            }
            // Positional id: never the corpus filename, which can name a place.
            let id = format!("c{i:05}");
            if engine
                .add_activity(id.clone(), points, "Ride".into())
                .is_err()
            {
                continue;
            }
            let _ = engine.update_activity_metadata(&id, time, None, None, None);
            ingested += 1;
        }
    })
    .expect("engine");

    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache) = handle.recv_with_cache();
        let (sections, processed) = main.expect("released-era detect produced nothing");
        engine
            .apply_sections_with_cache(sections, cache)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed)
            .expect("processed");
    })
    .expect("engine");

    ingested
}

/// The whole migration, over every corpus present, reported and asserted.
///
/// Measures every corpus before asserting anything. A corpus that fails must
/// not hide the numbers for the ones after it, because the numbers are the
/// point of running this.
#[test]
fn a_released_catalogue_migrates_onto_references() {
    let _serial = serial();
    let corpora = corpora();
    assert!(
        !corpora.is_empty(),
        "no corpus found under {ENV}. An empty run reports the same green as a \
         real one, which is the failure this asserts against."
    );

    let mut measured: Vec<(usize, usize, Shape, Shape)> = Vec::new();

    for (dir, file_count) in &corpora {
        let tmp = TempDir::new().expect("tempdir");
        let db_path = tmp.path().join("corpus.db");

        let ingested = released_era_catalogue(dir, &db_path);
        let dispatch = if ingested > BATCH_CAP {
            "batched (method bypassed)"
        } else {
            "single batch (method honoured)"
        };
        println!("\ncorpus of {file_count} files, {ingested} ingested, {dispatch}");

        let db = Connection::open(&db_path).expect("open");
        let before = shape_of(&db);
        report("released era", &before);

        assert!(
            before.sections > 0,
            "the released-era cut produced no sections, so everything below is vacuous"
        );
        let owed = with_persistent_engine(|e| e.cutover_is_owed()).expect("engine");
        assert!(owed, "a corridor-era catalogue is owed a migration");

        veloqrs::persistence::cutover::run_cutover().expect("cutover");

        let after = shape_of(&db);
        report("after cutover", &after);
        measured.push((*file_count, ingested, before, after));
    }

    let mut unreferenced = 0u32;
    let mut nameless = 0u32;
    for (files, _, _, after) in &measured {
        assert!(
            after.sections > 0,
            "corpus of {files} files: the migrated catalogue is empty, so the cut \
             lost the library"
        );
        assert_eq!(
            after.exact + after.orphaned + after.consensus + after.no_source,
            after.sections,
            "corpus of {files} files: provenance does not account for every section"
        );
        unreferenced += after.consensus + after.no_source;
        nameless += after.rep_missing;
    }

    // A section that names an activity must name one still in the pool.
    assert_eq!(nameless, 0, "{nameless} migrated sections name no activity");

    // Every surviving section must resolve to a real slice of a real ride.
    // This is what lets the geometry blob be a cache rather than the truth, and
    // it is the property the remaining backfill work exists to deliver.
    assert_eq!(
        unreferenced,
        0,
        "{unreferenced} sections survived the migration without a resolvable \
         reference, across {} corpora",
        measured.len()
    );
}

/// Same corpus, same catalogue. If the migration is not a pure function of the
/// library, nothing downstream of it can be trusted.
///
/// Runs on the LARGEST corpus, because the only dispatch that can differ
/// between two runs is the batched one above [`BATCH_CAP`], and a small corpus
/// never reaches it. This is the slow test of the pair for that reason.
///
/// Both eras are asserted. The released one used to wander, six or seven
/// sections and anywhere from 444 to 630 members over the same files, so it was
/// measured and printed but left unasserted. It holds now: the retired detector
/// shares the ordering primitives that were canonicalised for the unified path,
/// so the fix reached it without anyone repairing it on its own account.
///
/// The migrated catalogue is the one that matters, and it converges either way,
/// because the cut is re-derived from the activity pool.
#[test]
fn the_migration_is_reproducible() {
    let _serial = serial();
    let corpora = corpora();
    let (dir, _) = corpora
        .first()
        .expect("no corpus found; see the sibling test's message");

    let mut shapes = Vec::new();
    for _ in 0..2 {
        let tmp = TempDir::new().expect("tempdir");
        let db_path = tmp.path().join("corpus.db");
        released_era_catalogue(dir, &db_path);
        let db = Connection::open(&db_path).expect("open");
        // Both eras, because a migration that is a pure function of a catalogue
        // that is not itself reproducible is only half an answer.
        let before = shape_of(&db);
        veloqrs::persistence::cutover::run_cutover().expect("cutover");
        shapes.push((before, shape_of(&db)));
    }

    for (i, (before, after)) in shapes.iter().enumerate() {
        println!("\nrun {}", i + 1);
        report("released era", before);
        report("after cutover", after);
    }

    assert_eq!(
        shapes[0].0, shapes[1].0,
        "two released-era cuts of one corpus disagreed"
    );

    assert_eq!(
        shapes[0].1, shapes[1].1,
        "two migrations of one corpus disagreed"
    );
}
