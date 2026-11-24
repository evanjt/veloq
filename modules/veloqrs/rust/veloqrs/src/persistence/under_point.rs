//! Which activities pass under a point on the map.
//!
//! The heatmap draws every activity's ink into one raster, so a tap on it
//! names nothing by itself. This answers the question from the stored tracks:
//! an activity is under the point when one of its segments comes within a
//! fingertip of it at the zoom the athlete tapped at.
//!
//! The read takes no engine lock. Candidates come off the shared heatmap
//! source's bounds index, tracks through a read connection, and each track is
//! decoded, tested and dropped before the next row is read, so what is held
//! decoded at once is one track and never a chunk of them.

use std::collections::{BTreeMap, HashMap, HashSet};

use rstar::AABB;
use rusqlite::Connection;
use tracematch::GpsPoint;
use tracematch::geo_utils::distance_to_segment;

use super::codec::TrackRead;
use super::line_simplify::{Metres, simplify};
use super::tiles::{HeatmapSource, heatmap_source, with_track_reader};
use crate::ffi_types::{
    FfiActivitiesUnderPoint, FfiUnderPointActivity, FfiUnderPointGroup, FfiUnderPointKind,
};
use crate::objects::error::VeloqError;

/// The most activities an answer lists across its groups.
pub(crate) const MAX_ACTIVITIES: usize = 500;

/// A fingertip, in pixels of the page's tile size at the tap's zoom.
const FINGERTIP_PX: f64 = 12.0;

/// The fingertip never reads as less than this many metres.
const MIN_BUFFER_METRES: f64 = 15.0;

/// The fingertip never reads as more than this many metres.
const MAX_BUFFER_METRES: f64 = 150.0;

/// The tile size the page draws the heatmap at.
const TILE_PX: f64 = crate::tiles::TILE_SIZE as f64;

/// The equator's length in metres on the spherical Web Mercator model.
const EQUATOR_METRES: f64 = 40_075_016.686;

use crate::persistence::nearby_routes::{self, METRES_PER_DEGREE};

/// Rows per `IN (...)` statement, under SQLite's default limit of 999 bound
/// parameters.
const CHUNK: usize = 500;

/// One activity whose track passes under the tap.
#[derive(Debug, Clone)]
pub(super) struct Hit {
    pub(crate) activity_id: String,
    /// How close the track comes to the tap, in metres.
    pub(crate) nearest_m: f64,
}

/// Metres on the ground to one pixel of the page's tiles at `latitude`.
fn metres_per_pixel(latitude: f64, zoom: u8) -> f64 {
    EQUATOR_METRES * latitude.to_radians().cos().abs() / (TILE_PX * 2f64.powi(i32::from(zoom)))
}

/// The reach of a fingertip at `latitude` and `zoom`, in metres.
pub(crate) fn buffer_metres(latitude: f64, zoom: u8) -> f64 {
    (FINGERTIP_PX * metres_per_pixel(latitude, zoom)).clamp(MIN_BUFFER_METRES, MAX_BUFFER_METRES)
}

/// The most traces one group draws under a tap.
///
/// Timed on an Android test phone in the demo library, at its densest cell (104
/// activities within reach at zoom 12, 64 at zoom 14): a cap of 25, 50 and 100
/// each answered the export in 1 to 9 ms in the engine and under 45 ms across
/// the bridge, and the group draw janked one to five frames a tap at
/// every cap (the sheet's own selection included). The demo's largest group
/// holds 62 traces at zoom 14 and 71 at zoom 12, so 100 is the largest value
/// measured, not one the demo reaches.
pub(crate) const MAX_TRACES: usize = 100;

/// The radius, in pixels at the tap's zoom, of the circle a trace is drawn
/// inside.
///
/// On the same phone and demo cell at a cap of 100, 600 px janked 7 to 19 frames a
/// tap at zoom 14 and 9 to 14 at zoom 12 against 1 to 5 at 300 px, so 300
/// stays.
pub(crate) const CLIP_RADIUS_PX: f64 = 300.0;

