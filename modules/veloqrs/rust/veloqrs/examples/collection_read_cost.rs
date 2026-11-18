//! What the whole-collection and comparison reads cost over the link on a
//! library built from the private corpus: bytes and time of the GeoJSON every
//! route or every section on one map needs, the list read behind the dense
//! table, and the per-item reads one comparison of 2, 5 and 10 items adds up.
//!
//! The library is every corpus track stored, sections detected and routes
//! grouped. `--n N` above the corpus size pads it with copies of the first
//! tracks moved onto new ground, so they form routes and sections of their
//! own; that is the shape of a larger library, not a real one.
//!
//!     cargo run --release -p veloqrs --example collection_read_cost -- --n 2000
//!
//! Prints a table, asserts nothing.

use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde_json::{Value, json};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;
use veloqrs::remote::protocol::answer;

#[path = "../../tracematch/tests/corpus/mod.rs"]
mod corpus;

const CORPUS: &str = "fullcorpus";
const SAMPLES: usize = 7;

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn median(mut xs: Vec<Duration>) -> Duration {
    xs.sort();
    xs[xs.len() / 2]
}

/// Answer one link read `SAMPLES` times: the median wall time, the reply's
/// bytes, and the parsed reply's `result`.
fn read(conn: &Connection, method: &str, params: Value) -> (Duration, usize, Value) {
    let request = json!({ "id": 1, "method": method, "params": params }).to_string();
    let mut times = Vec::with_capacity(SAMPLES);
    let mut reply = String::new();
    for _ in 0..SAMPLES {
        let at = Instant::now();
        reply = answer(conn, &request);
        times.push(at.elapsed());
    }
    let mut parsed: Value = serde_json::from_str(&reply).expect("reply is json");
    if let Some(error) = parsed.get("error") {
        eprintln!("{method}: {error}");
    }
    (median(times), reply.len(), parsed["result"].take())
}

/// Features and vertices of a GeoJSON text the map would draw.
fn shape(result: &Value) -> (usize, usize) {
    let Some(text) = result["text"].as_str() else {
        return (0, 0);
    };
    let geo: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let features = geo["features"].as_array().cloned().unwrap_or_default();
    let vertices = features
        .iter()
        .map(|f| f["geometry"]["coordinates"].as_array().map_or(0, Vec::len))
        .sum();
    (features.len(), vertices)
}

