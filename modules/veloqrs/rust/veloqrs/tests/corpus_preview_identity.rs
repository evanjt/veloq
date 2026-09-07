//! Scenario: an athlete opens the detection preview and presses Preview without
//! moving a slider, on a real library.
//! Expected behaviour: the sliders open on the live config, so the proposal is
//! the cut the catalogue already holds and the diff is entirely unchanged. A
//! `gone` count under those conditions is the preview's own scoping, not a
//! different cut, and not the athlete.
//!
//! This is a measuring instrument. Run it with `--nocapture` to read the
//! counts; the assertion is the part that must not drift.
//!
//!     TRACEMATCH_CORPUS=<dir> cargo test -p veloqrs --features real-corpus \
//!         --test corpus_preview_identity -- --nocapture
//!
//! The corpora are personal activity history and never enter the repository.
//! Nothing here prints a coordinate, an activity id, a section name or a corpus
//! directory name. The report is counts only, and must stay that way.

#![cfg(feature = "real-corpus")]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

const ENV: &str = "TRACEMATCH_CORPUS";

fn corpus_root() -> PathBuf {
    match std::env::var(ENV) {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tracematch")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(".")),
    }
}

/// The largest corpus directory holding GPX. Names are never printed: a corpus
/// directory name can encode where the owner rides.
fn largest_corpus() -> Option<(PathBuf, usize)> {
    let root = corpus_root();
    let mut found: Vec<(PathBuf, usize)> = std::fs::read_dir(&root)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| {
            let n = gpx_paths(&p).len();
            (n > 0).then_some((p, n))
        })
        .collect();
    found.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    found.into_iter().next()
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

#[test]
fn a_preview_on_the_live_config_proposes_the_catalogue_it_already_holds() {
    let Some((dir, gpx_count)) = largest_corpus() else {
        eprintln!("no corpus under {ENV}; nothing measured");
        return;
    };

    let tmp = TempDir::new().expect("tempdir");
    let db_path = tmp.path().join("routes.db");
    assert!(
        persistent_engine_init(db_path.to_str().expect("utf-8 path").to_string()),
        "engine init failed"
    );

    let paths = gpx_paths(&dir);
    let mut ingested = 0usize;
    with_persistent_engine(|engine| {
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
        let (sections, processed) = main.expect("detect produced nothing");
        engine
            .apply_sections_with_cache(sections, cache)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed)
            .expect("processed");
    })
    .expect("engine");

    let (config, live_total) = with_persistent_engine(|engine| {
        let live = engine
            .get_sections()
            .iter()
            .filter(|s| !s.is_user_defined)
            .count();
        (engine.get_section_config(), live)
    })
    .expect("engine");

    let preview = SectionPreview::new();
    let centres = preview.centres(6).expect("centres");
    assert!(
        !centres.is_empty(),
        "a detected library ranks no riding area"
    );

    println!("corpus: {gpx_count} gpx, {ingested} ingested, {live_total} live auto sections");
    println!("areas ranked: {}", centres.len());

    let mut worst_gone = 0u64;
    let mut measured = 0usize;

    for centre in centres.iter().take(3) {
        // The sliders open on the live config, so this is Preview pressed with
        // nothing touched.
        if !preview
            .start(centre.lat, centre.lng, FfiSectionConfig::from(&config))
            .expect("start call")
        {
            continue;
        }

        let deadline = Instant::now() + Duration::from_secs(600);
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
        let counts = &payload["counts"];
        let n = |k: &str| counts[k].as_u64().unwrap_or(u64::MAX);

        println!(
            "  area {}: pool {} activities, current {}, proposed {}, \
             unchanged {}, changed {}, new {}, gone {}",
            measured + 1,
            payload["pool"]["activities"].as_u64().unwrap_or(0),
            n("current"),
            n("proposed"),
            n("unchanged"),
            n("changed"),
            n("new"),
            n("gone"),
        );

        worst_gone = worst_gone.max(n("gone"));
        measured += 1;
    }

    assert!(measured > 0, "no area could be previewed");

    // The claim under test. A preview on the live config over an unchanged
    // pool proposes the catalogue that pool already cut, so nothing is gone.
    assert_eq!(
        worst_gone, 0,
        "a preview on the live config reported {worst_gone} gone, so the counts \
         an athlete reads are the preview's own scoping rather than their sliders"
    );
}
