//! Fuzzy search over the exercise catalogue. A query is split into tokens; every token must
//! match a token of the exercise's label in the athlete's language or its English label.
//! A token matches exactly, as a prefix, or within one edit when it has four or more letters.
//! Results rank by match quality, then by the caller's relevance score, then catalogue order.

use super::catalogue::{self, Exercise};
use std::collections::HashMap;

const EXACT: u32 = 4;
const PREFIX: u32 = 3;
const EDIT: u32 = 2;
const EDIT_PREFIX: u32 = 1;
const MIN_FUZZY_LETTERS: usize = 4;

/// Spoken abbreviations for equipment, tried beside the typed token.
const ABBREVIATIONS: &[(&str, &str)] =
    &[("db", "dumbbell"), ("bb", "barbell"), ("kb", "kettlebell")];

struct Entry {
    exercise: Exercise,
    /// Token lists of the locale's label and of the English label.
    labels: [Vec<String>; 2],
}

/// The catalogue with its labels tokenised, built once per language change.
pub struct ExerciseSearch {
    entries: Vec<Entry>,
}

impl ExerciseSearch {
    /// `labels` maps a catalogue label key to its text in the athlete's language; a key it
    /// lacks is searched by its English label only.
    pub fn new(labels: &HashMap<String, String>) -> Self {
        let entries = catalogue::all()
            .map(|exercise| {
                let english = tokens(&catalogue::english(exercise.label_key));
                let local = labels
                    .get(exercise.label_key)
                    .map(|l| tokens(l))
                    .unwrap_or_default();
                Entry {
                    exercise,
                    labels: [local, english],
                }
            })
            .collect();
        Self { entries }
    }

    /// Label keys best match first. An empty query returns every exercise in relevance order.
    /// `relevance` maps a label key to a score where larger is more relevant; absent is 0.
    pub fn search(&self, query: &str, relevance: &HashMap<String, f64>) -> Vec<&'static str> {
        let wanted = tokens(query);
        let rel = |e: &Entry| relevance.get(e.exercise.label_key).copied().unwrap_or(0.0);
        let mut hits: Vec<(u32, f64, &Entry)> = self
            .entries
            .iter()
            .filter_map(|e| {
                let quality = e
                    .labels
                    .iter()
                    .filter_map(|label| quality(&wanted, label))
                    .max()?;
                Some((quality, rel(e), e))
            })
            .collect();
        // sort_by is stable, so equal pairs keep catalogue order.
        hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_cmp(&a.1)));
        hits.into_iter().map(|h| h.2.exercise.label_key).collect()
    }
}

/// Total match quality of every wanted token against one label, `None` when any token fails.
fn quality(wanted: &[String], label: &[String]) -> Option<u32> {
    let mut total = 0;
    for w in wanted {
        total += token_quality(w, label)?;
    }
    Some(total)
}

fn token_quality(wanted: &str, label: &[String]) -> Option<u32> {
    let expanded = ABBREVIATIONS
        .iter()
        .find(|(a, _)| *a == wanted)
        .map(|(_, full)| *full);
    [Some(wanted), expanded]
        .into_iter()
        .flatten()
        .flat_map(|w| label.iter().filter_map(move |l| match_quality(w, l)))
        .max()
}

fn match_quality(wanted: &str, token: &str) -> Option<u32> {
    if wanted == token {
        return Some(EXACT);
    }
    if token.starts_with(wanted) {
        return Some(PREFIX);
    }
    let w: Vec<char> = wanted.chars().collect();
    if w.len() < MIN_FUZZY_LETTERS {
        return None;
    }
    let t: Vec<char> = token.chars().collect();
    if within_one_edit(&w, &t) {
        return Some(EDIT);
    }
    // A typo inside a typed prefix: compare against the token's heads one shorter, equal and
    // one longer than the query.
    let typo_in_prefix = (w.len() - 1..=w.len() + 1)
        .filter(|&n| n < t.len())
        .any(|n| within_one_edit(&w, &t[..n]));
    typo_in_prefix.then_some(EDIT_PREFIX)
}

