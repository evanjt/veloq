//! The guide payload: one read of what a watch needs to guide a rider over one section or route.
//!
//! The record carries the id, name, sport, start, length, elevation gain, best time and date, the
//! best pass's splits at each tenth of the length, and the line after Douglas-Peucker at a metre
//! tolerance, each kept vertex with its own elevation. The per-transport encoding is the
//! transport's job.
//!
//! Sizes measured from real streams, at a 5 m tolerance, with ten splits: a 3 km run section
//! kept 28 points and a 3 km ride section 43, both under 2 KB as keyed JSON; a 15 km ride section
//! kept 122 points in 5.2 KB keyed, 2.9 KB packed and 736 B as delta binary. At 2 m the 3 km run
//! kept 55 points (2.4 KB keyed) and the 15 km ride 223 (9.3 KB keyed).

use rusqlite::Connection;

use crate::GpsPoint;
use crate::persistence::line_simplify::{Metres, simplify_indices};
use crate::persistence::nearby_routes::pooled::{route_figures, section_figures};
use crate::persistence::nearby_routes::{METRES_PER_DEGREE, NearbyKind};
use crate::persistence::{routes::pooled as routes, sections::geometry};

/// A vertex of the guide line with the elevation stored for it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidePoint {
    pub latitude: f64,
    pub longitude: f64,
    pub elevation: Option<f64>,
}

/// What a watch guides a rider with.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidePayload {
    pub kind: NearbyKind,
    pub id: String,
    pub name: String,
    pub sport_type: String,
    pub start: GuidePoint,
    pub distance_meters: f64,
    pub elevation_gain_meters: Option<f64>,
    pub best_time_seconds: Option<u32>,
    pub best_date: Option<crate::WholeNumber>,
    /// Seconds spent in each tenth of the length by the best pass, summing to the best time.
    /// Empty when there is no timed pass or its time stream is not held.
    pub splits: Vec<u32>,
    pub line: Vec<GuidePoint>,
}

/// The number of splits: one per tenth of the length.
const SPLIT_COUNT: usize = 10;

/// The line tolerance a watch send uses, in metres.
pub const WATCH_TOLERANCE_M: f64 = 5.0;

/// The guide payload of the section or route `id` as JSON text, simplified to the watch tolerance.
/// `None` when it is gone or has no line.
pub fn guide_payload_json(conn: &Connection, kind: NearbyKind, id: &str) -> Option<String> {
    let payload = guide_payload(conn, kind, id, WATCH_TOLERANCE_M)?;
    serde_json::to_string(&payload).ok()
}

/// The guide payload of the section or route `id`, its line simplified to `tolerance_m` metres.
/// `None` when it is gone or has no line.
pub fn guide_payload(
    conn: &Connection,
    kind: NearbyKind,
    id: &str,
    tolerance_m: f64,
) -> Option<GuidePayload> {
    let (name, sport_type, figures, line, best_pass) = match kind {
        NearbyKind::Section => {
            let (name, sport_type, line) = section_identity(conn, id)?;
            let figures = section_figures(conn, id, None)?;
            let pass = figures
                .best_activity_id
                .as_deref()
                .and_then(|activity| section_best_pass(conn, id, activity));
            (name, sport_type, figures, line, pass)
        }
        NearbyKind::Route => {
            let group = routes::group_by_id(conn, id)?;
            let figures = route_figures(conn, id, None)?;
            let line = geometry::stream(conn, &group.representative_id)?;
            let pass = figures
                .best_activity_id
                .as_deref()
                .map(|activity| (activity.to_string(), None));
            let name = group.custom_name.unwrap_or_else(|| id.to_string());
            let sport_type = figures.sport_types.first().cloned().unwrap_or_default();
            (name, sport_type, figures, line, pass)
        }
    };
    let first = line.first()?;
    if line.len() < 2 {
        return None;
    }
    let simplified = simplified_line(&line, tolerance_m);
    let splits = match (&best_pass, figures.best) {
        (Some((activity, range)), Some((best_seconds, _))) => {
            splits(conn, activity, *range, best_seconds)
        }
        _ => Vec::new(),
    };
    Some(GuidePayload {
        kind,
        id: id.to_string(),
        name,
        sport_type,
        start: point(first),
        distance_meters: figures.distance_meters,
        elevation_gain_meters: figures.elevation_gain_meters,
        best_time_seconds: figures.best.map(|b| b.0),
        best_date: figures.best.map(|b| b.1.into()),
        splits,
        line: simplified,
    })
}

fn point(p: &GpsPoint) -> GuidePoint {
    GuidePoint {
        latitude: p.latitude,
        longitude: p.longitude,
        elevation: p.elevation,
    }
}

