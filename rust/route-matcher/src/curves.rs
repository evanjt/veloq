//! Power and pace curve computation for performance analysis.
//!
//! This module provides efficient computation of power curves (best average power
//! for various durations) and pace curves (best average pace for various distances).
//!
//! ## Features
//! - Power curve computation with sliding window optimization
//! - Pace curve computation for running/swimming
//! - Support for multiple activities (all-time bests)
//! - Parallel processing for large datasets
//!
//! ## Example
//! ```rust
//! use route_matcher::curves::{compute_power_curve, PowerCurve};
//!
//! let power_data = vec![200, 250, 300, 280, 260, 240, 220, 200, 190, 180];
//! let durations = vec![1, 5, 10]; // seconds
//! let curve = compute_power_curve(&power_data, &durations);
//! println!("Best 5s power: {}W", curve.get_power_at(5).unwrap_or(0.0));
//! ```

use serde::{Deserialize, Serialize};

#[cfg(feature = "parallel")]
use rayon::prelude::*;

/// Standard power curve durations in seconds
pub const STANDARD_POWER_DURATIONS: &[u32] = &[
    1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200,
];

/// Standard pace curve distances in meters
pub const STANDARD_PACE_DISTANCES: &[f32] = &[
    100.0, 200.0, 400.0, 800.0, 1000.0, 1609.34, 5000.0, 10000.0, 21097.0, 42195.0,
];

/// Standard swim pace curve distances in meters
pub const STANDARD_SWIM_DISTANCES: &[f32] = &[25.0, 50.0, 100.0, 200.0, 400.0, 800.0, 1500.0];

/// A single point on a power or pace curve
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct CurvePoint {
    /// Duration in seconds (for power) or distance in meters (for pace)
    pub x: f32,
    /// Power in watts (for power curve) or pace in m/s (for pace curve)
    pub y: f32,
    /// Activity ID where this best was achieved (optional)
    pub activity_id: Option<String>,
    /// Timestamp when this best was achieved (optional)
    pub timestamp: Option<i64>,
}

/// Result of power curve computation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PowerCurve {
    /// Points on the curve (duration → best power)
    pub points: Vec<CurvePoint>,
    /// Durations that were computed (in seconds)
    pub durations: Vec<u32>,
    /// Total activities analyzed
    pub activities_analyzed: u32,
}

impl PowerCurve {
    /// Get the best power at a specific duration
    pub fn get_power_at(&self, duration_seconds: u32) -> Option<f32> {
        self.points
            .iter()
            .find(|p| (p.x as u32) == duration_seconds)
            .map(|p| p.y)
    }

    /// Get the activity ID where the best was achieved at a duration
    pub fn get_activity_at(&self, duration_seconds: u32) -> Option<&str> {
        self.points
            .iter()
            .find(|p| (p.x as u32) == duration_seconds)
            .and_then(|p| p.activity_id.as_deref())
    }
}

/// Result of pace curve computation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PaceCurve {
    /// Points on the curve (distance → best pace)
    pub points: Vec<CurvePoint>,
    /// Distances that were computed (in meters)
    pub distances: Vec<f32>,
    /// Total activities analyzed
    pub activities_analyzed: u32,
}

impl PaceCurve {
    /// Get the best pace at a specific distance (in m/s)
    pub fn get_pace_at(&self, distance_meters: f32) -> Option<f32> {
        self.points
            .iter()
            .find(|p| (p.x - distance_meters).abs() < 1.0)
            .map(|p| p.y)
    }

    /// Convert pace to min/km at a specific distance
    pub fn get_pace_min_km(&self, distance_meters: f32) -> Option<f32> {
        self.get_pace_at(distance_meters)
            .map(|ms| if ms > 0.0 { 1000.0 / ms / 60.0 } else { 0.0 })
    }
}

