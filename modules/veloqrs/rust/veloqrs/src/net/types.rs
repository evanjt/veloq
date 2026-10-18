//! Parsed output records the app consumes, and the stream shape that is both
//! the wire format and the stored track format.
//!
//! The intervals.icu wire records live in `net::intervals::wire` and are
//! re-exported here for the paths that still name them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use super::intervals::wire::{
    ACTIVITY_FIELDS, ACTIVITY_STATS_EXTRA, ActivityRecord, AthleteRecord, CensusRecord,
    ListedActivity, ManualActivityBody, WellnessRecord, ZoneTime, activity_counts_by_year,
    activity_list_fields, oldest_activity_date, stored_activity_fields,
};

// ===========================================================================
// Streams
// ===========================================================================

/// One raw stream object from `streams.json`. `latlng` carries lat in `data`
/// and lng in `data2`; numeric gaps come through as JSON null.
///
/// Serialised as well as deserialised, because a body rebuilt from the stored
/// track is read by the same `parse_streams` a live response goes through.
/// `data2` is skipped when absent so a reconstruction is byte-shaped like a
/// server response rather than carrying a null the wire never sends.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StreamDto {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub data: Vec<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data2: Option<Vec<Option<f64>>>,
}

/// One series whose sample count disagrees with the `latlng` index space. The
/// server sends every series at the same length, so a disagreement means the
/// response is malformed and the parsed values cannot be trusted positionally.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeriesLengthMismatch {
    pub series: &'static str,
    /// Samples the series carries.
    pub len: usize,
    /// Samples the `latlng` index space covers.
    pub expected: usize,
}

/// Parsed, app-facing streams.
///
/// Every series shares one index space: when the response carries `latlng`,
/// samples whose coordinate pair is null are dropped from all series alike, so
/// `latlng[i]` and `altitude[i]` describe the same sample. Any series that did
/// not line up with that space is listed in `misaligned`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedStreams {
    pub time: Vec<i64>,
    pub latlng: Vec<[f64; 2]>,
    pub altitude: Vec<f64>,
    pub altitude_is_fixed: bool,
    /// The detail charts' other series, in the same index space. Empty when
    /// the response did not carry the series.
    pub heartrate: Vec<f64>,
    pub watts: Vec<f64>,
    pub cadence: Vec<f64>,
    pub velocity_smooth: Vec<f64>,
    pub distance: Vec<f64>,
    pub grade_smooth: Vec<f64>,
    pub temp: Vec<f64>,
    /// W' balance, joules remaining.
    pub wbal: Vec<f64>,
    /// Grade-adjusted pace in minutes per kilometre, from `ga_velocity`.
    pub gap: Vec<f64>,
    pub misaligned: Vec<SeriesLengthMismatch>,
}

/// What a response that asked for `time` says about the clock of the track
/// its coordinates make.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrackClock {
    /// Whole seconds at each point of the track. A negative sample is clamped
    /// rather than dropped.
    Fits(Vec<u32>),
    /// The response carried no `time`: upstream has none for the activity.
    Absent,
    /// A `time` that cannot address the track: no coordinates to mask it by,
    /// or another length than `latlng`. The mask would still hand back one
    /// sample per point, padding or cutting the series, and a section reads
    /// its lap times by indexing that series with the stored track's own
    /// indices, so it is not stored and the activity stays owed a clock.
    OutOfStep,
}

/// The one reading of a response's clock against its coordinates, shared by
/// every request that asks for `time` so none of them stores a clock the
/// others would refuse.
pub fn track_clock(parsed: &ParsedStreams) -> TrackClock {
    if parsed.time.is_empty() {
        return TrackClock::Absent;
    }
    let aligned = !parsed.latlng.is_empty()
        && parsed.time.len() == parsed.latlng.len()
        && !parsed.misaligned.iter().any(|m| m.series == "time");
    if !aligned {
        return TrackClock::OutOfStep;
    }
    TrackClock::Fits(parsed.time.iter().map(|v| (*v).max(0) as u32).collect())
}

