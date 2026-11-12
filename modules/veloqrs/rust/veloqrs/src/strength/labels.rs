//! The athlete's exercise labels: one table handed in per language change, held with the
//! search built over it. `catalogue::display_name` and the exercise search both read it, so
//! a name and a search hit never disagree about the language.

use super::exercise_search::ExerciseSearch;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// A label table with the search built over it.
pub struct ExerciseLabels {
    table: HashMap<String, String>,
    search: ExerciseSearch,
}

impl ExerciseLabels {
    pub fn new(table: HashMap<String, String>) -> Self {
        let search = ExerciseSearch::new(&table);
        Self { table, search }
    }

    /// The label for a catalogue key, when the table holds one.
    pub fn label(&self, key: &str) -> Option<&str> {
        self.table.get(key).map(String::as_str)
    }

    pub fn search(&self, query: &str, relevance: &HashMap<String, f64>) -> Vec<&'static str> {
        self.search.search(query, relevance)
    }
}

static CURRENT: RwLock<Option<Arc<ExerciseLabels>>> = RwLock::new(None);

/// Replaces the held table. Called once per language change.
pub fn install(table: HashMap<String, String>) {
    let labels = Arc::new(ExerciseLabels::new(table));
    *CURRENT.write().unwrap_or_else(|p| p.into_inner()) = Some(labels);
}

fn current() -> Option<Arc<ExerciseLabels>> {
    CURRENT.read().unwrap_or_else(|p| p.into_inner()).clone()
}

/// The held label for a key, `None` until a table is installed or when it lacks the key.
pub fn label(key: &str) -> Option<String> {
    current()?.label(key).map(str::to_string)
}

/// Search over the held table, or over English labels alone before one is installed.
pub fn search(query: &str, relevance: &HashMap<String, f64>) -> Vec<&'static str> {
    match current() {
        Some(labels) => labels.search(query, relevance),
        None => ExerciseSearch::new(&HashMap::new()).search(query, relevance),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: &str = "incline_dumbbell_bench_press";

    fn french() -> HashMap<String, String> {
        HashMap::from([(
            TARGET.to_string(),
            "Développé incliné aux haltères".to_string(),
        )])
    }

    #[test]
    fn a_handed_table_ranks_the_target_first_for_an_abbreviated_query() {
        let labels = ExerciseLabels::new(french());
        let rel = HashMap::from([(TARGET.to_string(), 10.0)]);
        assert_eq!(labels.search("db incline", &rel)[0], TARGET);
        assert_eq!(labels.search("developpe halteres", &rel)[0], TARGET);
    }

    #[test]
    fn the_label_is_the_handed_text_and_a_missing_key_has_none() {
        let labels = ExerciseLabels::new(french());
        assert_eq!(labels.label(TARGET), Some("Développé incliné aux haltères"));
        assert_eq!(labels.label("barbell_bench_press"), None);
    }

    #[test]
    fn installing_replaces_the_table_and_display_names_follow_it() {
        let key = "abs_jabs";
        let (category, name) = super::super::catalogue::all()
            .find(|e| e.label_key == key)
            .map(|e| (e.category, e.name))
            .unwrap();
        install(HashMap::from([(
            key.to_string(),
            "Coups d abdos".to_string(),
        )]));
        assert_eq!(
            super::super::catalogue::display_name(category, name).as_deref(),
            Some("Coups d abdos")
        );
        install(HashMap::new());
        assert_eq!(
            super::super::catalogue::display_name(category, name).as_deref(),
            Some("Abs Jabs")
        );
    }
}
