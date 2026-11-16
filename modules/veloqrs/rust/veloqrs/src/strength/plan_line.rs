//! Reads one line of a planned workout into an exercise with its sets, a rest, or a note.
//!
//! The exercise is the catalogue search over the words that are not numbers, accepted only when
//! one exercise is plainly the closest. Weight, reps and durations are read from the numbers:
//! "18.5kg", "40 lb", "12/10/8", "3x10", "3 sets of 10", "60 sec", "2 min". "per hand" or
//! "each arm" means a dumbbell in each hand. A line that does not read is returned as a note.

use super::catalogue::{self, Exercise};
use super::labels;
use crate::persistence::strength_sessions::{SessionExercise, SessionSet};
use std::collections::HashMap;

const KG_PER_LB: f64 = 0.453_592_37;

/// One planned set.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedSet {
    pub reps: Option<u32>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
}

/// A catalogue exercise read from a plan line.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedExercise {
    pub category: u16,
    pub name: u16,
    pub label_key: &'static str,
    /// Empty when the line names the exercise and nothing else.
    pub sets: Vec<PlannedSet>,
}

/// What one plan line is.
#[derive(Debug, Clone, PartialEq)]
pub enum PlanLineReading {
    Exercise(PlannedExercise),
    /// A line that is only a rest of this many seconds.
    Rest {
        secs: u32,
    },
    /// A line that did not read, kept as written.
    Note(String),
}

impl PlannedExercise {
    /// The exercise as a session holds it before it begins: every value is also the plan.
    pub fn into_session_exercise(self) -> SessionExercise {
        SessionExercise {
            exercise_category: self.category,
            exercise_name: Some(self.name),
            sets: self
                .sets
                .into_iter()
                .map(|set| SessionSet {
                    reps: set.reps,
                    weight_kg: set.weight_kg,
                    duration_secs: set.duration_secs,
                    planned_reps: set.reps,
                    planned_weight_kg: set.weight_kg,
                    planned_duration_secs: set.duration_secs,
                    ..SessionSet::default()
                })
                .collect(),
            ..SessionExercise::default()
        }
    }
}

/// Reads a line against the held exercise labels.
pub fn read_line(line: &str) -> PlanLineReading {
    read_line_with(line, |query| labels::search(query, &HashMap::new()))
}

/// Reads a line, finding exercises with `search`, which returns label keys best match first.
pub fn read_line_with(line: &str, search: impl Fn(&str) -> Vec<&'static str>) -> PlanLineReading {
    let note = || PlanLineReading::Note(line.trim().to_string());
    let tokens = tokenise(line);
    let Some(read) = read_numbers(&tokens) else {
        return note();
    };
    let words: Vec<&str> = tokens
        .iter()
        .zip(&read.used)
        .filter_map(|(token, used)| match token {
            Token::Word(word) if !used && !FILLER.contains(&word.as_str()) => Some(word.as_str()),
            _ => None,
        })
        .collect();
    if words.is_empty() {
        return note();
    }
    // A number the reader could not place makes the line one not to trust.
    if !read.leftover_numbers.is_empty() {
        return note();
    }
    if words.iter().all(|word| REST_WORDS.contains(word)) {
        return match read.rest_secs() {
            Some(secs) => PlanLineReading::Rest { secs },
            None => note(),
        };
    }
    let mut query = words.join(" ");
    if read.per_hand && !words.iter().any(|word| EQUIPMENT_WORDS.contains(word)) {
        query.push_str(" dumbbell");
    }
    match closest(&query, &search) {
        Some(exercise) => PlanLineReading::Exercise(PlannedExercise {
            category: exercise.category,
            name: exercise.name,
            label_key: exercise.label_key,
            sets: read.sets,
        }),
        None => note(),
    }
}

/// Words that carry no part of an exercise's name.
const FILLER: &[&str] = &[
    "at",
    "of",
    "with",
    "the",
    "a",
    "per",
    "each",
    "hand",
    "hands",
    "arm",
    "arms",
    "side",
    "sides",
    "leg",
    "legs",
    "dumbbell",
    "dumbbells",
    "set",
    "sets",
    "rep",
    "reps",
];
const REST_WORDS: &[&str] = &["rest", "recovery", "break", "pause"];
const EQUIPMENT_WORDS: &[&str] = &[
    "dumbbell",
    "dumbbells",
    "db",
    "barbell",
    "bb",
    "kettlebell",
    "kb",
    "cable",
    "machine",
    "band",
];

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Word(String),
    Slash,
    Cross,
}

fn tokenise(line: &str) -> Vec<Token> {
    let chars: Vec<char> = line.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len()
                && (chars[i].is_ascii_digit()
                    || (chars[i] == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit)))
            {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            tokens.push(Token::Number(text.parse().unwrap_or(0.0)));
        } else if c.is_alphabetic() && c != '×' {
            let start = i;
            while i < chars.len() && chars[i].is_alphabetic() {
                i += 1;
            }
            let word: String = chars[start..i]
                .iter()
                .flat_map(|c| c.to_lowercase())
                .collect();
            tokens.push(if word == "x" {
                Token::Cross
            } else {
                Token::Word(word)
            });
        } else {
            i += 1;
            match c {
                '/' => tokens.push(Token::Slash),
                '×' => tokens.push(Token::Cross),
                _ => {}
            }
        }
    }
    tokens
}