/// Compute power curve from a single activity's power data.
///
/// Uses an optimized sliding window algorithm for O(n) complexity per duration.
///
/// # Arguments
/// * `power_data` - Slice of power values in watts (1Hz sampling assumed)
/// * `durations` - Durations to compute (in seconds)
///
/// # Returns
/// Power curve with best average power for each duration
pub fn compute_power_curve(power_data: &[u16], durations: &[u32]) -> PowerCurve {
    if power_data.is_empty() {
        return PowerCurve {
            points: durations
                .iter()
                .map(|&d| CurvePoint {
                    x: d as f32,
                    y: 0.0,
                    activity_id: None,
                    timestamp: None,
                })
                .collect(),
            durations: durations.to_vec(),
            activities_analyzed: 0,
        };
    }

    let points: Vec<CurvePoint> = durations
        .iter()
        .map(|&duration| {
            let best = compute_best_avg_power(power_data, duration as usize);
            CurvePoint {
                x: duration as f32,
                y: best,
                activity_id: None,
                timestamp: None,
            }
        })
        .collect();

    PowerCurve {
        points,
        durations: durations.to_vec(),
        activities_analyzed: 1,
    }
}

/// Compute best average power for a given window size using sliding window.
fn compute_best_avg_power(power_data: &[u16], window_size: usize) -> f32 {
    if window_size == 0 || power_data.len() < window_size {
        return 0.0;
    }

    // Initial window sum
    let mut window_sum: u64 = power_data[..window_size].iter().map(|&p| p as u64).sum();
    let mut best_sum = window_sum;

    // Slide the window
    for i in window_size..power_data.len() {
        window_sum = window_sum + power_data[i] as u64 - power_data[i - window_size] as u64;
        if window_sum > best_sum {
            best_sum = window_sum;
        }
    }

    best_sum as f32 / window_size as f32
}

/// Compute power curve from multiple activities (all-time bests).
///
/// # Arguments
/// * `activities` - Vec of (activity_id, power_data, timestamp) tuples
/// * `durations` - Durations to compute (in seconds)
///
/// # Returns
/// Power curve with all-time best average power for each duration
pub fn compute_power_curve_multi(
    activities: &[(String, Vec<u16>, i64)],
    durations: &[u32],
) -> PowerCurve {
    if activities.is_empty() {
        return PowerCurve {
            points: durations
                .iter()
                .map(|&d| CurvePoint {
                    x: d as f32,
                    y: 0.0,
                    activity_id: None,
                    timestamp: None,
                })
                .collect(),
            durations: durations.to_vec(),
            activities_analyzed: 0,
        };
    }

    // Track best for each duration
    let mut best_points: Vec<CurvePoint> = durations
        .iter()
        .map(|&d| CurvePoint {
            x: d as f32,
            y: 0.0,
            activity_id: None,
            timestamp: None,
        })
        .collect();

    for (activity_id, power_data, timestamp) in activities {
        for (i, &duration) in durations.iter().enumerate() {
            let avg = compute_best_avg_power(power_data, duration as usize);
            if avg > best_points[i].y {
                best_points[i].y = avg;
                best_points[i].activity_id = Some(activity_id.clone());
                best_points[i].timestamp = Some(*timestamp);
            }
        }
    }

    PowerCurve {
        points: best_points,
        durations: durations.to_vec(),
        activities_analyzed: activities.len() as u32,
    }
}

/// Compute power curve from multiple activities using parallel processing.
#[cfg(feature = "parallel")]
pub fn compute_power_curve_multi_parallel(
    activities: &[(String, Vec<u16>, i64)],
    durations: &[u32],
) -> PowerCurve {
    if activities.len() < 10 {
        return compute_power_curve_multi(activities, durations);
    }

    // Process activities in parallel
    let activity_curves: Vec<Vec<(f32, String, i64)>> = activities
        .par_iter()
        .map(|(activity_id, power_data, timestamp)| {
            durations
                .iter()
                .map(|&d| {
                    let avg = compute_best_avg_power(power_data, d as usize);
                    (avg, activity_id.clone(), *timestamp)
                })
                .collect()
        })
        .collect();

    // Merge results - find best for each duration
    let mut best_points: Vec<CurvePoint> = durations
        .iter()
        .map(|&d| CurvePoint {
            x: d as f32,
            y: 0.0,
            activity_id: None,
            timestamp: None,
        })
        .collect();

    for curve in activity_curves {
        for (i, (power, activity_id, timestamp)) in curve.into_iter().enumerate() {
            if power > best_points[i].y {
                best_points[i].y = power;
                best_points[i].activity_id = Some(activity_id);
                best_points[i].timestamp = Some(timestamp);
            }
        }
    }

    PowerCurve {
        points: best_points,
        durations: durations.to_vec(),
        activities_analyzed: activities.len() as u32,
    }
}

