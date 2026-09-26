//! The insights bundle pairs every section summary with each sport that
//! travels it, so a section shared by a run and a ride holds a record in each.
//!
//! Scenario: an athlete with fourteen sports and 152 sections opens Insights.
//! Expected behaviour: the pairing is one pass over the summary list, not one
//! database read per sport. Asking per sport re-runs the whole summary query
//! fourteen times and discards thirteen of the results, which was measured at
//! a third of the bundle.
//!
//! Run: `cargo test --test insights_summary_fanout -p veloqrs`

use veloqrs::persistence::sections::summaries_by_sport;
use veloqrs::{PersistentEngine, SectionSummary};

fn summary(id: &str, sport: &str, also: &[&str], outings: u32, visits: u32) -> SectionSummary {
    let mut s = SectionSummary::default();
    s.id = id.to_string();
    s.sport_type = sport.to_string();
    s.sport_types = also.iter().map(|t| t.to_string()).collect();
    s.activity_count = outings;
    s.visit_count = visits;
    s
}

fn sports(names: &[&str]) -> Vec<String> {
    names.iter().map(|n| n.to_string()).collect()
}

fn pairs(got: &[(String, SectionSummary)]) -> Vec<(&str, &str)> {
    got.iter()
        .map(|(sport, s)| (sport.as_str(), s.id.as_str()))
        .collect()
}

#[test]
fn a_section_is_paired_with_every_sport_that_travels_it() {
    let summaries = vec![summary("shared", "Run", &["Run", "Ride"], 5, 9)];

    let got = summaries_by_sport(&summaries, &sports(&["Run", "Ride", "Swim"]), 3);

    assert_eq!(pairs(&got), vec![("Run", "shared"), ("Ride", "shared")]);
}

#[test]
fn a_section_below_the_outing_floor_earns_no_pair() {
    let summaries = vec![
        summary("returned", "Run", &["Run"], 3, 3),
        summary("once", "Run", &["Run"], 2, 2),
    ];

    let got = summaries_by_sport(&summaries, &sports(&["Run"]), 3);

    assert_eq!(pairs(&got), vec![("Run", "returned")]);
}

#[test]
fn the_most_travelled_section_comes_first() {
    let summaries = vec![
        summary("quiet", "Run", &["Run"], 3, 4),
        summary("busy", "Run", &["Run"], 3, 40),
        summary("middling", "Run", &["Run"], 3, 12),
    ];

    let got = summaries_by_sport(&summaries, &sports(&["Run"]), 3);

    assert_eq!(
        pairs(&got),
        vec![("Run", "busy"), ("Run", "middling"), ("Run", "quiet")]
    );
}

#[test]
fn a_sport_nothing_travels_contributes_nothing() {
    let summaries = vec![summary("hill", "Ride", &["Ride"], 4, 6)];

    let got = summaries_by_sport(&summaries, &sports(&["Run", "Swim"]), 3);

    assert!(got.is_empty(), "got {:?}", pairs(&got));
}

/// The rewrite has to pair exactly what asking the database per sport paired,
/// so the two are run against one populated library and compared.
#[test]
fn the_one_pass_pairing_matches_what_asking_per_sport_produced() {
    let tmp = tempfile::TempDir::new().expect("temp dir");
    let path = tmp.path().join("fanout.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let raw = rusqlite::Connection::open(&path).expect("raw open");

    // Three sports, a section each, one shared by two, and one that has been
    // visited once so it sits under the returning floor. `sport_types` is the
    // denormalised comma-separated list the junction triggers keep.
    for (sport, id, outings, visits, kinds) in [
        ("Run", "sec_track", 9, 30, "Run"),
        ("Ride", "sec_hill", 4, 6, "Ride"),
        ("Ride", "sec_shared", 5, 12, "Ride,Run"),
        ("Swim", "sec_once", 1, 1, "Swim"),
    ] {
        raw.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version, activity_count,
                                   visit_count, sport_types)
             VALUES (?1, 'auto', ?1, ?2, '[]', 400.0, 0, 1, ?3, ?4, ?5)",
            rusqlite::params![id, sport, outings, visits, kinds],
        )
        .expect("insert section");
        // The sport list comes from `activity_metrics`, not from `sections`.
        raw.execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                           elapsed_time, elevation_gain, sport_type)
             VALUES (?1, ?1, 1700000000, 1000.0, 300, 300, 10.0, ?2)",
            rusqlite::params![format!("act_{id}"), sport],
        )
        .expect("insert activity metrics");
    }

    let available = engine.get_available_sport_types();
    assert!(
        available.len() >= 3,
        "the comparison is worthless with one sport, got {available:?}"
    );

    let per_sport: Vec<(String, SectionSummary)> = available
        .iter()
        .flat_map(|sport| {
            engine
                .get_section_summaries_for_sport(sport)
                .into_iter()
                .map(move |s| (sport.clone(), s))
        })
        .filter(|(_, s)| s.activity_count >= 3)
        .collect();
    let mut per_sport = per_sport;
    per_sport.sort_by_key(|(_, s)| std::cmp::Reverse(s.visit_count));

    let one_pass = summaries_by_sport(&engine.get_section_summaries(), &available, 3);

    assert!(
        pairs(&one_pass).contains(&("Run", "sec_shared")),
        "the shared section must reach both its sports, got {:?}",
        pairs(&one_pass)
    );
    assert!(
        !pairs(&one_pass).contains(&("Swim", "sec_once")),
        "a section visited once is under the returning floor"
    );
    assert_eq!(pairs(&one_pass), pairs(&per_sport));
}