/// The numbers of a line.
struct NumbersRead {
    /// Which tokens the numbers consumed.
    used: Vec<bool>,
    sets: Vec<PlannedSet>,
    per_hand: bool,
    leftover_numbers: Vec<f64>,
    duration_secs: Option<f64>,
}

impl NumbersRead {
    fn rest_secs(&self) -> Option<u32> {
        let secs = self.duration_secs?;
        (secs.fract() == 0.0 && secs > 0.0).then_some(secs as u32)
    }
}

fn whole(value: f64) -> Option<u32> {
    (value.fract() == 0.0 && (0.0..=10_000.0).contains(&value)).then_some(value as u32)
}

fn read_numbers(tokens: &[Token]) -> Option<NumbersRead> {
    let mut used = vec![false; tokens.len()];
    let mut weight_kg = None;
    let mut duration_secs = None;
    let mut rep_counts: Vec<u32> = Vec::new();
    let mut set_count = None;
    let mut per_hand = false;
    let mut leftover_numbers = Vec::new();
    let word = |i: usize| match tokens.get(i) {
        Some(Token::Word(w)) => Some(w.as_str()),
        _ => None,
    };
    let mut i = 0;
    while i < tokens.len() {
        match &tokens[i] {
            Token::Word(w) if matches!(w.as_str(), "per" | "each") => {
                if matches!(
                    word(i + 1),
                    Some("hand" | "hands" | "arm" | "arms" | "dumbbell")
                ) {
                    per_hand = true;
                }
                i += 1;
            }
            Token::Number(n) => {
                let n = *n;
                // 3x10 and 3 × 10
                if let (Some(Token::Cross), Some(Token::Number(reps))) =
                    (tokens.get(i + 1), tokens.get(i + 2))
                {
                    let (sets, reps) = (whole(n)?, whole(*reps)?);
                    set_count = Some(sets);
                    rep_counts = vec![reps];
                    used[i..i + 3].fill(true);
                    i += 3;
                    continue;
                }
                // 3 sets of 10, 3 sets x 10
                if matches!(word(i + 1), Some("set" | "sets")) {
                    let after = if matches!(word(i + 2), Some("of"))
                        || tokens.get(i + 2) == Some(&Token::Cross)
                    {
                        i + 3
                    } else {
                        i + 2
                    };
                    if let Some(Token::Number(reps)) = tokens.get(after)
                        && after > i + 2
                    {
                        set_count = Some(whole(n)?);
                        rep_counts = vec![whole(*reps)?];
                        used[i..=after].fill(true);
                        i = after + 1;
                        continue;
                    }
                }
                // 12/10/8
                if tokens.get(i + 1) == Some(&Token::Slash) {
                    let mut counts = vec![whole(n)?];
                    let mut j = i + 1;
                    while tokens.get(j) == Some(&Token::Slash) {
                        let Some(Token::Number(next)) = tokens.get(j + 1) else {
                            return None;
                        };
                        counts.push(whole(*next)?);
                        j += 2;
                    }
                    used[i..j].fill(true);
                    rep_counts = counts;
                    i = j;
                    continue;
                }
                match word(i + 1) {
                    Some("kg" | "kgs" | "kilo" | "kilos") => weight_kg = Some(n),
                    Some("lb" | "lbs" | "pound" | "pounds") => weight_kg = Some(n * KG_PER_LB),
                    Some("min" | "mins" | "minute" | "minutes") => {
                        duration_secs = Some(n * 60.0);
                    }
                    Some("s" | "sec" | "secs" | "second" | "seconds") => duration_secs = Some(n),
                    Some("rep" | "reps") => rep_counts = vec![whole(n)?],
                    _ => {
                        leftover_numbers.push(n);
                        i += 1;
                        continue;
                    }
                }
                used[i..i + 2].fill(true);
                i += 2;
            }
            _ => i += 1,
        }
    }
    let sets = if rep_counts.len() > 1 {
        rep_counts
            .iter()
            .map(|&reps| PlannedSet {
                reps: Some(reps),
                weight_kg,
                duration_secs: None,
            })
            .collect()
    } else if let Some(&reps) = rep_counts.first() {
        vec![
            PlannedSet {
                reps: Some(reps),
                weight_kg,
                duration_secs: None,
            };
            set_count.unwrap_or(1) as usize
        ]
    } else if duration_secs.is_some() || weight_kg.is_some() {
        vec![PlannedSet {
            reps: None,
            weight_kg,
            duration_secs,
        }]
    } else {
        Vec::new()
    };
    Some(NumbersRead {
        used,
        sets,
        per_hand,
        leftover_numbers,
        duration_secs,
    })
}

/// Words a name may add to what the line says: the equipment and the lift's own "press".
fn completes_name(word: &str) -> bool {
    word == "press" || EQUIPMENT_WORDS.contains(&word)
}

