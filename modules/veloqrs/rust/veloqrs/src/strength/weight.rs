//! Strength weight and the athlete's units. Weight is stored in kilograms; a pound athlete
//! enters and sees pounds, rounded for display only. This module is the one owner of the
//! conversion and of the stepper sizes by equipment.

use super::catalogue::Equipment;

const POUNDS_PER_KILOGRAM: f64 = 2.204_622_621_848_776;

/// The unit an athlete reads and enters strength weight in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, uniffi::Enum)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiWeightUnit")]
pub enum WeightUnit {
    Kilogram,
    Pound,
}

impl WeightUnit {
    /// The unit for the athlete's resolved unit system, `"imperial"` or anything else.
    pub fn for_system(system: Option<&str>) -> WeightUnit {
        if system == Some("imperial") {
            WeightUnit::Pound
        } else {
            WeightUnit::Kilogram
        }
    }

    /// The profile's `weight_display_unit` enum value.
    pub fn fit_value(self) -> u8 {
        match self {
            WeightUnit::Kilogram => 0,
            WeightUnit::Pound => 1,
        }
    }

    pub fn from_fit_value(value: i64) -> Option<WeightUnit> {
        match value {
            0 => Some(WeightUnit::Kilogram),
            1 => Some(WeightUnit::Pound),
            _ => None,
        }
    }
}

/// Kilograms to the value the athlete reads, to one decimal.
pub fn display_weight(kg: f64, unit: WeightUnit) -> f64 {
    let value = match unit {
        WeightUnit::Kilogram => kg,
        WeightUnit::Pound => kg * POUNDS_PER_KILOGRAM,
    };
    (value * 10.0).round() / 10.0
}

/// What the athlete typed, in their unit, to the kilograms that are stored.
pub fn stored_weight_kg(entered: f64, unit: WeightUnit) -> f64 {
    match unit {
        WeightUnit::Kilogram => entered,
        WeightUnit::Pound => entered / POUNDS_PER_KILOGRAM,
    }
}

/// One tap of a stepper, in the athlete's unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StepSizes {
    pub weight: f64,
    pub reps: u32,
    pub duration_secs: u32,
}

pub fn step_sizes(equipment: Equipment, unit: WeightUnit) -> StepSizes {
    let weight = match (unit, equipment) {
        (WeightUnit::Pound, _) => 5.0,
        (WeightUnit::Kilogram, Equipment::Dumbbell | Equipment::Kettlebell) => 2.0,
        (WeightUnit::Kilogram, _) => 2.5,
    };
    StepSizes {
        weight,
        reps: 1,
        duration_secs: 5,
    }
}

/// The stored kilograms after one tap up (`direction` 1) or down (`-1`) from `current_kg`.
/// The step is taken in the athlete's unit and the result never goes below zero.
pub fn step_weight_kg(
    current_kg: f64,
    equipment: Equipment,
    unit: WeightUnit,
    direction: i32,
) -> f64 {
    let step = step_sizes(equipment, unit).weight;
    let shown = display_weight(current_kg, unit);
    let next = (shown + step * f64::from(direction.signum())).max(0.0);
    stored_weight_kg(next, unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pounds_entered_store_as_kilograms_and_show_again() {
        let kg = stored_weight_kg(45.0, WeightUnit::Pound);
        assert!((kg - 20.41).abs() < 0.005, "{kg}");
        assert_eq!(display_weight(kg, WeightUnit::Pound), 45.0);
    }

    #[test]
    fn a_kilogram_athlete_sees_what_is_stored() {
        assert_eq!(display_weight(62.5, WeightUnit::Kilogram), 62.5);
        assert_eq!(stored_weight_kg(62.5, WeightUnit::Kilogram), 62.5);
    }

    #[test]
    fn stepper_sizes_follow_the_equipment() {
        let kg = WeightUnit::Kilogram;
        assert_eq!(step_weight_kg(20.0, Equipment::Dumbbell, kg, 1), 22.0);
        assert_eq!(step_weight_kg(20.0, Equipment::Kettlebell, kg, 1), 22.0);
        assert_eq!(step_weight_kg(20.0, Equipment::Barbell, kg, 1), 22.5);
        assert_eq!(step_weight_kg(20.0, Equipment::Machine, kg, 1), 22.5);
        assert_eq!(step_weight_kg(20.0, Equipment::Cable, kg, -1), 17.5);
    }

    #[test]
    fn a_pound_stepper_steps_five_pounds_from_the_shown_value() {
        let lb = WeightUnit::Pound;
        let start = stored_weight_kg(45.0, lb);
        let up = step_weight_kg(start, Equipment::Dumbbell, lb, 1);
        assert_eq!(display_weight(up, lb), 50.0);
        let down = step_weight_kg(up, Equipment::Barbell, lb, -1);
        assert_eq!(display_weight(down, lb), 45.0);
    }

    #[test]
    fn a_step_down_stops_at_zero() {
        assert_eq!(
            step_weight_kg(1.0, Equipment::Barbell, WeightUnit::Kilogram, -1),
            0.0
        );
    }

    #[test]
    fn reps_and_duration_steps_are_fixed() {
        let s = step_sizes(Equipment::Bodyweight, WeightUnit::Kilogram);
        assert_eq!((s.reps, s.duration_secs), (1, 5));
    }

    #[test]
    fn the_unit_follows_the_resolved_system() {
        assert_eq!(WeightUnit::for_system(Some("imperial")), WeightUnit::Pound);
        assert_eq!(WeightUnit::for_system(Some("metric")), WeightUnit::Kilogram);
        assert_eq!(WeightUnit::for_system(None), WeightUnit::Kilogram);
    }
}
