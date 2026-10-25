//! The one sport taxonomy.
//!
//! intervals.icu names a sport with an open string, and the app must not
//! drop an activity it has never heard of, so nothing here is an enum. What
//! it answers is three questions a screen or a query keeps asking of that
//! string: is it cycling, does it measure power, and is its speed shown as a
//! pace. Seven hand-written lists answered them before, in two languages,
//! with memberships of two to nine, so an e-bike ride moved the FTP chart and
//! counted for nothing in the fitness gain the chart explains.
//!
//! TypeScript reads the same lists from `sportTaxonomy.generated.ts`, written
//! by `scripts/generate-sport-taxonomy.ts` from this file and checked by
//! `npm run audit`, so the render path pays no FFI call for a predicate.

/// Every cycling sport intervals.icu records an FTP for.
pub const CYCLING: &[&str] = &[
    "Ride",
    "VirtualRide",
    "MountainBikeRide",
    "GravelRide",
    "EBikeRide",
    "EMountainBikeRide",
    "TrackRide",
    "Cyclocross",
    "Handcycle",
    "Velomobile",
];

/// Running, indoors or out. A treadmill run is a run the way a virtual ride is a ride.
pub const RUNNING: &[&str] = &["Run", "VirtualRun", "TrailRun", "Treadmill"];

/// Sports recorded in a simulated world.
pub const VIRTUAL: &[&str] = &["VirtualRide", "VirtualRun", "VirtualRow"];

/// On foot and shown as a pace, and not a run.
pub const WALKING: &[&str] = &["Walk", "Hike"];

pub const SWIMMING: &[&str] = &["Swim", "OpenWaterSwim"];

/// On foot. intervals.icu stores their cadence as strides a minute, one per
/// pair of steps, and a step is what an athlete on foot counts.
pub const STRIDE_CADENCE: &[&str] = &[
    "Run",
    "VirtualRun",
    "TrailRun",
    "Treadmill",
    "Walk",
    "Hike",
    "Snowshoe",
];

/// Swum, rowed or paddled. Their cadence is strokes a minute as stored.
pub const STROKE_CADENCE: &[&str] = &[
    "Swim",
    "OpenWaterSwim",
    "Rowing",
    "VirtualRow",
    "Kayaking",
    "Canoeing",
    "StandUpPaddling",
];

/// Sports whose effort is a power number: every cycling sport, and rowing,
/// which the activity chart already opens on power.
pub const POWER: &[&str] = &[
    "Ride",
    "VirtualRide",
    "MountainBikeRide",
    "GravelRide",
    "EBikeRide",
    "EMountainBikeRide",
    "TrackRide",
    "Cyclocross",
    "Handcycle",
    "Velomobile",
    "Rowing",
    "VirtualRow",
];

// The families every activity is drawn in, one list each in stack order. A
// family is a colour, not a count: it folds the counting families above
// (cycling into ride, swimming into water, walking into foot) and places
// every other sport intervals.icu names. A sport no list holds is Other.

pub const FAMILY_RIDE: &[&str] = CYCLING;
pub const FAMILY_WINTER: &[&str] = &[
    "AlpineSki",
    "Snowboard",
    "NordicSki",
    "BackcountrySki",
    "RollerSki",
    "Snowshoe",
    "IceSkate",
];
pub const FAMILY_RUN: &[&str] = RUNNING;
pub const FAMILY_WATER: &[&str] = &[
    "Swim",
    "OpenWaterSwim",
    "Rowing",
    "VirtualRow",
    "Kayaking",
    "Canoeing",
    "StandUpPaddling",
    "Sail",
    "Windsurf",
    "Kitesurf",
    "Surfing",
];
pub const FAMILY_FOOT: &[&str] = &["Walk", "Hike", "Wheelchair"];
pub const FAMILY_STRENGTH: &[&str] = &[
    "Workout",
    "WeightTraining",
    "Yoga",
    "Pilates",
    "Crossfit",
    "HighIntensityIntervalTraining",
    "Elliptical",
    "StairStepper",
];
pub const FAMILY_OTHER: &[&str] = &[
    "Tennis",
    "Badminton",
    "Pickleball",
    "Racquetball",
    "Squash",
    "TableTennis",
    "Soccer",
    "Golf",
    "RockClimbing",
    "InlineSkate",
    "Skateboard",
    "Other",
];

