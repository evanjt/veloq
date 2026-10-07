//! Scenario: the ranking clamps the signed change into a 0..1 score, so two
//! very different slowdowns score the same.
//! Expected behaviour: the signed fraction travels beside the score, with the
//! comparison it came from, and is absent when nothing was compared.

use std::collections::BTreeMap;

use super::pooled::score_traversals;
use super::{TraversalRow, improvement_signal};
use crate::FfiImprovementBasis;

const SIX: [[f64; 6]; 5] = [
    [100.0, 100.0, 100.0, 86.0, 86.0, 86.0],
    [100.0, 100.0, 100.0, 100.0, 100.0, 100.0],
    [100.0, 100.0, 100.0, 114.0, 114.0, 114.0],
    [100.0, 100.0, 100.0, 250.0, 250.0, 250.0],
    [100.0, 100.0, 100.0, 300.0, 300.0, 300.0],
];

#[test]
fn six_efforts_keep_the_signed_change_the_score_clamps_away() {
    let want = [
        (0.14, 0.57),
        (0.0, 0.5),
        (-0.14, 0.43),
        (-1.5, 0.0),
        (-2.0, 0.0),
    ];
    for (times, (change, score)) in SIX.iter().zip(want) {
        let signal = improvement_signal(times);
        assert!((signal.change.unwrap() - change).abs() < 1e-9, "{times:?}");
        assert!((signal.score - score).abs() < 1e-9, "{times:?}");
        assert_eq!(signal.basis, Some(FfiImprovementBasis::MedianOfThree));
    }
}

#[test]
fn three_to_five_efforts_compare_first_with_last() {
    for times in [vec![100.0, 90.0, 80.0], vec![100.0, 90.0, 95.0, 85.0, 80.0]] {
        let signal = improvement_signal(&times);
        assert!((signal.change.unwrap() - 0.2).abs() < 1e-9);
        assert_eq!(signal.basis, Some(FfiImprovementBasis::FirstToLast));
        assert!((signal.score - 0.6).abs() < 1e-9);
    }
}

#[test]
fn nothing_compared_is_absent_not_zero() {
    for times in [vec![], vec![100.0], vec![100.0, 90.0]] {
        let signal = improvement_signal(&times);
        assert_eq!(signal.change, None);
        assert_eq!(signal.basis, None);
        assert_eq!(signal.score, 0.5);
    }
}

#[test]
fn a_nonpositive_denominator_is_absent() {
    let first_zero = improvement_signal(&[0.0, 90.0, 80.0]);
    let median_zero = improvement_signal(&[0.0, 0.0, 0.0, 80.0, 80.0, 80.0]);
    for signal in [first_zero, median_zero] {
        assert_eq!(signal.change, None);
        assert_eq!(signal.basis, None);
        assert_eq!(signal.score, 0.5);
    }
}

#[test]
fn the_ranked_section_carries_the_change_and_its_basis() {
    let rows = |id: &str, times: &[f64]| -> Vec<TraversalRow> {
        times
            .iter()
            .enumerate()
            .map(|(i, time)| TraversalRow {
                section_id: id.to_string(),
                section_name: id.to_string(),
                lap_time: *time,
                activity_date: 1_700_000_000 + i as i64 * 86_400,
                direction: "same".to_string(),
                activity_id: format!("{id}-{i}"),
            })
            .collect()
    };
    let mut all = rows("slow", &SIX[4]);
    all.extend(rows("short", &[100.0, 90.0]));
    let ranked = score_traversals(all, 10, &BTreeMap::new());
    let find = |id: &str| ranked.iter().find(|r| r.section_id == id).unwrap();
    let slow = find("slow");
    assert!((slow.improvement_change.unwrap() + 2.0).abs() < 1e-9);
    assert_eq!(
        slow.improvement_basis,
        Some(FfiImprovementBasis::MedianOfThree)
    );
    assert_eq!(slow.improvement_score, 0.0);
    let short = find("short");
    assert_eq!(short.improvement_change, None);
    assert_eq!(short.improvement_basis, None);
}
