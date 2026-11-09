//! Best-window vertical speed, as VAM and as vertical power per kilogram.
//!
//! Elevation is differentiated as given, unsmoothed: a window's figure is its
//! net gain over the seconds it spans. A window that cannot be measured
//! honestly returns no value, so a missing elevation, a short time stream or
//! a pause never reaches a screen as a NaN or an infinity.

/// Standard gravity, so vertical speed in m/s times this is W/kg.
const GRAVITY: f64 = 9.81;

/// The longest step between two samples a window may contain. A longer one is
/// a pause or a dropout, and differencing across it would invent a climb rate.
pub const MAX_STEP_S: u32 = 10;

/// The steepest change in elevation one step may show, in metres per second
/// of the step, up or down. A corrected-elevation track holds single samples
/// that read tens of metres off their neighbours, and a window ending on one
/// would stand as a climbing best of tens of thousands of metres an hour.
/// 5 m/s was measured across 781 Ride and Run activities: it leaves every
/// honest best unchanged at the 90th percentile of each window length and
/// refuses every spike holder. A step at exactly the cap passes. A missing
/// sample leaves the step untested, as the point rule already refuses it.
pub const MAX_STEP_RISE_M_PER_S: f64 = 5.0;

/// The window lengths stored for each climbing activity, in seconds.
pub const CLIMB_WINDOWS_S: [u32; 6] = [15, 30, 60, 300, 600, 1200];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClimbBest {
    pub window_s: u32,
    /// Index of the first sample of the best window, inclusive.
    pub start: usize,
    /// Index of the last sample of the best window, inclusive.
    pub end: usize,
    /// Vertical metres per hour.
    pub vam: f64,
    pub watts_per_kg: f64,
}

/// Vertical power per kilogram at a climb rate of `vam` metres per hour. The
/// mass cancels, so it needs no weight.
pub fn watts_per_kg_of_vam(vam: f64) -> f64 {
    vam / 3600.0 * GRAVITY
}

/// The best window of each requested length, in the order requested.
///
/// A window is the shortest run of samples spanning at least its length. It
/// gives `None` when the two slices differ in length, when the track is
/// shorter than the window, or when every candidate holds a missing or
/// non-finite elevation, a non-increasing time, a step over [`MAX_STEP_S`] or a step steeper than
/// [`MAX_STEP_RISE_M_PER_S`].
pub fn best_climb_windows(
    time: &[u32],
    elevation: &[Option<f64>],
    windows: &[u32],
) -> Vec<Option<ClimbBest>> {
    if time.len() != elevation.len() || time.len() < 2 {
        return vec![None; windows.len()];
    }
    let n = time.len();
    let mut bad_steps = vec![0usize; n];
    let mut bad_points = vec![0usize; n + 1];
    for i in 0..n {
        bad_points[i + 1] = bad_points[i] + usize::from(!elevation[i].is_some_and(f64::is_finite));
        if i + 1 < n {
            let mut ok = time[i + 1] > time[i] && time[i + 1] - time[i] <= MAX_STEP_S;
            if let (true, Some(a), Some(b)) = (ok, elevation[i], elevation[i + 1]) {
                let seconds = f64::from(time[i + 1] - time[i]);
                ok = (b - a).abs() / seconds <= MAX_STEP_RISE_M_PER_S;
            }
            bad_steps[i + 1] = bad_steps[i] + usize::from(!ok);
        }
    }
    // bad_steps[k] counts bad steps among the steps ending at samples 1..=k.
    windows
        .iter()
        .map(|&w| best_for_window(time, elevation, &bad_steps, &bad_points, w))
        .collect()
}