/// Every family by name, in the order a stack of them is drawn.
pub const FAMILIES: &[(&str, &[&str])] = &[
    ("Ride", FAMILY_RIDE),
    ("Winter", FAMILY_WINTER),
    ("Run", FAMILY_RUN),
    ("Water", FAMILY_WATER),
    ("Foot", FAMILY_FOOT),
    ("Strength", FAMILY_STRENGTH),
    ("Other", FAMILY_OTHER),
];

/// The sport an activity is filed under when nothing names one. It is the
/// Other family every sport no family lists already falls into, so an
/// unreported sport never reaches cycling-only logic.
pub const UNKNOWN: &str = "Other";

/// The sport as reported, or [`UNKNOWN`] when it is absent or empty.
pub fn sport_or_unknown(sport: Option<&str>) -> &str {
    sport.filter(|s| !s.is_empty()).unwrap_or(UNKNOWN)
}

/// Sub-sports drawn in their family's second fixed shade: off-road riding,
/// trail running, paddling and rowing, hiking, nordic and snowshoe, mobility.
pub const SHADE_2: &[&str] = &[
    "GravelRide",
    "MountainBikeRide",
    "EMountainBikeRide",
    "Cyclocross",
    "TrailRun",
    "Rowing",
    "VirtualRow",
    "Kayaking",
    "Canoeing",
    "StandUpPaddling",
    "Hike",
    "NordicSki",
    "BackcountrySki",
    "RollerSki",
    "Snowshoe",
    "Yoga",
    "Pilates",
];

/// Sub-sports drawn in their family's third fixed shade: indoor riding and
/// running, wind and wave, skating, conditioning.
pub const SHADE_3: &[&str] = &[
    "VirtualRide",
    "TrackRide",
    "VirtualRun",
    "Treadmill",
    "Sail",
    "Windsurf",
    "Kitesurf",
    "Surfing",
    "IceSkate",
    "Crossfit",
    "HighIntensityIntervalTraining",
    "Elliptical",
    "StairStepper",
];

/// The family a sport is drawn in. A sport no family lists is Other.
pub fn sport_family(sport: &str) -> &'static str {
    FAMILIES
        .iter()
        .find(|(_, sports)| sports.contains(&sport))
        .map_or("Other", |(family, _)| family)
}

/// The sport's fixed shade within its family, 1 to 3. The base shade is 1,
/// and the only one drawn where families mix.
pub fn sport_shade(sport: &str) -> u8 {
    if SHADE_3.contains(&sport) {
        3
    } else if SHADE_2.contains(&sport) {
        2
    } else {
        1
    }
}

/// Whether the sport is a strength session, whose FIT file carries exercise
/// sets and which has no track.
pub fn is_strength(sport: &str) -> bool {
    sport == "WeightTraining"
}

pub fn is_cycling(sport: &str) -> bool {
    CYCLING.contains(&sport)
}

/// Whether the sport is ridden or run in a simulated world. Its track is drawn
/// where the virtual route is, which need not be anywhere the athlete has been.
pub fn is_virtual(sport: &str) -> bool {
    VIRTUAL.contains(&sport)
}

pub fn is_running(sport: &str) -> bool {
    RUNNING.contains(&sport)
}

pub fn is_swimming(sport: &str) -> bool {
    SWIMMING.contains(&sport)
}

pub fn measures_power(sport: &str) -> bool {
    POWER.contains(&sport)
}