fn row(label: &str, (time, bytes, _): &(Duration, usize, Value), extra: &str) {
    println!(
        "{label:<34} {:>9.2} ms {:>10} bytes  {extra}",
        ms(*time),
        bytes
    );
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut wanted: Option<usize> = None;
    let mut dump: Option<String> = None;
    while let Some(arg) = args.next() {
        if arg == "--n" {
            wanted = args.next().and_then(|n| n.parse().ok());
        } else if arg == "--dump" {
            dump = args.next();
        }
    }
    let (tracks, starts, _) = corpus::load_tracks(CORPUS, 1000);
    let mut library: Vec<(String, Vec<GpsPoint>, Option<i64>)> = tracks
        .iter()
        .map(|(id, points)| (id.clone(), points.clone(), starts.get(id).copied()))
        .collect();
    if let Some(n) = wanted {
        // Copies moved a degree of latitude at a time, so each round lands on its own ground.
        let mut round = 1;
        while library.len() < n {
            for (id, points, start) in tracks
                .iter()
                .map(|(id, p)| (id, p, starts.get(id).copied()))
            {
                if library.len() >= n {
                    break;
                }
                let moved = points
                    .iter()
                    .map(|p| GpsPoint {
                        latitude: p.latitude + round as f64,
                        longitude: p.longitude,
                        elevation: p.elevation,
                    })
                    .collect();
                library.push((format!("{id}-m{round}"), moved, start));
            }
            round += 1;
        }
    }
    let points: usize = library.iter().map(|(_, t, _)| t.len()).sum();
    println!(
        "library: {} activities, {points} track points",
        library.len()
    );

    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("library.db");
    let path = path.to_str().unwrap();
    {
        let mut engine = PersistentEngine::new(path).expect("engine");
        let store = Instant::now();
        for (id, track, start) in &library {
            engine
                .add_activity(id.clone(), track.clone(), "Ride".to_string())
                .expect("add_activity");
            engine
                .update_activity_metadata(id, *start, None, None, None)
                .expect("update_activity_metadata");
        }
        println!("store: {} ms", store.elapsed().as_millis());
        let detect = Instant::now();
        let handle = engine.detect_sections_background();
        let (main, cache) = handle.recv_state_with_cache();
        let WorkerPoll::Ready((sections, processed)) = main else {
            panic!("the cold detect did not finish");
        };
        engine
            .apply_sections_with_cache(sections, cache)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed)
            .expect("processed");
        println!("detect and apply: {} ms", detect.elapsed().as_millis());
        let group = Instant::now();
        let groups = engine.get_groups().len();
        println!("group: {} ms, {groups} groups", group.elapsed().as_millis());
    }
    // Reopened, so the load builds whatever layer a write left owed, as a launch does.
    let _engine = PersistentEngine::new(path).expect("engine");
    let conn = Connection::open(path).expect("open");

    println!();
    println!("whole collection");
    let lines = read(&conn, "geo.routeLines", json!({}));
    let (routes, vertices) = shape(&lines.2);
    row(
        "geo.routeLines",
        &lines,
        &format!("{routes} routes, {vertices} vertices"),
    );
    let sections = read(&conn, "geo.sections", json!({}));
    let (count, vertices) = shape(&sections.2);
    row(
        "geo.sections",
        &sections,
        &format!("{count} sections, {vertices} vertices"),
    );
    if let Some(dir) = &dump {
        std::fs::create_dir_all(dir).expect("dump dir");
        for (name, text) in [("route-lines", &lines.2), ("sections", &sections.2)] {
            let path = format!("{dir}/{name}-{}.geojson", library.len());
            std::fs::write(&path, text["text"].as_str().unwrap_or("")).expect("write dump");
            println!("wrote {path}");
        }
    }
    let screen_ask = |limit: u32| {
        json!({
            "groupLimit": limit, "groupOffset": 0, "sectionLimit": limit, "sectionOffset": 0,
            "minGroupActivityCount": 0, "groupSort": "activities", "groupSearch": "",
            "sectionSort": "visits", "sectionSearch": "",
            "sectionFilters": { "hideCustom": false, "hideAuto": false, "hideDisabled": true, "hideUnaccepted": false },
            "groupSportType": null, "sectionSportType": null
        })
    };
    let page = read(&conn, "routes.screen", screen_ask(50));
    row("routes.screen, page of 50", &page, "");
    let all = read(&conn, "routes.screen", screen_ask(100_000));
    let listed_routes = all.2["groups"].as_array().map_or(0, Vec::len);
    let listed_sections = all.2["sections"].as_array().map_or(0, Vec::len);
    row(
        "routes.screen, every row",
        &all,
        &format!("{listed_routes} routes, {listed_sections} sections listed"),
    );
    let feed = read(
        &conn,
        "feed.page",
        json!({ "offset": 0, "limit": 100_000, "needle": "" }),
    );
    let cards = feed.2["cards"].as_array().map_or(0, Vec::len);
    row("feed.page, every row", &feed, &format!("{cards} cards"));

    // The busiest route and section carry the comparison reads.
    let busiest_route = all.2["groups"]
        .as_array()
        .and_then(|g| g.first())
        .and_then(|g| g["groupId"].as_str().or_else(|| g["id"].as_str()))
        .map(str::to_owned);
    let busiest_section = all.2["sections"]
        .as_array()
        .and_then(|s| s.first())
        .and_then(|s| s["id"].as_str())
        .map(str::to_owned);
    if busiest_route.is_none() || busiest_section.is_none() {
        println!(
            "routes.screen keys: {:?}",
            all.2.as_object().map(|o| o.keys().collect::<Vec<_>>())
        );
        if let Some(g) = all.2["groups"].as_array().and_then(|g| g.first()) {
            println!(
                "first group keys: {:?}",
                g.as_object().map(|o| o.keys().collect::<Vec<_>>())
            );
        }
    }

    println!();
    println!("one route's attempts");
    if let Some(route) = busiest_route {
        let attempts = read(&conn, "route.attempts", json!({ "id": route }));
        let n = attempts.2["performances"].as_array().map_or(0, Vec::len);
        row("route.attempts", &attempts, &format!("{n} attempts"));
        let geo = read(&conn, "geo.routeAttempts", json!({ "groupId": route }));
        let (f, v) = shape(&geo.2);
        row(
            "geo.routeAttempts",
            &geo,
            &format!("{f} features, {v} vertices"),
        );
        let one = read(&conn, "geo.route", json!({ "groupId": route }));
        let (f, v) = shape(&one.2);
        row("geo.route", &one, &format!("{f} features, {v} vertices"));
        let detail = read(&conn, "route.detail", json!({ "id": route }));
        row("route.detail", &detail, "");
        let ids: Vec<String> = attempts.2["performances"]
            .as_array()
            .map(|p| {
                p.iter()
                    .filter_map(|a| a["activityId"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        println!();
        println!("per compared activity (the first stored activity)");
        let first = library.first().map(|(id, _, _)| id.clone());
        let ids: Vec<String> = if ids.is_empty() {
            library
                .iter()
                .take(10)
                .map(|(id, _, _)| id.clone())
                .collect()
        } else {
            ids
        };
        if let Some(id) = first.as_ref() {
            let types = [
                "latlng",
                "altitude",
                "fixed_altitude",
                "heartrate",
                "watts",
                "cadence",
                "velocity_smooth",
                "distance",
                "time",
                "temp",
                "grade_smooth",
                "moving",
            ];
            let streams = read(
                &conn,
                "activity.streams",
                json!({ "id": id, "types": types }),
            );
            let latlng = streams.2["latlng"].as_array().map_or(0, Vec::len);
            row(
                "activity.streams",
                &streams,
                &format!("{latlng} latlng samples"),
            );
            let track = read(&conn, "geo.track", json!({ "activityId": id }));
            let (_, v) = shape(&track.2);
            row("geo.track", &track, &format!("{v} vertices"));
            let summary = read(&conn, "activity.summary", json!({ "id": id }));
            row("activity.summary", &summary, "");
            let detail = read(&conn, "activity.detail", json!({ "id": id }));
            row("activity.detail", &detail, "");
            println!();
            println!(
                "a comparison of N attempts, as the page asks today (streams + summary per id)"
            );
            for n in [2usize, 5, 10] {
                let chosen: Vec<&String> = ids.iter().take(n).collect();
                let at = Instant::now();
                let mut bytes = 0;
                for id in &chosen {
                    let request = json!({ "id": 1, "method": "activity.streams", "params": { "id": id, "types": types } }).to_string();
                    bytes += answer(&conn, &request).len();
                    let request =
                        json!({ "id": 1, "method": "activity.summary", "params": { "id": id } })
                            .to_string();
                    bytes += answer(&conn, &request).len();
                }
                println!(
                    "{:<34} {:>9.2} ms {:>10} bytes  {} calls",
                    format!("compare {} of {}", chosen.len(), ids.len()),
                    ms(at.elapsed()),
                    bytes,
                    chosen.len() * 2
                );
            }
        }
    }

    println!();
    println!("one section's passes");
    if let Some(section) = busiest_section {
        let perf = read(
            &conn,
            "section.performance",
            json!({ "id": section, "timeRangeDays": 3650, "sportFilter": null, "highlightActivityId": null }),
        );
        let laps = perf.2["lapRecords"].as_array().map_or(0, Vec::len);
        row("section.performance", &perf, &format!("{laps} lap records"));
        let passes = read(&conn, "geo.sectionPasses", json!({ "sectionId": section }));
        let (f, v) = shape(&passes.2);
        row(
            "geo.sectionPasses",
            &passes,
            &format!("{f} features, {v} vertices"),
        );
        let detail = read(&conn, "section.detail", json!({ "id": section }));
        row("section.detail", &detail, "");
        let history = read(&conn, "section.history", json!({ "id": section }));
        row("section.history", &history, "");
    }
}
