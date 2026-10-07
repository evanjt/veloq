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
        .iter()
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

fn engine_with_attempts(
    dir: &TempDir,
    attempts: &[(u32, &str, bool)],
) -> (PersistentEngine, String) {
    let path = dir.path().join("attempts.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let metrics: Vec<_> = attempts
        .iter()
        .enumerate()
        .map(|(i, &(moving_time, sport, reverse))| {
            let id = format!("attempt_{i}");
            let mut track = make_track(0.0);
            if reverse {
                track.reverse();
            }
            engine
                .add_activity(id.clone(), track, sport.to_string())
                .unwrap();
            ActivityMetrics {
                activity_id: id,
                name: format!("Attempt {i}"),
                date: 1_700_000_000 + i as i64 * 86_400,
                distance: 1000.0,
                moving_time,
                elapsed_time: moving_time,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: sport.to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }
        })
        .collect();
    engine.set_activity_metrics(metrics).unwrap();
    let group_id = engine
        .get_groups()
        .iter()
        .max_by_key(|g| g.activity_ids.len())
        .unwrap()
        .group_id
        .clone();
    (engine, group_id)
}

#[test]
fn test_route_standing_separates_directions_and_prefers_forward_best() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_attempts(
        &dir,
        &[
            (600, "Ride", false),
            (610, "Ride", false),
            (620, "Ride", false),
            (630, "Ride", false),
            (640, "Ride", false),
            (540, "Ride", true),
        ],
    );
    let forward = engine.get_route_performances(&group_id, Some("attempt_0"), None);
    assert_eq!(forward.performances.len(), 6);
    assert_eq!(forward.best.as_ref().unwrap().activity_id, "attempt_0");
    assert_eq!(
        forward.current_direction_best.as_ref().unwrap().activity_id,
        "attempt_0"
    );
    assert_eq!(forward.current_rank, Some(1));
    assert_eq!(forward.attempt_count, 5);
    assert_eq!(forward.percentile_rank, Some(80.0));

    let reverse = engine.get_route_performances(&group_id, Some("attempt_5"), None);
    assert_eq!(reverse.current_rank, None);
    assert_eq!(
        reverse.current_direction_best.as_ref().unwrap().activity_id,
        "attempt_5"
    );
    assert_eq!(reverse.attempt_count, 1);
    assert_eq!(reverse.percentile_rank, None);
}

#[test]
fn test_route_standing_excludes_untimed_attempt_and_ties_from_first_rank() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_attempts(
        &dir,
        &[
            (0, "Ride", false),
            (612, "Ride", false),
            (612, "Ride", false),
            (620, "Ride", false),
            (630, "Ride", false),
        ],
    );
    let untimed = engine.get_route_performances(&group_id, Some("attempt_0"), None);
    assert_eq!(untimed.current_rank, None);
    assert_eq!(untimed.attempt_count, 4);
    let tied = engine.get_route_performances(&group_id, Some("attempt_1"), None);
    assert_ne!(tied.current_rank, Some(1));
    assert!(tied.current_rank.unwrap() <= tied.attempt_count);
}

#[test]
fn test_route_standing_separates_sports() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_attempts(
        &dir,
        &[
            (720, "Ride", false),
            (1500, "Run", false),
            (1470, "Run", false),
        ],
    );
    let run = engine.get_route_performances(&group_id, Some("attempt_2"), None);
    assert_eq!(run.attempt_count, 2);
    assert_eq!(run.current_rank, Some(1));
    assert_eq!(run.best.as_ref().unwrap().activity_id, "attempt_2");
    let unfiltered = engine.get_route_performances(&group_id, None, None);
    assert!(unfiltered.best.is_none());
    assert!(unfiltered.best_forward.is_none());
    assert!(unfiltered.best_reverse.is_none());
}

/// A first outing in a new sport has no rival, so it has no rank, and the
/// ride's faster time is not its best.
#[test]
fn test_route_standing_gives_a_lone_first_outing_in_a_sport_no_rank() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) =
        engine_with_attempts(&dir, &[(720, "Ride", false), (1500, "Run", false)]);
    let run = engine.get_route_performances(&group_id, Some("attempt_1"), None);
    assert_eq!(run.attempt_count, 1);
    assert_eq!(run.current_rank, None);
    assert_eq!(run.best.as_ref().unwrap().activity_id, "attempt_1");
}

#[test]
fn test_route_standing_ignores_an_attempt_without_distance() {
    let dir = TempDir::new().unwrap();
    let (mut engine, group_id) =
        engine_with_attempts(&dir, &[(300, "Ride", false), (320, "Ride", false)]);
    let mut invalid = engine
        .get_route_performances(&group_id, Some("attempt_0"), None)
        .activity_metrics
        .into_iter()
        .find(|m| m.activity_id == "attempt_0")
        .unwrap();
    invalid.distance = 0.0;
    engine.set_activity_metrics(vec![invalid]).unwrap();
    let result = engine.get_route_performances(&group_id, Some("attempt_0"), None);
    assert_eq!(result.attempt_count, 1);
    assert_eq!(result.current_rank, None);
    assert_eq!(result.best.as_ref().unwrap().activity_id, "attempt_1");
}

#[test]
fn test_reverse_only_route_still_has_a_best() {
    let dir = TempDir::new().unwrap();
    let (mut engine, group_id) =
        engine_with_attempts(&dir, &[(610, "Ride", false), (600, "Ride", true)]);
    engine
        .exclude_activity_from_route(&group_id, "attempt_0")
        .unwrap();
    let result = engine.get_route_performances(&group_id, Some("attempt_1"), None);
    assert_eq!(result.best.as_ref().unwrap().activity_id, "attempt_1");
    assert!(result.best_forward.is_none());
    assert_eq!(
        result.best_reverse.as_ref().unwrap().activity_id,
        "attempt_1"
    );
}

#[test]
fn test_single_sport_route_read_without_an_activity_has_both_bests() {
    let dir = TempDir::new().unwrap();
    let (engine, group_id) = engine_with_attempts(
        &dir,
        &[
            (610, "Ride", false),
            (600, "Ride", false),
            (590, "Ride", true),
            (580, "Ride", true),
            (0, "Run", false),
        ],
    );
    let result = engine.get_route_performances(&group_id, None, None);
    assert_eq!(result.best.as_ref().unwrap().activity_id, "attempt_1");
    assert_eq!(
        result.best_forward.as_ref().unwrap().activity_id,
        "attempt_1"
    );
    assert_eq!(
        result.best_reverse.as_ref().unwrap().activity_id,
        "attempt_3"
    );
    assert_eq!(result.current_rank, None);
}
