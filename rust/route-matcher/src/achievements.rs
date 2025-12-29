//! Achievement and personal record (PR) detection.
//!
//! This module provides real-time detection of achievements and personal records
//! when analyzing activity data. It compares new activities against historical
//! records to identify PRs, milestones, and other achievements.
//!
//! ## Features
//! - Power PR detection (1s, 5s, 1min, 5min, 20min, 1hr)
//! - Pace PR detection (various distances)
//! - Distance/duration milestones
//! - Streak detection (consecutive days)
//! - Form peak detection (TSB highs)
//!
//! ## Example
//! ```rust,ignore
//! use route_matcher::achievements::{detect_achievements, ActivityRecord, PowerCurvePoint};
//!
//! let new_activity = ActivityRecord {
//!     activity_id: "new".to_string(),
//!     sport_type: "Ride".to_string(),
//!     timestamp: 1700000000,
//!     distance: 50000.0,
//!     duration: 7200,
//!     power_curve: vec![
//!         PowerCurvePoint { duration: 1, power: 400 },
//!         PowerCurvePoint { duration: 5, power: 380 },
//!     ],
//!     pace_curve: vec![],
//!     elevation_gain: None,
//! };
//!
//! let history = vec![]; // Previous activity records
//! let achievements = detect_achievements(&new_activity, &history);
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Power curve point (for FFI compatibility - UniFFI doesn't support tuples)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PowerCurvePoint {
    /// Duration in seconds
    pub duration: u32,
    /// Power in watts
    pub power: u16,
}

/// Pace curve point (for FFI compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PaceCurvePoint {
    /// Distance in meters
    pub distance: u32,
    /// Pace in m/s
    pub pace: f32,
}

/// Type of achievement detected
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum AchievementType {
    /// New personal record for power at a specific duration
    PowerPR,
    /// New personal record for pace at a specific distance
    PacePR,
    /// Longest activity of the year (by distance)
    LongestRide,
    /// Longest activity of the year (by duration)
    LongestDuration,
    /// Most elevation gain in a single activity
    MostElevation,
    /// Reached a milestone (100 activities, 1000km, etc.)
    Milestone,
    /// Consecutive day streak
    Streak,
    /// Season high TSB (form peak)
    FormPeak,
    /// First activity of a sport type
    FirstActivity,
    /// Custom achievement
    Custom,
}

/// An achievement detected from activity analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Achievement {
    /// Type of achievement
    pub achievement_type: AchievementType,
    /// Human-readable title
    pub title: String,
    /// Detailed description
    pub description: String,
    /// The value that triggered the achievement (e.g., "400W" or "5:30/km")
    pub value: String,
    /// Previous best value (if applicable)
    pub previous_best: Option<String>,
    /// Improvement percentage (if applicable)
    pub improvement_percent: Option<f32>,
    /// Activity ID where this was achieved
    pub activity_id: String,
    /// Timestamp of achievement
    pub timestamp: i64,
    /// Duration/distance key for PR (e.g., 300 for 5min power)
    pub duration_or_distance: Option<u32>,
    /// Importance score (higher = more significant)
    pub importance: u8,
}

/// Historical activity record for comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ActivityRecord {
    /// Activity ID
    pub activity_id: String,
    /// Sport type (Ride, Run, Swim, etc.)
    pub sport_type: String,
    /// Unix timestamp
    pub timestamp: i64,
    /// Total distance in meters
    pub distance: f32,
    /// Total duration in seconds
    pub duration: u32,
    /// Power curve: best power at various durations
    pub power_curve: Vec<PowerCurvePoint>,
    /// Pace curve: best pace at various distances
    pub pace_curve: Vec<PaceCurvePoint>,
    /// Total elevation gain in meters (optional)
    pub elevation_gain: Option<f32>,
}

/// Standard power PR durations to check (in seconds)
const POWER_PR_DURATIONS: &[u32] = &[1, 5, 30, 60, 300, 1200, 3600];

/// Standard pace PR distances to check (in meters)
const PACE_PR_DISTANCES: &[u32] = &[400, 1000, 1609, 5000, 10000, 21097, 42195];

