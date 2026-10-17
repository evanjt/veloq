//! GeoJSON the map page asks for by URL rather than receiving as text.
//!
//! The page used to receive one activity's line as GeoJSON the JavaScript side
//! had decoded from the stored track, rebuilt and stringified: half a megabyte
//! for a long ride, copied across the bridge on every mount. A source can name
//! a URL instead, so the page asks `veloq-geo/<kind>/<key>` on its own origin,
//! the platform's interceptor hands the path here, and MapLibre parses the
//! answer in its worker.
//!
//! The text is written here rather than shipped as the track's own encoding
//! because a page-side decoder would be a second codec to keep in step with
//! `persistence::codec`.

use std::fmt::Write;

use rusqlite::Connection;

use crate::GpsPoint;
use crate::persistence::codec;
use crate::persistence::route_lines::pooled::layer_with_generation;

/// A path that is not `<kind>/<key>` with a key in the id alphabet.
pub const BAD_PATH: u16 = 400;

/// No such kind, or nothing stored under the key.
pub const NOT_FOUND: u16 = 404;

/// The engine is not open yet, so there is no library to read.
pub const NOT_OPEN: u16 = 503;

/// The decimal places a position is written to, which is the grid the stored
/// track is quantised to, so nothing stored is lost.
const MICRO: f64 = 1e6;

/// The text answered when there is no line to draw.
const EMPTY_COLLECTION: &str = r#"{"type":"FeatureCollection","features":[]}"#;

/// The one key the route-line layer is asked under: it is the whole layer,
/// and the page's revision is the route group generation.
const ROUTE_LINES_KEY: &str = "all";

/// Answer one `veloq-geo` request, `path` being everything after the marker.
///
/// The query string is ignored: it is the page's revision, there to make a
/// re-ingested track a new URL. A key outside `[A-Za-z0-9_-]` is refused
/// before anything is read, so a path the page chose can never name more than
/// one row.
pub fn geo_answer(path: &str) -> Result<Vec<u8>, u16> {
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let (kind, key) = path.split_once('/').ok_or(BAD_PATH)?;
    if key.is_empty()
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(BAD_PATH);
    }
    match kind {
        "track" => track(key),
        "route-lines" if key == ROUTE_LINES_KEY => route_lines(),
        _ => Err(NOT_FOUND),
    }
}

/// One activity's stored line, read off the engine lock.
fn track(activity_id: &str) -> Result<Vec<u8>, u16> {
    crate::objects::error::with_reader(|conn| {
        crate::persistence::activities::pooled::gps_track(conn, activity_id)
    })
    .map_err(|_| NOT_OPEN)?
    .map(|points| line_feature(&points).into_bytes())
    .ok_or(NOT_FOUND)
}

/// The route-line layer, read off the engine lock. A read that fails is the
/// store failing, not a missing layer, so it is not answered as empty.
fn route_lines() -> Result<Vec<u8>, u16> {
    crate::objects::error::with_reader(route_lines_collection)
        .map_err(|_| NOT_OPEN)?
        .map(String::into_bytes)
        .map_err(|error| {
            log::warn!("[basemap] route-line layer unreadable: {error}");
            super::UPSTREAM_FAILED
        })
}

/// The current route-line layer as a `FeatureCollection`, empty when the
/// layer is missing or was built from another route group generation. A line
/// whose polyline does not decode is left out.
pub(crate) fn route_lines_collection(conn: &Connection) -> rusqlite::Result<String> {
    let Some((_, lines)) = layer_with_generation(conn)? else {
        return Ok(EMPTY_COLLECTION.to_string());
    };
    Ok(route_lines_features(lines.iter().filter_map(|line| {
        codec::decode_polyline(&line.polyline).map(|points| RouteLinePoints {
            route_id: &line.route_id,
            number: line.number,
            points,
        })
    })))
}

/// One route's decoded line, as the collection writes it.
struct RouteLinePoints<'a> {
    route_id: &'a str,
    number: Option<u32>,
    points: Vec<GpsPoint>,
}

