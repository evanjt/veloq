//! Replaying a corpus as a 1 Hz fix stream against the catalogue the batch
//! detector cut from the same rides.
//!
//! The question this answers is whether a live matcher is shippable at all.
//! The batch detector sees a whole activity; the live one sees a prefix, so it
//! must commit to an entry it may have to give up. The false-start rate and
//! the missed-entry rate against the batch answer are the two numbers that
//! decide it, and the per-fix cost of the catalogue query is the battery
//! objection in the only form measurable off a device.
//!
//! Ignored by default: it needs a local corpus and takes minutes.
//!
//! Run:
//!   VELOQ_CORPUS=~/projects/personal/intervals/tracematch/fullcorpus \
//!     cargo test --release -p veloqrs --bench live_section_replay -- --ignored --nocapture

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::geo_utils::haversine_distance;
use veloqrs::PersistentEngine;
use veloqrs::sections::live::{
    Fix, LiveCandidate, LiveMatchConfig, LiveSectionEvent, LiveSectionMatcher,
};

/// How far the athlete travels before the catalogue is asked again.
const REFRESH_METRES: f64 = 100.0;
/// How far around the fix the refresh looks for section starts.
const QUERY_RADIUS_METRES: f64 = 200.0;

struct Activity {
    id: String,
    sport: String,
    date: String,
    points: Vec<GpsPoint>,
    seconds: Vec<f64>,
}

fn corpus_dir() -> Option<PathBuf> {
    let raw = std::env::var("VELOQ_CORPUS").ok()?;
    let path = PathBuf::from(shellexpand(&raw));
    path.is_dir().then_some(path)
}

fn shellexpand(raw: &str) -> String {
    match raw.strip_prefix("~/") {
        Some(rest) => match std::env::var("HOME") {
            Ok(home) => format!("{home}/{rest}"),
            Err(_) => raw.to_string(),
        },
        None => raw.to_string(),
    }
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Seconds since the start of the month, which is enough to order and space
/// the fixes of one activity.
fn point_seconds(line: &str) -> Option<f64> {
    let start = line.find("<time>")? + 6;
    let end = line.find("</time>")?;
    let inner = line.get(start..end)?;
    let day: f64 = inner.get(8..10)?.parse().ok()?;
    let h: f64 = inner.get(11..13)?.parse().ok()?;
    let m: f64 = inner.get(14..16)?.parse().ok()?;
    let s: f64 = inner.get(17..19)?.parse().ok()?;
    Some((day - 1.0) * 86_400.0 + h * 3600.0 + m * 60.0 + s)
}

fn load_gpx(path: &Path) -> (Vec<GpsPoint>, Vec<f64>, String) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (Vec::new(), Vec::new(), String::new());
    };
    let mut date = String::new();
    let mut points: Vec<GpsPoint> = Vec::new();
    let mut times: Vec<Option<f64>> = Vec::new();
    let mut pending: Option<(f64, f64)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if date.is_empty()
            && let Some(start) = trimmed.find("<time>")
            && let Some(end) = trimmed.find("</time>")
            && start + 6 <= end
        {
            date = trimmed[start + 6..end].to_string();
        }
        if trimmed.contains("<trkpt") {
            if let Some((lat, lon)) = pending.take() {
                points.push(GpsPoint::new(lat, lon));
                times.push(None);
            }
            if let (Some(lat_start), Some(lon_start)) =
                (trimmed.find("lat=\""), trimmed.find("lon=\""))
                && let (Some(lat_end), Some(lon_end)) = (
                    trimmed[lat_start + 5..].find('"'),
                    trimmed[lon_start + 5..].find('"'),
                )
                && let (Ok(lat), Ok(lon)) = (
                    trimmed[lat_start + 5..lat_start + 5 + lat_end].parse::<f64>(),
                    trimmed[lon_start + 5..lon_start + 5 + lon_end].parse::<f64>(),
                )
            {
                pending = Some((lat, lon));
            }
        } else if let Some((lat, lon)) = pending
            && let Some(start) = trimmed.find("<ele>")
            && let Some(end) = trimmed.find("</ele>")
            && start + 5 <= end
        {
            let ele = trimmed[start + 5..end].parse::<f64>().ok();
            points.push(match ele {
                Some(e) => GpsPoint::with_elevation(lat, lon, e),
                None => GpsPoint::new(lat, lon),
            });
            times.push(None);
            pending = None;
        } else if pending.is_none()
            && let Some(t) = times.last_mut()
            && t.is_none()
            && trimmed.starts_with("<time>")
        {
            *t = point_seconds(trimmed);
        }
    }
    if let Some((lat, lon)) = pending.take() {
        points.push(GpsPoint::new(lat, lon));
        times.push(None);
    }
    let seconds = if !times.is_empty() && times.iter().all(Option::is_some) {
        times.into_iter().flatten().collect()
    } else {
        Vec::new()
    };
    (points, seconds, date)
}

