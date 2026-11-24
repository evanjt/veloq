//! The saved routes and sections near a point: the one nearby read, for the record screen and
//! the lists that offer places to ride.

use crate::Bounds;

/// How far from the point a place's start may lie and still count as nearby.
pub(crate) const NEARBY_RADIUS_METRES: f64 = 2_000.0;

/// The most places the read returns, nearest first, the followed route aside.
pub(crate) const NEARBY_LIMIT: usize = 10;

/// Metres on the ground to one degree of latitude, the one figure every point-to-point distance
/// in the engine's local reads is measured with.
pub(crate) const METRES_PER_DEGREE: f64 = 111_320.0;

/// The most points a nearby place's line carries.
pub(crate) const NEARBY_LINE_POINTS: usize = 40;

/// Whether a nearby place is a route or a section.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, uniffi::Enum)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiNearbyKind")]
pub enum NearbyKind {
    Route,
    Section,
}

/// Both kinds, for a read that lists routes and sections alike.
pub(crate) const ALL_KINDS: &[NearbyKind] = &[NearbyKind::Route, NearbyKind::Section];

/// One route or section near a point, with what a list of them shows.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiNearbyPlace")]
pub struct NearbyPlace {
    pub kind: NearbyKind,
    pub id: String,
    pub name: String,
    pub sport_type: String,
    /// The place's own length in metres.
    /// Unit: metre.
    pub distance_meters: f64,
    /// Unit: metre.
    pub elevation_gain_meters: Option<f64>,
    /// Metres from the point to where the place starts.
    /// Unit: metre.
    pub away_meters: f64,
    /// Whether the place starts within [`NEARBY_RADIUS_METRES`] of the point. A followed route
    /// beyond it is returned so it can be described, but is not offered.
    pub offered: bool,
    /// Unit: second.
    pub best_time_seconds: Option<u32>,
    /// Unix seconds of the best attempt.
    pub best_date: Option<crate::WholeNumber>,
    /// Unit: second.
    pub last_time_seconds: Option<u32>,
    /// Unix seconds of the latest counted attempt.
    pub last_date: Option<crate::WholeNumber>,
    /// Unit: count.
    pub pass_count: u32,
    /// The line simplified to at most [`NEARBY_LINE_POINTS`] points, with elevation where stored.
    #[serde(with = "crate::remote::bytes")]
    pub encoded_coords: Vec<u8>,
    /// The same line as [`pack_line`](crate::persistence::codec::pack_line) writes it, in place of
    /// `encoded_coords`, which is then empty. Present only when the read was asked to pack.
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Unit: varies.
    pub packed_line: Option<Vec<i32>>,
}

/// What the nearby read is asked about a place's line.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiNearbyLineAsk")]
pub struct LineAsk {
    /// The most points a line carries; zero means [`NEARBY_LINE_POINTS`].
    pub max_points: u32,
    /// Whether the line is packed into integers rather than encoded as a polyline.
    pub packed: bool,
}

impl LineAsk {
    /// The line as the ask wants it: capped through the one strider, then encoded or packed.
    pub(crate) fn carry(self, line: &[crate::GpsPoint]) -> (Vec<u8>, Option<Vec<i32>>) {
        let cap = match self.max_points {
            0 => NEARBY_LINE_POINTS,
            n => n as usize,
        };
        let line = crate::persistence::screens::capped_line(line, cap);
        if self.packed {
            (
                Vec::new(),
                Some(crate::persistence::codec::pack_line(&line)),
            )
        } else {
            (crate::persistence::codec::encode_polyline(&line), None)
        }
    }
}

/// Metres from the point to `start`.
pub(crate) fn metres_to_point(start: &crate::GpsPoint, latitude: f64, longitude: f64) -> f64 {
    let metres_per_lng_degree = METRES_PER_DEGREE * latitude.to_radians().cos();
    ((start.latitude - latitude) * METRES_PER_DEGREE)
        .hypot((start.longitude - longitude) * metres_per_lng_degree)
}

