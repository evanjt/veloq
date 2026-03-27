//! Minimal FIT binary parser for strength training exercise sets.
//!
//! Parses only `set` messages (Global Message Number 225) from FIT files.
//! Extracts exercise category, reps, weight, duration, and set type.
//! Also provides exercise name and muscle group lookup tables.

use std::collections::HashMap;

// ============================================================================
// FIT Binary Parser
// ============================================================================

/// FIT epoch: 1989-12-31T00:00:00Z (631065600 seconds before Unix epoch)
const FIT_EPOCH_OFFSET: i64 = 631_065_600;

/// Global Message Number for "set" messages
const GMN_SET: u16 = 225;

/// FIT field numbers within the "set" message
mod set_fields {
    pub const TIMESTAMP: u8 = 253;
    pub const DURATION: u8 = 0;
    pub const REPETITIONS: u8 = 3;
    pub const WEIGHT: u8 = 4;
    pub const SET_TYPE: u8 = 5;
    pub const START_TIME: u8 = 6;
    pub const CATEGORY: u8 = 7;
    pub const CATEGORY_SUBTYPE: u8 = 8;
}

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

/// Field definition within a FIT definition message.
#[derive(Debug, Clone)]
struct FieldDef {
    field_num: u8,
    size: u8,
    _base_type: u8,
}

/// Definition for a local message type.
#[derive(Debug, Clone)]
struct MessageDef {
    global_mesg_num: u16,
    is_big_endian: bool,
    fields: Vec<FieldDef>,
}

/// Parse a FIT binary file and extract exercise set data.
///
/// Returns an empty vec if the file has no set messages or is invalid.
pub fn parse_fit_sets(data: &[u8]) -> Vec<FitExerciseSet> {
    if data.len() < 14 {
        return Vec::new();
    }

    // Validate FIT header
    let header_size = data[0] as usize;
    if header_size < 12 || data.len() < header_size + 2 {
        return Vec::new();
    }

    // Check ".FIT" signature at bytes 8-11
    if header_size >= 12 && &data[8..12] != b".FIT" {
        return Vec::new();
    }

    // Data size from header (little-endian u32 at offset 4)
    let data_size = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
    let data_end = header_size + data_size;
    if data.len() < data_end {
        // Truncated file — parse what we have
    }

    let mut pos = header_size;
    let end = data_end.min(data.len());
    let mut definitions: HashMap<u8, MessageDef> = HashMap::new();
    let mut sets: Vec<FitExerciseSet> = Vec::new();
    let mut set_order: u32 = 0;

    while pos < end {
        let record_header = data[pos];
        pos += 1;

        if record_header & 0x80 != 0 {
            // Compressed timestamp header — it's a data message
            let local_type = (record_header >> 5) & 0x03;
            if let Some(def) = definitions.get(&local_type) {
                let msg_size: usize = def.fields.iter().map(|f| f.size as usize).sum();
                if pos + msg_size > end {
                    break;
                }
                // We don't expect set messages with compressed timestamps, skip
                pos += msg_size;
            } else {
                break; // Unknown local type, can't continue
            }
        } else if record_header & 0x40 != 0 {
            // Definition message
            let local_type = record_header & 0x0F;
            let has_dev_data = record_header & 0x20 != 0;

            if pos + 5 > end {
                break;
            }

            let _reserved = data[pos];
            let architecture = data[pos + 1]; // 0=little-endian, 1=big-endian
            let is_big_endian = architecture == 1;
            let global_mesg_num = if is_big_endian {
                u16::from_be_bytes([data[pos + 2], data[pos + 3]])
            } else {
                u16::from_le_bytes([data[pos + 2], data[pos + 3]])
            };
            let num_fields = data[pos + 4] as usize;
            pos += 5;

            if pos + num_fields * 3 > end {
                break;
            }

            let mut fields = Vec::with_capacity(num_fields);
            for i in 0..num_fields {
                let offset = pos + i * 3;
                fields.push(FieldDef {
                    field_num: data[offset],
                    size: data[offset + 1],
                    _base_type: data[offset + 2],
                });
            }
            pos += num_fields * 3;

            // Skip developer fields if present
            if has_dev_data {
                if pos >= end {
                    break;
                }
                let num_dev_fields = data[pos] as usize;
                pos += 1;
                pos += num_dev_fields * 3;
                if pos > end {
                    break;
                }
            }

            definitions.insert(local_type, MessageDef {
                global_mesg_num,
                is_big_endian,
                fields,
            });
        } else {
            // Data message
            let local_type = record_header & 0x0F;
            if let Some(def) = definitions.get(&local_type).cloned() {
                let msg_size: usize = def.fields.iter().map(|f| f.size as usize).sum();
                if pos + msg_size > end {
                    break;
                }

                if def.global_mesg_num == GMN_SET {
                    if let Some(exercise_set) = parse_set_message(&def, &data[pos..pos + msg_size], set_order) {
                        sets.push(exercise_set);
                        set_order += 1;
                    }
                }

                pos += msg_size;
            } else {
                break; // Unknown local type, can't continue
            }
        }
    }

    sets
}

