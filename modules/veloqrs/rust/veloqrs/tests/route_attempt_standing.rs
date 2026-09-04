//! The Routes tab says where an attempt sits, so the engine has to publish the
//! attempt count and the percentile beside the rank it already computes, over
//! the same population: non-excluded, sport-filtered, with a moving time.

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::{ActivityMetrics, PersistentEngine};

fn make_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| {
            let frac = i as f64 / 200.0;
            GpsPoint::new(
                47.0 + frac * 0.01 + jitter * (i % 3) as f64 * 0.00001,
                7.0 + frac * 0.01 + jitter * (i % 5) as f64 * 0.00001,
            )
        })
        .collect()
}

/// Five activities on one route, moving times 300, 320, 340, 360 and 380 s.
fn engine_with_route(dir: &TempDir) -> (PersistentEngine, String) {
    let path = dir.path().join("standing.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let mut metrics = Vec::new();
    for i in 0..5 {
        let id = format!("activity_{}", i);
        engine
            .add_activity(id.clone(), make_track(i as f64 * 0.5), "Ride".to_string())
            .unwrap();
        let moving_time = 300 + i as u32 * 20;
        metrics.push(ActivityMetrics {
            activity_id: id,
            name: format!("Ride {}", i),
            date: 1_700_000_000 + i as i64 * 86_400,
            distance: 1000.0,
            moving_time,
            elapsed_time: moving_time,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        });
    }
    engine.set_activity_metrics(metrics).unwrap();
    let group_id = engine
        .get_groups()
        .into_iter()
        .max_by_key(|g| g.activity_ids.len())
        .expect("one route group from five overlapping tracks")
        .group_id
        .clone();
    (engine, group_id)
}

#[test]
fn test_get_route_performances_counts_attempts_and_ranks_the_current_one() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_route(&dir);

    let result = engine.get_route_performances(&group_id, Some("activity_0"), None);
    assert_eq!(result.attempt_count, 5);
    // 4 of the 5 are slower
    assert_eq!(result.percentile_rank, Some(80.0));

    let slowest = engine.get_route_performances(&group_id, Some("activity_4"), None);
    assert_eq!(slowest.attempt_count, 5);
    assert_eq!(slowest.percentile_rank, Some(0.0));
}

#[test]
fn test_get_route_performances_drops_an_excluded_attempt() {
    let dir = TempDir::new().unwrap();
    let (mut engine, group_id) = engine_with_route(&dir);

    engine
        .exclude_activity_from_route(&group_id, "activity_4")
        .unwrap();

    let result = engine.get_route_performances(&group_id, Some("activity_0"), None);
    assert_eq!(result.attempt_count, 4);
    // 3 of the remaining 4 are slower
    assert_eq!(result.percentile_rank, Some(75.0));
}

#[test]
fn test_get_route_performances_has_no_percentile_for_an_activity_off_the_route() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_route(&dir);

    let result = engine.get_route_performances(&group_id, Some("activity_elsewhere"), None);
    assert_eq!(result.attempt_count, 5);
    assert_eq!(result.percentile_rank, None);
    assert_eq!(result.current_rank, None);
}

#[test]
fn test_get_route_performances_counts_nothing_for_an_unknown_group() {
    let dir = TempDir::new().unwrap();
    let (engine, _) = engine_with_route(&dir);

    let result = engine.get_route_performances("no_such_group", Some("activity_0"), None);
    assert_eq!(result.attempt_count, 0);
    assert_eq!(result.percentile_rank, None);
}
