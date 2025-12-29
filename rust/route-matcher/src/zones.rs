//! Zone distribution calculations for power and heart rate data.
//!
//! This module provides efficient zone distribution calculations that can process
//! large datasets (10,000+ data points) much faster than JavaScript implementations.
//!
//! ## Features
//! - Power zone distribution (7 zones by default)
//! - Heart rate zone distribution (5 zones by default)
//! - Time-in-zone calculations
//! - Support for custom zone thresholds
//!
//! ## Example
//! ```rust
//! use route_matcher::zones::{calculate_power_zones, PowerZoneConfig};
//!
//! let power_data = vec![150, 200, 250, 300, 280, 220, 180];
//! let config = PowerZoneConfig::from_ftp(250);
//! let distribution = calculate_power_zones(&power_data, &config);
//! println!("Time in Zone 4: {}%", distribution.get_zone_percent(4));
//! ```

use serde::{Deserialize, Serialize};

#[cfg(feature = "parallel")]
use rayon::prelude::*;

/// Configuration for power zone calculation.
/// Zones are defined as percentages of FTP (Functional Threshold Power).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerZoneConfig {
    /// FTP (Functional Threshold Power) in watts
    pub ftp: u16,
    /// Zone thresholds as percentages of FTP [Z1 max, Z2 max, Z3 max, Z4 max, Z5 max, Z6 max]
    /// Z7 is everything above Z6 max
    pub zone_thresholds: [f32; 6],
}

impl PowerZoneConfig {
    /// Create config from FTP using standard Coggan zones
    pub fn from_ftp(ftp: u16) -> Self {
        Self {
            ftp,
            // Standard Coggan power zones as % of FTP
            zone_thresholds: [0.55, 0.75, 0.90, 1.05, 1.20, 1.50],
        }
    }

    /// Create config with custom zone thresholds
    pub fn with_thresholds(ftp: u16, thresholds: [f32; 6]) -> Self {
        Self {
            ftp,
            zone_thresholds: thresholds,
        }
    }

    /// Get absolute power threshold for a zone
    fn get_zone_max(&self, zone: usize) -> u16 {
        if zone >= self.zone_thresholds.len() {
            return u16::MAX;
        }
        (self.ftp as f32 * self.zone_thresholds[zone]) as u16
    }

    /// Determine which zone a power value falls into (1-7)
    pub fn get_zone(&self, power: u16) -> u8 {
        for (i, &threshold) in self.zone_thresholds.iter().enumerate() {
            let max_watts = (self.ftp as f32 * threshold) as u16;
            if power <= max_watts {
                return (i + 1) as u8;
            }
        }
        7 // Above Z6 max is Z7
    }
}

impl Default for PowerZoneConfig {
    fn default() -> Self {
        Self::from_ftp(200) // Reasonable default FTP
    }
}

/// Configuration for heart rate zone calculation.
/// Zones are defined as percentages of max HR or LTHR.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HRZoneConfig {
    /// Maximum heart rate or Lactate Threshold HR
    pub threshold_hr: u8,
    /// Zone thresholds as percentages [Z1 max, Z2 max, Z3 max, Z4 max]
    /// Z5 is everything above Z4 max
    pub zone_thresholds: [f32; 4],
}

impl HRZoneConfig {
    /// Create config from max HR using standard 5-zone model
    pub fn from_max_hr(max_hr: u8) -> Self {
        Self {
            threshold_hr: max_hr,
            // Standard HR zones as % of max HR
            zone_thresholds: [0.60, 0.70, 0.80, 0.90],
        }
    }

    /// Create config from LTHR (Lactate Threshold HR)
    pub fn from_lthr(lthr: u8) -> Self {
        Self {
            threshold_hr: lthr,
            // Zones relative to LTHR
            zone_thresholds: [0.81, 0.89, 0.94, 1.00],
        }
    }

    /// Create config with custom thresholds
    pub fn with_thresholds(threshold_hr: u8, thresholds: [f32; 4]) -> Self {
        Self {
            threshold_hr,
            zone_thresholds: thresholds,
        }
    }