/// Parse a single "set" data message into an `FitExerciseSet`.
fn parse_set_message(def: &MessageDef, data: &[u8], order: u32) -> Option<FitExerciseSet> {
    let mut exercise_category: Option<u16> = None;
    let mut exercise_name: Option<u16> = None;
    let mut set_type: Option<u8> = None;
    let mut repetitions: Option<u16> = None;
    let mut weight_raw: Option<u16> = None;
    let mut duration_raw: Option<u32> = None;
    let mut start_time: Option<u32> = None;
    let mut timestamp: Option<u32> = None;

    let mut offset = 0usize;
    for field in &def.fields {
        let field_data = &data[offset..offset + field.size as usize];

        match field.field_num {
            set_fields::CATEGORY => {
                // May be an array — take the first u16 that isn't invalid (0xFFFF)
                if field.size >= 2 {
                    for chunk in field_data.chunks_exact(2) {
                        let val = read_u16(chunk, def.is_big_endian);
                        if val != 0xFFFF {
                            exercise_category = Some(val);
                            break;
                        }
                    }
                }
            }
            set_fields::CATEGORY_SUBTYPE => {
                if field.size >= 2 {
                    for chunk in field_data.chunks_exact(2) {
                        let val = read_u16(chunk, def.is_big_endian);
                        if val != 0xFFFF {
                            exercise_name = Some(val);
                            break;
                        }
                    }
                }
            }
            set_fields::SET_TYPE => {
                if field.size == 1 && field_data[0] != 0xFF {
                    set_type = Some(field_data[0]);
                }
            }
            set_fields::REPETITIONS => {
                if field.size >= 2 {
                    let val = read_u16(field_data, def.is_big_endian);
                    if val != 0xFFFF {
                        repetitions = Some(val);
                    }
                }
            }
            set_fields::WEIGHT => {
                if field.size >= 2 {
                    let val = read_u16(field_data, def.is_big_endian);
                    if val != 0xFFFF {
                        weight_raw = Some(val);
                    }
                }
            }
            set_fields::DURATION => {
                if field.size >= 4 {
                    let val = read_u32(field_data, def.is_big_endian);
                    if val != 0xFFFFFFFF {
                        duration_raw = Some(val);
                    }
                }
            }
            set_fields::START_TIME => {
                if field.size >= 4 {
                    let val = read_u32(field_data, def.is_big_endian);
                    if val != 0xFFFFFFFF {
                        start_time = Some(val);
                    }
                }
            }
            set_fields::TIMESTAMP => {
                if field.size >= 4 {
                    let val = read_u32(field_data, def.is_big_endian);
                    if val != 0xFFFFFFFF {
                        timestamp = Some(val);
                    }
                }
            }
            _ => {} // Skip unknown fields
        }

        offset += field.size as usize;
    }

    // Default category to 0xFFFF (unknown) if not present
    let category = exercise_category.unwrap_or(0xFFFF);

    Some(FitExerciseSet {
        set_order: order,
        exercise_category: category,
        exercise_name,
        set_type: set_type.unwrap_or(0),
        repetitions,
        weight_kg: weight_raw.map(|w| w as f64 / 16.0), // FIT stores weight in 1/16 kg
        duration_secs: duration_raw.map(|d| d as f64 / 1000.0), // FIT stores duration in ms
        start_time: start_time
            .or(timestamp)
            .map(|t| t as i64 + FIT_EPOCH_OFFSET),
    })
}

fn read_u16(data: &[u8], big_endian: bool) -> u16 {
    if big_endian {
        u16::from_be_bytes([data[0], data[1]])
    } else {
        u16::from_le_bytes([data[0], data[1]])
    }
}

fn read_u32(data: &[u8], big_endian: bool) -> u32 {
    if big_endian {
        u32::from_be_bytes([data[0], data[1], data[2], data[3]])
    } else {
        u32::from_le_bytes([data[0], data[1], data[2], data[3]])
    }
}

// ============================================================================
// Exercise Name Lookup
// ============================================================================

