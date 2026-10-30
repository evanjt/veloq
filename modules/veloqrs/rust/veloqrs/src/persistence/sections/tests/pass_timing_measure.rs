//! Measures what timing a pass between the section's gates leaves untimed,
//! against the sample-snapped timing it replaced, over the local corpora.
//!
//! A measuring instrument, never a gate: it folds each corpus cold the way
//! the bitwise gate does, then times every pass of every section under both
//! rules through the same `time_pass` the engine runs. Nothing here prints a
//! coordinate, an activity id, a section name or a corpus directory name.
//!
//!     cargo test -p veloqrs --release --features real-corpus --lib \
//!         pass_timing_measure -- --nocapture --ignored

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use tracematch::sections::{FrequentSection, GROUND_TOL_M};
use tracematch::{
    GpsPoint, SectionConfig, SectionEvidenceCache, SectionUpdatePolicy,
    sections::detect_sections_incremental_dated,
};

use crate::persistence::sections::lap_timing::{PassSpan, SectionTiming, time_pass};

#[path = "../../../../../tracematch/examples/common/geolife.rs"]
mod geolife;

const METRES_PER_DEGREE: f64 = 111_319.490_793;
const GATE_ARM_M: f64 = 5.0;
const CROSSING_REACH: usize = 8;

struct Corpus {
    label: &'static str,
    tracks: Vec<(String, Vec<GpsPoint>)>,
    sports: HashMap<String, String>,
    fold_sports: HashMap<String, String>,
    starts: HashMap<String, i64>,
    seconds: HashMap<String, Vec<f64>>,
}

fn corpus_root() -> PathBuf {
    match std::env::var("TRACEMATCH_CORPUS") {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tracematch")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(".")),
    }
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

fn epoch_of(date: &str) -> Option<i64> {
    let (y, rest) = date.split_once('-')?;
    let (m, rest) = rest.split_once('-')?;
    let d = rest.get(0..2)?;
    let (y, m, d): (i64, i64, i64) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
    let a = (14 - m) / 12;
    let y2 = y + 4800 - a;
    let m2 = m + 12 * a - 3;
    let jdn = d + (153 * m2 + 2) / 5 + 365 * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045;
    Some((jdn - 2_440_588) * 86_400)
}

fn instant_of(stamp: &str) -> Option<f64> {
    let day = epoch_of(stamp)?;
    let field = |at: usize| -> Option<i64> { stamp.get(at..at + 2)?.parse().ok() };
    let (h, m, s) = (field(11)?, field(14)?, field(17)?);
    Some((day + h * 3600 + m * 60 + s) as f64)
}

/// Points and per-point seconds from a GPX, the corpus loader's rule: the
/// seconds are empty unless every point carries a time.
fn load_gpx(path: &Path) -> (Vec<GpsPoint>, Vec<f64>) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (Vec::new(), Vec::new());
    };
    let mut points = Vec::new();
    let mut times: Vec<Option<f64>> = Vec::new();
    let mut from = 0usize;
    while let Some(hit) = content[from..].find("<trkpt") {
        let start = from + hit;
        let next = content[start + 6..]
            .find("<trkpt")
            .map(|o| start + 6 + o)
            .unwrap_or(content.len());
        let block = &content[start..next];
        from = start + 6;
        let attr = |key: &str| -> Option<f64> {
            let at = block.find(key)? + key.len();
            let close = block[at..].find('"')?;
            block[at..at + close].parse().ok()
        };
        let tag = |key: &str, close: &str| -> Option<&str> {
            let at = block.find(key)? + key.len();
            let end = block[at..].find(close)?;
            Some(&block[at..at + end])
        };
        let (Some(lat), Some(lon)) = (attr("lat=\""), attr("lon=\"")) else {
            continue;
        };
        match tag("<ele>", "</ele>").and_then(|e| e.trim().parse().ok()) {
            Some(ele) => points.push(GpsPoint::with_elevation(lat, lon, ele)),
            None => points.push(GpsPoint::new(lat, lon)),
        }
        times.push(tag("<time>", "</time>").and_then(instant_of));
    }
    let seconds = match times.first().copied().flatten() {
        Some(first) if times.iter().all(Option::is_some) => {
            times.into_iter().flatten().map(|t| t - first).collect()
        }
        _ => Vec::new(),
    };
    (points, seconds)
}

