//! What `writeRecordingFit` pays in the engine for a long ride.
//!
//! The save tap is a one-shot call on the JS thread with a 200 ms budget. This
//! feeds the writer the same arrays the JSI call carries, at one sample a
//! second, for one, three and six hours, and reports the mean and p95 of the
//! engine leg. The JS leg that builds the arrays is not in this number.
//!
//! Ignored by default. Run it in release, since a debug build says nothing
//! about the phone's release engine:
//! `cargo test --release --bench recording_fit_write_cost -p veloqrs -- --ignored --nocapture`

use std::time::Instant;

use veloqrs::fit_recording::{FfiRecordingFit, FfiRecordingLap, FfiRecordingStreams};

const HOURS: &[usize] = &[1, 3, 6];
const RUNS: usize = 30;

fn ride(points: usize) -> FfiRecordingFit {
    let at = |f: &dyn Fn(usize) -> f64| (0..points).map(f).collect::<Vec<f64>>();
    let laps = (0..points / 1800)
        .map(|n| FfiRecordingLap {
            start_time: (n * 1800) as f64,
            end_time: ((n + 1) * 1800) as f64,
            moving_end_time: ((n + 1) * 1800) as f64,
            distance: 14_400.0,
            avg_speed: 8.0,
            avg_heartrate: Some(140.0),
            avg_power: Some(200.0),
            avg_cadence: Some(90.0),
        })
        .collect();
    FfiRecordingFit {
        activity_type: "Ride".to_string(),
        start_unix_millis: 1_768_471_200_000.0,
        streams: FfiRecordingStreams {
            time: at(&|i| i as f64),
            latitude: at(&|i| 46.5 + i as f64 * 0.00001),
            longitude: at(&|i| 6.6 + i as f64 * 0.00001),
            altitude: at(&|i| 420.0 + (i % 50) as f64),
            heartrate: at(&|_| 140.0),
            power: (0..points).map(|i| Some((i % 300) as f64)).collect(),
            cadence: at(&|_| 90.0),
            speed: at(&|_| 8.0),
            distance: at(&|i| i as f64 * 8.0),
        },
        laps,
        paused_seconds: 0.0,
    }
}

#[test]
#[ignore = "measurement harness; run it deliberately"]
fn what_the_fit_write_costs_over_a_long_ride() {
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    for hours in HOURS {
        let points = hours * 3600;
        let recording = ride(points);
        let mut millis: Vec<f64> = (0..RUNS)
            .map(|_| {
                let start = Instant::now();
                let file = recording.to_fit();
                std::hint::black_box(&file);
                start.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        millis.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mean = millis.iter().sum::<f64>() / RUNS as f64;
        let p95 = millis[(RUNS * 95 / 100).min(RUNS - 1)];

        let file = recording.to_fit();
        let records = fitparser::from_bytes(&file)
            .expect("the file decodes")
            .iter()
            .filter(|r| r.kind() == fitparser::profile::MesgNum::Record)
            .count();
        assert_eq!(records, points);
        println!(
            "{build} {hours} h: {points} records, {} bytes, mean {mean:.2} ms, p95 {p95:.2} ms",
            file.len()
        );
    }
}