/// One `LineString` feature per route with a line to draw, in layer order.
///
/// Each carries the route's `id`, its `number` or null, and `palette`, the
/// route's colour key, which the page reduces modulo its route palette. A
/// route left with fewer than two finite points is left out.
fn route_lines_features<'a>(lines: impl IntoIterator<Item = RouteLinePoints<'a>>) -> String {
    let mut out = String::from(r#"{"type":"FeatureCollection","features":["#);
    let mut written = 0usize;
    for line in lines {
        if !has_line(&line.points) {
            continue;
        }
        if written > 0 {
            out.push(',');
        }
        // A route id is the engine's own, but it is escaped as any string is.
        let id = serde_json::to_string(line.route_id).unwrap_or_else(|_| "null".to_string());
        let number = line
            .number
            .map_or_else(|| "null".to_string(), |n| n.to_string());
        let palette = route_palette_key(line.route_id);
        let _ = write!(
            out,
            r#"{{"type":"Feature","id":{id},"properties":{{"id":{id},"number":{number},"palette":{palette}}},"geometry":{{"type":"LineString","coordinates":["#
        );
        push_positions(&mut out, &line.points);
        out.push_str("]}}");
        written += 1;
    }
    out.push_str("]}");
    out
}

/// A route's colour key: the 31-multiplier hash of its id's UTF-16 units,
/// wrapped to 32 bits and taken unsigned. It hangs off the id rather than the
/// route's place in the layer, so a regroup that reorders the routes leaves
/// each its colour.
fn route_palette_key(route_id: &str) -> u32 {
    route_id
        .encode_utf16()
        .fold(0i32, |hash, unit| {
            hash.wrapping_mul(31).wrapping_add(i32::from(unit))
        })
        .unsigned_abs()
}

/// The points as one `LineString` feature, `[lng, lat]` at six places.
///
/// Every stored point is kept but those with no finite coordinate, which is
/// the line the readers of the decoded track draw and the chart scrubber
/// indexes into. Under two points there is no line, and the answer is an empty
/// collection.
pub fn line_feature(points: &[GpsPoint]) -> String {
    if !has_line(points) {
        return EMPTY_COLLECTION.to_string();
    }
    const HEAD: &str =
        r#"{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":["#;
    const TAIL: &str = "]}}";
    // A position is about 22 characters at six places.
    let mut out = String::with_capacity(HEAD.len() + TAIL.len() + points.len() * 24);
    out.push_str(HEAD);
    push_positions(&mut out, points);
    out.push_str(TAIL);
    out
}

/// The points a line keeps: a non-finite coordinate crashes the iOS renderer.
fn finite(points: &[GpsPoint]) -> impl Iterator<Item = &GpsPoint> {
    points
        .iter()
        .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
}

/// Whether two finite points are left, the fewest that make a line: the
/// renderer crashes on one.
fn has_line(points: &[GpsPoint]) -> bool {
    finite(points).take(2).count() == 2
}

/// The finite points as comma-separated `[lng, lat]` positions.
fn push_positions(out: &mut String, points: &[GpsPoint]) {
    for (i, point) in finite(points).enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        push_degrees(out, point.longitude);
        out.push(',');
        push_degrees(out, point.latitude);
        out.push(']');
    }
}

