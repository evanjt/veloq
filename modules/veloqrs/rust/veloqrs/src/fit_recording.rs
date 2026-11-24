//! Writes a recorded activity as a FIT file: `file_id` and `device_info`
//! naming this app, a timer start and stop `event`, one `record` per sample
//! with position, altitude, heart rate, cadence, distance, speed and power,
//! the `lap` messages the recording carries, one `session` with the totals
//! and one `activity`.
//!
//! The streams are those the recording store holds, on its clock: seconds
//! after the start, a distance that accumulates from zero, and NaN or a
//! missing entry where a sensor gave no reading. A reading a field cannot hold
//! is written as that field's invalid value, never as zero.

use crate::GpsPoint;
use crate::fit_write::{
    BASE_ENUM, BASE_SINT32, BASE_UINT8, BASE_UINT16, BASE_UINT32, FIT_EPOCH_UNIX, INVALID_SINT32,
    INVALID_UINT8, INVALID_UINT16, INVALID_UINT32, MESG_ACTIVITY, MESG_EVENT, MESG_LAP,
    MESG_RECORD, MESG_SESSION, activity_identity, definition, scaled_u32, semicircles, wrap,
};

const EVENT_TIMER: u8 = 0;
const EVENT_START: u8 = 0;
const EVENT_STOP_ALL: u8 = 4;
/// The profile's `event` for the end of an activity, and its `stop` type.
const EVENT_ACTIVITY: u8 = 26;
const EVENT_TYPE_STOP: u8 = 1;
/// The profile's `activity` type for one recorded by hand.
const ACTIVITY_MANUAL: u8 = 0;

/// The streams of a recording, one entry per sample. A stream shorter than
/// `time` has no reading for the samples it lacks.
#[derive(Debug, Clone, Default, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRecordingStreams {
    /// Seconds after the start.
    pub time: Vec<f64>,
    /// Degrees, with NaN where the sample had no fix. A latitude or longitude
    /// of exactly zero is no fix either.
    pub latitude: Vec<f64>,
    pub longitude: Vec<f64>,
    /// Metres, NaN where the fix had no altitude.
    pub altitude: Vec<f64>,
    /// Beats a minute, zero where there was no reading.
    pub heartrate: Vec<f64>,
    /// Watts, `None` where the sensor was absent or stale. Zero is a reading.
    pub power: Vec<Option<f64>>,
    /// Cadence as the recording stores it, steps a minute on foot and
    /// revolutions a minute otherwise, zero where there was no reading.
    pub cadence: Vec<f64>,
    /// Metres a second.
    pub speed: Vec<f64>,
    /// Metres from the start.
    pub distance: Vec<f64>,
}

/// One lap, summarised by the caller. A recording's laps cover it from the
/// first sample to the last.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRecordingLap {
    /// Seconds after the start, on the clock the streams use.
    pub start_time: f64,
    pub end_time: f64,
    /// Seconds of moving time at the end of the lap.
    pub moving_end_time: f64,
    pub distance: f64,
    pub avg_speed: f64,
    pub avg_heartrate: Option<f64>,
    pub avg_power: Option<f64>,
    /// As the recording stores cadence.
    pub avg_cadence: Option<f64>,
}

/// A recording to write.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRecordingFit {
    /// The sport as the app names it, such as `Ride` or `Run`.
    pub activity_type: String,
    /// The start, milliseconds since the Unix epoch.
    pub start_unix_millis: f64,
    pub streams: FfiRecordingStreams,
    pub laps: Vec<FfiRecordingLap>,
    /// Paused seconds, which the timer time leaves out.
    pub paused_seconds: f64,
}

/// A reading of a sensor that records zero for none.
fn reading(value: Option<&f64>) -> Option<f64> {
    value.copied().filter(|v| v.is_finite() && *v > 0.0)
}

/// A whole-number field: the value rounded and held below the invalid value.
fn byte(value: f64) -> u8 {
    value.round().clamp(0.0, f64::from(INVALID_UINT8)) as u8
}

/// A 16-bit field: the value rounded and held below the invalid value.
fn short(value: f64) -> u16 {
    value.round().clamp(0.0, f64::from(INVALID_UINT16 - 1)) as u16
}

/// A value scaled into a 16-bit field, or its invalid value for no reading.
fn short_or_invalid(value: Option<f64>, scale: f64) -> u16 {
    value.map_or(INVALID_UINT16, |v| short(v * scale))
}

fn byte_or_invalid(value: Option<f64>) -> u8 {
    value.map_or(INVALID_UINT8, byte)
}

/// The sums a record loop gathers for the session.
#[derive(Default)]
struct Totals {
    max_speed: f64,
    heart: Running,
    power: Running,
    cadence: Running,
}

#[derive(Default)]
struct Running {
    sum: f64,
    count: u32,
    max: f64,
}

impl Running {
    fn add(&mut self, value: f64) {
        self.sum += value;
        self.count += 1;
        self.max = self.max.max(value);
    }