/// Whether speed is shown as minutes per kilometre. Swimming has its own pace
/// and its own predicate, per hundred metres rather than per kilometre.
pub fn shows_pace(sport: &str) -> bool {
    RUNNING.contains(&sport) || WALKING.contains(&sport)
}

/// The unit a sport's cadence is shown in. intervals.icu stores one number
/// for every sport, cycles a minute, which is a crank revolution on a bike, a
/// stride on foot and a stroke in the water. A sport no list names keeps the
/// stored cycles, which is revolutions a minute.
pub fn cadence_unit(sport: &str) -> crate::FfiCadenceUnit {
    if STRIDE_CADENCE.contains(&sport) {
        crate::FfiCadenceUnit::StepsPerMinute
    } else if STROKE_CADENCE.contains(&sport) {
        crate::FfiCadenceUnit::StrokesPerMinute
    } else {
        crate::FfiCadenceUnit::Rpm
    }
}

/// A stored cadence in the sport's [`cadence_unit`]: a stride is two steps,
/// and every other unit is the stored number.
pub fn cadence_per_minute(sport: &str, stored: f64) -> f64 {
    match cadence_unit(sport) {
        crate::FfiCadenceUnit::StepsPerMinute => stored * 2.0,
        crate::FfiCadenceUnit::Rpm | crate::FfiCadenceUnit::StrokesPerMinute => stored,
    }
}

/// The sports a query for `sport` should match: its family when it has one,
/// otherwise itself, so an unknown sport still answers for its own rows.
pub fn family_of(sport: &str) -> Vec<&str> {
    for family in [CYCLING, RUNNING, WALKING, SWIMMING] {
        if family.contains(&sport) {
            return family.to_vec();
        }
    }
    vec![sport]
}

/// The sport string for the Sport and SubSport numbers of a FIT session, in
/// the names intervals.icu uses. A pairing no arm names falls to its sport's
/// plain form, and a sport the profile names that no list here holds is
/// `Other`.
pub fn from_fit(sport: Option<u8>, sub_sport: Option<u8>) -> &'static str {
    // SubSport numbers by name, per the FIT profile.
    const MOUNTAIN: u8 = 8;
    const CYCLOCROSS: u8 = 11;
    const HAND_CYCLING: u8 = 12;
    const TRACK_CYCLING: u8 = 13;
    const E_BIKE_FITNESS: u8 = 28;
    const E_BIKE_MOUNTAIN: u8 = 47;
    const GRAVEL: u8 = 46;
    const TRAIL: u8 = 3;
    const OPEN_WATER: u8 = 18;
    const VIRTUAL_ACTIVITY: u8 = 58;
    const BACKCOUNTRY: u8 = 37;
    const STRENGTH: u8 = 20;
    const ELLIPTICAL: u8 = 15;
    const STAIR_CLIMBING: u8 = 16;
    const INDOOR_ROWING: u8 = 14;
    const YOGA: u8 = 43;
    const PILATES: u8 = 44;
    const HIIT: u8 = 62;
    let sub = sub_sport.unwrap_or(0);
    match sport {
        Some(1) => match sub {
            TRAIL => "TrailRun",
            VIRTUAL_ACTIVITY => "VirtualRun",
            _ => "Run",
        },
        Some(2) => match sub {
            MOUNTAIN => "MountainBikeRide",
            CYCLOCROSS => "Cyclocross",
            HAND_CYCLING => "Handcycle",
            TRACK_CYCLING => "TrackRide",
            GRAVEL => "GravelRide",
            E_BIKE_FITNESS => "EBikeRide",
            E_BIKE_MOUNTAIN => "EMountainBikeRide",
            VIRTUAL_ACTIVITY => "VirtualRide",
            _ => "Ride",
        },
        Some(21) => match sub {
            E_BIKE_MOUNTAIN => "EMountainBikeRide",
            _ => "EBikeRide",
        },
        Some(4) => match sub {
            ELLIPTICAL => "Elliptical",
            STAIR_CLIMBING => "StairStepper",
            INDOOR_ROWING => "Rowing",
            STRENGTH => "WeightTraining",
            YOGA => "Yoga",
            PILATES => "Pilates",
            HIIT => "HighIntensityIntervalTraining",
            _ => "Workout",
        },
        Some(10) => match sub {
            STRENGTH => "WeightTraining",
            YOGA => "Yoga",
            PILATES => "Pilates",
            HIIT => "HighIntensityIntervalTraining",
            _ => "Workout",
        },
        Some(5) => match sub {
            OPEN_WATER => "OpenWaterSwim",
            _ => "Swim",
        },
        Some(11) => "Walk",
        Some(17) => "Hike",
        Some(35) => "Snowshoe",
        Some(12) => "NordicSki",
        Some(13) => match sub {
            BACKCOUNTRY => "BackcountrySki",
            _ => "AlpineSki",
        },
        Some(14) => "Snowboard",
        Some(15) => "Rowing",
        Some(19 | 41) => "Kayaking",
        Some(37) => "StandUpPaddling",
        Some(32) => "Sail",
        Some(43) => "Windsurf",
        Some(44) => "Kitesurf",
        Some(38) => "Surfing",
        Some(33) => "IceSkate",
        Some(30) => "InlineSkate",
        Some(8) => "Tennis",
        Some(7) => "Soccer",
        Some(25) => "Golf",
        Some(31) => "RockClimbing",
        _ => "Other",
    }
}

