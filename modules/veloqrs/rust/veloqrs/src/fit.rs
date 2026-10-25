//! FIT file parser: strength training exercise sets, a pool swim's lengths and
//! the recorded track.
//!
//! Uses the `fitparser` crate to parse FIT files, extracting `set` messages
//! (MesgNum::Set) and `length` messages (MesgNum::Length). Also provides
//! exercise and swim stroke name tables and the muscle group lookup.
//!
//! Exercise category IDs and set_type values follow the Garmin FIT SDK
//! Profile (v21.133). See FIT SDK Profile.xlsx → Types → ExerciseCategory
//! and SetType for the authoritative enum definitions.

use std::collections::HashMap;
use std::io::Cursor;

// ============================================================================
// FIT Parser (using fitparser crate)
// ============================================================================

/// A parsed exercise set from a FIT file.
#[derive(Debug, Clone)]
pub struct FitExerciseSet {
    pub set_order: u32,
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    pub set_type: u8,
    pub repetitions: Option<u16>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
    pub start_time: Option<i64>,
}

/// A set handed over the FFI, as demo mode and the sample library carry them.
impl From<&crate::FfiExerciseSet> for FitExerciseSet {
    fn from(set: &crate::FfiExerciseSet) -> Self {
        Self {
            set_order: set.set_order,
            exercise_category: set.exercise_category,
            exercise_name: set.exercise_name,
            set_type: set.set_type,
            repetitions: set.repetitions,
            weight_kg: set.weight_kg,
            duration_secs: set.duration_secs,
            start_time: set.start_time.map(|time| time as i64),
        }
    }
}

/// Errors from parsing a FIT binary file.
#[derive(Debug, thiserror::Error)]
pub enum FitParseError {
    #[error("FIT bytes empty")]
    Empty,
    #[error("FIT decode failed: {0}")]
    Decode(String),
}

/// Parse a FIT binary file and return extracted exercise sets or a typed error.
///
/// The error keeps an unparseable file apart from a valid-but-empty one (e.g.
/// a cardio activity with no `Set` messages).
pub fn parse_fit_strength_sets(data: &[u8]) -> Result<Vec<FitExerciseSet>, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    let records = decode(data)?;
    Ok(sets_from_records(&records))
}

/// Decode a FIT file with every enum field left as its number.
///
/// By default the decoder names a one-element enum field, so a `category`
/// written with a single slot arrived as `"squat"` while the same field written
/// with three slots arrived as numbers. The numbers are what the category and
/// set type tables below key on, whichever way the device wrote the field.
///
/// The file comes from outside, so a malformed one has to settle as an error.
/// The decoder slices the header to the size the file's first byte claims, so a
/// claim past the end of the file is refused before it is called, and any other
/// panic inside it is caught and returned as a decode error.
fn decode(data: &[u8]) -> Result<Vec<fitparser::FitDataRecord>, FitParseError> {
    let claimed = data.first().map_or(0, |&size| usize::from(size));
    if data.len() < claimed {
        return Err(FitParseError::Decode(format!(
            "header claims {claimed} bytes in a {}-byte file",
            data.len()
        )));
    }
    let options = [fitparser::de::DecodeOption::ReturnNumericEnumValues]
        .into_iter()
        .collect();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fitparser::de::from_reader_with_options(&mut Cursor::new(data), &options)
    }))
    .map_err(|_| FitParseError::Decode("decoder panicked".to_string()))?
    .map_err(|e| FitParseError::Decode(e.to_string()))
}

/// What a recording's FIT holds for its provisional row.
#[derive(Debug, Clone, Default)]
pub struct FitRecording {
    /// The positions the records hold, in order, in degrees.
    pub track: Vec<crate::GpsPoint>,
    /// The session's wall-clock span in seconds, pauses included.
    pub elapsed_seconds: Option<f64>,
    /// The session's top speed in metres per second.
    pub max_speed: Option<f64>,
}

/// The positions a FIT file records, in order, in degrees.
///
/// A record with no fix carries no position and is skipped, which is how an
/// indoor ride comes back as an empty track rather than an error. An
/// unreadable file is an error, so a caller never takes it for a ride that
/// stayed indoors.
pub fn parse_fit_track(data: &[u8]) -> Result<Vec<crate::GpsPoint>, FitParseError> {
    parse_fit_recording(data).map(|recording| recording.track)
}

/// The track and the session totals a FIT file records, from one decode.
///
/// The totals are the first session message's. A file with no session leaves
/// them unset rather than zero, so a caller keeps what it already had.
pub fn parse_fit_recording(data: &[u8]) -> Result<FitRecording, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    let records = decode(data)?;
    let mut recording = FitRecording::default();
    let mut session_read = false;
    for record in &records {
        match record.kind() {
            fitparser::profile::MesgNum::Record => {
                let mut lat = None;
                let mut lng = None;
                for field in record.fields() {
                    match field.name() {
                        "position_lat" => lat = semicircles_to_degrees(field.value()),
                        "position_long" => lng = semicircles_to_degrees(field.value()),
                        _ => {}
                    }
                }
                if let (Some(lat), Some(lng)) = (lat, lng) {
                    recording.track.push(crate::GpsPoint::new(lat, lng));
                }
            }
            fitparser::profile::MesgNum::Session if !session_read => {
                session_read = true;
                let mut max_speed = None;
                let mut enhanced_max_speed = None;
                for field in record.fields() {
                    match field.name() {
                        "total_elapsed_time" => {
                            recording.elapsed_seconds = finite_number(field.value())
                        }
                        "max_speed" => max_speed = finite_number(field.value()),
                        "enhanced_max_speed" => enhanced_max_speed = finite_number(field.value()),
                        _ => {}
                    }
                }
                // The decoder widens a 16-bit speed into its enhanced field, so
                // the enhanced one is the reading when both are present.
                recording.max_speed = enhanced_max_speed.or(max_speed);
            }
            _ => {}
        }
    }
    Ok(recording)
}

/// One `record` message: the readings a device took at one second.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FitSample {
    /// Unix seconds.
    pub timestamp: i64,
    /// Latitude and longitude in degrees, `None` where the device had no fix.
    pub position: Option<(f64, f64)>,
    /// Metres.
    pub altitude: Option<f64>,
    pub heart_rate: Option<f64>,
    pub cadence: Option<f64>,
    /// Metres from the start.
    pub distance: Option<f64>,
    /// Metres per second.
    pub speed: Option<f64>,
    pub power: Option<f64>,
}

/// The first session message's totals. A figure the device did not write is
/// `None`, never zero.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FitTotals {
    /// The timer's seconds, which pauses do not run.
    pub moving_secs: Option<f64>,
    /// The wall-clock span in seconds, pauses included.
    pub elapsed_secs: Option<f64>,
    pub distance: Option<f64>,
    pub ascent: Option<f64>,
    pub avg_speed: Option<f64>,
    pub max_speed: Option<f64>,
    pub avg_heart_rate: Option<f64>,
    pub max_heart_rate: Option<f64>,
    pub avg_cadence: Option<f64>,
    pub avg_power: Option<f64>,
    pub max_power: Option<f64>,
    pub calories: Option<f64>,
}