fn sport_from_name(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.contains("cycl") || lower.contains("ride") || lower.contains("vélo") {
        "Ride"
    } else if lower.contains("run") || lower.contains("course") {
        "Run"
    } else if lower.contains("hik") || lower.contains("walk") || lower.contains("march") {
        "Walk"
    } else {
        "Other"
    }
}

fn load_corpus(dir: &Path) -> Vec<Activity> {
    let mut activities = Vec::new();
    for entry in std::fs::read_dir(dir).expect("read_dir").flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e == "gpx") {
            continue;
        }
        let (points, seconds, date) = load_gpx(&path);
        if points.len() < 50 || seconds.len() != points.len() {
            continue;
        }
        let name = path.file_stem().unwrap_or_default().to_string_lossy();
        activities.push(Activity {
            id: name.to_string(),
            sport: sport_from_name(&name).to_string(),
            date,
            points,
            seconds,
        });
    }
    activities.sort_by(|a, b| a.date.cmp(&b.date));
    activities
}

/// One fix per second, taking the nearest sample. A corpus recorded at a
/// coarser cadence is upsampled, which is the pessimistic direction: it gives
/// the matcher more chances to arm and to leave the corridor.
fn resample_1hz(activity: &Activity) -> Vec<Fix> {
    let start = activity.seconds[0];
    let end = *activity.seconds.last().unwrap();
    if !(end > start) || end - start > 86_400.0 {
        return Vec::new();
    }
    let mut fixes = Vec::new();
    let mut index = 0usize;
    let mut t = 0.0;
    while start + t <= end {
        let target = start + t;
        while index + 1 < activity.seconds.len() && activity.seconds[index + 1] <= target {
            index += 1;
        }
        fixes.push(Fix {
            point: activity.points[index],
            seconds: t,
        });
        t += 1.0;
    }
    fixes
}

