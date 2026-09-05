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

pub fn is_cycling(sport: &str) -> bool {
    CYCLING.contains(&sport)
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

    #[test]
    fn no_sport_sits_in_two_families() {
        let all: Vec<&str> = [CYCLING, RUNNING, WALKING, SWIMMING].concat();
        let mut seen = std::collections::HashSet::new();
        for sport in all {
            assert!(seen.insert(sport), "{sport} is in two families");
        }
    }
}
