//! The exercise picker's list: the catalogue narrowed by equipment, body region, muscle and a
//! typed query, ordered by what the athlete does, with when each was last done.
//!
//! Ordering: results of the search by match quality; among equal matches, the exercises that
//! usually follow the one just done, then the athlete's exercises by relevance, then the rest
//! of the catalogue in its own order.

use super::catalogue::{self, Equipment, Region};
use super::exercise_search::ExerciseSearch;
use crate::persistence::exercise_usage::{FollowingExercise, RankedExercise};
use std::collections::HashMap;

/// Added to the relevance of an exercise that usually follows the last one, so it outranks
/// every exercise ranked by use alone.
const FOLLOWER_BONUS: f64 = 1.0e9;

/// What the picker is narrowed by. Every filter that is set must hold.
#[derive(Debug, Clone, Default)]
pub struct PickerFilter {
    /// Any of these; empty allows every equipment.
    pub equipment: Vec<Equipment>,
    pub region: Option<Region>,
    /// A muscle slug the exercise works as a primary muscle.
    pub muscle: Option<String>,
    pub query: String,
}

/// One exercise in the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickerRow {
    pub category: u16,
    pub name: u16,
    pub label_key: &'static str,
    /// Whole days since the athlete last did it; `None` when never.
    pub last_done_days: Option<u32>,
    /// It has followed the exercise just done in the athlete's sessions.
    pub usually_next: bool,
}

/// The region a muscle belongs to.
pub fn muscle_region(slug: &str) -> Option<Region> {
    match slug {
        "biceps" | "triceps" | "forearm" => Some(Region::Arms),
        "deltoids" | "trapezius" => Some(Region::Shoulders),
        "chest" => Some(Region::Chest),
        "upper-back" | "lower-back" => Some(Region::Back),
        "abs" | "obliques" => Some(Region::Core),
        "quadriceps" | "hamstring" | "gluteal" | "calves" | "adductors" => Some(Region::Legs),
        _ => None,
    }
}

/// Every muscle with its region, in a fixed order.
pub const MUSCLES: &[&str] = &[
    "biceps",
    "triceps",
    "forearm",
    "deltoids",
    "trapezius",
    "chest",
    "upper-back",
    "lower-back",
    "abs",
    "obliques",
    "quadriceps",
    "hamstring",
    "gluteal",
    "calves",
    "adductors",
];

/// An exercise's region: its own, else its category's.
fn region_of(e: &catalogue::Exercise) -> Option<Region> {
    e.region.or_else(|| catalogue::category_region(e.category))
}

fn works_muscle(category: u16, slug: &str) -> bool {
    crate::fit::exercise_muscle_groups(category)
        .iter()
        .any(|m| m.intensity == 2 && m.slug == slug)
}

