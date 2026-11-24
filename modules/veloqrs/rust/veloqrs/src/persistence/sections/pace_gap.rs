//! A speed difference restated as pace seconds in both unit systems, so the
//! front end writes "12 s /km off the record" from what it is given.

use crate::FfiPaceGap;
use crate::widget_snapshot::{KM_TO_MI, MAX_PACE_SECONDS, YARDS_100_IN_METRES};

/// The pace difference between a slower and a faster speed, in metres per
/// second. `None` for a sport whose speed does not read as a pace, and where
/// either speed has no pace.
pub(crate) fn pace_gap(slower: f64, faster: f64, sport: &str) -> Option<FfiPaceGap> {
    if crate::sport::is_swimming(sport) {
        // A swim pace is read in whole seconds, so each is rounded before they
        // are subtracted.
        let per_100 = |distance: f64, speed: f64| {
            let seconds = (distance / speed).round();
            (speed.is_finite() && speed > 0.0 && seconds <= MAX_PACE_SECONDS).then_some(seconds)
        };
        return Some(FfiPaceGap {
            metric: per_100(100.0, slower)? - per_100(100.0, faster)?,
            imperial: per_100(YARDS_100_IN_METRES, slower)? - per_100(YARDS_100_IN_METRES, faster)?,
        });
    }
    if !crate::sport::shows_pace(sport) {
        return None;
    }
    let (metric_slower, metric_faster) = (per_km(slower)?, per_km(faster)?);
    Some(FfiPaceGap {
        metric: metric_slower - metric_faster,
        imperial: metric_slower / KM_TO_MI - metric_faster / KM_TO_MI,
    })
}

/// Seconds per kilometre, `None` where the speed has no pace.
fn per_km(speed: f64) -> Option<f64> {
    if !speed.is_finite() || speed <= 0.0 {
        return None;
    }
    let seconds = 1000.0 / speed;
    (seconds.is_finite() && seconds <= MAX_PACE_SECONDS).then_some(seconds)
}

/// Each point's gap to the record as a pace difference: the point's own speed
/// against the record's, which is `record_gap_speed` faster.
pub(crate) fn stamp_point_gaps(points: &mut [crate::FfiSectionChartPoint], sport: Option<&str>) {
    let Some(sport) = sport else {
        return;
    };
    for point in points {
        point.record_gap_pace = point
            .record_gap_speed
            .and_then(|gap| pace_gap(point.speed, point.speed + gap, sport));
    }
}

/// Each step's gain on the step before as a pace difference.
pub(crate) fn stamp_step_gains(steps: &mut [crate::FfiRecordStep], sport: Option<&str>) {
    let Some(sport) = sport else {
        return;
    };
    for step in steps {
        step.improvement_pace = step
            .improvement_speed
            .and_then(|gain| pace_gap(step.speed - gain, step.speed, sport));
    }
}

#[cfg(test)]
#[path = "tests/pace_gap.rs"]
mod tests;
