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
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, uniffi::Enum)]
#[serde(rename_all = "camelCase")]
pub enum FfiIntervalKind {
    Work,
    Recovery,
    Rest,
    Warmup,
    Cooldown,
    ActiveRecovery,
    /// A stretch the recording device closed, read from the activity's own
    /// file rather than detected by the server.
    Lap,
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
            Some("lap") => Self::Lap,
            _ => Self::Other,
        }
    }
}

/// One lap of an activity.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiActivityIntervals {
    pub intervals: Vec<FfiActivityInterval>,
}

/// The body written for an activity whose laps come from its own file, in the
/// shape of the server's, from the laps the recording holds.
///
/// Each lap carries its elapsed seconds from the start and the positions of
/// its first and last sample in the activity's `time` series, so the table, the
/// chips and the chart bands read it as they read a server's. A lap with no
/// sample inside it is left out. A recording with fewer than two laps, or with
/// no samples, writes nothing: one lap is the whole ride.
pub fn lap_body(activity: &crate::fit::FitActivity) -> Option<String> {
    if activity.laps.len() < 2 || activity.samples.is_empty() {
        return None;
    }
    let offsets: Vec<i64> = activity
        .samples
        .iter()
        .map(|sample| sample.timestamp - activity.start_unix)
        .collect();
    let mut intervals = Vec::new();
    for lap in &activity.laps {
        let start = lap.start_unix - activity.start_unix;
        let span = lap.elapsed_secs.or(lap.timer_secs)?;
        let end = start as f64 + span;
        let Some(first) = offsets.iter().position(|&at| at >= start) else {
            continue;
        };
        let Some(last) = offsets.iter().rposition(|&at| at as f64 <= end) else {
            continue;
        };
        if last < first {
            continue;
        }
        let timer = lap.timer_secs.unwrap_or(span);
        let speed = lap
            .avg_speed
            .or_else(|| lap.distance.filter(|_| timer > 0.0).map(|d| d / timer));
        let mut entry = serde_json::Map::new();
        let mut put = |key: &str, value: Option<f64>| {
            if let Some(number) = value.filter(|v| v.is_finite()) {
                entry.insert(key.into(), number.into());
            }
        };
        put("id", Some((intervals.len() + 1) as f64));
        put("start_time", Some(start as f64));
        put("end_time", Some(end));
        put("start_index", Some(first as f64));
        put("end_index", Some(last as f64));
        put("moving_time", Some(timer));
        put("distance", lap.distance);
        put("average_speed", speed);
        put("average_heartrate", lap.avg_heart_rate);
        put("average_watts", lap.avg_power);
        put("average_cadence", lap.avg_cadence);
        entry.insert("type".into(), "lap".into());
        intervals.push(serde_json::Value::Object(entry));
    }
    if intervals.len() < 2 {
        return None;
    }
    Some(
        serde_json::json!({
            "icu_intervals": intervals,
            "icu_groups": [],
            "source": "veloq",
        })
        .to_string(),
    )
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

    fn ride_with_laps(laps: &[(u32, f64)]) -> crate::fit::FitActivity {
        let mut ride = crate::fit_synthetic::outdoor_ride();
        ride.laps = laps
            .iter()
            .map(|&(start, elapsed_secs)| crate::fit_synthetic::Lap {
                start,
                elapsed_secs,
                timer_secs: Some(elapsed_secs - 1.0),
                distance: Some(elapsed_secs * 6.0),
                avg_heart_rate: Some(130),
                avg_power: Some(210),
                ..Default::default()
            })
            .collect();
        crate::fit::parse_fit_activity(&ride.to_fit()).unwrap()
    }

    #[test]
    fn three_laps_in_a_file_become_three_intervals_placed_in_the_time_stream() {
        let activity = ride_with_laps(&[(0, 10.0), (10, 10.0), (20, 9.0)]);
        let body = lap_body(&activity).expect("three laps write a body");
        let read = parse_activity_intervals(&body).unwrap().intervals;

        assert_eq!(read.len(), 3);
        assert!(read.iter().all(|lap| lap.kind == FfiIntervalKind::Lap));
        let time = activity.streams().remove(0).data;
        for lap in &read {
            let at = |index: u32| time[index as usize].unwrap();
            assert_eq!(Some(at(lap.start_index)), lap.start_time.map(|t| t.ceil()));
            assert!(at(lap.end_index) <= lap.end_time.unwrap());
        }
        assert_eq!((read[0].start_index, read[0].end_index), (0, 10));
        assert_eq!((read[1].start_index, read[1].end_index), (10, 20));
        assert_eq!((read[2].start_index, read[2].end_index), (20, 29));
        assert_eq!(read[0].moving_time, Some(9.0));
        assert_eq!(read[0].distance, Some(60.0));
        assert_eq!(read[0].average_heartrate, Some(130.0));
        assert_eq!(read[0].average_watts, Some(210.0));
        assert_eq!(read[0].average_speed, Some(60.0 / 9.0));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap()["source"],
            "veloq"
        );
    }

    #[test]
    fn a_file_with_one_lap_or_none_writes_no_body() {
        assert_eq!(lap_body(&ride_with_laps(&[(0, 29.0)])), None);
        assert_eq!(lap_body(&ride_with_laps(&[])), None);
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
