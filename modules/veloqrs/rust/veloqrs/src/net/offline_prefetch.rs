//! Making a date range available offline.
//!
//! Every window the UI can ask for is otherwise fetched only when it is
//! opened, so an athlete who wants their season on a plane has to open every
//! screen at every range by hand and hope each one lands. This is the pass
//! that asks for the lot, and the estimate the athlete is shown before they
//! start it.

use crate::persistence::bodies::CurveKind;

/// The windows read by the stats and fitness screens.
pub(crate) const CURVE_DAYS: &[i64] = &[7, 30, 42, 90, 180, 365, ALL_TIME_CURVE_DAYS];

/// The window value that stands for the whole history. It is the stored key
/// for the all-time curve and is sent upstream as `all`, not as a day count.
pub(crate) const ALL_TIME_CURVE_DAYS: i64 = 0;

/// The `curves` spec for a window: `all` for the whole history, `{days}d`
/// otherwise.
pub(crate) fn curve_window(days: i64) -> String {
    if days == ALL_TIME_CURVE_DAYS {
        "all".to_string()
    } else {
        format!("{days}d")
    }
}

#[derive(Clone, Copy)]
pub(crate) struct CurveKey {
    pub kind: CurveKind,
    pub sport: &'static str,
    pub gap: bool,
}

pub(crate) const CURVE_KEYS: &[CurveKey] = &[
    CurveKey {
        kind: CurveKind::Power,
        sport: "Ride",
        gap: false,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Run",
        gap: false,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Run",
        gap: true,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Swim",
        gap: false,
    },
];

/// What a range costs to make available offline.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OfflineEstimate {
    /// Activities stored in the range, which is what the per-activity terms
    /// scale on.
    pub activities: u32,
    /// Their moving seconds, which is what the byte figure scales on.
    pub moving_seconds: u64,
    /// Requests the pass will make.
    pub requests: u32,
    /// Bytes it will pull, as response bodies.
    pub bytes: u64,
}

/// Requests that do not scale with the range: the athlete, sport settings, a
/// wellness year, an events year, and every screen-read curve key and window.
const CONSTANT_REQUESTS: u32 = 4 + (CURVE_KEYS.len() * CURVE_DAYS.len()) as u32;
/// Their bodies together, measured once each.
const CONSTANT_BYTES: u64 = 600_000;

/// Streams, body and intervals, per activity.
const REQUESTS_PER_ACTIVITY: u32 = 3;
/// The activity summary list, which is one request however wide the range is.
const SUMMARY_LIST_REQUESTS: u32 = 1;
/// What one activity adds to that list, at `ACTIVITY_FIELDS` with the stats
/// extra: 1,449,898 bytes over the 318 activities measured.
const SUMMARY_BYTES_PER_ACTIVITY: u64 = 4_560;

/// Bytes per moving second.
///
/// The figure is per second rather than per activity because per activity it
/// is out by fifty-fold: across the fourteen-activity sample an 18 s ride cost
/// 5 KB and an 887 s swim 97 KB, while bytes per moving second held to about a
/// third of this figure either way. Streams are sampled per second, so the
/// second is what the payload is actually made of.
const BYTES_PER_MOVING_SECOND: u64 = 60;

/// What `activities` activities carrying `moving_seconds` between them cost.
///
/// Split out from the database read so the arithmetic can be checked against
/// the measured table without a library to read it from.
pub fn estimate_range(activities: u32, moving_seconds: u64) -> OfflineEstimate {
    OfflineEstimate {
        activities,
        moving_seconds,
        requests: CONSTANT_REQUESTS + SUMMARY_LIST_REQUESTS + REQUESTS_PER_ACTIVITY * activities,
        bytes: CONSTANT_BYTES
            + SUMMARY_BYTES_PER_ACTIVITY * activities as u64
            + BYTES_PER_MOVING_SECOND * moving_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_all_time_window_is_requested_as_all_and_the_rest_as_days() {
        assert_eq!(curve_window(ALL_TIME_CURVE_DAYS), "all");
        assert_eq!(curve_window(90), "90d");
        assert_eq!(curve_window(365), "365d");
    }

    #[test]
    fn a_range_with_nothing_in_it_still_costs_the_constants() {
        let estimate = estimate_range(0, 0);
        assert_eq!(estimate.requests, 33);
        assert_eq!(estimate.bytes, 600_000);
    }

    #[test]
    fn a_month_of_the_measured_library_is_the_order_the_surface_will_show() {
        // 35 activities, about 43 hours moving.
        let estimate = estimate_range(35, 43 * 3_600);
        assert_eq!(estimate.requests, 138);
        assert_eq!(estimate.bytes / 1_000_000, 10);
    }
}
