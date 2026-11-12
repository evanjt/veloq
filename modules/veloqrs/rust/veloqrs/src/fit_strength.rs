//! Writes a strength session as a FIT activity file: one `set` message per
//! exercise set and per rest, heart rate `record` messages with no position,
//! and the lap and session totals. Only fields the FIT profile defines are
//! written, so `fit::parse_fit_strength_sets` reads the sets back.

use crate::fit_write::{
    BASE_ENUM, BASE_STRING, BASE_UINT8, BASE_UINT16, BASE_UINT32, FIT_EPOCH_UNIX, INVALID_UINT8,
    INVALID_UINT16, INVALID_UINT32, definition, wrap,
};

const MESG_FILE_ID: u16 = 0;
const MESG_SESSION: u16 = 18;
const MESG_LAP: u16 = 19;
const MESG_RECORD: u16 = 20;
const MESG_EVENT: u16 = 21;
const MESG_DEVICE_INFO: u16 = 23;
const MESG_ACTIVITY: u16 = 34;
const MESG_SET: u16 = 225;

/// The profile's development manufacturer, for software that is not a device
/// maker's, and the product number this app writes under it.
const MANUFACTURER_DEVELOPMENT: u16 = 255;
const PRODUCT_ID: u16 = 1;
const SOFTWARE_VERSION: u16 = 4;
const APP_NAME: &str = "Veloq";

/// The profile's `fitness_equipment` sport and `strength_training` sub sport.
const SPORT_FITNESS_EQUIPMENT: u8 = 4;
const SUB_SPORT_STRENGTH_TRAINING: u8 = 13;

/// The profile's `set_type` numbers. The profile at this version names only
/// these two.
const SET_TYPE_REST: u8 = 0;
const SET_TYPE_ACTIVE: u8 = 1;

/// What a `set` message records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetKind {
    Active,
    /// An active set the athlete marked as a warm-up. The profile has no
    /// warm-up value for `set_type`, so it is written as an active set.
    WarmUp,
    Rest,
}

/// One set or one rest, in the order done.
#[derive(Debug, Clone)]
pub struct WrittenSet {
    pub kind: SetKind,
    /// The profile's exercise category; `None` for a rest.
    pub category: Option<u16>,
    /// The profile's exercise name within the category.
    pub name: Option<u16>,
    pub repetitions: Option<u16>,
    pub weight_kg: Option<f64>,
    /// Seconds after the session's start.
    pub start_offset_secs: u32,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct HeartRateSample {
    /// Seconds after the session's start.
    pub offset_secs: u32,
    pub bpm: u8,
}

#[derive(Debug, Clone)]
pub struct StrengthSession {
    pub start_unix: i64,
    pub sets: Vec<WrittenSet>,
    pub heart_rate: Vec<HeartRateSample>,
}

impl StrengthSession {
    /// Seconds from the start to the last set's end or heart rate sample.
    fn elapsed_secs(&self) -> u32 {
        let sets = self.sets.iter().map(|s| {
            s.start_offset_secs
                .saturating_add(s.duration_secs.round().max(0.0) as u32)
        });
        let samples = self.heart_rate.iter().map(|s| s.offset_secs);
        sets.chain(samples).max().unwrap_or(0)
    }

    fn fit_time(&self, offset: u32) -> u32 {
        (self.start_unix + i64::from(offset) - FIT_EPOCH_UNIX).clamp(0, i64::from(u32::MAX - 1))
            as u32
    }

    /// The FIT file bytes.
    pub fn to_fit(&self) -> Vec<u8> {
        let mut data = Vec::new();
        self.write_identity(&mut data);
        self.write_event(&mut data, 0, 0);
        self.write_records(&mut data);
        self.write_sets(&mut data);
        self.write_event(&mut data, self.elapsed_secs(), 4);
        self.write_lap_and_session(&mut data);
        self.write_activity(&mut data);
        wrap(data)
    }