/// The private corpus as the bitwise gate folds it: every track under one
/// sport, dated from the metadata. The per-activity sport is read beside it
/// for the per-sport tables.
fn load_private(name: &str) -> Corpus {
    let dir = corpus_root().join(name);
    assert!(dir.is_dir(), "corpus directory missing");
    let meta: serde_json::Value = std::fs::read_to_string(dir.join("_meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    let mut tracks = Vec::new();
    let mut seconds = HashMap::new();
    let mut sports = HashMap::new();
    let mut fold_sports = HashMap::new();
    let mut starts = HashMap::new();
    for path in gpx_paths(&dir) {
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .split('_')
            .next()
            .unwrap_or_default()
            .to_string();
        let (pts, secs) = load_gpx(&path);
        if pts.len() < 2 {
            continue;
        }
        if secs.len() == pts.len() {
            seconds.insert(id.clone(), secs);
        }
        let m = &meta[&id];
        sports.insert(
            id.clone(),
            m["type"].as_str().unwrap_or("Unknown").to_string(),
        );
        fold_sports.insert(id.clone(), "All".to_string());
        if let Some(e) = m["date"].as_str().and_then(epoch_of) {
            starts.insert(id.clone(), e);
        }
        tracks.push((id, pts));
    }
    assert!(tracks.len() >= 1000, "short private corpus");
    Corpus {
        label: "private",
        tracks,
        sports,
        fold_sports,
        starts,
        seconds,
    }
}

/// GeoLife as the public gate folds it: the busiest logger, in date order.
fn load_geolife() -> Corpus {
    let root = std::env::var("LAB_GEOLIFE_DIR")
        .ok()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| corpus_root().join("geolife/Geolife Trajectories 1.3/Data"));
    assert!(root.is_dir(), "GeoLife directory missing");
    let (trajectories, stats) = geolife::load_geolife(&root, 200, 120);
    assert!(stats.users_loaded > 0);
    let user_of = |id: &str| {
        id.split_once('_')
            .map(|(u, _)| u.to_string())
            .unwrap_or_default()
    };
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for t in &trajectories {
        *counts.entry(user_of(&t.id)).or_default() += 1;
    }
    let busiest = counts
        .iter()
        .max_by_key(|(user, n)| (**n, std::cmp::Reverse((*user).clone())))
        .map(|(user, _)| user.clone())
        .expect("one user");
    let mut mine: Vec<_> = trajectories
        .into_iter()
        .filter(|t| user_of(&t.id) == busiest)
        .collect();
    mine.sort_by(|a, b| a.date.cmp(&b.date).then(a.id.cmp(&b.id)));
    let sports: HashMap<String, String> = mine
        .iter()
        .map(|t| (t.id.clone(), t.sport.clone()))
        .collect();
    let starts = mine
        .iter()
        .filter_map(|t| epoch_of(&t.date).map(|d| (t.id.clone(), d)))
        .collect();
    let seconds = mine
        .iter()
        .filter(|t| t.seconds.len() == t.points.len())
        .map(|t| (t.id.clone(), t.seconds.clone()))
        .collect();
    let tracks = mine.into_iter().map(|t| (t.id, t.points)).collect();
    Corpus {
        label: "geolife",
        tracks,
        fold_sports: sports.clone(),
        sports,
        starts,
        seconds,
    }
}

fn fold(c: &Corpus) -> Vec<FrequentSection> {
    let ids: Vec<&str> = c.tracks.iter().map(|(id, _)| id.as_str()).collect();
    let seconds: Vec<&[f64]> = c
        .tracks
        .iter()
        .map(|(id, _)| c.seconds.get(id).map_or(&[][..], |s| s.as_slice()))
        .collect();
    detect_sections_incremental_dated(
        &mut SectionEvidenceCache::new(),
        &[],
        &c.tracks,
        &ids,
        &seconds,
        &c.fold_sports,
        &c.starts,
        &SectionConfig::default(),
        &SectionUpdatePolicy::default(),
    )
    .catalogue
}

// --- The gate geometry, repeated here so a missing crossing can be attributed
// to its gate without opening the module under measurement. ---

#[derive(Clone, Copy)]
struct Gate {
    origin: GpsPoint,
    heading: (f64, f64),
}

fn local_offset(origin: &GpsPoint, point: &GpsPoint) -> (f64, f64) {
    let east = (point.longitude - origin.longitude)
        * METRES_PER_DEGREE
        * origin.latitude.to_radians().cos();
    let north = (point.latitude - origin.latitude) * METRES_PER_DEGREE;
    (east, north)
}

fn local_distance(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let (e, n) = local_offset(a, b);
    e.hypot(n)
}

fn unit(from: &GpsPoint, to: &GpsPoint) -> Option<(f64, f64)> {
    let (e, n) = local_offset(from, to);
    let l = e.hypot(n);
    (l > 0.0).then(|| (e / l, n / l))
}

impl Gate {
    fn side(&self, p: &GpsPoint) -> f64 {
        let (e, n) = local_offset(&self.origin, p);
        e * self.heading.0 + n * self.heading.1
    }
    fn across(&self, from: &GpsPoint, to: &GpsPoint, f: f64) -> f64 {
        let (e0, n0) = local_offset(&self.origin, from);
        let (e1, n1) = local_offset(&self.origin, to);
        let e = e0 + f * (e1 - e0);
        let n = n0 + f * (n1 - n0);
        -e * self.heading.1 + n * self.heading.0
    }
    fn reversed(&self) -> Self {
        Self {
            origin: self.origin,
            heading: (-self.heading.0, -self.heading.1),
        }
    }
}

fn gates(line: &[GpsPoint]) -> Option<(Gate, Gate)> {
    let first = line.first()?;
    let last = line.last()?;
    let toward_start = line
        .iter()
        .find(|p| local_distance(first, p) >= GATE_ARM_M)?;
    let toward_end = line
        .iter()
        .rev()
        .find(|p| local_distance(last, p) >= GATE_ARM_M)?;
    Some((
        Gate {
            origin: *first,
            heading: unit(first, toward_start)?,
        },
        Gate {
            origin: *last,
            heading: unit(toward_end, last)?,
        },
    ))
}

/// Whether a crossing of `gate` is found within reach of sample `near`, and
/// whether one is found anywhere in the pass with any ground offset: the
/// second tells a crossing beyond reach from one beside the line.
fn crossing(track: &[GpsPoint], gate: &Gate, near: usize) -> (bool, bool) {
    let from = near.saturating_sub(CROSSING_REACH);
    let to = (near + CROSSING_REACH).min(track.len() - 1);
    let mut in_reach = false;
    let mut off_ground = false;
    for k in from..to {
        let before = gate.side(&track[k]);
        let after = gate.side(&track[k + 1]);
        if !(before <= 0.0 && after >= 0.0 && before < after) {
            continue;
        }
        let f = -before / (after - before);
        if gate.across(&track[k], &track[k + 1], f).abs() > GROUND_TOL_M {
            off_ground = true;
        } else {
            in_reach = true;
        }
    }
    (in_reach, off_ground)
}

/// How far, in samples, from `near` the nearest on-ground crossing of `gate`
/// lies anywhere in `lo..=hi`, or `None` when the pass never crosses it.
fn crossing_anywhere(
    track: &[GpsPoint],
    gate: &Gate,
    near: usize,
    lo: usize,
    hi: usize,
) -> Option<usize> {
    let hi = hi.min(track.len() - 1);
    let mut best: Option<usize> = None;
    for k in lo..hi {
        let before = gate.side(&track[k]);
        let after = gate.side(&track[k + 1]);
        if !(before <= 0.0 && after >= 0.0 && before < after) {
            continue;
        }
        let f = -before / (after - before);
        if gate.across(&track[k], &track[k + 1], f).abs() > GROUND_TOL_M {
            continue;
        }
        let gap = k.abs_diff(near);
        if best.is_none_or(|b| gap < b) {
            best = Some(gap);
        }
    }
    best
}

/// The heading of `line` over its first `arm` metres, from its first point.
fn heading_over(line: &[GpsPoint], arm: f64) -> Option<(f64, f64)> {
    let first = line.first()?;
    let toward = line.iter().find(|p| local_distance(first, p) >= arm)?;
    unit(first, toward)
}

fn degrees_between(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 * b.0 + a.1 * b.1).clamp(-1.0, 1.0).acos().to_degrees()
}

