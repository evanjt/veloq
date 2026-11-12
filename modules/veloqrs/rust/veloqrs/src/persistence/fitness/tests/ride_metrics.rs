//! Scenario: a ride's streams and the athlete's thresholds go in.
//!
//! Expected behaviour: normalised power, intensity, load, zone seconds,
//! efficiency factor and decoupling come out as the formulas give them, and a
//! figure the streams cannot give is absent rather than zero.

use super::*;

const FTP: f64 = 250.0;

fn judged() -> Judged {
    Judged {
        ftp: Some(FTP),
        threshold_hr: Some(170.0),
        max_hr: Some(190.0),
        resting_hr: Some(50.0),
        threshold_pace: None,
    }
}

fn run(seconds: usize, speed: f64) -> Samples {
    Samples {
        time: (0..seconds).map(|s| s as f64).collect(),
        watts: Vec::new(),
        heart_rate: Vec::new(),
        speed: vec![Some(speed); seconds],
    }
}

fn ride(seconds: usize, watts: impl Fn(usize) -> f64, hr: impl Fn(usize) -> f64) -> Samples {
    Samples {
        time: (0..seconds).map(|s| s as f64).collect(),
        watts: (0..seconds).map(|s| Some(watts(s))).collect(),
        heart_rate: (0..seconds).map(|s| Some(hr(s))).collect(),
        speed: Vec::new(),
    }
}

fn near(got: Option<f64>, want: f64) {
    let got = got.expect("a figure");
    assert!(
        (got - want).abs() < 1e-6 * want.abs().max(1.0),
        "{got} != {want}"
    );
}

#[test]
fn an_hour_at_ftp_is_a_hundred_load_at_intensity_one() {
    let m = compute(&ride(3600, |_| FTP, |_| 150.0), &judged());
    near(m.normalised_power, FTP);
    near(m.intensity, 1.0);
    near(m.training_load, 100.0);
    assert_eq!(m.load_basis, Some(LoadBasis::Power));
}

#[test]
fn surges_lift_normalised_power_above_average_power() {
    let steady = compute(&ride(1800, |_| 200.0, |_| 140.0), &judged());
    let surging = compute(
        &ride(
            1800,
            |s| if (s / 30) % 2 == 0 { 350.0 } else { 50.0 },
            |_| 140.0,
        ),
        &judged(),
    );
    near(steady.normalised_power, 200.0);
    assert!(surging.normalised_power.unwrap() > 200.0);
}

#[test]
fn a_ride_without_power_takes_its_load_from_threshold_heart_rate() {
    let samples = Samples {
        time: (0..3600).map(f64::from).collect(),
        watts: Vec::new(),
        heart_rate: vec![Some(170.0); 3600],
        speed: Vec::new(),
    };
    let m = compute(&samples, &judged());
    near(m.training_load, 100.0);
    assert_eq!(m.load_basis, Some(LoadBasis::HeartRate));
    assert_eq!(m.intensity, None);
    assert_eq!(m.normalised_power, None);
    assert_eq!(m.efficiency_factor, None);
    assert_eq!(m.power_zone_seconds, None);
    assert_eq!(m.hr_zone_seconds.map(|z| z.iter().sum::<u32>()), Some(3600));
}

#[test]
fn heart_rate_load_grows_with_effort_and_time() {
    let at = |hr: f64, secs| {
        compute(
            &Samples {
                time: (0..secs).map(|s| s as f64).collect(),
                watts: Vec::new(),
                heart_rate: vec![Some(hr); secs],
                speed: Vec::new(),
            },
            &judged(),
        )
        .training_load
        .unwrap()
    };
    assert!(at(150.0, 3600) < at(170.0, 3600));
    assert!(at(170.0, 1800) < at(170.0, 3600));
}

#[test]
fn a_ride_with_neither_stream_gets_nothing() {
    let samples = Samples {
        time: (0..600).map(f64::from).collect(),
        watts: Vec::new(),
        heart_rate: Vec::new(),
        speed: Vec::new(),
    };
    assert_eq!(compute(&samples, &judged()), RideMetrics::default());
}

#[test]
fn without_thresholds_the_figures_that_need_them_are_absent() {
    let m = compute(&ride(600, |_| 200.0, |_| 140.0), &Judged::default());
    assert_eq!(m.training_load, None);
    assert_eq!(m.intensity, None);
    assert_eq!(m.power_zone_seconds, None);
    assert_eq!(m.hr_zone_seconds, None);
    near(m.normalised_power, 200.0);
}