/// Compute pace curve from a single activity's distance and time data.
///
/// # Arguments
/// * `distances` - Cumulative distance at each second (in meters)
/// * `target_distances` - Distances to compute pace for (in meters)
///
/// # Returns
/// Pace curve with best average pace (m/s) for each distance
pub fn compute_pace_curve(distances: &[f32], target_distances: &[f32]) -> PaceCurve {
    if distances.is_empty() {
        return PaceCurve {
            points: target_distances
                .iter()
                .map(|&d| CurvePoint {
                    x: d,
                    y: 0.0,
                    activity_id: None,
                    timestamp: None,
                })
                .collect(),
            distances: target_distances.to_vec(),
            activities_analyzed: 0,
        };
    }

    let points: Vec<CurvePoint> = target_distances
        .iter()
        .map(|&target_dist| {
            let best_pace = compute_best_pace(distances, target_dist);
            CurvePoint {
                x: target_dist,
                y: best_pace,
                activity_id: None,
                timestamp: None,
            }
        })
        .collect();

    PaceCurve {
        points,
        distances: target_distances.to_vec(),
        activities_analyzed: 1,
    }
}

/// Compute best pace (m/s) for a target distance.
fn compute_best_pace(cumulative_distances: &[f32], target_distance: f32) -> f32 {
    if cumulative_distances.is_empty() {
        return 0.0;
    }

    let total_distance = *cumulative_distances.last().unwrap_or(&0.0);
    if total_distance < target_distance {
        return 0.0; // Activity too short
    }

    let mut best_pace: f32 = 0.0;

    // Sliding window approach: find start and end indices where distance difference = target
    let mut start_idx = 0;

    for end_idx in 1..cumulative_distances.len() {
        let dist_covered = cumulative_distances[end_idx] - cumulative_distances[start_idx];

        // Expand window until we have enough distance
        while dist_covered > target_distance && start_idx < end_idx {
            start_idx += 1;
        }

        // Check if this window gives us approximately the target distance
        let actual_dist =
            cumulative_distances[end_idx] - cumulative_distances.get(start_idx).unwrap_or(&0.0);

        if actual_dist >= target_distance * 0.95 && actual_dist <= target_distance * 1.05 {
            let time_seconds = (end_idx - start_idx) as f32;
            if time_seconds > 0.0 {
                let pace = actual_dist / time_seconds;
                if pace > best_pace {
                    best_pace = pace;
                }
            }
        }
    }

    best_pace
}

/// Compute pace curve from multiple activities (all-time bests).
pub fn compute_pace_curve_multi(
    activities: &[(String, Vec<f32>, i64)],
    target_distances: &[f32],
) -> PaceCurve {
    if activities.is_empty() {
        return PaceCurve {
            points: target_distances
                .iter()
                .map(|&d| CurvePoint {
                    x: d,
                    y: 0.0,
                    activity_id: None,
                    timestamp: None,
                })
                .collect(),
            distances: target_distances.to_vec(),
            activities_analyzed: 0,
        };
    }

    let mut best_points: Vec<CurvePoint> = target_distances
        .iter()
        .map(|&d| CurvePoint {
            x: d,
            y: 0.0,
            activity_id: None,
            timestamp: None,
        })
        .collect();

    for (activity_id, distances, timestamp) in activities {
        for (i, &target_dist) in target_distances.iter().enumerate() {
            let pace = compute_best_pace(distances, target_dist);
            if pace > best_points[i].y {
                best_points[i].y = pace;
                best_points[i].activity_id = Some(activity_id.clone());
                best_points[i].timestamp = Some(*timestamp);
            }
        }
    }

    PaceCurve {
        points: best_points,
        distances: target_distances.to_vec(),
        activities_analyzed: activities.len() as u32,
    }
}

// ============================================================================
// FFI Interface
// ============================================================================

#[cfg(feature = "ffi")]
use log::info;

