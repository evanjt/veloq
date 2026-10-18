//! The stored interval bodies, parsed into the laps the activity screen reads.
//!
//! The body intervals.icu sends is stored whole in `interval_bodies`, less its
//! null keys. Its intervals carry about eighty keys each and the screen reads
//! thirteen of them, so those are what cross: the lap table, the chart bands
//! and the chips all draw from this one list.
//!
//! Every field is optional in the raw shape because the server omits rather
//! than nulls, and each interval is decoded on its own, so one malformed entry
//! drops only itself and never the laps beside it.

use rusqlite::{Connection, Result as SqlResult};
use serde::Deserialize;

use super::bodies::pooled::interval_body;

/// What an interval is, as intervals.icu labels it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiIntervalKind {
    Work,
    Recovery,
    Rest,
    Warmup,
    Cooldown,
    ActiveRecovery,
    /// A label this build does not know, or none at all.
    Other,
}

impl FfiIntervalKind {
    fn from_wire(label: Option<&str>) -> Self {
        match label {
            Some("WORK") => Self::Work,
            Some("RECOVERY") => Self::Recovery,
            Some("REST") => Self::Rest,
            Some("WARMUP") => Self::Warmup,
            Some("COOLDOWN") => Self::Cooldown,
            Some("ACTIVE_RECOVERY") => Self::ActiveRecovery,
            _ => Self::Other,
        }
    }
}

/// One lap of an activity.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiActivityInterval {
    pub id: u32,
    pub kind: FfiIntervalKind,
    /// The training zone the server placed a work interval in, from 1.
    pub zone: Option<u32>,
    /// Elapsed seconds from the activity start. Index-free, so it survives a
    /// reduction of the streams, which the indices below do not. Every body
    /// measured carries them; the indices place a lap that comes without.
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    /// Positions in the server's own streams.
    pub start_index: u32,
    pub end_index: u32,
    pub average_watts: Option<f64>,
    pub average_heartrate: Option<f64>,
    /// Metres per second.
    pub average_speed: Option<f64>,
    /// Seconds.
    pub moving_time: Option<f64>,
    /// Metres.
    pub distance: Option<f64>,
    /// The name the athlete gave the interval, when they gave one.
    pub label: Option<String>,
}

/// An activity's laps, in the order the server sent them. Empty is a fetched
/// activity with no laps.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiActivityIntervals {
    pub intervals: Vec<FfiActivityInterval>,
}

#[derive(Debug, Deserialize)]
struct RawBody {
    icu_intervals: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct RawInterval {
    id: Option<f64>,
    #[serde(rename = "type")]
    kind: Option<String>,
    zone: Option<f64>,
    start_time: Option<f64>,
    end_time: Option<f64>,
    start_index: Option<f64>,
    end_index: Option<f64>,
    average_watts: Option<f64>,
    average_heartrate: Option<f64>,
    average_speed: Option<f64>,
    moving_time: Option<f64>,
    distance: Option<f64>,
    label: Option<String>,
}

/// A count the wire sends as a JSON number: whole, finite and in range.
fn count(value: f64) -> Option<u32> {
    (value.is_finite() && value >= 0.0 && value <= f64::from(u32::MAX) && value.fract() == 0.0)
        .then_some(value as u32)
}

fn interval_of(value: serde_json::Value) -> Option<FfiActivityInterval> {
    let raw: RawInterval = serde_json::from_value(value).ok()?;
    Some(FfiActivityInterval {
        id: count(raw.id?)?,
        kind: FfiIntervalKind::from_wire(raw.kind.as_deref()),
        zone: raw.zone.and_then(count),
        start_time: raw.start_time,
        end_time: raw.end_time,
        start_index: count(raw.start_index?)?,
        end_index: count(raw.end_index?)?,
        average_watts: raw.average_watts,
        average_heartrate: raw.average_heartrate,
        average_speed: raw.average_speed,
        moving_time: raw.moving_time,
        distance: raw.distance,
        label: raw.label,
    })
}

/// The laps of a stored body, or `None` when the body is not an object at
/// all. An interval with no id, no stream indices or a field of the wrong type
/// is dropped alone.
pub fn parse_activity_intervals(body: &str) -> Option<FfiActivityIntervals> {
    let raw: RawBody = serde_json::from_str(body).ok()?;
    let intervals = raw
        .icu_intervals
        .unwrap_or_default()
        .into_iter()
        .filter_map(interval_of)
        .collect();
    Some(FfiActivityIntervals { intervals })
}

/// An activity's laps, or `None` when its body was never fetched or will not
/// parse, either of which a fetch is what answers.
pub(crate) fn activity_intervals(
    conn: &Connection,
    activity_id: &str,
) -> SqlResult<Option<FfiActivityIntervals>> {
    Ok(interval_body(conn, activity_id)?
        .as_deref()
        .and_then(parse_activity_intervals))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentEngine;
    use tempfile::TempDir;

    fn engine_and_reader() -> (TempDir, PersistentEngine, Connection) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("intervals.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let reader = Connection::open(path).unwrap();
        (dir, engine, reader)
    }

    const THREE_LAPS: &str = r#"{
        "icu_intervals": [
            {"id": 1, "type": "WORK", "zone": 4, "average_watts": 250.0,
             "start_time": 60, "end_time": 360, "start_index": 60, "end_index": 360,
             "average_heartrate": 161.5, "average_speed": 9.2, "moving_time": 300,
             "distance": 2760.0, "label": "Lantern climb"},
            {"id": 2, "type": "RECOVERY", "decoupling": "-Infinity",
             "start_time": 360, "end_time": 480, "start_index": 360, "end_index": 480},
            {"id": 3, "start_time": 480, "end_time": 600, "start_index": 480, "end_index": 600}
        ],
        "icu_groups": []
    }"#;

