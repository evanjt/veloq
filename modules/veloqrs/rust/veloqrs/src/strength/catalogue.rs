//! The exercise catalogue: every named exercise in the FIT profile, with its label key,
//! equipment, body region and one-sided flag. `catalogue_table.rs` is generated from the
//! profile by `scripts/generate-exercise-catalogue.mjs`; this module is the one reader of it.

use super::catalogue_table::TABLE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Equipment {
    Barbell,
    Dumbbell,
    Kettlebell,
    Cable,
    Machine,
    Band,
    Bodyweight,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Region {
    Arms,
    Shoulders,
    Chest,
    Back,
    Core,
    Legs,
}

impl Equipment {
    pub const ALL: [Equipment; 8] = [
        Equipment::Barbell,
        Equipment::Dumbbell,
        Equipment::Kettlebell,
        Equipment::Cable,
        Equipment::Machine,
        Equipment::Band,
        Equipment::Bodyweight,
        Equipment::Other,
    ];

    /// The lowercase word a screen keys on.
    pub fn slug(self) -> &'static str {
        match self {
            Equipment::Barbell => "barbell",
            Equipment::Dumbbell => "dumbbell",
            Equipment::Kettlebell => "kettlebell",
            Equipment::Cable => "cable",
            Equipment::Machine => "machine",
            Equipment::Band => "band",
            Equipment::Bodyweight => "bodyweight",
            Equipment::Other => "other",
        }
    }

    pub fn from_slug(slug: &str) -> Option<Equipment> {
        Self::ALL.into_iter().find(|e| e.slug() == slug)
    }
}

impl Region {
    pub const ALL: [Region; 6] = [
        Region::Arms,
        Region::Shoulders,
        Region::Chest,
        Region::Back,
        Region::Core,
        Region::Legs,
    ];

    /// The lowercase word a screen keys on.
    pub fn slug(self) -> &'static str {
        match self {
            Region::Arms => "arms",
            Region::Shoulders => "shoulders",
            Region::Chest => "chest",
            Region::Back => "back",
            Region::Core => "core",
            Region::Legs => "legs",
        }
    }

    pub fn from_slug(slug: &str) -> Option<Region> {
        Self::ALL.into_iter().find(|r| r.slug() == slug)
    }
}

/// One named exercise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Exercise {
    pub category: u16,
    pub name: u16,
    /// The profile's snake_case name, the key a screen translates.
    pub label_key: &'static str,
    pub equipment: Equipment,
    pub one_sided: bool,
    pub region: Option<Region>,
}

/// Every named exercise, ordered by category then name.
pub fn all() -> impl Iterator<Item = Exercise> {
    TABLE.iter().map(
        |&(category, name, label_key, equipment, one_sided, region)| Exercise {
            category,
            name,
            label_key,
            equipment,
            one_sided,
            region,
        },
    )
}

/// The entry for a (category, name) pair, or `None` for a pair the profile does not name.
pub fn lookup(category: u16, name: u16) -> Option<Exercise> {
    let i = TABLE
        .binary_search_by_key(&(category, name), |row| (row.0, row.1))
        .ok()?;
    all().nth(i)
}

/// The region of a category's exercises, the fallback for a pair with no entry.
pub fn category_region(category: u16) -> Option<Region> {
    TABLE
        .iter()
        .find(|row| row.0 == category)
        .and_then(|row| row.5)
}