/// FFI wrapper for single-activity power curve computation
#[cfg(feature = "ffi")]
pub fn ffi_compute_power_curve(power_data: Vec<u16>, durations: Vec<u32>) -> String {
    let result = compute_power_curve(&power_data, &durations);
    info!(
        "[Curves] Computed power curve with {} durations, peak 1s={}W",
        result.durations.len(),
        result.get_power_at(1).unwrap_or(0.0)
    );
    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

/// FFI wrapper for multi-activity power curve computation
#[cfg(feature = "ffi")]
pub fn ffi_compute_power_curve_multi(
    activity_ids: Vec<String>,
    power_data_flat: Vec<u16>,
    offsets: Vec<u32>,
    timestamps: Vec<i64>,
    durations: Vec<u32>,
) -> String {
    // Reconstruct activities from flat data
    let mut activities: Vec<(String, Vec<u16>, i64)> = Vec::new();

    for (i, activity_id) in activity_ids.iter().enumerate() {
        let start = offsets[i] as usize;
        let end = offsets
            .get(i + 1)
            .map(|&o| o as usize)
            .unwrap_or(power_data_flat.len());
        let power = power_data_flat[start..end].to_vec();
        let ts = timestamps.get(i).copied().unwrap_or(0);
        activities.push((activity_id.clone(), power, ts));
    }

    #[cfg(feature = "parallel")]
    let result = compute_power_curve_multi_parallel(&activities, &durations);
    #[cfg(not(feature = "parallel"))]
    let result = compute_power_curve_multi(&activities, &durations);

    info!(
        "[Curves] Computed multi-activity power curve from {} activities",
        result.activities_analyzed
    );

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

/// FFI wrapper for single-activity pace curve computation
#[cfg(feature = "ffi")]
pub fn ffi_compute_pace_curve(distances: Vec<f32>, target_distances: Vec<f32>) -> String {
    let result = compute_pace_curve(&distances, &target_distances);
    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_best_avg_power() {
        let power = vec![100, 200, 300, 200, 100];

        // Window of 1 should return max
        assert_eq!(compute_best_avg_power(&power, 1), 300.0);

        // Window of 3: best is [200, 300, 200] = 233.33
        let best_3 = compute_best_avg_power(&power, 3);
        assert!((best_3 - 233.33).abs() < 1.0);

        // Window of 5: only option is all [100, 200, 300, 200, 100] = 180
        assert_eq!(compute_best_avg_power(&power, 5), 180.0);
    }

    #[test]
    fn test_power_curve() {
        let power: Vec<u16> = (0..60).map(|i| (200 + i * 2) as u16).collect();
        let durations = vec![1, 5, 10, 30];

        let curve = compute_power_curve(&power, &durations);

        assert_eq!(curve.durations.len(), 4);
        assert_eq!(curve.activities_analyzed, 1);

        // Last second should be highest
        let power_1s = curve.get_power_at(1).unwrap();
        assert!(power_1s > 300.0);
    }

    #[test]
    fn test_power_curve_empty() {
        let power: Vec<u16> = vec![];
        let durations = vec![1, 5, 10];

        let curve = compute_power_curve(&power, &durations);

        assert_eq!(curve.activities_analyzed, 0);
        assert_eq!(curve.get_power_at(1), Some(0.0));
    }

    #[test]
    fn test_power_curve_multi() {
        let activities = vec![
            ("a1".to_string(), vec![100, 150, 200, 180, 160], 1000),
            ("a2".to_string(), vec![200, 250, 300, 280, 260], 2000),
        ];
        let durations = vec![1, 3];

        let curve = compute_power_curve_multi(&activities, &durations);

        assert_eq!(curve.activities_analyzed, 2);

        // Best 1s should come from a2
        assert_eq!(curve.get_power_at(1), Some(300.0));
        assert_eq!(curve.get_activity_at(1), Some("a2"));
    }

    #[test]
    fn test_pace_curve_empty() {
        let distances: Vec<f32> = vec![];
        let targets = vec![100.0, 1000.0];

        let curve = compute_pace_curve(&distances, &targets);

        assert_eq!(curve.activities_analyzed, 0);
        assert_eq!(curve.get_pace_at(100.0), Some(0.0));
    }
}
