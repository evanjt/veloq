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

/// Sports whose effort is a power number: every cycling sport, and rowing,
/// which the activity chart already opens on power.
pub const POWER: &[&str] = &[
    "Ride",
    "VirtualRide",
    "MountainBikeRide",
    "GravelRide",
    "EBikeRide",
    "TrackRide",
    "Cyclocross",
    "Handcycle",
    "Velomobile",
    "Rowing",
    "VirtualRow",
];

pub const DISPLAY_RIDE: &[&str] = CYCLING;
pub const DISPLAY_RUN: &[&str] = RUNNING;
pub const DISPLAY_SWIM: &[&str] = SWIMMING;
pub const DISPLAY_WALK: &[&str] = &["Walk"];
pub const DISPLAY_HIKE: &[&str] = &["Hike", "Snowshoe"];
pub const DISPLAY_SNOW: &[&str] = &[
    "AlpineSki",
    "NordicSki",
    "BackcountrySki",
    "Snowboard",
    "RollerSki",
];
pub const DISPLAY_WATER: &[&str] = &[
    "Rowing",
    "VirtualRow",
    "Kayaking",
    "Canoeing",
    "Surfing",
    "Kitesurf",
    "Windsurf",
    "StandUpPaddling",
    "Sail",
];
pub const DISPLAY_GYM: &[&str] = &[
    "Workout",
    "WeightTraining",
    "Yoga",
    "Pilates",
    "Crossfit",
    "Elliptical",
    "StairStepper",
    "HighIntensityIntervalTraining",
    "IceSkate",
    "InlineSkate",
    "Skateboard",
];
pub const DISPLAY_RACKET: &[&str] = &[
    "Tennis",
    "Badminton",
    "Pickleball",
    "Racquetball",
    "Squash",
    "TableTennis",
];
pub const DISPLAY_OTHER: &[&str] = &["Soccer", "Golf", "RockClimbing", "Wheelchair", "Other"];

pub const DISPLAY_GROUPS: &[(&str, &[&str])] = &[
    ("Ride", DISPLAY_RIDE),
    ("Run", DISPLAY_RUN),
    ("Swim", DISPLAY_SWIM),
    ("Walk", DISPLAY_WALK),
    ("Hike", DISPLAY_HIKE),
    ("Snow", DISPLAY_SNOW),
    ("Water", DISPLAY_WATER),
    ("Gym", DISPLAY_GYM),
    ("Racket", DISPLAY_RACKET),
    ("Other", DISPLAY_OTHER),
];

pub fn display_group(sport: &str) -> &'static str {
    DISPLAY_GROUPS
        .iter()
        .find(|(_, sports)| sports.contains(&sport))
        .map_or("Other", |(group, _)| group)
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

/// Sports whose elevation is not the athlete's own climbing: assisted, or simulated.
pub(crate) const UNPOWERED_ELEVATION_EXCLUDED: &[&str] =
    &["EBikeRide", "VirtualRide", "VirtualRun", "Treadmill"];

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
    fn the_sql_list_quotes_each_sport_and_escapes_a_quote() {
        assert_eq!(sql_list(&["Ride", "Run"]), "'Ride', 'Run'");
        assert_eq!(sql_list(&["O'Run"]), "'O''Run'");
        assert_eq!(sql_list(&[]), "");
    }

    /// A chip claims its family and Other takes the rest, so a sport the
    /// athlete takes up next year is under a chip the day it syncs. Four
    /// hand-written lists left open-water swims under no chip at all.
    #[test]
    fn every_sport_answers_to_one_feed_chip_and_other_takes_the_rest() {
        use crate::FfiFeedGroup;
        for sport in CYCLING {
            assert_eq!(FfiFeedGroup::of(sport), FfiFeedGroup::Cycling, "{sport}");
        }
        for sport in RUNNING {
            assert_eq!(FfiFeedGroup::of(sport), FfiFeedGroup::Running, "{sport}");
        }
        for sport in SWIMMING {
            assert_eq!(FfiFeedGroup::of(sport), FfiFeedGroup::Swimming, "{sport}");
        }
        for sport in WALKING
            .iter()
            .chain(DISPLAY_SNOW)
            .chain(DISPLAY_GYM)
            .chain(DISPLAY_RACKET)
            .chain(&["Snowshoe", "Rowing", "Kitesurf", "RockClimbing", ""])
        {
            assert_eq!(FfiFeedGroup::of(sport), FfiFeedGroup::Other, "{sport}");
        }
        // A prefix claims nothing longer than itself.
        assert_eq!(FfiFeedGroup::of("RideTheWind"), FfiFeedGroup::Other);
        assert_eq!(FfiFeedGroup::of("Rungby"), FfiFeedGroup::Other);
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