/// The clock when it fits the track, else empty.
pub fn track_times(parsed: &ParsedStreams) -> Vec<u32> {
    match track_clock(parsed) {
        TrackClock::Fits(times) => times,
        TrackClock::Absent | TrackClock::OutOfStep => Vec::new(),
    }
}

impl TrackClock {
    /// What a store step records: the clock, an empty one for a recorded
    /// absence, or `None` for nothing to record.
    pub fn to_store(&self) -> Option<&[u32]> {
        match self {
            TrackClock::Fits(times) => Some(times),
            TrackClock::Absent => Some(&[]),
            TrackClock::OutOfStep => None,
        }
    }
}

/// Minutes per kilometre for one speed sample in metres per second. A missing
/// sample stays NaN so a chart reads it as absent; a stopped or non-finite
/// speed reads 0 rather than an infinite pace.
fn pace_minutes_from_sample(speed_ms: f64) -> f64 {
    if speed_ms.is_nan() {
        return f64::NAN;
    }
    if speed_ms <= 0.0 || !speed_ms.is_finite() {
        return 0.0;
    }
    let pace = 1000.0 / speed_ms / 60.0;
    if pace.is_finite() { pace } else { 0.0 }
}

fn fill(v: &[Option<f64>]) -> Vec<f64> {
    v.iter().map(|x| x.unwrap_or(f64::NAN)).collect()
}

/// A coordinate the engine will store. The validity mask, the parsed `latlng`
/// and the stored track share this gate, so every series stays in the index
/// space the stored points actually occupy. The range rule is the detector's,
/// so a stored point is never one the detector would refuse.
pub(crate) fn is_storable(lat: f64, lng: f64) -> bool {
    crate::GpsPoint::new(lat, lng).is_valid()
}

/// A sample from a live recording. The recorder pads a sample with no position
/// as `[0, 0]`, so that placeholder is dropped as well as any unstorable point.
pub(crate) fn is_recorded_fix(lat: f64, lng: f64) -> bool {
    is_storable(lat, lng) && (lat != 0.0 || lng != 0.0)
}

/// Sample validity taken from `latlng`: true where both lat and lng are present.
/// `None` when the response carries no usable `latlng`, in which case every
/// series keeps its own length.
fn latlng_mask(raw: &[StreamDto], misaligned: &mut Vec<SeriesLengthMismatch>) -> Option<Vec<bool>> {
    let s = raw.iter().find(|s| s.kind == "latlng")?;
    let Some(lng) = s.data2.as_ref() else {
        log::warn!(
            "[Streams] latlng carries {} lat samples and no lng series",
            s.data.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: "latlng",
            len: s.data.len(),
            expected: 0,
        });
        return None;
    };
    let n = s.data.len().min(lng.len());
    let longest = s.data.len().max(lng.len());
    if longest != n {
        log::warn!(
            "[Streams] latlng carries {} lat and {} lng samples",
            s.data.len(),
            lng.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: "latlng",
            len: longest,
            expected: n,
        });
    }
    Some(
        (0..n)
            .map(|i| match (s.data[i], lng[i]) {
                (Some(la), Some(lo)) => is_storable(la, lo),
                _ => false,
            })
            .collect(),
    )
}

/// One series reduced to the valid samples, gaps as NaN. A series whose length
/// disagrees with the mask source is recorded in `misaligned` and logged before
/// it is reduced, so a discarded tail or a padded gap never passes unremarked.
fn select(
    kind: &'static str,
    mask: Option<&[bool]>,
    v: &[Option<f64>],
    misaligned: &mut Vec<SeriesLengthMismatch>,
) -> Vec<f64> {
    let Some(m) = mask else {
        return fill(v);
    };
    if v.len() != m.len() {
        log::warn!(
            "[Streams] series {} carries {} samples, the latlng index space covers {}",
            kind,
            v.len(),
            m.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: kind,
            len: v.len(),
            expected: m.len(),
        });
    }
    m.iter()
        .enumerate()
        .filter(|(_, keep)| **keep)
        .map(|(i, _)| v.get(i).copied().flatten().unwrap_or(f64::NAN))
        .collect()
}