/// Title-cases a snake_case label key into the English name.
pub fn english(label_key: &str) -> String {
    label_key
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The name of an exercise: the exact name when the pair is in the catalogue, in the
/// athlete's language when a label table is held and in English otherwise, else `None` so
/// the caller falls back to the category.
pub fn display_name(category: u16, name: u16) -> Option<String> {
    lookup(category, name)
        .map(|e| super::labels::label(e.label_key).unwrap_or_else(|| english(e.label_key)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fitparser::profile::field_types as ft;

    macro_rules! every_variant_has_entry {
        ($($cat:expr => $ty:ident),* $(,)?) => {{
            let mut named = 0;
            $(
                for n in 0..=u16::MAX {
                    if ft::$ty::is_named_variant(n as i64) {
                        named += 1;
                        assert!(
                            lookup($cat, n).is_some(),
                            "{} {} has no entry", stringify!($ty), n
                        );
                    }
                }
            )*
            named
        }};
    }

    #[test]
    fn every_profile_exercise_has_an_entry() {
        let named = every_variant_has_entry!(
            0 => BenchPressExerciseName, 1 => CalfRaiseExerciseName, 2 => CardioExerciseName,
            3 => CarryExerciseName, 4 => ChopExerciseName, 5 => CoreExerciseName,
            6 => CrunchExerciseName, 7 => CurlExerciseName, 8 => DeadliftExerciseName,
            9 => FlyeExerciseName, 10 => HipRaiseExerciseName, 11 => HipStabilityExerciseName,
            12 => HipSwingExerciseName, 13 => HyperextensionExerciseName,
            14 => LateralRaiseExerciseName, 15 => LegCurlExerciseName,
            16 => LegRaiseExerciseName, 17 => LungeExerciseName, 18 => OlympicLiftExerciseName,
            19 => PlankExerciseName, 20 => PlyoExerciseName, 21 => PullUpExerciseName,
            22 => PushUpExerciseName, 23 => RowExerciseName, 24 => ShoulderPressExerciseName,
            25 => ShoulderStabilityExerciseName, 26 => ShrugExerciseName,
            27 => SitUpExerciseName, 28 => SquatExerciseName, 29 => TotalBodyExerciseName,
            30 => TricepsExtensionExerciseName, 31 => WarmUpExerciseName, 32 => RunExerciseName,
            33 => BikeExerciseName, 35 => MoveExerciseName, 36 => PoseExerciseName,
            37 => BandedExercisesExerciseName, 38 => BattleRopeExerciseName,
            39 => EllipticalExerciseName, 40 => FloorClimbExerciseName,
            41 => IndoorBikeExerciseName, 42 => IndoorRowExerciseName, 43 => LadderExerciseName,
            44 => SandbagExerciseName, 45 => SledExerciseName, 46 => SledgeHammerExerciseName,
            47 => StairStepperExerciseName, 49 => SuspensionExerciseName, 50 => TireExerciseName,
            52 => RunIndoorExerciseName, 53 => BikeOutdoorExerciseName,
        );
        assert_eq!(named, all().count());
    }

    #[test]
    fn dumbbell_bench_press_is_dumbbell_chest_two_sided() {
        let e = lookup(0, ft::BenchPressExerciseName::DumbbellBenchPress.as_u16()).unwrap();
        assert_eq!(e.equipment, Equipment::Dumbbell);
        assert_eq!(e.region, Some(Region::Chest));
        assert!(!e.one_sided);
        assert_eq!(e.label_key, "dumbbell_bench_press");
    }

    #[test]
    fn single_arm_dumbbell_bench_press_is_one_sided() {
        let n = ft::BenchPressExerciseName::SingleArmDumbbellBenchPress.as_u16();
        assert!(lookup(0, n).unwrap().one_sided);
    }

    #[test]
    fn unknown_pair_has_no_entry_and_keeps_category_region() {
        assert!(lookup(0, 9999).is_none());
        assert!(lookup(9999, 0).is_none());
        assert_eq!(display_name(0, 9999), None);
        assert_eq!(category_region(0), Some(Region::Chest));
    }

    #[test]
    fn table_is_sorted_and_keys_are_unique_within_a_category() {
        let rows: Vec<_> = all().collect();
        assert!(
            rows.windows(2)
                .all(|w| (w[0].category, w[0].name) < (w[1].category, w[1].name))
        );
        let mut seen = std::collections::HashSet::new();
        for e in &rows {
            assert!(seen.insert((e.category, e.label_key)), "{}", e.label_key);
        }
    }
}
