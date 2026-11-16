//! Training Center XML activities.
//!
//! Every `Trackpoint` of every `Activity` is a point, in file order. A
//! trackpoint carries its time, position, altitude, cumulative distance,
//! heart rate and bike cadence as children, and run cadence, speed and power
//! in its `TPX` extension. The sport is the first activity's `Sport` attribute
//! when it is Running or Biking: the format's third value, Other, names none.

use super::xml_ride::{self, Item, Point};
use crate::fit::FitActivity;

fn sport_of(name: &str) -> Option<u8> {
    match name.trim().to_ascii_lowercase().as_str() {
        "running" => Some(1),
        "biking" => Some(2),
        _ => None,
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<FitActivity, String> {
    let mut points = Vec::new();
    let mut current: Option<Point> = None;
    let mut position: (Option<f64>, Option<f64>) = (None, None);
    let mut sport = None;
    let mut seen_activity = false;
    xml_ride::scan(bytes, |stack, item| {
        let name = stack.last().map_or("", String::as_str);
        match item {
            Item::Start(start) if name == "Activity" && !seen_activity => {
                seen_activity = true;
                sport = xml_ride::attribute(start, "Sport").and_then(|s| sport_of(&s));
            }
            Item::Start(_) if name == "Trackpoint" => {
                current = Some(Point::default());
                position = (None, None);
            }
            Item::End if name == "Trackpoint" => {
                if let Some(mut point) = current.take() {
                    point.position = position.0.zip(position.1);
                    points.push(point);
                }
            }
            Item::Text(text) => {
                let Some(point) = current.as_mut() else {
                    return;
                };
                let parent = stack.len().checked_sub(2).map_or("", |i| stack[i].as_str());
                let value = xml_ride::number(text);
                match (parent, name) {
                    ("Trackpoint", "Time") => point.time = xml_ride::parse_time(text),
                    ("Trackpoint", "AltitudeMeters") => point.altitude = value,
                    ("Trackpoint", "DistanceMeters") => point.distance = value,
                    ("Trackpoint", "Cadence") => point.cadence = value,
                    ("Position", "LatitudeDegrees") => position.0 = value,
                    ("Position", "LongitudeDegrees") => position.1 = value,
                    ("HeartRateBpm", "Value") => point.heart_rate = value,
                    ("TPX", "Watts") => point.power = value,
                    ("TPX", "Speed") => point.speed = value,
                    ("TPX", "RunCadence") => point.cadence = point.cadence.or(value),
                    _ => {}
                }
            }
            _ => {}
        }
    })?;
    if points.is_empty() {
        return Err("the TCX holds no trackpoints".to_string());
    }
    xml_ride::activity(points, sport)
}