/// The series worth putting in the durable store, in the `latlng` index space
/// the track is stored in and in the units the server sent.
///
/// `ParsedStreams` is not the source. It converts `ga_velocity` to pace and
/// fills gaps with NaN, and a store holds what arrived rather than what a
/// chart wanted. What it does share is the mask: every stored series is
/// addressed by the same indices as the stored coordinates.
///
/// Dropped here: the series `gps_tracks` and `time_streams` already answer, a
/// series whose length disagrees with the coordinates, and a series that is
/// all gaps. A row of nothing reads downstream as "the ride had no power",
/// which is a different claim from "nothing has been fetched yet".
pub fn storable_series(raw: &[StreamDto]) -> Vec<StreamDto> {
    use crate::persistence::streams::FROM_THE_TRACK;

    let mut ignored = Vec::new();
    let Some(mask) = latlng_mask(raw, &mut ignored) else {
        return Vec::new();
    };

    raw.iter()
        .filter(|s| !FROM_THE_TRACK.contains(&s.kind.as_str()))
        // The drop that lets the reader's guard stay defensive rather than
        // load-bearing. Silent, it would also be the only evidence that a real
        // body ever arrives misaligned, so it says so on the way out.
        .filter(|s| {
            let aligned = s.data.len() == mask.len();
            if !aligned {
                log::warn!(
                    "[Streams] series {} carries {} samples, the latlng index space covers {}, not stored",
                    s.kind,
                    s.data.len(),
                    mask.len()
                );
            }
            aligned
        })
        .filter_map(|s| {
            let data: Vec<Option<f64>> = mask
                .iter()
                .enumerate()
                .filter(|(_, keep)| **keep)
                .map(|(i, _)| s.data[i].filter(|v| v.is_finite()))
                .collect();
            data.iter().any(Option::is_some).then(|| StreamDto {
                kind: s.kind.clone(),
                data,
                data2: None,
            })
        })
        .collect()
}

/// The series worth storing for an activity with no track, in the server's
/// own sample index, which its `time` series addresses.
///
/// With no coordinates there is no mask and no stored track to line up with,
/// so the index the server sent is the only one there is, and `time` is kept
/// as the store's record of it. Nothing comes back without a `time` series to
/// index by, or with one that is all gaps, nor from a response that carries coordinates, which belongs to
/// [`storable_series`]. A series of another length than `time`'s, or one that
/// is all gaps, is dropped for the reasons that function gives, and a response
/// holding nothing beyond its clock comes back empty: a lone `time` row would
/// report the activity as stocked.
pub fn trackless_series(raw: &[StreamDto]) -> Vec<StreamDto> {
    if raw.iter().any(|s| s.kind == "latlng") {
        return Vec::new();
    }
    let Some(samples) = raw.iter().find(|s| s.kind == "time").map(|s| s.data.len()) else {
        return Vec::new();
    };
    let kept: Vec<StreamDto> = raw
        .iter()
        .filter(|s| {
            let aligned = s.data.len() == samples;
            if !aligned {
                log::warn!(
                    "[Streams] series {} carries {} samples, the time index covers {}, not stored",
                    s.kind,
                    s.data.len(),
                    samples
                );
            }
            aligned
        })
        .filter_map(|s| {
            let data: Vec<Option<f64>> =
                s.data.iter().map(|v| v.filter(|v| v.is_finite())).collect();
            data.iter().any(Option::is_some).then(|| StreamDto {
                kind: s.kind.clone(),
                data,
                data2: None,
            })
        })
        .collect();
    let indexed = kept.iter().any(|s| s.kind == "time");
    if !indexed || kept.iter().all(|s| s.kind == "time") {
        return Vec::new();
    }
    kept
}