/// A trace is simplified until no dropped vertex is further than this many
/// pixels at the tap's zoom from the line drawn.
const SIMPLIFY_TOLERANCE_PX: f64 = 1.0;

/// The radius of the clip circle at `latitude` and `zoom`, in metres.
pub(crate) fn clip_radius_metres(latitude: f64, zoom: u8) -> f64 {
    CLIP_RADIUS_PX * metres_per_pixel(latitude, zoom)
}

/// The box a fingertip at `tap` reaches, in degrees.
struct Reach {
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

impl Reach {
    fn around(tap: &GpsPoint, buffer_metres: f64) -> Self {
        let lat_pad = buffer_metres / METRES_PER_DEGREE;
        let lng_pad = buffer_metres / (METRES_PER_DEGREE * tap.latitude.to_radians().cos().abs());
        Self {
            min_lat: tap.latitude - lat_pad,
            max_lat: tap.latitude + lat_pad,
            min_lng: tap.longitude - lng_pad,
            max_lng: tap.longitude + lng_pad,
        }
    }

    /// Both ends of a segment lie past the same side of the box, so the
    /// segment cannot come within reach.
    fn misses(&self, a: &GpsPoint, b: &GpsPoint) -> bool {
        (a.latitude < self.min_lat && b.latitude < self.min_lat)
            || (a.latitude > self.max_lat && b.latitude > self.max_lat)
            || (a.longitude < self.min_lng && b.longitude < self.min_lng)
            || (a.longitude > self.max_lng && b.longitude > self.max_lng)
    }
}

/// The fingertip at `tap` and `zoom`: its box, and its reach in metres.
fn fingertip(tap: &GpsPoint, zoom: u8) -> (Reach, f64) {
    let buffer = buffer_metres(tap.latitude, zoom);
    (Reach::around(tap, buffer), buffer)
}

/// How close `track` comes to `tap` within `buffer` metres, `None` when it
/// stays further off.
fn nearest_within(track: &[GpsPoint], tap: &GpsPoint, reach: &Reach, buffer: f64) -> Option<f64> {
    let nearest = match track {
        [] => return None,
        [only] => distance_to_segment(tap, only, only),
        _ => track
            .windows(2)
            .filter(|pair| !reach.misses(&pair[0], &pair[1]))
            .map(|pair| distance_to_segment(tap, &pair[0], &pair[1]))
            .fold(f64::INFINITY, f64::min),
    };
    (nearest <= buffer).then_some(nearest)
}

/// The activities whose tracks pass within a fingertip of `tap` at `zoom`.
///
/// A hidden activity is not a candidate, and a stored track that does not
/// decode is left out.
pub(super) fn query(
    source: &HeatmapSource,
    conn: &Connection,
    tap: GpsPoint,
    zoom: u8,
) -> Vec<Hit> {
    let (reach, buffer) = fingertip(&tap, zoom);
    let around = AABB::from_corners(
        [reach.min_lng, reach.min_lat],
        [reach.max_lng, reach.max_lat],
    );
    let candidates: Vec<&str> = source
        .bounds
        .locate_in_envelope_intersecting(&around)
        .filter(|entry| !source.hidden.contains(&entry.activity_id))
        .map(|entry| entry.activity_id.as_str())
        .collect();

    let mut hits = Vec::new();
    for chunk in candidates.chunks(CHUNK) {
        let marks = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({marks})"
        );
        let mut stmt = match conn.prepare(&sql) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("[under_point] prepare failed: {e}");
                continue;
            }
        };
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        });
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[under_point] query failed: {e}");
                continue;
            }
        };
        for row in rows {
            let Ok((activity_id, blob)) = row else {
                continue;
            };
            let track = match TrackRead::from_blob(&blob) {
                TrackRead::Present(track) => track,
                TrackRead::Missing => continue,
                TrackRead::Corrupt(reason) => {
                    log::warn!(
                        "[under_point] activity {activity_id}: corrupt stored points, {reason}"
                    );
                    continue;
                }
            };
            #[cfg(test)]
            crate::tiles::work::held_decoded(track.len());
            let Some(nearest_m) = nearest_within(&track, &tap, &reach, buffer) else {
                continue;
            };
            hits.push(Hit {
                activity_id,
                nearest_m,
            });
        }
    }
    hits
}