/// Sports whose elevation is not the athlete's own climbing: assisted, or simulated.
pub(crate) const UNPOWERED_ELEVATION_EXCLUDED: &[&str] = &[
    "EBikeRide",
    "EMountainBikeRide",
    "VirtualRide",
    "VirtualRun",
    "Treadmill",
];

/// The sports a climbing best for `sport` counts: its family less the assisted
/// and virtual ones. Hike and Walk are their own family, so a run never counts them.
pub fn climbing_family(sport: &str) -> Vec<&str> {
    family_of(sport)
        .into_iter()
        .filter(|s| !UNPOWERED_ELEVATION_EXCLUDED.contains(s))
        .collect()
}

/// `'Ride', 'VirtualRide'` for a SQL `IN` list, quotes escaped.
pub fn sql_list(sports: &[&str]) -> String {
    sports
        .iter()
        .map(|s| format!("'{}'", s.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scenario: a Garmin original names its sport by profile numbers, and the
    /// stored activity is typed by the string every screen keys on.
    ///
    /// Expected behaviour: each pairing lands on a sport the taxonomy lists, and
    /// the ones the app reads by family land in the family they belong to.
    #[test]
    fn a_fit_sport_maps_to_a_listed_sport() {
        let cases = [
            (Some(2), Some(0), "Ride"),
            (Some(2), None, "Ride"),
            (Some(2), Some(6), "Ride"),
            (Some(2), Some(8), "MountainBikeRide"),
            (Some(2), Some(46), "GravelRide"),
            (Some(2), Some(58), "VirtualRide"),
            (Some(21), Some(0), "EBikeRide"),
            (Some(1), Some(1), "Run"),
            (Some(1), Some(3), "TrailRun"),
            (Some(5), Some(17), "Swim"),
            (Some(5), Some(18), "OpenWaterSwim"),
            (Some(17), None, "Hike"),
            (Some(10), Some(20), "WeightTraining"),
            (Some(10), Some(0), "Workout"),
            (Some(4), Some(15), "Elliptical"),
            (Some(0), None, "Other"),
            (None, None, "Other"),
            (Some(200), None, "Other"),
        ];
        for (sport, sub, want) in cases {
            assert_eq!(from_fit(sport, sub), want, "{sport:?} {sub:?}");
        }
        for sport in 0..=u8::MAX {
            for sub in [
                0, 3, 6, 8, 11, 14, 15, 16, 18, 20, 28, 37, 43, 44, 46, 47, 58, 62,
            ] {
                let mapped = from_fit(Some(sport), Some(sub));
                assert!(
                    mapped == "Other" || FAMILIES.iter().any(|(_, list)| list.contains(&mapped)),
                    "{sport} {sub} mapped to {mapped}, which no family lists"
                );
            }
        }
        assert!(is_cycling(from_fit(Some(2), Some(13))));
        assert!(is_virtual(from_fit(Some(2), Some(58))));
    }

    #[test]
    fn climbing_bests_drop_assisted_and_virtual_sports() {
        let ride = climbing_family("Ride");
        assert!(ride.contains(&"Ride") && ride.contains(&"GravelRide"));
        assert!(!ride.contains(&"EBikeRide") && !ride.contains(&"VirtualRide"));
        assert_eq!(climbing_family("VirtualRide"), ride);
        assert_eq!(climbing_family("Run"), vec!["Run", "TrailRun"]);
        assert!(!climbing_family("Run").contains(&"Treadmill"));
        assert_eq!(climbing_family("Hike"), vec!["Walk", "Hike"]);
        assert_eq!(climbing_family("Kayaking"), vec!["Kayaking"]);
    }

    /// An electric mountain bike is ridden, measures power and is drawn as a
    /// ride, and its assisted climbing counts toward no climbing best.
    #[test]
    fn an_electric_mountain_bike_is_cycling_with_assisted_climbing() {
        assert!(is_cycling("EMountainBikeRide"));
        assert!(measures_power("EMountainBikeRide"));
        assert_eq!(sport_family("EMountainBikeRide"), "Ride");
        assert!(family_of("MountainBikeRide").contains(&"EMountainBikeRide"));
        assert!(!climbing_family("Ride").contains(&"EMountainBikeRide"));
        assert!(!climbing_family("EMountainBikeRide").contains(&"EMountainBikeRide"));
    }

    #[test]
    fn every_cycling_sport_measures_power_and_is_not_a_pace() {
        for sport in CYCLING {
            assert!(is_cycling(sport), "{sport}");
            assert!(measures_power(sport), "{sport}");
            assert!(!shows_pace(sport), "{sport}");
            assert!(!is_running(sport) && !is_swimming(sport), "{sport}");
        }
    }

    #[test]
    fn running_and_walking_are_paces_and_not_cycling() {
        for sport in RUNNING.iter().chain(WALKING) {
            assert!(shows_pace(sport), "{sport}");
            assert!(!is_cycling(sport) && !measures_power(sport), "{sport}");
        }
        assert!(is_running("Treadmill"));
        assert!(!is_running("Walk"));
    }

    #[test]
    fn swimming_is_neither_a_kilometre_pace_nor_power() {
        for sport in SWIMMING {
            assert!(is_swimming(sport), "{sport}");
            assert!(!shows_pace(sport) && !measures_power(sport), "{sport}");
        }
    }

    #[test]
    fn only_the_simulated_sports_are_virtual() {
        for sport in ["VirtualRide", "VirtualRun", "VirtualRow"] {
            assert!(is_virtual(sport), "{sport}");
        }
        for sport in [
            "Ride",
            "Run",
            "Rowing",
            "Treadmill",
            "EBikeRide",
            "",
            "virtualride",
        ] {
            assert!(!is_virtual(sport), "{sport}");
        }
    }

    #[test]
    fn rowing_measures_power_without_being_cycling() {
        assert!(measures_power("Rowing"));
        assert!(measures_power("VirtualRow"));
        assert!(!is_cycling("Rowing"));
    }

    /// Expected behaviour: a run's stored strides a minute show as steps,
    /// twice the number, while a ride's revolutions and a swim's strokes show
    /// as stored.
    #[test]
    fn cadence_is_steps_on_foot_and_as_stored_elsewhere() {
        use crate::FfiCadenceUnit::*;
        assert_eq!(cadence_unit("Run"), StepsPerMinute);
        assert_eq!(cadence_per_minute("Run", 75.0), 150.0);
        assert_eq!(cadence_per_minute("Run", 66.3), 132.6);
        for sport in RUNNING.iter().chain(WALKING) {
            assert_eq!(cadence_unit(sport), StepsPerMinute, "{sport}");
            assert_eq!(cadence_per_minute(sport, 80.0), 160.0, "{sport}");
        }
        for sport in CYCLING {
            assert_eq!(cadence_unit(sport), Rpm, "{sport}");
            assert_eq!(cadence_per_minute(sport, 90.0), 90.0, "{sport}");
        }
        for sport in SWIMMING.iter().chain(&["Rowing", "Kayaking"]) {
            assert_eq!(cadence_unit(sport), StrokesPerMinute, "{sport}");
            assert_eq!(cadence_per_minute(sport, 28.0), 28.0, "{sport}");
        }
        for sport in ["", "Unicycle", "run", "WeightTraining"] {
            assert_eq!(cadence_unit(sport), Rpm, "{sport}");
            assert_eq!(cadence_per_minute(sport, 60.0), 60.0, "{sport}");
        }
        assert_eq!(cadence_per_minute("Run", 0.0), 0.0);
        assert!(cadence_per_minute("Run", f64::NAN).is_nan());
    }

    #[test]
    fn an_unknown_sport_answers_no_to_everything_and_is_its_own_family() {
        for sport in ["", "Unicycle", "ride", "RIDE", "Rid"] {
            assert!(!is_cycling(sport), "{sport}");
            assert!(!measures_power(sport), "{sport}");
            assert!(!shows_pace(sport), "{sport}");
            assert_eq!(family_of(sport), vec![sport]);
        }
    }

    #[test]
    fn a_family_is_the_whole_list_from_any_member() {
        assert_eq!(family_of("Cyclocross"), CYCLING.to_vec());
        assert_eq!(family_of("Treadmill"), RUNNING.to_vec());
        assert_eq!(family_of("Hike"), WALKING.to_vec());
        assert_eq!(family_of("OpenWaterSwim"), SWIMMING.to_vec());
    }

    #[test]
    fn a_missing_or_empty_sport_is_other_and_a_reported_one_is_kept() {
        assert_eq!(sport_or_unknown(None), "Other");
        assert_eq!(sport_or_unknown(Some("")), "Other");
        assert_eq!(sport_or_unknown(Some("Run")), "Run");
        assert!(!is_cycling(sport_or_unknown(None)));
    }

    #[test]
    fn the_sql_list_quotes_each_sport_and_escapes_a_quote() {
        assert_eq!(sql_list(&["Ride", "Run"]), "'Ride', 'Run'");
        assert_eq!(sql_list(&["O'Run"]), "'O''Run'");
        assert_eq!(sql_list(&[]), "");
    }

    /// A chip claims its family and Other takes the rest, so a sport the
    /// athlete takes up next year is under a chip the day it syncs.
    #[test]
    fn every_sport_answers_to_one_feed_chip_and_other_takes_the_rest() {
        use crate::FfiSportFamily;
        for (name, sports) in FAMILIES {
            for sport in *sports {
                assert_eq!(FfiSportFamily::of(sport).name(), *name, "{sport}");
            }
        }
        for sport in ["", "RideTheWind", "Rungby", "Padel"] {
            assert_eq!(FfiSportFamily::of(sport), FfiSportFamily::Other, "{sport}");
        }
        assert_eq!(FfiSportFamily::of("Snowshoe"), FfiSportFamily::Winter);
        assert_eq!(FfiSportFamily::of("OpenWaterSwim"), FfiSportFamily::Water);
    }

    /// Every sport the engine names sits in exactly one family, and the
    /// families together are the whole list. A sport in none would draw grey
    /// on one screen and answer to a chip on another.
    #[test]
    fn every_named_sport_sits_in_exactly_one_family() {
        let named: Vec<&str> = [CYCLING, RUNNING, WALKING, SWIMMING, POWER, VIRTUAL]
            .concat()
            .into_iter()
            .chain(
                FAMILIES
                    .iter()
                    .flat_map(|(_, sports)| sports.iter().copied()),
            )
            .collect();
        for sport in named {
            let holders: Vec<&str> = FAMILIES
                .iter()
                .filter(|(_, sports)| sports.contains(&sport))
                .map(|(family, _)| *family)
                .collect();
            assert_eq!(holders.len(), 1, "{sport} sits in {holders:?}");
            assert_eq!(sport_family(sport), holders[0], "{sport}");
        }
        let total: usize = FAMILIES.iter().map(|(_, sports)| sports.len()).sum();
        assert_eq!(total, 55);
    }

    #[test]
    fn the_families_stack_in_their_fixed_order() {
        let names: Vec<&str> = FAMILIES.iter().map(|(family, _)| *family).collect();
        assert_eq!(
            names,
            [
                "Ride", "Winter", "Run", "Water", "Foot", "Strength", "Other"
            ]
        );
    }

    #[test]
    fn a_sport_takes_its_family_and_fixed_shade() {
        assert_eq!(sport_family("IceSkate"), "Winter");
        assert_eq!(sport_shade("IceSkate"), 3);
        assert_eq!(sport_family("Snowshoe"), "Winter");
        assert_eq!(sport_shade("Snowshoe"), 2);
        assert_eq!(sport_family("Hike"), "Foot");
        assert_eq!(sport_shade("Hike"), 2);
        assert_eq!(sport_family("Walk"), "Foot");
        assert_eq!(sport_shade("Walk"), 1);
        assert_eq!(sport_family("Wheelchair"), "Foot");
        assert_eq!(sport_family("Swim"), "Water");
        assert_eq!(sport_family("Rowing"), "Water");
        assert_eq!(sport_family("InlineSkate"), "Other");
        assert_eq!(sport_family("Skateboard"), "Other");
        assert_eq!(sport_family("Tennis"), "Other");
        assert_eq!(sport_family("Yoga"), "Strength");
        assert_eq!(sport_shade("Ride"), 1);
        assert_eq!(sport_shade("GravelRide"), 2);
        assert_eq!(sport_shade("VirtualRide"), 3);
    }

    /// Every cycling, running, walking and swimming sport is drawn with the
    /// family its numbers are counted in.
    #[test]
    fn the_counting_families_fold_whole_into_one_drawn_family() {
        for sport in CYCLING {
            assert_eq!(sport_family(sport), "Ride", "{sport}");
        }
        for sport in RUNNING {
            assert_eq!(sport_family(sport), "Run", "{sport}");
        }
        for sport in WALKING {
            assert_eq!(sport_family(sport), "Foot", "{sport}");
        }
        for sport in SWIMMING {
            assert_eq!(sport_family(sport), "Water", "{sport}");
        }
    }

    /// A sport intervals.icu adds next year is drawn as Other with the base
    /// shade the day it syncs, and a prefix claims nothing longer than itself.
    #[test]
    fn an_unknown_sport_is_other_at_the_base_shade() {
        for sport in ["", "Padel", "Hockey", "RideTheWind", "Rungby", "ride"] {
            assert_eq!(sport_family(sport), "Other", "{sport}");
            assert_eq!(sport_shade(sport), 1, "{sport}");
        }
    }

    #[test]
    fn a_shade_names_a_sport_of_a_family_and_other_has_none() {
        for sport in SHADE_2.iter().chain(SHADE_3) {
            assert_ne!(sport_family(sport), "Other", "{sport}");
        }
        for sport in SHADE_2 {
            assert!(!SHADE_3.contains(sport), "{sport} has two shades");
        }
    }

    #[test]
    fn no_sport_sits_in_two_families() {
        let all: Vec<&str> = [CYCLING, RUNNING, WALKING, SWIMMING].concat();
        let mut seen = std::collections::HashSet::new();
        for sport in all {
            assert!(seen.insert(sport), "{sport} is in two families");
        }
    }
}