    fn average(&self) -> Option<f64> {
        (self.count > 0).then(|| self.sum / f64::from(self.count))
    }

    fn maximum(&self) -> Option<f64> {
        (self.count > 0).then_some(self.max)
    }
}

impl FfiRecordingFit {
    /// Whether cadence is stored in steps and written in strides.
    fn counts_strides(&self) -> bool {
        matches!(
            crate::sport::cadence_unit(&self.activity_type),
            crate::FfiCadenceUnit::StepsPerMinute
        )
    }

    fn fit_cadence(&self, stored: f64) -> f64 {
        if self.counts_strides() {
            stored / 2.0
        } else {
            stored
        }
    }

    fn start_unix(&self) -> i64 {
        (self.start_unix_millis / 1000.0).floor() as i64
    }

    fn fit_time(&self, offset: f64) -> u32 {
        let offset = if offset.is_finite() {
            offset.floor()
        } else {
            0.0
        };
        (self.start_unix() - FIT_EPOCH_UNIX + offset as i64).clamp(0, i64::from(u32::MAX - 1))
            as u32
    }

    /// The FIT file bytes.
    pub fn to_fit(&self) -> Vec<u8> {
        let streams = &self.streams;
        let elapsed = streams
            .time
            .last()
            .copied()
            .filter(|t| t.is_finite())
            .unwrap_or(0.0);
        let timer = (elapsed - self.paused_seconds.max(0.0)).max(0.0);

        let mut data = Vec::with_capacity(1024 + streams.time.len() * 34 + self.laps.len() * 28);
        activity_identity(&mut data, self.fit_time(0.0));
        write_event(&mut data, self.fit_time(0.0), EVENT_START);
        let totals = self.write_records(&mut data);
        write_event_data(&mut data, self.fit_time(elapsed), EVENT_STOP_ALL);
        self.write_laps(&mut data);
        self.write_session(&mut data, &totals, elapsed, timer);
        self.write_activity(&mut data, elapsed, timer);
        wrap(data)
    }

    fn write_records(&self, out: &mut Vec<u8>) -> Totals {
        definition(
            out,
            3,
            MESG_RECORD,
            &[
                (253, 4, BASE_UINT32),
                (0, 4, BASE_SINT32),
                (1, 4, BASE_SINT32),
                (2, 2, BASE_UINT16),
                (78, 4, BASE_UINT32),
                (3, 1, BASE_UINT8),
                (4, 1, BASE_UINT8),
                (5, 4, BASE_UINT32),
                (6, 2, BASE_UINT16),
                (73, 4, BASE_UINT32),
                (7, 2, BASE_UINT16),
            ],
        );
        let streams = &self.streams;
        let mut totals = Totals::default();
        for (i, time) in streams.time.iter().enumerate() {
            out.push(3);
            out.extend_from_slice(&self.fit_time(*time).to_le_bytes());

            let (latitude, longitude) = (streams.latitude.get(i), streams.longitude.get(i));
            match (latitude, longitude) {
                (Some(lat), Some(lng))
                    if lat.is_finite() && lng.is_finite() && *lat != 0.0 && *lng != 0.0 =>
                {
                    out.extend_from_slice(&semicircles(*lat).to_le_bytes());
                    out.extend_from_slice(&semicircles(*lng).to_le_bytes());
                }
                _ => {
                    out.extend_from_slice(&INVALID_SINT32.to_le_bytes());
                    out.extend_from_slice(&INVALID_SINT32.to_le_bytes());
                }
            }

            // Sea level is a measurement; only a missing reading is invalid.
            match streams.altitude.get(i).filter(|a| a.is_finite()) {
                Some(altitude) => {
                    let scaled = ((altitude + 500.0) * 5.0).round();
                    out.extend_from_slice(&short(scaled).to_le_bytes());
                    out.extend_from_slice(&scaled_u32(scaled).to_le_bytes());
                }
                None => {
                    out.extend_from_slice(&INVALID_UINT16.to_le_bytes());
                    out.extend_from_slice(&INVALID_UINT32.to_le_bytes());
                }
            }

            let heart = reading(streams.heartrate.get(i));
            out.push(byte_or_invalid(heart));
            if let Some(heart) = heart {
                totals.heart.add(heart);
            }

            let cadence = reading(streams.cadence.get(i)).map(|c| self.fit_cadence(c));
            out.push(byte_or_invalid(cadence));
            if let Some(cadence) = cadence {
                totals.cadence.add(cadence);
            }

            let distance = streams.distance.get(i).copied().unwrap_or(0.0);
            out.extend_from_slice(&scaled_u32(distance * 100.0).to_le_bytes());

            // A negative or non-finite speed is no reading.
            match streams.speed.get(i).filter(|s| s.is_finite() && **s >= 0.0) {
                Some(speed) => {
                    out.extend_from_slice(&short(speed * 1000.0).to_le_bytes());
                    out.extend_from_slice(&scaled_u32(speed * 1000.0).to_le_bytes());
                    totals.max_speed = totals.max_speed.max(*speed);
                }
                None => {
                    out.extend_from_slice(&INVALID_UINT16.to_le_bytes());
                    out.extend_from_slice(&INVALID_UINT32.to_le_bytes());
                }
            }

            // Absent is no reading; 0 W is one.
            let power = streams
                .power
                .get(i)
                .copied()
                .flatten()
                .filter(|p| p.is_finite() && *p >= 0.0);
            out.extend_from_slice(&short_or_invalid(power, 1.0).to_le_bytes());
            if let Some(power) = power {
                totals.power.add(power);
            }
        }
        totals
    }