/// Metres from the fix to the bounding box, zero when the box contains it.
pub(crate) fn metres_from_bounds(bounds: &Bounds, latitude: f64, longitude: f64) -> f64 {
    let metres_per_lng_degree = METRES_PER_DEGREE * latitude.to_radians().cos();
    let d_lat = (bounds.min_lat - latitude)
        .max(0.0)
        .max(latitude - bounds.max_lat);
    let d_lng = (bounds.min_lng - longitude)
        .max(0.0)
        .max(longitude - bounds.max_lng);
    (d_lat * METRES_PER_DEGREE).hypot(d_lng * metres_per_lng_degree)
}

pub(crate) mod pooled {
    use rusqlite::Connection;

    use super::*;
    use crate::persistence::activities::pooled as activities;
    use crate::persistence::fitness::performances::route_performances;
    use crate::persistence::route_lines::MIN_ROUTE_ACTIVITIES;
    use crate::persistence::routes::pooled as routes;

    /// A route's metrics and its performances counted in `family`, `None` when the group is gone
    /// or none of its attempts is in the family.
    fn family_performances(
        conn: &Connection,
        family: Option<&[&str]>,
        group_id: &str,
    ) -> Option<(
        std::collections::HashMap<String, crate::ActivityMetrics>,
        crate::RoutePerformanceResult,
    )> {
        let group = routes::group_by_id(conn, group_id)?;
        let metrics = activities::metrics_for_ids(conn, &group.activity_ids);
        let in_family =
            |m: &crate::ActivityMetrics| family.is_none_or(|f| f.contains(&m.sport_type.as_str()));
        if !metrics.values().any(in_family) {
            return None;
        }
        let performances = route_performances(
            &group.activity_ids,
            Some(&routes::match_info(conn, group_id)),
            &routes::excluded_route_activity_ids(conn, group_id),
            |id| metrics.get(id).filter(|m| in_family(m)).cloned(),
            None,
            None,
        );
        Some((metrics, performances))
    }

    /// The figures a row of a route or a section shows: what lists of nearby places and of the
    /// places under a tap draw beside the name.
    #[derive(Debug, Clone, PartialEq)]
    pub(crate) struct PlaceFigures {
        pub(crate) sport_types: Vec<String>,
        /// The route's representative's distance, or the section's own length, in metres.
        pub(crate) distance_meters: f64,
        /// The representative's gain for a route, the section's own for a section.
        pub(crate) elevation_gain_meters: Option<f64>,
        /// A route's counted attempts, a section's visit count.
        pub(crate) passes: u32,
        /// Moving time in seconds and unix date of the fastest counted attempt.
        pub(crate) best: Option<(u32, i64)>,
        /// Moving time in seconds and unix date of the latest counted attempt.
        pub(crate) last: Option<(u32, i64)>,
        /// The activity that set `best`.
        pub(crate) best_activity_id: Option<String>,
    }

    /// A route's figures, from its attempts counted in `family` (every attempt when `None`).
    /// `None` when the group is gone or none of its attempts counts. One performances read.
    pub(crate) fn route_figures(
        conn: &Connection,
        group_id: &str,
        family: Option<&[&str]>,
    ) -> Option<PlaceFigures> {
        #[cfg(test)]
        crate::tiles::work::figures_read();
        let (metrics, performances) = family_performances(conn, family, group_id)?;
        let representative = routes::group_by_id(conn, group_id)
            .and_then(|group| metrics.get(&group.representative_id).cloned());
        let mut sport_types: Vec<String> = metrics.values().map(|m| m.sport_type.clone()).collect();
        sport_types.sort();
        sport_types.dedup();
        let timed = |p: &crate::RoutePerformance| (p.moving_time, p.date.0);
        Some(PlaceFigures {
            sport_types,
            distance_meters: representative.as_ref().map_or(0.0, |m| m.distance),
            elevation_gain_meters: representative.map(|m| m.elevation_gain),
            passes: performances.performances.len() as u32,
            best: performances.best.as_ref().map(timed),
            last: performances.performances.last().map(timed),
            best_activity_id: performances.best.as_ref().map(|p| p.activity_id.clone()),
        })
    }