    #[test]
    fn a_stored_body_reads_back_as_its_laps() {
        let (_dir, engine, reader) = engine_and_reader();
        engine.set_interval_body("ride-1", THREE_LAPS).unwrap();

        let laps = activity_intervals(&reader, "ride-1")
            .unwrap()
            .expect("stored")
            .intervals;

        assert_eq!(laps.len(), 3);
        assert_eq!(laps[0].kind, FfiIntervalKind::Work);
        assert_eq!(laps[0].zone, Some(4));
        assert_eq!(laps[0].average_watts, Some(250.0));
        assert_eq!(
            (laps[0].start_time, laps[0].end_time),
            (Some(60.0), Some(360.0))
        );
        assert_eq!(laps[0].label.as_deref(), Some("Lantern climb"));
        assert_eq!(laps[1].kind, FfiIntervalKind::Recovery);
        assert_eq!(laps[1].id, 2);
        assert_eq!(laps[2].kind, FfiIntervalKind::Other);
        assert_eq!(laps[2].zone, None);
        assert_eq!(laps[2].average_watts, None);
        assert_eq!(laps[2].label, None);
    }

    #[test]
    fn an_activity_never_fetched_has_no_laps_to_read() {
        let (_dir, _engine, reader) = engine_and_reader();
        assert_eq!(activity_intervals(&reader, "never-stored").unwrap(), None);
    }

    #[test]
    fn a_fetched_activity_with_no_laps_reads_as_an_empty_list() {
        let (_dir, engine, reader) = engine_and_reader();
        engine
            .set_interval_body("steady-1", r#"{"icu_intervals":[],"icu_groups":[]}"#)
            .unwrap();
        let read = activity_intervals(&reader, "steady-1").unwrap();
        assert_eq!(read.map(|laps| laps.intervals.len()), Some(0));
    }

    #[test]
    fn a_body_that_will_not_parse_reads_as_never_fetched() {
        let (_dir, engine, reader) = engine_and_reader();
        engine.set_interval_body("torn-1", "{not json").unwrap();
        assert_eq!(activity_intervals(&reader, "torn-1").unwrap(), None);
    }

    #[test]
    fn a_malformed_interval_drops_only_itself() {
        let body = r#"{"icu_intervals": [
            {"id": 1, "type": "WORK", "start_time": 0, "end_time": 60, "start_index": 0, "end_index": 60},
            {"id": 2, "type": "WORK", "average_watts": "lots", "start_time": 60, "end_time": 120, "start_index": 60, "end_index": 120},
            {"id": 3, "type": "WORK", "start_time": 120, "end_time": 180},
            {"id": 4, "type": "WORK", "start_index": 180, "end_index": 240},
            "not an interval",
            {"id": 5, "type": "SPRINT", "start_time": 240, "end_time": 300, "start_index": 240, "end_index": 300}
        ]}"#;
        let laps = parse_activity_intervals(body).expect("parses").intervals;
        let ids: Vec<u32> = laps.iter().map(|lap| lap.id).collect();
        assert_eq!(ids, vec![1, 4, 5]);
        assert_eq!(laps[1].start_time, None);
        assert_eq!(laps[2].kind, FfiIntervalKind::Other);
    }

    fn fetched_bodies() -> serde_json::Map<String, serde_json::Value> {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../../src/__tests__/__fixtures__/intervalBodies.json"
        ))
        .unwrap();
        fixture.as_object().unwrap().clone()
    }

    #[test]
    fn every_interval_of_the_fetched_fixture_survives_the_read() {
        for (name, body) in fetched_bodies() {
            let sent = body["icu_intervals"].as_array().unwrap().len();
            let read = parse_activity_intervals(&body.to_string()).expect("parses");
            assert_eq!(read.intervals.len(), sent, "{name}");
        }
    }

    /// The store drops every null key, and a lap reads the same either way.
    #[test]
    fn a_stored_body_reads_as_the_body_that_was_fetched() {
        let (_dir, engine, reader) = engine_and_reader();
        for (name, body) in fetched_bodies() {
            let fetched = body.to_string();
            engine.set_interval_body(&name, &fetched).unwrap();
            assert_eq!(
                activity_intervals(&reader, &name).unwrap(),
                parse_activity_intervals(&fetched),
                "{name}"
            );
        }
    }
}
