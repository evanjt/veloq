//! How large the heatmap tile tree grows for a real library, per zoom, from a
//! complete pass through the engine.
//!
//! Reads a corpus directory of GPX files and its `_meta.json` (activity id to
//! type and local start date), keeps the activities in a date range, stores
//! them through `add_activities_batch`, runs the pass the tiles path requests
//! and walks the tree it wrote. The report is counts and bytes only: no
//! coordinate, id, name or directory name is printed, because the corpus is
//! personal activity history and never enters the repository.
//!
//! Usage:
//!   cargo run --release -p veloqrs --example heatmap_tree_size -- \
//!     CORPUS_DIR [FROM_DATE] [TO_DATE] [LIMIT]
//!
//! FROM_DATE and TO_DATE are `YYYY-MM-DD`, inclusive, `-` for open. LIMIT keeps
//! the most recent activities in the range. A GPX that is a dangling link is
//! looked for by name in `FALLBACK_GPX_DIR` when that is set. The tree is
//! written to `HEATMAP_TREE_OUT` and kept when that is set, else to a temporary
//! directory.

use std::collections::{BTreeMap, HashMap};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::{TILE_GENERATION_HANDLE, persistent_engine_init};
use veloqrs::persistence::with_persistent_engine;

fn load_points(path: &Path) -> Vec<GpsPoint> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut points = Vec::new();
    for line in content.lines() {
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
    points
}

/// Activity id to (local start date, type), from the corpus's `_meta.json`.
fn load_meta(dir: &Path) -> HashMap<String, (String, String)> {
    let text = std::fs::read_to_string(dir.join("_meta.json")).expect("_meta.json readable");
    let json: serde_json::Value = serde_json::from_str(&text).expect("_meta.json parses");
    json.as_object()
        .expect("_meta.json is an object")
        .iter()
        .map(|(id, v)| {
            let date = v["date"].as_str().unwrap_or_default().to_string();
            let kind = v["type"].as_str().unwrap_or("Ride").to_string();
            (id.clone(), (date, kind))
        })
        .collect()
}

fn resolve(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        return Some(path.to_path_buf());
    }
    let fallback = std::env::var("FALLBACK_GPX_DIR").ok()?;
    let candidate = Path::new(&fallback).join(path.file_name()?);
    candidate.exists().then_some(candidate)
}

#[derive(Default)]
struct ZoomTally {
    drawn: u64,
    empty: u64,
    bytes: u64,
    allocated: u64,
    dirs: u64,
    dir_allocated: u64,
}

fn walk(dir: &Path, zoom: u8, tally: &mut BTreeMap<u8, ZoomTally>) {
    for entry in std::fs::read_dir(dir).expect("tree readable").flatten() {
        let path = entry.path();
        let meta = entry.metadata().expect("metadata");
        if meta.is_dir() {
            let t = tally.entry(zoom).or_default();
            t.dirs += 1;
            t.dir_allocated += meta.blocks() * 512;
            walk(&path, zoom, tally);
            continue;
        }
        let t = tally.entry(zoom).or_default();
        match path.extension().and_then(|e| e.to_str()) {
            Some("png") => t.drawn += 1,
            Some("empty") => t.empty += 1,
            _ => continue,
        }
        t.bytes += meta.len();
        t.allocated += meta.blocks() * 512;
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("CORPUS_DIR"));
    let open = |s: Option<String>| s.filter(|s| s != "-");
    let from = open(args.next());
    let to = open(args.next());
    let limit: Option<usize> = args.next().map(|s| s.parse().expect("LIMIT is a count"));

    let meta = load_meta(&dir);
    let mut entries: Vec<(String, String, String, PathBuf)> = std::fs::read_dir(&dir)
        .expect("corpus readable")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "gpx"))
        .filter_map(|p| {
            let name = p.file_name()?.to_str()?.to_string();
            let id = name.split('_').next()?.to_string();
            let (date, kind) = meta.get(&id)?.clone();
            Some((date, id, kind, p))
        })
        .filter(|(date, ..)| from.as_ref().is_none_or(|f| date.as_str() >= f.as_str()))
        .filter(|(date, ..)| {
            to.as_ref()
                .is_none_or(|t| &date[..10.min(date.len())] <= t.as_str())
        })
        .collect();
    entries.sort();
    if let Some(n) = limit {
        let skip = entries.len().saturating_sub(n);
        entries.drain(..skip);
    }

    let mut rows = Vec::new();
    let mut points_total = 0usize;
    let mut unresolved = 0usize;
    for (_, id, kind, path) in &entries {
        let Some(path) = resolve(path) else {
            unresolved += 1;
            continue;
        };
        let points = load_points(&path);
        if points.len() < 2 {
            continue;
        }
        points_total += points.len();
        rows.push((id.clone(), points, kind.clone()));
    }
    let span = match (rows.first(), rows.last()) {
        (Some(_), Some(_)) => format!(
            "{} to {}",
            &entries.first().unwrap().0[..7],
            &entries.last().unwrap().0[..7]
        ),
        _ => "empty".to_string(),
    };
    eprintln!(
        "LIBRARY {} activities with tracks, {} points, {} unresolved, {}",
        rows.len(),
        points_total,
        unresolved,
        span
    );

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("size.db");
    let tiles_dir = std::env::var("HEATMAP_TREE_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| tmp.path().join("tiles"));
    std::fs::create_dir_all(&tiles_dir).expect("tiles dir");
    assert!(persistent_engine_init(db.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut rows = rows;
        while !rows.is_empty() {
            let chunk: Vec<_> = rows.drain(..50.min(rows.len())).collect();
            engine.add_activities_batch(chunk).expect("library stored");
        }
        engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
    })
    .expect("engine installed");

    let deadline = Instant::now() + Duration::from_secs(3600);
    let handle = loop {
        if let Some(handle) = TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            break handle;
        }
        assert!(Instant::now() < deadline, "no tile pass was requested");
        std::thread::sleep(Duration::from_millis(1));
    };
    let start = Instant::now();
    let drawn = handle
        .recv_blocking()
        .expect("the pass reported its outcome");
    let elapsed = start.elapsed();

    let mut tally = BTreeMap::new();
    for entry in std::fs::read_dir(&tiles_dir).expect("tiles dir").flatten() {
        let path = entry.path();
        if let Some(z) = path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u8>().ok())
            && path.is_dir()
        {
            walk(&path, z, &mut tally);
        }
    }

    eprintln!("PASS {drawn} tiles reported in {} ms", elapsed.as_millis());
    eprintln!("ZOOM drawn empty bytes allocated mean_png dirs dir_allocated");
    let mut sum = ZoomTally::default();
    for (z, t) in &tally {
        eprintln!(
            "z{z:<3} {:>7} {:>7} {:>12} {:>12} {:>7} {:>6} {:>10}",
            t.drawn,
            t.empty,
            t.bytes,
            t.allocated,
            t.bytes.checked_div(t.drawn).unwrap_or(0),
            t.dirs,
            t.dir_allocated
        );
        sum.drawn += t.drawn;
        sum.empty += t.empty;
        sum.bytes += t.bytes;
        sum.allocated += t.allocated;
        sum.dirs += t.dirs;
        sum.dir_allocated += t.dir_allocated;
    }
    eprintln!(
        "TOTAL {} drawn, {} empty, {:.1} MB written, {:.1} MB allocated to files, \
         {} directories holding {:.1} MB",
        sum.drawn,
        sum.empty,
        sum.bytes as f64 / 1e6,
        sum.allocated as f64 / 1e6,
        sum.dirs,
        sum.dir_allocated as f64 / 1e6
    );
}