/// `line` after Douglas-Peucker at `tolerance_m`, each kept vertex with its own elevation.
fn simplified_line(line: &[GpsPoint], tolerance_m: f64) -> Vec<GuidePoint> {
    let metres = laid_out(line);
    simplify_indices(&metres, tolerance_m)
        .into_iter()
        .map(|index| point(&line[index]))
        .collect()
}

/// The points in metres east and north of the first, on a local flat plane.
fn laid_out(points: &[GpsPoint]) -> Vec<Metres> {
    let Some(origin) = points.first() else {
        return Vec::new();
    };
    let lng_scale = METRES_PER_DEGREE * origin.latitude.to_radians().cos();
    points
        .iter()
        .map(|p| {
            [
                (p.longitude - origin.longitude) * lng_scale,
                (p.latitude - origin.latitude) * METRES_PER_DEGREE,
            ]
        })
        .collect()
}

/// A section's name, sport and line.
fn section_identity(conn: &Connection, id: &str) -> Option<(String, String, Vec<GpsPoint>)> {
    let (name, sport_type, blob, json, rep, rep_start, rep_end, rep_reversed) = conn
        .query_row(
            "SELECT name, sport_type, polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index, rep_reversed
             FROM sections WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<u32>>(5)?,
                    row.get::<_, Option<u32>>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            },
        )
        .ok()?;
    let line = geometry::line(
        conn,
        blob.as_deref(),
        json.as_deref(),
        geometry::reference(rep.as_deref(), rep_start, rep_end, rep_reversed),
    )
    .ok()?;
    Some((name.unwrap_or_else(|| id.to_string()), sport_type, line))
}

/// The best pass of a section by `activity`: the activity and the half-open sample range of it.
fn section_best_pass(
    conn: &Connection,
    section_id: &str,
    activity: &str,
) -> Option<(String, Option<(usize, usize)>)> {
    let range = crate::persistence::records::record_eligible_passes(conn, section_id)
        .into_iter()
        .filter(|pass| pass.activity_id == activity)
        .min_by(|a, b| a.time.total_cmp(&b.time))
        .map(|pass| (pass.start_index, pass.end_index))?;
    Some((activity.to_string(), Some(range)))
}

/// The seconds the activity spent in each tenth of the ground over `range` of its samples (all of
/// them when `None`), scaled so they sum to `best_seconds`. Empty when the activity has no track
/// or time stream, or the two differ in length, or the range covers no ground.
fn splits(
    conn: &Connection,
    activity: &str,
    range: Option<(usize, usize)>,
    best_seconds: u32,
) -> Vec<u32> {
    let Some(track) = geometry::stream(conn, activity) else {
        return Vec::new();
    };
    let Some(times) = time_stream(conn, activity) else {
        return Vec::new();
    };
    if track.len() != times.len() {
        return Vec::new();
    }
    let (from, to) = range.unwrap_or((0, track.len()));
    if to > track.len() || to < from + 2 {
        return Vec::new();
    }
    let metres = laid_out(&track[from..to]);
    let times = &times[from..to];
    let mut along = Vec::with_capacity(metres.len());
    let mut total = 0.0;
    along.push(total);
    for pair in metres.windows(2) {
        total += crate::persistence::line_simplify::distance(pair[0], pair[1]);
        along.push(total);
    }
    let elapsed = f64::from(times[times.len() - 1]) - f64::from(times[0]);
    if total <= 0.0 || elapsed <= 0.0 {
        return Vec::new();
    }
    let scale = f64::from(best_seconds) / elapsed;
    let mut previous = 0;
    let mut cursor = 0;
    (1..=SPLIT_COUNT)
        .map(|tenth| {
            let target = total * tenth as f64 / SPLIT_COUNT as f64;
            while cursor + 1 < along.len() - 1 && along[cursor + 1] < target {
                cursor += 1;
            }
            let (a, b) = (along[cursor], along[cursor + 1]);
            let share = if b > a {
                ((target - a) / (b - a)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let (t_a, t_b) = (f64::from(times[cursor]), f64::from(times[cursor + 1]));
            let at = (t_a + share * (t_b - t_a) - f64::from(times[0])) * scale;
            let boundary = if tenth == SPLIT_COUNT {
                best_seconds
            } else {
                (at.round() as u32).clamp(previous, best_seconds)
            };
            let split = boundary - previous;
            previous = boundary;
            split
        })
        .collect()
}

fn time_stream(conn: &Connection, activity: &str) -> Option<Vec<u32>> {
    let blob: Vec<u8> = conn
        .query_row(
            "SELECT times FROM time_streams WHERE activity_id = ?",
            [activity],
            |row| row.get(0),
        )
        .ok()?;
    crate::persistence::codec::deserialize(&blob).ok()
}