/// The route each activity belongs to, for the activities in `ids`.
///
/// Found through the match rows, then checked against the group's own member
/// list, so a row a regroup has not rewritten names no group the activity
/// left.
fn routes_of(conn: &Connection, ids: &[&str]) -> HashMap<String, String> {
    let mut route_ids: Vec<String> = Vec::new();
    for chunk in ids.chunks(CHUNK) {
        let marks = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT route_id FROM activity_matches WHERE activity_id IN ({marks})"
        );
        let read = conn.prepare(&sql).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()
        });
        match read {
            Ok(found) => route_ids.extend(found),
            Err(e) => log::warn!("[under_point] match rows: {e}"),
        }
    }
    route_ids.sort();
    route_ids.dedup();

    let wanted: HashSet<&str> = ids.iter().copied().collect();
    let mut route_of = HashMap::new();
    for route_id in route_ids {
        let Some(group) = super::routes::pooled::group_by_id(conn, &route_id) else {
            continue;
        };
        for member in group.activity_ids {
            if wanted.contains(member.as_str()) {
                route_of.entry(member).or_insert_with(|| route_id.clone());
            }
        }
    }
    route_of
}

/// The names the athlete typed and the numbers minted for `route_ids`.
fn route_labels(
    conn: &Connection,
    route_ids: &[&str],
) -> (HashMap<String, String>, HashMap<String, u32>) {
    let mut names = HashMap::new();
    let mut numbers = HashMap::new();
    for chunk in route_ids.chunks(CHUNK) {
        let marks = vec!["?"; chunk.len()].join(",");
        let bound = || rusqlite::params_from_iter(chunk.iter());
        let named = conn
            .prepare(&format!(
                "SELECT route_id, custom_name FROM route_names WHERE route_id IN ({marks})"
            ))
            .and_then(|mut stmt| {
                stmt.query_map(bound(), |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<rusqlite::Result<Vec<(String, String)>>>()
            });
        match named {
            Ok(rows) => names.extend(rows),
            Err(e) => log::warn!("[under_point] route names: {e}"),
        }
        let numbered = conn
            .prepare(&format!(
                "SELECT route_id, number FROM route_numbers WHERE route_id IN ({marks})"
            ))
            .and_then(|mut stmt| {
                stmt.query_map(bound(), |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<rusqlite::Result<Vec<(String, u32)>>>()
            });
        match numbered {
            Ok(rows) => numbers.extend(rows),
            Err(e) => log::warn!("[under_point] route numbers: {e}"),
        }
    }
    (names, numbers)
}

/// A section whose line passes under the tap, and the listed activities that
/// ride it.
struct SectionUnder {
    id: String,
    name: Option<String>,
    members: HashSet<String>,
}

/// The sections whose line passes under `tap`, each with the activities of
/// `ids` that ride it, by section id.
///
/// A section is a candidate when it is enabled, not superseded, has an
/// activity of `ids` that was not excluded from it, and its stored bounds
/// meet the fingertip's box. Each candidate's line is decoded, tested and
/// dropped before the next is read. `only` asks for one section.
fn sections_under(
    conn: &Connection,
    ids: &[&str],
    tap: &GpsPoint,
    (reach, buffer): &(Reach, f64),
    only: Option<&str>,
) -> Vec<SectionUnder> {
    use rusqlite::types::Value;

    let mut found: BTreeMap<String, SectionUnder> = BTreeMap::new();
    for chunk in ids.chunks(CHUNK) {
        let marks = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT sa.section_id, s.name, sa.activity_id
             FROM section_activities sa JOIN sections s ON s.id = sa.section_id
             WHERE sa.activity_id IN ({marks}) AND sa.excluded = 0
               AND s.disabled = 0 AND s.superseded_by IS NULL
               AND s.bounds_min_lat <= ? AND s.bounds_max_lat >= ?
               AND s.bounds_min_lng <= ? AND s.bounds_max_lng >= ?
               AND (? IS NULL OR s.id = ?)"
        );
        let mut bound: Vec<Value> = chunk
            .iter()
            .map(|id| Value::Text((*id).to_string()))
            .collect();
        bound.extend([
            Value::Real(reach.max_lat),
            Value::Real(reach.min_lat),
            Value::Real(reach.max_lng),
            Value::Real(reach.min_lng),
        ]);
        let only_id = only.map_or(Value::Null, |id| Value::Text(id.to_string()));
        bound.extend([only_id.clone(), only_id]);
        let read = conn.prepare(&sql).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params_from_iter(bound), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
        });
        match read {
            Ok(rows) => {
                for (section_id, name, activity_id) in rows {
                    found
                        .entry(section_id.clone())
                        .or_insert_with(|| SectionUnder {
                            id: section_id,
                            name: name.filter(|name| !name.trim().is_empty()),
                            members: HashSet::new(),
                        })
                        .members
                        .insert(activity_id);
                }
            }
            Err(e) => log::warn!("[under_point] section members: {e}"),
        }
    }

    found
        .into_values()
        .filter(|section| {
            let line = match super::sections::geometry::stored_line(conn, &section.id) {
                Ok(line) => line,
                Err(e) => {
                    log::warn!("[under_point] section {}: {e}", section.id);
                    return false;
                }
            };
            #[cfg(test)]
            crate::tiles::work::held_decoded(line.len());
            nearest_within(&line, tap, reach, *buffer).is_some()
        })
        .collect()
}