/// Section id and stored direction for every visit the batch detector recorded
/// on one activity.
fn batch_visits(db: &Connection, activity_id: &str) -> HashMap<String, String> {
    let mut stmt = db
        .prepare("SELECT section_id, direction FROM section_activities WHERE activity_id = ?")
        .expect("prepare section_activities");
    let rows = stmt
        .query_map(params![activity_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("query section_activities");
    rows.flatten().collect()
}

#[derive(Default)]
struct Totals {
    activities: usize,
    fixes: usize,
    entries: usize,
    exits: usize,
    abandons: usize,
    batch_visits: usize,
    matched: usize,
    spurious: usize,
    query_calls: usize,
    query_nanos: u128,
    matcher_nanos: u128,
    never_entered: usize,
    entered_not_exited: usize,
    missed_reverse: usize,
    never_offered: usize,
    same_direction_visits: usize,
    same_direction_matched: usize,
}

#[test]
#[ignore = "needs a local corpus at VELOQ_CORPUS"]
fn live_matching_against_the_batch_catalogue() {
    let Some(dir) = corpus_dir() else {
        panic!("set VELOQ_CORPUS to a directory of .gpx files");
    };
    let limit = env_usize("VELOQ_CORPUS_LIMIT", 150);
    let mut corpus = load_corpus(&dir);
    corpus.truncate(limit);
    assert!(!corpus.is_empty(), "no usable activities under {dir:?}");

    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("replay.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");

    let ingest = Instant::now();
    for (i, activity) in corpus.iter().enumerate() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.points.clone(),
                activity.sport.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(1_700_000_000 + i as i64 * 86_400),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }
    let ingest_ms = ingest.elapsed().as_millis();

    let detect = Instant::now();
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save_processed_activity_ids");
    let detect_ms = detect.elapsed().as_millis();

    let db = Connection::open(&path).expect("raw open");
    let catalogue: usize = db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .expect("catalogue count") as usize;

    println!(
        "corpus {} activities, ingest {ingest_ms} ms, detect+apply {detect_ms} ms, catalogue {catalogue} sections",
        corpus.len()
    );
    assert!(
        catalogue > 0,
        "the batch detector cut nothing to replay against"
    );

    let config = LiveMatchConfig::default();
    // The corpus infers a sport from the file name, so the filter can drop a
    // section the batch detector cut from the same ride under a better label.
    // Off, the miss count separates a catalogue gap from a naming one.
    let sport_filter = std::env::var("VELOQ_REPLAY_SPORT_FILTER").as_deref() != Ok("0");
    println!("sport filter {}", if sport_filter { "on" } else { "off" });
    let mut totals = Totals::default();
    let mut abandon_by_section: HashMap<String, usize> = HashMap::new();

    for activity in &corpus {
        let fixes = resample_1hz(activity);
        if fixes.is_empty() {
            continue;
        }
        let truth = batch_visits(&db, &activity.id);
        totals.activities += 1;
        totals.fixes += fixes.len();
        totals.batch_visits += truth.len();

        let mut matcher = LiveSectionMatcher::new(Vec::new(), config);
        let mut exited: HashSet<String> = HashSet::new();
        let mut entered: HashSet<String> = HashSet::new();
        let mut offered: HashSet<String> = HashSet::new();
        let mut last_query: Option<GpsPoint> = None;

        for fix in fixes {
            let due = last_query
                .map(|p| haversine_distance(&p, &fix.point) >= REFRESH_METRES)
                .unwrap_or(true);
            if due {
                let started = Instant::now();
                let near = engine.sections_near_point(
                    fix.point.latitude,
                    fix.point.longitude,
                    sport_filter.then_some(activity.sport.as_str()),
                    QUERY_RADIUS_METRES,
                );
                totals.query_nanos += started.elapsed().as_nanos();
                totals.query_calls += 1;
                for section in &near {
                    offered.insert(section.id.clone());
                }
                let keep: HashSet<&str> = near.iter().map(|s| s.id.as_str()).collect();
                matcher.retire(&keep);
                for section in &near {
                    let points = veloqrs::coords::decode(&section.encoded_polyline);
                    if let Some(candidate) = LiveCandidate::new(section.id.clone(), points) {
                        matcher.insert(candidate);
                    }
                }
                last_query = Some(fix.point);
            }

            let started = Instant::now();
            let events = matcher.push(fix);
            totals.matcher_nanos += started.elapsed().as_nanos();

            for event in events {
                match event {
                    LiveSectionEvent::Entered { section_id, .. } => {
                        totals.entries += 1;
                        entered.insert(section_id);
                    }
                    LiveSectionEvent::Exited { section_id, .. } => {
                        totals.exits += 1;
                        exited.insert(section_id);
                    }
                    LiveSectionEvent::Abandoned { section_id, .. } => {
                        totals.abandons += 1;
                        *abandon_by_section.entry(section_id).or_default() += 1;
                    }
                }
            }
        }

        for (section_id, direction) in &truth {
            let same = direction == "same";
            if same {
                totals.same_direction_visits += 1;
            }
            if exited.contains(section_id) {
                totals.matched += 1;
                if same {
                    totals.same_direction_matched += 1;
                }
                continue;
            }
            if entered.contains(section_id) {
                totals.entered_not_exited += 1;
            } else {
                totals.never_entered += 1;
                if !offered.contains(section_id) {
                    totals.never_offered += 1;
                }
                if direction != "same" {
                    totals.missed_reverse += 1;
                }
            }
        }
        totals.spurious += exited.iter().filter(|id| !truth.contains_key(*id)).count();
    }

    let rate = |n: usize, d: usize| {
        if d == 0 {
            0.0
        } else {
            n as f64 * 100.0 / d as f64
        }
    };
    println!("--- live replay against the batch catalogue ---");
    println!("activities replayed   {}", totals.activities);
    println!("fixes                 {}", totals.fixes);
    println!("entries               {}", totals.entries);
    println!("exits                 {}", totals.exits);
    println!(
        "abandons (false start) {} ({:.1}% of entries)",
        totals.abandons,
        rate(totals.abandons, totals.entries)
    );
    println!("batch visits          {}", totals.batch_visits);
    println!(
        "matched live          {} ({:.1}% of batch visits)",
        totals.matched,
        rate(totals.matched, totals.batch_visits)
    );
    println!(
        "missed                {} ({:.1}%)",
        totals.batch_visits.saturating_sub(totals.matched),
        rate(
            totals.batch_visits.saturating_sub(totals.matched),
            totals.batch_visits
        )
    );
    println!(
        "same-direction visits {}, matched {} ({:.1}%)",
        totals.same_direction_visits,
        totals.same_direction_matched,
        rate(totals.same_direction_matched, totals.same_direction_visits)
    );
    println!(
        "  entered, not closed {} ({:.1}% of misses)",
        totals.entered_not_exited,
        rate(
            totals.entered_not_exited,
            totals.batch_visits.saturating_sub(totals.matched)
        )
    );
    println!(
        "  never entered       {} ({:.1}% of misses)",
        totals.never_entered,
        rate(
            totals.never_entered,
            totals.batch_visits.saturating_sub(totals.matched)
        )
    );
    println!(
        "    never offered     {} (the catalogue query never returned it)",
        totals.never_offered
    );
    println!(
        "    reverse direction {} (the batch matched it the other way round)",
        totals.missed_reverse
    );
    println!(
        "live-only exits       {} ({:.1}% of exits)",
        totals.spurious,
        rate(totals.spurious, totals.exits.max(1))
    );
    println!(
        "catalogue query       {} calls, {:.3} ms each, one per {REFRESH_METRES} m",
        totals.query_calls,
        totals.query_nanos as f64 / 1e6 / totals.query_calls.max(1) as f64
    );
    println!(
        "matcher               {:.4} ms per fix",
        totals.matcher_nanos as f64 / 1e6 / totals.fixes.max(1) as f64
    );

    let mut worst: Vec<(&String, &usize)> = abandon_by_section.iter().collect();
    worst.sort_by(|a, b| b.1.cmp(a.1));
    for (id, count) in worst.iter().take(5) {
        println!("most abandoned        {id} x{count}");
    }
}

/// The per-fix cost of the two index shapes the catalogue query could take:
/// the bounds columns filtered in SQL, with and without an index, against a
/// grid cell over each section's start point.
#[test]
#[ignore = "needs a local corpus at VELOQ_CORPUS"]
fn the_cost_of_both_index_shapes() {
    let Some(dir) = corpus_dir() else {
        panic!("set VELOQ_CORPUS to a directory of .gpx files");
    };
    let limit = env_usize("VELOQ_CORPUS_LIMIT", 150);
    let mut corpus = load_corpus(&dir);
    corpus.truncate(limit);

    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("index.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    for (i, activity) in corpus.iter().enumerate() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.points.clone(),
                activity.sport.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(1_700_000_000 + i as i64 * 86_400),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save_processed_activity_ids");

    let db = Connection::open(&path).expect("raw open");
    let catalogue: i64 = db
        .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
        .expect("count");
    println!("catalogue {catalogue} sections");

    // Every fix of every activity, so the probes are drawn from where the
    // athlete actually is rather than from the middle of the bounding box.
    let probes: Vec<GpsPoint> = corpus
        .iter()
        .flat_map(|a| a.points.iter().step_by(97).copied())
        .collect();
    assert!(!probes.is_empty());
    let radius = QUERY_RADIUS_METRES;
    let dlat = radius / 111_320.0;

    let bounds_sql = "SELECT COUNT(*) FROM sections
         WHERE disabled = 0 AND superseded_by IS NULL AND bounds_min_lat IS NOT NULL
           AND bounds_min_lat <= ?1 + ?3 AND bounds_max_lat >= ?1 - ?3
           AND bounds_min_lng <= ?2 + ?4 AND bounds_max_lng >= ?2 - ?4";

    let time_bounds = |db: &Connection, label: &str| {
        let mut stmt = db.prepare(bounds_sql).expect("prepare bounds");
        let started = Instant::now();
        let mut hits = 0i64;
        for probe in &probes {
            let dlng = dlat / probe.latitude.to_radians().cos();
            hits += stmt
                .query_row(
                    params![probe.latitude, probe.longitude, dlat, dlng],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0);
        }
        println!(
            "{label:28} {:.4} ms per probe, {hits} candidates over {} probes",
            started.elapsed().as_nanos() as f64 / 1e6 / probes.len() as f64,
            probes.len()
        );
    };

    time_bounds(&db, "bounds scan, no index");
    db.execute_batch(
        "CREATE INDEX idx_sections_bounds_lat ON sections(bounds_min_lat, bounds_max_lat);",
    )
    .expect("create bounds index");
    time_bounds(&db, "bounds scan, lat index");

    // The cell shape: one integer per section start, on a grid of roughly the
    // query radius, so a probe reads nine cells and no arithmetic.
    let cell_degrees = radius * 2.0 / 111_320.0;
    db.execute_batch(
        "ALTER TABLE sections ADD COLUMN start_cell_lat INTEGER;
         ALTER TABLE sections ADD COLUMN start_cell_lng INTEGER;",
    )
    .expect("add cell columns");
    {
        // The start point is the first vertex of the stored line, which the
        // bounds columns do not carry, so the cell has to come off the blob.
        let ids: Vec<(String, f64, f64)> = {
            let mut stmt = db
                .prepare(
                    "SELECT id, bounds_min_lat, bounds_min_lng FROM sections
                     WHERE bounds_min_lat IS NOT NULL",
                )
                .expect("prepare cells");
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                })
                .expect("query cells");
            rows.flatten().collect()
        };
        let tx = db.unchecked_transaction().expect("tx");
        for (id, lat, lng) in ids {
            tx.execute(
                "UPDATE sections SET start_cell_lat = ?, start_cell_lng = ? WHERE id = ?",
                params![
                    (lat / cell_degrees).floor() as i64,
                    (lng / cell_degrees).floor() as i64,
                    id
                ],
            )
            .expect("write cell");
        }
        tx.commit().expect("commit cells");
    }
    db.execute_batch(
        "CREATE INDEX idx_sections_start_cell ON sections(start_cell_lat, start_cell_lng);",
    )
    .expect("create cell index");

    let mut stmt = db
        .prepare(
            "SELECT COUNT(*) FROM sections
             WHERE start_cell_lat BETWEEN ?1 - 1 AND ?1 + 1
               AND start_cell_lng BETWEEN ?2 - 1 AND ?2 + 1
               AND disabled = 0 AND superseded_by IS NULL",
        )
        .expect("prepare cell query");
    let started = Instant::now();
    let mut hits = 0i64;
    for probe in &probes {
        hits += stmt
            .query_row(
                params![
                    (probe.latitude / cell_degrees).floor() as i64,
                    (probe.longitude / cell_degrees).floor() as i64
                ],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
    }
    println!(
        "{:28} {:.4} ms per probe, {hits} candidates over {} probes",
        "start-cell index",
        started.elapsed().as_nanos() as f64 / 1e6 / probes.len() as f64,
        probes.len()
    );

    // What the export costs end to end, geometry resolution included, which is
    // the figure a recorder actually pays.
    let started = Instant::now();
    let mut returned = 0usize;
    for probe in &probes {
        returned += engine
            .sections_near_point(probe.latitude, probe.longitude, None, radius)
            .len();
    }
    println!(
        "{:28} {:.4} ms per probe, {returned} sections over {} probes",
        "sections_near_point",
        started.elapsed().as_nanos() as f64 / 1e6 / probes.len() as f64,
        probes.len()
    );
}