/// Convert raw stream objects into the parsed shape: zip latlng data/data2,
/// prefer a usable `fixed_altitude` over `altitude`, convert `ga_velocity` (m/s)
/// to gap pace (min/km).
///
/// The `latlng` validity mask governs every series, so all of them come back the
/// same length in one index space, so the chart cursor and the map cursor index
/// the same samples. The detail charts' series ride along, for
/// `chart_streams_from_body`.
pub fn parse_streams(raw: Vec<StreamDto>) -> ParsedStreams {
    let mut out = ParsedStreams::default();
    let mut misaligned = Vec::new();
    let mask = latlng_mask(&raw, &mut misaligned);
    let mask = mask.as_deref();
    let mut fixed_altitude: Option<Vec<f64>> = None;
    let mut device_altitude: Option<Vec<f64>> = None;
    for s in raw {
        match s.kind.as_str() {
            // A NaN gap saturates to 0 on the cast.
            "time" => {
                out.time = select("time", mask, &s.data, &mut misaligned)
                    .into_iter()
                    .map(|x| x as i64)
                    .collect()
            }
            "latlng" => {
                if let Some(lng) = &s.data2 {
                    let n = s.data.len().min(lng.len());
                    out.latlng = (0..n)
                        .filter_map(|i| match (s.data[i], lng[i]) {
                            (Some(la), Some(lo)) if is_storable(la, lo) => Some([la, lo]),
                            _ => None,
                        })
                        .collect();
                }
            }
            "altitude" => {
                device_altitude = Some(select("altitude", mask, &s.data, &mut misaligned));
            }
            "fixed_altitude" => {
                fixed_altitude = Some(select("fixed_altitude", mask, &s.data, &mut misaligned));
            }
            "heartrate" => out.heartrate = select("heartrate", mask, &s.data, &mut misaligned),
            "watts" => out.watts = select("watts", mask, &s.data, &mut misaligned),
            "cadence" => out.cadence = select("cadence", mask, &s.data, &mut misaligned),
            "velocity_smooth" => {
                out.velocity_smooth = select("velocity_smooth", mask, &s.data, &mut misaligned)
            }
            "distance" => out.distance = select("distance", mask, &s.data, &mut misaligned),
            "grade_smooth" => {
                out.grade_smooth = select("grade_smooth", mask, &s.data, &mut misaligned)
            }
            "temp" => out.temp = select("temp", mask, &s.data, &mut misaligned),
            "w_bal" => out.wbal = select("w_bal", mask, &s.data, &mut misaligned),
            "ga_velocity" => {
                out.gap = select("ga_velocity", mask, &s.data, &mut misaligned)
                    .into_iter()
                    .map(pace_minutes_from_sample)
                    .collect()
            }
            _ => {}
        }
    }
    // The corrected series wins only when it holds a finite sample, whichever
    // order the response listed the two in.
    let usable = |v: &Vec<f64>| v.iter().any(|x| x.is_finite());
    match (fixed_altitude, device_altitude) {
        (Some(fixed), _) if usable(&fixed) => {
            out.altitude = fixed;
            out.altitude_is_fixed = true;
        }
        (fixed, device) => out.altitude = device.or(fixed).unwrap_or_default(),
    }
    out.misaligned = misaligned;
    out
}

// ===========================================================================
// History
// ===========================================================================

/// The athlete's whole activity history, reduced to what the history slider
/// needs: where it may reach back to, and how much sits in each year on the
/// way. Both come from one response, so neither costs a request of its own.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActivityHistorySummary {
    pub oldest: Option<String>,
    pub counts_by_year: BTreeMap<String, u32>,
    /// Every activity the response carried, in the order it arrived. The same
    /// pull that answers the timeline slider is the census that says which
    /// stored activities have left, and which upstream activities the device
    /// has never seen, so throwing it away costs a second request.
    pub entries: Vec<ActivityCensusEntry>,
}

