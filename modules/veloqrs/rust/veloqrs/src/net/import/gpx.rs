//! GPX 1.0 and 1.1 tracks.
//!
//! Every `trkpt` of every `trk` is a point, in file order. A point's elevation
//! and time are its own children; heart rate, cadence and power are read from
//! whichever extension element carries them by name (`hr`, `cad`, `power`),
//! whatever its namespace prefix. The sport comes from the track's `type` when
//! it names one of the sports the library knows.

use super::xml_ride::{self, Item, Point};
use crate::fit::FitActivity;

/// The profile's Sport number for a GPX track type, `None` when the type is
/// not a name the library maps.
fn sport_of(track_type: &str) -> Option<u8> {
    match track_type.trim().to_ascii_lowercase().as_str() {
        "running" | "run" | "trail running" | "trail_running" => Some(1),
        "cycling" | "biking" | "bike" | "ride" | "road biking" | "mountain biking" => Some(2),
        "swimming" | "swim" => Some(5),
        "walking" | "walk" => Some(11),
        "hiking" | "hike" => Some(17),
        _ => None,
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<FitActivity, String> {
    let mut points = Vec::new();
    let mut current: Option<Point> = None;
    let mut sport = None;
    xml_ride::scan(bytes, |stack, item| {
        let name = stack.last().map_or("", String::as_str);
        match item {
            Item::Start(start) if name == "trkpt" => {
                let coordinate =
                    |key: &str| xml_ride::attribute(start, key).and_then(|v| xml_ride::number(&v));
                current = Some(Point {
                    position: coordinate("lat").zip(coordinate("lon")),
                    ..Point::default()
                });
            }
            Item::End if name == "trkpt" => points.extend(current.take()),
            Item::Text(text) => {
                if let Some(point) = current.as_mut() {
                    match name {
                        "ele" => point.altitude = xml_ride::number(text),
                        "time" => point.time = xml_ride::parse_time(text),
                        "hr" | "heartrate" => point.heart_rate = xml_ride::number(text),
                        "cad" | "cadence" => point.cadence = xml_ride::number(text),
                        "power" | "watts" => point.power = xml_ride::number(text),
                        "speed" => point.speed = xml_ride::number(text),
                        _ => {}
                    }
                } else if name == "type" && stack.len() >= 2 && stack[stack.len() - 2] == "trk" {
                    sport = sport.or_else(|| sport_of(text));
                }
            }
            _ => {}
        }
    })?;
    if points.is_empty() {
        return Err("the GPX holds no track points".to_string());
    }
    xml_ride::activity(points, sport)
}