    fn write_identity(&self, out: &mut Vec<u8>) {
        let name_len = (APP_NAME.len() + 1) as u8;
        let start = self.fit_time(0);
        definition(
            out,
            0,
            MESG_FILE_ID,
            &[
                (0, 1, BASE_ENUM),
                (1, 2, BASE_UINT16),
                (2, 2, BASE_UINT16),
                (3, 4, BASE_UINT32),
                (4, 4, BASE_UINT32),
                (8, name_len, BASE_STRING),
            ],
        );
        out.push(0);
        out.push(4); // type: activity
        out.extend_from_slice(&MANUFACTURER_DEVELOPMENT.to_le_bytes());
        out.extend_from_slice(&PRODUCT_ID.to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(APP_NAME.as_bytes());
        out.push(0);

        definition(
            out,
            1,
            MESG_DEVICE_INFO,
            &[
                (253, 4, BASE_UINT32),
                (2, 2, BASE_UINT16),
                (3, 2, BASE_UINT16),
                (5, 2, BASE_UINT16),
                (0, 1, BASE_UINT8),
                (27, name_len, BASE_STRING),
            ],
        );
        out.push(1);
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&MANUFACTURER_DEVELOPMENT.to_le_bytes());
        out.extend_from_slice(&PRODUCT_ID.to_le_bytes());
        out.extend_from_slice(&SOFTWARE_VERSION.to_le_bytes());
        out.push(0); // device_index: the creator
        out.extend_from_slice(APP_NAME.as_bytes());
        out.push(0);
    }

    /// An `event` message of the timer: `event_type` 0 starts it, 4 stops all.
    fn write_event(&self, out: &mut Vec<u8>, offset: u32, event_type: u8) {
        definition(
            out,
            2,
            MESG_EVENT,
            &[(253, 4, BASE_UINT32), (0, 1, BASE_ENUM), (1, 1, BASE_ENUM)],
        );
        out.push(2);
        out.extend_from_slice(&self.fit_time(offset).to_le_bytes());
        out.push(0); // event: timer
        out.push(event_type);
    }

    fn write_records(&self, out: &mut Vec<u8>) {
        if self.heart_rate.is_empty() {
            return;
        }
        definition(
            out,
            3,
            MESG_RECORD,
            &[(253, 4, BASE_UINT32), (3, 1, BASE_UINT8)],
        );
        for sample in &self.heart_rate {
            out.push(3);
            out.extend_from_slice(&self.fit_time(sample.offset_secs).to_le_bytes());
            out.push(sample.bpm);
        }
    }

    fn write_sets(&self, out: &mut Vec<u8>) {
        if self.sets.is_empty() {
            return;
        }
        definition(
            out,
            4,
            MESG_SET,
            &[
                (254, 4, BASE_UINT32),
                (0, 4, BASE_UINT32),
                (3, 2, BASE_UINT16),
                (4, 2, BASE_UINT16),
                (5, 1, BASE_UINT8),
                (6, 4, BASE_UINT32),
                (7, 2, BASE_UINT16),
                (8, 2, BASE_UINT16),
                (10, 2, BASE_UINT16),
            ],
        );
        for (index, set) in self.sets.iter().enumerate() {
            let duration = set.duration_secs.max(0.0);
            let end = set
                .start_offset_secs
                .saturating_add(duration.round() as u32);
            out.push(4);
            out.extend_from_slice(&self.fit_time(end).to_le_bytes());
            out.extend_from_slice(&scaled_u32(duration * 1000.0).to_le_bytes());
            out.extend_from_slice(&set.repetitions.unwrap_or(INVALID_UINT16).to_le_bytes());
            let weight = set.weight_kg.map_or(INVALID_UINT16, |kg| {
                (kg * 16.0).round().clamp(0.0, 65_534.0) as u16
            });
            out.extend_from_slice(&weight.to_le_bytes());
            out.push(match set.kind {
                SetKind::Rest => SET_TYPE_REST,
                SetKind::Active | SetKind::WarmUp => SET_TYPE_ACTIVE,
            });
            out.extend_from_slice(&self.fit_time(set.start_offset_secs).to_le_bytes());
            out.extend_from_slice(&set.category.unwrap_or(INVALID_UINT16).to_le_bytes());
            out.extend_from_slice(&set.name.unwrap_or(INVALID_UINT16).to_le_bytes());
            out.extend_from_slice(&(index.min(usize::from(u16::MAX - 1)) as u16).to_le_bytes());
        }
    }