    fn write_laps(&self, out: &mut Vec<u8>) {
        definition(
            out,
            4,
            MESG_LAP,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (9, 4, BASE_UINT32),
                (13, 2, BASE_UINT16),
                (15, 1, BASE_UINT8),
                (19, 2, BASE_UINT16),
                (17, 1, BASE_UINT8),
            ],
        );
        let mut moving_start = 0.0;
        for lap in &self.laps {
            out.push(4);
            out.extend_from_slice(&self.fit_time(lap.end_time).to_le_bytes());
            out.extend_from_slice(&self.fit_time(lap.start_time).to_le_bytes());
            out.extend_from_slice(
                &scaled_u32((lap.end_time - lap.start_time) * 1000.0).to_le_bytes(),
            );
            out.extend_from_slice(
                &scaled_u32((lap.moving_end_time - moving_start).max(0.0) * 1000.0).to_le_bytes(),
            );
            moving_start = lap.moving_end_time;
            out.extend_from_slice(&scaled_u32(lap.distance * 100.0).to_le_bytes());
            out.extend_from_slice(&short(lap.avg_speed * 1000.0).to_le_bytes());
            out.push(byte_or_invalid(lap.avg_heartrate.filter(|v| *v > 0.0)));
            out.extend_from_slice(&short_or_invalid(lap.avg_power, 1.0).to_le_bytes());
            out.push(byte_or_invalid(
                lap.avg_cadence
                    .filter(|v| *v > 0.0)
                    .map(|c| self.fit_cadence(c)),
            ));
        }
    }

    /// Gain and loss over the altitude readings, by the engine's rule.
    fn climbing(&self) -> (f64, f64) {
        let points: Vec<GpsPoint> = self
            .streams
            .altitude
            .iter()
            .filter(|a| a.is_finite())
            .map(|a| GpsPoint {
                latitude: 0.0,
                longitude: 0.0,
                elevation: Some(*a),
            })
            .collect();
        tracematch::geo_utils::elevation_stats(&points)
            .map_or((0.0, 0.0), |(gain, loss, _)| (gain, loss))
    }

    fn write_session(&self, out: &mut Vec<u8>, totals: &Totals, elapsed: f64, timer: f64) {
        let total_distance = self
            .streams
            .distance
            .last()
            .copied()
            .filter(|d| d.is_finite())
            .unwrap_or(0.0);
        let avg_speed = if timer > 0.0 {
            total_distance / timer
        } else {
            0.0
        };
        let (gain, loss) = self.climbing();
        let (sport, sub_sport) = crate::sport::to_fit(&self.activity_type);
        let (heart, power, cadence) = (&totals.heart, &totals.power, &totals.cadence);

        definition(
            out,
            5,
            MESG_SESSION,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (9, 4, BASE_UINT32),
                (5, 1, BASE_ENUM),
                (6, 1, BASE_ENUM),
                (14, 2, BASE_UINT16),
                (15, 2, BASE_UINT16),
                (16, 1, BASE_UINT8),
                (17, 1, BASE_UINT8),
                (18, 1, BASE_UINT8),
                (19, 1, BASE_UINT8),
                (20, 2, BASE_UINT16),
                (21, 2, BASE_UINT16),
                (22, 2, BASE_UINT16),
                (23, 2, BASE_UINT16),
                (25, 2, BASE_UINT16),
                (26, 2, BASE_UINT16),
            ],
        );
        out.push(5);
        out.extend_from_slice(&self.fit_time(elapsed).to_le_bytes());
        out.extend_from_slice(&self.fit_time(0.0).to_le_bytes());
        out.extend_from_slice(&scaled_u32(elapsed * 1000.0).to_le_bytes());
        out.extend_from_slice(&scaled_u32(timer * 1000.0).to_le_bytes());
        out.extend_from_slice(&scaled_u32(total_distance * 100.0).to_le_bytes());
        out.push(sport);
        out.push(sub_sport);
        out.extend_from_slice(&short(avg_speed * 1000.0).to_le_bytes());
        out.extend_from_slice(&short(totals.max_speed * 1000.0).to_le_bytes());
        out.push(byte_or_invalid(heart.average()));
        out.push(byte_or_invalid(heart.maximum()));
        out.push(byte_or_invalid(cadence.average()));
        out.push(byte_or_invalid(cadence.maximum()));
        out.extend_from_slice(&short_or_invalid(power.average(), 1.0).to_le_bytes());
        out.extend_from_slice(&short_or_invalid(power.maximum(), 1.0).to_le_bytes());
        out.extend_from_slice(&short(gain).to_le_bytes());
        out.extend_from_slice(&short(loss).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // first_lap_index
        out.extend_from_slice(
            &(self.laps.len().min(usize::from(u16::MAX - 1)) as u16).to_le_bytes(),
        );
    }

    fn write_activity(&self, out: &mut Vec<u8>, elapsed: f64, timer: f64) {
        definition(
            out,
            6,
            MESG_ACTIVITY,
            &[
                (253, 4, BASE_UINT32),
                (0, 4, BASE_UINT32),
                (1, 2, BASE_UINT16),
                (2, 1, BASE_ENUM),
                (3, 1, BASE_ENUM),
                (4, 1, BASE_ENUM),
            ],
        );
        out.push(6);
        out.extend_from_slice(&self.fit_time(elapsed).to_le_bytes());
        out.extend_from_slice(&scaled_u32(timer * 1000.0).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.push(ACTIVITY_MANUAL);
        out.push(EVENT_ACTIVITY);
        out.push(EVENT_TYPE_STOP);
    }
}