    /// A section's figures, from its row and its counted laps. With a `family`, only the laps of
    /// those sports count, and the passes are their number; the section is then `None` unless a
    /// lap or the section's own sport is in the family. `None` when the section is gone. One
    /// laps read.
    pub(crate) fn section_figures(
        conn: &Connection,
        section_id: &str,
        family: Option<&[&str]>,
    ) -> Option<PlaceFigures> {
        #[cfg(test)]
        crate::tiles::work::figures_read();
        let (sport_type, distance, gain, visits) = conn
            .query_row(
                "SELECT sport_type, distance_meters, elevation_gain_m, visit_count
                 FROM sections WHERE id = ?1",
                [section_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                        row.get::<_, u32>(3)?,
                    ))
                },
            )
            .ok()?;
        let eligible = crate::persistence::records::record_eligible_passes(conn, section_id);
        let sports: std::collections::HashMap<String, String> = conn
            .prepare(
                "SELECT sa.activity_id, m.sport_type
                 FROM section_activities sa
                 JOIN activity_metrics m ON m.activity_id = sa.activity_id
                 WHERE sa.section_id = ?1",
            )
            .and_then(|mut stmt| {
                stmt.query_map([section_id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .ok()?;
        let lap_sport =
            |l: &crate::persistence::records::RecordPass| sports.get(&l.activity_id).cloned();
        let in_family = |sport: &str| family.is_none_or(|f| f.contains(&sport));
        let mut sport_types: Vec<String> = Vec::new();
        if family.is_some() {
            sport_types = eligible
                .iter()
                .filter_map(|l| lap_sport(l))
                .filter(|s| in_family(s))
                .collect();
            sport_types.sort();
            sport_types.dedup();
            if sport_types.is_empty() && !in_family(&sport_type) {
                return None;
            }
        }
        if sport_types.is_empty() {
            sport_types.push(sport_type);
        }
        let laps: Vec<crate::persistence::records::RecordPass> = eligible
            .into_iter()
            .filter(|l| lap_sport(l).is_some_and(|s| in_family(&s)))
            .collect();
        let passes = if family.is_some() {
            laps.len() as u32
        } else {
            visits
        };
        let best = laps.iter().min_by(|a, b| a.time.total_cmp(&b.time));
        let timed = |l: &crate::persistence::records::RecordPass| (l.time.round() as u32, l.date);
        Some(PlaceFigures {
            sport_types,
            distance_meters: distance,
            elevation_gain_meters: gain,
            passes,
            best: best.map(timed),
            last: laps.last().map(timed),
            best_activity_id: best.map(|l| l.activity_id.clone()),
        })
    }

    /// The routes and sections of `sport`'s family, of the `kinds` asked for, whose start lies
    /// within [`NEARBY_RADIUS_METRES`] of the point, nearest start first, at most
    /// [`NEARBY_LIMIT`] of them: the limit counts only the kinds asked for, so a section never
    /// takes the place of a route the caller lists. Each carries its best and its most recent
    /// counted time with their dates, its passes, its elevation gain and a thinned line with
    /// elevation. The `followed` route is always returned when routes are asked for, last when it
    /// starts outside the radius or past the limit, so what the athlete follows is described by
    /// the same read.
    pub(crate) fn nearby_places(
        conn: &Connection,
        latitude: f64,
        longitude: f64,
        sport: &str,
        kinds: &[NearbyKind],
        followed: Option<&str>,
        line_ask: LineAsk,
    ) -> Vec<NearbyPlace> {
        if !crate::persistence::settings::detection_enabled_from(conn) {
            return Vec::new();
        }
        let family = crate::sport::family_of(sport);
        let mut found: Vec<(f64, NearbyKind, String)> = Vec::new();

        let route_candidates: Vec<crate::persistence::GroupSummary> =
            if kinds.contains(&NearbyKind::Route) {
                routes::group_keys(conn, true, true)
                    .into_iter()
                    .filter(|g| g.activity_count >= MIN_ROUTE_ACTIVITIES)
                    .filter(|g| {
                        followed == Some(g.group_id.as_str())
                            || g.bounds.as_ref().is_some_and(|b| {
                                metres_from_bounds(b, latitude, longitude) <= NEARBY_RADIUS_METRES
                            })
                    })
                    .collect()
            } else {
                Vec::new()
            };
        let representatives: Vec<String> = route_candidates
            .iter()
            .map(|g| g.representative_id.clone())
            .collect();
        let lines: std::collections::HashMap<String, Vec<u8>> =
            activities::map_signatures_for_ids(conn, &representatives)
                .into_iter()
                .map(|s| (s.activity_id, s.encoded_coords))
                .collect();
        for group in &route_candidates {
            let start = lines
                .get(&group.representative_id)
                .and_then(|bytes| crate::persistence::codec::decode_polyline(bytes))
                .and_then(|points| points.into_iter().next());
            if let Some(start) = start {
                let away = metres_to_point(&start, latitude, longitude);
                if away <= NEARBY_RADIUS_METRES || followed == Some(group.group_id.as_str()) {
                    found.push((away, NearbyKind::Route, group.group_id.clone()));
                }
            }
        }
        if kinds.contains(&NearbyKind::Section) {
            for (away, id) in section_starts(conn, latitude, longitude) {
                found.push((away, NearbyKind::Section, id));
            }
        }
        found.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.2.cmp(&b.2)));

        let mut places = Vec::new();
        for (away, kind, id) in found {
            let is_followed = kind == NearbyKind::Route && followed == Some(id.as_str());
            if places.len() == NEARBY_LIMIT && !is_followed {
                continue;
            }
            let place = match kind {
                NearbyKind::Route => route_place(
                    conn,
                    &family,
                    &id,
                    away,
                    &route_candidates,
                    &lines,
                    line_ask,
                ),
                NearbyKind::Section => section_place(conn, sport, &id, away, line_ask),
            };
            places.extend(place);
        }
        places
    }

    /// The nearby read at a watch's own fix, as the link's reply text: `{"id":0,"result":
    /// {"places":[...]}}`, each place as [`NearbyPlace`] serialises. The watch carries its fix, so
    /// no followed route is named and nothing depends on the phone's location. The reply is text,
    /// never framed, for the transport module to carry verbatim.
    pub(crate) fn watch_nearby_json(
        conn: &Connection,
        latitude: f64,
        longitude: f64,
        sport: &str,
    ) -> String {
        let places = nearby_places(
            conn,
            latitude,
            longitude,
            sport,
            ALL_KINDS,
            None,
            LineAsk::default(),
        );
        crate::remote::protocol::reply(0, Ok(serde_json::json!({ "places": places })))
    }

    /// Every visible section whose start lies within the radius of the point, as (metres, id).
    fn section_starts(conn: &Connection, latitude: f64, longitude: f64) -> Vec<(f64, String)> {
        let lat_pad = NEARBY_RADIUS_METRES / METRES_PER_DEGREE;
        let lng_pad = lat_pad / latitude.to_radians().cos().abs().max(0.01);
        let sql = format!(
            "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index, rep_reversed
             FROM sections
             WHERE {} AND bounds_min_lat IS NOT NULL
               AND bounds_max_lat >= ?1 AND bounds_min_lat <= ?2
               AND bounds_max_lng >= ?3 AND bounds_min_lng <= ?4",
            crate::persistence::PersistentEngine::VISIBLE_FILTER
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt.query_map(
            rusqlite::params![
                latitude - lat_pad,
                latitude + lat_pad,
                longitude - lng_pad,
                longitude + lng_pad
            ],
            |row| {
                let id: String = row.get(0)?;
                let blob: Option<Vec<u8>> = row.get(1)?;
                let json: Option<String> = row.get(2)?;
                let rep: Option<String> = row.get(3)?;
                let rep_start: Option<u32> = row.get(4)?;
                let rep_end: Option<u32> = row.get(5)?;
                let rep_reversed: bool = row.get(6)?;
                Ok((id, blob, json, rep, rep_start, rep_end, rep_reversed))
            },
        );
        let Ok(rows) = rows else {
            return Vec::new();
        };
        rows.filter_map(Result::ok)
            .filter_map(|(id, blob, json, rep, rep_start, rep_end, rep_reversed)| {
                let line = crate::persistence::sections::geometry::line(
                    conn,
                    blob.as_deref(),
                    json.as_deref(),
                    crate::persistence::sections::geometry::reference(
                        rep.as_deref(),
                        rep_start,
                        rep_end,
                        rep_reversed,
                    ),
                )
                .ok()?;
                let away = metres_to_point(line.first()?, latitude, longitude);
                (away <= NEARBY_RADIUS_METRES).then_some((away, id))
            })
            .collect()
    }

    fn section_place(
        conn: &Connection,
        sport: &str,
        section_id: &str,
        away: f64,
        line_ask: LineAsk,
    ) -> Option<NearbyPlace> {
        let (name, _, distance, gain, blob, json, rep, rep_start, rep_end, rep_reversed) = conn
            .query_row(
                "SELECT name, sport_type, distance_meters, elevation_gain_m, polyline_blob,
                        polyline_json, representative_activity_id, rep_start_index,
                        rep_end_index, rep_reversed
                 FROM sections WHERE id = ?1",
                [section_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, Option<f64>>(3)?,
                        row.get::<_, Option<Vec<u8>>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<u32>>(7)?,
                        row.get::<_, Option<u32>>(8)?,
                        row.get::<_, bool>(9)?,
                    ))
                },
            )
            .ok()?;
        let family = crate::sport::family_of(sport);
        let figures = section_figures(conn, section_id, Some(&family))?;
        let line = crate::persistence::sections::geometry::line(
            conn,
            blob.as_deref(),
            json.as_deref(),
            crate::persistence::sections::geometry::reference(
                rep.as_deref(),
                rep_start,
                rep_end,
                rep_reversed,
            ),
        )
        .ok()?;

        let (encoded_coords, packed_line) = line_ask.carry(&line);
        Some(NearbyPlace {
            kind: NearbyKind::Section,
            id: section_id.to_string(),
            name: name.unwrap_or_else(|| section_id.to_string()),
            sport_type: sport.to_string(),
            distance_meters: distance,
            elevation_gain_meters: gain,
            away_meters: away,
            offered: away <= NEARBY_RADIUS_METRES,
            best_time_seconds: figures.best.map(|b| b.0),
            best_date: figures.best.map(|b| b.1.into()),
            last_time_seconds: figures.last.map(|l| l.0),
            last_date: figures.last.map(|l| l.1.into()),
            pass_count: figures.passes,
            encoded_coords,
            packed_line,
        })
    }

    fn route_place(
        conn: &Connection,
        family: &[&str],
        group_id: &str,
        away: f64,
        candidates: &[crate::persistence::GroupSummary],
        lines: &std::collections::HashMap<String, Vec<u8>>,
        line_ask: LineAsk,
    ) -> Option<NearbyPlace> {
        let summary = candidates.iter().find(|g| g.group_id == group_id)?;
        let figures = route_figures(conn, group_id, Some(family))?;
        let line = lines
            .get(&summary.representative_id)
            .and_then(|bytes| crate::persistence::codec::decode_polyline(bytes))
            .unwrap_or_default();
        let (encoded_coords, packed_line) = line_ask.carry(&line);
        Some(NearbyPlace {
            kind: NearbyKind::Route,
            id: group_id.to_string(),
            name: summary
                .custom_name
                .clone()
                .unwrap_or_else(|| group_id.to_string()),
            sport_type: summary.sport_types.first().cloned().unwrap_or_default(),
            distance_meters: summary.distance_meters,
            elevation_gain_meters: figures.elevation_gain_meters,
            away_meters: away,
            offered: away <= NEARBY_RADIUS_METRES,
            best_time_seconds: figures.best.map(|b| b.0),
            best_date: figures.best.map(|b| b.1.into()),
            last_time_seconds: figures.last.map(|l| l.0),
            last_date: figures.last.map(|l| l.1.into()),
            pass_count: figures.passes,
            encoded_coords,
            packed_line,
        })
    }
}