    fn heart_rate_totals(&self) -> (Option<u8>, Option<u8>) {
        let readings: Vec<u32> = self
            .heart_rate
            .iter()
            .filter(|s| s.bpm > 0 && s.bpm != INVALID_UINT8)
            .map(|s| u32::from(s.bpm))
            .collect();
        let Some(max) = readings.iter().max() else {
            return (None, None);
        };
        let avg = (readings.iter().sum::<u32>() as f64 / readings.len() as f64).round();
        (Some(avg as u8), Some(*max as u8))
    }

    /// One lap and one session over the whole recording. The timer runs the
    /// whole time, rests included.
    fn write_lap_and_session(&self, out: &mut Vec<u8>) {
        let elapsed = self.elapsed_secs();
        let (avg_hr, max_hr) = self.heart_rate_totals();
        let end = self.fit_time(elapsed).to_le_bytes();
        let start = self.fit_time(0).to_le_bytes();
        let millis = scaled_u32(f64::from(elapsed) * 1000.0).to_le_bytes();

        definition(
            out,
            5,
            MESG_LAP,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (15, 1, BASE_UINT8),
            ],
        );
        out.push(5);
        out.extend_from_slice(&end);
        out.extend_from_slice(&start);
        out.extend_from_slice(&millis);
        out.extend_from_slice(&millis);
        out.push(avg_hr.unwrap_or(INVALID_UINT8));

        definition(
            out,
            6,
            MESG_SESSION,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (5, 1, BASE_ENUM),
                (6, 1, BASE_ENUM),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (16, 1, BASE_UINT8),
                (17, 1, BASE_UINT8),
                (26, 2, BASE_UINT16),
            ],
        );
        out.push(6);
        out.extend_from_slice(&end);
        out.extend_from_slice(&start);
        out.push(SPORT_FITNESS_EQUIPMENT);
        out.push(SUB_SPORT_STRENGTH_TRAINING);
        out.extend_from_slice(&millis);
        out.extend_from_slice(&millis);
        out.push(avg_hr.unwrap_or(INVALID_UINT8));
        out.push(max_hr.unwrap_or(INVALID_UINT8));
        out.extend_from_slice(&1u16.to_le_bytes());
    }

    fn write_activity(&self, out: &mut Vec<u8>) {
        definition(
            out,
            7,
            MESG_ACTIVITY,
            &[
                (253, 4, BASE_UINT32),
                (0, 4, BASE_UINT32),
                (1, 2, BASE_UINT16),
                (2, 1, BASE_ENUM),
            ],
        );
        let elapsed = self.elapsed_secs();
        out.push(7);
        out.extend_from_slice(&self.fit_time(elapsed).to_le_bytes());
        out.extend_from_slice(&scaled_u32(f64::from(elapsed) * 1000.0).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.push(0); // type: manual
    }
}

