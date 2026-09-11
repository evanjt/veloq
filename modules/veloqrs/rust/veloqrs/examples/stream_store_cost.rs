//! What the quantised stream store costs per activity, measured on a real
//! library rather than estimated from the raw payload size.
//!
//! Reads a directory of `streams.json` bodies as the sync requests them, one
//! file per activity named `<id>.json`, and the athlete's activity list from
//! `/athlete/{id}/activities`. Every body is packed exactly as
//! `store_activity_streams` packs it, and the bytes are reported by series,
//! by sport, by duration and against the retention window. It needs a private
//! download that is not in the repo, so it is a diagnostic binary rather than
//! a test.
//!
//! Usage:
//!   VELOQ_STREAMS=/dir/of/bodies VELOQ_ACTIVITIES=/path/activities.json \
//!     cargo run -p veloqrs --example stream_store_cost
//!
//! Optional:
//!   VELOQ_WIRE=/path/wire.txt   "<id> <bytes on the wire>" per line, for the
//!                               download half of the question
//!   VELOQ_DB=/path/routes.db    a database whose `activities` ids pick a subset
//!                               to report on its own

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::Deserialize;
use veloqrs::net::types::StreamDto;
use veloqrs::persistence::streams::pack_activity_streams;

#[derive(Deserialize)]
struct Activity {
    id: String,
    #[serde(rename = "type")]
    sport: Option<String>,
    start_date: Option<String>,
    elapsed_time: Option<f64>,
}

struct Measured {
    id: String,
    sport: String,
    days_ago: Option<f64>,
    hours: f64,
    packed: usize,
    json: usize,
    wire: Option<usize>,
    by_kind: Vec<(String, usize, usize)>,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn days_since(start: &str) -> Option<f64> {
    let parsed = chrono::NaiveDateTime::parse_from_str(start, "%Y-%m-%dT%H:%M:%SZ").ok()?;
    let age = chrono::Utc::now().naive_utc() - parsed;
    Some(age.num_seconds() as f64 / 86_400.0)
}

fn load_wire(path: &str) -> HashMap<String, usize> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.to_string(), it.next()?.parse().ok()?))
        })
        .collect()
}

fn load_subset(path: &str) -> HashSet<String> {
    let Ok(db) =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return HashSet::new();
    };
    let Ok(mut stmt) = db.prepare("SELECT id FROM activities") else {
        return HashSet::new();
    };
    stmt.query_map([], |r| r.get::<_, String>(0))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

fn measure(dir: &Path, acts: &[Activity], wire: &HashMap<String, usize>) -> Vec<Measured> {
    let mut out = Vec::new();
    for a in acts {
        let path = dir.join(format!("{}.json", a.id));
        let Ok(body) = fs::read(&path) else {
            continue;
        };
        let Ok(raw) = serde_json::from_slice::<Vec<StreamDto>>(&body) else {
            eprintln!("{}: body did not parse", a.id);
            continue;
        };
        let packed = pack_activity_streams(&raw);
        out.push(Measured {
            id: a.id.clone(),
            sport: a.sport.clone().unwrap_or_else(|| "Unknown".into()),
            days_ago: a.start_date.as_deref().and_then(days_since),
            hours: a.elapsed_time.unwrap_or(0.0) / 3600.0,
            packed: packed.iter().map(|(_, b, _)| b.len()).sum(),
            json: body.len(),
            wire: wire.get(&a.id).copied(),
            by_kind: packed
                .into_iter()
                .map(|(k, b, n)| (k.to_string(), b.len(), n))
                .collect(),
        });
    }
    out
}

fn kb(bytes: usize) -> String {
    format!("{:.1} KB", bytes as f64 / 1024.0)
}