/// The definition of the timer `event` and its first data message.
fn write_event(out: &mut Vec<u8>, time: u32, event_type: u8) {
    definition(
        out,
        2,
        MESG_EVENT,
        &[(253, 4, BASE_UINT32), (0, 1, BASE_ENUM), (1, 1, BASE_ENUM)],
    );
    write_event_data(out, time, event_type);
}

/// A timer `event` on the local type its definition gave.
fn write_event_data(out: &mut Vec<u8>, time: u32, event_type: u8) {
    out.push(2);
    out.extend_from_slice(&time.to_le_bytes());
    out.push(EVENT_TIMER);
    out.push(event_type);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit_write::crc;
    use fitparser::profile::MesgNum;

    const START_MILLIS: f64 = 1_768_471_200_000.0;

    fn streams(time: Vec<f64>) -> FfiRecordingStreams {
        FfiRecordingStreams {
            time,
            ..FfiRecordingStreams::default()
        }
    }

    fn recording(activity_type: &str, streams: FfiRecordingStreams) -> FfiRecordingFit {
        FfiRecordingFit {
            activity_type: activity_type.to_string(),
            start_unix_millis: START_MILLIS,
            streams,
            laps: Vec::new(),
            paused_seconds: 0.0,
        }
    }

    fn lap(start: f64, end: f64, moving_end: f64) -> FfiRecordingLap {
        FfiRecordingLap {
            start_time: start,
            end_time: end,
            moving_end_time: moving_end,
            distance: 0.0,
            avg_speed: 0.0,
            avg_heartrate: None,
            avg_power: None,
            avg_cadence: None,
        }
    }

    fn decode(file: &[u8]) -> Vec<fitparser::FitDataRecord> {
        fitparser::from_bytes(file).expect("the file decodes")
    }

    fn number(record: &fitparser::FitDataRecord, field: &str) -> Option<f64> {
        record
            .fields()
            .iter()
            .find(|f| f.name() == field)
            .and_then(|f| match f.value() {
                fitparser::Value::Float64(v) => Some(*v),
                fitparser::Value::Float32(v) => Some(f64::from(*v)),
                fitparser::Value::SInt32(v) => Some(f64::from(*v)),
                fitparser::Value::UInt32(v) => Some(f64::from(*v)),
                fitparser::Value::UInt16(v) => Some(f64::from(*v)),
                fitparser::Value::UInt8(v) => Some(f64::from(*v)),
                _ => None,
            })
    }

    fn of_kind(
        records: &[fitparser::FitDataRecord],
        kind: MesgNum,
    ) -> Vec<&fitparser::FitDataRecord> {
        records.iter().filter(|r| r.kind() == kind).collect()
    }

    fn only(records: &[fitparser::FitDataRecord], kind: MesgNum) -> &fitparser::FitDataRecord {
        let found = of_kind(records, kind);
        assert_eq!(found.len(), 1, "one {kind:?} message");
        found[0]
    }

    fn session_of(file: &[u8]) -> fitparser::FitDataRecord {
        let records = decode(file);
        only(&records, MesgNum::Session).clone()
    }

    /// The raw value of a field of the data message with the global number
    /// `global`, read with the definition the file gives it, for the values a
    /// decoder reports as absent when they are invalid.
    fn raw_fields(file: &[u8], global: u16) -> Vec<Vec<(u8, u64)>> {
        let end = 14 + u32::from_le_bytes(file[4..8].try_into().unwrap()) as usize;
        type Definition = Option<(u16, Vec<(u8, usize)>)>;
        let mut definitions: [Definition; 16] = Default::default();
        let mut found = Vec::new();
        let mut at = 14;
        while at < end {
            let header = file[at];
            at += 1;
            let local = usize::from(header & 0x0F);
            if header & 0x40 != 0 {
                let id = u16::from_le_bytes([file[at + 2], file[at + 3]]);
                let count = usize::from(file[at + 4]);
                let fields = (0..count)
                    .map(|n| (file[at + 5 + n * 3], usize::from(file[at + 6 + n * 3])))
                    .collect();
                at += 5 + count * 3;
                definitions[local] = Some((id, fields));
                continue;
            }
            let (id, fields) = definitions[local].clone().expect("defined before use");
            let mut row = Vec::new();
            for (number, size) in fields {
                let mut value = 0u64;
                for (n, b) in file[at..at + size].iter().enumerate() {
                    if n < 8 {
                        value |= u64::from(*b) << (8 * n);
                    }
                }
                row.push((number, value));
                at += size;
            }
            if id == global {
                found.push(row);
            }
        }
        found
    }

    fn field(row: &[(u8, u64)], number: u8) -> u64 {
        row.iter()
            .find(|(n, _)| *n == number)
            .map(|(_, v)| *v)
            .unwrap_or_else(|| panic!("field {number} is defined"))
    }

    fn ride(points: usize) -> FfiRecordingFit {
        let mut s = streams((0..points).map(|i| i as f64).collect());
        s.latitude = (0..points).map(|i| 46.5 + i as f64 * 0.0001).collect();
        s.longitude = (0..points).map(|i| 6.6 + i as f64 * 0.0001).collect();
        s.altitude = vec![420.0; points];
        s.heartrate = vec![140.0; points];
        s.power = vec![Some(200.0); points];
        s.cadence = vec![90.0; points];
        s.speed = vec![8.0; points];
        s.distance = (0..points).map(|i| i as f64 * 8.0).collect();
        recording("Ride", s)
    }

    /// Scenario: a recording is written and read back by the reader the
    /// engine and the upload target use.
    ///
    /// Expected behaviour: the header size, the header CRC and the file CRC
    /// verify, every message type is defined before use, and the messages a
    /// reader needs to build an activity are all there.
    #[test]
    fn the_file_decodes_with_the_messages_an_activity_needs() {
        let mut fit = ride(5);
        fit.laps = vec![lap(0.0, 4.0, 4.0)];
        let file = fit.to_fit();

        assert_eq!(file[0], 14);
        assert_eq!(&file[8..12], b".FIT");
        let data_size = u32::from_le_bytes(file[4..8].try_into().unwrap()) as usize;
        assert_eq!(file.len(), 14 + data_size + 2);
        let header_crc = u16::from_le_bytes([file[12], file[13]]);
        assert_eq!(crc(&file[..12]), header_crc);
        let file_crc = u16::from_le_bytes([file[file.len() - 2], file[file.len() - 1]]);
        assert_eq!(crc(&file[..file.len() - 2]), file_crc);

        let records = decode(&file);
        for kind in [
            MesgNum::FileId,
            MesgNum::DeviceInfo,
            MesgNum::Event,
            MesgNum::Lap,
            MesgNum::Session,
            MesgNum::Activity,
        ] {
            assert!(!of_kind(&records, kind).is_empty(), "{kind:?} is written");
        }
        assert_eq!(of_kind(&records, MesgNum::Record).len(), 5);
        assert_eq!(of_kind(&records, MesgNum::Event).len(), 2);
    }

    /// Scenario: a recording with no sample at all, as when it is stopped
    /// before the first fix.
    ///
    /// Expected behaviour: a valid file with the session and activity and no
    /// record.
    #[test]
    fn an_empty_recording_is_a_valid_file() {
        let records = decode(&recording("Ride", streams(Vec::new())).to_fit());
        assert!(of_kind(&records, MesgNum::Record).is_empty());
        let session = only(&records, MesgNum::Session);
        assert_eq!(number(session, "total_elapsed_time"), Some(0.0));
        assert_eq!(number(session, "total_distance"), Some(0.0));
    }

    /// Expected behaviour: each record is one fixed-width message, so the
    /// file grows by that width for each sample and 10,000 samples are
    /// written whole.
    #[test]
    fn each_sample_adds_one_fixed_width_record() {
        const RECORD_MESSAGE_BYTES: usize = 33;
        let five = ride(5).to_fit();
        let twenty = ride(20).to_fit();
        assert_eq!(twenty.len() - five.len(), 15 * RECORD_MESSAGE_BYTES);
        let long = ride(10_000).to_fit();
        assert_eq!(of_kind(&decode(&long), MesgNum::Record).len(), 10_000);
    }

    /// Expected behaviour: a position is written as semicircles and reads
    /// back within a metre, and a zero or missing coordinate is the invalid
    /// value, not a point off the coast of Africa.
    #[test]
    fn positions_are_semicircles_and_a_missing_fix_is_invalid() {
        let mut s = streams(vec![0.0, 1.0, 2.0, 3.0]);
        s.latitude = vec![46.5, 0.0, f64::NAN, 46.5002];
        s.longitude = vec![6.6, 0.0, 6.6001, 6.6002];
        let file = recording("Ride", s).to_fit();
        let rows = raw_fields(&file, 20);
        let read = |row: &[(u8, u64)], n: u8| field(row, n) as u32 as i32;
        assert!((f64::from(read(&rows[0], 0)) * 180.0 / 2_147_483_648.0 - 46.5).abs() < 1e-5);
        assert!((f64::from(read(&rows[3], 1)) * 180.0 / 2_147_483_648.0 - 6.6002).abs() < 1e-5);
        for row in &rows[1..3] {
            assert_eq!(read(row, 0), INVALID_SINT32);
            assert_eq!(read(row, 1), INVALID_SINT32);
        }
    }

    /// Expected behaviour: altitude is offset by 500 m and scaled by 5 in both
    /// the 16-bit and enhanced fields, one below the offset floor holds at
    /// zero, sea level is a reading, and a missing, NaN or short stream is the
    /// invalid value.
    #[test]
    fn altitude_is_offset_and_scaled_and_a_missing_reading_is_invalid() {
        let mut s = streams(vec![0.0, 1.0, 2.0, 3.0, 4.0]);
        s.altitude = vec![123.4, -900.0, 0.0, f64::NAN];
        let rows = raw_fields(&recording("Ride", s).to_fit(), 20);
        assert_eq!(field(&rows[0], 2), 3117);
        assert_eq!(field(&rows[0], 78), 3117);
        assert_eq!(field(&rows[1], 2), 0);
        assert_eq!(field(&rows[1], 78), 0);
        assert_eq!(field(&rows[2], 2), 2500);
        for row in &rows[3..] {
            assert_eq!(field(row, 2), u64::from(INVALID_UINT16));
            assert_eq!(field(row, 78), u64::from(INVALID_UINT32));
        }
    }

    /// Scenario: a ride coasting at 0 W for part of it, a sensor that dropped
    /// out for another part, and a ride that never had a meter.
    ///
    /// Expected behaviour: 0 W is a reading and counts in the average, a
    /// dropped sample is invalid and is left out of it, and a ride with no
    /// meter has no power in its session at all.
    #[test]
    fn power_zero_is_a_reading_and_none_is_not() {
        let mut s = streams(vec![0.0, 1.0, 2.0]);
        s.power = vec![Some(200.0), None, Some(0.0)];
        let file = recording("Ride", s).to_fit();
        let rows = raw_fields(&file, 20);
        assert_eq!(field(&rows[0], 7), 200);
        assert_eq!(field(&rows[1], 7), u64::from(INVALID_UINT16));
        assert_eq!(field(&rows[2], 7), 0);
        let session = session_of(&file);
        assert_eq!(number(&session, "avg_power"), Some(100.0));
        assert_eq!(number(&session, "max_power"), Some(200.0));

        let mut coasting = streams(vec![0.0, 1.0]);
        coasting.power = vec![Some(0.0), Some(0.0)];
        assert_eq!(
            number(
                &session_of(&recording("Ride", coasting).to_fit()),
                "avg_power"
            ),
            Some(0.0)
        );

        let mut meterless = streams(vec![0.0, 1.0]);
        meterless.power = vec![None, None];
        assert_eq!(
            number(
                &session_of(&recording("Ride", meterless).to_fit()),
                "avg_power"
            ),
            None
        );
    }

    /// Expected behaviour: no heart rate or cadence reading, zero, NaN or
    /// beyond the field, is the invalid value and does not enter the session's
    /// average; a reading past the byte holds at the field's top.
    #[test]
    fn heart_rate_and_cadence_zero_and_nan_are_no_reading() {
        let mut s = streams(vec![0.0, 1.0, 2.0, 3.0]);
        s.heartrate = vec![120.0, 0.0, f64::NAN, 160.0];
        s.cadence = vec![80.0, 0.0, f64::NAN, 100.0];
        let file = recording("Ride", s).to_fit();
        let rows = raw_fields(&file, 20);
        for (i, expected) in [Some(120), None, None, Some(160)].into_iter().enumerate() {
            let heart = field(&rows[i], 3);
            assert_eq!(heart, expected.unwrap_or(u64::from(INVALID_UINT8)));
        }
        let session = session_of(&file);
        assert_eq!(number(&session, "avg_heart_rate"), Some(140.0));
        assert_eq!(number(&session, "max_heart_rate"), Some(160.0));
        assert_eq!(number(&session, "avg_cadence"), Some(90.0));

        let mut high = streams(vec![0.0]);
        high.heartrate = vec![350.0];
        let rows = raw_fields(&recording("Ride", high).to_fit(), 20);
        assert_eq!(field(&rows[0], 3), 255);
    }

    /// Scenario: speed is metres a second, written as millimetres a second in
    /// both the 16-bit and the enhanced field.
    ///
    /// Expected behaviour: a negative or non-finite speed is the invalid value,
    /// a speed past the 16-bit field holds below its invalid value, and the
    /// session's maximum is the fastest valid sample.
    #[test]
    fn speed_is_millimetres_a_second_and_a_bad_reading_is_invalid() {
        let mut s = streams(vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
        s.speed = vec![0.0, 8.5, -1.0, f64::NAN, f64::INFINITY, 70.0];
        let file = recording("Ride", s).to_fit();
        let rows = raw_fields(&file, 20);
        assert_eq!(field(&rows[0], 6), 0);
        assert_eq!(field(&rows[1], 6), 8500);
        assert_eq!(field(&rows[1], 73), 8500);
        for row in &rows[2..5] {
            assert_eq!(field(row, 6), u64::from(INVALID_UINT16));
            assert_eq!(field(row, 73), u64::from(INVALID_UINT32));
        }
        assert_eq!(field(&rows[5], 6), 65_534);
        assert_eq!(field(&rows[5], 73), 70_000);
        assert_eq!(field(&raw_fields(&file, 18)[0], 15), 65_534);
    }

    /// Scenario: a ride paused for 40 of its 100 seconds.
    ///
    /// Expected behaviour: the timer time leaves the pause out, the elapsed
    /// time does not, and the session's average speed is over the timer time.
    #[test]
    fn paused_time_leaves_the_timer_and_not_the_elapsed_time() {
        let mut s = streams(vec![0.0, 50.0, 100.0]);
        s.distance = vec![0.0, 400.0, 600.0];
        let mut fit = recording("Ride", s);
        fit.paused_seconds = 40.0;
        let file = fit.to_fit();
        let session = session_of(&file);
        assert_eq!(number(&session, "total_timer_time"), Some(60.0));
        assert_eq!(number(&session, "total_elapsed_time"), Some(100.0));
        assert_eq!(field(&raw_fields(&file, 18)[0], 14), 10_000);
        let records = decode(&file);
        assert_eq!(
            number(only(&records, MesgNum::Activity), "total_timer_time"),
            Some(60.0)
        );
    }

    /// Scenario: a phone's GPS altitude on a gentle 10 m rise, every fix off
    /// by 1.5 m one way and then the other. Summing each positive step reads
    /// well over 300 m of climbing.
    ///
    /// Expected behaviour: the ascent is the engine's figure, a 3-point mean
    /// held to a 3 m anchor: 9 m up and nothing down.
    #[test]
    fn ascent_follows_the_engines_rule_for_a_jittered_altitude() {
        let points = 226;
        let mut s = streams((0..points).map(|i| i as f64).collect());
        s.altitude = (0..points)
            .map(|i| {
                100.0 + 10.0 * i as f64 / (points - 1) as f64 + if i % 2 == 1 { 1.5 } else { -1.5 }
            })
            .collect();
        let session = session_of(&recording("Walk", s).to_fit());
        assert_eq!(number(&session, "total_ascent"), Some(9.0));
        assert_eq!(number(&session, "total_descent"), Some(0.0));
    }

    /// Expected behaviour: ascent counts the readings that carry an altitude,
    /// so a missing reading neither breaks the climb nor adds to it.
    #[test]
    fn ascent_skips_a_missing_reading() {
        for (altitude, ascent) in [
            (vec![f64::NAN, 450.0, 454.0, 458.0], 4.0),
            (vec![450.0, f64::NAN, 454.0, 458.0], 4.0),
            (vec![450.0, 454.0, 458.0, f64::NAN], 4.0),
            (vec![f64::NAN, f64::NAN], 0.0),
            (vec![0.0, 4.0, 8.0], 4.0),
        ] {
            let mut s = streams((0..altitude.len()).map(|i| i as f64).collect());
            s.altitude = altitude.clone();
            let session = session_of(&recording("Ride", s).to_fit());
            assert_eq!(
                number(&session, "total_ascent"),
                Some(ascent),
                "{altitude:?}"
            );
        }
    }

    /// Expected behaviour: the session names its sport by the numbers the
    /// engine's sport table gives, and a sport it does not know is generic.
    #[test]
    fn the_session_carries_the_sport_numbers_of_the_sport_table() {
        for name in [
            "Ride",
            "VirtualRide",
            "Run",
            "TrailRun",
            "Treadmill",
            "MountainBikeRide",
            "Swim",
            "OpenWaterSwim",
            "Walk",
            "Hike",
            "Yoga",
            "WeightTraining",
            "Kayaking",
            "Surfing",
        ] {
            let file = recording(name, streams(Vec::new())).to_fit();
            let row = &raw_fields(&file, 18)[0];
            let (sport, sub_sport) = crate::sport::to_fit(name);
            assert_eq!(field(row, 5), u64::from(sport), "{name}");
            assert_eq!(field(row, 6), u64::from(sub_sport), "{name}");
        }
        let file = recording("Unlisted", streams(Vec::new())).to_fit();
        let row = &raw_fields(&file, 18)[0];
        assert_eq!((field(row, 5), field(row, 6)), (0, 0));
        let activity =
            crate::fit::parse_fit_activity(&recording("Run", streams(Vec::new())).to_fit())
                .expect("the file decodes");
        assert_eq!(
            crate::sport::from_fit(activity.sport, activity.sub_sport),
            "Run"
        );
    }

    /// Expected behaviour: a sport counted in strides is written as half the
    /// steps a minute in the records, the laps and the session, an odd count
    /// rounds to whole strides, and a ride keeps its revolutions a minute.
    #[test]
    fn cadence_on_foot_is_written_as_strides() {
        let cadenced = |sport: &str, cadence: f64| {
            let mut s = streams(vec![0.0, 1.0]);
            s.cadence = vec![cadence, cadence];
            let mut fit = recording(sport, s);
            let mut one = lap(0.0, 1.0, 1.0);
            one.avg_cadence = Some(cadence);
            fit.laps = vec![one];
            fit.to_fit()
        };
        for sport in ["Run", "TrailRun", "Walk"] {
            let file = cadenced(sport, 170.0);
            assert_eq!(field(&raw_fields(&file, 20)[0], 4), 85, "{sport}");
            assert_eq!(field(&raw_fields(&file, 19)[0], 17), 85, "{sport}");
            let session = &raw_fields(&file, 18)[0];
            assert_eq!(field(session, 18), 85, "{sport}");
            assert_eq!(field(session, 19), 85, "{sport}");
        }
        assert_eq!(field(&raw_fields(&cadenced("Run", 171.0), 20)[0], 4), 86);
        assert_eq!(
            field(&raw_fields(&cadenced("Run", 0.0), 20)[0], 4),
            u64::from(INVALID_UINT8)
        );
        let ride = cadenced("Ride", 90.0);
        assert_eq!(field(&raw_fields(&ride, 20)[0], 4), 90);
        assert_eq!(field(&raw_fields(&ride, 19)[0], 17), 90);
        assert_eq!(field(&raw_fields(&ride, 18)[0], 18), 90);
    }

    /// Scenario: three laps, the middle one with no heart rate or power, and
    /// moving time that stops short of the wall clock because of a pause.
    ///
    /// Expected behaviour: one lap message per lap in order, each with its
    /// own start and end, its elapsed time and the moving time since the
    /// previous lap, its distance and averages, an average a lap lacks is the
    /// invalid value, and the session counts them.
    #[test]
    fn each_lap_is_written_with_its_own_times_and_averages() {
        let mut fit = ride(31);
        fit.laps = vec![
            FfiRecordingLap {
                distance: 100.0,
                avg_speed: 5.0,
                avg_heartrate: Some(130.4),
                avg_power: Some(0.0),
                avg_cadence: Some(80.0),
                ..lap(0.0, 10.0, 10.0)
            },
            lap(10.0, 20.0, 15.0),
            FfiRecordingLap {
                distance: 3.25,
                avg_speed: 0.325,
                ..lap(20.0, 30.0, 25.0)
            },
        ];
        let file = fit.to_fit();
        let rows = raw_fields(&file, 19);
        assert_eq!(rows.len(), 3);
        let session_start = field(&raw_fields(&file, 18)[0], 2);
        let ends: Vec<u64> = rows.iter().map(|r| field(r, 253) - session_start).collect();
        assert_eq!(ends, [10, 20, 30]);
        let starts: Vec<u64> = rows.iter().map(|r| field(r, 2) - session_start).collect();
        assert_eq!(starts, [0, 10, 20]);
        let elapsed: Vec<u64> = rows.iter().map(|r| field(r, 7)).collect();
        assert_eq!(elapsed, [10_000, 10_000, 10_000]);
        let timer: Vec<u64> = rows.iter().map(|r| field(r, 8)).collect();
        assert_eq!(timer, [10_000, 5_000, 10_000]);
        assert_eq!(field(&rows[0], 9), 10_000);
        assert_eq!(field(&rows[2], 9), 325);
        assert_eq!(field(&rows[0], 13), 5_000);
        assert_eq!(field(&rows[0], 15), 130);
        assert_eq!(field(&rows[0], 19), 0);
        assert_eq!(field(&rows[0], 17), 80);
        assert_eq!(field(&rows[1], 15), u64::from(INVALID_UINT8));
        assert_eq!(field(&rows[1], 19), u64::from(INVALID_UINT16));
        assert_eq!(field(&rows[1], 17), u64::from(INVALID_UINT8));
        let session = session_of(&file);
        assert_eq!(number(&session, "num_laps"), Some(3.0));
    }

    /// Expected behaviour: the file's identity and start are those of the
    /// recording: the activity file type, this app as the product, and every
    /// timestamp on the FIT clock from the start given.
    #[test]
    fn the_file_names_this_app_and_the_start() {
        let mut fit = ride(3);
        fit.laps = vec![lap(0.0, 2.0, 2.0)];
        let file = fit.to_fit();
        let id = &raw_fields(&file, 0)[0];
        assert_eq!(field(id, 0), 4);
        assert_eq!(field(id, 1), 255);
        let start = (START_MILLIS / 1000.0) as u64 - FIT_EPOCH_UNIX as u64;
        assert_eq!(field(id, 4), start);
        let records = raw_fields(&file, 20);
        assert_eq!(field(&records[2], 253), start + 2);
        let text = String::from_utf8_lossy(&file);
        assert!(text.contains("Veloq"));
    }
}