    /// Determine which zone a HR value falls into (1-5)
    pub fn get_zone(&self, hr: u8) -> u8 {
        for (i, &threshold) in self.zone_thresholds.iter().enumerate() {
            let max_hr = (self.threshold_hr as f32 * threshold) as u8;
            if hr <= max_hr {
                return (i + 1) as u8;
            }
        }
        5 // Above Z4 max is Z5
    }
}

impl Default for HRZoneConfig {
    fn default() -> Self {
        Self::from_max_hr(185) // Reasonable default max HR
    }
}

/// Result of power zone distribution calculation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerZoneDistribution {
    /// Total data points analyzed
    pub total_samples: u32,
    /// Samples in each zone (indexed 0-6 for zones 1-7)
    pub zone_samples: [u32; 7],
    /// Percentage of time in each zone
    pub zone_percentages: [f32; 7],
    /// Average power across all samples
    pub average_power: f32,
    /// Normalized power (4th power average)
    pub normalized_power: Option<f32>,
    /// Peak 1-second power
    pub peak_power: u16,
}

impl PowerZoneDistribution {
    /// Get percentage for a specific zone (1-7)
    pub fn get_zone_percent(&self, zone: u8) -> f32 {
        if zone >= 1 && zone <= 7 {
            self.zone_percentages[(zone - 1) as usize]
        } else {
            0.0
        }
    }
}

/// Result of heart rate zone distribution calculation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HRZoneDistribution {
    /// Total data points analyzed
    pub total_samples: u32,
    /// Samples in each zone (indexed 0-4 for zones 1-5)
    pub zone_samples: [u32; 5],
    /// Percentage of time in each zone
    pub zone_percentages: [f32; 5],
    /// Average heart rate across all samples
    pub average_hr: f32,
    /// Peak heart rate
    pub peak_hr: u8,
}

impl HRZoneDistribution {
    /// Get percentage for a specific zone (1-5)
    pub fn get_zone_percent(&self, zone: u8) -> f32 {
        if zone >= 1 && zone <= 5 {
            self.zone_percentages[(zone - 1) as usize]
        } else {
            0.0
        }
    }
}

/// Calculate power zone distribution from a stream of power data.
///
/// # Arguments
/// * `power_data` - Slice of power values in watts (1Hz sampling assumed)
/// * `config` - Power zone configuration
///
/// # Returns
/// Zone distribution with time in each zone
pub fn calculate_power_zones(power_data: &[u16], config: &PowerZoneConfig) -> PowerZoneDistribution {
    if power_data.is_empty() {
        return PowerZoneDistribution {
            total_samples: 0,
            zone_samples: [0; 7],
            zone_percentages: [0.0; 7],
            average_power: 0.0,
            normalized_power: None,
            peak_power: 0,
        };
    }

    let mut zone_samples = [0u32; 7];
    let mut sum: u64 = 0;
    let mut peak: u16 = 0;
    let mut fourth_power_sum: f64 = 0.0;

    // Process all samples
    for &power in power_data {
        // Determine zone
        let zone = config.get_zone(power);
        zone_samples[(zone - 1) as usize] += 1;

        // Accumulate for averages
        sum += power as u64;
        if power > peak {
            peak = power;
        }

        // For normalized power calculation
        fourth_power_sum += (power as f64).powi(4);
    }

    let total = power_data.len() as u32;
    let average = sum as f32 / total as f32;

    // Calculate percentages
    let mut zone_percentages = [0.0f32; 7];
    for i in 0..7 {
        zone_percentages[i] = (zone_samples[i] as f32 / total as f32) * 100.0;
    }

    // Normalized power (30-second rolling average to the 4th power, then 4th root)
    // Simplified version without rolling average for now
    let np = if total >= 30 {
        Some((fourth_power_sum / total as f64).powf(0.25) as f32)
    } else {
        None
    };

    PowerZoneDistribution {
        total_samples: total,
        zone_samples,
        zone_percentages,
        average_power: average,
        normalized_power: np,
        peak_power: peak,
    }
}

