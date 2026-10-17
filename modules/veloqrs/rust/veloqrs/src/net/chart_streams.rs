//! A stored stream body as the typed series the detail charts read.
//!
//! The body is the intervals.icu array, or one rebuilt from the stored track.
//! It is parsed here once, and the series cross the bridge as float buffers
//! rather than as the JSON text for the JavaScript thread to parse again.

use crate::FfiActivityStreams;
use crate::net::types::{ParsedStreams, StreamDto, parse_streams};

/// The series in a stream body for an activity of `sport`, or `None` when the
/// body is not a stream array, which reads as nothing stored so the caller
/// refetches it.
pub fn chart_streams_from_body(body: &str, sport: &str) -> Option<FfiActivityStreams> {
    let raw: Vec<StreamDto> = match serde_json::from_str(body) {
        Ok(raw) => raw,
        Err(error) => {
            log::warn!("[Streams] a stored stream body did not parse: {error}");
            return None;
        }
    };
    Some(encode_chart_streams(&parse_streams(raw), sport))
}

/// The wire form of parsed streams: little-endian floats per series, and the
/// engine's track encoding for the coordinates. Cadence is in the sport's
/// cadence unit, the one the activity summary gives.
pub fn encode_chart_streams(parsed: &ParsedStreams, sport: &str) -> FfiActivityStreams {
    let latlng = if parsed.latlng.is_empty() {
        Vec::new()
    } else {
        let points: Vec<crate::GpsPoint> = parsed
            .latlng
            .iter()
            .map(|[lat, lng]| crate::GpsPoint::new(*lat, *lng))
            .collect();
        crate::persistence::codec::encode_polyline(&points)
    };
    FfiActivityStreams {
        latlng,
        time: floats(parsed.time.iter().map(|t| *t as f64)),
        altitude: floats(parsed.altitude.iter().copied()),
        heartrate: floats(parsed.heartrate.iter().copied()),
        watts: floats(parsed.watts.iter().copied()),
        cadence: floats(
            parsed
                .cadence
                .iter()
                .map(|c| crate::sport::cadence_per_minute(sport, *c)),
        ),
        velocity_smooth: floats(parsed.velocity_smooth.iter().copied()),
        distance: floats(parsed.distance.iter().copied()),
        grade_smooth: floats(parsed.grade_smooth.iter().copied()),
        temp: floats(parsed.temp.iter().copied()),
        wbal: floats(parsed.wbal.iter().copied()),
        gap: floats(parsed.gap.iter().copied()),
    }
}

fn floats(values: impl ExactSizeIterator<Item = f64>) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 8);
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[cfg(test)]
#[path = "tests/chart_streams.rs"]
mod tests;