fn best_for_window(
    time: &[u32],
    elevation: &[Option<f64>],
    bad_steps: &[usize],
    bad_points: &[usize],
    window_s: u32,
) -> Option<ClimbBest> {
    if window_s == 0 {
        return None;
    }
    let n = time.len();
    let mut best: Option<ClimbBest> = None;
    let mut j = 0usize;
    for i in 0..n {
        if j < i {
            j = i;
        }
        while j < n && time[j].saturating_sub(time[i]) < window_s {
            j += 1;
        }
        if j >= n {
            break;
        }
        if time[j] <= time[i] || bad_points[j + 1] - bad_points[i] != 0 {
            continue;
        }
        if bad_steps[j] - bad_steps[i] != 0 {
            continue;
        }
        let (Some(lo), Some(hi)) = (elevation[i], elevation[j]) else {
            continue;
        };
        let seconds = f64::from(time[j] - time[i]);
        let speed = (hi - lo) / seconds;
        if !speed.is_finite() {
            continue;
        }
        let vam = speed * 3600.0;
        if best.is_none_or(|b| vam > b.vam) {
            best = Some(ClimbBest {
                window_s,
                start: i,
                end: j,
                vam,
                watts_per_kg: watts_per_kg_of_vam(vam),
            });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u32) -> Vec<u32> {
        (0..n).collect()
    }

    fn track(f: impl Fn(u32) -> f64, n: u32) -> Vec<Option<f64>> {
        (0..n).map(|t| Some(f(t))).collect()
    }

    #[test]
    fn steady_climb_gives_the_hand_computed_vam() {
        // 0.5 m/s is 1800 m/h and 4.905 W/kg.
        let time = secs(120);
        let elev = track(|t| 100.0 + 0.5 * f64::from(t), 120);
        let best = best_climb_windows(&time, &elev, &[15, 60])[0].unwrap();
        assert!((best.vam - 1800.0).abs() < 1e-9);
        assert!((best.watts_per_kg - 4.905).abs() < 1e-9);
        assert_eq!(best.end - best.start, 15);
    }

    #[test]
    fn hill_rep_between_flats_is_found_and_dilutes_over_a_longer_window() {
        // Flat, a 15 s rep of 10 m from t=40, flat after.
        let time = secs(120);
        let elev = track(
            |t| match t {
                0..=40 => 0.0,
                41..=55 => 10.0 * f64::from(t - 40) / 15.0,
                _ => 10.0,
            },
            120,
        );
        let out = best_climb_windows(&time, &elev, &[15, 60]);
        let short = out[0].unwrap();
        assert_eq!((short.start, short.end), (40, 55));
        assert!((short.vam - 10.0 / 15.0 * 3600.0).abs() < 1e-6);
        let long = out[1].unwrap();
        assert!((long.vam - 10.0 / 60.0 * 3600.0).abs() < 1e-6);
        assert!(long.vam < short.vam);
    }

    #[test]
    fn flat_track_gives_zero() {
        let out = best_climb_windows(&secs(60), &track(|_| 50.0, 60), &[15]);
        let best = out[0].unwrap();
        assert_eq!(best.vam, 0.0);
        assert_eq!(best.watts_per_kg, 0.0);
    }

    #[test]
    fn empty_short_and_mismatched_inputs_give_none() {
        assert_eq!(best_climb_windows(&[], &[], &[15]), vec![None]);
        assert_eq!(
            best_climb_windows(&secs(10), &track(|_| 0.0, 10), &[15]),
            vec![None]
        );
        assert_eq!(
            best_climb_windows(&secs(60), &track(|_| 0.0, 59), &[15]),
            vec![None]
        );
        assert_eq!(
            best_climb_windows(&secs(60), &track(|_| 0.0, 60), &[0]),
            vec![None]
        );
    }

    #[test]
    fn missing_elevation_inside_a_window_rules_it_out() {
        let time = secs(40);
        let mut elev = track(f64::from, 40);
        elev[20] = None;
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        // Only windows clear of index 20 remain.
        assert!(best.end < 20 || best.start > 20);
        let all_missing = vec![None; 40];
        assert_eq!(best_climb_windows(&time, &all_missing, &[15]), vec![None]);
    }

    #[test]
    fn non_finite_elevation_never_reaches_the_result() {
        let time = secs(40);
        let mut elev = track(f64::from, 40);
        elev[5] = Some(f64::NAN);
        elev[30] = Some(f64::INFINITY);
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!(best.vam.is_finite() && best.watts_per_kg.is_finite());
        assert!(best.end < 5 || (best.start > 5 && best.end < 30));
    }

    #[test]
    fn a_pause_is_not_differenced_across() {
        // 20 s of flat, a 600 s pause during which the rider climbs 100 m, flat again.
        let mut time: Vec<u32> = (0..20).collect();
        time.extend(620..640);
        let mut elev = track(|_| 0.0, 20);
        elev.extend(track(|_| 100.0, 20));
        let best = best_climb_windows(&time, &elev, &[15, 60])[0].unwrap();
        assert_eq!(best.vam, 0.0);
        assert_eq!(best_climb_windows(&time, &elev, &[60]), vec![None]);
    }

    #[test]
    fn non_increasing_time_rules_a_window_out() {
        let mut time = secs(40);
        time[20] = time[19];
        let elev = track(f64::from, 40);
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!(best.end < 20 || best.start >= 20);
        let backwards: Vec<u32> = (0..40).rev().collect();
        assert_eq!(best_climb_windows(&backwards, &elev, &[15]), vec![None]);
    }

    #[test]
    fn a_pause_on_the_last_step_is_not_differenced_across() {
        // 20 s of flat at 100 m, then a 31 s gap to a final sample at 150 m.
        let mut time = secs(20);
        time.push(50);
        let mut elev = track(|_| 100.0, 20);
        elev.push(Some(150.0));
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert_eq!(best.vam, 0.0);
        assert!(best.end < 20);
    }

    #[test]
    fn a_last_step_that_stalls_or_goes_backwards_rules_out_windows_ending_on_it() {
        for last in [19, 10] {
            let mut time = secs(20);
            time.push(last);
            let mut elev = track(|_| 100.0, 20);
            elev.push(Some(150.0));
            let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
            assert_eq!(best.vam, 0.0, "last time {last}");
            assert!(best.end < 20, "last time {last}");
        }
    }

    #[test]
    fn a_valid_last_step_still_counts() {
        // Flat to t=19, then a 5 m rise, the steepest a step may be, on the final step.
        let time = secs(21);
        let mut elev = track(|_| 100.0, 20);
        elev.push(Some(105.0));
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert_eq!((best.start, best.end), (5, 20));
        assert!((best.vam - 5.0 / 15.0 * 3600.0).abs() < 1e-9);
    }

    #[test]
    fn a_window_may_span_samples_unevenly_spaced_within_the_step_limit() {
        let time: Vec<u32> = (0..30).map(|i| i * 5).collect();
        let elev: Vec<Option<f64>> = time.iter().map(|&t| Some(f64::from(t) * 0.1)).collect();
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!((best.vam - 360.0).abs() < 1e-9);
    }

    fn clean_climb(n: u32) -> Vec<Option<f64>> {
        track(|t| 100.0 + 0.5 * f64::from(t), n)
    }

    #[test]
    fn one_raised_sample_sets_no_best() {
        let time = secs(240);
        let mut elev = clean_climb(240);
        elev[100] = elev[100].map(|e| e + 40.0);
        let out = best_climb_windows(&time, &elev, &[15, 30, 60]);
        for (best, w) in out.iter().zip([15u32, 30, 60]) {
            let best = best.unwrap();
            assert!((best.vam - 1800.0).abs() < 1e-9, "{w} s best {}", best.vam);
            assert!(
                best.end < 100 || best.start > 100,
                "{w} s window holds the spike"
            );
        }
    }

    #[test]
    fn a_step_at_the_start_does_not_set_the_best() {
        let time = secs(60);
        let elev = track(
            |t| {
                if t == 0 {
                    100.0
                } else {
                    141.0 + 0.5 * f64::from(t)
                }
            },
            60,
        );
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!((best.vam - 1800.0).abs() < 1e-9);
        assert!(best.start >= 1);
    }

    #[test]
    fn a_step_at_exactly_the_cap_passes() {
        let time = secs(30);
        let elev = track(|t| MAX_STEP_RISE_M_PER_S * f64::from(t), 30);
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!((best.vam - MAX_STEP_RISE_M_PER_S * 3600.0).abs() < 1e-6);
    }

    #[test]
    fn honest_one_metre_steps_over_three_seconds_are_unchanged() {
        let time: Vec<u32> = (0..40).map(|i| i * 3).collect();
        let elev = track(f64::from, 40);
        let best = best_climb_windows(&time, &elev, &[15])[0].unwrap();
        assert!((best.vam - 1200.0).abs() < 1e-6);
    }
}