/// The hits that have a metrics row, newest first, and the route each one
/// belongs to.
///
/// The one order the sheet lists activities in and the traces are drawn in.
fn listed(
    conn: &Connection,
    hits: &[Hit],
) -> (Vec<(crate::ActivityMetrics, f64)>, HashMap<String, String>) {
    let ids: Vec<&str> = hits.iter().map(|h| h.activity_id.as_str()).collect();
    let mut metrics = super::activities::pooled::metrics_of_many(conn, &ids);
    let mut rows: Vec<(crate::ActivityMetrics, f64)> = hits
        .iter()
        .filter_map(|hit| Some((metrics.remove(&hit.activity_id)?, hit.nearest_m)))
        .collect();
    rows.sort_by(|a, b| {
        b.0.date
            .cmp(&a.0.date)
            .then_with(|| a.0.activity_id.cmp(&b.0.activity_id))
    });
    let listed_ids: Vec<&str> = rows.iter().map(|(m, _)| m.activity_id.as_str()).collect();
    let route_of = routes_of(conn, &listed_ids);
    (rows, route_of)
}

/// The activities under `tap`, grouped by route and by section.
///
/// Newest first, at most [`MAX_ACTIVITIES`] across the groups, with `total`
/// counting every activity under the point once and `truncated` saying the cap
/// bit. An activity in a route and in a section is listed under both. Routes
/// come biggest first by how many of their activities are under the point,
/// then the sections the same way, then the activities in no route. A section
/// is a group when its own line passes under the point and an activity under
/// the point rides it. An activity with no metrics row has no name or date to
/// list and is left out.
pub(super) fn answer(
    source: &HeatmapSource,
    conn: &Connection,
    tap: GpsPoint,
    zoom: u8,
) -> FfiActivitiesUnderPoint {
    let hits = query(source, conn, tap, zoom);
    if hits.is_empty() {
        return FfiActivitiesUnderPoint::default();
    }
    let (rows, mut route_of) = listed(conn, &hits);
    let listed_ids: Vec<&str> = rows.iter().map(|(m, _)| m.activity_id.as_str()).collect();
    // Matching off, the stored routes and sections are not offered.
    let matching = crate::persistence::settings::detection_enabled_from(conn);
    if !matching {
        route_of.clear();
    }
    let sections = if matching {
        sections_under(conn, &listed_ids, &tap, &fingertip(&tap, zoom), None)
    } else {
        Vec::new()
    };

    let mut sections_of: HashMap<&str, Vec<&str>> = HashMap::new();
    for section in &sections {
        for member in &section.members {
            sections_of.entry(member).or_default().push(&section.id);
        }
    }
    let groups_of = |activity_id: &str| -> Vec<Group<'_>> {
        let route = route_of
            .get(activity_id)
            .map_or(Group::NoRoute, |id| Group::Route(id));
        let own = sections_of.get(activity_id).into_iter().flatten();
        std::iter::once(route)
            .chain(own.map(|id| Group::Section(id)))
            .collect()
    };

    let mut counts: HashMap<Group<'_>, u32> = HashMap::new();
    for (m, _) in &rows {
        for group in groups_of(&m.activity_id) {
            *counts.entry(group).or_insert(0) += 1;
        }
    }
    let total = rows.len();
    let listing = |m: &crate::ActivityMetrics, nearest_m: f64| FfiUnderPointActivity {
        id: m.activity_id.clone(),
        name: m.name.clone(),
        sport_type: m.sport_type.clone(),
        date: m.date as f64,
        distance: m.distance,
        duration: m.moving_time,
        nearest_m,
    };
    let activities: Vec<FfiUnderPointActivity> = rows
        .iter()
        .take(MAX_ACTIVITIES)
        .map(|(m, nearest_m)| listing(m, *nearest_m))
        .collect();
    let mut kept: HashMap<Group<'_>, Vec<FfiUnderPointActivity>> = HashMap::new();
    for (m, nearest_m) in rows.iter().take(MAX_ACTIVITIES) {
        for group in groups_of(&m.activity_id) {
            kept.entry(group).or_default().push(listing(m, *nearest_m));
        }
    }

    let mut order: Vec<Group<'_>> = kept.keys().copied().collect();
    order.sort_by(|a, b| {
        let rank = |group: &Group<'_>| match group {
            Group::Route(_) => 0,
            Group::Section(_) => 1,
            Group::NoRoute => 2,
        };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| counts[b].cmp(&counts[a]))
            .then_with(|| a.id().cmp(&b.id()))
    });
    let route_ids: Vec<&str> = order
        .iter()
        .filter_map(|group| match group {
            Group::Route(id) => Some(*id),
            _ => None,
        })
        .collect();
    let (names, numbers) = route_labels(conn, &route_ids);
    let section_names: HashMap<&str, &str> = sections
        .iter()
        .filter_map(|s| Some((s.id.as_str(), s.name.as_deref()?)))
        .collect();
    let groups = order
        .into_iter()
        .map(|group| {
            let (kind, id, name, number) = match group {
                Group::Route(id) => (
                    FfiUnderPointKind::Route,
                    Some(id),
                    names.get(id).cloned(),
                    numbers.get(id).copied(),
                ),
                Group::Section(id) => (
                    FfiUnderPointKind::Section,
                    Some(id),
                    section_names.get(id).map(|name| (*name).to_string()),
                    None,
                ),
                Group::NoRoute => (FfiUnderPointKind::NoRoute, None, None, None),
            };
            let figures = match group {
                Group::Route(id) => nearby_routes::pooled::route_figures(conn, id, None),
                Group::Section(id) => nearby_routes::pooled::section_figures(conn, id, None),
                Group::NoRoute => None,
            };
            FfiUnderPointGroup {
                kind,
                id: id.map(str::to_string),
                name,
                number,
                count: counts[&group],
                sport_types: figures
                    .as_ref()
                    .map(|f| f.sport_types.clone())
                    .unwrap_or_default(),
                distance_m: figures.as_ref().map_or(0.0, |f| f.distance_meters),
                passes: figures.as_ref().map_or(0, |f| f.passes),
                best_time: figures.as_ref().and_then(|f| f.best).map(|b| b.0),
                last_date: figures.as_ref().and_then(|f| f.last).map(|l| l.1 as f64),
                activities: kept.remove(&group).unwrap_or_default(),
            }
        })
        .collect();
    FfiActivitiesUnderPoint {
        total: total as u32,
        truncated: total > MAX_ACTIVITIES,
        trace_cap: MAX_TRACES as u32,
        groups,
        activities,
    }
}