fn scaled_u32(value: f64) -> u32 {
    if value.is_finite() {
        value.round().clamp(0.0, f64::from(u32::MAX - 1)) as u32
    } else {
        INVALID_UINT32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit::{inspect, parse_fit_strength_sets};
    use crate::fit_write::crc;

    fn session() -> StrengthSession {
        let set = |kind, category, name, reps, weight, start, duration| WrittenSet {
            kind,
            category,
            name,
            repetitions: reps,
            weight_kg: weight,
            start_offset_secs: start,
            duration_secs: duration,
        };
        StrengthSession {
            start_unix: 1_773_471_600,
            sets: vec![
                set(
                    SetKind::WarmUp,
                    Some(28),
                    Some(2),
                    Some(10),
                    Some(20.0),
                    0,
                    30.0,
                ),
                set(SetKind::Rest, None, None, None, None, 30, 60.0),
                set(
                    SetKind::Active,
                    Some(7),
                    Some(1),
                    Some(8),
                    Some(12.5),
                    90,
                    40.0,
                ),
                set(SetKind::Rest, None, None, None, None, 130, 45.0),
                set(SetKind::Active, Some(19), Some(0), None, None, 175, 60.0),
            ],
            heart_rate: (0..235u32)
                .step_by(5)
                .map(|offset_secs| HeartRateSample {
                    offset_secs,
                    bpm: 100 + (offset_secs / 5) as u8,
                })
                .collect(),
        }
    }

    /// Scenario: a dumbbell exercise, a warm-up, a rest and a hold are written
    /// and read back by the reader the engine uses on every strength file.
    #[test]
    fn written_sets_read_back_in_order() {
        let file = session().to_fit();
        let read = parse_fit_strength_sets(&file).expect("the file decodes");

        let rows: Vec<_> = read
            .iter()
            .map(|s| {
                (
                    s.set_order,
                    s.exercise_category,
                    s.exercise_name,
                    s.set_type,
                    s.repetitions,
                    s.weight_kg,
                    s.duration_secs,
                )
            })
            .collect();
        assert_eq!(
            rows,
            vec![
                (0, 28, Some(2), 0, Some(10), Some(20.0), Some(30.0)),
                (1, 0xFFFF, None, 1, None, None, Some(60.0)),
                (2, 7, Some(1), 0, Some(8), Some(12.5), Some(40.0)),
                (3, 0xFFFF, None, 1, None, None, Some(45.0)),
                (4, 19, Some(0), 0, None, None, Some(60.0)),
            ]
        );
        assert_eq!(read[2].start_time, Some(1_773_471_600 + 90));
    }

    #[test]
    fn heart_rate_records_carry_no_position() {
        let file = session().to_fit();
        let info = inspect(&file).unwrap();
        assert_eq!(info.record_count, 47);
        assert!(
            info.fields
                .contains(&("record".into(), "heart_rate".into()))
        );
        assert!(
            !info
                .fields
                .contains(&("record".into(), "position_lat".into()))
        );
        assert!(
            !info
                .fields
                .contains(&("record".into(), "position_long".into()))
        );
        assert_eq!(info.device.as_deref(), Some("manufacturer 255 Veloq"));
        assert_eq!(info.start_unix, Some(1_773_471_600));
    }

    #[test]
    fn the_file_passes_the_header_and_crc_checks() {
        let file = session().to_fit();
        assert_eq!(file[0], 14);
        assert_eq!(&file[8..12], b".FIT");
        let data_size = u32::from_le_bytes(file[4..8].try_into().unwrap()) as usize;
        assert_eq!(file.len(), 14 + data_size + 2);
        let body = file.len() - 2;
        let stored = u16::from_le_bytes(file[body..].try_into().unwrap());
        assert_eq!(stored, crc(&file[..body]));
        let header_crc = u16::from_le_bytes(file[12..14].try_into().unwrap());
        assert_eq!(header_crc, crc(&file[..12]));
    }

    #[test]
    fn a_session_with_no_sets_or_heart_rate_still_decodes() {
        let empty = StrengthSession {
            start_unix: 1_773_471_600,
            sets: Vec::new(),
            heart_rate: Vec::new(),
        };
        assert!(parse_fit_strength_sets(&empty.to_fit()).unwrap().is_empty());
    }

    #[test]
    fn the_session_message_names_the_strength_sport_and_totals() {
        let fields = crate::fit::message_fields(&session().to_fit()).unwrap();
        for name in ["sport", "sub_sport", "avg_heart_rate", "max_heart_rate"] {
            assert!(fields.contains(&("session".into(), name.into())), "{name}");
        }
        assert!(fields.contains(&("set".into(), "message_index".into())));
    }
}