/// The picker list. `ranked` is the athlete's exercises by relevance, `followers` those that
/// followed the exercise just done (empty outside a session).
pub fn pick(
    filter: &PickerFilter,
    search: &ExerciseSearch,
    ranked: &[RankedExercise],
    followers: &[FollowingExercise],
) -> Vec<PickerRow> {
    let mut last_done: HashMap<&'static str, u32> = HashMap::new();
    let mut relevance: HashMap<String, f64> = HashMap::new();
    for used in ranked {
        let Some(exercise) = used.name.and_then(|n| catalogue::lookup(used.category, n)) else {
            continue;
        };
        last_done.insert(exercise.label_key, used.last_done_days);
        relevance.insert(exercise.label_key.to_string(), used.relevance);
    }
    let mut next: HashMap<&'static str, bool> = HashMap::new();
    for follower in followers {
        let Some(exercise) = follower
            .name
            .and_then(|n| catalogue::lookup(follower.category, n))
        else {
            continue;
        };
        next.insert(exercise.label_key, true);
        *relevance
            .entry(exercise.label_key.to_string())
            .or_insert(0.0) += FOLLOWER_BONUS + f64::from(follower.times);
    }

    let by_key: HashMap<&'static str, catalogue::Exercise> =
        catalogue::all().map(|e| (e.label_key, e)).collect();
    search
        .search(&filter.query, &relevance)
        .into_iter()
        .filter_map(|key| by_key.get(key))
        .filter(|e| {
            (filter.equipment.is_empty() || filter.equipment.contains(&e.equipment))
                && filter.region.is_none_or(|r| region_of(e) == Some(r))
                && filter
                    .muscle
                    .as_deref()
                    .is_none_or(|m| works_muscle(e.category, m))
        })
        .map(|e| PickerRow {
            category: e.category,
            name: e.name,
            label_key: e.label_key,
            last_done_days: last_done.get(e.label_key).copied(),
            usually_next: next.contains_key(e.label_key),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BARBELL_CURL: (u16, u16) = (7, 0);

    fn key_of(category: u16, name: u16) -> &'static str {
        catalogue::lookup(category, name).unwrap().label_key
    }

    fn used(category: u16, name: u16, days: u32, relevance: f64) -> RankedExercise {
        RankedExercise {
            category,
            name: Some(name),
            last_done_days: days,
            relevance,
            sessions: 1,
        }
    }

    fn run(
        filter: PickerFilter,
        ranked: &[RankedExercise],
        followers: &[FollowingExercise],
    ) -> Vec<PickerRow> {
        pick(
            &filter,
            &ExerciseSearch::new(&HashMap::new()),
            ranked,
            followers,
        )
    }

    #[test]
    fn unfiltered_list_is_the_whole_catalogue_with_the_athletes_exercises_first() {
        let curl = catalogue::all().find(|e| e.category == 7).unwrap();
        let ranked = [used(curl.category, curl.name, 3, 2.0)];
        let rows = run(PickerFilter::default(), &ranked, &[]);
        assert_eq!(rows.len(), catalogue::all().count());
        assert_eq!(rows[0].label_key, curl.label_key);
        assert_eq!(rows[0].last_done_days, Some(3));
        assert!(rows[1..].iter().all(|r| r.last_done_days.is_none()));
    }

    #[test]
    fn region_then_muscle_then_equipment_narrow_the_list() {
        let arms = run(
            PickerFilter {
                region: Some(Region::Arms),
                ..Default::default()
            },
            &[],
            &[],
        );
        let biceps = run(
            PickerFilter {
                region: Some(Region::Arms),
                muscle: Some("biceps".into()),
                ..Default::default()
            },
            &[],
            &[],
        );
        let dumbbell_biceps = run(
            PickerFilter {
                region: Some(Region::Arms),
                muscle: Some("biceps".into()),
                equipment: vec![Equipment::Dumbbell],
                ..Default::default()
            },
            &[],
            &[],
        );
        assert!(!dumbbell_biceps.is_empty());
        assert!(dumbbell_biceps.len() < biceps.len());
        assert!(biceps.len() < arms.len());
        let equipment_of = |r: &PickerRow| catalogue::lookup(r.category, r.name).unwrap().equipment;
        assert!(
            dumbbell_biceps
                .iter()
                .all(|r| equipment_of(r) == Equipment::Dumbbell)
        );
        assert!(biceps.iter().all(|r| works_muscle(r.category, "biceps")));
        assert!(arms.iter().all(|r| {
            region_of(&catalogue::lookup(r.category, r.name).unwrap()) == Some(Region::Arms)
        }));
    }

    #[test]
    fn several_equipment_chips_allow_any_of_them() {
        let both = run(
            PickerFilter {
                equipment: vec![Equipment::Dumbbell, Equipment::Barbell],
                ..Default::default()
            },
            &[],
            &[],
        );
        let barbell = run(
            PickerFilter {
                equipment: vec![Equipment::Barbell],
                ..Default::default()
            },
            &[],
            &[],
        );
        assert!(both.len() > barbell.len());
    }

    #[test]
    fn exercises_that_follow_the_last_one_lead_even_over_more_used_ones() {
        let (bc, bn) = BARBELL_CURL;
        let most_used = catalogue::all().find(|e| e.category == 0).unwrap();
        let ranked = [
            used(most_used.category, most_used.name, 1, 50.0),
            used(bc, bn, 9, 0.5),
        ];
        let followers = [FollowingExercise {
            category: bc,
            name: Some(bn),
            times: 4,
        }];
        let rows = run(PickerFilter::default(), &ranked, &followers);
        assert_eq!(rows[0].label_key, key_of(bc, bn));
        assert!(rows[0].usually_next);
        assert_eq!(rows[1].label_key, most_used.label_key);
        assert!(!rows[1].usually_next);
    }

    #[test]
    fn a_query_narrows_inside_the_other_filters() {
        let rows = run(
            PickerFilter {
                query: "curl".into(),
                muscle: Some("biceps".into()),
                ..Default::default()
            },
            &[],
            &[],
        );
        assert!(!rows.is_empty());
        assert!(rows.iter().all(|r| r.label_key.contains("curl")));
    }

    #[test]
    fn no_match_is_an_empty_list() {
        let rows = run(
            PickerFilter {
                query: "zzzzzzzz".into(),
                ..Default::default()
            },
            &[],
            &[],
        );
        assert!(rows.is_empty());
    }

    #[test]
    fn every_muscle_has_a_region() {
        assert!(MUSCLES.iter().all(|m| muscle_region(m).is_some()));
    }
}