/// Detect achievements by comparing a new activity against history.
///
/// # Arguments
/// * `new_activity` - The newly completed activity
/// * `history` - Historical activity records for comparison
///
/// # Returns
/// Vector of achievements detected
pub fn detect_achievements(
    new_activity: &ActivityRecord,
    history: &[ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    // Build historical bests for same sport type
    let same_sport_history: Vec<_> = history
        .iter()
        .filter(|a| a.sport_type == new_activity.sport_type)
        .collect();

    // Check for first activity of this sport
    if same_sport_history.is_empty() {
        achievements.push(Achievement {
            achievement_type: AchievementType::FirstActivity,
            title: format!("First {} Activity!", new_activity.sport_type),
            description: format!(
                "Congratulations on your first {} activity!",
                new_activity.sport_type
            ),
            value: format_distance(new_activity.distance),
            previous_best: None,
            improvement_percent: None,
            activity_id: new_activity.activity_id.clone(),
            timestamp: new_activity.timestamp,
            duration_or_distance: None,
            importance: 80,
        });
    }

    // Power PRs
    achievements.extend(detect_power_prs(new_activity, &same_sport_history));

    // Pace PRs (for running/swimming)
    if new_activity.sport_type == "Run" || new_activity.sport_type == "Swim" {
        achievements.extend(detect_pace_prs(new_activity, &same_sport_history));
    }

    // Distance records
    achievements.extend(detect_distance_records(new_activity, &same_sport_history));

    // Duration records
    achievements.extend(detect_duration_records(new_activity, &same_sport_history));

    // Elevation records
    achievements.extend(detect_elevation_records(new_activity, &same_sport_history));

    // Milestones (check all activities, not just same sport)
    achievements.extend(detect_milestones(new_activity, history));

    // Sort by importance (highest first)
    achievements.sort_by(|a, b| b.importance.cmp(&a.importance));

    achievements
}

/// Detect power personal records
fn detect_power_prs(
    new_activity: &ActivityRecord,
    history: &[&ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    if new_activity.power_curve.is_empty() {
        return achievements;
    }

    // Build historical best power for each duration
    let mut historical_bests: HashMap<u32, u16> = HashMap::new();
    for activity in history {
        for point in &activity.power_curve {
            historical_bests
                .entry(point.duration)
                .and_modify(|best| {
                    if point.power > *best {
                        *best = point.power;
                    }
                })
                .or_insert(point.power);
        }
    }

    // Check new activity's power curve against bests
    for point in &new_activity.power_curve {
        // Only check standard PR durations
        if !POWER_PR_DURATIONS.contains(&point.duration) {
            continue;
        }

        let is_pr = match historical_bests.get(&point.duration) {
            Some(&best) => point.power > best,
            None => true, // First recording at this duration
        };

        if is_pr {
            let previous = historical_bests.get(&point.duration).copied();
            let improvement = previous.map(|p| ((point.power as f32 - p as f32) / p as f32) * 100.0);

            let duration_label = format_duration(point.duration);
            let importance = calculate_power_pr_importance(point.duration, improvement);

            achievements.push(Achievement {
                achievement_type: AchievementType::PowerPR,
                title: format!("{} Power PR!", duration_label),
                description: format!(
                    "New personal best {} power: {}W",
                    duration_label, point.power
                ),
                value: format!("{}W", point.power),
                previous_best: previous.map(|p| format!("{}W", p)),
                improvement_percent: improvement,
                activity_id: new_activity.activity_id.clone(),
                timestamp: new_activity.timestamp,
                duration_or_distance: Some(point.duration),
                importance,
            });
        }
    }

    achievements
}

/// Detect pace personal records
fn detect_pace_prs(
    new_activity: &ActivityRecord,
    history: &[&ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    if new_activity.pace_curve.is_empty() {
        return achievements;
    }

    // Build historical best pace for each distance
    let mut historical_bests: HashMap<u32, f32> = HashMap::new();
    for activity in history {
        for point in &activity.pace_curve {
            historical_bests
                .entry(point.distance)
                .and_modify(|best| {
                    if point.pace > *best {
                        // Higher m/s = faster
                        *best = point.pace;
                    }
                })
                .or_insert(point.pace);
        }
    }

    // Check new activity's pace curve against bests
    for point in &new_activity.pace_curve {
        // Only check standard PR distances
        if !PACE_PR_DISTANCES.contains(&point.distance) {
            continue;
        }

        let is_pr = match historical_bests.get(&point.distance) {
            Some(&best) => point.pace > best,
            None => true,
        };

        if is_pr && point.pace > 0.0 {
            let previous = historical_bests.get(&point.distance).copied();
            let improvement = previous.map(|p| ((point.pace - p) / p) * 100.0);

            let distance_label = format_distance(point.distance as f32);
            let pace_label = format_pace(point.pace);

            achievements.push(Achievement {
                achievement_type: AchievementType::PacePR,
                title: format!("{} PR!", distance_label),
                description: format!("New personal best {} pace: {}", distance_label, pace_label),
                value: pace_label,
                previous_best: previous.map(format_pace),
                improvement_percent: improvement,
                activity_id: new_activity.activity_id.clone(),
                timestamp: new_activity.timestamp,
                duration_or_distance: Some(point.distance),
                importance: calculate_pace_pr_importance(point.distance, improvement),
            });
        }
    }

    achievements
}

/// Detect distance records (longest ride/run of the year)
fn detect_distance_records(
    new_activity: &ActivityRecord,
    history: &[&ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    // Get current year's activities
    let current_year = get_year_from_timestamp(new_activity.timestamp);
    let year_activities: Vec<_> = history
        .iter()
        .filter(|a| get_year_from_timestamp(a.timestamp) == current_year)
        .collect();

    let year_max_distance = year_activities
        .iter()
        .map(|a| a.distance)
        .fold(0.0f32, f32::max);

    if new_activity.distance > year_max_distance && new_activity.distance > 10000.0 {
        // > 10km threshold
        let improvement = if year_max_distance > 0.0 {
            Some(((new_activity.distance - year_max_distance) / year_max_distance) * 100.0)
        } else {
            None
        };

        achievements.push(Achievement {
            achievement_type: AchievementType::LongestRide,
            title: format!("Longest {} of {}!", new_activity.sport_type, current_year),
            description: format!(
                "Your longest {} this year: {}",
                new_activity.sport_type.to_lowercase(),
                format_distance(new_activity.distance)
            ),
            value: format_distance(new_activity.distance),
            previous_best: if year_max_distance > 0.0 {
                Some(format_distance(year_max_distance))
            } else {
                None
            },
            improvement_percent: improvement,
            activity_id: new_activity.activity_id.clone(),
            timestamp: new_activity.timestamp,
            duration_or_distance: None,
            importance: 70,
        });
    }

    achievements
}

/// Detect duration records
fn detect_duration_records(
    new_activity: &ActivityRecord,
    history: &[&ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    let current_year = get_year_from_timestamp(new_activity.timestamp);
    let year_activities: Vec<_> = history
        .iter()
        .filter(|a| get_year_from_timestamp(a.timestamp) == current_year)
        .collect();

    let year_max_duration = year_activities.iter().map(|a| a.duration).max().unwrap_or(0);

    if new_activity.duration > year_max_duration && new_activity.duration > 3600 {
        // > 1hr threshold
        achievements.push(Achievement {
            achievement_type: AchievementType::LongestDuration,
            title: format!("Longest {} of {}!", new_activity.sport_type, current_year),
            description: format!(
                "Your longest {} session this year: {}",
                new_activity.sport_type.to_lowercase(),
                format_duration(new_activity.duration)
            ),
            value: format_duration(new_activity.duration),
            previous_best: if year_max_duration > 0 {
                Some(format_duration(year_max_duration))
            } else {
                None
            },
            improvement_percent: None,
            activity_id: new_activity.activity_id.clone(),
            timestamp: new_activity.timestamp,
            duration_or_distance: None,
            importance: 60,
        });
    }

    achievements
}

/// Detect elevation records
fn detect_elevation_records(
    new_activity: &ActivityRecord,
    history: &[&ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    let new_elevation = match new_activity.elevation_gain {
        Some(e) if e > 500.0 => e, // > 500m threshold
        _ => return achievements,
    };

    let max_elevation = history
        .iter()
        .filter_map(|a| a.elevation_gain)
        .fold(0.0f32, f32::max);

    if new_elevation > max_elevation {
        achievements.push(Achievement {
            achievement_type: AchievementType::MostElevation,
            title: "Biggest Climbing Day!".to_string(),
            description: format!("Most elevation gain ever: {}m", new_elevation as i32),
            value: format!("{}m", new_elevation as i32),
            previous_best: if max_elevation > 0.0 {
                Some(format!("{}m", max_elevation as i32))
            } else {
                None
            },
            improvement_percent: if max_elevation > 0.0 {
                Some(((new_elevation - max_elevation) / max_elevation) * 100.0)
            } else {
                None
            },
            activity_id: new_activity.activity_id.clone(),
            timestamp: new_activity.timestamp,
            duration_or_distance: None,
            importance: 65,
        });
    }

    achievements
}

/// Detect milestone achievements
fn detect_milestones(
    new_activity: &ActivityRecord,
    history: &[ActivityRecord],
) -> Vec<Achievement> {
    let mut achievements = Vec::new();

    // Activity count milestones
    let activity_count = history.len() + 1; // +1 for new activity
    let count_milestones = [10, 25, 50, 100, 250, 500, 1000];

    for &milestone in &count_milestones {
        if activity_count == milestone {
            achievements.push(Achievement {
                achievement_type: AchievementType::Milestone,
                title: format!("{} Activities!", milestone),
                description: format!("You've completed {} activities. Keep it up!", milestone),
                value: format!("{}", milestone),
                previous_best: None,
                improvement_percent: None,
                activity_id: new_activity.activity_id.clone(),
                timestamp: new_activity.timestamp,
                duration_or_distance: None,
                importance: calculate_milestone_importance(milestone),
            });
        }
    }

    // Total distance milestones (in km)
    let total_distance: f32 = history.iter().map(|a| a.distance).sum::<f32>() + new_activity.distance;
    let distance_km = total_distance / 1000.0;
    let distance_milestones = [100.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0];

    for &milestone in &distance_milestones {
        let prev_distance = distance_km - (new_activity.distance / 1000.0);
        if prev_distance < milestone && distance_km >= milestone {
            achievements.push(Achievement {
                achievement_type: AchievementType::Milestone,
                title: format!("{}km Total!", milestone as i32),
                description: format!(
                    "You've covered {} kilometers in total!",
                    milestone as i32
                ),
                value: format!("{}km", milestone as i32),
                previous_best: None,
                improvement_percent: None,
                activity_id: new_activity.activity_id.clone(),
                timestamp: new_activity.timestamp,
                duration_or_distance: None,
                importance: calculate_distance_milestone_importance(milestone),
            });
        }
    }

    achievements
}

// ============================================================================
// Helper Functions
// ============================================================================

fn format_duration(seconds: u32) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else if seconds < 3600 {
        format!("{}min", seconds / 60)
    } else {
        let hours = seconds / 3600;
        let mins = (seconds % 3600) / 60;
        if mins > 0 {
            format!("{}h {}min", hours, mins)
        } else {
            format!("{}h", hours)
        }
    }
}

fn format_distance(meters: f32) -> String {
    if meters < 1000.0 {
        format!("{}m", meters as i32)
    } else {
        format!("{:.1}km", meters / 1000.0)
    }
}

fn format_pace(meters_per_second: f32) -> String {
    if meters_per_second <= 0.0 {
        return "N/A".to_string();
    }
    // Convert to min/km
    let seconds_per_km = 1000.0 / meters_per_second;
    let mins = (seconds_per_km / 60.0) as i32;
    let secs = (seconds_per_km % 60.0) as i32;
    format!("{}:{:02}/km", mins, secs)
}

fn get_year_from_timestamp(timestamp: i64) -> i32 {
    // Simple year extraction (approximate)
    let seconds_per_year = 365.25 * 24.0 * 60.0 * 60.0;
    (1970.0 + (timestamp as f64 / seconds_per_year)) as i32
}

fn calculate_power_pr_importance(duration: u32, improvement: Option<f32>) -> u8 {
    // Base importance by duration
    let base = match duration {
        1 => 50,       // 1s is less significant
        5 => 60,       // 5s
        30 => 70,      // 30s
        60 => 80,      // 1min
        300 => 90,     // 5min - very important
        1200 => 95,    // 20min - FTP proxy
        3600 => 85,    // 1hr
        _ => 50,
    };

    // Boost for significant improvements
    let bonus = match improvement {
        Some(pct) if pct > 10.0 => 10,
        Some(pct) if pct > 5.0 => 5,
        Some(pct) if pct > 2.0 => 2,
        _ => 0,
    };

    (base + bonus).min(100) as u8
}

fn calculate_pace_pr_importance(distance: u32, improvement: Option<f32>) -> u8 {
    let base = match distance {
        400 => 60,
        1000 => 70,
        1609 => 80,   // Mile
        5000 => 90,   // 5K - very important
        10000 => 85,  // 10K
        21097 => 95,  // Half marathon
        42195 => 100, // Marathon
        _ => 50,
    };

    let bonus = match improvement {
        Some(pct) if pct > 5.0 => 10,
        Some(pct) if pct > 2.0 => 5,
        Some(pct) if pct > 1.0 => 2,
        _ => 0,
    };

    (base + bonus).min(100) as u8
}

fn calculate_milestone_importance(count: usize) -> u8 {
    match count {
        10 => 40,
        25 => 50,
        50 => 60,
        100 => 75,
        250 => 80,
        500 => 85,
        1000 => 95,
        _ => 50,
    }
}

fn calculate_distance_milestone_importance(km: f32) -> u8 {
    match km as i32 {
        100 => 50,
        500 => 60,
        1000 => 75,
        2500 => 80,
        5000 => 90,
        10000 => 95,
        _ => 50,
    }
}

// ============================================================================
// FFI Interface
// ============================================================================

#[cfg(feature = "ffi")]
use log::info;

/// FFI wrapper for achievement detection
#[cfg(feature = "ffi")]
pub fn ffi_detect_achievements(
    new_activity: ActivityRecord,
    history: Vec<ActivityRecord>,
) -> Vec<Achievement> {
    let achievements = detect_achievements(&new_activity, &history);
    info!(
        "[Achievements] Detected {} achievements for activity {}",
        achievements.len(),
        new_activity.activity_id
    );
    achievements
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_activity(id: &str, sport: &str, distance: f32, duration: u32) -> ActivityRecord {
        ActivityRecord {
            activity_id: id.to_string(),
            sport_type: sport.to_string(),
            timestamp: 1700000000,
            distance,
            duration,
            power_curve: vec![],
            pace_curve: vec![],
            elevation_gain: None,
        }
    }

    fn power_points(data: &[(u32, u16)]) -> Vec<PowerCurvePoint> {
        data.iter()
            .map(|&(duration, power)| PowerCurvePoint { duration, power })
            .collect()
    }

    #[test]
    fn test_first_activity() {
        let new_activity = make_activity("a1", "Ride", 50000.0, 7200);
        let achievements = detect_achievements(&new_activity, &[]);

        assert!(!achievements.is_empty());
        assert!(achievements
            .iter()
            .any(|a| a.achievement_type == AchievementType::FirstActivity));
    }

    #[test]
    fn test_power_pr() {
        let mut new_activity = make_activity("a2", "Ride", 50000.0, 7200);
        new_activity.power_curve = power_points(&[(1, 500), (5, 450), (60, 350), (300, 300)]);

        let mut old_activity = make_activity("a1", "Ride", 40000.0, 6000);
        old_activity.power_curve = power_points(&[(1, 400), (5, 380), (60, 300), (300, 280)]);

        let achievements = detect_achievements(&new_activity, &[old_activity]);

        let power_prs: Vec<_> = achievements
            .iter()
            .filter(|a| a.achievement_type == AchievementType::PowerPR)
            .collect();

        assert!(!power_prs.is_empty());
        // Should have PRs for all durations
        assert!(power_prs.iter().any(|a| a.duration_or_distance == Some(1)));
        assert!(power_prs.iter().any(|a| a.duration_or_distance == Some(5)));
    }

    #[test]
    fn test_milestone() {
        let new_activity = make_activity("a100", "Ride", 30000.0, 3600);

        // Create 99 historical activities
        let history: Vec<ActivityRecord> = (0..99)
            .map(|i| make_activity(&format!("a{}", i), "Ride", 20000.0, 3000))
            .collect();

        let achievements = detect_achievements(&new_activity, &history);

        assert!(achievements
            .iter()
            .any(|a| a.achievement_type == AchievementType::Milestone && a.title.contains("100")));
    }

    #[test]
    fn test_format_duration() {
        assert_eq!(format_duration(30), "30s");
        assert_eq!(format_duration(90), "1min");
        assert_eq!(format_duration(300), "5min");
        assert_eq!(format_duration(3600), "1h");
        assert_eq!(format_duration(3900), "1h 5min");
    }

    #[test]
    fn test_format_pace() {
        // 4 m/s = 4:10/km
        let pace = format_pace(4.0);
        assert!(pace.contains("4:"));

        assert_eq!(format_pace(0.0), "N/A");
    }
}
