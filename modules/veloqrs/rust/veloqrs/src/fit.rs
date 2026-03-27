//! FIT file parser for strength training exercise sets.
//!
//! Uses the `fitparser` crate to parse FIT files, extracting `set` messages
//! (MesgNum::Set). Also provides exercise name and muscle group lookup tables.

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

/// Parse a FIT binary file and extract exercise set data.
///
/// Returns an empty vec if the file has no set messages or is invalid.
pub fn parse_fit_sets(data: &[u8]) -> Vec<FitExerciseSet> {
    let mut cursor = Cursor::new(data);
    let records = match fitparser::from_reader(&mut cursor) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut sets = Vec::new();
    let mut set_order: u32 = 0;

    for record in &records {
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
                    exercise_category = extract_first_u16(field);
                }
                "category_subtype" | "exercise_name" => {
                    exercise_name_val = extract_first_u16(field);
                }
                "set_type" => {
                    // FIT SDK enum: raw 0=rest, 1=active (counterintuitive!)
                    // We normalize to: 0=active, 1=rest for our internal use
                    match field.value() {
                        fitparser::Value::String(s) => {
                            set_type = Some(match s.to_lowercase().as_str() {
                                "active" => 0,
                                "rest" => 1,
                                _ => 0,
                            });
                        }
                        fitparser::Value::UInt8(v) => {
                            // Raw FIT enum: 0=rest, 1=active — invert for our convention
                            set_type = Some(if *v == 0 { 1 } else { 0 });
                        }
                        _ => {}
                    }
                }
                "repetitions" => {
                    if let fitparser::Value::UInt16(v) = field.value() {
                        repetitions = Some(*v);
                    }
                }
                "weight" => {
                    match field.value() {
                        fitparser::Value::Float64(v) => weight_kg = Some(*v),
                        fitparser::Value::UInt16(v) => weight_kg = Some(*v as f64 / 16.0),
                        _ => {}
                    }
                }
                "duration" => {
                    match field.value() {
                        fitparser::Value::Float64(v) => duration_secs = Some(*v),
                        fitparser::Value::UInt32(v) => duration_secs = Some(*v as f64 / 1000.0),
                        _ => {}
                    }
                }
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

/// Extract the first valid u16 from a FIT field value (handles arrays and single values).
fn extract_first_u16(field: &fitparser::FitDataField) -> Option<u16> {
    match field.value() {
        fitparser::Value::UInt16(v) => Some(*v),
        fitparser::Value::Array(arr) => {
            for val in arr {
                if let fitparser::Value::UInt16(v) = val {
                    if *v != 0xFFFF && *v != 0xFFFE {
                        return Some(*v);
                    }
                }
            }
            None
        }
        _ => None,
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
/// Returns slugs matching react-native-body-highlighter's data format.
pub fn exercise_muscle_groups(category: u16) -> Vec<MuscleActivation> {
    let (primary, secondary): (&[&str], &[&str]) = match category {
        0 => (&["chest", "triceps"], &["deltoids"]),                       // Bench Press
        1 => (&["calves"], &[]),                                           // Calf Raise
        2 => (&[], &[]),                                                   // Cardio
        3 => (&["forearm", "trapezius"], &["abs", "obliques"]),            // Carry
        4 => (&["obliques", "abs"], &["deltoids"]),                        // Chop
        5 => (&["abs", "obliques"], &["lower-back"]),                      // Core
        6 => (&["abs"], &["obliques"]),                                    // Crunch
        7 => (&["biceps"], &["forearm"]),                                  // Curl
        8 => (&["hamstring", "gluteal", "lower-back"], &["trapezius", "forearm"]), // Deadlift
        9 => (&["chest"], &["deltoids"]),                                  // Flye
        10 => (&["gluteal"], &["hamstring"]),                              // Hip Raise
        11 => (&["gluteal"], &["adductors"]),                              // Hip Stability
        12 => (&["gluteal", "hamstring"], &["abs"]),                       // Hip Swing
        13 => (&["lower-back"], &["gluteal", "hamstring"]),                // Hyperextension
        14 => (&["deltoids"], &["trapezius"]),                             // Lateral Raise
        15 => (&["hamstring"], &["calves"]),                               // Leg Curl
        16 => (&["abs"], &["obliques"]),                                   // Leg Raise
        17 => (&["quadriceps", "gluteal"], &["hamstring", "calves"]),      // Lunge
        18 => (&["quadriceps", "gluteal", "trapezius"], &["deltoids", "hamstring"]), // Olympic Lift
        19 => (&["abs", "obliques"], &["lower-back"]),                     // Plank
        20 => (&["quadriceps", "calves"], &["hamstring", "gluteal"]),      // Plyo
        21 => (&["upper-back", "biceps"], &["forearm", "deltoids"]),       // Pull Up
        22 => (&["chest", "triceps"], &["deltoids", "abs"]),               // Push Up
        23 => (&["upper-back", "biceps"], &["lower-back", "forearm"]),     // Row
        24 => (&["deltoids", "triceps"], &["trapezius"]),                  // Shoulder Press
        25 => (&["deltoids"], &["trapezius"]),                             // Shoulder Stability
        26 => (&["trapezius"], &[]),                                       // Shrug
        27 => (&["abs"], &["obliques"]),                                   // Sit Up
        28 => (&["quadriceps", "gluteal"], &["hamstring", "calves", "lower-back"]), // Squat
        29 => (&["quadriceps", "chest", "deltoids"], &["abs", "triceps"]), // Total Body
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
        assert!(groups.iter().any(|g| g.slug == "chest" && g.intensity == 2));
        assert!(groups.iter().any(|g| g.slug == "biceps" && g.intensity == 2));
        assert!(groups.iter().any(|g| g.slug == "forearm" && g.intensity == 1));
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
}