/// The activities under a map point, read off the heatmap's shared source.
///
/// A heatmap that is off has no source and answers nothing. No engine lock is
/// taken: the bounds, the hidden set and the database path are the ones the
/// tile reader holds.
pub(crate) fn activities_under_point(
    latitude: f64,
    longitude: f64,
    zoom: u8,
) -> Result<FfiActivitiesUnderPoint, VeloqError> {
    if !latitude.is_finite() || !longitude.is_finite() {
        return Ok(FfiActivitiesUnderPoint::default());
    }
    let Some(source) = heatmap_source() else {
        return Ok(FfiActivitiesUnderPoint::default());
    };
    let tap = GpsPoint::new(latitude, longitude);
    let started = std::time::Instant::now();
    let found = with_track_reader(&source.db_path, |conn| answer(&source, conn, tap, zoom))
        .ok_or(VeloqError::NotInitialized)?;
    log::info!(
        "veloqrs: [UnderPoint] zoom {zoom}, {} hits, {} groups, {} ms",
        found.total,
        found.groups.len(),
        started.elapsed().as_millis()
    );
    Ok(found)
}

/// One activity's line near a tap: a run of positions for each stretch of the
/// track inside the clip circle.
#[derive(Debug, Clone)]
pub(crate) struct Trace {
    pub(crate) activity_id: String,
    pub(crate) date: i64,
    pub(crate) lines: Vec<Vec<GpsPoint>>,
}