#[derive(Default)]
struct Diag {
    /// Samples from the trimmed end to the nearest crossing, for a gate the
    /// reach missed: 9-16, 17-32, 33-64, over 64, none in the whole pass.
    gap_9_16: usize,
    gap_17_32: usize,
    gap_33_64: usize,
    gap_over_64: usize,
    gap_none: usize,
    /// Deep misses whose depth is most of the section: a flipped direction.
    deep_flipped: usize,
    deep_other: usize,
    /// Untimed passes whose movement disagrees with the stored direction.
    direction_disagrees: usize,
    /// Sections whose 5 m gate heading is over 30 degrees off the 30 m one.
    skewed_start: usize,
    skewed_end: usize,
    /// Sections whose polyline runs under 30 m from an end before turning.
    sections: usize,
}

#[derive(Default, Clone)]
struct Cell {
    passes: usize,
    detector_partial: usize,
    v1_timed: usize,
    v2_timed: usize,
    both: usize,
    /// v2 untimed, by what failed at the gate it failed at.
    entry_near: usize,
    entry_deep: usize,
    entry_reach: usize,
    entry_off_ground: usize,
    exit_near: usize,
    exit_deep: usize,
    exit_reach: usize,
    exit_off_ground: usize,
    both_gates: usize,
    /// Metres the pass starts inside, or stops short of, a gate it missed.
    inside_m: Vec<f64>,
    diff: Vec<f64>,
    rel: Vec<f64>,
}