/// Calculate power zone distribution using parallel processing.
/// More efficient for large datasets (> 10,000 samples).
#[cfg(feature = "parallel")]
pub fn calculate_power_zones_parallel(
    power_data: &[u16],
    config: &PowerZoneConfig,
) -> PowerZoneDistribution {
    if power_data.len() < 10_000 {
        // Fall back to sequential for small datasets
        return calculate_power_zones(power_data, config);
    }

    // Parallel reduction
    let (zone_counts, sum, peak, fourth_power_sum) = power_data
        .par_iter()
        .fold(
            || ([0u32; 7], 0u64, 0u16, 0.0f64),
            |(mut zones, sum, peak, fp_sum), &power| {
                let zone = config.get_zone(power);
                zones[(zone - 1) as usize] += 1;
                (
                    zones,
                    sum + power as u64,
                    peak.max(power),
                    fp_sum + (power as f64).powi(4),
                )
            },
        )
        .reduce(
            || ([0u32; 7], 0u64, 0u16, 0.0f64),
            |(mut z1, s1, p1, fp1), (z2, s2, p2, fp2)| {
                for i in 0..7 {
                    z1[i] += z2[i];
                }
                (z1, s1 + s2, p1.max(p2), fp1 + fp2)
            },
        );

    let total = power_data.len() as u32;
    let average = sum as f32 / total as f32;

    let mut zone_percentages = [0.0f32; 7];
    for i in 0..7 {
        zone_percentages[i] = (zone_counts[i] as f32 / total as f32) * 100.0;
    }

    let np = if total >= 30 {
        Some((fourth_power_sum / total as f64).powf(0.25) as f32)
    } else {
        None
    };

    PowerZoneDistribution {
        total_samples: total,
        zone_samples: zone_counts,
        zone_percentages,
        average_power: average,
        normalized_power: np,
        peak_power: peak,
    }
}

/// Calculate heart rate zone distribution from a stream of HR data.
///
/// # Arguments
/// * `hr_data` - Slice of heart rate values in BPM (1Hz sampling assumed)
/// * `config` - HR zone configuration
///
/// # Returns
/// Zone distribution with time in each zone
pub fn calculate_hr_zones(hr_data: &[u8], config: &HRZoneConfig) -> HRZoneDistribution {
    if hr_data.is_empty() {
        return HRZoneDistribution {
            total_samples: 0,
            zone_samples: [0; 5],
            zone_percentages: [0.0; 5],
            average_hr: 0.0,
            peak_hr: 0,
        };
    }

    let mut zone_samples = [0u32; 5];
    let mut sum: u32 = 0;
    let mut peak: u8 = 0;

    for &hr in hr_data {
        let zone = config.get_zone(hr);
        zone_samples[(zone - 1) as usize] += 1;
        sum += hr as u32;
        if hr > peak {
            peak = hr;
        }
    }

    let total = hr_data.len() as u32;
    let average = sum as f32 / total as f32;

    let mut zone_percentages = [0.0f32; 5];
    for i in 0..5 {
        zone_percentages[i] = (zone_samples[i] as f32 / total as f32) * 100.0;
    }

    HRZoneDistribution {
        total_samples: total,
        zone_samples,
        zone_percentages,
        average_hr: average,
        peak_hr: peak,
    }
}

/// Calculate HR zone distribution using parallel processing.
#[cfg(feature = "parallel")]
pub fn calculate_hr_zones_parallel(hr_data: &[u8], config: &HRZoneConfig) -> HRZoneDistribution {
    if hr_data.len() < 10_000 {
        return calculate_hr_zones(hr_data, config);
    }

    let (zone_counts, sum, peak) = hr_data
        .par_iter()
        .fold(
            || ([0u32; 5], 0u32, 0u8),
            |(mut zones, sum, peak), &hr| {
                let zone = config.get_zone(hr);
                zones[(zone - 1) as usize] += 1;
                (zones, sum + hr as u32, peak.max(hr))
            },
        )
        .reduce(
            || ([0u32; 5], 0u32, 0u8),
            |(mut z1, s1, p1), (z2, s2, p2)| {
                for i in 0..5 {
                    z1[i] += z2[i];
                }
                (z1, s1 + s2, p1.max(p2))
            },
        );

    let total = hr_data.len() as u32;
    let average = sum as f32 / total as f32;

    let mut zone_percentages = [0.0f32; 5];
    for i in 0..5 {
        zone_percentages[i] = (zone_counts[i] as f32 / total as f32) * 100.0;
    }

    HRZoneDistribution {
        total_samples: total,
        zone_samples: zone_counts,
        zone_percentages,
        average_hr: average,
        peak_hr: peak,
    }
}

