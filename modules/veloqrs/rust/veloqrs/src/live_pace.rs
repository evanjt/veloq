//! The pace a live recording shows, announces and speaks: one rule, read by
//! the data tiles, the stats row, the notification, the split banner and the
//! spoken split.

use crate::widget_snapshot::{format_pace_compact, format_swim_pace, pace_seconds};

/// A speed as the pace its sport reads, with the seconds behind it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLivePace {
    /// The pace with its unit, or `--:--` where the speed has no pace.
    pub text: String,
    /// Seconds per kilometre, or per mile when imperial, for a pace that is not
    /// a swim's. `None` for a swim, and where the speed has no pace.
    pub seconds: Option<f64>,
}

/// The pace for a speed in metres per second: per 100 m or 100 yd for a swim,
/// per kilometre or mile for every other sport, and no sport reads per
/// kilometre.
pub fn live_pace(
    meters_per_second: f64,
    activity_type: Option<&str>,
    is_metric: bool,
) -> FfiLivePace {
    if activity_type.is_some_and(crate::sport::is_swimming) {
        let unit = if is_metric { "/100m" } else { "/100yd" };
        let value = format_swim_pace(meters_per_second, is_metric);
        let text = if value == NO_PACE {
            value
        } else {
            format!("{value} {unit}")
        };
        return FfiLivePace {
            text,
            seconds: None,
        };
    }
    let seconds = pace_seconds(meters_per_second, is_metric);
    let text = match seconds {
        Some(_) => format!(
            "{} {}",
            format_pace_compact(meters_per_second, is_metric),
            if is_metric { "/km" } else { "/mi" }
        ),
        None => NO_PACE.to_string(),
    };
    FfiLivePace { text, seconds }
}

const NO_PACE: &str = "--:--";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_reads_per_kilometre_and_per_mile() {
        let metric = live_pace(3.0, Some("Run"), true);
        assert_eq!(metric.text, "5:33 /km");
        assert!((metric.seconds.unwrap() - 1000.0 / 3.0).abs() < 1e-9);
        let imperial = live_pace(3.0, Some("Run"), false);
        assert_eq!(imperial.text, "8:56 /mi");
    }

    #[test]
    fn a_swim_reads_per_hundred_with_no_seconds() {
        let metric = live_pace(0.8333, Some("OpenWaterSwim"), true);
        assert_eq!(metric.text, "2:00 /100m");
        assert_eq!(metric.seconds, None);
        assert_eq!(live_pace(0.8333, Some("Swim"), false).text, "1:50 /100yd");
    }

    #[test]
    fn a_ride_or_no_sport_reads_per_kilometre() {
        assert_eq!(live_pace(3.0, Some("Ride"), true).text, "5:33 /km");
        assert_eq!(live_pace(3.0, None, true).text, "5:33 /km");
    }

    #[test]
    fn a_stopped_or_missing_speed_has_no_pace() {
        for sport in [Some("Run"), Some("Swim"), None] {
            for speed in [0.0, -1.0, f64::NAN, f64::INFINITY, 1e-9] {
                let pace = live_pace(speed, sport, true);
                assert_eq!(pace.text, "--:--", "{sport:?} {speed}");
                assert_eq!(pace.seconds, None, "{sport:?} {speed}");
            }
        }
    }
}