impl ActivityHistorySummary {
    /// The census ids alone, for the reconcile that only asks what still exists.
    pub fn ids(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.id.clone()).collect()
    }
}

/// One activity as the census pull sees it: what it is, when it was made and
/// when it last changed upstream. `created` and `icu_sync_date` are what make
/// the diff possible, since intervals.icu has no updated-since filter, probed
/// under three names on 2026-09-14 and all returning the full list.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActivityCensusEntry {
    pub id: String,
    pub start_date_local: Option<String>,
    pub created: Option<String>,
    pub icu_sync_date: Option<String>,
    /// Whether the server holds a GPS track for this activity.
    ///
    /// Reduced from `stream_types` at the pull rather than carried whole: one
    /// bit is what every caller asks of it, and the alternative was parsing
    /// every stored body for the same answer. A response that names no
    /// `stream_types` at all is false, because a field the API omits is not a
    /// track.
    pub has_latlng: bool,
    /// Whether `stream_types` names a series the stream pass would store,
    /// beyond the coordinates and the time index. What lets an activity with
    /// no track join that pass without asking about every one that has
    /// nothing to give, read through [`carries_a_storable_series`].
    pub has_series: bool,
}

impl ActivityCensusEntry {
    /// The one reduction of an activity's upstream fields to its census row,
    /// whether they came from the census pull or a single detail fetch.
    fn reduce(
        id: &str,
        start_date_local: &Option<String>,
        created: &Option<String>,
        icu_sync_date: &Option<String>,
        stream_types: Option<&[String]>,
    ) -> Self {
        ActivityCensusEntry {
            id: id.to_string(),
            start_date_local: start_date_local.clone(),
            created: created.clone(),
            icu_sync_date: icu_sync_date.clone(),
            has_latlng: stream_types.is_some_and(|types| types.iter().any(|t| t == "latlng")),
            has_series: stream_types.is_some_and(carries_a_storable_series),
        }
    }
}

impl From<&ActivityRecord> for ActivityCensusEntry {
    /// The census row an activity body names.
    fn from(record: &ActivityRecord) -> Self {
        Self::reduce(
            &record.id,
            &record.start_date_local,
            &record.created,
            &record.icu_sync_date,
            record.stream_types.as_deref(),
        )
    }
}

impl From<&CensusRecord> for ActivityCensusEntry {
    /// The census row the census pull names.
    fn from(record: &CensusRecord) -> Self {
        Self::reduce(
            &record.id,
            &record.start_date_local,
            &record.created,
            &record.icu_sync_date,
            record.stream_types.as_deref(),
        )
    }
}

