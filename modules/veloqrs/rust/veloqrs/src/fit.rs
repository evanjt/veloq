//! FIT file parser: strength training exercise sets and the recorded track.
//!
//! Uses the `fitparser` crate to parse FIT files, extracting `set` messages
//! (MesgNum::Set). Also provides exercise name and muscle group lookup tables.
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
/// Wraps [`parse_fit_sets`] with explicit error reporting so callers can
/// distinguish an unparseable file from a valid-but-empty one (e.g. a cardio
/// activity with no `Set` messages).
pub fn parse_fit_strength_sets(data: &[u8]) -> Result<Vec<FitExerciseSet>, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    // Decoded once and handed on. Reporting the failure used to mean decoding
    // the file here and again inside `parse_fit_sets`, so every strength
    // upload parsed its FIT twice.
    let records = decode(data).map_err(|e| FitParseError::Decode(format!("{}", e)))?;
    Ok(sets_from_records(&records))
}

/// Decode a FIT file with every enum field left as its number.
///
/// By default the decoder names a one-element enum field, so a `category`
/// written with a single slot arrived as `"squat"` while the same field written
/// with three slots arrived as numbers. The numbers are what the category and
/// set type tables below key on, whichever way the device wrote the field.
fn decode(data: &[u8]) -> fitparser::Result<Vec<fitparser::FitDataRecord>> {
    let options = [fitparser::de::DecodeOption::ReturnNumericEnumValues]
        .into_iter()
        .collect();
    fitparser::de::from_reader_with_options(&mut Cursor::new(data), &options)
}

/// The positions a FIT file records, in order, in degrees.
///
/// A record with no fix carries no position and is skipped, which is how an
/// indoor ride comes back as an empty track rather than an error. An
/// unreadable file is an error, so a caller never takes it for a ride that
/// stayed indoors.
pub fn parse_fit_track(data: &[u8]) -> Result<Vec<crate::GpsPoint>, FitParseError> {
    if data.is_empty() {
        return Err(FitParseError::Empty);
    }
    let records = decode(data).map_err(|e| FitParseError::Decode(format!("{}", e)))?;
    let mut track = Vec::new();
    for record in &records {
        if record.kind() != fitparser::profile::MesgNum::Record {
            continue;
        }
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
            track.push(crate::GpsPoint::new(lat, lng));
        }
    }
    Ok(track)
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

/// Parse a FIT binary file and extract exercise set data.
///
/// Returns an empty vec if the file has no set messages or is invalid.
pub fn parse_fit_sets(data: &[u8]) -> Vec<FitExerciseSet> {
    let records = match decode(data) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    sets_from_records(&records)
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

#[cfg(test)]
mod tests {
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

    #[test]
    fn an_unreadable_fit_is_an_error_not_an_empty_track() {
        assert!(super::parse_fit_track(&[]).is_err());
        assert!(super::parse_fit_track(b"not a fit file").is_err());
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
    fn fit_file(sets: &[(u8, u8, u16, &[u16])]) -> Vec<u8> {
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
        assert_eq!(
            parse_fit_sets(&file)
                .iter()
                .map(|s| s.exercise_category)
                .collect::<Vec<_>>(),
            vec![28, 0xFFFF, 0]
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

    #[test]
    fn test_parse_empty_data() {
        assert!(parse_fit_sets(&[]).is_empty());
        assert!(parse_fit_sets(&[0; 10]).is_empty());
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
}
