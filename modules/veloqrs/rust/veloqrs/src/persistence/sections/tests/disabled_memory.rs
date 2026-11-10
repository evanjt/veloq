//! A removed section is held in memory only while it is enabled, the same rule
//! `load_sections` applies at startup. Every write that refreshes one section
//! goes through `refresh_section_in_memory`, so that refresh must drop the
//! in-memory copy of a disabled row rather than append it. Otherwise the attach
//! matcher keeps writing junction rows on a section the athlete removed.

use super::indicator_refresh::library;

const SECTION: &str = "auto-line";

fn listed(engine: &crate::PersistentEngine) -> bool {
    engine.get_sections().iter().any(|s| s.id == SECTION)
}

#[test]
fn an_exclude_on_a_removed_section_keeps_it_out_of_memory() {
    let mut engine = library(true);
    assert!(listed(&engine), "the detected section starts in memory");

    engine.disable_section(SECTION).unwrap();
    engine
        .exclude_activity_from_section(SECTION, "tempo")
        .unwrap();

    assert!(!listed(&engine));
}

#[test]
fn an_include_on_a_removed_section_keeps_it_out_of_memory() {
    let mut engine = library(true);
    engine.disable_section(SECTION).unwrap();

    engine
        .include_activity_in_section(SECTION, "tempo")
        .unwrap();

    assert!(!listed(&engine));
}

#[test]
fn enabling_a_removed_section_puts_it_back_in_memory() {
    let mut engine = library(true);
    engine.disable_section(SECTION).unwrap();
    assert!(!listed(&engine));

    engine.enable_section(SECTION).unwrap();

    assert!(listed(&engine));
}