/// Whether an activity whose `stream_types` reads `types` carries a series the
/// stream pass asks for and would store: anything in `DEFAULT_STREAM_TYPES`
/// but `latlng`, which is the track, and `time`, which only indexes the rest.
pub fn carries_a_storable_series(types: &[String]) -> bool {
    use crate::net::intervals::endpoints::DEFAULT_STREAM_TYPES;
    types.iter().any(|kind| {
        kind != "latlng"
            && kind != "time"
            && DEFAULT_STREAM_TYPES.split(',').any(|asked| asked == kind)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_stored_point_and_a_recorded_fix_share_the_range_rule_and_only_a_fix_drops_the_origin() {
        let cases = [
            ((0.0, 0.0), true, false),
            ((f64::NAN, 0.0), false, false),
            ((0.0, f64::INFINITY), false, false),
            ((91.0, 0.0), false, false),
            ((0.0, -180.5), false, false),
            ((-37.8, 144.9), true, true),
            ((90.0, 180.0), true, true),
        ];
        for ((lat, lng), storable, fix) in cases {
            assert_eq!(is_storable(lat, lng), storable, "stored ({lat}, {lng})");
            assert_eq!(is_recorded_fix(lat, lng), fix, "recorded ({lat}, {lng})");
        }
    }

    #[test]
    fn a_series_the_stream_pass_does_not_ask_for_is_not_one_it_would_store() {
        let types = |kinds: &[&str]| kinds.iter().map(|k| k.to_string()).collect::<Vec<_>>();

        assert!(carries_a_storable_series(&types(&["time", "heartrate"])));
        assert!(carries_a_storable_series(&types(&["altitude"])));
        assert!(!carries_a_storable_series(&types(&["time", "latlng"])));
        assert!(
            !carries_a_storable_series(&types(&["time", "an_unasked_series"])),
            "a series the pass never asks for never arrives to be stored"
        );
        assert!(!carries_a_storable_series(&[]));
    }

    /// The writer drops every kind the reader rebuilds from the track, so a
    /// kind added to the shared list is never stored and then never read.
    #[test]
    fn storable_series_drops_every_kind_the_reader_rebuilds() {
        let series = |kind: &str| StreamDto {
            kind: kind.to_string(),
            data: vec![Some(1.0), Some(2.0)],
            data2: Some(vec![Some(3.0), Some(4.0)]),
        };
        let mut raw: Vec<StreamDto> = crate::persistence::streams::FROM_THE_TRACK
            .iter()
            .map(|k| series(k))
            .collect();
        raw.push(series("watts"));
        let kept: Vec<String> = storable_series(&raw).into_iter().map(|s| s.kind).collect();
        assert_eq!(kept, vec!["watts".to_string()]);
    }

    /// A misaligned series is dropped rather than stored, and the drop says
    /// so. This is the sync path's filter, the one that lets the writer go on
    /// trusting its caller.
    #[test]
    fn the_sync_path_drops_a_misaligned_series_out_loud() {
        crate::test_log::capturing();
        let raw = vec![
            StreamDto {
                kind: "latlng".to_string(),
                data: vec![Some(1.0), Some(1.1), Some(1.2)],
                data2: Some(vec![Some(2.0), Some(2.1), Some(2.2)]),
            },
            StreamDto {
                kind: "watts".to_string(),
                data: (0..7).map(|i| Some(f64::from(i))).collect(),
                data2: None,
            },
        ];

        let kept = storable_series(&raw);
        assert!(
            kept.is_empty(),
            "the behaviour is unchanged: the misaligned series is not stored"
        );
        let said = crate::test_log::warnings_with("watts carries 7 samples");
        assert_eq!(
            said.len(),
            1,
            "the drop the decision rests on has to be visible: {said:?}"
        );
        assert!(
            said[0].contains('3'),
            "and name the space it missed: {}",
            said[0]
        );
    }

    #[test]
    fn parse_streams_zips_latlng_and_prefers_fixed_altitude() {
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "time", "data": [0, 1, 2]},
            {"type": "latlng", "data": [42.5, 42.6, 42.7], "data2": [1.1, 1.2, 1.3]},
            {"type": "altitude", "data": [100.0, 101.0, 102.0]},
            {"type": "fixed_altitude", "data": [200.0, 201.0, 202.0]},
            {"type": "watts", "data": [150, 160, 170]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.time, vec![0, 1, 2]);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.6, 1.2], [42.7, 1.3]]);
        assert!(s.altitude_is_fixed);
        assert_eq!(s.altitude, vec![200.0, 201.0, 202.0]); // fixed wins
    }

    fn altitude_pair(
        fixed: serde_json::Value,
        device: serde_json::Value,
        fixed_first: bool,
    ) -> ParsedStreams {
        let fixed = json!({"type": "fixed_altitude", "data": fixed});
        let device = json!({"type": "altitude", "data": device});
        let (a, b) = if fixed_first {
            (fixed, device)
        } else {
            (device, fixed)
        };
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "latlng", "data": [42.5, 42.6, 42.7], "data2": [1.1, 1.2, 1.3]},
            a,
            b
        ]))
        .unwrap();
        parse_streams(raw)
    }

    #[test]
    fn parse_streams_falls_back_to_device_altitude_when_corrected_is_unusable() {
        for fixed_first in [true, false] {
            for fixed in [json!([null, null, null]), json!([])] {
                let s = altitude_pair(fixed, json!([10.0, 11.0, 12.0]), fixed_first);
                assert_eq!(
                    s.altitude,
                    vec![10.0, 11.0, 12.0],
                    "fixed_first={fixed_first}"
                );
                assert!(!s.altitude_is_fixed);
            }
        }
    }

    #[test]
    fn parse_streams_prefers_corrected_altitude_with_one_usable_sample_in_either_order() {
        for fixed_first in [true, false] {
            let s = altitude_pair(
                json!([null, 200.0, null]),
                json!([10.0, 11.0, 12.0]),
                fixed_first,
            );
            assert!(s.altitude_is_fixed);
            assert_eq!(s.altitude[1], 200.0);
            assert!(s.altitude[0].is_nan());
        }
    }

    #[test]
    fn parse_streams_with_both_altitude_series_unusable_has_no_finite_sample() {
        for fixed_first in [true, false] {
            let s = altitude_pair(
                json!([null, null, null]),
                json!([null, null, null]),
                fixed_first,
            );
            assert!(s.altitude.iter().all(|v| !v.is_finite()));
            assert!(!s.altitude_is_fixed);
        }
    }

    #[test]
    fn parse_streams_drops_altitude_at_a_null_coordinate() {
        // Distinct altitude per index, so a series that compacted independently
        // of latlng would land on the wrong samples rather than the right ones.
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "latlng", "data": [42.5, null, 42.7, null, 42.9],
             "data2": [1.1, null, 1.3, null, 1.5]},
            {"type": "altitude", "data": [100.0, 200.0, 300.0, 400.0, 500.0]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.7, 1.3], [42.9, 1.5]]);
        assert_eq!(s.altitude, vec![100.0, 300.0, 500.0]);
        assert!(s.misaligned.is_empty());
    }

    #[test]
    fn parse_streams_leaves_altitude_empty_when_the_series_is_absent() {
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "latlng", "data": [42.5, 42.6], "data2": [1.1, 1.2]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.latlng.len(), 2);
        assert!(s.altitude.is_empty());
        assert!(!s.altitude_is_fixed);
    }

    #[test]
    fn parse_streams_altitude_used_when_no_fixed() {
        let raw: Vec<StreamDto> =
            serde_json::from_value(json!([{"type": "altitude", "data": [10.0, 11.0]}])).unwrap();
        let s = parse_streams(raw);
        assert!(!s.altitude_is_fixed);
        assert_eq!(s.altitude, vec![10.0, 11.0]);
    }

    // Golden tests below mirror the real `streams.json`, activities, intervals,
    // sport-settings, wellness, and curve envelopes captured from intervals.icu.
    // Values are synthetic/anonymised; the key set, types, and null placement
    // match the live shapes so the parse stays pinned to the server contract.

    #[test]
    fn parse_streams_ignores_server_envelope() {
        // Each live stream carries an envelope (allNull, anomalies, custom, name,
        // valueType, valueTypeIsArray) and a `data2` that is JSON null on every
        // non-latlng series. serde must ignore the envelope and treat data2: null
        // as absent, while still zipping latlng from data (lat) + data2 (lng).
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "time", "name": null, "data": [0, 1, 2], "data2": null,
             "valueType": "INTEGER", "valueTypeIsArray": false, "allNull": false,
             "anomalies": null, "custom": false},
            {"type": "latlng", "name": null, "data": [42.5, 42.6, 42.7],
             "data2": [1.1, 1.2, 1.3], "valueType": "FLOAT", "valueTypeIsArray": true,
             "allNull": false, "anomalies": null, "custom": false},
            {"type": "watts", "name": null, "data": [150, 160, 170], "data2": null,
             "valueType": "INTEGER", "valueTypeIsArray": false, "allNull": false}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.time, vec![0, 1, 2]);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.6, 1.2], [42.7, 1.3]]);
    }
}