/// Get a human-readable display name for a FIT exercise category and optional sub-type.
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
/// Returns (primary muscles, secondary muscles) as slug strings
/// matching react-native-body-highlighter's data format.
pub fn exercise_muscle_groups(category: u16) -> Vec<MuscleActivation> {
    let (primary, secondary): (&[&str], &[&str]) = match category {
        0 => (&["chest", "triceps"], &["deltoids"]),                 // Bench Press
        1 => (&["calves"], &[]),                                           // Calf Raise
        2 => (&[], &[]),                                                   // Cardio
        3 => (&["forearm", "trapezius"], &["abs", "obliques"]),            // Carry
        4 => (&["obliques", "abs"], &["deltoids"]),                  // Chop
        5 => (&["abs", "obliques"], &["lower-back"]),                      // Core
        6 => (&["abs"], &["obliques"]),                                    // Crunch
        7 => (&["biceps"], &["forearm"]),                                  // Curl
        8 => (&["hamstring", "gluteal", "lower-back"], &["trapezius", "forearm"]), // Deadlift
        9 => (&["chest"], &["deltoids"]),                            // Flye
        10 => (&["gluteal"], &["hamstring"]),                              // Hip Raise
        11 => (&["gluteal"], &["adductors"]),                               // Hip Stability
        12 => (&["gluteal", "hamstring"], &["abs"]),                       // Hip Swing
        13 => (&["lower-back"], &["gluteal", "hamstring"]),                // Hyperextension
        14 => (&["deltoids"], &["trapezius"]),                       // Lateral Raise
        15 => (&["hamstring"], &["calves"]),                               // Leg Curl
        16 => (&["abs"], &["obliques"]),                                   // Leg Raise
        17 => (&["quadriceps", "gluteal"], &["hamstring", "calves"]),      // Lunge
        18 => (&["quadriceps", "gluteal", "trapezius"], &["deltoids", "hamstring"]), // Olympic Lift
        19 => (&["abs", "obliques"], &["lower-back"]),                     // Plank
        20 => (&["quadriceps", "calves"], &["hamstring", "gluteal"]),      // Plyo
        21 => (&["upper-back", "biceps"], &["forearm", "deltoids"]),  // Pull Up
        22 => (&["chest", "triceps"], &["deltoids", "abs"]),         // Push Up
        23 => (&["upper-back", "biceps"], &["lower-back", "forearm"]),     // Row
        24 => (&["deltoids", "triceps"], &["trapezius"]),            // Shoulder Press
        25 => (&["deltoids"], &["trapezius"]),                       // Shoulder Stability
        26 => (&["trapezius"], &[]),                                       // Shrug
        27 => (&["abs"], &["obliques"]),                                   // Sit Up
        28 => (&["quadriceps", "gluteal"], &["hamstring", "calves", "lower-back"]), // Squat
        29 => (&["quadriceps", "chest", "deltoids"], &["abs", "triceps"]),    // Total Body
        30 => (&["triceps"], &[]),                                         // Triceps Extension
        _ => (&[], &[]),                                                   // Unknown / Warm Up / Run
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(groups.iter().any(|g| g.slug == "triceps" && g.intensity == 2));
        assert!(groups.iter().any(|g| g.slug == "deltoids" && g.intensity == 1));
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
        // Chest from bench press (primary)
        assert!(groups.iter().any(|g| g.slug == "chest" && g.intensity == 2));
        // Biceps from curl (primary)
        assert!(groups.iter().any(|g| g.slug == "biceps" && g.intensity == 2));
        // Forearm from curl (secondary) — not overridden by bench press
        assert!(groups.iter().any(|g| g.slug == "forearm" && g.intensity == 1));
    }

    #[test]
    fn test_rest_sets_excluded_from_muscle_groups() {
        let sets = vec![
            FitExerciseSet {
                set_order: 0,
                exercise_category: 0,
                exercise_name: None,
                set_type: 1, // rest
                repetitions: None,
                weight_kg: None,
                duration_secs: Some(60.0),
                start_time: None,
            },
        ];

        let groups = aggregate_muscle_groups(&sets);
        assert!(groups.is_empty());
    }

    #[test]
    fn test_parse_empty_data() {
        assert!(parse_fit_sets(&[]).is_empty());
        assert!(parse_fit_sets(&[0; 10]).is_empty());
    }

    #[test]
    fn test_parse_minimal_fit_no_sets() {
        // Valid FIT header but no data records
        let mut data = vec![0u8; 14];
        data[0] = 14; // header size
        data[1] = 0x20; // protocol version
        // data size = 0
        data[8] = b'.';
        data[9] = b'F';
        data[10] = b'I';
        data[11] = b'T';
        let sets = parse_fit_sets(&data);
        assert!(sets.is_empty());
    }
}