fn mb(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

fn median(values: &mut [usize]) -> usize {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

fn summary(label: &str, rows: &[&Measured]) {
    let n = rows.len();
    if n == 0 {
        return;
    }
    let packed: usize = rows.iter().map(|m| m.packed).sum();
    let json: usize = rows.iter().map(|m| m.json).sum();
    let hours: f64 = rows.iter().map(|m| m.hours).sum();
    let mut each: Vec<usize> = rows.iter().map(|m| m.packed).collect();
    let per_hour = if hours > 0.0 {
        packed as f64 / hours / 1024.0
    } else {
        0.0
    };
    println!(
        "{:<18} {:>5}  packed {:>9}  mean {:>9}  median {:>9}  {:>7.1} KB/h  raw json {:>9}  ratio {:>5.1}x",
        label,
        n,
        mb(packed),
        kb(packed / n),
        kb(median(&mut each)),
        per_hour,
        mb(json),
        json as f64 / packed.max(1) as f64
    );
}

fn duration_bucket(hours: f64) -> &'static str {
    match hours {
        h if h < 0.5 => "under 30 min",
        h if h < 1.0 => "30 to 60 min",
        h if h < 2.0 => "1 to 2 h",
        h if h < 4.0 => "2 to 4 h",
        _ => "over 4 h",
    }
}

fn main() {
    let dir = env("VELOQ_STREAMS").expect("VELOQ_STREAMS names the directory of bodies");
    let acts_path = env("VELOQ_ACTIVITIES").expect("VELOQ_ACTIVITIES names the activity list");
    let acts: Vec<Activity> =
        serde_json::from_slice(&fs::read(&acts_path).expect("activity list readable"))
            .expect("activity list parses");
    let wire = env("VELOQ_WIRE").map(|p| load_wire(&p)).unwrap_or_default();
    let subset = env("VELOQ_DB").map(|p| load_subset(&p)).unwrap_or_default();

    let measured = measure(Path::new(&dir), &acts, &wire);
    println!(
        "{} activities listed, {} bodies measured\n",
        acts.len(),
        measured.len()
    );

    let all: Vec<&Measured> = measured.iter().collect();
    println!("By sport");
    let mut sports: BTreeMap<&str, Vec<&Measured>> = BTreeMap::new();
    for m in &measured {
        sports.entry(m.sport.as_str()).or_default().push(m);
    }
    let mut ordered: Vec<_> = sports.into_iter().collect();
    ordered.sort_by_key(|(_, v)| std::cmp::Reverse(v.len()));
    for (sport, rows) in &ordered {
        summary(sport, rows);
    }
    summary("all", &all);

    println!("\nBy duration");
    for bucket in [
        "under 30 min",
        "30 to 60 min",
        "1 to 2 h",
        "2 to 4 h",
        "over 4 h",
    ] {
        let rows: Vec<&Measured> = measured
            .iter()
            .filter(|m| duration_bucket(m.hours) == bucket)
            .collect();
        summary(bucket, &rows);
    }

    println!("\nBy series");
    let mut kinds: BTreeMap<&str, (usize, usize, usize)> = BTreeMap::new();
    for m in &measured {
        for (k, bytes, samples) in &m.by_kind {
            let e = kinds.entry(k.as_str()).or_default();
            e.0 += 1;
            e.1 += bytes;
            e.2 += samples;
        }
    }
    for (kind, (n, bytes, samples)) in &kinds {
        println!(
            "{:<18} {:>5} activities  {:>9}  {:>5.2} bytes/sample  {:>8.1} KB mean",
            kind,
            n,
            mb(*bytes),
            *bytes as f64 / (*samples).max(1) as f64,
            *bytes as f64 / *n as f64 / 1024.0
        );
    }

    println!("\nAgainst the retention window");
    for days in [90.0, 365.0, 730.0] {
        let rows: Vec<&Measured> = measured
            .iter()
            .filter(|m| m.days_ago.is_some_and(|d| d <= days))
            .collect();
        summary(&format!("last {} days", days), &rows);
    }
    let undated: Vec<&Measured> = measured.iter().filter(|m| m.days_ago.is_none()).collect();
    summary("undated", &undated);

    if !subset.is_empty() {
        println!("\nSubset from VELOQ_DB");
        let rows: Vec<&Measured> = measured.iter().filter(|m| subset.contains(&m.id)).collect();
        summary("corpus", &rows);
    }

    if !wire.is_empty() {
        let on_wire: usize = measured.iter().filter_map(|m| m.wire).sum();
        let counted = measured.iter().filter(|m| m.wire.is_some()).count();
        println!(
            "\nDownload: {} bodies, {} on the wire gzipped, {} as JSON, {} per body on the wire",
            counted,
            mb(on_wire),
            mb(measured
                .iter()
                .filter(|m| m.wire.is_some())
                .map(|m| m.json)
                .sum()),
            kb(on_wire / counted.max(1))
        );
    }
}
