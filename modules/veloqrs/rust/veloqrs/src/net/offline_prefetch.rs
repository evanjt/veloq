//! The power and pace curve windows and keys the sync sweeps.
//!
//! Every sync asks for each key at each window, so the stats and fitness
//! screens read their curves from storage whatever range they open on.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_all_time_window_is_requested_as_all_and_the_rest_as_days() {
        assert_eq!(curve_window(ALL_TIME_CURVE_DAYS), "all");
        assert_eq!(curve_window(90), "90d");
        assert_eq!(curve_window(365), "365d");
    }
}