/// True when the two differ by at most one insertion, deletion or substitution.
fn within_one_edit(a: &[char], b: &[char]) -> bool {
    if a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    let skip = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let (a, b) = (&a[skip..], &b[skip..]);
    match a.len().cmp(&b.len()) {
        std::cmp::Ordering::Equal => a[1.min(a.len())..] == b[1.min(b.len())..],
        std::cmp::Ordering::Greater => a[1..] == *b,
        std::cmp::Ordering::Less => *a == b[1..],
    }
}

/// Lowercased alphanumeric words with Latin accents folded.
fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.chars().flat_map(char::to_lowercase).map(fold).collect())
        .collect()
}

fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ý' | 'ÿ' => 'y',
        _ => c,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: &str = "incline_dumbbell_bench_press";

    fn english() -> ExerciseSearch {
        ExerciseSearch::new(&HashMap::new())
    }

    /// The athlete does the target most, so it leads among equal matches.
    fn favouring_target() -> HashMap<String, f64> {
        HashMap::from([(TARGET.to_string(), 10.0)])
    }

    #[test]
    fn abbreviation_and_partial_words_find_the_target() {
        let rel = favouring_target();
        assert_eq!(english().search("db incline", &rel)[0], TARGET);
    }

    #[test]
    fn one_typo_finds_the_target() {
        let rel = favouring_target();
        assert_eq!(english().search("incline dumbel", &rel)[0], TARGET);
        assert_eq!(english().search("incline dumbbel", &rel)[0], TARGET);
    }

    #[test]
    fn prefixes_find_the_target() {
        let rel = favouring_target();
        assert_eq!(english().search("bench incl", &rel)[0], TARGET);
    }

    #[test]
    fn two_typos_or_short_token_typos_do_not_match() {
        assert!(
            english()
                .search("inclyne dumbbell xyz", &HashMap::new())
                .is_empty()
        );
        // "bx" is too short to be fuzzy; "bexhx" is two edits from "bench".
        assert!(english().search("bx", &HashMap::new()).is_empty());
        assert!(english().search("bexhx", &HashMap::new()).is_empty());
    }

    #[test]
    fn exact_words_outrank_fuzzy_ones_whatever_the_relevance() {
        let rel = HashMap::from([("incline_dumbbell_flye".to_string(), 99.0)]);
        let hits = english().search("incline dumbbell bench press", &rel);
        assert_eq!(hits[0], TARGET);
    }

    #[test]
    fn a_translated_label_matches_and_so_does_the_english_one() {
        let labels = HashMap::from([(
            TARGET.to_string(),
            "Développé incliné aux haltères".to_string(),
        )]);
        let search = ExerciseSearch::new(&labels);
        let rel = favouring_target();
        assert_eq!(search.search("developpe halteres", &rel)[0], TARGET);
        assert_eq!(search.search("db incline", &rel)[0], TARGET);
    }

    #[test]
    fn empty_query_returns_relevance_order_then_catalogue_order() {
        let rel = HashMap::from([
            ("barbell_bench_press".to_string(), 5.0),
            (TARGET.to_string(), 9.0),
        ]);
        let hits = english().search("  ", &rel);
        assert_eq!(hits.len(), catalogue::all().count());
        assert_eq!(hits[0], TARGET);
        assert_eq!(hits[1], "barbell_bench_press");
        assert_eq!(hits[2], catalogue::all().next().unwrap().label_key);
    }

    #[test]
    fn relevance_breaks_ties_between_equal_matches() {
        let none = english().search("incline dumbbell", &HashMap::new());
        let flye_first = HashMap::from([("incline_dumbbell_flye".to_string(), 1.0)]);
        let hits = english().search("incline dumbbell", &flye_first);
        assert_eq!(hits[0], "incline_dumbbell_flye");
        assert_eq!(hits.len(), none.len());
    }
}