#[test]
fn zone_seconds_follow_percent_of_ftp_bounds() {
    // 100 W is 40 % of FTP (zone 1), 200 W is 80 % (zone 3), 400 W is 160 % (zone 7).
    let m = compute(
        &ride(
            90,
            |s| match s / 30 {
                0 => 100.0,
                1 => 200.0,
                _ => 400.0,
            },
            |_| 140.0,
        ),
        &judged(),
    );
    assert_eq!(m.power_zone_seconds, Some([30, 0, 30, 0, 0, 0, 30]));
}

#[test]
fn a_reading_on_a_zone_bound_belongs_to_the_zone_it_closes() {
    let m = compute(&ride(60, |_| FTP * 0.55, |_| 140.0), &judged());
    assert_eq!(m.power_zone_seconds, Some([60, 0, 0, 0, 0, 0, 0]));
}

#[test]
fn efficiency_factor_is_normalised_power_over_average_heart_rate() {
    let m = compute(&ride(1200, |_| 200.0, |_| 125.0), &judged());
    near(m.efficiency_factor, 200.0 / 125.0);
}

#[test]
fn decoupling_is_the_fall_in_efficiency_from_the_first_half_to_the_second() {
    // The first half runs 200 W at 100 bpm, the second 200 W at 125 bpm.
    let m = compute(
        &ride(1200, |_| 200.0, |s| if s < 600 { 100.0 } else { 125.0 }),
        &judged(),
    );
    // EF 2.0 then 1.6.
    near(m.decoupling, 20.0);
    let level = compute(&ride(1200, |_| 200.0, |_| 125.0), &judged());
    near(level.decoupling, 0.0);
}

#[test]
fn a_pause_is_not_counted_as_riding_time() {
    let mut samples = ride(1800, |_| FTP, |_| 150.0);
    // Ten minutes the recorder was stopped.
    for t in samples.time.iter_mut().skip(900) {
        *t += 600.0;
    }
    let m = compute(&samples, &judged());
    near(m.training_load, 50.0);
}

#[test]
fn a_ride_shorter_than_the_rolling_window_has_no_normalised_power() {
    let m = compute(&ride(20, |_| FTP, |_| 150.0), &judged());
    assert_eq!(m.normalised_power, None);
    assert_eq!(m.intensity, None);
    assert_eq!(m.load_basis, Some(LoadBasis::HeartRate));
}

#[test]
fn an_hour_at_threshold_pace_with_no_heart_rate_or_power_is_a_hundred_load() {
    let judged = Judged {
        threshold_pace: Some(3.5),
        ..Judged::default()
    };
    let m = compute(&run(3600, 3.5), &judged);
    near(m.training_load, 100.0);
    assert_eq!(m.load_basis, Some(LoadBasis::Pace));
    assert_eq!(m.intensity, None);
}

#[test]
fn pace_load_grows_with_the_square_of_speed_and_with_time() {
    let judged = Judged {
        threshold_pace: Some(4.0),
        ..Judged::default()
    };
    near(compute(&run(1800, 4.0), &judged).training_load, 50.0);
    near(compute(&run(3600, 2.0), &judged).training_load, 25.0);
}

#[test]
fn a_run_with_no_threshold_pace_or_no_speed_has_no_load() {
    assert_eq!(
        compute(&run(3600, 3.5), &Judged::default()).training_load,
        None
    );
    let judged = Judged {
        threshold_pace: Some(3.5),
        ..Judged::default()
    };
    let still = Samples {
        speed: Vec::new(),
        ..run(3600, 3.5)
    };
    assert_eq!(compute(&still, &judged).training_load, None);
}

#[test]
fn heart_rate_and_power_loads_come_before_the_pace_load() {
    let judged = Judged {
        threshold_pace: Some(3.5),
        ..judged()
    };
    let mut samples = ride(3600, |_| FTP, |_| 150.0);
    samples.speed = vec![Some(3.5); 3600];
    assert_eq!(
        compute(&samples, &judged).load_basis,
        Some(LoadBasis::Power)
    );
    samples.watts.clear();
    samples.heart_rate = vec![Some(170.0); 3600];
    assert_eq!(
        compute(&samples, &judged).load_basis,
        Some(LoadBasis::HeartRate)
    );
}
