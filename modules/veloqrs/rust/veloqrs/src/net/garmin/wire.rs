//! The bodies Garmin's Personal API answers with, reduced to the fields read.

use serde::Deserialize;

/// One entry of the activity list.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedActivity {
    pub activity_id: i64,
    /// The start on the athlete's wall clock, `YYYY-MM-DD HH:MM:SS`.
    #[serde(default)]
    pub start_time_local: Option<String>,
    /// The start in UTC, `YYYY-MM-DD HH:MM:SS`.
    #[serde(default, rename = "startTimeGMT")]
    pub start_time_gmt: Option<String>,
    /// The name the athlete or the device gave it.
    #[serde(default)]
    pub activity_name: Option<String>,
    #[serde(default)]
    pub activity_type: Option<ActivityType>,
    /// Moving time, seconds.
    #[serde(default)]
    pub duration: Option<f64>,
    /// Elapsed time, seconds.
    #[serde(default)]
    pub elapsed_duration: Option<f64>,
    /// Metres.
    #[serde(default)]
    pub distance: Option<f64>,
    #[serde(default)]
    pub manual_activity: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityType {
    pub type_key: String,
}