fn quantile(v: &mut [f64], q: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    let i = ((v.len() - 1) as f64 * q).round() as usize;
    v[i]
}

fn interval_bucket(secs: &[f64]) -> &'static str {
    let mut dts: Vec<f64> = secs.windows(2).map(|w| w[1] - w[0]).collect();
    let median = quantile(&mut dts, 0.5);
    if median <= 1.5 {
        "1 s"
    } else if median <= 5.5 {
        "2-5 s"
    } else {
        ">5 s"
    }
}

fn measure(c: &Corpus) {
    let t = std::time::Instant::now();
    let catalogue = fold(c);
    println!(
        "\n== {} corpus: {} tracks, {} with seconds, {} sections, fold {} ms",
        c.label,
        c.tracks.len(),
        c.seconds.len(),
        catalogue.len(),
        t.elapsed().as_millis()
    );
    let by_id: HashMap<&str, &[GpsPoint]> = c
        .tracks
        .iter()
        .map(|(id, p)| (id.as_str(), p.as_slice()))
        .collect();
    let u32_times: HashMap<&str, Vec<u32>> = c
        .seconds
        .iter()
        .map(|(id, s)| (id.as_str(), s.iter().map(|x| x.round() as u32).collect()))
        .collect();
    let bucket_of: HashMap<&str, &'static str> = c
        .seconds
        .iter()
        .map(|(id, s)| (id.as_str(), interval_bucket(s)))
        .collect();

    let mut cells: BTreeMap<(String, &'static str), Cell> = BTreeMap::new();
    let mut no_gates = 0usize;
    let mut sections_sport_set_changed = 0usize;
    let mut sections_count_changed = 0usize;
    let mut sections_lost_all = 0usize;
    let mut sections_lost_half = 0usize;
    let mut sections_with_passes = 0usize;
    let mut lost_per_section: Vec<f64> = Vec::new();
    let mut diag = Diag::default();

    for s in &catalogue {
        let timing = SectionTiming::from_line(&s.polyline, s.distance_meters);
        let gate_pair = gates(&s.polyline);
        if timing.is_none() {
            no_gates += 1;
        }
        diag.sections += 1;
        if let (Some(short), Some(long)) = (
            heading_over(&s.polyline, GATE_ARM_M),
            heading_over(&s.polyline, 30.0),
        ) && degrees_between(short, long) > 30.0
        {
            diag.skewed_start += 1;
        }
        let rev: Vec<GpsPoint> = s.polyline.iter().rev().copied().collect();
        if let (Some(short), Some(long)) =
            (heading_over(&rev, GATE_ARM_M), heading_over(&rev, 30.0))
            && degrees_between(short, long) > 30.0
        {
            diag.skewed_end += 1;
        }
        let mut v1_sports: BTreeMap<&str, usize> = BTreeMap::new();
        let mut v2_sports: BTreeMap<&str, usize> = BTreeMap::new();
        let mut any = false;
        for p in &s.activity_portions {
            let Some(track) = by_id.get(p.activity_id.as_str()) else {
                continue;
            };
            let sport = c
                .sports
                .get(&p.activity_id)
                .map_or("Unknown", String::as_str);
            let bucket = bucket_of
                .get(p.activity_id.as_str())
                .copied()
                .unwrap_or("untimed");
            let cell = cells.entry((sport.to_string(), bucket)).or_default();
            let direction = p.direction.as_str();
            if direction == "partial" {
                cell.detector_partial += 1;
                continue;
            }
            any = true;
            cell.passes += 1;
            let Some(times) = u32_times.get(p.activity_id.as_str()) else {
                continue;
            };
            if times.len() != track.len() {
                continue;
            }
            let span = PassSpan {
                direction,
                start_index: p.start_index,
                end_index: p.end_index,
                distance_meters: p.distance_meters,
            };
            let first = p.start_index as usize;
            let last = p.end_index as usize - 1;
            if last <= first || last >= times.len() {
                continue;
            }
            let v1 = {
                let e = (f64::from(times[last]) - f64::from(times[first])).abs();
                (e > 0.0).then_some(e)
            };
            let v2 = time_pass(Some(times), Some(track), timing.as_ref(), &span).0;
            if v1.is_some() {
                cell.v1_timed += 1;
                *v1_sports.entry(sport).or_default() += 1;
            }
            if v2.is_some() {
                cell.v2_timed += 1;
                *v2_sports.entry(sport).or_default() += 1;
            }
            match (v1, v2) {
                (Some(a), Some(b)) => {
                    cell.both += 1;
                    cell.diff.push(b - a);
                    cell.rel.push((b - a) / a);
                }
                (Some(_), None) => {
                    let Some((start, end)) = gate_pair else {
                        continue;
                    };
                    let (entry, exit) = if direction == "reverse" {
                        (end.reversed(), start.reversed())
                    } else {
                        (start, end)
                    };
                    let (entry_ok, entry_off) = crossing(track, &entry, first);
                    let (exit_ok, exit_off) = crossing(track, &exit, last);
                    if !entry_ok && !exit_ok {
                        cell.both_gates += 1;
                    }
                    {
                        let moved = unit(&track[first], &track[last]);
                        let drawn = unit(&s.polyline[0], &s.polyline[s.polyline.len() - 1]);
                        if let (Some(m), Some(d)) = (moved, drawn) {
                            let along = m.0 * d.0 + m.1 * d.1;
                            let agrees = if direction == "reverse" {
                                along < 0.0
                            } else {
                                along > 0.0
                            };
                            if !agrees {
                                diag.direction_disagrees += 1;
                            }
                        }
                    }
                    let mut note_gap = |gate: &Gate, near: usize| match crossing_anywhere(
                        track,
                        gate,
                        near,
                        first.saturating_sub(64),
                        last + 64,
                    ) {
                        None => diag.gap_none += 1,
                        Some(g) if g <= 16 => diag.gap_9_16 += 1,
                        Some(g) if g <= 32 => diag.gap_17_32 += 1,
                        Some(g) if g <= 64 => diag.gap_33_64 += 1,
                        Some(_) => diag.gap_over_64 += 1,
                    };
                    let mut note_deep = |depth: f64| {
                        if depth > 0.8 * s.distance_meters {
                            diag.deep_flipped += 1;
                        } else {
                            diag.deep_other += 1;
                        }
                    };
                    if !entry_ok {
                        let inside = entry.side(&track[first]);
                        if inside > 0.0 {
                            cell.inside_m.push(inside);
                            if inside <= GROUND_TOL_M {
                                cell.entry_near += 1;
                            } else {
                                cell.entry_deep += 1;
                                note_deep(inside);
                            }
                        } else if entry_off {
                            cell.entry_off_ground += 1;
                        } else {
                            cell.entry_reach += 1;
                            note_gap(&entry, first);
                        }
                    }
                    if !exit_ok {
                        let short = -exit.side(&track[last]);
                        if short > 0.0 {
                            cell.inside_m.push(short);
                            if short <= GROUND_TOL_M {
                                cell.exit_near += 1;
                            } else {
                                cell.exit_deep += 1;
                                note_deep(short);
                            }
                        } else if exit_off {
                            cell.exit_off_ground += 1;
                        } else {
                            cell.exit_reach += 1;
                            note_gap(&exit, last);
                        }
                    }
                }
                _ => {}
            }
        }
        if !any {
            continue;
        }
        sections_with_passes += 1;
        let v1_total: usize = v1_sports.values().sum();
        let v2_total: usize = v2_sports.values().sum();
        if v1_sports.keys().collect::<Vec<_>>() != v2_sports.keys().collect::<Vec<_>>() {
            sections_sport_set_changed += 1;
        }
        if v1_total != v2_total {
            sections_count_changed += 1;
        }
        if v1_total > 0 && v2_total == 0 {
            sections_lost_all += 1;
        }
        if v1_total > 0 && v2_total * 2 < v1_total {
            sections_lost_half += 1;
        }
        if v1_total > 0 {
            lost_per_section.push((v1_total - v2_total.min(v1_total)) as f64 / v1_total as f64);
        }
    }

    println!("sections with no usable gates: {no_gates}");
    println!(
        "sport  interval  passes  det.partial  v1_timed  v2_timed  both  | v2 untimed: entry near/deep/reach/offground  exit near/deep/reach/offground  both_gates | inside_m p50/p95 | v2-v1 s p50/p95abs | rel p50/p95abs"
    );
    let mut total = Cell::default();
    for ((sport, bucket), cell) in &mut cells {
        let mut c = cell.clone();
        total.passes += c.passes;
        total.detector_partial += c.detector_partial;
        total.v1_timed += c.v1_timed;
        total.v2_timed += c.v2_timed;
        total.both += c.both;
        total.entry_near += c.entry_near;
        total.entry_deep += c.entry_deep;
        total.entry_reach += c.entry_reach;
        total.entry_off_ground += c.entry_off_ground;
        total.exit_near += c.exit_near;
        total.exit_deep += c.exit_deep;
        total.exit_reach += c.exit_reach;
        total.exit_off_ground += c.exit_off_ground;
        total.both_gates += c.both_gates;
        total.inside_m.extend(c.inside_m.iter().copied());
        total.diff.extend(c.diff.iter().copied());
        total.rel.extend(c.rel.iter().copied());
        print_cell(sport, bucket, &mut c);
    }
    print_cell("ALL", "all", &mut total);
    println!(
        "sections: {} with full passes, {} whose timed-sport set changes, {} whose timed count changes, {} losing every timed pass, {} losing more than half; share of v1-timed passes lost per section p50 {:.3} p90 {:.3}",
        sections_with_passes,
        sections_sport_set_changed,
        sections_count_changed,
        sections_lost_all,
        sections_lost_half,
        quantile(&mut lost_per_section.clone(), 0.5),
        quantile(&mut lost_per_section, 0.9),
    );
    println!(
        "untimed diagnostics: reach misses by samples to the nearest crossing 9-16 {} / 17-32 {} / 33-64 {} / over 64 {} / none {}; deep misses flipped {} other {}; untimed passes whose movement disagrees with the stored direction {}; sections {} with a 5 m start heading over 30 deg off the 30 m one {} and end {}",
        diag.gap_9_16,
        diag.gap_17_32,
        diag.gap_33_64,
        diag.gap_over_64,
        diag.gap_none,
        diag.deep_flipped,
        diag.deep_other,
        diag.direction_disagrees,
        diag.sections,
        diag.skewed_start,
        diag.skewed_end,
    );
}

fn print_cell(sport: &str, bucket: &str, c: &mut Cell) {
    let mut abs_diff: Vec<f64> = c.diff.iter().map(|d| d.abs()).collect();
    let mut abs_rel: Vec<f64> = c.rel.iter().map(|d| d.abs()).collect();
    println!(
        "{sport:<8} {bucket:<8} {:>6} {:>6} {:>8} {:>8} {:>6} | {:>4}/{:>4}/{:>4}/{:>4}  {:>4}/{:>4}/{:>4}/{:>4}  {:>4} | {:>6.1}/{:>6.1} | {:>+6.2}/{:>6.2} | {:>+6.3}/{:>6.3}",
        c.passes,
        c.detector_partial,
        c.v1_timed,
        c.v2_timed,
        c.both,
        c.entry_near,
        c.entry_deep,
        c.entry_reach,
        c.entry_off_ground,
        c.exit_near,
        c.exit_deep,
        c.exit_reach,
        c.exit_off_ground,
        c.both_gates,
        quantile(&mut c.inside_m, 0.5),
        quantile(&mut c.inside_m, 0.95),
        quantile(&mut c.diff, 0.5),
        quantile(&mut abs_diff, 0.95),
        quantile(&mut c.rel, 0.5),
        quantile(&mut abs_rel, 0.95),
    );
}

#[test]
#[ignore = "measurement over the local corpora"]
fn gate_timing_against_snapped_timing() {
    measure(&load_private("fullcorpus"));
    measure(&load_geolife());
}