/// A finite degree value at six places with trailing zeros dropped, written
/// from its integer micro-degrees so no float formatting can widen it.
fn push_degrees(out: &mut String, degrees: f64) {
    let micro = (degrees * MICRO).round() as i64;
    if micro < 0 {
        out.push('-');
    }
    let micro = micro.unsigned_abs();
    let _ = write!(out, "{}", micro / 1_000_000);
    let fraction = micro % 1_000_000;
    if fraction != 0 {
        let digits = format!("{fraction:06}");
        out.push('.');
        out.push_str(digits.trim_end_matches('0'));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn positions(text: &str) -> Vec<Vec<f64>> {
        let value: serde_json::Value = serde_json::from_str(text).expect("JSON");
        serde_json::from_value(value["geometry"]["coordinates"].clone()).expect("positions")
    }

    #[test]
    fn a_position_is_lng_then_lat_at_six_places() {
        let text = line_feature(&[
            GpsPoint::new(-33.8712346, 151.2045671),
            GpsPoint::new(46.1, -7.000_000_4),
        ]);

        assert_eq!(
            positions(&text),
            vec![vec![151.204567, -33.871235], vec![-7.0, 46.1]]
        );
        assert!(text.contains("[151.204567,-33.871235],[-7,46.1]"), "{text}");
    }

    #[test]
    fn a_value_that_rounds_to_zero_is_written_unsigned() {
        let text = line_feature(&[GpsPoint::new(-0.000_000_4, 0.0), GpsPoint::new(1.0, 2.0)]);

        assert!(text.contains("[0,0]"), "{text}");
    }

    #[test]
    fn non_finite_points_are_dropped_and_the_rest_kept_in_order() {
        let text = line_feature(&[
            GpsPoint::new(1.0, 2.0),
            GpsPoint::new(f64::NAN, 3.0),
            GpsPoint::new(4.0, f64::INFINITY),
            GpsPoint::new(5.0, 6.0),
        ]);

        assert_eq!(positions(&text), vec![vec![2.0, 1.0], vec![6.0, 5.0]]);
    }

    #[test]
    fn fewer_than_two_drawable_points_is_an_empty_collection() {
        assert_eq!(line_feature(&[]), EMPTY_COLLECTION);
        assert_eq!(line_feature(&[GpsPoint::new(1.0, 2.0)]), EMPTY_COLLECTION);
        assert_eq!(
            line_feature(&[GpsPoint::new(1.0, 2.0), GpsPoint::new(f64::NAN, 2.0)]),
            EMPTY_COLLECTION
        );
    }

    fn route<'a>(
        route_id: &'a str,
        number: Option<u32>,
        points: &[(f64, f64)],
    ) -> RouteLinePoints<'a> {
        RouteLinePoints {
            route_id,
            number,
            points: points
                .iter()
                .map(|&(lat, lng)| GpsPoint::new(lat, lng))
                .collect(),
        }
    }

    #[test]
    fn route_lines_drop_non_finite_points_and_routes_left_without_a_line() {
        let text = route_lines_features([
            route("r_1", Some(3), &[(46.5, 6.6), (f64::NAN, 6.7), (46.7, 6.8)]),
            route("r_2", Some(4), &[(47.0, 7.0)]),
            route("r_4", Some(5), &[(47.0, 7.0), (47.1, f64::NAN)]),
            route(
                "r_3",
                None,
                &[(48.0, 8.0), (48.1, f64::INFINITY), (48.2, 8.2)],
            ),
        ]);

        let value: serde_json::Value = serde_json::from_str(&text).expect("JSON");
        let features = value["features"].as_array().expect("features");
        assert_eq!(features.len(), 2, "{text}");
        assert_eq!(
            features[0]["properties"],
            serde_json::json!({"id": "r_1", "number": 3, "palette": 112548})
        );
        assert_eq!(
            features[1]["properties"],
            serde_json::json!({"id": "r_3", "number": null, "palette": 112550})
        );
        assert_eq!(features[0]["id"], "r_1");
        assert_eq!(
            positions(&features[0].to_string()),
            vec![vec![6.6, 46.5], vec![6.8, 46.7]]
        );
        assert_eq!(
            positions(&features[1].to_string()),
            vec![vec![8.0, 48.0], vec![8.2, 48.2]]
        );
    }

    #[test]
    fn a_route_colour_key_is_the_one_the_route_list_has_always_drawn() {
        // Each value is what the page computed from the id before the key
        // moved here: the colour of a route must not change with the move.
        for (route_id, key) in [
            ("", 0),
            ("r_1", 112_548),
            ("route_6f1c2e9a-77b0-4d1e-9c57-0c2b1e2f4a11", 1_869_005_781),
            ("kelp-forest-loop", 2_047_232_155),
            ("ñandú-🚲", 1_745_137_650),
        ] {
            assert_eq!(route_palette_key(route_id), key, "{route_id:?}");
        }
    }

    #[test]
    fn no_route_with_a_line_is_an_empty_collection() {
        assert_eq!(route_lines_features([]), EMPTY_COLLECTION);
        assert_eq!(
            route_lines_features([route("r_1", None, &[(1.0, 2.0)])]),
            EMPTY_COLLECTION
        );
    }

    #[test]
    fn route_lines_are_asked_for_under_one_key() {
        assert_eq!(geo_answer("route-lines/r_1"), Err(NOT_FOUND));
    }

    #[test]
    fn a_malformed_path_is_refused_before_anything_is_read() {
        // A path that got as far as a read would answer 404 or 503, never 400.
        for path in [
            "",
            "track",
            "track/",
            "track/../x",
            "track/a/b",
            "track/a.b",
        ] {
            assert_eq!(geo_answer(path), Err(BAD_PATH), "{path:?}");
        }
    }
}