/// The stretches of `track` inside the circle of `radius_m` metres around
/// `tap`, each simplified to within `tolerance_m` metres.
///
/// A segment that crosses the circle is cut where it does, so a line ends on
/// the circle rather than at the sample beyond it. A track that leaves and
/// comes back gives two lines, and a stretch of fewer than two positions is
/// not a line. A position with no finite coordinate is skipped.
pub(crate) fn clip_and_simplify(
    track: &[GpsPoint],
    tap: &GpsPoint,
    radius_m: f64,
    tolerance_m: f64,
) -> Vec<Vec<GpsPoint>> {
    let lng_scale = tap.latitude.to_radians().cos() * METRES_PER_DEGREE;
    let project = |p: &GpsPoint| -> Metres {
        [
            (p.longitude - tap.longitude) * lng_scale,
            (p.latitude - tap.latitude) * METRES_PER_DEGREE,
        ]
    };
    let mut runs: Vec<Vec<Metres>> = Vec::new();
    let mut open = false;
    let mut previous: Option<Metres> = None;
    for point in track
        .iter()
        .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
    {
        let here = project(point);
        let Some(from) = previous.replace(here) else {
            continue;
        };
        let Some((enter, leave)) = inside_circle(from, here, radius_m) else {
            open = false;
            continue;
        };
        let at = |t: f64| {
            [
                from[0] + t * (here[0] - from[0]),
                from[1] + t * (here[1] - from[1]),
            ]
        };
        if !open || enter > 0.0 {
            runs.push(vec![at(enter)]);
        }
        if let Some(run) = runs.last_mut() {
            run.push(at(leave));
        }
        open = leave >= 1.0;
    }
    runs.into_iter()
        .filter(|run| run.len() >= 2)
        .map(|run| {
            simplify(&run, tolerance_m)
                .into_iter()
                .map(|[x, y]| {
                    GpsPoint::new(
                        tap.latitude + y / METRES_PER_DEGREE,
                        tap.longitude + x / lng_scale,
                    )
                })
                .collect()
        })
        .collect()
}

