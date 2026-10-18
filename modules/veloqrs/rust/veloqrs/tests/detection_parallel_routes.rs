//! One detect over rides between two parallel routes mints one section per
//! piece of ground, whatever the longitude alignment of the routes.

use super::lifecycle_support::*;

use tracematch::GpsPoint;
use tracematch::scenarios::LifecycleActivity;

const T0: i64 = 1_700_000_000;
const DAY: i64 = 86_400;
const BASE_LAT: f64 = 46.0;

fn rides(tag: &str, base_lon: f64, east_m: f64, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    let metres_per_degree = 111_320.0 * BASE_LAT.to_radians().cos();
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            let points = (0..=200)
                .map(|step| GpsPoint {
                    latitude: BASE_LAT + step as f64 * 10.0 / 111_320.0,
                    longitude: base_lon + (east_m + jitter) / metres_per_degree,
                    elevation: Some(500.0),
                })
                .collect();
            LifecycleActivity {
                id: format!("{tag}_{i:02}"),
                sport_type: "Ride".to_string(),
                start_date_unix: T0 + (day0 + i as i64) * DAY,
                gps_points: points,
            }
        })
        .collect()
}

/// Scenario: two 9-ride routes 70 m apart and 24 rides midway, in one detect.
/// Expected behaviour: no two sections share both members and ground, at any
/// longitude alignment.
#[test]
fn rides_between_parallel_routes_never_mint_twin_sections() {
    let _serial_state = super::serial_state();
    for step in 0..40 {
        let base_lon = 7.10 + step as f64 * 0.000_05;
        let left = rides("left", base_lon, 0.0, 9, 10);
        let right = rides("right", base_lon, 70.0, 9, 30);
        let middle = rides("middle", base_lon, 35.0, 24, 50);
        let (mut engine, _dir) = fresh_engine();
        let mut routes = refs(&left);
        routes.extend(refs(&right));
        ingest_step(&mut engine, "routes", &routes);
        ingest_step(&mut engine, "between", &refs(&middle));
        settle_to_detector(&mut engine, 8);
        let snap = snapshot(&mut engine);
        let sections: Vec<_> = snap.sections.iter().collect();
        for (i, (id_a, a)) in sections.iter().enumerate() {
            for (id_b, b) in &sections[i + 1..] {
                assert!(
                    !(a.activity_ids == b.activity_ids && ground_matches(a, b)),
                    "step {step}: {id_a} and {id_b} share {} members and their ground, of {} sections",
                    a.activity_ids.len(),
                    sections.len()
                );
            }
        }
    }
}