/// Everything an activity file holds that a stored activity is made of.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FitActivity {
    /// The start in Unix seconds, UTC.
    pub start_unix: i64,
    /// Wall clock minus UTC in seconds, when the file says what the clock
    /// read.
    pub utc_offset_secs: Option<i64>,
    /// The profile's Sport and SubSport numbers.
    pub sport: Option<u8>,
    pub sub_sport: Option<u8>,
    pub samples: Vec<FitSample>,
    pub totals: FitTotals,
    /// The recording device, from the file's `file_id` message: its product
    /// name, or its manufacturer when the product has none.
    pub device: Option<String>,
}

/// Seconds from the Unix epoch to the FIT epoch, 1989-12-31T00:00:00Z.
const FIT_EPOCH_UNIX: i64 = 631_065_600;

/// No zone is further than this from UTC, so an offset past it is a file that
/// does not mean what it says.
const MAX_UTC_OFFSET_SECS: i64 = 18 * 3600;

/// The activity a FIT file records, from one decode.
///
/// The totals are the first session message's, and a sensor the device had no
/// reading from at a second leaves that sample's field unset. A file with no
/// start time, on its session or on any record, is an error: an activity with
/// no date has no place in a library.
pub fn parse_fit_activity(data: &[u8]) -> Result<FitActivity, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    let records = decode(data)?;
    let mut activity = FitActivity::default();
    let mut session_start = None;
    let mut session_read = false;
    let mut clock = (None, None);
    for record in &records {
        match record.kind() {
            fitparser::profile::MesgNum::Record => {
                if let Some(sample) = sample_of(record) {
                    activity.samples.push(sample);
                }
            }
            fitparser::profile::MesgNum::Session if !session_read => {
                session_read = true;
                session_start = read_session(record, &mut activity);
            }
            fitparser::profile::MesgNum::FileId if activity.device.is_none() => {
                activity.device = device_of(record);
            }
            fitparser::profile::MesgNum::Activity => {
                for field in record.fields() {
                    if let fitparser::Value::Timestamp(at) = field.value() {
                        match field.name() {
                            "timestamp" => clock.0 = Some(*at),
                            "local_timestamp" => clock.1 = Some(*at),
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
    activity.start_unix = session_start
        .or_else(|| activity.samples.first().map(|s| s.timestamp))
        .ok_or_else(|| FitParseError::Decode("the file holds no start time".to_string()))?;
    if let (Some(utc), Some(local)) = clock {
        activity.utc_offset_secs = utc_offset_of(utc.timestamp(), &local);
    }
    Ok(activity)
}

/// The device a `file_id` message names: the product name when it has one,
/// else the manufacturer.
fn device_of(record: &fitparser::FitDataRecord) -> Option<String> {
    let text = |name: &str| {
        record
            .fields()
            .iter()
            .find_map(|field| match field.value() {
                fitparser::Value::String(text)
                    if field.name() == name && !text.trim().is_empty() =>
                {
                    Some(text.trim().to_string())
                }
                _ => None,
            })
    };
    text("product_name").or_else(|| text("manufacturer"))
}

/// One record message as a sample, `None` for a record with no timestamp.
fn sample_of(record: &fitparser::FitDataRecord) -> Option<FitSample> {
    let mut sample = FitSample::default();
    let mut timestamp = None;
    let (mut lat, mut lng) = (None, None);
    let (mut altitude, mut enhanced_altitude) = (None, None);
    let (mut speed, mut enhanced_speed) = (None, None);
    for field in record.fields() {
        let value = field.value();
        match field.name() {
            "timestamp" => timestamp = timestamp_of(value),
            "position_lat" => lat = semicircles_to_degrees(value),
            "position_long" => lng = semicircles_to_degrees(value),
            "altitude" => altitude = signed_number(value),
            "enhanced_altitude" => enhanced_altitude = signed_number(value),
            "heart_rate" => sample.heart_rate = finite_number(value),
            "cadence" => sample.cadence = finite_number(value),
            "distance" => sample.distance = finite_number(value),
            "speed" => speed = finite_number(value),
            "enhanced_speed" => enhanced_speed = finite_number(value),
            "power" => sample.power = finite_number(value),
            _ => {}
        }
    }
    sample.timestamp = timestamp?;
    sample.position = lat.zip(lng);
    // The decoder widens a 16-bit reading into its enhanced field, so the
    // enhanced one is the reading when both are present.
    sample.altitude = enhanced_altitude.or(altitude);
    sample.speed = enhanced_speed.or(speed);
    Some(sample)
}

/// The session's sport and totals into `activity`, answering its start.
fn read_session(record: &fitparser::FitDataRecord, activity: &mut FitActivity) -> Option<i64> {
    let totals = &mut activity.totals;
    let (mut max_speed, mut enhanced_max_speed) = (None, None);
    let (mut avg_speed, mut enhanced_avg_speed) = (None, None);
    let mut start = None;
    for field in record.fields() {
        let value = field.value();
        match field.name() {
            "start_time" => start = timestamp_of(value),
            "sport" => activity.sport = enum_number(value),
            "sub_sport" => activity.sub_sport = enum_number(value),
            "total_timer_time" => totals.moving_secs = finite_number(value),
            "total_elapsed_time" => totals.elapsed_secs = finite_number(value),
            "total_distance" => totals.distance = finite_number(value),
            "total_ascent" => totals.ascent = finite_number(value),
            "avg_speed" => avg_speed = finite_number(value),
            "enhanced_avg_speed" => enhanced_avg_speed = finite_number(value),
            "max_speed" => max_speed = finite_number(value),
            "enhanced_max_speed" => enhanced_max_speed = finite_number(value),
            "avg_heart_rate" => totals.avg_heart_rate = finite_number(value),
            "max_heart_rate" => totals.max_heart_rate = finite_number(value),
            "avg_cadence" => totals.avg_cadence = finite_number(value),
            "avg_power" => totals.avg_power = finite_number(value),
            "max_power" => totals.max_power = finite_number(value),
            "total_calories" => totals.calories = finite_number(value),
            _ => {}
        }
    }
    totals.avg_speed = enhanced_avg_speed.or(avg_speed);
    totals.max_speed = enhanced_max_speed.or(max_speed);
    start
}

fn timestamp_of(value: &fitparser::Value) -> Option<i64> {
    match value {
        fitparser::Value::Timestamp(at) => Some(at.timestamp()),
        _ => None,
    }
}

/// The wall clock's offset from UTC at the end of the file.
///
/// The decoder reads a local timestamp as seconds after the FIT epoch laid on
/// the host's own clock, so the host's zone at that epoch is taken back out
/// first. What remains is the file's own clock minus its UTC one, whichever
/// zone this runs in.
fn utc_offset_of(utc_unix: i64, local: &chrono::DateTime<chrono::Local>) -> Option<i64> {
    use chrono::TimeZone;
    let epoch = chrono::NaiveDate::from_ymd_opt(1989, 12, 31)?.and_hms_opt(0, 0, 0)?;
    let epoch_on_host = chrono::Local
        .from_local_datetime(&epoch)
        .single()?
        .timestamp();
    let local_seconds = local.timestamp() - epoch_on_host;
    let utc_seconds = utc_unix - FIT_EPOCH_UNIX;
    Some(local_seconds - utc_seconds).filter(|offset| offset.abs() <= MAX_UTC_OFFSET_SECS)
}

/// A signed reading in its unit, unlike [`finite_number`] which refuses a
/// negative one: an altitude below sea level is a reading.
fn signed_number(value: &fitparser::Value) -> Option<f64> {
    let number = match value {
        fitparser::Value::Float64(v) => *v,
        fitparser::Value::Float32(v) => f64::from(*v),
        fitparser::Value::SInt8(v) => f64::from(*v),
        fitparser::Value::SInt16(v) => f64::from(*v),
        fitparser::Value::SInt32(v) => f64::from(*v),
        fitparser::Value::SInt64(v) => *v as f64,
        fitparser::Value::UInt8(v) => f64::from(*v),
        fitparser::Value::UInt16(v) => f64::from(*v),
        fitparser::Value::UInt32(v) => f64::from(*v),
        _ => return None,
    };
    number.is_finite().then_some(number)
}

impl FitActivity {
    /// The record series in intervals.icu's names and order, one value per
    /// record, a second with no reading as a gap. A series nothing in the
    /// file measured is left out rather than written as all gaps, so the
    /// stored series are the ones the device had.
    ///
    /// This is the one place a FIT file becomes that canonical form. `time` is
    /// seconds after the start, `latlng` carries latitude in `data` and
    /// longitude in `data2`, and `velocity_smooth` is the recorded speed in
    /// metres per second.
    pub fn streams(&self) -> Vec<crate::net::types::StreamDto> {
        use crate::net::types::StreamDto;
        let series = |kind: &str, read: &dyn Fn(&FitSample) -> Option<f64>| {
            let data: Vec<Option<f64>> = self.samples.iter().map(read).collect();
            data.iter().any(Option::is_some).then(|| StreamDto {
                kind: kind.to_string(),
                data,
                data2: None,
            })
        };
        let mut out = Vec::new();
        if self.samples.is_empty() {
            return out;
        }
        out.push(StreamDto {
            kind: "time".to_string(),
            data: self
                .samples
                .iter()
                .map(|s| Some((s.timestamp - self.start_unix) as f64))
                .collect(),
            data2: None,
        });
        let positions: Vec<Option<(f64, f64)>> = self.samples.iter().map(|s| s.position).collect();
        if positions.iter().any(Option::is_some) {
            out.push(StreamDto {
                kind: "latlng".to_string(),
                data: positions.iter().map(|p| p.map(|p| p.0)).collect(),
                data2: Some(positions.iter().map(|p| p.map(|p| p.1)).collect()),
            });
        }
        out.extend(series("heartrate", &|s| s.heart_rate));
        out.extend(series("watts", &|s| s.power));
        out.extend(series("cadence", &|s| s.cadence));
        out.extend(series("altitude", &|s| s.altitude));
        out.extend(series("distance", &|s| s.distance));
        out.extend(series("velocity_smooth", &|s| s.speed));
        out
    }
}

/// What a pool swim's FIT holds of its lengths.
#[derive(Debug, Clone, Default)]
pub struct FitPoolSwim {
    /// The session's pool length in metres, whichever unit the device showed.
    pub pool_length_m: Option<f64>,
    /// One per `Length` message, in file order, idle lengths included.
    pub lengths: Vec<FitPoolLength>,
}

/// One length of the pool, as the device closed it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FitPoolLength {
    /// Unix seconds.
    pub start_time: Option<i64>,
    pub total_elapsed_time: Option<f64>,
    pub total_timer_time: Option<f64>,
    /// The profile's LengthType: 0 idle, which is a rest, 1 active.
    pub length_type: Option<u8>,
    /// The profile's SwimStroke number, named by `swim_stroke_display_name`.
    pub swim_stroke: Option<u8>,
    pub total_strokes: Option<u16>,
    /// Metres per second.
    pub avg_speed: Option<f64>,
}

/// The FIT invalid value for an enum field.
const INVALID_ENUM: i64 = 0xFF;

/// The lengths and pool length a FIT file records, from one decode.
///
/// A file with no `Length` messages reads as no lengths, which is how an
/// open-water swim or a ride comes back, and an unreadable file is an error, so
/// a caller never takes it for a swim with no lengths. The pool length is the
/// first session message's.
pub fn parse_fit_pool_swim(data: &[u8]) -> Result<FitPoolSwim, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    let records = decode(data)?;
    let mut swim = FitPoolSwim::default();
    let mut session_read = false;
    for record in &records {
        match record.kind() {
            fitparser::profile::MesgNum::Length => {
                let mut length = FitPoolLength::default();
                for field in record.fields() {
                    let value = field.value();
                    match field.name() {
                        "start_time" => {
                            if let fitparser::Value::Timestamp(dt) = value {
                                length.start_time = Some(dt.timestamp());
                            }
                        }
                        "total_elapsed_time" => length.total_elapsed_time = finite_number(value),
                        "total_timer_time" => length.total_timer_time = finite_number(value),
                        "length_type" => length.length_type = enum_number(value),
                        "swim_stroke" => length.swim_stroke = enum_number(value),
                        "total_strokes" => {
                            if let fitparser::Value::UInt16(v) = value {
                                length.total_strokes = Some(*v).filter(|v| *v != INVALID_U16);
                            }
                        }
                        "avg_speed" => length.avg_speed = finite_number(value),
                        _ => {}
                    }
                }
                swim.lengths.push(length);
            }
            fitparser::profile::MesgNum::Session if !session_read => {
                session_read = true;
                swim.pool_length_m = record
                    .fields()
                    .iter()
                    .find(|field| field.name() == "pool_length")
                    .and_then(|field| finite_number(field.value()))
                    .filter(|metres| *metres > 0.0);
            }
            _ => {}
        }
    }
    Ok(swim)
}

/// An enum field's number, left as a number by `decode`, or `None` when the
/// slot holds the invalid value.
fn enum_number(value: &fitparser::Value) -> Option<u8> {
    match value {
        fitparser::Value::SInt64(v) if *v != INVALID_ENUM => u8::try_from(*v).ok(),
        fitparser::Value::Enum(v) if i64::from(*v) != INVALID_ENUM => Some(*v),
        _ => None,
    }
}

/// A scaled FIT number as a finite, non-negative float.
fn finite_number(value: &fitparser::Value) -> Option<f64> {
    let number = match value {
        fitparser::Value::Float64(v) => *v,
        fitparser::Value::Float32(v) => f64::from(*v),
        fitparser::Value::UInt8(v) => f64::from(*v),
        fitparser::Value::UInt16(v) => f64::from(*v),
        fitparser::Value::UInt32(v) => f64::from(*v),
        fitparser::Value::SInt64(v) => *v as f64,
        _ => return None,
    };
    (number.is_finite() && number >= 0.0).then_some(number)
}

/// A FIT position is a signed 32-bit count of 2^-31 half turns.
fn semicircles_to_degrees(value: &fitparser::Value) -> Option<f64> {
    let semicircles = match value {
        fitparser::Value::SInt32(v) => f64::from(*v),
        fitparser::Value::SInt64(v) => *v as f64,
        fitparser::Value::Float64(v) => *v,
        _ => return None,
    };
    Some(semicircles * (180.0 / 2_147_483_648.0))
}

/// The exercise sets among already-decoded FIT records.
fn sets_from_records(records: &[fitparser::FitDataRecord]) -> Vec<FitExerciseSet> {
    let mut sets = Vec::new();
    let mut set_order: u32 = 0;

    for record in records {
        // Filter for "Set" messages (exercise set records)
        if record.kind() != fitparser::profile::MesgNum::Set {
            continue;
        }

        let mut exercise_category: Option<u16> = None;
        let mut exercise_name_val: Option<u16> = None;
        let mut set_type: Option<u8> = None;
        let mut repetitions: Option<u16> = None;
        let mut weight_kg: Option<f64> = None;
        let mut duration_secs: Option<f64> = None;
        let mut start_time: Option<i64> = None;
        let mut timestamp: Option<i64> = None;

        for field in record.fields() {
            match field.name() {
                "category" | "exercise_category" => {
                    exercise_category = top_candidate(field.value());
                }
                "category_subtype" | "exercise_name" => {
                    exercise_name_val = top_candidate(field.value());
                }
                "set_type" => {
                    if let fitparser::Value::SInt64(v) = field.value() {
                        set_type = Some(stored_set_type(*v));
                    }
                }
                "repetitions" => {
                    if let fitparser::Value::UInt16(v) = field.value() {
                        repetitions = Some(*v);
                    }
                }
                "weight" => match field.value() {
                    fitparser::Value::Float64(v) => weight_kg = Some(*v),
                    fitparser::Value::UInt16(v) => weight_kg = Some(*v as f64 / 16.0),
                    _ => {}
                },
                "duration" => match field.value() {
                    fitparser::Value::Float64(v) => duration_secs = Some(*v),
                    fitparser::Value::UInt32(v) => duration_secs = Some(*v as f64 / 1000.0),
                    _ => {}
                },
                "start_time" => {
                    if let fitparser::Value::Timestamp(dt) = field.value() {
                        start_time = Some(dt.timestamp());
                    }
                }
                "timestamp" => {
                    if let fitparser::Value::Timestamp(dt) = field.value() {
                        timestamp = Some(dt.timestamp());
                    }
                }
                _ => {}
            }
        }

        sets.push(FitExerciseSet {
            set_order,
            exercise_category: exercise_category.unwrap_or(0xFFFF),
            exercise_name: exercise_name_val,
            set_type: set_type.unwrap_or(0),
            repetitions,
            weight_kg,
            duration_secs,
            start_time: start_time.or(timestamp),
        });
        set_order += 1;
    }

    sets
}

/// The FIT invalid value for a `uint16` field: the slot holds nothing.
const INVALID_U16: u16 = 0xFFFF;

/// FIT's `SetType` (Profile v21.133) numbers rest 0 and active 1. The stored
/// convention is the reverse, 0 active and 1 rest, and every reader of
/// `exercise_sets.set_type` keys on it, so the number is mapped rather than
/// copied. A value the profile does not name counts as active, as it did when
/// the decoder named the field.
fn stored_set_type(fit_value: i64) -> u8 {
    const FIT_REST: i64 = 0;
    if fit_value == FIT_REST { 1 } else { 0 }
}

/// The watch's top candidate from a field that lists several.
///
/// `category` and `category_subtype` are parallel arrays ranked by the
/// watch's confidence, so the first slot is its answer. `0xFFFE` there is the
/// exercise category `unknown` and means the set was not recognised; reading
/// past it to a later slot would name the set by its least likely candidate.
///
/// A field written with one slot decodes as a scalar rather than an array:
/// `category`, an enum, as `SInt64`, and `category_subtype`, a plain `uint16`,
/// as `UInt16`.
fn top_candidate(value: &fitparser::Value) -> Option<u16> {
    let slot = |v: &fitparser::Value| match v {
        fitparser::Value::UInt16(v) => Some(*v),
        fitparser::Value::SInt64(v) => u16::try_from(*v).ok(),
        _ => None,
    };
    let first = match value {
        fitparser::Value::Array(arr) => arr.first().and_then(slot),
        scalar => slot(scalar),
    };
    first.filter(|v| *v != INVALID_U16)
}

// ============================================================================
// Exercise Name Lookup
// ============================================================================

/// Get a human-readable display name for a FIT exercise category and optional sub-type.
/// Category IDs follow FIT SDK Profile v21.133 ExerciseCategory enum.
pub fn exercise_display_name(category: u16, _subcategory: Option<u16>) -> String {
    match category {
        0 => "Bench Press".into(),
        1 => "Calf Raise".into(),
        2 => "Cardio".into(),
        3 => "Carry".into(),
        4 => "Chop".into(),
        5 => "Core".into(),
        6 => "Crunch".into(),
        7 => "Curl".into(),
        8 => "Deadlift".into(),
        9 => "Flye".into(),
        10 => "Hip Raise".into(),
        11 => "Hip Stability".into(),
        12 => "Hip Swing".into(),
        13 => "Hyperextension".into(),
        14 => "Lateral Raise".into(),
        15 => "Leg Curl".into(),
        16 => "Leg Raise".into(),
        17 => "Lunge".into(),
        18 => "Olympic Lift".into(),
        19 => "Plank".into(),
        20 => "Plyo".into(),
        21 => "Pull Up".into(),
        22 => "Push Up".into(),
        23 => "Row".into(),
        24 => "Shoulder Press".into(),
        25 => "Shoulder Stability".into(),
        26 => "Shrug".into(),
        27 => "Sit Up".into(),
        28 => "Squat".into(),
        29 => "Total Body".into(),
        30 => "Triceps Extension".into(),
        31 => "Warm Up".into(),
        32 => "Run".into(),
        0xFFFF | 0xFFFE => "Unknown Exercise".into(),
        other => format!("Exercise {}", other),
    }
}

/// A display name for a FIT SwimStroke number, as the profile names them.
pub fn swim_stroke_display_name(stroke: u8) -> String {
    match stroke {
        0 => "Freestyle".into(),
        1 => "Backstroke".into(),
        2 => "Breaststroke".into(),
        3 => "Butterfly".into(),
        4 => "Drill".into(),
        5 => "Mixed".into(),
        6 | 7 => "IM".into(),
        8 => "Reverse IM".into(),
        other => format!("Stroke {}", other),
    }
}

/// A locale key for a FIT SwimStroke number, the name a screen translates.
pub fn swim_stroke_key(stroke: u8) -> &'static str {
    match stroke {
        0 => "freestyle",
        1 => "backstroke",
        2 => "breaststroke",
        3 => "butterfly",
        4 => "drill",
        5 => "mixed",
        6 | 7 => "im",
        8 => "reverseIm",
        _ => "unknown",
    }
}

// ============================================================================
// Muscle Group Mapping
// ============================================================================

/// Muscle group with activation level.
#[derive(Debug, Clone)]
pub struct MuscleActivation {
    /// Slug matching react-native-body-highlighter format
    pub slug: String,
    /// 1 = secondary, 2 = primary
    pub intensity: u8,
}

/// Get muscle groups targeted by an exercise category.
/// Returns slugs matching react-native-body-highlighter's data format.
///
/// Category IDs follow FIT SDK Profile v21.133 ExerciseCategory enum.
/// A slug added here needs its English name in `exerciseMuscleMap.ts`, which
/// the contract table in `nativeContracts.test.ts` checks.
pub fn exercise_muscle_groups(category: u16) -> Vec<MuscleActivation> {
    let (primary, secondary): (&[&str], &[&str]) = match category {
        0 => (&["chest", "triceps"], &["deltoids"]), // Bench Press
        1 => (&["calves"], &[]),                     // Calf Raise
        2 => (&[], &[]),                             // Cardio
        3 => (&["forearm", "trapezius"], &["abs", "obliques"]), // Carry
        4 => (&["obliques", "abs"], &["deltoids"]),  // Chop
        5 => (&["abs", "obliques"], &["lower-back"]), // Core
        6 => (&["abs"], &["obliques"]),              // Crunch
        7 => (&["biceps"], &["forearm"]),            // Curl
        8 => (
            &["hamstring", "gluteal", "lower-back"],
            &["trapezius", "forearm"],
        ), // Deadlift
        9 => (&["chest"], &["deltoids"]),            // Flye
        10 => (&["gluteal"], &["hamstring"]),        // Hip Raise
        11 => (&["gluteal"], &["adductors"]),        // Hip Stability
        12 => (&["gluteal", "hamstring"], &["abs"]), // Hip Swing
        13 => (&["lower-back"], &["gluteal", "hamstring"]), // Hyperextension
        14 => (&["deltoids"], &["trapezius"]),       // Lateral Raise
        15 => (&["hamstring"], &["calves"]),         // Leg Curl
        16 => (&["abs"], &["obliques"]),             // Leg Raise
        17 => (&["quadriceps", "gluteal"], &["hamstring", "calves"]), // Lunge
        18 => (
            &["quadriceps", "gluteal", "trapezius"],
            &["deltoids", "hamstring"],
        ), // Olympic Lift
        19 => (&["abs", "obliques"], &["lower-back"]), // Plank
        20 => (&["quadriceps", "calves"], &["hamstring", "gluteal"]), // Plyo
        21 => (&["upper-back", "biceps"], &["forearm", "deltoids"]), // Pull Up
        22 => (&["chest", "triceps"], &["deltoids", "abs"]), // Push Up
        23 => (&["upper-back", "biceps"], &["lower-back", "forearm"]), // Row
        24 => (&["deltoids", "triceps"], &["trapezius"]), // Shoulder Press
        25 => (&["deltoids"], &["trapezius"]),       // Shoulder Stability
        26 => (&["trapezius"], &[]),                 // Shrug
        27 => (&["abs"], &["obliques"]),             // Sit Up
        28 => (
            &["quadriceps", "gluteal"],
            &["hamstring", "calves", "lower-back"],
        ), // Squat
        29 => (&["quadriceps", "chest", "deltoids"], &["abs", "triceps"]), // Total Body
        30 => (&["triceps"], &[]),                   // Triceps Extension
        31 | 32 => (&[], &[]),                       // Warm Up / Run (no strength muscles)
        0xFFFF | 0xFFFE => (&[], &[]),               // Unknown / Invalid
        other => {
            log::debug!("[fit] Unknown exercise category {other}, no muscle mapping available");
            (&[], &[])
        }
    };

    let mut groups = Vec::new();
    for slug in primary {
        groups.push(MuscleActivation {
            slug: slug.to_string(),
            intensity: 2,
        });
    }
    for slug in secondary {
        groups.push(MuscleActivation {
            slug: slug.to_string(),
            intensity: 1,
        });
    }
    groups
}

/// Aggregate muscle groups across multiple exercise sets.
/// For each muscle slug, keeps the highest intensity (primary wins over secondary).
pub fn aggregate_muscle_groups(sets: &[FitExerciseSet]) -> Vec<MuscleActivation> {
    let mut map: HashMap<String, u8> = HashMap::new();

    for set in sets {
        // Only count active sets (not rest/warmup)
        if set.set_type != 0 {
            continue;
        }
        for activation in exercise_muscle_groups(set.exercise_category) {
            let entry = map.entry(activation.slug.clone()).or_insert(0);
            if activation.intensity > *entry {
                *entry = activation.intensity;
            }
        }
    }

    let mut result: Vec<MuscleActivation> = map
        .into_iter()
        .map(|(slug, intensity)| MuscleActivation { slug, intensity })
        .collect();
    result.sort_by(|a, b| b.intensity.cmp(&a.intensity).then(a.slug.cmp(&b.slug)));
    result
}

/// A FIT the app's own writer produced for a ride of 30 positions, kept as hex
/// text because a binary activity file is refused from the tree.
#[cfg(test)]
pub(crate) fn recorded_ride_fit() -> Vec<u8> {
    let hex: String = include_str!("../tests/fixtures/recorded_ride_fit.hex")
        .split_whitespace()
        .collect();
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex fixture"))
        .collect()
}

/// A 25 m pool swim built to the FIT profile: four active lengths, two of
/// freestyle and two of breaststroke, with an idle length third. Hex text for
/// the same reason as the ride.
#[cfg(test)]
pub(crate) fn pool_swim_fit() -> Vec<u8> {
    let hex: String = include_str!("../tests/fixtures/pool_swim_fit.hex")
        .split_whitespace()
        .collect();
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex fixture"))
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    /// Scenario: a ride's provisional row is written from the FIT the device
    /// saved, at save time or by the replay at the next launch, so the track
    /// has to come back out of the file the app's own writer produced.
    ///
    /// Expected behaviour: every record's position, in order, in degrees.
    #[test]
    fn the_track_comes_back_out_of_a_fit_the_app_wrote() {
        let data = super::recorded_ride_fit();
        let track = super::parse_fit_track(&data).expect("a readable FIT");
        assert_eq!(track.len(), 30);
        for (i, point) in track.iter().enumerate() {
            let lat = 46.948 + i as f64 * 0.0001;
            let lng = 7.4474 + i as f64 * 0.00005;
            assert!(
                (point.latitude - lat).abs() < 1e-6 && (point.longitude - lng).abs() < 1e-6,
                "point {i} read as {point:?}"
            );
        }
    }

    /// Scenario: a ride paused for part of its span is saved and never
    /// uploaded, so the provisional row is the only row it will have.
    ///
    /// Expected behaviour: the session's wall-clock span and top speed come
    /// back out of the file the app's own writer produced.
    #[test]
    fn the_session_totals_come_back_out_of_a_fit_the_app_wrote() {
        let recording = super::parse_fit_recording(&super::recorded_ride_fit()).unwrap();
        assert_eq!(recording.track.len(), 30);
        assert_eq!(recording.elapsed_seconds, Some(58.0));
        assert_eq!(recording.max_speed, Some(5.0));
    }

    #[test]
    fn an_unreadable_fit_is_an_error_not_an_empty_track() {
        assert!(super::parse_fit_track(&[]).is_err());
        assert!(super::parse_fit_track(b"not a fit file").is_err());
    }

    fn kinds(streams: &[crate::net::types::StreamDto]) -> Vec<&str> {
        streams.iter().map(|s| s.kind.as_str()).collect()
    }

    fn stream<'a>(
        streams: &'a [crate::net::types::StreamDto],
        kind: &str,
    ) -> &'a crate::net::types::StreamDto {
        streams.iter().find(|s| s.kind == kind).expect(kind)
    }

    /// Scenario: a Garmin original is the only copy of a ride once the server
    /// stops serving it, so everything a stored activity is made of has to come
    /// out of the file.
    ///
    /// Expected behaviour: the start in UTC with the wall clock's offset, the
    /// sport numbers, every sensor series in intervals.icu's names and order at
    /// the length of `time`, and the session totals.
    #[test]
    fn an_outdoor_ride_reads_back_its_start_series_and_totals() {
        let ride = super::super::fit_synthetic::outdoor_ride();
        let activity = parse_fit_activity(&ride.to_fit()).expect("a readable FIT");

        assert_eq!(activity.start_unix, ride.start_unix);
        assert_eq!(activity.utc_offset_secs, Some(7_200));
        assert_eq!(activity.sport, Some(2));
        assert_eq!(activity.sub_sport, Some(0));

        let streams = activity.streams();
        assert_eq!(
            kinds(&streams),
            [
                "time",
                "latlng",
                "heartrate",
                "watts",
                "cadence",
                "altitude",
                "distance",
                "velocity_smooth"
            ]
        );
        assert!(streams.iter().all(|s| s.data.len() == 30));
        let time = stream(&streams, "time");
        assert_eq!(time.data[0], Some(0.0));
        assert_eq!(time.data[29], Some(29.0));
        assert_eq!(stream(&streams, "heartrate").data[3], Some(123.0));
        assert_eq!(stream(&streams, "watts").data[29], Some(229.0));
        assert_eq!(stream(&streams, "cadence").data[4], Some(84.0));
        let near = |got: Option<f64>, want: f64, tolerance: f64| {
            assert!(
                got.is_some_and(|v| (v - want).abs() <= tolerance),
                "{got:?} is not {want}"
            );
        };
        near(stream(&streams, "altitude").data[2], 501.0, 0.2);
        near(stream(&streams, "distance").data[5], 30.0, 0.01);
        near(stream(&streams, "velocity_smooth").data[7], 6.0, 0.001);
        let latlng = stream(&streams, "latlng");
        near(latlng.data[10], 46.501, 1e-6);
        near(latlng.data2.as_ref().unwrap()[10], 7.2505, 1e-6);

        let totals = &activity.totals;
        assert_eq!(totals.moving_secs, Some(28.0));
        assert_eq!(totals.elapsed_secs, Some(30.0));
        assert_eq!(totals.distance, Some(174.0));
        assert_eq!(totals.ascent, Some(15.0));
        near(totals.avg_speed, 6.2, 0.001);
        near(totals.max_speed, 6.5, 0.001);
        assert_eq!(totals.avg_heart_rate, Some(135.0));
        assert_eq!(totals.max_heart_rate, Some(149.0));
        assert_eq!(totals.avg_cadence, Some(82.0));
        assert_eq!(totals.avg_power, Some(214.0));
        assert_eq!(totals.max_power, Some(229.0));
        assert_eq!(totals.calories, Some(11.0));
    }

    /// Scenario: a trainer ride has no fix and no altitude, and the device
    /// writes those fields as invalid values.
    ///
    /// Expected behaviour: no `latlng` and no `altitude` series, and an invalid
    /// value is not read as a reading, while the sensors that did read stay.
    #[test]
    fn an_indoor_ride_has_no_position_or_altitude_series() {
        let ride = super::super::fit_synthetic::indoor_ride();
        let activity = parse_fit_activity(&ride.to_fit()).expect("a readable FIT");

        assert_eq!(activity.sub_sport, Some(6));
        assert_eq!(activity.totals.ascent, None);
        let streams = activity.streams();
        assert_eq!(
            kinds(&streams),
            [
                "time",
                "heartrate",
                "watts",
                "cadence",
                "distance",
                "velocity_smooth"
            ]
        );
        assert!(streams.iter().all(|s| s.data.len() == 30));
    }

    /// Scenario: a ride loses its fix and its heart rate strap for a second.
    ///
    /// Expected behaviour: that second is a gap in those series and the series
    /// keep their length, so the others stay aligned with `time`.
    #[test]
    fn a_second_with_no_reading_is_a_gap_and_keeps_the_series_aligned() {
        let mut ride = super::super::fit_synthetic::outdoor_ride();
        ride.samples[7].position = None;
        ride.samples[7].heart_rate = None;
        ride.samples[8].altitude = Some(-20.0);
        let activity = parse_fit_activity(&ride.to_fit()).expect("a readable FIT");

        let streams = activity.streams();
        assert!(streams.iter().all(|s| s.data.len() == 30));
        assert_eq!(stream(&streams, "heartrate").data[7], None);
        assert_eq!(stream(&streams, "heartrate").data[8], Some(128.0));
        let latlng = stream(&streams, "latlng");
        assert_eq!(latlng.data[7], None);
        assert_eq!(latlng.data2.as_ref().unwrap()[7], None);
        assert!(latlng.data[6].is_some() && latlng.data[8].is_some());
        assert!(
            stream(&streams, "altitude").data[8].is_some_and(|v| (v + 20.0).abs() < 0.2),
            "a reading below sea level is a reading"
        );
    }

    /// The decoder lays a local timestamp on the host's own clock, so the
    /// offset has to come out the same whichever zone the host is in.
    #[test]
    fn the_utc_offset_does_not_depend_on_the_hosts_zone() {
        use chrono::TimeZone;
        let epoch = chrono::NaiveDate::from_ymd_opt(1989, 12, 31)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let on_host = chrono::Local.from_local_datetime(&epoch).single().unwrap();
        let utc_unix = 1_773_471_600;
        for offset in [-9 * 3600, 0, 5 * 3600 + 1800, 14 * 3600] {
            let local = on_host + chrono::Duration::seconds(utc_unix - FIT_EPOCH_UNIX + offset);
            assert_eq!(utc_offset_of(utc_unix, &local), Some(offset));
        }
        let far = on_host + chrono::Duration::seconds(utc_unix - FIT_EPOCH_UNIX + 20 * 3600);
        assert_eq!(utc_offset_of(utc_unix, &far), None);
    }

    #[test]
    fn an_unreadable_activity_fit_is_an_error_not_an_empty_activity() {
        assert!(matches!(parse_fit_activity(&[]), Err(FitParseError::Empty)));
        let good = super::super::fit_synthetic::outdoor_ride().to_fit();
        let mut flipped = good.clone();
        let last = flipped.len() - 1;
        flipped[last] ^= 0xFF;
        for data in [
            flipped,
            good[..good.len() / 2].to_vec(),
            b"not a fit file".to_vec(),
        ] {
            assert!(matches!(
                parse_fit_activity(&data),
                Err(FitParseError::Decode(_))
            ));
        }
        for data in oversized_headers() {
            assert!(matches!(
                parse_fit_activity(&data),
                Err(FitParseError::Decode(_))
            ));
        }
    }

    /// A header that claims 255 bytes in a 20-byte file, with a set and with a
    /// zero header CRC, the two branches the decoder slices the header on.
    fn oversized_headers() -> [Vec<u8>; 2] {
        let header = |crc: [u8; 2]| {
            let mut data = vec![255, 0x20, 0x54, 0x08, 0, 0, 0, 0, b'.', b'F', b'I', b'T'];
            data.extend_from_slice(&crc);
            data.extend_from_slice(&[0; 6]);
            data
        };
        [header([0x12, 0x34]), header([0, 0])]
    }

    /// Scenario: an uploaded file's header claims more bytes than the file
    /// holds. The batch that downloads strength sets walks every activity in one
    /// job, so a panic here stops it at the same activity on every retry.
    ///
    /// Expected behaviour: each parser returns a decode error and does not panic.
    #[test]
    fn a_header_larger_than_the_file_is_a_decode_error_not_a_panic() {
        for data in oversized_headers() {
            assert!(matches!(
                super::parse_fit_strength_sets(&data),
                Err(super::FitParseError::Decode(_))
            ));
            assert!(matches!(
                super::parse_fit_track(&data),
                Err(super::FitParseError::Decode(_))
            ));
        }
    }

    use super::*;

    fn candidates(slots: &[u16]) -> fitparser::Value {
        fitparser::Value::Array(slots.iter().map(|v| fitparser::Value::UInt16(*v)).collect())
    }

    #[test]
    fn top_candidate_is_the_first_slot() {
        assert_eq!(top_candidate(&candidates(&[0, 24, 0xFFFE])), Some(0));
        assert_eq!(top_candidate(&candidates(&[23, 0xFFFE, 7])), Some(23));
        assert_eq!(top_candidate(&candidates(&[27, 6, 0xFFFE])), Some(27));
    }

    #[test]
    fn an_unrecognised_set_stays_unknown_rather_than_its_last_candidate() {
        assert_eq!(
            top_candidate(&candidates(&[0xFFFE, 0xFFFE, 7])),
            Some(0xFFFE)
        );
    }

    #[test]
    fn an_invalid_first_slot_is_no_category() {
        assert_eq!(top_candidate(&candidates(&[0xFFFF, 0xFFFF, 0xFFFF])), None);
        assert_eq!(top_candidate(&candidates(&[0xFFFF, 7, 0xFFFF])), None);
        assert_eq!(top_candidate(&candidates(&[])), None);
        assert_eq!(top_candidate(&fitparser::Value::UInt16(0xFFFF)), None);
    }

    /// A field holding one slot is not an array once decoded. Asked for numeric
    /// enum values, fitparser hands its value over as `SInt64`.
    #[test]
    fn a_single_slot_is_its_own_candidate() {
        assert_eq!(top_candidate(&fitparser::Value::SInt64(28)), Some(28));
        assert_eq!(top_candidate(&fitparser::Value::SInt64(0)), Some(0));
        assert_eq!(
            top_candidate(&fitparser::Value::SInt64(0xFFFE)),
            Some(0xFFFE)
        );
    }

    #[test]
    fn a_single_slot_outside_the_category_range_is_no_category() {
        assert_eq!(top_candidate(&fitparser::Value::SInt64(0xFFFF)), None);
        assert_eq!(top_candidate(&fitparser::Value::SInt64(-1)), None);
        assert_eq!(top_candidate(&fitparser::Value::SInt64(0x1_0000)), None);
    }

    /// The FIT CRC-16 the SDK specifies, over the header and over the file.
    fn fit_crc(bytes: &[u8]) -> u16 {
        const TABLE: [u16; 16] = [
            0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800,
            0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
        ];
        bytes.iter().fold(0u16, |crc, byte| {
            let tmp = TABLE[(crc & 0xF) as usize];
            let crc = (crc >> 4) & 0x0FFF;
            let crc = crc ^ tmp ^ TABLE[(byte & 0xF) as usize];
            let tmp = TABLE[(crc & 0xF) as usize];
            let crc = (crc >> 4) & 0x0FFF;
            crc ^ tmp ^ TABLE[((byte >> 4) & 0xF) as usize]
        })
    }

    /// A FIT file of `Set` messages. Local message 0 writes `category` with
    /// one slot and local message 1 with three, which is how a watch that
    /// ranks candidates writes it.
    pub(crate) fn fit_file(sets: &[(u8, u8, u16, &[u16])]) -> Vec<u8> {
        const SET: u16 = 225;
        let definition = |local: u8, slots: u8| {
            let mut bytes = vec![0x40 | local, 0, 0];
            bytes.extend_from_slice(&SET.to_le_bytes());
            bytes.push(3);
            bytes.extend_from_slice(&[5, 1, 0x00]); // set_type, enum
            bytes.extend_from_slice(&[3, 2, 0x84]); // repetitions, uint16
            bytes.extend_from_slice(&[7, 2 * slots, 0x84]); // category, uint16[]
            bytes
        };

        let mut data = definition(0, 1);
        data.extend(definition(1, 3));
        for (local, set_type, reps, category) in sets {
            data.push(*local);
            data.push(*set_type);
            data.extend_from_slice(&reps.to_le_bytes());
            for slot in *category {
                data.extend_from_slice(&slot.to_le_bytes());
            }
        }

        let mut file = vec![14, 0x20];
        file.extend_from_slice(&2132u16.to_le_bytes());
        file.extend_from_slice(&(data.len() as u32).to_le_bytes());
        file.extend_from_slice(b".FIT");
        let header_crc = fit_crc(&file);
        file.extend_from_slice(&header_crc.to_le_bytes());
        file.extend(data);
        let file_crc = fit_crc(&file);
        file.extend_from_slice(&file_crc.to_le_bytes());
        file
    }

    /// Scenario: a device writes a set's `category` as a single `uint16`. The
    /// decoder turns a one-slot enum into its name, `"squat"`, which no slot
    /// reader takes, so the set was stored as no category at all.
    ///
    /// Expected behaviour: the one slot is the category, the three-slot form
    /// still reads its first slot, and a rest set still reads as rest.
    #[test]
    fn a_set_written_with_one_category_slot_keeps_its_category() {
        // The file carries FIT's own `set_type`, where 1 is active and 0 rest.
        let file = fit_file(&[
            (0, 1, 5, &[28]),
            (0, 0, 0xFFFF, &[0xFFFF]),
            (1, 1, 8, &[0, 24, 0xFFFE]),
        ]);

        let sets = parse_fit_strength_sets(&file).expect("the file decodes");

        let read: Vec<(u16, u8, Option<u16>)> = sets
            .iter()
            .map(|s| (s.exercise_category, s.set_type, s.repetitions))
            .collect();
        assert_eq!(
            read,
            vec![(28, 0, Some(5)), (0xFFFF, 1, None), (0, 0, Some(8))]
        );
    }

    #[test]
    fn test_exercise_display_name() {
        assert_eq!(exercise_display_name(0, None), "Bench Press");
        assert_eq!(exercise_display_name(28, None), "Squat");
        assert_eq!(exercise_display_name(7, Some(0)), "Curl");
        assert_eq!(exercise_display_name(0xFFFF, None), "Unknown Exercise");
        assert_eq!(exercise_display_name(99, None), "Exercise 99");
    }

    #[test]
    fn test_muscle_groups() {
        let groups = exercise_muscle_groups(0); // Bench Press
        assert!(groups.iter().any(|g| g.slug == "chest" && g.intensity == 2));
        assert!(
            groups
                .iter()
                .any(|g| g.slug == "triceps" && g.intensity == 2)
        );
        assert!(
            groups
                .iter()
                .any(|g| g.slug == "deltoids" && g.intensity == 1)
        );
    }

    #[test]
    fn test_aggregate_muscle_groups() {
        let sets = vec![
            FitExerciseSet {
                set_order: 0,
                exercise_category: 0, // Bench Press
                exercise_name: None,
                set_type: 0, // active
                repetitions: Some(10),
                weight_kg: Some(60.0),
                duration_secs: None,
                start_time: None,
            },
            FitExerciseSet {
                set_order: 1,
                exercise_category: 7, // Curl
                exercise_name: None,
                set_type: 0, // active
                repetitions: Some(12),
                weight_kg: Some(15.0),
                duration_secs: None,
                start_time: None,
            },
        ];

        let groups = aggregate_muscle_groups(&sets);
        assert!(groups.iter().any(|g| g.slug == "chest" && g.intensity == 2));
        assert!(
            groups
                .iter()
                .any(|g| g.slug == "biceps" && g.intensity == 2)
        );
        assert!(
            groups
                .iter()
                .any(|g| g.slug == "forearm" && g.intensity == 1)
        );
    }

    #[test]
    fn test_rest_sets_excluded_from_muscle_groups() {
        let sets = vec![FitExerciseSet {
            set_order: 0,
            exercise_category: 0,
            exercise_name: None,
            set_type: 1, // rest
            repetitions: None,
            weight_kg: None,
            duration_secs: Some(60.0),
            start_time: None,
        }];

        let groups = aggregate_muscle_groups(&sets);
        assert!(groups.is_empty());
    }

    /// One flipped byte in the trailing CRC fails the whole file, and that
    /// must read as a decode failure, never as a file with no sets.
    #[test]
    fn a_file_with_a_broken_crc_is_a_decode_error() {
        let mut file = fit_file(&[(0, 1, 5, &[28])]);
        let last = file.len() - 1;
        file[last] ^= 0xFF;

        assert!(matches!(
            parse_fit_strength_sets(&file),
            Err(FitParseError::Decode(_))
        ));
    }

    #[test]
    fn test_parse_fit_strength_sets_empty_is_error() {
        match parse_fit_strength_sets(&[]) {
            Err(FitParseError::Empty) => {}
            other => panic!("expected Empty error, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_fit_strength_sets_malformed_is_decode_error() {
        // Non-empty but invalid FIT header should fail decoding.
        match parse_fit_strength_sets(&[0u8; 16]) {
            Err(FitParseError::Decode(_)) => {}
            other => panic!("expected Decode error, got {:?}", other),
        }
    }

    /// Scenario: a pool swim's per-length structure lives only in its FIT
    /// file, since the activity record carries a count and a pool length.
    ///
    /// Expected behaviour: every length in file order, the idle one kept where
    /// the rest fell, with its stroke, stroke count and times as written, and
    /// the session's pool length in metres.
    #[test]
    fn a_pool_swim_reads_back_its_lengths_and_pool_length() {
        let swim = parse_fit_pool_swim(&super::pool_swim_fit()).expect("a readable FIT");
        assert_eq!(swim.pool_length_m, Some(25.0));

        let read: Vec<(Option<u8>, Option<u8>, Option<u16>)> = swim
            .lengths
            .iter()
            .map(|l| (l.length_type, l.swim_stroke, l.total_strokes))
            .collect();
        assert_eq!(
            read,
            vec![
                (Some(1), Some(0), Some(18)),
                (Some(1), Some(0), Some(19)),
                (Some(0), None, None),
                (Some(1), Some(2), Some(14)),
                (Some(1), Some(2), Some(15)),
            ]
        );

        let first = &swim.lengths[0];
        assert_eq!(first.start_time, Some(1_100_000_000 + 631_065_600));
        assert_eq!(first.total_elapsed_time, Some(25.0));
        assert_eq!(first.total_timer_time, Some(25.0));
        assert_eq!(first.avg_speed, Some(1.0));
        assert_eq!(swim.lengths[2].avg_speed, None);
        assert_eq!(swim.lengths[3].total_elapsed_time, Some(32.0));
        assert_eq!(swim.lengths[4].avg_speed, Some(0.8));

        let starts: Vec<i64> = swim.lengths.iter().filter_map(|l| l.start_time).collect();
        assert!(starts.windows(2).all(|w| w[0] < w[1]), "{starts:?}");
    }

    /// A ride has no lengths and no pool, and that is a valid reading rather
    /// than an error, which is also how an open-water swim reads.
    #[test]
    fn a_ride_reads_as_no_lengths_and_no_pool() {
        let swim = parse_fit_pool_swim(&super::recorded_ride_fit()).expect("a readable FIT");
        assert!(swim.lengths.is_empty());
        assert_eq!(swim.pool_length_m, None);
    }

    #[test]
    fn a_pool_swim_from_empty_bytes_is_empty() {
        assert!(matches!(
            parse_fit_pool_swim(&[]),
            Err(FitParseError::Empty)
        ));
    }

    #[test]
    fn a_truncated_pool_swim_is_a_decode_error_not_fewer_lengths() {
        let data = super::pool_swim_fit();
        for cut in [data.len() - 1, data.len() / 2, 20] {
            assert!(
                matches!(
                    parse_fit_pool_swim(&data[..cut]),
                    Err(FitParseError::Decode(_))
                ),
                "cut at {cut}"
            );
        }
        let header = oversized_headers();
        assert!(matches!(
            parse_fit_pool_swim(&header[0]),
            Err(FitParseError::Decode(_))
        ));
    }

    #[test]
    fn swim_strokes_are_named_by_the_profile_number() {
        let names: Vec<String> = (0..=6).map(swim_stroke_display_name).collect();
        assert_eq!(
            names,
            [
                "Freestyle",
                "Backstroke",
                "Breaststroke",
                "Butterfly",
                "Drill",
                "Mixed",
                "IM"
            ]
        );
        assert_eq!(swim_stroke_display_name(42), "Stroke 42");
    }
}
