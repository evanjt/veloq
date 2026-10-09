use super::*;

fn correlation(result: FfiCorrelation) -> FfiSectionCorrelation {
    let family_size = u32::from(has_estimate(&result));
    FfiSectionCorrelation {
        direction: "same".to_string(),
        variable: "hrv".to_string(),
        result,
        family_size,
    }
}

/// One direction's rows, each carrying the family size the engine would give
/// them: how many of the rows carry an estimate.
fn panel(results: Vec<FfiCorrelation>) -> Vec<FfiSectionCorrelation> {
    let family_size = results.iter().filter(|r| has_estimate(r)).count() as u32;
    results
        .into_iter()
        .map(|result| FfiSectionCorrelation {
            family_size,
            ..correlation(result)
        })
        .collect()
}

#[test]
fn test_db_path_requires_explicit_database() {
    assert!(db_path(None).is_err());
    assert!(db_path(Some(String::new())).is_err());
    assert_eq!(
        db_path(Some("library.db".to_string())),
        Ok("library.db".to_string())
    );
}

#[test]
fn a_well_formed_panel_has_no_violations() {
    let panel = panel(vec![
        FfiCorrelation::Mover {
            r: 0.6,
            n: 10,
            low: 0.1,
            high: 0.9,
        },
        FfiCorrelation::Inconclusive {
            r: 0.2,
            n: 12,
            low: -0.3,
            high: 0.6,
        },
        // Excludes zero on its own interval but not across the family.
        FfiCorrelation::Inconclusive {
            r: 0.45,
            n: 20,
            low: 0.01,
            high: 0.74,
        },
        FfiCorrelation::TooFew { n: 4 },
    ]);
    assert!(violations(&panel).is_empty());
}

#[test]
fn a_family_size_that_is_not_the_estimate_count_is_named() {
    let mut panel = panel(vec![
        FfiCorrelation::Inconclusive {
            r: 0.2,
            n: 12,
            low: -0.3,
            high: 0.6,
        },
        FfiCorrelation::TooFew { n: 4 },
    ]);
    for row in &mut panel {
        row.family_size = 2;
    }
    assert_eq!(violations(&panel).len(), 2);
}

#[test]
fn estimates_that_break_the_rules_are_named() {
    let panel = panel(vec![
        FfiCorrelation::Mover {
            r: 0.9,
            n: 9,
            low: 0.1,
            high: 0.99,
        },
        FfiCorrelation::Mover {
            r: 0.3,
            n: 20,
            low: -0.1,
            high: 0.6,
        },
        FfiCorrelation::Inconclusive {
            r: 0.5,
            n: 8,
            low: -0.2,
            high: 0.8,
        },
    ]);
    assert_eq!(violations(&panel).len(), 3);
}

#[test]
fn totals_place_each_read_in_one_bucket() {
    let mut totals = Totals::default();
    totals.add(
        "a",
        &[correlation(FfiCorrelation::Mover {
            r: 0.6,
            n: 10,
            low: 0.1,
            high: 0.9,
        })],
    );
    totals.add("b", &[correlation(FfiCorrelation::TooFew { n: 3 })]);
    totals.add("c", &[]);
    assert_eq!(
        (
            totals.reads,
            totals.any_mover,
            totals.only_unshown,
            totals.no_variable
        ),
        (3, 1, 1, 1)
    );
}
