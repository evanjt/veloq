use super::*;

fn correlation(result: FfiCorrelation) -> FfiSectionCorrelation {
    FfiSectionCorrelation {
        direction: "same".to_string(),
        variable: "hrv".to_string(),
        result,
    }
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
    let panel = [
        correlation(FfiCorrelation::Mover {
            r: 0.6,
            n: 10,
            low: 0.1,
            high: 0.9,
        }),
        correlation(FfiCorrelation::Inconclusive {
            r: 0.2,
            n: 12,
            low: -0.3,
            high: 0.6,
        }),
        correlation(FfiCorrelation::TooFew { n: 4 }),
    ];
    assert!(violations(&panel).is_empty());
}

#[test]
fn estimates_that_break_the_rules_are_named() {
    let panel = [
        correlation(FfiCorrelation::Mover {
            r: 0.9,
            n: 9,
            low: 0.1,
            high: 0.99,
        }),
        correlation(FfiCorrelation::Mover {
            r: 0.3,
            n: 20,
            low: -0.1,
            high: 0.6,
        }),
        correlation(FfiCorrelation::Inconclusive {
            r: 0.5,
            n: 20,
            low: 0.1,
            high: 0.8,
        }),
    ];
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
