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

use crate::GpsPoint;

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

/// The points as one `LineString` feature, `[lng, lat]` at six places.
///
/// Every stored point is kept but those with no finite coordinate, which is
/// the line the readers of the decoded track draw and the chart scrubber
/// indexes into. Under two points there is no line, and the answer is an empty
/// collection.
pub fn line_feature(points: &[GpsPoint]) -> String {
    let finite = || {
        points
            .iter()
            .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
    };
    if finite().take(2).count() < 2 {
        return EMPTY_COLLECTION.to_string();
    }
    const HEAD: &str =
        r#"{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":["#;
    const TAIL: &str = "]}}";
    // A position is about 22 characters at six places.
    let mut out = String::with_capacity(HEAD.len() + TAIL.len() + points.len() * 24);
    out.push_str(HEAD);
    for (i, point) in finite().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        push_degrees(&mut out, point.longitude);
        out.push(',');
        push_degrees(&mut out, point.latitude);
        out.push(']');
    }
    out.push_str(TAIL);
    out
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