/// The fractions along `from`-`to` between which the segment is inside the
/// circle of `radius` around the origin, `None` when none of it is.
fn inside_circle(from: Metres, to: Metres, radius: f64) -> Option<(f64, f64)> {
    let (dx, dy) = (to[0] - from[0], to[1] - from[1]);
    let a = dx * dx + dy * dy;
    let c = from[0] * from[0] + from[1] * from[1] - radius * radius;
    if a == 0.0 {
        return (c <= 0.0).then_some((0.0, 1.0));
    }
    let b = 2.0 * (from[0] * dx + from[1] * dy);
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return None;
    }
    let root = discriminant.sqrt();
    let enter = ((-b - root) / (2.0 * a)).max(0.0);
    let leave = ((-b + root) / (2.0 * a)).min(1.0);
    (enter <= leave).then_some((enter, leave))
}

/// Which group of an answer is asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Group<'a> {
    Route(&'a str),
    Section(&'a str),
    NoRoute,
}

impl<'a> Group<'a> {
    /// The route or the section, `None` for the activities in no route.
    fn id(self) -> Option<&'a str> {
        match self {
            Self::Route(id) | Self::Section(id) => Some(id),
            Self::NoRoute => None,
        }
    }
}

/// The traces of one group's activities under `tap`, newest first, at most
/// [`MAX_TRACES`].
///
/// `group` is a route, a section, or the activities in no route. The
/// activities are the ones the sheet lists for the group, so a hidden
/// activity is absent, and each track is read, clipped and dropped before the
/// next is read.
pub(super) fn traces(
    source: &HeatmapSource,
    conn: &Connection,
    tap: GpsPoint,
    zoom: u8,
    group: Group<'_>,
) -> Vec<Trace> {
    let hits = query(source, conn, tap, zoom);
    let (rows, route_of) = listed(conn, &hits);
    let riders: Option<HashSet<String>> = match group {
        Group::Section(id) => {
            let listed_ids: Vec<&str> = rows.iter().map(|(m, _)| m.activity_id.as_str()).collect();
            let found = sections_under(conn, &listed_ids, &tap, &fingertip(&tap, zoom), Some(id));
            Some(
                found
                    .into_iter()
                    .flat_map(|section| section.members)
                    .collect(),
            )
        }
        _ => None,
    };
    let radius = clip_radius_metres(tap.latitude, zoom);
    let tolerance = SIMPLIFY_TOLERANCE_PX * metres_per_pixel(tap.latitude, zoom);
    let mut out = Vec::new();
    for (metrics, _) in rows {
        if out.len() == MAX_TRACES {
            break;
        }
        let route = route_of.get(&metrics.activity_id).map(String::as_str);
        let member = match group {
            Group::Route(id) => route == Some(id),
            Group::Section(_) => riders
                .as_ref()
                .is_some_and(|riders| riders.contains(&metrics.activity_id)),
            Group::NoRoute => route.is_none(),
        };
        if !member {
            continue;
        }
        let Some(track) = super::activities::pooled::gps_track(conn, &metrics.activity_id) else {
            continue;
        };
        let lines = clip_and_simplify(&track, &tap, radius, tolerance);
        if lines.is_empty() {
            continue;
        }
        out.push(Trace {
            activity_id: metrics.activity_id,
            date: metrics.date,
            lines,
        });
    }
    out
}

/// Why the traces under a point could not be answered.
pub(crate) enum TracesError {
    /// The heatmap is off, so there is no source to read from.
    NoHeatmap,
    /// The library could not be opened.
    NotOpen,
}

/// The traces of one group under a map point, read off the heatmap's shared
/// source and taking no engine lock.
pub(crate) fn traces_under_point(
    latitude: f64,
    longitude: f64,
    zoom: u8,
    group: Group<'_>,
) -> Result<Vec<Trace>, TracesError> {
    let source = heatmap_source().ok_or(TracesError::NoHeatmap)?;
    let tap = GpsPoint::new(latitude, longitude);
    with_track_reader(&source.db_path, |conn| {
        traces(&source, conn, tap, zoom, group)
    })
    .ok_or(TracesError::NotOpen)
}