/// The one exercise plainly closest to `query`: of the search hits whose names add only
/// equipment or "press" to the query's words, the one with the fewest words, when no other
/// hit has as few.
fn closest(query: &str, search: &impl Fn(&str) -> Vec<&'static str>) -> Option<Exercise> {
    let wanted: Vec<&str> = query.split_whitespace().collect();
    let plain: Vec<&'static str> = search(query)
        .into_iter()
        .filter(|key| {
            key.split('_')
                .all(|word| wanted.contains(&word) || completes_name(word))
        })
        .collect();
    let words = |key: &str| key.split('_').count();
    let fewest = plain.iter().map(|key| words(key)).min()?;
    let mut nearest = plain.iter().filter(|key| words(key) == fewest);
    let key = *nearest.next()?;
    if nearest.any(|other| *other != key) {
        return None;
    }
    catalogue::all().find(|exercise| exercise.label_key == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strength::exercise_search::ExerciseSearch;

    fn read(line: &str) -> PlanLineReading {
        let search = ExerciseSearch::new(&HashMap::new());
        read_line_with(line, |query| search.search(query, &HashMap::new()))
    }

    fn exercise(line: &str) -> PlannedExercise {
        match read(line) {
            PlanLineReading::Exercise(exercise) => exercise,
            other => panic!("{line:?} read as {other:?}"),
        }
    }

    fn set(reps: u32, weight_kg: f64) -> PlannedSet {
        PlannedSet {
            reps: Some(reps),
            weight_kg: Some(weight_kg),
            duration_secs: None,
        }
    }

    #[test]
    fn per_hand_line_is_a_dumbbell_exercise_with_a_set_per_rep_count() {
        let read = exercise("Bench 18.5kg per hand 12/10/8");
        assert_eq!(read.label_key, "dumbbell_bench_press");
        assert_eq!(read.sets, vec![set(12, 18.5), set(10, 18.5), set(8, 18.5)]);
    }

    #[test]
    fn sets_by_reps_gives_that_many_equal_sets() {
        let read = exercise("3x10 goblet squat 16kg");
        assert_eq!(read.label_key, "goblet_squat");
        assert_eq!(read.sets, vec![set(10, 16.0); 3]);
        assert_eq!(exercise("Goblet squat 16 kg 3 × 10").sets, read.sets);
        assert_eq!(exercise("Goblet squat 16kg 3 sets of 10").sets, read.sets);
    }

    #[test]
    fn pounds_convert_to_kilograms() {
        let read = exercise("Goblet squat 40 lb 2x8");
        let weight = read.sets[0].weight_kg.unwrap();
        assert!((weight - 18.143_694_8).abs() < 1e-6, "{weight}");
    }

    #[test]
    fn a_held_exercise_takes_a_duration_set() {
        let read = exercise("Plank 60 sec");
        assert_eq!(read.label_key, "plank");
        assert_eq!(
            read.sets,
            vec![PlannedSet {
                reps: None,
                weight_kg: None,
                duration_secs: Some(60.0)
            }]
        );
    }

    #[test]
    fn a_name_alone_is_an_exercise_with_no_sets() {
        let read = exercise("Goblet squat");
        assert!(read.sets.is_empty());
    }

    #[test]
    fn a_rest_line_is_a_rest() {
        assert_eq!(read("Rest 2 min"), PlanLineReading::Rest { secs: 120 });
        assert_eq!(read("Rest 90s"), PlanLineReading::Rest { secs: 90 });
    }

    #[test]
    fn lines_that_name_nothing_in_the_catalogue_stay_notes() {
        assert_eq!(
            read("Mobility 10 min"),
            PlanLineReading::Note("Mobility 10 min".into())
        );
        assert_eq!(
            read("  Zorblax thrusts 3x10 20kg "),
            PlanLineReading::Note("Zorblax thrusts 3x10 20kg".into())
        );
        assert_eq!(read(""), PlanLineReading::Note(String::new()));
        assert_eq!(read("3x10 20kg"), PlanLineReading::Note("3x10 20kg".into()));
    }

    #[test]
    fn an_ambiguous_name_stays_a_note() {
        // Barbell, dumbbell and other benches are equally near "bench".
        assert!(matches!(read("Bench 3x5 60kg"), PlanLineReading::Note(_)));
    }

    #[test]
    fn a_number_that_means_nothing_keeps_the_line_a_note() {
        assert!(matches!(read("Goblet squat 5"), PlanLineReading::Note(_)));
    }

    #[test]
    fn a_read_exercise_becomes_a_prepared_session_exercise() {
        let session = exercise("Goblet squat 16kg 2x10").into_session_exercise();
        assert_eq!(session.sets.len(), 2);
        assert_eq!(session.sets[0].reps, Some(10));
        assert_eq!(session.sets[0].planned_weight_kg, Some(16.0));
        assert!(!session.sets[0].done);
        assert_eq!(
            session.exercise_name,
            catalogue::all()
                .find(|e: &Exercise| e.label_key == "goblet_squat")
                .map(|e| e.name)
        );
    }
}
