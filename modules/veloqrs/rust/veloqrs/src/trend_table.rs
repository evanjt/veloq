//! How far each metric has to move before it reads as a move, and which way is
//! better.
//!
//! One table, here, because the same metrics are drawn on the summary card and
//! again on the widget and every threshold was once written out twice with
//! nothing asserting the two agreed. They matched until the card's baselines
//! were fixed and the widget's were not. `src/shared/format/trendTable.generated.ts`
//! is written from this file by `scripts/generate-trend-table.ts`, so the
//! TypeScript copy cannot drift: `npm run audit` fails when it does.
//!
//! The deadband here is **absolute**, in the metric's own units: points of CTL,
//! hours, whole activities, watts, minutes of pace, beats, kilograms. Pace is
//! minutes per kilometre for threshold pace and minutes per 100 m for CSS,
//! the unit each is printed in, and it is pace rather than the critical speed
//! it comes from: a pace that falls is an athlete who got faster.
//! [`crate::trend::classify_change`] takes a **fraction** of the baseline,
//! which is the right shape for a lap time and the wrong one for a weight in
//! kilograms, so the two stay separate and a caller picks the one its metric
//! needs.

/// Which way is better for a metric, or that its direction carries no
/// judgement.
///
/// `None` is a metric with a direction and no verdict: weight, fatigue and form
/// are drawn the way intervals.icu draws them, as a bare arrow on the neutral
/// rung, and form's colour is its zone rather than its move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Polarity {
    Higher,
    Lower,
    None,
}

/// One metric's threshold and polarity.
#[derive(Debug, Clone, Copy)]
pub struct TrendMetric {
    pub name: &'static str,
    pub deadband: f64,
    pub polarity: Polarity,
}

pub const TREND_METRICS: &[TrendMetric] = &[
    // CTL and ATL are integers, so under a point is not a move.
    TrendMetric {
        name: "fitness",
        deadband: 1.0,
        polarity: Polarity::Higher,
    },
    TrendMetric {
        name: "fatigue",
        deadband: 1.0,
        polarity: Polarity::None,
    },
    // Form is a difference of two, so it carries twice the noise.
    TrendMetric {
        name: "form",
        deadband: 2.0,
        polarity: Polarity::None,
    },
    TrendMetric {
        name: "weekHours",
        deadband: 0.5,
        polarity: Polarity::Higher,
    },
    TrendMetric {
        name: "weekCount",
        deadband: 1.0,
        polarity: Polarity::Higher,
    },
    // Kilometres, and load in the server's own points.
    TrendMetric {
        name: "weekDistance",
        deadband: 1.0,
        polarity: Polarity::Higher,
    },
    // Load is fatigue's number, so it moves with no judgement, as fatigue does.
    TrendMetric {
        name: "weekTss",
        deadband: 5.0,
        polarity: Polarity::None,
    },
    // Weighted sets move with no judgement, as load does. The progression
    // surfaces take the engine's own direction, which is past a 15 per cent
    // change of its two-week averages, and read only the polarity from here.
    TrendMetric {
        name: "weekSets",
        deadband: 1.0,
        polarity: Polarity::None,
    },
    TrendMetric {
        name: "ftp",
        deadband: 2.0,
        polarity: Polarity::Higher,
    },
    // Three seconds a kilometre, and three seconds a hundred metres for CSS.
    TrendMetric {
        name: "thresholdPace",
        deadband: 0.05,
        polarity: Polarity::Lower,
    },
    TrendMetric {
        name: "css",
        deadband: 0.05,
        polarity: Polarity::Lower,
    },
    TrendMetric {
        name: "hrv",
        deadband: 2.0,
        polarity: Polarity::Higher,
    },
    TrendMetric {
        name: "rhr",
        deadband: 1.0,
        polarity: Polarity::Lower,
    },
    TrendMetric {
        name: "weight",
        deadband: 0.3,
        polarity: Polarity::None,
    },
];

/// The entry for a metric, or `None` for a name the table does not carry.
/// The glyph a surface draws for a move of `current` against `baseline`, or
/// `None` when there is nothing to compare with.
///
/// Up for an improvement even when the number fell, the bare direction for a
/// metric with no polarity, and always something for a move inside the
/// deadband. This is the judgement itself, so the same arrow reaches a screen,
/// a widget and a notification.
pub fn glyph(name: &str, current: Option<f64>, baseline: Option<f64>) -> Option<String> {
    let (current, baseline) = (current?, baseline?);
    let m = metric(name)?;
    // Inclusive on both sides: a move of exactly the deadband is a move. Note
    // this is the opposite boundary from `trend::classify_change`, which is
    // strict, and the two are not in conflict because they judge different
    // quantities: that one takes a fraction of a baseline, this one takes the
    // metric's own units. The inclusive rule is what the summary card has
    // always drawn, and moving the boundary would silently retract arrows.
    let moved = current - baseline;
    let direction = if moved.abs() < m.deadband {
        0
    } else if moved > 0.0 {
        1
    } else {
        -1
    };
    Some(
        match (direction, m.polarity) {
            (0, _) => "→",
            (_, Polarity::None) if direction > 0 => "↑",
            (1, Polarity::Higher) | (-1, Polarity::Lower) => "↑",
            _ => "↓",
        }
        .to_string(),
    )
}

pub fn metric(name: &str) -> Option<&'static TrendMetric> {
    TREND_METRICS.iter().find(|m| m.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_metric_is_named_once() {
        let mut names: Vec<&str> = TREND_METRICS.iter().map(|m| m.name).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(
            names.len(),
            before,
            "a metric named twice has two thresholds"
        );
    }

    #[test]
    fn no_deadband_is_negative() {
        for m in TREND_METRICS {
            assert!(
                m.deadband >= 0.0 && m.deadband.is_finite(),
                "{} has no usable threshold",
                m.name
            );
        }
    }

    #[test]
    fn weekly_weighted_sets_carry_no_polarity() {
        let m = metric("weekSets").expect("weekSets is in the table");
        assert_eq!(m.polarity, Polarity::None);
        assert_eq!(m.deadband, 1.0);
    }

    #[test]
    fn a_name_the_table_does_not_carry_is_none() {
        assert!(metric("fitness").is_some());
        assert!(metric("not-a-metric").is_none());
    }
}