// ============================================================================
// FFI Interface
// ============================================================================

#[cfg(feature = "ffi")]
use log::info;

/// FFI wrapper for power zone calculation.
/// Takes flat arrays for efficient cross-language data transfer.
#[cfg(feature = "ffi")]
pub fn ffi_calculate_power_zones(
    power_data: Vec<u16>,
    ftp: u16,
    zone_thresholds: Option<Vec<f32>>,
) -> String {
    let config = match zone_thresholds {
        Some(thresholds) if thresholds.len() == 6 => {
            let mut arr = [0.0f32; 6];
            arr.copy_from_slice(&thresholds);
            PowerZoneConfig::with_thresholds(ftp, arr)
        }
        _ => PowerZoneConfig::from_ftp(ftp),
    };

    #[cfg(feature = "parallel")]
    let result = calculate_power_zones_parallel(&power_data, &config);
    #[cfg(not(feature = "parallel"))]
    let result = calculate_power_zones(&power_data, &config);

    info!(
        "[Zones] Calculated power zones for {} samples, avg={}W",
        result.total_samples, result.average_power
    );

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

/// FFI wrapper for HR zone calculation.
#[cfg(feature = "ffi")]
pub fn ffi_calculate_hr_zones(
    hr_data: Vec<u8>,
    threshold_hr: u8,
    zone_thresholds: Option<Vec<f32>>,
) -> String {
    let config = match zone_thresholds {
        Some(thresholds) if thresholds.len() == 4 => {
            let mut arr = [0.0f32; 4];
            arr.copy_from_slice(&thresholds);
            HRZoneConfig::with_thresholds(threshold_hr, arr)
        }
        _ => HRZoneConfig::from_max_hr(threshold_hr),
    };

    #[cfg(feature = "parallel")]
    let result = calculate_hr_zones_parallel(&hr_data, &config);
    #[cfg(not(feature = "parallel"))]
    let result = calculate_hr_zones(&hr_data, &config);

    info!(
        "[Zones] Calculated HR zones for {} samples, avg={}bpm",
        result.total_samples, result.average_hr
    );

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_power_zone_config() {
        let config = PowerZoneConfig::from_ftp(200);

        assert_eq!(config.get_zone(100), 1); // < 55% FTP
        assert_eq!(config.get_zone(130), 2); // 55-75% FTP
        assert_eq!(config.get_zone(170), 3); // 75-90% FTP
        assert_eq!(config.get_zone(200), 4); // 90-105% FTP
        assert_eq!(config.get_zone(230), 5); // 105-120% FTP
        assert_eq!(config.get_zone(280), 6); // 120-150% FTP
        assert_eq!(config.get_zone(350), 7); // > 150% FTP
    }

    #[test]
    fn test_power_zone_distribution() {
        let power_data: Vec<u16> = vec![100, 150, 200, 250, 300, 200, 180, 160, 140, 120];
        let config = PowerZoneConfig::from_ftp(200);
        let result = calculate_power_zones(&power_data, &config);

        assert_eq!(result.total_samples, 10);
        assert_eq!(result.peak_power, 300);
        assert!((result.average_power - 180.0).abs() < 0.1);
    }

    #[test]
    fn test_hr_zone_distribution() {
        let hr_data: Vec<u8> = vec![100, 120, 140, 160, 180, 170, 150, 130, 110, 90];
        let config = HRZoneConfig::from_max_hr(185);
        let result = calculate_hr_zones(&hr_data, &config);

        assert_eq!(result.total_samples, 10);
        assert_eq!(result.peak_hr, 180);
    }

    #[test]
    fn test_empty_data() {
        let empty: Vec<u16> = vec![];
        let config = PowerZoneConfig::default();
        let result = calculate_power_zones(&empty, &config);

        assert_eq!(result.total_samples, 0);
        assert_eq!(result.peak_power, 0);
    }
}
