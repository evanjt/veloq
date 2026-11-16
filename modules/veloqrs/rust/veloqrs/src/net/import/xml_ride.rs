//! A ride read from a GPX or TCX file, in the shape a decoded FIT has.
//!
//! Both formats are a list of timed points, each with a position and, where
//! the recording carried them, elevation, heart rate, cadence and power. This
//! module owns the scan of the XML and the activity built from the points, so
//! the two readers differ only in the names they look for.
//!
//! A point with no time cannot be placed in the ride and is dropped; a file
//! none of whose points has a time has no start and is refused, as a FIT with
//! no date is.

use crate::fit::{FitActivity, FitSample, FitTotals};
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

/// Mean Earth radius in metres, for the distance between two fixes.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// One timed point of a track, as the file wrote it.
#[derive(Debug, Default, Clone)]
pub(super) struct Point {
    /// Unix seconds, and the offset from UTC the time was written with.
    pub time: Option<(i64, i64)>,
    pub position: Option<(f64, f64)>,
    pub altitude: Option<f64>,
    pub distance: Option<f64>,
    pub heart_rate: Option<f64>,
    pub cadence: Option<f64>,
    pub power: Option<f64>,
    pub speed: Option<f64>,
}

/// What a scan hands the format's reader for each element.
pub(super) enum Item<'a> {
    Start(&'a BytesStart<'a>),
    Text(&'a str),
    End,
}

/// The local name of an element, without its namespace prefix.
pub(super) fn local(start: &BytesStart<'_>) -> String {
    String::from_utf8_lossy(start.local_name().as_ref()).into_owned()
}

/// An attribute's value by local name.
pub(super) fn attribute(start: &BytesStart<'_>, name: &str) -> Option<String> {
    start.attributes().flatten().find_map(|a| {
        (a.key.local_name().as_ref() == name.as_bytes())
            .then(|| {
                a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                    .ok()
                    .map(|v| v.into_owned())
            })
            .flatten()
    })
}

/// Walk the document, calling `visit` with the open elements' local names
/// (the current one last) and each start, text and end. The text of an element
/// arrives trimmed and only when it is not empty.
pub(super) fn scan(bytes: &[u8], mut visit: impl FnMut(&[String], Item<'_>)) -> Result<(), String> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<String> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                stack.push(local(&start));
                visit(&stack, Item::Start(&start));
            }
            Ok(Event::Empty(start)) => {
                stack.push(local(&start));
                visit(&stack, Item::Start(&start));
                visit(&stack, Item::End);
                stack.pop();
            }
            Ok(Event::Text(text)) => {
                let text = text.decode().map_err(|e| e.to_string())?;
                if !text.is_empty() {
                    visit(&stack, Item::Text(&text));
                }
            }
            Ok(Event::End(_)) => {
                visit(&stack, Item::End);
                stack.pop();
            }
            Ok(Event::Eof) => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!(
                    "the XML did not parse at byte {}: {e}",
                    reader.buffer_position()
                ));
            }
        }
    }
}

/// An RFC 3339 time as Unix seconds and the offset it was written with.
pub(super) fn parse_time(text: &str) -> Option<(i64, i64)> {
    let parsed = chrono::DateTime::parse_from_rfc3339(text.trim()).ok()?;
    Some((
        parsed.timestamp(),
        i64::from(parsed.offset().local_minus_utc()),
    ))
}

/// A finite number from text.
pub(super) fn number(text: &str) -> Option<f64> {
    text.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

fn haversine(a: (f64, f64), b: (f64, f64)) -> f64 {
    let (lat_a, lat_b) = (a.0.to_radians(), b.0.to_radians());
    let d_lat = lat_b - lat_a;
    let d_lon = (b.1 - a.1).to_radians();
    let h = (d_lat / 2.0).sin().powi(2) + lat_a.cos() * lat_b.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().asin()
}

fn valid_fix(lat: f64, lon: f64) -> bool {
    (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)
}

fn mean(values: impl Iterator<Item = f64>) -> Option<f64> {
    let (sum, n) = values.fold((0.0, 0_u32), |(s, n), v| (s + v, n + 1));
    (n > 0).then(|| sum / f64::from(n))
}

/// Build the activity from the points of the file, in file order.
///
/// `sport` is the profile's Sport number when the file names one. Distance is
/// the file's own cumulative figure when every sample carries one, else the
/// sum of the great-circle steps between fixes. Moving time is the elapsed
/// span, since neither format records a timer.
pub(super) fn activity(points: Vec<Point>, sport: Option<u8>) -> Result<FitActivity, String> {
    let timed: Vec<&Point> = points.iter().filter(|p| p.time.is_some()).collect();
    let (Some(first), Some(last)) = (timed.first(), timed.last()) else {
        return Err("the file carries no timestamps".to_string());
    };
    let (start_unix, offset) = first.time.unwrap_or_default();
    let end_unix = last.time.map_or(start_unix, |t| t.0);
    if end_unix < start_unix {
        return Err("the file's points run backwards in time".to_string());
    }
    let from_file = timed.iter().all(|p| p.distance.is_some());

    let mut samples = Vec::with_capacity(timed.len());
    let mut walked = 0.0;
    let mut previous: Option<(f64, f64)> = None;
    for point in &timed {
        let position = point.position.filter(|(lat, lon)| valid_fix(*lat, *lon));
        if let (Some(from), Some(to)) = (previous, position) {
            walked += haversine(from, to);
        }
        previous = position.or(previous);
        samples.push(FitSample {
            timestamp: point.time.map_or(start_unix, |t| t.0),
            position,
            altitude: point.altitude,
            heart_rate: point.heart_rate.filter(|v| *v > 0.0),
            cadence: point.cadence,
            distance: if from_file {
                point.distance
            } else {
                Some(walked)
            },
            speed: point.speed,
            power: point.power,
        });
    }

    let ascent = samples
        .windows(2)
        .filter_map(|pair| Some(pair[1].altitude? - pair[0].altitude?))
        .filter(|rise| *rise > 0.0)
        .sum::<f64>();
    let has_altitude = samples.iter().any(|s| s.altitude.is_some());
    let elapsed = (end_unix - start_unix) as f64;
    let distance = samples.last().and_then(|s| s.distance).filter(|d| *d > 0.0);
    let heart = || samples.iter().filter_map(|s| s.heart_rate);
    let power = || samples.iter().filter_map(|s| s.power);
    let totals = FitTotals {
        moving_secs: Some(elapsed),
        elapsed_secs: Some(elapsed),
        distance,
        ascent: has_altitude.then_some(ascent),
        max_heart_rate: heart().reduce(f64::max),
        avg_heart_rate: mean(heart()),
        avg_cadence: mean(samples.iter().filter_map(|s| s.cadence)),
        max_power: power().reduce(f64::max),
        avg_power: mean(power()),
        ..FitTotals::default()
    };
    Ok(FitActivity {
        start_unix,
        utc_offset_secs: (offset != 0).then_some(offset),
        sport,
        samples,
        totals,
        ..FitActivity::default()
    })
}
