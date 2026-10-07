//! FFI-safe types with UniFFI derives.
//!
//! These types mirror tracematch types but add UniFFI derives for mobile FFI.
//! Conversion is done at the FFI boundary.

use serde::{Deserialize, Serialize};

// ============================================================================
// Integers on the wire
// ============================================================================
//
// A timestamp, duration, rowid or run id, version, day count or byte count
// crosses the FFI as `f64`, because an `i64` or `u64` lifts as a `bigint` in
// TypeScript and `JSON.stringify` refuses one. `f64` is exact to 2^53, which
// every one of those kinds stays under. Going out it is `value as f64`. Coming
// in it is one of the two below, so every export floors the same way.

/// An integer the FFI carried as `f64`, floored. NaN is 0 and an infinity
/// saturates, which is what `as` does.
pub(crate) fn int_from_wire(value: f64) -> i64 {
    value.floor() as i64
}

/// An unsigned integer the FFI carried as `f64`, floored. A negative value is
/// 0, as are NaN, and an infinity saturates.
pub(crate) fn uint_from_wire(value: f64) -> u64 {
    value.floor() as u64
}

// ============================================================================
// Core Types
// ============================================================================

/// Extension track for expanding section bounds.
/// Contains the representative activity's full GPS track with section start/end indices.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionExtensionTrack {
    /// Delta+varint encoded coordinates of the full representative activity track
    pub encoded_track: Vec<u8>,
    /// Index in the track where the current section starts
    pub section_start_idx: u32,
    /// Index in the track where the current section ends
    pub section_end_idx: u32,
}

/// Section detection progress info.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDetectionProgress {
    /// Current phase, such as "loading", "analyzing" or "saving".
    pub phase: String,
    /// Number of items completed in current phase
    pub completed: u32,
    /// Total items in current phase
    pub total: u32,
    /// Phase-weighted overall percent (0–100)
    pub percent: u32,
}

/// Section reference info: combines reference activity ID and user-defined flag.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionReferenceInfo {
    pub activity_id: String,
    pub is_user_defined: bool,
}

/// A ride a section edit took out of the section: its library name and its
/// start as seconds since the epoch.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDepartedRide {
    pub activity_id: String,
    pub name: String,
    pub date: f64,
}

/// A merge's result: the section kept and the rides that left it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMergeOutcome {
    pub section_id: String,
    pub departed: Vec<FfiDepartedRide>,
}

/// Lightweight map signature for rendering activity traces on the map.
/// Contains simplified GPS points (max ~100 via Douglas-Peucker) as encoded coords.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapSignature {
    pub activity_id: String,
    /// Delta+varint encoded coordinates (simplified, max ~100 points)
    pub encoded_coords: Vec<u8>,
    pub center_lat: f64,
    pub center_lng: f64,
}

/// Distance range selected for the map in the current unit system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MapDistanceBand {
    All,
    XShort,
    Short,
    Medium,
    Long,
}

/// GPS point for FFI
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FfiGpsPoint {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elevation: Option<f64>,
}

impl From<tracematch::GpsPoint> for FfiGpsPoint {
    fn from(p: tracematch::GpsPoint) -> Self {
        Self {
            latitude: p.latitude,
            longitude: p.longitude,
            elevation: p.elevation,
        }
    }
}

impl From<FfiGpsPoint> for tracematch::GpsPoint {
    fn from(p: FfiGpsPoint) -> Self {
        match p.elevation {
            Some(e) => Self::with_elevation(p.latitude, p.longitude, e),
            None => Self::new(p.latitude, p.longitude),
        }
    }
}

/// Bounding box for FFI
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FfiBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl From<tracematch::Bounds> for FfiBounds {
    fn from(b: tracematch::Bounds) -> Self {
        Self {
            min_lat: b.min_lat,
            max_lat: b.max_lat,
            min_lng: b.min_lng,
            max_lng: b.max_lng,
        }
    }
}

impl From<FfiBounds> for tracematch::Bounds {
    fn from(b: FfiBounds) -> Self {
        Self {
            min_lat: b.min_lat,
            max_lat: b.max_lat,
            min_lng: b.min_lng,
            max_lng: b.max_lng,
        }
    }
}

/// Activity metrics for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record, Default)]
pub struct FfiActivityMetrics {
    pub activity_id: String,
    pub name: String,
    /// Unix timestamp (seconds since epoch)
    pub date: f64,
    /// Distance in meters
    pub distance: f64,
    /// Moving time in seconds
    pub moving_time: u32,
    /// Elapsed time in seconds
    pub elapsed_time: u32,
    /// Total elevation gain in meters
    pub elevation_gain: f64,
    /// Average heart rate (optional)
    pub avg_hr: Option<u16>,
    /// Average power in watts (optional)
    pub avg_power: Option<u16>,
    /// Sport type (e.g., "Ride", "Run")
    pub sport_type: String,
    /// Training load / TSS (optional)
    pub training_load: Option<f64>,
    /// FTP used for this activity (optional)
    pub ftp: Option<u16>,
    /// Power zone times in seconds per zone (optional)
    pub power_zone_times: Option<Vec<u32>>,
    /// HR zone times in seconds per zone (optional)
    pub hr_zone_times: Option<Vec<u32>>,
}

impl From<crate::ActivityMetrics> for FfiActivityMetrics {
    fn from(m: crate::ActivityMetrics) -> Self {
        Self {
            activity_id: m.activity_id,
            name: m.name,
            date: m.date as f64,
            distance: m.distance,
            moving_time: m.moving_time,
            elapsed_time: m.elapsed_time,
            elevation_gain: m.elevation_gain,
            avg_hr: m.avg_hr,
            avg_power: m.avg_power,
            sport_type: m.sport_type,
            training_load: m.training_load,
            ftp: m.ftp,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }
}

impl From<FfiActivityMetrics> for crate::ActivityMetrics {
    fn from(m: FfiActivityMetrics) -> Self {
        Self {
            activity_id: m.activity_id,
            name: m.name,
            date: m.date as i64,
            distance: m.distance,
            moving_time: m.moving_time,
            elapsed_time: m.elapsed_time,
            elevation_gain: m.elevation_gain,
            avg_hr: m.avg_hr,
            avg_power: m.avg_power,
            sport_type: m.sport_type,
            training_load: m.training_load,
            ftp: m.ftp,
            power_zone_times: m.power_zone_times,
            hr_zone_times: m.hr_zone_times,
        }
    }
}

// ============================================================================
// Aggregate Query Result Types
// ============================================================================

/// One week's totals and when the week starts.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWeeklyTotal {
    /// Epoch seconds of the week's first instant.
    pub start: f64,
    pub stats: FfiPeriodStats,
}

/// Aggregated stats for a date range.
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiPeriodStats {
    /// Number of activities
    pub count: u32,
    /// Total moving time in seconds
    pub total_duration: f64,
    /// Total distance in meters
    pub total_distance: f64,
    /// Total training load (TSS)
    pub total_tss: f64,
}

/// Whether a local day's recorded activity load can be totalled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiDayLoadStatus {
    /// Every activity that day carries a recorded load, an explicit zero included.
    Complete,
    /// Some activities carry a load and some do not; the total is the known part.
    Partial,
    /// The day has activities and none carries a load.
    Unavailable,
    /// The day has no activities.
    Rest,
}

/// One local calendar day's recorded activity training load.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDayLoad {
    /// Local date, `YYYY-MM-DD`.
    pub date: String,
    pub status: FfiDayLoadStatus,
    /// Sum of the recorded loads, absent when none is recorded.
    pub total: Option<f64>,
    /// Activities on the day, loaded or not.
    pub activity_count: u32,
}

/// Which total a period comparison was taken on. A week with no training load
/// recorded still has moving time, so the comparison falls back rather than
/// reading zero against zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiLoadMetric {
    /// Training load, when both periods carry some.
    Tss,
    /// Moving time in seconds.
    Duration,
}

/// One period measured against another, on whichever total both carry.
///
/// The card's threshold test is the reader's: this says how far apart the two
/// periods are and on what, not whether that is worth saying.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPeriodComparison {
    /// The total both values are under.
    pub metric: FfiLoadMetric,
    /// The later period's total, in TSS or in seconds.
    pub current: f64,
    /// The earlier period's total, on the same metric.
    pub previous: f64,
    /// `current / previous - 1`, so 0.28 is 28% more than the period before.
    pub ratio: f64,
    /// Epoch seconds where the later period starts, the week the verdict is
    /// about, so a graphic of the weekly totals can mark it.
    pub compared_start: f64,
}

/// A sport's time in each zone, with the athlete's own name for each zone.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiZoneDistribution {
    /// Seconds per zone, lowest zone first. Empty for an unknown zone type.
    pub seconds: Vec<f64>,
    /// The names the cached sport settings give the zones, lowest first, never
    /// more than `seconds` holds.
    /// Empty when the settings do not name them.
    pub names: Vec<String>,
}

/// One calendar month's totals, for the season chart's month bars.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMonthlyStats {
    /// Calendar year, in the athlete's own timezone.
    pub year: i32,
    /// Calendar month, 1 to 12.
    pub month: u32,
    /// The same four totals `get_period_stats` gives a window.
    pub stats: FfiPeriodStats,
}

/// Cycling FTP trend, read from the daily cycling eFTP in the `sportInfo`
/// entries of `wellness.raw`, not from the configured FTP setting (`icu_ftp`)
/// or the per-activity estimate (`icu_pm_ftp_watts`). The latest and previous
/// values are days of that series and are not activity starts.
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiFtpTrend {
    /// eFTP of the newest day carrying one
    pub latest_ftp: Option<u16>,
    /// That day's epoch (Unix timestamp seconds)
    pub latest_date: Option<f64>,
    /// eFTP of the newest day on or before 30 days earlier than `latest_date`.
    /// It may equal `latest_ftp`
    pub previous_ftp: Option<u16>,
    /// That day's epoch (Unix timestamp seconds)
    pub previous_date: Option<f64>,
    /// The step from `previous_ftp` to `latest_ftp` in watts, with its sign.
    /// Derived here so a screen, a widget and a notification cannot each
    /// subtract and round their own way. `None` when there is nothing to
    /// compare against.
    pub delta_watts: Option<i32>,
    /// Days carrying an estimate from the one compared against to the newest,
    /// inclusive. The insight ranker weighs a claim by what it stands on, and
    /// a step measured off three days is not the one measured off thirty.
    pub sample_count: u32,
    /// The daily estimates the step was read from, oldest first. The same
    /// series `sample_count` counts, carried rather than counted, so the
    /// milestone card draws the run-up to the step it names.
    pub history: Vec<FfiSeriesPoint>,
    /// Every activity that moved the accepted eFTP, oldest first, whatever the
    /// window: the fitness plot marks them over its own range.
    pub changes: Vec<FfiEftpChange>,
}

/// One activity that moved the athlete's accepted eFTP.
///
/// The estimate an activity produced is not a change: only a non-zero delta on
/// the rolling value is, which is what intervals.icu marks on its own plot.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiEftpChange {
    pub activity_id: String,
    /// Activity start (Unix timestamp seconds).
    pub date: f64,
    /// The accepted eFTP after the activity, in watts.
    pub eftp: f64,
    /// What the activity moved it by, with its sign.
    pub delta: f64,
    pub activity_name: String,
}

/// Pace trend data (critical speed for running/swimming).
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiPaceTrend {
    /// Most recent critical speed in m/s
    pub latest_pace: Option<f64>,
    /// Date of most recent snapshot (Unix timestamp seconds)
    pub latest_date: Option<f64>,
    /// Previous different critical speed in m/s
    pub previous_pace: Option<f64>,
    /// Date of previous snapshot (Unix timestamp seconds)
    pub previous_date: Option<f64>,
    /// The move from `previous_pace` to `latest_pace` as a percent of the
    /// earlier speed, positive for faster. `None` with nothing to compare
    /// against.
    pub gain_percent: Option<f64>,
    /// The same move in seconds per unit distance, the unit the sport is
    /// paced in: 100 m for swimming, a kilometre otherwise. Positive is
    /// seconds saved.
    pub delta_seconds: Option<f64>,
    /// The arrow the move draws, judged on pace in the unit the sport is paced
    /// in by [`crate::trend_table::glyph`]: up for faster. Flat when no earlier
    /// snapshot differs, `None` with no snapshot at all.
    pub glyph: Option<String>,
    /// Snapshots the trend was read from, for the same reason as
    /// `FfiFtpTrend::sample_count`.
    pub sample_count: u32,
    /// Those snapshots, oldest first, for the same reason as
    /// `FfiFtpTrend::history`.
    pub history: Vec<FfiSeriesPoint>,
}

/// What a trend or verdict was measured against and how much evidence stood
/// behind it, so a surface can state the method and the engine can withhold a
/// claim its evidence cannot carry (`crate::claim`).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiClaimBasis {
    /// What the reading is compared with, as a key a surface translates:
    /// `earlierReading` is the newest reading at least `lookback_days` before it.
    pub baseline: String,
    /// The earlier readings inside the window.
    pub population: u32,
}

/// The summary card's numbers and the arrow beside each.
///
/// A glyph is the engine's judgement of improvement. `None` means the
/// comparison had no nearby baseline or enough earlier readings.
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiWellnessSummary {
    pub fitness: Option<f64>,
    pub fitness_trend: Option<String>,
    pub form: Option<f64>,
    pub form_trend: Option<String>,
    pub hrv: Option<f64>,
    pub hrv_trend: Option<String>,
    pub rhr: Option<f64>,
    pub rhr_trend: Option<String>,
    pub weight: Option<f64>,
    pub weight_trend: Option<String>,
    /// The newest row's fatigue, rounded as `fitness` is. It has no arrow of its own.
    pub fatigue: Option<f64>,
}

/// The readings and baselines consumed while composing a native widget.
#[derive(Debug, Clone, Default)]
pub struct WidgetWellnessSummary {
    pub fitness: Option<f64>,
    pub fitness_trend: Option<String>,
    pub form: Option<f64>,
    pub form_trend: Option<String>,
    pub hrv: Option<f64>,
    pub hrv_trend: Option<String>,
    pub rhr: Option<f64>,
    pub rhr_trend: Option<String>,
    pub weight: Option<f64>,
    pub weight_trend: Option<String>,
    pub fatigue: Option<f64>,
    pub fitness_previous: Option<f64>,
    pub fatigue_previous: Option<f64>,
    pub form_previous: Option<f64>,
    pub hrv_previous: Option<f64>,
    pub rhr_previous: Option<f64>,
    pub fitness_basis: Option<FfiClaimBasis>,
    pub fatigue_basis: Option<FfiClaimBasis>,
    pub form_basis: Option<FfiClaimBasis>,
    pub hrv_basis: Option<FfiClaimBasis>,
    pub rhr_basis: Option<FfiClaimBasis>,
    pub weight_basis: Option<FfiClaimBasis>,
}

impl From<WidgetWellnessSummary> for FfiWellnessSummary {
    fn from(w: WidgetWellnessSummary) -> Self {
        Self {
            fitness: w.fitness,
            fitness_trend: w.fitness_trend,
            form: w.form,
            form_trend: w.form_trend,
            hrv: w.hrv,
            hrv_trend: w.hrv_trend,
            rhr: w.rhr,
            rhr_trend: w.rhr_trend,
            weight: w.weight,
            weight_trend: w.weight_trend,
            fatigue: w.fatigue,
        }
    }
}

/// Screen trends paired with the Rust-only wellness baselines for a widget.
#[derive(Debug, Clone, Default)]
pub struct WidgetSummaryCardData {
    pub wellness: WidgetWellnessSummary,
    pub current_week: FfiPeriodStats,
    pub prev_week: FfiPeriodStats,
    pub ftp_trend: FfiFtpTrend,
    pub run_pace_trend: FfiPaceTrend,
    pub swim_pace_trend: FfiPaceTrend,
}

/// Summary card batch data: combines period stats, FTP trend, and pace trends.
/// Reduces Home screen FFI calls from 5 to 1.
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiSummaryCardData {
    pub wellness: FfiWellnessSummary,
    pub current_week: FfiPeriodStats,
    pub prev_week: FfiPeriodStats,
    pub ftp_trend: FfiFtpTrend,
    pub run_pace_trend: FfiPaceTrend,
    pub swim_pace_trend: FfiPaceTrend,
}

/// Section summaries with total count: combines count + summaries in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionSummariesResult {
    /// Total section count (unfiltered)
    pub total_count: u32,
    /// Summaries (optionally filtered by sport type)
    pub summaries: Vec<crate::SectionSummary>,
}

/// Group summaries with total count: combines count + summaries in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiGroupSummariesResult {
    /// Total group count
    pub total_count: u32,
    /// All group summaries
    pub summaries: Vec<crate::GroupSummary>,
}

// ============================================================================
// Route Types
// ============================================================================

/// Route group for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRouteGroup {
    pub group_id: String,
    pub representative_id: String,
    pub activity_ids: Vec<String>,
    pub bounds: Option<FfiBounds>,
    pub custom_name: Option<String>,
    #[serde(default)]
    pub best_time: Option<f64>,
    #[serde(default)]
    pub avg_time: Option<f64>,
    #[serde(default)]
    pub best_pace: Option<f64>,
    #[serde(default)]
    pub best_activity_id: Option<String>,
}

impl From<tracematch::RouteGroup> for FfiRouteGroup {
    fn from(g: tracematch::RouteGroup) -> Self {
        Self {
            group_id: g.group_id,
            representative_id: g.representative_id,
            activity_ids: g.activity_ids,
            bounds: g.bounds.map(FfiBounds::from),
            custom_name: g.custom_name,
            best_time: g.best_time,
            avg_time: g.avg_time,
            best_pace: g.best_pace,
            best_activity_id: g.best_activity_id,
        }
    }
}

impl From<FfiRouteGroup> for tracematch::RouteGroup {
    fn from(g: FfiRouteGroup) -> Self {
        Self {
            group_id: g.group_id,
            representative_id: g.representative_id,
            activity_ids: g.activity_ids,
            sport_type: String::new(),
            bounds: g.bounds.map(tracematch::Bounds::from),
            custom_name: g.custom_name,
            best_time: g.best_time,
            avg_time: g.avg_time,
            best_pace: g.best_pace,
            best_activity_id: g.best_activity_id,
        }
    }
}

// ============================================================================
// Section Detection Types
// ============================================================================

/// Section config for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionConfig {
    pub proximity_threshold: f64,
    pub min_section_length: f64,
    pub max_section_length: f64,
    pub min_activities: u32,
    pub divergence_threshold: f64,
}

impl From<FfiSectionConfig> for tracematch::SectionConfig {
    fn from(c: FfiSectionConfig) -> Self {
        Self {
            proximity_threshold: c.proximity_threshold,
            min_section_length: c.min_section_length,
            max_section_length: c.max_section_length,
            min_activities: c.min_activities,
            divergence_threshold: c.divergence_threshold,
            // Pooling is not a user setting, so it stays off the FFI record.
            pool_sports: tracematch::SectionConfig::default().pool_sports,
        }
    }
}

impl From<&tracematch::SectionConfig> for FfiSectionConfig {
    fn from(c: &tracematch::SectionConfig) -> Self {
        Self {
            proximity_threshold: c.proximity_threshold,
            min_section_length: c.min_section_length,
            max_section_length: c.max_section_length,
            min_activities: c.min_activities,
            divergence_threshold: c.divergence_threshold,
        }
    }
}

impl Default for FfiSectionConfig {
    fn default() -> Self {
        Self::from(&tracematch::SectionConfig::default())
    }
}

/// Section portion for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPortion {
    pub activity_id: String,
    pub start_index: u32,
    pub end_index: u32,
    pub distance_meters: f64,
    pub direction: String,
}

impl From<tracematch::SectionPortion> for FfiSectionPortion {
    fn from(p: tracematch::SectionPortion) -> Self {
        Self {
            activity_id: p.activity_id,
            start_index: p.start_index,
            end_index: p.end_index,
            distance_meters: p.distance_meters,
            direction: p.direction.to_string(),
        }
    }
}

/// A named corridor: a durable user name keyed to ground, with its current
/// resolution onto the visible catalogue. `section_id` is None while the
/// name is dormant (no visible section covers its ground).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiNamedCorridor {
    pub intent_id: String,
    pub name: String,
    pub encoded_footprint: Vec<u8>,
    pub sport_type: Option<String>,
    pub created_at: String,
    pub section_id: Option<String>,
    pub coverage: f64,
    pub primary: bool,
}

impl From<crate::persistence::sections::NamedCorridor> for FfiNamedCorridor {
    fn from(c: crate::persistence::sections::NamedCorridor) -> Self {
        Self {
            intent_id: c.intent_id,
            name: c.name,
            encoded_footprint: crate::persistence::codec::encode_polyline(&c.footprint),
            sport_type: c.sport_type,
            created_at: c.created_at,
            section_id: c.section_id,
            coverage: c.coverage,
            primary: c.primary,
        }
    }
}

// ============================================================================
// Unified Section Type
// ============================================================================

/// Which sections a read wants. Every field is a narrowing, and an empty
/// filter is every visible section.
///
/// One record rather than a call per narrowing: every read returns the same
/// list, and the corridor-name overlay is applied once behind it.
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct FfiSectionFilter {
    /// Only this sport's sections.
    #[uniffi(default = None)]
    pub sport_type: Option<String>,
    /// Only sections visited at least this many times.
    #[uniffi(default = None)]
    pub min_visits: Option<u32>,
    /// Only "auto" or only "custom" sections.
    #[uniffi(default = None)]
    pub section_type: Option<String>,
    /// Only sections this activity passes through.
    #[uniffi(default = None)]
    pub activity_id: Option<String>,
}

/// Unified section for FFI. Represents both auto-detected and custom sections
/// with the same structure.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSection {
    pub id: String,
    pub section_type: String,
    pub name: Option<String>,
    /// Every sport whose included outings have taken the section, sorted. A
    /// section has no sport of its own, so this set is the whole answer.
    pub sport_types: Vec<String>,
    pub encoded_polyline: Vec<u8>,
    pub distance_meters: f64,
    pub representative_activity_id: Option<String>,
    pub activity_ids: Vec<String>,
    /// Each activity's portion of the section. Only the in-memory catalogue
    /// carries these, so the database path sends an empty list.
    pub activity_portions: Vec<FfiSectionPortion>,
    pub visit_count: u32,
    // Auto-specific metadata (None for custom sections)
    pub confidence: Option<f64>,
    pub observation_count: Option<u32>,
    pub average_spread: Option<f64>,
    pub point_density: Option<Vec<u32>>,
    pub scale: Option<String>,
    pub is_user_defined: bool,
    pub stability: Option<f64>,
    pub elevation_gain_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub version: Option<u32>,
    pub updated_at: Option<String>,
    pub created_at: String,
    /// Routes the section's activities are grouped into, from the junction join
    pub route_ids: Option<Vec<String>>,
    // Custom-specific fields (None for auto sections)
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
    // Visibility state
    pub disabled: bool,
    pub superseded_by: Option<String>,
    pub elevation_loss_m: Option<f64>,
    pub max_grade_percent: Option<f64>,
    pub klass: Option<String>,
    pub is_lift: bool,
    pub rank_score: Option<f64>,
    pub sport_rank_score: Option<f64>,
}

impl From<crate::sections::Section> for FfiSection {
    fn from(s: crate::sections::Section) -> Self {
        Self {
            id: s.id,
            section_type: s.section_type.as_str().to_string(),
            name: s.name,
            sport_types: s.sport_types,
            encoded_polyline: crate::persistence::codec::encode_polyline(&s.polyline),
            distance_meters: s.distance_meters,
            representative_activity_id: s.representative_activity_id,
            activity_ids: s.activity_ids,
            activity_portions: Vec::new(),
            visit_count: s.visit_count,
            confidence: s.confidence,
            observation_count: s.observation_count,
            average_spread: s.average_spread,
            point_density: s.point_density,
            scale: s.scale,
            is_user_defined: s.is_user_defined,
            stability: s.stability,
            elevation_gain_m: s.elevation_gain_m,
            avg_grade_percent: s.avg_grade_percent,
            elevation_loss_m: s.elevation_loss_m,
            max_grade_percent: s.max_grade_percent,
            klass: s.klass,
            is_lift: s.is_lift,
            rank_score: s.rank_score,
            sport_rank_score: s.sport_rank_score,
            version: s.version,
            updated_at: s.updated_at,
            created_at: s.created_at,
            route_ids: s.route_ids,
            source_activity_id: s.source_activity_id,
            start_index: s.start_index,
            end_index: s.end_index,
            disabled: s.disabled,
            superseded_by: s.superseded_by,
        }
    }
}

impl FfiSection {
    pub(crate) fn with_portions(mut self, portions: Vec<tracematch::SectionPortion>) -> Self {
        self.activity_portions = portions.into_iter().map(FfiSectionPortion::from).collect();
        self
    }
}

/// Catalogue-only conversion. The catalogue does not model stored type,
/// visibility, source slice, route ids or the sports its outings were, so
/// row-backed reads use `Section`.
impl From<&tracematch::FrequentSection> for FfiSection {
    fn from(s: &tracematch::FrequentSection) -> Self {
        Self {
            id: s.id.clone(),
            section_type: crate::sections::SectionType::Auto.as_str().to_string(),
            name: s.name.clone(),
            sport_types: Vec::new(),
            encoded_polyline: crate::persistence::codec::encode_polyline(&s.polyline),
            distance_meters: s.distance_meters,
            representative_activity_id: Some(s.representative_activity_id.clone()),
            activity_ids: s.activity_ids.clone(),
            activity_portions: s
                .activity_portions
                .iter()
                .cloned()
                .map(FfiSectionPortion::from)
                .collect(),
            visit_count: s.visit_count,
            confidence: Some(s.confidence),
            observation_count: Some(s.observation_count),
            average_spread: Some(s.average_spread),
            point_density: Some(s.point_density.clone()),
            scale: s.scale.map(|sc| sc.to_string()),
            is_user_defined: s.is_user_defined,
            stability: Some(s.stability),
            elevation_gain_m: s.elevation_gain_m,
            avg_grade_percent: s.avg_grade_percent,
            version: Some(s.version),
            updated_at: s.updated_at.clone(),
            created_at: s.created_at.clone().unwrap_or_default(),
            route_ids: None,
            source_activity_id: None,
            start_index: None,
            end_index: None,
            disabled: false,
            superseded_by: None,
            elevation_loss_m: s.enrichment.elevation_loss_m,
            max_grade_percent: s.enrichment.max_grade_percent,
            klass: s.enrichment.klass.map(|k| k.as_str().to_string()),
            is_lift: s.enrichment.is_lift,
            rank_score: s.rank.as_ref().map(|r| r.score),
            sport_rank_score: s.rank.as_ref().map(|r| r.sport_score),
        }
    }
}

impl From<tracematch::FrequentSection> for FfiSection {
    fn from(s: tracematch::FrequentSection) -> Self {
        Self::from(&s)
    }
}

// ============================================================================
// ============================================================================
// Performance Types
// ============================================================================

/// Section lap for FFI.
/// Represents a single traversal of a section within an activity.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionLap {
    pub id: String,
    pub activity_id: String,
    /// Lap time in seconds
    pub time: f64,
    /// Pace in m/s
    pub pace: f64,
    /// Distance in meters
    pub distance: f64,
    /// Direction: "same", "reverse" or "partial"
    pub direction: String,
    /// Start index in the activity's GPS track
    pub start_index: u32,
    /// End index in the activity's GPS track
    pub end_index: u32,
    /// Mean heart rate over the lap, when the activity carried a stream.
    pub avg_hr: Option<f64>,
    /// Mean watts over the lap, when the activity carried a power stream.
    pub avg_power: Option<f64>,
    /// The athlete excluded this traversal: listed so it can be restored,
    /// counted nowhere.
    pub excluded: bool,
}

/// One ledger row of a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionHistoryEvent {
    pub id: f64,
    pub at: String,
    /// formed, restored, split, recut, dissolved, merged, superseded,
    /// reverted, pr_rebased, baseline, algorithm_changed, name_released or
    /// name_taken.
    pub kind: String,
    /// JSON: the era snapshot, lineage links and what was around the change.
    pub details: Option<String>,
    pub geometry_version: Option<f64>,
}

/// One ledger change on a section that names an activity, for that activity's
/// screen. It is where the activity was around the change, never a cause.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiActivityLedgerChange {
    pub event_id: f64,
    pub section_id: String,
    /// The section's name now, absent when it has none.
    pub section_name: Option<String>,
    /// `auto` or `custom`.
    pub section_type: String,
    pub at: String,
    /// The ledger kind of the change, as in `FfiSectionHistoryEvent`.
    pub kind: String,
    /// How the row names the activity: around, fork_around, reanchored_from or
    /// reanchored_to.
    pub relation: String,
}

/// One stored geometry version of a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionGeometryVersion {
    pub version: f64,
    pub created_at: String,
    pub milestone: bool,
    pub pinned: bool,
}

/// A section the ledger remembers and the catalogue no longer holds.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRetiredSection {
    pub section_id: String,
    pub kind: String,
    pub at: String,
    pub into: Option<String>,
    pub versions: Vec<f64>,
}

/// The claims the change card may make on this build.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiChangeCardSupport {
    pub deterministic: bool,
    pub same_result_drip_or_batch: bool,
    pub ledger: bool,
    pub revert: bool,
    pub retired: bool,
    pub pinned_survive: bool,
    pub same_on_every_device: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBackupScreenData {
    pub home_lat: Option<String>,
    pub home_lng: Option<String>,
    pub radius_m: Option<String>,
    pub suggestion: Option<crate::persistence::SuggestedHome>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCacheScreenData {
    pub stream_retention_days: f64,
    pub stream_store_bytes: f64,
}

/// One background job's last finished run.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiJobRun {
    /// detection, elevationBackfill, streamBackfill or cutover.
    pub job: String,
    /// When the run finished, in epoch milliseconds.
    pub finished_at: f64,
    /// complete, partial, failed, paused or stopped.
    pub outcome: String,
    /// Items the run took on. Each count is zero for a job that has no
    /// measure of it.
    pub handled: u32,
    pub added: u32,
    pub changed: u32,
    pub retired: u32,
    pub failed: u32,
}

/// What the background jobs have done and still owe, read once each time a job
/// settles or activities land. The running progress is not here: it moves on
/// every item and stays on the routes status poll.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBackgroundJobsData {
    /// The last run of each job that has run on this install.
    pub runs: Vec<FfiJobRun>,
    /// Stored activities no detect has seen. `None` when it cannot be counted,
    /// which must not read as nothing left to do.
    pub detection_awaiting: Option<u32>,
    /// Whether a section rebuild is still owed.
    pub cutover_owed: bool,
}

/// A recent change on a live section, for the insights feed.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionChange {
    pub section_id: String,
    pub kind: String,
    pub at: String,
    /// The section's line as it now stands, delta+varint encoded and thinned
    /// as `FfiRecentPR.encoded_polyline` is. Empty when it cannot be read.
    pub encoded_polyline: Vec<u8>,
}

impl From<crate::SectionLap> for FfiSectionLap {
    fn from(l: crate::SectionLap) -> Self {
        Self {
            id: l.id,
            activity_id: l.activity_id,
            time: l.time,
            pace: l.pace,
            distance: l.distance,
            direction: l.direction,
            start_index: l.start_index,
            end_index: l.end_index,
            avg_hr: l.avg_hr,
            avg_power: l.avg_power,
            excluded: l.excluded,
        }
    }
}

/// Section performance record for FFI.
/// Contains all traversals for a single activity on a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceRecord {
    pub activity_id: String,
    pub activity_name: String,
    /// Unix timestamp
    pub activity_date: f64,
    /// All laps for this activity on this section
    pub laps: Vec<FfiSectionLap>,
    /// Number of times this section was traversed
    pub lap_count: u32,
    /// Best (fastest) lap time in seconds
    pub best_time: f64,
    /// Best pace in m/s
    pub best_pace: f64,
    /// Best eligible forward lap time.
    pub best_forward_time: Option<f64>,
    /// Best eligible reverse lap time.
    pub best_reverse_time: Option<f64>,
    /// Average lap time in seconds
    pub avg_time: f64,
    /// Average pace in m/s
    pub avg_pace: f64,
    /// Primary direction: "same" or "reverse"
    pub direction: String,
    /// Section distance in meters
    pub section_distance: f64,
}

impl From<crate::SectionPerformanceRecord> for FfiSectionPerformanceRecord {
    fn from(r: crate::SectionPerformanceRecord) -> Self {
        Self {
            activity_id: r.activity_id,
            activity_name: r.activity_name,
            activity_date: r.activity_date as f64,
            laps: r.laps.into_iter().map(FfiSectionLap::from).collect(),
            lap_count: r.lap_count,
            best_time: r.best_time,
            best_pace: r.best_pace,
            best_forward_time: r.best_forward_time,
            best_reverse_time: r.best_reverse_time,
            avg_time: r.avg_time,
            avg_pace: r.avg_pace,
            direction: r.direction,
            section_distance: r.section_distance,
        }
    }
}

/// Direction stats for FFI.
/// Summary statistics for traversals in a single direction.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiDirectionStats {
    /// Average time across all traversals in this direction (seconds)
    pub avg_time: Option<f64>,
    /// Unix timestamp of most recent traversal in this direction
    pub last_activity: Option<f64>,
    /// Number of traversals in this direction
    pub count: u32,
    /// Average speed across all traversals in this direction (m/s).
    /// Populated for route detail stats so the TS hook no longer has to
    /// re-aggregate. Section performance queries currently leave it as None.
    pub avg_speed: Option<f64>,
}

impl From<crate::DirectionStats> for FfiDirectionStats {
    fn from(s: crate::DirectionStats) -> Self {
        Self {
            avg_time: s.avg_time,
            last_activity: s.last_activity.map(|v| v as f64),
            count: s.count,
            avg_speed: s.avg_speed,
        }
    }
}

/// Section performance result for FFI.
/// Complete performance data for a section across all activities.
/// Replaces the JSON-returning `persistent_engine_get_section_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<FfiSectionPerformanceRecord>,
    /// Best record in forward/same direction
    pub best_forward_record: Option<FfiSectionPerformanceRecord>,
    /// Best record in reverse direction
    pub best_reverse_record: Option<FfiSectionPerformanceRecord>,
    /// Whether the forward best strictly beats another forward outing.
    pub best_forward_is_pr: bool,
    /// Whether the reverse best strictly beats another reverse outing.
    pub best_reverse_is_pr: bool,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<FfiDirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<FfiDirectionStats>,
}

impl From<crate::SectionPerformanceResult> for FfiSectionPerformanceResult {
    fn from(r: crate::SectionPerformanceResult) -> Self {
        let is_pr = |best: &Option<crate::SectionPerformanceRecord>| {
            best.as_ref()
                .is_some_and(|b| crate::persistence::records::is_section_record_pr(&r, b))
        };
        let best_forward_is_pr = is_pr(&r.best_forward_record);
        let best_reverse_is_pr = is_pr(&r.best_reverse_record);
        Self {
            records: r
                .records
                .into_iter()
                .map(FfiSectionPerformanceRecord::from)
                .collect(),
            best_forward_is_pr,
            best_reverse_is_pr,
            best_forward_record: r.best_forward_record.map(FfiSectionPerformanceRecord::from),
            best_reverse_record: r.best_reverse_record.map(FfiSectionPerformanceRecord::from),
            forward_stats: r.forward_stats.map(FfiDirectionStats::from),
            reverse_stats: r.reverse_stats.map(FfiDirectionStats::from),
        }
    }
}

/// Tier 3.2: one entry of a batched section-performance fetch. Returned
/// in the same order as the requested section_ids so the TS caller can
/// map directly without rebuilding lookups.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceBatchEntry {
    pub section_id: String,
    pub result: FfiSectionPerformanceResult,
}

/// Tier 5.5: result of a user-initiated section polyline recalc.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionRecalcResult {
    pub section_id: String,
    pub distance_meters: f64,
}

/// Route performance for FFI.
/// Performance data for a single activity on a route.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRoutePerformance {
    pub activity_id: String,
    pub name: String,
    /// Unix timestamp
    pub date: f64,
    /// Speed in m/s (distance / moving_time)
    pub speed: f64,
    /// Elapsed time in seconds
    pub duration: u32,
    /// Moving time in seconds
    pub moving_time: u32,
    /// Distance in meters
    pub distance: f64,
    /// Elevation gain in meters
    pub elevation_gain: f64,
    /// Average heart rate (optional)
    pub avg_hr: Option<u16>,
    /// Average power in watts (optional)
    pub avg_power: Option<u16>,
    /// Is this the current activity being viewed
    pub is_current: bool,
    /// Match direction: "same", "reverse", or "partial"
    pub direction: String,
    /// Match percentage (0-100), None if no match data available
    pub match_percentage: Option<f64>,
    /// True when the recorded distance sits outside the band around the
    /// route's usual distance: drawn, but holding no record and uncounted.
    pub outside_distance_band: bool,
    /// True when this attempt beats every other counted attempt in its sport
    /// and direction: the chart's ring and the tooltip's trophy.
    pub is_record: bool,
}

impl From<crate::RoutePerformance> for FfiRoutePerformance {
    fn from(p: crate::RoutePerformance) -> Self {
        Self {
            activity_id: p.activity_id,
            name: p.name,
            date: p.date as f64,
            speed: p.speed,
            duration: p.duration,
            moving_time: p.moving_time,
            distance: p.distance,
            elevation_gain: p.elevation_gain,
            avg_hr: p.avg_hr,
            avg_power: p.avg_power,
            is_current: p.is_current,
            direction: p.direction,
            match_percentage: p.match_percentage,
            outside_distance_band: p.outside_distance_band,
            is_record: p.is_record,
        }
    }
}

/// Route performance result for FFI.
/// Complete performance data for a route group across all activities.
/// Replaces the JSON-returning `persistent_engine_get_route_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<FfiRoutePerformance>,
    /// Activity metrics for all activities in the route (inlined to avoid duplicate FFI call)
    pub activity_metrics: Vec<FfiActivityMetrics>,
    /// Fastest forward performance, or fastest reverse when none ran forward.
    pub best: Option<FfiRoutePerformance>,
    /// Best performance in forward/same direction
    pub best_forward: Option<FfiRoutePerformance>,
    /// Best performance in reverse direction
    pub best_reverse: Option<FfiRoutePerformance>,
    /// Best performance in the current activity's direction.
    pub current_direction_best: Option<FfiRoutePerformance>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<FfiDirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<FfiDirectionStats>,
    /// Current activity's standing, with rank one reserved for a strict record.
    pub current_rank: Option<u32>,
    /// Timed comparable attempts in the current direction.
    pub attempt_count: u32,
    /// Share of those attempts slower than the current one, 0 to 100.
    /// `None` for a lone attempt or an activity that is not on the route.
    pub percentile_rank: Option<f64>,
    /// The trend curve and band over the counted attempts, for the scatter
    /// chart: the same smoother a section's chart uses.
    pub trend_curves: FfiSectionTrendCurves,
    /// The histogram of those attempts' elapsed times, per direction.
    pub histograms: FfiAttemptHistograms,
}

/// One wellness variable's relationship to attempt speed in one direction.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionCorrelation {
    /// `same` or `reverse`.
    pub direction: String,
    /// Stable snake_case token: `ctl`, `hrv`, `resting_hr`, `sleep_secs`...
    pub variable: String,
    pub result: FfiCorrelation,
}

/// A correlation, or the reason there is none. An enum so a coefficient cannot
/// be read off a state that has none.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum FfiCorrelation {
    /// Fewer complete pairs than the floor.
    TooFew { n: u32 },
    /// One series never varies.
    Undefined { n: u32 },
    /// The 95 per cent interval spans zero.
    Inconclusive { r: f64, n: u32, low: f64, high: f64 },
    /// The interval excludes zero.
    Mover { r: f64, n: u32, low: f64, high: f64 },
}

impl From<crate::RoutePerformanceResult> for FfiRoutePerformanceResult {
    fn from(r: crate::RoutePerformanceResult) -> Self {
        let trend_curves =
            crate::persistence::sections::trend_curve::route_trend_curves(&r.performances);
        let histograms =
            crate::persistence::sections::attempt_histogram::route_histograms(&r.performances);
        Self {
            trend_curves,
            histograms,
            performances: r
                .performances
                .into_iter()
                .map(FfiRoutePerformance::from)
                .collect(),
            activity_metrics: r
                .activity_metrics
                .into_iter()
                .map(FfiActivityMetrics::from)
                .collect(),
            best: r.best.map(FfiRoutePerformance::from),
            best_forward: r.best_forward.map(FfiRoutePerformance::from),
            best_reverse: r.best_reverse.map(FfiRoutePerformance::from),
            current_direction_best: r.current_direction_best.map(FfiRoutePerformance::from),
            forward_stats: r.forward_stats.map(FfiDirectionStats::from),
            reverse_stats: r.reverse_stats.map(FfiDirectionStats::from),
            current_rank: r.current_rank,
            attempt_count: r.attempt_count,
            percentile_rank: r.percentile_rank,
        }
    }
}

// ============================================================================
// Heatmap Types
// ============================================================================

/// Pre-computed daily activity intensity for the activity heatmap.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHeatmapDay {
    /// Date string in YYYY-MM-DD format
    pub date: String,
    /// Intensity bracket: 0 (none), 1 (light), 2 (medium-light), 3 (medium), 4 (high)
    pub intensity: u8,
    /// Longest activity duration in seconds for this day
    pub max_duration: f64,
    /// Number of activities on this day
    pub activity_count: u32,
}

// ============================================================================
// Batch Screen Data Types
// ============================================================================

/// Group summary with the representative polyline for the Routes screen.
/// Avoids N separate getRepresentativeRoute() calls.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiGroupWithPolyline {
    pub group_id: String,
    pub representative_id: String,
    pub activity_count: u32,
    pub custom_name: Option<String>,
    pub bounds: Option<FfiBounds>,
    /// Distance in meters (from representative activity's metrics)
    pub distance_meters: f64,
    /// Delta+varint encoded coordinates
    pub encoded_polyline: Vec<u8>,
    /// All sport types present in this group's activities
    pub sport_types: Vec<String>,
}

/// A section as the regional map draws it: a line, a colour key and a label.
///
/// The map used to take the whole `FfiSection` for this, which clones
/// `activity_ids`, one `activity_portions` record per traversal and the point
/// density per section, then converted every portion in JavaScript and threw all
/// of it away. These are the six fields the map actually reads.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiMapSection {
    pub id: String,
    /// The live name when the section has one, so the caller needs no overlay read.
    pub name: Option<String>,
    /// Every sport whose included outings have taken the section, sorted.
    pub sport_types: Vec<String>,
    /// Traversals, one per pass.
    pub visit_count: u32,
    pub distance_meters: f64,
    /// climb, descent, rolling, flat or loop; None when nothing says. With the
    /// grade below, this is what the auto-generated label is built from, so the
    /// map's names do not change when it stops taking the whole record.
    pub klass: Option<String>,
    /// Steepest grade (%) held over 300 m of the slice.
    pub max_grade_percent: Option<f64>,
    /// Delta+varint encoded coordinates, as every other track leaves the engine.
    pub encoded_polyline: Vec<u8>,
}

/// Section summary with embedded polyline for the Routes screen.
/// Carries each section's line so the screen needs no per-section read.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionWithPolyline {
    pub id: String,
    pub section_type: String,
    pub name: Option<String>,
    pub visit_count: u32,
    pub distance_meters: f64,
    pub activity_count: u32,
    pub confidence: f64,
    pub scale: Option<String>,
    pub bounds: Option<FfiBounds>,
    /// Delta+varint encoded coordinates
    pub encoded_polyline: Vec<u8>,
    /// Every sport whose included outings have taken the section, sorted.
    pub sport_types: Vec<String>,
    pub is_user_defined: bool,
    pub disabled: bool,
    pub superseded_by: Option<String>,
    pub elevation_gain_m: Option<f64>,
    pub elevation_loss_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub max_grade_percent: Option<f64>,
    pub klass: Option<String>,
    pub is_lift: bool,
    pub rank_score: Option<f64>,
    pub sport_rank_score: Option<f64>,
    /// The section's record was set on its most recent outing. The feed card
    /// and the activity plot both mark a record; this is the same fact keyed by
    /// section, so the sections list can mark it too.
    pub latest_is_record: bool,
    /// Faster or slower in the selected sport, or the sport with most visits.
    pub trend: Option<i8>,
}

/// The order the routes list is in. `Nearby` is the engine's own distance
/// ranking, which is why the order is an argument rather than something the
/// list redoes after it has been paged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiGroupSort {
    Nearby,
    Activities,
    Distance,
    Name,
}

/// The order the sections list is in. `Signature` is the engine's
/// interestingness percentile, pooled or within one sport.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiSectionSort {
    Nearby,
    Signature,
    Visits,
    Distance,
    Name,
}

/// The four kinds the sections list can hide. Each is true when that kind is
/// hidden, which is how the screen holds them.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionFilters {
    pub hide_custom: bool,
    pub hide_auto: bool,
    pub hide_disabled: bool,
    pub hide_unaccepted: bool,
}

/// Everything the Routes screen asks for in one call. The order, the search and
/// the filters are arguments because they have to be applied before the page is
/// taken: a sort over the page returns the longest route of the first fifty,
/// not of the library.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRoutesScreenQuery {
    pub group_limit: u32,
    pub group_offset: u32,
    pub section_limit: u32,
    pub section_offset: u32,
    pub min_group_activity_count: u32,
    pub group_sort: FfiGroupSort,
    /// Case-insensitive substring of the group name. Empty matches everything.
    pub group_search: String,
    pub section_sort: FfiSectionSort,
    /// Case-insensitive substring of the section name. Empty matches everything.
    pub section_search: String,
    pub section_filters: FfiSectionFilters,
    /// Keeps the groups whose members include this sport. A group is in every
    /// sport any member was recorded in, so a mixed route shows under each.
    pub group_sport_type: Option<String>,
    /// Keeps the sections taken in this sport, and makes `Signature` read the
    /// within-sport percentile rather than the pooled one.
    pub section_sport_type: Option<String>,
    pub user_lat: f64,
    pub user_lng: f64,
}

impl Default for FfiRoutesScreenQuery {
    /// The screen's own defaults: a page of fifty in the order the lists open
    /// in, nothing searched and nothing hidden.
    fn default() -> Self {
        Self {
            group_limit: 50,
            group_offset: 0,
            section_limit: 50,
            section_offset: 0,
            min_group_activity_count: 0,
            group_sort: FfiGroupSort::Activities,
            group_search: String::new(),
            section_sort: FfiSectionSort::Visits,
            section_search: String::new(),
            section_filters: FfiSectionFilters {
                hide_custom: false,
                hide_auto: false,
                hide_disabled: false,
                hide_unaccepted: false,
            },
            group_sport_type: None,
            section_sport_type: None,
            user_lat: f64::NAN,
            user_lng: f64::NAN,
        }
    }
}

/// All data needed by the Routes screen in a single FFI call.
/// Supports pagination via limit/offset for groups and sections.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRoutesScreenData {
    pub activity_count: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub oldest_date: Option<f64>,
    pub newest_date: Option<f64>,
    pub groups: Vec<FfiGroupWithPolyline>,
    pub sections: Vec<FfiSectionWithPolyline>,
    /// Whether more groups are available beyond the current page
    pub has_more_groups: bool,
    /// Whether more sections are available beyond the current page
    pub has_more_sections: bool,
    /// Whether route groups need recomputation (stale after activity removal)
    pub groups_dirty: bool,
    /// How many groups the search and the minimum activity count leave. This is
    /// what the page is taken out of, and what `has_more_groups` is measured
    /// against. `group_count` stays the whole catalogue.
    pub filtered_group_count: u32,
    /// How many sections the search and the hidden filters leave.
    pub filtered_section_count: u32,
    /// Auto sections the athlete has not accepted, over the whole catalogue and
    /// not the page, because this is the "N to review" figure.
    pub unaccepted_auto_count: u32,
    /// Auto sections the athlete has accepted, over the whole catalogue.
    pub accepted_auto_count: u32,
    /// Custom sections over the whole catalogue. The chip beside it filters the
    /// catalogue, so a page-sized tally would be a lower bound nothing labels.
    pub custom_count: u32,
    /// Auto sections the athlete retired, disabled or superseded, over the
    /// whole catalogue. Taken before `hide_disabled` runs, which is the filter
    /// this figure is the count for and which hides them by default.
    pub retired_count: u32,
    /// The sports the athlete has activities in, which the sport chips offer.
    pub available_sport_types: Vec<String>,
}

// ============================================================================
// Ranked Section Types (weighted relevance scoring)
// ============================================================================

/// What an improvement change was measured between.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiImprovementBasis {
    /// Median of the latest three efforts against the median of the three before.
    MedianOfThree,
    /// The latest effort against the first, with three to five efforts.
    FirstToLast,
}

/// A section ranked by composite relevance score combining recency, improvement,
/// anomaly detection, and engagement signals.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRankedSection {
    pub section_id: String,
    pub section_name: String,
    pub relevance_score: f64,
    pub recency_score: f64,
    pub improvement_score: f64,
    /// Signed fraction the athlete got faster by before the score clamps it,
    /// +0.14 for 14% faster and -1.5 for 150% slower. Absent with fewer than
    /// three efforts or a nonpositive earlier time, never an invented zero.
    pub improvement_change: Option<f64>,
    /// What `improvement_change` compares, absent when it is.
    pub improvement_basis: Option<FfiImprovementBasis>,
    pub anomaly_score: f64,
    pub engagement_score: f64,
    pub traversal_count: u32,
    pub best_time_secs: f64,
    pub median_recent_secs: f64,
    pub days_since_last: u32,
    /// -1 = declining, 0 = stable, 1 = improving
    pub trend: i8,
    /// Whether the most recent effort is the all-time best time
    pub latest_is_pr: bool,
    /// The last efforts on the section, oldest first, capped by the ranker's
    /// own limit. The scoring already holds every traversal to compute the
    /// medians above, so carrying the tail of them costs the ranker nothing.
    pub recent_efforts: Vec<FfiSeriesPoint>,
    /// The activity `best_time_secs` was set in. Absent when no stored
    /// traversal matches the best, which a stale rank cache can cause.
    pub best_activity_id: Option<String>,
}

/// Per-exercise contribution to a muscle group, aggregated across all active
/// sets of one activity. Role reflects whether the muscle is primary or
/// secondary for the exercise.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseContribution {
    pub name: String,
    /// "primary" | "secondary"
    pub role: String,
    pub sets: f64,
    pub reps: f64,
    pub volume_kg: f64,
}

/// Full muscle-group breakdown for one activity, one muscle slug. Rust groups
/// exercise sets by display name, classifies primary/secondary, and returns
/// totals - replacing the useMemo grouping/reducing in `useMuscleDetail`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleGroupDetail {
    pub slug: String,
    pub exercises: Vec<FfiExerciseContribution>,
    pub total_sets: f64,
    pub total_reps: f64,
    pub volume_kg: f64,
    pub primary_exercises: u32,
    pub secondary_exercises: u32,
}

/// One renderable chart point on the section-detail chart. One entry per
/// lap traversal (activities with multiple laps expand into multiple points).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionChartPoint {
    pub lap_id: String,
    pub activity_id: String,
    pub activity_name: String,
    /// Unix seconds
    pub activity_date: f64,
    /// m/s
    pub speed: f64,
    /// Section time for this lap (seconds)
    pub section_time: u32,
    pub section_distance: f64,
    /// "same" | "reverse"
    pub direction: String,
    /// The section record for this point's direction: the one traversal that
    /// beats every other by time over the whole included history, whatever
    /// range the chart shows. False for a tie, a lone traversal, and any point
    /// when the range holds no record traversal.
    pub is_best: bool,
    /// The lap's stored mean watts. `None` for a lap with no power stream and
    /// for a record without laps, which has no single lap to read it from.
    pub avg_power: Option<f64>,
}

/// Bundled chart payload for the section-detail screen. Rust composes
/// per-lap points, ranks, and summary stats from the performance records
/// it already owns so the TS hook stops iterating + sorting multiple times.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionChartData {
    pub points: Vec<FfiSectionChartPoint>,
    pub min_speed: f64,
    pub max_speed: f64,
    pub has_reverse_runs: bool,
    /// The quickest lap in the section's own direction.
    pub best_time_secs: Option<f64>,
    pub last_activity_date: Option<f64>,
    pub total_activities: u32,
}

/// Enriched workout section for the home-screen "Sections for you" list.
/// Composes ranking + performance lookups server-side so the TS hook is a
/// thin pass-through instead of a per-section FFI loop.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWorkoutSection {
    pub id: String,
    pub name: String,
    pub pr_time_secs: Option<f64>,
    /// Second-best time (prior PR before current best)
    pub previous_best_time_secs: Option<f64>,
    pub last_time_secs: Option<f64>,
    pub days_since_last: Option<i32>,
    pub pr_days_ago: Option<i32>,
    /// -1 = declining, 0 = stable, 1 = improving. None when there is not
    /// enough history to say.
    pub trend: Option<i8>,
}

// ============================================================================
// Calendar Summary Types
// ============================================================================

/// Best performance in one direction for a calendar period.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarDirectionBest {
    /// Number of traversals in this direction
    pub count: u32,
    /// Best time in seconds
    pub best_time: f64,
    /// Best pace in m/s
    pub best_pace: f64,
    /// Activity ID of best traversal
    pub best_activity_id: String,
    /// Name of best activity
    pub best_activity_name: String,
}

impl From<crate::CalendarDirectionBest> for FfiCalendarDirectionBest {
    fn from(d: crate::CalendarDirectionBest) -> Self {
        Self {
            count: d.count,
            best_time: d.best_time,
            best_pace: d.best_pace,
            best_activity_id: d.best_activity_id,
            best_activity_name: d.best_activity_name,
        }
    }
}

/// Best performance in a calendar month for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarMonthSummary {
    /// Month number (1-12)
    pub month: u32,
    /// Total traversals (both directions), one per lap
    pub traversal_count: u32,
    /// Distinct activities those traversals came from
    pub activity_count: u32,
    /// Best forward/same direction performance
    pub forward: Option<FfiCalendarDirectionBest>,
    /// Best reverse direction performance
    pub reverse: Option<FfiCalendarDirectionBest>,
}

impl From<crate::CalendarMonthSummary> for FfiCalendarMonthSummary {
    fn from(m: crate::CalendarMonthSummary) -> Self {
        Self {
            month: m.month,
            traversal_count: m.traversal_count,
            activity_count: m.activity_count,
            forward: m.forward.map(FfiCalendarDirectionBest::from),
            reverse: m.reverse.map(FfiCalendarDirectionBest::from),
        }
    }
}

/// Best performance in a calendar year for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarYearSummary {
    /// Calendar year
    pub year: i32,
    /// Total traversals in this year, one per lap
    pub traversal_count: u32,
    /// Distinct activities those traversals came from
    pub activity_count: u32,
    /// Best forward/same direction performance this year
    pub forward: Option<FfiCalendarDirectionBest>,
    /// Best reverse direction performance this year
    pub reverse: Option<FfiCalendarDirectionBest>,
    /// Monthly breakdowns (only months with traversals)
    pub months: Vec<FfiCalendarMonthSummary>,
}

impl From<crate::CalendarYearSummary> for FfiCalendarYearSummary {
    fn from(y: crate::CalendarYearSummary) -> Self {
        Self {
            year: y.year,
            traversal_count: y.traversal_count,
            activity_count: y.activity_count,
            forward: y.forward.map(FfiCalendarDirectionBest::from),
            reverse: y.reverse.map(FfiCalendarDirectionBest::from),
            months: y
                .months
                .into_iter()
                .map(FfiCalendarMonthSummary::from)
                .collect(),
        }
    }
}

/// Calendar-aligned performance summary for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarSummary {
    /// Year summaries (newest first)
    pub years: Vec<FfiCalendarYearSummary>,
    /// Overall forward/same PR
    pub forward_pr: Option<FfiCalendarDirectionBest>,
    /// Overall reverse PR
    pub reverse_pr: Option<FfiCalendarDirectionBest>,
    /// Section distance in meters
    pub section_distance: f64,
}

impl From<crate::CalendarSummary> for FfiCalendarSummary {
    fn from(s: crate::CalendarSummary) -> Self {
        Self {
            years: s
                .years
                .into_iter()
                .map(FfiCalendarYearSummary::from)
                .collect(),
            forward_pr: s.forward_pr.map(FfiCalendarDirectionBest::from),
            reverse_pr: s.reverse_pr.map(FfiCalendarDirectionBest::from),
            section_distance: s.section_distance,
        }
    }
}

// ============================================================================
// Activity Pattern Types
// ============================================================================

/// One Monday-anchored week of training totals, derived from
/// `activity_metrics`. Replaces the intervals.icu athlete-summary endpoint:
/// the screens read only these four numbers.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWeeklySummary {
    /// Monday of the week, epoch seconds at local midnight.
    pub week_start: f64,
    pub count: u32,
    /// Moving time in seconds.
    pub moving_time: f64,
    /// Distance in metres.
    pub distance: f64,
    /// Training load (TSS).
    pub training_load: f64,
}

/// One untyped calendar event payload, keyed by id and day.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCalendarEventBody {
    pub event_id: String,
    /// Event day as epoch seconds.
    pub date: f64,
    pub raw: String,
}

/// One untyped activity payload, keyed by id and start time. Demo seeding
/// writes these; a live sync writes them from the same shape.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityBody {
    pub activity_id: String,
    /// Start time as epoch seconds.
    pub date: f64,
    /// The untyped intervals.icu activity payload.
    pub raw: String,
}

/// The feed's sport chips. Cycling, running and swimming are the engine's
/// families and Other takes every sport outside them, so a sport nobody listed
/// still answers to a chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiFeedGroup {
    Cycling,
    Running,
    Swimming,
    Other,
}

impl FfiFeedGroup {
    /// The one chip a sport answers to.
    pub fn of(sport: &str) -> Self {
        if crate::sport::is_cycling(sport) {
            Self::Cycling
        } else if crate::sport::is_running(sport) {
            Self::Running
        } else if crate::sport::is_swimming(sport) {
            Self::Swimming
        } else {
            Self::Other
        }
    }
}

/// What the feed reads: the stored bodies in a window, narrowed by a search
/// and a sport chip, then paged. The match runs before the page is taken,
/// because the feed's own windows hold a few months and a search has to reach
/// every activity the library holds.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityBodiesQuery {
    /// Inclusive start time in epoch seconds. None reaches the oldest.
    pub oldest_ts: Option<f64>,
    /// Inclusive start time in epoch seconds. None reaches the newest.
    pub newest_ts: Option<f64>,
    /// Case-insensitive substring of the activity's name or sport. Empty
    /// matches everything.
    pub needle: String,
    /// An empty list matches every sport; otherwise any selected group matches.
    pub sport_groups: Vec<FfiFeedGroup>,
    pub offset: u32,
    /// None returns every match from the offset on.
    pub limit: Option<u32>,
}

/// One page of the feed's read, newest first.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityBodiesPage {
    /// Untyped intervals.icu activity payloads.
    pub bodies: Vec<String>,
    /// Every stored activity the query matched, not only this page.
    pub matched_count: u32,
    pub has_more: bool,
}

/// One activity's display name, for a caller that holds ids and has to draw
/// something an athlete recognises. Only the ids the engine knows are
/// answered, so the caller falls back to the id itself.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityName {
    pub activity_id: String,
    pub name: String,
    /// Start time as epoch seconds, so a caller can order what it draws.
    pub date: f64,
}

/// One wellness row passed in from TS (intervals.icu sync). Fields outside
/// this subset (sleepQuality, spO2, etc.) aren't persisted yet - the TS
/// sync helper only forwards the fields the Rust atomics consume.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWellnessRow {
    /// ISO-8601 YYYY-MM-DD
    pub date: String,
    pub ctl: Option<f64>,
    pub atl: Option<f64>,
    pub ramp_rate: Option<f64>,
    pub hrv: Option<f64>,
    pub resting_hr: Option<f64>,
    pub weight: Option<f64>,
    pub sleep_secs: Option<f64>,
    pub sleep_score: Option<f64>,
    pub soreness: Option<i32>,
    pub fatigue: Option<i32>,
    pub stress: Option<i32>,
    pub mood: Option<i32>,
    pub motivation: Option<i32>,
    /// The untyped intervals.icu body for this day, when the caller has it.
    /// Omitting it leaves any previously stored body intact.
    pub raw: Option<String>,
}

/// One sport's contribution to a day's load, as intervals.icu's `sportInfo`
/// carries it. The fitness chart's daily load bar is the sum of these.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSportLoad {
    /// The sport the entry stands for, as the API spells it ("Ride", "Run").
    pub sport_group: Option<String>,
    pub load: Option<f64>,
}

/// One stored wellness day, typed. This is what the wellness and fitness
/// screens read: every field they render, and nothing else.
///
/// The untyped body stays in the `raw` column for the Rust-side eFTP
/// derivation, which reads fields no screen does. It no longer crosses the
/// FFI, so no screen parses JSON to draw a chart.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWellnessDay {
    /// ISO-8601 YYYY-MM-DD
    pub date: String,
    pub ctl: Option<f64>,
    pub atl: Option<f64>,
    pub ramp_rate: Option<f64>,
    pub hrv: Option<f64>,
    pub resting_hr: Option<f64>,
    pub weight: Option<f64>,
    pub sleep_secs: Option<f64>,
    pub sleep_score: Option<f64>,
    pub soreness: Option<i32>,
    pub fatigue: Option<i32>,
    pub stress: Option<i32>,
    pub mood: Option<i32>,
    pub motivation: Option<i32>,
    /// Empty for a day synced before the body column existed, and for a day
    /// the API sent no per-sport breakdown for.
    pub sport_load: Vec<FfiSportLoad>,
}

/// Sparkline payload for the SummaryCard: rounded integer arrays, oldest
/// first, forward-filled where needed so renderers produce continuous lines.
/// Empty arrays mean "not enough data" (TS renders `undefined` / skips).
#[derive(Debug, Clone, uniffi::Record, Default)]
pub struct FfiWellnessSparklines {
    pub fitness: Vec<i32>,
    pub fatigue: Vec<i32>,
    pub form: Vec<i32>,
    pub hrv: Vec<i32>,
    pub rhr: Vec<i32>,
    /// Beside `hrv`, one per day: whether that day had a reading of its own
    /// or carries an earlier one forward. A scrub reads it so a filled day is
    /// not labelled with a value that was measured on another. Empty with
    /// `hrv`.
    pub hrv_read: Vec<bool>,
    /// The same for `rhr`.
    pub rhr_read: Vec<bool>,
    /// Last plotted fitness minus the first. `None` under two values.
    pub fitness_delta: Option<i32>,
    /// Indices into `fitness` of the days fitness rose over the day before by
    /// more than one CTL point.
    pub fitness_rise_days: Vec<u32>,
}

/// HRV trend summary over a trailing window. `label` is the i18n key suffix
/// ("trendingUp" | "stable" | "trendingDown") - TS resolves translations.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHrvTrend {
    pub label: String,
    /// Which rule produced `label`: `halves` for the window's two halves
    /// moving past the deadband, `lastTwoDays` for the override that two
    /// consecutive readings below the window mean fires. Both can say
    /// `trendingDown` and they are not the same claim.
    pub reason: String,
    pub avg: f64,
    pub latest: f64,
    pub data_points: u32,
    pub sparkline: Vec<FfiSeriesPoint>,
    /// Epoch seconds where the later half of the window starts, the split the
    /// `halves` rule judged. Absent for `lastTwoDays`, which judges no split.
    pub window_split: Option<f64>,
    /// The latest day against the window's average, in the window's own
    /// standard deviations. Absent where the window has no spread.
    pub signal_delta: Option<f64>,
}

/// Ranked sections for one sport, paired with the sport label. One element
/// per input sport in `get_ranked_sections_batch`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRankedSectionsBySport {
    pub sport_type: String,
    pub sections: Vec<FfiRankedSection>,
}

/// A detected recurring training pattern from k-means clustering.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityPattern {
    /// Sport type (e.g., "Ride", "Run")
    pub sport_type: String,
    /// Most common day of week (0=Mon..6=Sun)
    pub primary_day: u8,
    /// Average moving time in seconds
    pub avg_duration_secs: u32,
    /// Average training load (TSS)
    pub avg_tss: f64,
    /// Number of activities in this pattern
    pub activity_count: u32,
}

// ============================================================================
// Insights Batch Types
// ============================================================================

/// One point of a history series: a value and when it was recorded.
///
/// Every insight card draws a graphic of its own history, and the read carried
/// a series for two of eight generators. The rest carried summary numbers, so
/// a card either drew nothing or the sheet behind it read the engine again per
/// open. One shape serves all of them: a lap time against its activity date, an
/// eFTP against its day, a critical speed against its snapshot.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSeriesPoint {
    pub value: f64,
    /// Epoch seconds.
    pub date: f64,
    /// The activity the value was recorded in, for a series whose points are
    /// efforts. Absent where a point is a day's estimate with no activity
    /// behind it. A card marks and opens the activity a point stands on.
    pub activity_id: Option<String>,
}

/// A recent section PR detected in the last 7 days.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRecentPR {
    pub section_id: String,
    pub section_name: String,
    pub best_time: f64,
    pub days_ago: u32,
    /// The sport the record was set in. Shared ground holds a record in each
    /// sport that travels it and neither is measured against the other's laps,
    /// so a row that names no sport leaves the card labelling a run with a
    /// bicycle.
    pub sport_type: String,
    /// Traversals in that sport, one per pass. A record set over three outings
    /// and one set over fifty are different claims, and the ranker has no other
    /// way to tell them apart. It counted the section's own traversals until
    /// 2026-09-20, so three runs on a much-ridden climb claimed the rides.
    pub traversal_count: u32,
    /// The last efforts on the section, oldest first, capped by
    /// `FfiInsightsParams::history_limit`. What the card draws, so the list
    /// does not read the engine again per card to draw a line it already had.
    pub recent_efforts: Vec<FfiSeriesPoint>,
    /// The section's own line, delta+varint encoded as every other track
    /// leaves the engine, thinned to what a thumbnail can draw. A record on
    /// "section 6" says nothing about which stretch of road that is, and the
    /// summary this row is built from already holds the geometry.
    pub encoded_polyline: Vec<u8>,
    /// The activity the record was set in, so the section opens at its best
    /// effort. Absent when the record's activity cannot be named.
    pub best_activity_id: Option<String>,
}

/// One route's standing in one sport and one direction, for the insights
/// panel. A route ridden and run is two rows, and forward and reverse are two
/// more, because none of those attempts is measured against another's.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteInsight {
    pub route_id: String,
    pub route_name: String,
    pub sport_type: String,
    pub is_reverse: bool,
    /// The bucket's fastest counted attempt beats every other and fell inside
    /// the recent record window.
    pub is_recent_record: bool,
    /// -1 slower, 0 stable or too few attempts, 1 faster, on the median
    /// window rule sections use.
    pub trend: i8,
    /// The fastest counted attempt's moving time, in seconds.
    pub best_time: f64,
    /// Whole days from the newest counted attempt to the end of the current
    /// week.
    pub days_since_last: u32,
    /// Counted attempts: timed, not excluded, not partial, inside the
    /// distance band.
    pub attempt_count: u32,
    /// The last counted attempts' moving times, oldest first, capped by
    /// `FfiInsightsParams::history_limit`.
    pub recent_efforts: Vec<FfiSeriesPoint>,
}

/// Batch insights data: combines period stats, trends, patterns, and recent PRs.
/// Reduces Insights hook FFI calls from 13-16 to 1.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiInsightsData {
    /// Current week stats
    pub current_week: FfiPeriodStats,
    /// Previous week stats
    pub previous_week: FfiPeriodStats,
    /// 4-week chronic period stats (raw total, not averaged)
    pub chronic_period: FfiPeriodStats,
    /// `chronic_period` over the four weeks it is divided into, which is what
    /// a week is compared against.
    pub chronic_week_average: FfiPeriodStats,
    /// The four chronic weeks and then the compared week, one at a time,
    /// oldest first and each dated. The comparison card's claim is about the
    /// last four weeks, and two totals cannot draw it. The first four sum to
    /// `chronic_period`.
    pub weekly_totals: Vec<FfiWeeklyTotal>,
    /// FTP trend
    pub ftp_trend: FfiFtpTrend,
    /// Running pace trend
    pub run_pace_trend: FfiPaceTrend,
    /// Up to 3 recent section PRs (best times set in last 7 days)
    pub recent_prs: Vec<FfiRecentPR>,
    /// Sections held by the engine, for the section-readiness check
    pub section_count: u32,
    /// Sport types the ranked-section lists were built for
    pub sport_types: Vec<String>,
    /// ranked sections per sport, empty when sections were not requested
    pub ranked_sections: Vec<FfiRankedSectionsBySport>,
    /// Every eligible section trend, independent of the ranked-list display limit.
    pub trend_sections: Vec<FfiRankedSectionsBySport>,
    pub trend_faster_count: u32,
    pub trend_slower_count: u32,
    /// Every route bucket holding a recent record or an eligible trend, recent
    /// records first and then newest attempt. Not capped.
    pub route_insights: Vec<FfiRouteInsight>,
    pub route_record_count: u32,
    pub route_faster_count: u32,
    pub route_slower_count: u32,
    /// Aerobic efficiency trends worth surfacing, already filtered and capped
    pub efficiency_trends: Vec<FfiEfficiencyTrend>,
    /// Whether any strength activity exists
    pub has_strength_data: bool,
    /// Strength volume over the requested month and weeks, when data exists
    pub strength_series: Option<FfiStrengthInsightSeries>,
    /// Form as the newest day in the requested wellness window has it, or
    /// `None` when the window holds no day at all
    pub form: Option<FfiInsightForm>,
    /// This week against last, absent when neither total gives the earlier
    /// week something to divide by.
    pub week_over_week: Option<FfiPeriodComparison>,
    /// Last week against the chronic weekly average, on the same terms.
    pub week_against_chronic: Option<FfiPeriodComparison>,
    /// HRV over the trailing window, or `None` under five valid days
    pub hrv_trend: Option<FfiHrvTrend>,
    /// The date of the newest stored wellness row when `hrv_trend` is absent
    /// because the window is stale. `None` when the window is fresh or no
    /// wellness was ever synced.
    pub hrv_withheld_since: Option<String>,
    /// Re-cuts, splits, restores and reverts inside the requested window
    pub recent_section_changes: Vec<FfiSectionChange>,
    /// Sections a fitness gain makes worth revisiting, already excluding the
    /// ones `recent_prs` covers
    pub stale_pr_opportunities: Vec<FfiStalePrOpportunity>,
}

/// Scalar inputs for the insights bundle.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiInsightsParams {
    /// Start of the current week
    pub current_start: f64,
    /// Now
    pub current_end: f64,
    /// Start of the previous week
    pub prev_start: f64,
    /// End of the previous week
    pub prev_end: f64,
    /// Start of the four-week chronic window
    pub chronic_start: f64,
    /// Start of today
    pub today_start: f64,
    /// Whether section-derived insights are wanted at all
    pub include_sections: bool,
    /// Ranked sections requested per sport
    pub ranked_limit: u32,
    /// History points a card carries at most, per section and per trend. The
    /// graphic is a strip a few dozen pixels wide, so the read is capped
    /// rather than carrying a library of laps across the bridge.
    pub history_limit: u32,
    /// Sections last visited beyond this many days get no efficiency trend
    pub active_window_days: u32,
    /// Efficiency candidates taken from each sport's ranked list
    pub efficiency_per_sport: u32,
    /// Smallest rounded heart-rate change, in bpm, an efficiency trend may report
    pub efficiency_min_hr_change_bpm: u32,
    /// Efficiency trends to return at most
    pub efficiency_limit: u32,
    /// Minimum matched efforts before an efficiency trend counts
    pub efficiency_min_efforts: u32,
    pub efficiency_declining_min_efforts: u32,
    /// Trailing month the strength summary covers
    pub strength_month: FfiTimestampRange,
    /// Trailing weeks the strength summary covers
    pub strength_weeks: Vec<FfiTimestampRange>,
    /// Oldest day of the wellness window form is read from, `YYYY-MM-DD`
    pub wellness_oldest: String,
    /// Newest day of it, which is normally today in the athlete's own zone
    pub wellness_newest: String,
    /// Trailing days the HRV trend is read over
    pub hrv_window_days: u32,
    /// Trailing days the section-change list covers
    pub section_change_window_days: u32,
    /// A section unvisited for this many days is stale
    pub stale_threshold_days: u32,
    /// Fitness has to have risen by this much for a stale section to qualify
    pub stale_min_gain_percent: f64,
    /// Stale-PR opportunities to return at most
    pub stale_max_opportunities: u32,
    /// Fewest traversals a stale section needs to be offered
    pub stale_min_traversals: u32,
    /// A section record counts as recent when set within this many days
    pub recent_pr_window_days: u32,
    /// Fewest outings a section needs to hold a recent-record slot
    pub recent_pr_min_outings: u32,
}

/// Fitness and fatigue, as the newest day in the window has them.
///
/// The two were derived per recompute by sorting the window's rows, over rows
/// that had crossed the boundary only to be reduced to these. The day is carried so a stale reading can be named rather than
/// passed off as today's.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiInsightForm {
    /// The day the reading is from, `YYYY-MM-DD`
    pub date: String,
    /// Chronic training load, zero when the day carries none
    pub ctl: f64,
    /// Acute training load, zero when the day carries none
    pub atl: f64,
}

// ============================================================================
// Startup Batch Types
// ============================================================================

/// GPS track for a single activity (for feed map previews).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewTrack {
    pub activity_id: String,
    /// Delta+varint encoded coordinates
    pub encoded_coords: Vec<u8>,
}

/// The two things the feed paints on its first pass, in one call.
///
/// The insights record and the cached metric id list used to ride along here.
/// Neither reached the screen: the insights tab fetches its own copy when it
/// opens, and nothing ever read the id list.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStartupData {
    /// Summary card data (replaces getSummaryCardData)
    pub summary_card: FfiSummaryCardData,
    /// GPS tracks for initial visible activities (replaces N × getGpsTrack)
    pub preview_tracks: Vec<FfiPreviewTrack>,
    /// The card's sparklines, over the window the feed draws. `None` when the
    /// athlete has no wellness at all. Bundled here rather than fetched
    /// beside this read, which cost the feed a second call per wellness
    /// invalidation and every `activities` event causes one.
    pub sparklines: Option<FfiWellnessSparklines>,
    /// The activities whose feed card carries the new-activity ring, newest
    /// first. Empty on a library with no marker. The feed's rows come from the
    /// activity query, so this set is what marks them.
    pub new_activity_ids: Vec<String>,
}

/// What the feed tells the engine about its own use, which the new-activity
/// rings are decided from.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum FfiFeedSeen {
    /// The feed came to the front.
    Opened,
    /// The athlete tapped or scrolled past these rings.
    Dismissed { activity_ids: Vec<String> },
    /// The feed left the front.
    Closed,
}

impl From<FfiFeedSeen> for crate::persistence::feed_rings::FeedSeen {
    fn from(event: FfiFeedSeen) -> Self {
        use crate::persistence::feed_rings::FeedSeen;
        match event {
            FfiFeedSeen::Opened => FeedSeen::Opened,
            FfiFeedSeen::Dismissed { activity_ids } => FeedSeen::Dismissed { activity_ids },
            FfiFeedSeen::Closed => FeedSeen::Closed,
        }
    }
}

// ============================================================================
// Activity Detail Batch Types
// ============================================================================

/// One activity's portion of a single section, delta+varint encoded.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionTrace {
    /// Section the trace belongs to
    pub section_id: String,
    /// Delta+varint encoded coordinates of the activity's portion
    pub encoded_coords: Vec<u8>,
}

/// All data needed to paint the activity detail screen in one call.
/// Replaces a fan-out that grew one trace extraction per matched section.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityDetailData {
    /// Exercise groups for this activity, with best sets and rest intervals.
    pub exercise_groups: Vec<FfiExerciseGroup>,
    /// This activity's addition to the daily fitness, fatigue and form loads.
    pub fitness_impact: Option<FfiActivityFitnessImpact>,
    /// Total activities held by the engine
    pub activity_count: u32,
    /// Total sections held by the engine
    pub section_count: u32,
    /// The route group this activity belongs to, if it meets the caller's
    /// minimum. At most one: the screen asks which group holds this activity,
    /// so the catalogue was what it searched rather than what it needed.
    pub route_groups: Vec<FfiRouteGroup>,
    /// Visible sections this activity traverses, most-visited first.
    ///
    /// The light record: the screen draws the line, the name and the counts
    /// and never reads the member list, which on a 30-section activity was
    /// several hundred id strings lifted across JSI on the mount.
    pub matched_sections: Vec<FfiSectionWithPolyline>,
    /// Visible custom sections naming this activity that `matched_sections`
    /// does not already carry. Not the whole custom catalogue: the screen
    /// filtered it to exactly this on the far side of the call.
    pub custom_sections: Vec<FfiSection>,
    /// One entry per (section, direction) this activity encountered
    pub encounters: Vec<FfiSectionEncounter>,
    /// Section indicators and route highlights for this activity
    pub highlights: FfiActivityHighlightsBundle,
    /// This activity's portion of every section it matches
    pub section_traces: Vec<FfiSectionTrace>,
    /// Sections where this activity currently holds the best record
    pub pr_section_ids: Vec<String>,
    /// The max HR this activity's heart rate is read against: the top of its
    /// own zones, then the sport setting for its type, then the local zones
    /// setting, then 190. The stat card and the zones chart both divide by it.
    pub max_hr: f64,
    /// The heart rate zone bands for this activity and the time in each, from
    /// the same resolver live recording classifies with. Empty when the
    /// activity has no heart rate time to show.
    pub hr_zones: Vec<FfiHrZoneBand>,
    /// Section changes whose ledger rows name this activity, newest first.
    pub ledger_changes: Vec<FfiActivityLedgerChange>,
}

/// An activity's contribution against a rest day, before display rounding.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityFitnessImpact {
    pub fitness: f64,
    pub fatigue: f64,
    pub form: f64,
}

/// One heart rate zone of a saved activity.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHrZoneBand {
    /// Zone number, from 1
    pub zone: u32,
    /// Lower edge in bpm, 0 for zone 1
    pub min_bpm: u32,
    /// Upper edge in bpm
    pub max_bpm: u32,
    /// Seconds spent in the zone
    pub seconds: f64,
    /// Share of the total time in zones, 0 to 100
    pub percent: f64,
}

// ============================================================================
// Section Detail Batch Types
// ============================================================================

/// How a section left the catalogue, for the page that can no longer show it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionRetirement {
    /// dissolved, merged or superseded
    pub kind: String,
    pub at: String,
    /// The live section that took its ground, following the chain to its end
    pub into: Option<String>,
    /// Display name of `into`, when it has one
    pub into_name: Option<String>,
}

/// The section detail reads that do not depend on time streams.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// The section itself, or `None` when the ID is unknown
    pub section: Option<FfiSection>,
    /// How the section left the catalogue, when the ID has no row and the
    /// ledger holds its departure
    pub retirement: Option<FfiSectionRetirement>,
    /// Sections this one could merge with
    pub merge_candidates: Vec<FfiMergeCandidate>,
    /// Activities the user excluded from this section
    pub excluded_activity_ids: Vec<String>,
    /// Whether the original bounds can still be restored
    pub has_original_bounds: bool,
    /// Metrics for every activity on the section
    pub activity_metrics: Vec<FfiActivityMetrics>,
    /// Simplified GPS signatures for scrub-time trace display
    pub map_signatures: Vec<FfiMapSignature>,
    /// Activities whose time streams still have to be fetched
    pub missing_time_stream_ids: Vec<String>,
    /// The section's change ledger, oldest first
    pub history: Vec<FfiSectionHistoryEvent>,
    /// Every stored geometry version, with the pinned one flagged
    pub geometry_versions: Vec<FfiSectionGeometryVersion>,
    /// The pinned version, or `None` when the section follows the newest cut
    pub pinned_version: Option<f64>,
    /// Efficiency trend, or `None` with too few efforts to call one
    pub efficiency_trend: Option<FfiEfficiencyTrend>,
}

/// How many traversals of a section one sport made over the chosen range.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionSportCount {
    pub sport_type: String,
    /// Laps the chart would plot under this sport, not activities.
    pub count: u32,
}

/// The section detail reads that need lap times, all for one sport and one
/// range, so no two figures on the screen disagree about which laps count.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionPerformanceData {
    /// The sport this answer is for: the one asked for, or with none asked
    /// on ground more than one sport has taken, the one with the most
    /// outings. `None` when no traversal has a known sport.
    pub sport_type: Option<String>,
    /// Laps per sport over the range, the pills' counts, most outings first.
    pub sport_counts: Vec<FfiSectionSportCount>,
    /// Year and month performance history over the whole record, or `None`
    /// with no records
    pub calendar_summary: Option<FfiCalendarSummary>,
    /// Per-activity performance records inside the range, with the bests and
    /// direction stats taken over them
    pub performances: FfiSectionPerformanceResult,
    /// Pre-computed chart payload for the range
    pub chart_data: FfiSectionChartData,
    /// The excluded traversals inside the range, as chart points, for the
    /// show-excluded view. Never counted, fitted or ranked.
    pub excluded_points: Vec<FfiSectionChartPoint>,
    /// Every activity's laps over the whole record, included and excluded,
    /// each flagged: the lap list, where an excluded lap keeps its undo.
    pub lap_records: Vec<FfiSectionPerformanceRecord>,
    /// True when the forward best shown is the forward record: the same lap
    /// as the best over the whole included history, and a strict beat of that
    /// history's second best. A ranged best that is not is only the best of
    /// the range.
    pub best_forward_is_record: bool,
    /// The same for the reverse best.
    pub best_reverse_is_record: bool,
    /// The trend curve and band over the counted attempts of the range, for
    /// the scatter chart.
    pub trend_curves: FfiSectionTrendCurves,
    /// The histogram of those attempts' section times, per direction.
    pub histograms: FfiAttemptHistograms,
    /// Each recorded wellness variable's relationship to attempt speed over
    /// the counted attempts, per direction.
    pub correlations: Vec<FfiSectionCorrelation>,
    /// Complete pairs a variable needed before its correlation carries a
    /// figure: the floor every `TooFew` above fell short of.
    pub correlation_floor: u32,
    /// Each lap's time won or lost against the section's reference at every
    /// point along it, for the laps inside the range. `None` when neither
    /// direction holds a lap to compare with its reference.
    pub curves: Option<FfiSectionLapCurves>,
}

/// Which lap a direction's deltas are measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiReferenceSource {
    /// The direction's record over the whole included history.
    Record,
    /// The activity the athlete set as the section's reference.
    AthleteSet,
}

/// Why a lap in range has no delta curve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiLapDeltaMissingReason {
    /// The activity has no stored time stream.
    NoTimeStream,
    /// The stored time stream is not the track's length, so its indices are
    /// not the track's.
    MisalignedTimeStream,
    /// The activity has no track, or the lap does not advance along the
    /// section's line by a grid step.
    NotProjectable,
}

/// The distance-domain deltas of one sport's laps on a section, per direction.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionLapCurves {
    /// Metres between two points of a lap's `delta_secs`.
    pub grid_step_m: f64,
    /// Metres each of a lap's `split_delta_secs` spans; the last is short.
    pub split_step_m: f64,
    /// The section's line length the grid runs over.
    pub section_length_m: f64,
    pub forward: Option<FfiDirectionDeltas>,
    pub reverse: Option<FfiDirectionDeltas>,
}

/// One direction's laps measured against its reference, on an axis running
/// in the direction of travel.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDirectionDeltas {
    pub reference_activity_id: String,
    pub reference_source: FfiReferenceSource,
    /// Oldest first. The reference is among them, level with itself, when it
    /// is inside the range.
    pub laps: Vec<FfiLapDelta>,
    /// Laps inside the range that could not be drawn, and why.
    pub missing: Vec<FfiLapDeltaMissing>,
}

/// One lap's time against the reference along the section.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiLapDelta {
    pub activity_id: String,
    /// Joins the curve to its chart point and lap row.
    pub start_index: u32,
    /// Unix seconds
    pub activity_date: f64,
    /// Seconds behind the reference (positive) or ahead of it (negative) at
    /// each grid point from the start of travel, zero at the first shared point and
    /// NaN outside the covered range.
    pub delta_secs: Vec<f32>,
    /// The change in delta over each split, in travel order. NaN for a split
    /// the lap does not fully cover.
    pub split_delta_secs: Vec<f32>,
    /// The delta at the end of the section, only for a lap that covers both
    /// of its ends.
    pub end_delta_secs: Option<f32>,
}

/// A lap inside the range with no curve.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiLapDeltaMissing {
    pub activity_id: String,
    pub start_index: u32,
    /// Unix seconds
    pub activity_date: f64,
    pub reason: FfiLapDeltaMissingReason,
}

/// One point on a trend curve with its band, clamped to the attempts' range.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct FfiTrendBandPoint {
    /// Unix seconds
    pub time: f64,
    pub value: f64,
    pub upper: f64,
    pub lower: f64,
}

/// The Gaussian kernel trend of a section's counted attempts, per direction
/// and axis. `None` for a direction with fewer than two attempts. Excluded
/// attempts are never in it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionTrendCurves {
    /// Speed in m/s, forward attempts
    pub forward_speed: Option<Vec<FfiTrendBandPoint>>,
    /// Section time in seconds, forward attempts
    pub forward_time: Option<Vec<FfiTrendBandPoint>>,
    /// Speed in m/s, reverse attempts
    pub reverse_speed: Option<Vec<FfiTrendBandPoint>>,
    /// Section time in seconds, reverse attempts
    pub reverse_time: Option<Vec<FfiTrendBandPoint>>,
}

/// The counted attempts' times binned for the histogram plot, per direction.
/// `None` for a direction with fewer than three counted attempts. Excluded
/// attempts are never in it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiAttemptHistograms {
    pub forward: Option<FfiAttemptHistogram>,
    pub reverse: Option<FfiAttemptHistogram>,
}

/// Equal-width bins of attempt time. Bin `i` covers
/// `[start_secs + i * bin_width_secs, start_secs + (i + 1) * bin_width_secs)`
/// and the last bin is closed.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiAttemptHistogram {
    pub start_secs: f64,
    pub bin_width_secs: f64,
    pub counts: Vec<u32>,
    /// A section's speed in m/s over each bin edge, `counts.len() + 1` values,
    /// so the axis is labelled in the scatter's unit. `None` for a route,
    /// whose attempts differ in length and whose scatter plots time. An edge
    /// at zero seconds reads 0.
    pub edge_speeds: Option<Vec<f64>>,
    /// Attempts in the bins.
    pub binned: u32,
    /// Route attempts the scatter draws that the bins leave out for lying
    /// outside the distance band. Zero for a section.
    pub unbinned_outside_band: u32,
}

// ============================================================================
// Route Detail Batch Types
// ============================================================================

/// Everything the route detail screen paints with in one call.
///
/// The performances are unfiltered: the screen derives its sport pills from
/// them and only asks for a filtered read once the user picks a sport.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// The route itself, or `None` when the ID is unknown
    pub group: Option<FfiRouteGroup>,
    /// Route groups above the caller's minimum, most attempts first
    pub groups: Vec<FfiRouteGroup>,
    /// Every attempt on the route, across sports
    pub performances: FfiRoutePerformanceResult,
    /// The representative activity's distance in meters, the figure the routes
    /// list shows and sorts on. Zero when the route is unknown.
    pub distance_meters: f64,
    /// Unix timestamp of the newest attempt across every sport, `None` when
    /// the route has no attempts.
    pub last_activity_date: Option<f64>,
    /// Representative activity's polyline, delta+varint encoded
    pub encoded_representative: Vec<u8>,
    /// User-set route names by route ID
    pub route_names: std::collections::HashMap<String, String>,
    /// Activities the user excluded from this route
    pub excluded_activity_ids: Vec<String>,
    /// Simplified GPS signatures for the route's activities
    pub map_signatures: Vec<FfiMapSignature>,
}

// ============================================================================
// Widget Snapshot Batch Types
// ============================================================================

/// Everything the home-screen widget snapshot is composed from.
///
/// Widgets run in a separate process and cannot reach the engine, so their
/// content is baked by `widget_snapshot`. This is the single read that feeds it.
#[derive(Debug, Clone, Default)]
pub struct FfiWidgetSnapshotData {
    /// Trailing wellness sparklines, `None` until wellness has synced
    pub sparklines: Option<FfiWellnessSparklines>,
    /// This week and last week, with the trends the widget shows
    pub summary: WidgetSummaryCardData,
    /// The most recent activity, or `None` when there are none
    pub latest: Option<FfiActivityMetrics>,
    /// Whether the latest activity carries a route or section record
    pub latest_is_pr: bool,
    /// The latest activity's GPS track, empty for indoor activities
    pub latest_gps: Vec<FfiGpsPoint>,
    /// The ramp rate intervals.icu computed, off the newest wellness day that
    /// carries one. `None` before wellness has synced. The widget derived its
    /// own from the fitness sparkline, which is a different number from the
    /// same data.
    pub ramp_rate: Option<f64>,
}

// ============================================================================
// Best Efforts Screen Types
// ============================================================================

/// Everything the Best Efforts screen paints with, over one period.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBestEffortsData {
    /// Ride power, then Run and Swim pace.
    pub sports: Vec<FfiBestEffortsSport>,
    /// The Ride and Run climbing families.
    pub climbing: Vec<FfiClimbBests>,
}

/// One sport's bests at the screen's checkpoints, read from its stored curve.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBestEffortsSport {
    pub sport: String,
    /// False when the curve for this period was never fetched, which is the
    /// cue to ask for it. Every value is then empty.
    pub fetched: bool,
    pub efforts: Vec<FfiBestEffort>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBestEffort {
    pub label: String,
    /// Seconds for power, metres for pace.
    pub checkpoint: f64,
    /// Watts for power, metres per second for pace. Empty when the curve
    /// holds no sample within tolerance of the checkpoint.
    pub value: Option<f64>,
    /// Seconds taken to cover the distance, for pace only.
    pub time: Option<f64>,
    pub activity_id: Option<String>,
}

/// A climbing family's best window per stored length.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiClimbBests {
    pub sport: String,
    /// Activities in the period whose climb rows are still being computed.
    pub owed: u32,
    /// Activities in the period holding climb rows whose elevation is not the
    /// corrected series, so they are left out of the bests.
    pub source_excluded: u32,
    /// One per stored window length, shortest first.
    pub bests: Vec<FfiClimbBest>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiClimbBest {
    pub label: String,
    pub window_s: u32,
    /// Vertical metres per hour. Empty when no activity measured the window.
    pub vam: Option<f64>,
    pub watts_per_kg: Option<f64>,
    pub activity_id: Option<String>,
}

// ============================================================================
// Training Screen Types
// ============================================================================

/// The windows the training tab draws, each fixed for as long as it stays
/// mounted. The front end names them because its grid and its season cards
/// lay out the same days.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTrainingScreenWindows {
    /// The heatmap's first and last drawn day, `YYYY-MM-DD`, inclusive.
    pub heatmap_first_day: String,
    pub heatmap_last_day: String,
    /// The span the monthly rows cover.
    pub months: FfiTimestampRange,
    /// The year to date, and the same span of last year.
    pub year_current: FfiTimestampRange,
    pub year_previous: FfiTimestampRange,
    /// The month to date, and the same span of the month a year before.
    pub month_current: FfiTimestampRange,
    pub month_previous: FfiTimestampRange,
}

/// Everything the training tab paints with that stays fixed while it is
/// mounted. The weekly card's range is chosen with a tap, so its totals are
/// their own read.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTrainingScreenData {
    /// Days with activities inside the heatmap's window, oldest first.
    pub heatmap: Vec<FfiHeatmapDay>,
    /// Calendar months with activities inside the monthly span, oldest first.
    pub months: Vec<FfiMonthlyStats>,
    pub year_current: FfiPeriodStats,
    pub year_previous: FfiPeriodStats,
    pub month_current: FfiPeriodStats,
    pub month_previous: FfiPeriodStats,
}

// ============================================================================
// Fitness Screen Types
// ============================================================================

/// Everything the fitness tab paints with that stays fixed while it is
/// mounted. Its range and sport are chosen with a tap, so the reads over them
/// are their own.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiFitnessScreenData {
    /// The cycling eFTP compared across the chart's three months, with the
    /// daily series of that window and every activity that moved it.
    pub ftp_trend: FfiFtpTrend,
    /// The last stored critical speeds, the threshold the running and
    /// swimming cards fall back on when no curve is to hand.
    pub run_pace_trend: FfiPaceTrend,
    pub swim_pace_trend: FfiPaceTrend,
}

// ============================================================================
// Map Screen Batch Types
// ============================================================================

/// Everything the map tab paints with in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapScreenData {
    /// Total activities held by the engine, before the date and sport filters
    pub activity_count: u32,
    /// Sport types with at least one activity
    pub available_sport_types: Vec<String>,
    /// Mapped activities by display group in the date window before filters
    pub category_counts: Vec<FfiMapCategoryCount>,
    /// Activities inside the requested window and sport filter
    pub activities: Vec<crate::persistence::MapActivityComplete>,
    /// Routes the map can draw: groups of at least two activities with a
    /// stored line. Zero while the route-line layer is stale.
    pub route_count: u32,
    /// The pre-built route lines, present only when the read asked for them
    /// and the layer is current
    pub route_lines: Option<FfiRouteLineLayer>,
    /// Visible sections, regardless of whether the overlay was requested
    pub section_count: u32,
    /// Map sections with lines, present only while the layer is requested
    pub sections: Option<Vec<FfiMapSection>>,
}

/// The route-line layer the map draws, with the generation it was built from
/// so the front end can keep what it decoded while the generation is unchanged.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteLineLayer {
    /// The route group generation the lines were built from. Declared as a
    /// double, which holds every generation a library reaches exactly.
    pub generation: f64,
    pub routes: Vec<FfiRouteLine>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteLine {
    pub route_id: String,
    /// The number the route is shown under, absent until one is minted
    pub route_number: Option<u32>,
    /// The representative's signature in `codec::encode_polyline` form
    pub polyline: Vec<u8>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapCategoryCount {
    pub category: String,
    pub count: u32,
}

// ============================================================================
// Helper functions
// ============================================================================

// ============================================================================
// Aerobic Efficiency Types
// ============================================================================

/// A single data point for aerobic efficiency tracking.
/// Represents one section traversal with pace and heart rate data.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiEfficiencyPoint {
    /// Unix timestamp of the activity
    pub date: f64,
    /// Pace in seconds per km
    pub pace_secs_per_km: f64,
    /// Average heart rate during this traversal
    pub avg_hr: f64,
    /// Heart rate per unit of speed: avg_hr * pace_secs_per_km. Lower is
    /// fewer beats for the same speed, which is more efficient.
    pub hr_pace_ratio: f64,
}

/// Direction of the ratio's trend over matched section efforts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum EfficiencyDirection {
    Improving,
    Flat,
    Worsening,
}

/// Tracks how heart rate per unit of speed changes over time across matched
/// section efforts. A declining ratio indicates improving aerobic efficiency
/// (Coyle et al., J Appl Physiol, 1991; Jones & Carter, Sports Med, 2000).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiEfficiencyTrend {
    /// Section ID
    pub section_id: String,
    /// The sport the trend was taken over: efforts of other sports on the
    /// section are not in it
    pub sport_type: String,
    /// Section name
    pub section_name: String,
    /// Individual data points sorted by date (oldest first)
    pub points: Vec<FfiEfficiencyPoint>,
    /// Linear regression slope of the ratio over time (negative = improving)
    pub trend_slope: f64,
    /// Direction of the ratio's significant movement.
    pub direction: EfficiencyDirection,
    /// The ratio's own change over the observed range, restated in bpm at the
    /// mean pace. Not a measured heart rate delta: an effort set that only
    /// changed pace moves it too.
    pub hr_change_bpm: f64,
    /// Efforts the regression used: both signals present and a plausible pace
    pub effort_count: u32,
    /// The newest effort's ratio against the mean of the series, in the
    /// series' own standard deviations. Absent where the series has no spread
    /// to measure against.
    pub signal_delta: Option<f64>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    //! The fixtures here are exhaustive struct literals on purpose: a new
    //! field on a source type breaks this build, while the `From` impl would
    //! keep compiling and quietly stop carrying it. Every value is distinct so
    //! a transposed pair of same-typed fields fails rather than passing.
    use super::*;

    fn direction_stats() -> crate::DirectionStats {
        crate::DirectionStats {
            avg_time: Some(300.0),
            last_activity: Some(1700000000),
            count: 5,
            avg_speed: Some(4.5),
        }
    }

    fn section_lap() -> crate::SectionLap {
        crate::SectionLap {
            id: "lap_1".to_string(),
            activity_id: "act_123".to_string(),
            time: 120.5,
            pace: 8.3,
            distance: 1000.0,
            direction: "same".to_string(),
            start_index: 17,
            end_index: 104,
            avg_hr: Some(142.0),
            avg_power: Some(250.0),
            coverage: Some(1.0),
            excluded: false,
        }
    }

    fn section_record(direction: &str, best_time: f64) -> crate::SectionPerformanceRecord {
        crate::SectionPerformanceRecord {
            activity_id: format!("act_{direction}"),
            activity_name: format!("{direction} effort"),
            activity_date: 1700000000,
            laps: vec![section_lap()],
            lap_count: 1,
            best_time,
            best_pace: 8.3,
            best_forward_time: (direction == "same").then_some(best_time),
            best_reverse_time: (direction == "reverse").then_some(best_time),
            avg_time: best_time + 4.0,
            avg_pace: 7.9,
            direction: direction.to_string(),
            section_distance: 1000.0,
        }
    }

    fn route_performance(activity_id: &str, speed: f64) -> crate::RoutePerformance {
        crate::RoutePerformance {
            activity_id: activity_id.to_string(),
            name: "Morning Ride".to_string(),
            date: 1700000000,
            speed,
            duration: 3600,
            moving_time: 3500,
            distance: 30000.0,
            elevation_gain: 500.0,
            avg_hr: Some(145),
            avg_power: Some(200),
            is_current: false,
            direction: "same".to_string(),
            match_percentage: Some(95.5),
            outside_distance_band: false,
            is_record: false,
        }
    }

    fn activity_metrics() -> crate::ActivityMetrics {
        crate::ActivityMetrics {
            activity_id: "act_123".to_string(),
            name: "Morning Ride".to_string(),
            date: 1700000000,
            distance: 30000.0,
            moving_time: 3500,
            elapsed_time: 3600,
            elevation_gain: 500.0,
            avg_hr: Some(145),
            avg_power: Some(200),
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    #[test]
    fn direction_stats_carries_every_field() {
        let ffi = FfiDirectionStats::from(direction_stats());
        assert_eq!(ffi.avg_time, Some(300.0));
        assert_eq!(ffi.last_activity, Some(1_700_000_000.0));
        assert_eq!(ffi.count, 5);
        // avg_speed and avg_time are both Option<f64>: a transposition here
        // would show route stats as a speed in a seconds field.
        assert_eq!(ffi.avg_speed, Some(4.5));
    }

    #[test]
    fn direction_stats_keeps_an_absent_speed_absent() {
        let mut stats = direction_stats();
        stats.avg_speed = None;
        let ffi = FfiDirectionStats::from(stats);
        assert_eq!(ffi.avg_time, Some(300.0));
        assert!(ffi.avg_speed.is_none());
    }

    #[test]
    fn section_lap_carries_every_field() {
        let ffi = FfiSectionLap::from(section_lap());
        assert_eq!(ffi.id, "lap_1");
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.time, 120.5);
        assert_eq!(ffi.pace, 8.3);
        assert_eq!(ffi.distance, 1000.0);
        assert_eq!(ffi.direction, "same");
        // Swapped track indices would draw the lap backwards on the map.
        assert_eq!(ffi.start_index, 17);
        assert_eq!(ffi.end_index, 104);
        assert_eq!(ffi.avg_power, Some(250.0));
    }

    #[test]
    fn section_performance_record_carries_every_field() {
        let ffi = FfiSectionPerformanceRecord::from(section_record("same", 120.5));
        assert_eq!(ffi.activity_id, "act_same");
        assert_eq!(ffi.activity_name, "same effort");
        assert_eq!(ffi.activity_date, 1_700_000_000.0);
        assert_eq!(ffi.lap_count, 1);
        // best_* against avg_*: a transposition would report the average as
        // the PR on the section detail.
        assert_eq!(ffi.best_time, 120.5);
        assert_eq!(ffi.avg_time, 124.5);
        assert_eq!(ffi.best_pace, 8.3);
        assert_eq!(ffi.avg_pace, 7.9);
        assert_eq!(ffi.direction, "same");
        assert_eq!(ffi.section_distance, 1000.0);

        assert_eq!(ffi.laps.len(), 1);
        assert_eq!(ffi.laps[0].id, "lap_1");
        assert_eq!(ffi.laps[0].start_index, 17);
    }

    #[test]
    fn route_performance_keeps_duration_and_moving_time_apart() {
        // The route PR delta chip is moving-time based, so a swap of these two
        // u32 fields would silently compare the wrong clock.
        let ffi = FfiRoutePerformance::from(route_performance("act_123", 8.5));
        assert_eq!(ffi.duration, 3600, "duration is elapsed time");
        assert_eq!(ffi.moving_time, 3500, "moving_time is moving time");
    }

    #[test]
    fn route_performance_carries_every_field() {
        let ffi = FfiRoutePerformance::from(route_performance("act_123", 8.5));
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.name, "Morning Ride");
        assert_eq!(ffi.date, 1_700_000_000.0);
        assert_eq!(ffi.speed, 8.5);
        assert_eq!(ffi.distance, 30000.0);
        assert_eq!(ffi.elevation_gain, 500.0);
        assert_eq!(ffi.avg_hr, Some(145));
        assert_eq!(ffi.avg_power, Some(200));
        assert!(!ffi.is_current);
        assert_eq!(ffi.direction, "same");
        assert_eq!(ffi.match_percentage, Some(95.5));
    }

    #[test]
    fn activity_metrics_keeps_moving_and_elapsed_time_apart() {
        let ffi = FfiActivityMetrics::from(activity_metrics());
        assert_eq!(ffi.moving_time, 3500);
        assert_eq!(ffi.elapsed_time, 3600);
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.name, "Morning Ride");
        assert_eq!(ffi.date, 1_700_000_000.0);
        assert_eq!(ffi.distance, 30000.0);
        assert_eq!(ffi.elevation_gain, 500.0);
        assert_eq!(ffi.avg_hr, Some(145));
        assert_eq!(ffi.avg_power, Some(200));
        assert_eq!(ffi.sport_type, "Ride");
        // The fixture carries none of the four, and the conversion must not
        // invent one.
        assert!(ffi.training_load.is_none());
        assert!(ffi.ftp.is_none());
        assert!(ffi.power_zone_times.is_none());
        assert!(ffi.hr_zone_times.is_none());
    }

    #[test]
    fn activity_metrics_round_trips_back_without_drift() {
        let original = activity_metrics();
        let back = crate::ActivityMetrics::from(FfiActivityMetrics::from(original.clone()));
        assert_eq!(back.activity_id, original.activity_id);
        assert_eq!(back.name, original.name);
        assert_eq!(back.date, original.date);
        assert_eq!(back.distance, original.distance);
        assert_eq!(back.moving_time, original.moving_time);
        assert_eq!(back.elapsed_time, original.elapsed_time);
        assert_eq!(back.elevation_gain, original.elevation_gain);
        assert_eq!(back.avg_hr, original.avg_hr);
        assert_eq!(back.avg_power, original.avg_power);
        assert_eq!(back.sport_type, original.sport_type);
    }

    #[test]
    fn activity_metric_zone_vectors_are_input_only_on_ffi() {
        let mut metrics = activity_metrics();
        metrics.power_zone_times = Some(vec![10, 20]);
        metrics.hr_zone_times = Some(vec![30, 40]);
        let mut outbound = FfiActivityMetrics::from(metrics);
        assert_eq!(outbound.power_zone_times, None);
        assert_eq!(outbound.hr_zone_times, None);

        outbound.power_zone_times = Some(vec![10, 20]);
        outbound.hr_zone_times = Some(vec![30, 40]);
        let input = crate::ActivityMetrics::from(outbound);
        assert_eq!(input.power_zone_times, Some(vec![10, 20]));
        assert_eq!(input.hr_zone_times, Some(vec![30, 40]));
    }

    #[test]
    fn section_performance_result_keeps_its_option_slots_distinct() {
        let result = crate::SectionPerformanceResult {
            records: vec![
                section_record("same", 120.5),
                section_record("reverse", 131.0),
            ],
            best_forward_record: Some(section_record("same", 120.5)),
            best_reverse_record: Some(section_record("reverse", 131.0)),
            forward_stats: Some(crate::DirectionStats {
                avg_time: Some(300.0),
                last_activity: Some(1700000000),
                count: 5,
                avg_speed: Some(4.5),
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(1690000000),
                count: 2,
                avg_speed: Some(3.1),
            }),
        };

        let ffi = FfiSectionPerformanceResult::from(result);
        assert_eq!(ffi.records.len(), 2);
        assert_eq!(ffi.records[0].direction, "same");
        assert_eq!(ffi.records[1].direction, "reverse");
        // Crossing these three slots would show the wrong PR per direction.
        assert_eq!(ffi.best_forward_record.as_ref().unwrap().best_time, 120.5);
        assert_eq!(ffi.best_reverse_record.as_ref().unwrap().best_time, 131.0);
        assert_eq!(ffi.forward_stats.as_ref().unwrap().count, 5);
        assert_eq!(ffi.reverse_stats.as_ref().unwrap().count, 2);
    }

    #[test]
    fn route_performance_result_keeps_its_option_slots_distinct() {
        let result = crate::RoutePerformanceResult {
            performances: vec![
                route_performance("act_1", 7.0),
                route_performance("act_2", 8.5),
            ],
            activity_metrics: vec![activity_metrics()],
            best: Some(route_performance("act_best", 9.9)),
            best_forward: Some(route_performance("act_fwd", 8.5)),
            best_reverse: Some(route_performance("act_rev", 6.2)),
            current_direction_best: Some(route_performance("act_current_dir", 6.1)),
            forward_stats: Some(crate::DirectionStats {
                avg_time: Some(300.0),
                last_activity: Some(1700000000),
                count: 5,
                avg_speed: Some(4.5),
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(1690000000),
                count: 2,
                avg_speed: Some(3.1),
            }),
            current_rank: Some(3),
            attempt_count: 2,
            percentile_rank: Some(50.0),
        };

        let ffi = FfiRoutePerformanceResult::from(result);
        assert_eq!(ffi.performances.len(), 2);
        assert_eq!(ffi.performances[0].activity_id, "act_1");
        assert_eq!(ffi.performances[1].activity_id, "act_2");
        assert_eq!(ffi.activity_metrics.len(), 1);
        assert_eq!(ffi.activity_metrics[0].moving_time, 3500);
        assert_eq!(ffi.best.as_ref().unwrap().activity_id, "act_best");
        assert_eq!(ffi.attempt_count, 2);
        assert_eq!(ffi.percentile_rank, Some(50.0));
        assert_eq!(ffi.best_forward.as_ref().unwrap().activity_id, "act_fwd");
        assert_eq!(ffi.best_reverse.as_ref().unwrap().activity_id, "act_rev");
        assert_eq!(
            ffi.current_direction_best.as_ref().unwrap().activity_id,
            "act_current_dir"
        );
        assert_eq!(ffi.forward_stats.as_ref().unwrap().count, 5);
        assert_eq!(ffi.reverse_stats.as_ref().unwrap().count, 2);
        assert_eq!(ffi.current_rank, Some(3));
    }

    fn section_fixture(section_type: crate::sections::SectionType) -> crate::sections::Section {
        crate::sections::Section {
            id: "section_123".to_string(),
            section_type,
            name: Some("Test Section".to_string()),
            sport_type: "Ride".to_string(),
            polyline: vec![
                tracematch::GpsPoint::new(40.0, -74.0),
                tracematch::GpsPoint::new(40.1, -73.9),
            ],
            distance_meters: 1500.0,
            representative_activity_id: Some("act_rep".to_string()),
            activity_ids: vec!["act_123".to_string(), "act_456".to_string()],
            visit_count: 5,
            confidence: Some(0.95),
            observation_count: Some(10),
            average_spread: Some(15.0),
            point_density: Some(vec![4, 6]),
            scale: Some("medium".to_string()),
            is_user_defined: true,
            stability: Some(0.85),
            elevation_gain_m: Some(120.5),
            avg_grade_percent: Some(4.2),
            elevation_loss_m: Some(8.0),
            max_grade_percent: Some(7.5),
            straightness: Some(0.91),
            klass: Some("climb".to_string()),
            is_lift: false,
            rank_score: Some(0.7),
            sport_rank_score: Some(0.8),
            version: Some(3),
            updated_at: Some("2024-06-01T00:00:00Z".to_string()),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            route_ids: Some(vec!["route_1".to_string()]),
            source_activity_id: Some("act_src".to_string()),
            start_index: Some(11),
            end_index: Some(97),
            disabled: true,
            superseded_by: Some("section_999".to_string()),
            sport_types: vec!["Ride".to_string(), "Run".to_string()],
        }
    }

    #[test]
    fn section_carries_every_field() {
        let ffi = FfiSection::from(section_fixture(crate::sections::SectionType::Custom));
        assert_eq!(ffi.id, "section_123");
        assert_eq!(ffi.section_type, "custom");
        assert_eq!(ffi.name, Some("Test Section".to_string()));
        assert_eq!(ffi.sport_types, vec!["Ride", "Run"]);
        assert_eq!(ffi.distance_meters, 1500.0);
        assert_eq!(
            ffi.representative_activity_id,
            Some("act_rep".to_string()),
            "representative and source activity ids must not be crossed"
        );
        assert_eq!(ffi.source_activity_id, Some("act_src".to_string()));
        assert_eq!(ffi.activity_ids, vec!["act_123", "act_456"]);
        assert_eq!(ffi.visit_count, 5);
        assert_eq!(ffi.confidence, Some(0.95));
        assert_eq!(ffi.observation_count, Some(10));
        assert_eq!(ffi.average_spread, Some(15.0));
        assert_eq!(ffi.point_density, Some(vec![4, 6]));
        assert_eq!(ffi.scale, Some("medium".to_string()));
        assert!(ffi.is_user_defined);
        assert_eq!(ffi.stability, Some(0.85));
        assert_eq!(ffi.elevation_gain_m, Some(120.5));
        assert_eq!(ffi.avg_grade_percent, Some(4.2));
        assert_eq!(ffi.version, Some(3));
        assert_eq!(ffi.updated_at, Some("2024-06-01T00:00:00Z".to_string()));
        assert_eq!(ffi.created_at, "2024-01-01T00:00:00Z");
        assert_eq!(ffi.route_ids, Some(vec!["route_1".to_string()]));
        assert_eq!(ffi.start_index, Some(11));
        assert_eq!(ffi.end_index, Some(97));
        assert!(ffi.disabled);
        assert_eq!(ffi.superseded_by, Some("section_999".to_string()));

        // The polyline survives the track encoding in order, not just
        // in count: a reversed or truncated encode draws the wrong overlay.
        let decoded = crate::persistence::codec::decode_polyline(&ffi.encoded_polyline).unwrap();
        assert_eq!(decoded.len(), 2);
        assert!((decoded[0].latitude - 40.0).abs() < 1e-5);
        assert!((decoded[0].longitude + 74.0).abs() < 1e-5);
        assert!((decoded[1].latitude - 40.1).abs() < 1e-5);
        assert!((decoded[1].longitude + 73.9).abs() < 1e-5);
    }

    fn frequent_section_fixture() -> tracematch::FrequentSection {
        tracematch::FrequentSection {
            id: "section_777".to_string(),
            name: Some("Catalogue Section".to_string()),
            sport_type: "Run".to_string(),
            polyline: vec![
                tracematch::GpsPoint::new(40.0, -74.0),
                tracematch::GpsPoint::new(40.1, -73.9),
            ],
            representative_activity_id: "act_rep".to_string(),
            representative_range: None,
            activity_ids: vec!["act_1".to_string(), "act_2".to_string()],
            activity_portions: vec![tracematch::SectionPortion {
                activity_id: "act_1".to_string(),
                start_index: 4,
                end_index: 40,
                distance_meters: 900.0,
                direction: tracematch::Direction::Same,
            }],
            visit_count: 6,
            distance_meters: 950.0,
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.75,
            observation_count: 8,
            average_spread: 12.0,
            point_density: vec![3, 5],
            scale: None,
            is_user_defined: true,
            stability: 0.6,
            elevation_gain_m: Some(30.0),
            avg_grade_percent: Some(3.0),
            enrichment: Default::default(),
            rank: None,
            version: 4,
            updated_at: Some("2024-06-01T00:00:00Z".to_string()),
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            consensus_state: None,
        }
    }

    /// The catalogue and the database reach TypeScript as the same record, so
    /// the conversion there does not have to sniff which fields are present.
    #[test]
    fn a_catalogue_section_reaches_ffi_as_the_one_section_record() {
        let ffi = FfiSection::from(&frequent_section_fixture());

        assert_eq!(ffi.id, "section_777");
        assert_eq!(ffi.section_type, "auto");
        assert_eq!(ffi.name, Some("Catalogue Section".to_string()));
        assert!(
            ffi.sport_types.is_empty(),
            "the catalogue holds no outings' sports, and its label is not one"
        );
        assert_eq!(ffi.distance_meters, 950.0);
        assert_eq!(
            ffi.representative_activity_id,
            Some("act_rep".to_string()),
            "the catalogue's non-optional id must not arrive as None"
        );
        assert_eq!(ffi.activity_ids, vec!["act_1", "act_2"]);
        assert_eq!(ffi.visit_count, 6);
        assert_eq!(ffi.confidence, Some(0.75));
        assert_eq!(ffi.observation_count, Some(8));
        assert_eq!(ffi.average_spread, Some(12.0));
        assert_eq!(ffi.point_density, Some(vec![3, 5]));
        assert!(ffi.is_user_defined);
        assert_eq!(ffi.stability, Some(0.6));
        assert_eq!(ffi.elevation_gain_m, Some(30.0));
        assert_eq!(ffi.avg_grade_percent, Some(3.0));
        assert_eq!(ffi.version, Some(4));
        assert_eq!(ffi.updated_at, Some("2024-06-01T00:00:00Z".to_string()));
        assert_eq!(ffi.created_at, "2024-01-01T00:00:00Z");

        assert_eq!(ffi.activity_portions.len(), 1);
        assert_eq!(ffi.activity_portions[0].activity_id, "act_1");
        assert_eq!(ffi.activity_portions[0].start_index, 4);
        assert_eq!(ffi.activity_portions[0].end_index, 40);

        // Only visible sections reach this path, and the catalogue carries no
        // custom-section fields at all.
        assert!(!ffi.disabled);
        assert_eq!(ffi.superseded_by, None);
        assert_eq!(ffi.source_activity_id, None);
        assert_eq!(ffi.start_index, None);
        assert_eq!(ffi.end_index, None);

        let decoded = crate::persistence::codec::decode_polyline(&ffi.encoded_polyline).unwrap();
        assert_eq!(decoded.len(), 2);
        assert!((decoded[0].latitude - 40.0).abs() < 1e-5);
        assert!((decoded[1].longitude + 73.9).abs() < 1e-5);
    }

    /// `created_at` is optional in the catalogue and required on the record.
    #[test]
    fn a_catalogue_section_without_a_created_at_reaches_ffi_empty() {
        let ffi = FfiSection::from(&tracematch::FrequentSection {
            created_at: None,
            ..frequent_section_fixture()
        });
        assert_eq!(ffi.created_at, "");
    }

    /// A database section has no portions, and an empty list is the answer
    /// rather than a missing field.
    #[test]
    fn a_database_section_reaches_ffi_with_no_portions() {
        let ffi = FfiSection::from(section_fixture(crate::sections::SectionType::Auto));
        assert!(ffi.activity_portions.is_empty());
    }

    #[test]
    fn section_type_reaches_ffi_as_its_own_tag() {
        // A conversion that hardcoded either tag would still satisfy the
        // single-variant test above.
        let auto = FfiSection::from(section_fixture(crate::sections::SectionType::Auto));
        assert_eq!(auto.section_type, "auto");
        let custom = FfiSection::from(section_fixture(crate::sections::SectionType::Custom));
        assert_eq!(custom.section_type, "custom");
    }

    #[test]
    fn an_integer_off_the_wire_is_floored() {
        assert_eq!(int_from_wire(1_768_435_200.0), 1_768_435_200);
        assert_eq!(int_from_wire(1_768_435_200.9), 1_768_435_200);
        assert_eq!(int_from_wire(-0.5), -1);
        assert_eq!(
            int_from_wire(9_007_199_254_740_992.0),
            9_007_199_254_740_992
        );
        assert_eq!(int_from_wire(f64::NAN), 0);
        assert_eq!(int_from_wire(f64::INFINITY), i64::MAX);
    }

    #[test]
    fn an_unsigned_integer_off_the_wire_is_floored_and_never_negative() {
        assert_eq!(uint_from_wire(42.0), 42);
        assert_eq!(uint_from_wire(42.7), 42);
        assert_eq!(uint_from_wire(-1.0), 0);
        assert_eq!(uint_from_wire(f64::NAN), 0);
        assert_eq!(
            uint_from_wire(9_007_199_254_740_992.0),
            9_007_199_254_740_992
        );
    }
}

// ============================================================================
// Strength Training Types
// ============================================================================

/// A single exercise set from a FIT file, exposed to TypeScript.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseSet {
    pub activity_id: String,
    pub set_order: u32,
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    /// Human-readable exercise name, pre-resolved in Rust.
    pub display_name: String,
    /// 0=active, 1=rest, 2=warmup, 3=cooldown
    pub set_type: u8,
    pub repetitions: Option<u16>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
    pub start_time: Option<f64>,
}

/// Consecutive active sets of one exercise within a session.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseGroup {
    pub name: String,
    pub exercise_category: u16,
    pub sets: Vec<FfiExerciseSet>,
    pub best_set: Option<FfiExerciseSet>,
    /// Rest after each preceding active set, when both timestamps are known.
    pub rest_seconds: Vec<f64>,
}

/// One session of an exercise, with its heaviest active set.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseHistorySession {
    pub activity_id: String,
    pub activity_name: String,
    pub date: f64,
    pub best_set: FfiExerciseSet,
    pub estimated_one_rep_max_kg: Option<f64>,
}

/// The sessions and estimated one-rep-max trend for one exercise category.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseDetailData {
    pub exercise_category: u16,
    pub exercise_name: String,
    pub sessions: Vec<FfiExerciseHistorySession>,
}

/// One session's stored sets with the totals every surface shows for it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseSession {
    /// Every stored set, rest and warmup included, in recorded order.
    pub sets: Vec<FfiExerciseSet>,
    /// Active sets grouped by consecutive exercise name, in recorded order.
    pub groups: Vec<FfiExerciseGroup>,
    pub active_set_count: u32,
    /// Distinct exercise names among the active sets.
    pub exercise_count: u32,
    /// Weight times repetitions over active sets. A set with no repetitions
    /// counts as one and a set with no weight as zero.
    pub total_volume_kg: f64,
    pub total_duration_secs: f64,
}

/// A muscle group activation, matching react-native-body-highlighter slug format.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleGroup {
    /// Slug matching react-native-body-highlighter (e.g., "biceps", "chest")
    pub slug: String,
    /// 1 = secondary, 2 = primary
    pub intensity: u8,
}

/// Aggregated muscle group volume over a time period.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleVolume {
    /// Slug matching react-native-body-highlighter
    pub slug: String,
    /// Number of sets where this muscle is primary target
    pub primary_sets: u32,
    /// Number of sets where this muscle is secondary target
    pub secondary_sets: u32,
    /// Weighted set count: primary=1.0, secondary=0.5
    pub weighted_sets: f64,
    /// Reps targeting this muscle, with secondary work counted at half
    pub total_reps: f64,
    /// Weight × reps in kg, with secondary work counted at half
    pub volume_kg: f64,
    /// Human-readable exercise names that targeted this muscle
    pub exercise_names: Vec<String>,
}

/// One opposing pair of muscle groups, and what their volumes say about it.
///
/// The verdict is a function of the volumes beside it, so it is computed where
/// they are rather than per screen mount. The pair's name and the muscles'
/// display names are copy and stay in TypeScript, which is where the seventeen
/// locales are.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthBalancePair {
    /// Stable id the front end keys its copy on, e.g. `biceps_triceps`
    pub id: String,
    pub left_slug: String,
    pub right_slug: String,
    /// Weighted sets on each side, rounded to one decimal, as the verdict saw them
    pub left_weighted_sets: f64,
    pub right_weighted_sets: f64,
    /// The heavier side, or `None` when the two are equal
    pub dominant_slug: Option<String>,
    /// Heavier over lighter. `None` when either side is untrained, where a
    /// ratio is not a number: `status` carries that case.
    pub ratio: Option<f64>,
    /// `balanced` | `watch` | `imbalanced` | `one-sided` | `insufficient`
    pub status: String,
}

/// Summary of strength training volume over a time period.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthSummary {
    /// Per-muscle-group volume data
    pub muscle_volumes: Vec<FfiMuscleVolume>,
    /// Number of WeightTraining activities in the period
    pub activity_count: u32,
    /// Total active sets across all activities
    pub total_sets: u32,
    /// One entry per opposing pair, trained or not
    pub balance: Vec<FfiStrengthBalancePair>,
}

/// Inclusive Unix-second range used for batched summary requests.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTimestampRange {
    pub start_ts: f64,
    pub end_ts: f64,
}

/// Everything the strength tab paints with. All four are aggregates of the
/// same sets over the same windows, so they are one read rather than four: a
/// scrub across the diagram then costs no engine call at all.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthScreenData {
    /// The chosen period aggregated by muscle, with the balance verdicts.
    pub summary: FfiStrengthSummary,
    /// One aggregate per trailing week, in the order requested.
    pub weekly: Vec<FfiStrengthSummary>,
    /// One entry per muscle present in any of those weeks, most trained first.
    pub progressions: Vec<FfiStrengthProgression>,
    /// The exercises behind every muscle the period reached.
    pub exercises: Vec<FfiMuscleExercises>,
    /// Strength activities in the period with no FIT outcome yet, whose sets
    /// are owed rather than absent.
    pub owed_count: u32,
}

/// One muscle's exercises over the period, for the list under the diagram.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleExercises {
    pub muscle_slug: String,
    /// Sorted by activity count descending, then by sets.
    pub exercises: Vec<FfiExerciseSummary>,
}

/// Bundled strength aggregation for the insights hook: one monthly summary
/// plus N weekly summaries, each keyed to the corresponding input range.
/// Collapses 5+ separate `getStrengthSummary` FFI calls into one round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthInsightSeries {
    pub monthly: FfiStrengthSummary,
    pub weekly: Vec<FfiStrengthSummary>,
    /// One entry per muscle in `monthly`, in its order.
    pub progressions: Vec<FfiStrengthProgression>,
}

/// One muscle's trailing-weeks progression: the last two weekly averages
/// against the first two. Ranked here rather than in the reader, so the
/// weekly summaries are never walked again to re-find figures this call
/// already had.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthProgression {
    pub muscle_slug: String,
    /// Weighted sets for each week of `weekly`, oldest first, rounded to one
    /// decimal before the averages below are taken. The order matters: the
    /// reader rounded first and an average of unrounded weeks disagrees.
    pub weekly_weighted_sets: Vec<f64>,
    pub recent_average: f64,
    pub baseline_average: f64,
    pub peak_weighted_sets: f64,
    /// `None` when the baseline is zero, which has no percentage to report.
    pub change_pct: Option<f64>,
    /// "up", "down" or "flat".
    pub trend: String,
    /// How far the recent average sits from the baseline, in standard
    /// deviations of the weekly series. `None` when the series is flat or
    /// shorter than two weeks.
    pub signal_delta: Option<f64>,
}

// ============================================================================
// Muscle Exercise Detail Types
// ============================================================================

/// Exercise summary for a specific muscle group within a date range.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseSummary {
    /// Human-readable exercise name
    pub exercise_name: String,
    /// FIT exercise category ID (pass back for drill-down query)
    pub exercise_category: u16,
    /// Sets credited to this muscle across all activities
    pub total_sets: f64,
    /// Reps credited to this muscle
    pub total_reps: f64,
    /// Total volume load in kg (weight × reps)
    pub volume_kg: f64,
    /// Number of distinct activities containing this exercise
    pub activity_count: u32,
    /// True if the muscle is a primary target for at least one occurrence
    pub is_primary: bool,
}

/// An activity containing a specific exercise, with per-activity stats.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseActivity {
    /// Activity ID for navigation
    pub activity_id: String,
    /// Activity display name
    pub activity_name: String,
    /// Activity date as Unix timestamp (seconds)
    pub date: f64,
    /// Sets credited to this muscle for this exercise in the activity
    pub sets: f64,
    /// Reps credited to this muscle in this activity
    pub reps: f64,
    /// Total volume load in kg (weight × reps) for this exercise in this activity
    pub volume_kg: f64,
    /// Whether the muscle is a primary target for this exercise
    pub is_primary: bool,
}

/// Activities for a specific exercise, sorted by date DESC.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseActivities {
    pub activities: Vec<FfiExerciseActivity>,
}

/// Combined payload for batched activity-list highlights: pre-computed
/// section indicators (PRs + trends) and route highlights for the same
/// activity IDs, delivered in a single FFI round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityHighlightsBundle {
    pub indicators: Vec<FfiActivityIndicator>,
    pub route_highlights: Vec<FfiActivityRouteHighlight>,
}

// ============================================================================
// Route Highlight Types
// ============================================================================

/// Lightweight route highlight for an activity: was this a PR on the route?
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityRouteHighlight {
    pub activity_id: String,
    pub route_id: String,
    pub route_name: String,
    /// True when this activity's duration is the best across all route attempts
    pub is_pr: bool,
    /// -1=slower than preceding avg, 0=neutral, 1=faster
    pub trend: i8,
    /// Seconds between this activity's moving time and the route PR's moving
    /// time. Negative = ahead of PR, positive = behind PR. None when there is
    /// no PR comparison available (e.g. first attempt).
    pub time_delta_seconds: Option<i32>,
    /// When is_pr: seconds faster than the previous best attempt. None when
    /// this is the only timed attempt, when times tie, or when not a PR.
    pub pr_improvement_seconds: Option<u32>,
}

// ============================================================================
// Materialised Activity Indicator (from activity_indicators table)
// ============================================================================

/// Pre-computed PR or trend indicator for an activity.
/// Read from the `activity_indicators` table - no on-demand computation.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityIndicator {
    pub activity_id: String,
    /// "section_pr", "route_pr", "section_trend", "route_trend"
    pub indicator_type: String,
    /// section_id or route_id
    pub target_id: String,
    pub target_name: String,
    pub direction: String,
    pub lap_time: f64,
    /// -1=declining, 0=stable, 1=improving
    pub trend: i8,
}

/// A section encounter: one (section, direction) pair for a given activity.
/// This is the canonical unit for displaying section data in the activity detail.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionEncounter {
    pub section_id: String,
    pub section_type: String,
    pub section_name: String,
    pub direction: String,
    pub distance_meters: f64,
    /// Where this activity's track first enters the section in this direction.
    /// Encounters come back ordered by it.
    pub start_index: u32,
    /// This activity's time on this section in this direction
    pub lap_time: f64,
    /// This activity's pace on this section in this direction
    pub lap_pace: f64,
    /// Whether this activity holds the PR for this (section, direction)
    pub is_pr: bool,
    /// Whether this traversal meets the section's completion rule.
    pub is_complete: bool,
    /// Podium place, 1 to 3, among the other outings on this (section,
    /// direction); `None` for fourth and below, a fragment or a lone outing.
    /// `is_pr` is exactly `rank == Some(1)`.
    pub rank: Option<u32>,
    /// How many total traversals exist for this (section, direction)
    pub visit_count: u32,
    /// Historical lap times for sparkline (chronological, all activities in this direction)
    pub history_times: Vec<f64>,
    /// Activity IDs corresponding to history_times (for highlighting current activity)
    pub history_activity_ids: Vec<String>,
}

// ============================================================================
// Section Matching & Merge Types
// ============================================================================

/// Result of matching an activity's GPS track against existing sections.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionMatch {
    pub section_id: String,
    pub section_name: Option<String>,
    /// Stream index, as `u32` like every other record's, so a caller comparing
    /// this against a portion's index needs no BigInt cast to do it.
    pub start_index: u32,
    pub end_index: u32,
    pub match_quality: f64,
    pub same_direction: bool,
    pub distance_meters: f64,
}

/// Result of cheap per-activity section indexing after ingest.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiIndexActivitySummary {
    pub matched_sections: u32,
    pub inserted_portions: u32,
    pub regrouped: bool,
}

impl From<crate::sections::IndexActivitySummary> for FfiIndexActivitySummary {
    fn from(s: crate::sections::IndexActivitySummary) -> Self {
        Self {
            matched_sections: s.matched_sections,
            inserted_portions: s.inserted_portions,
            regrouped: s.regrouped,
        }
    }
}

/// Candidate for merging with another section.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMergeCandidate {
    pub section_id: String,
    pub name: Option<String>,
    /// Every sport whose included outings have taken the section, sorted.
    pub sport_types: Vec<String>,
    pub distance_meters: f64,
    pub visit_count: u32,
    pub overlap_pct: f64,
    pub center_distance_meters: f64,
}

/// A ride a merge would take out of the section it is merged into. The ride
/// stays in the library.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMergeDropped {
    pub activity_id: String,
    pub name: String,
    /// Unix seconds
    pub start_date: f64,
}

/// User-tunable match strictness, persisted in the settings table.
/// Read by Rust on engine load; written by `DetectionManager.set_match_strictness`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMatchStrictness {
    pub min_match_pct: f64,
    pub endpoint_threshold: f64,
}

/// One stale-PR opportunity: a section whose PR might be beatable because
/// the user's threshold fitness (FTP for cycling, critical speed for run/swim)
/// has improved since the PR was set, and the section hasn't been visited
/// recently. Pure pattern recognition - TS formats as an Insight.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStalePrOpportunity {
    pub section_id: String,
    pub section_name: String,
    pub best_time_secs: f64,
    pub traversal_count: u32,
    /// Days since the last traversal. The insight gates on this, so it has to
    /// travel with the opportunity rather than be recovered downstream.
    pub days_since_last: u32,
    /// "power" for cycling (FTP), "pace" for running/swimming (critical speed)
    pub fitness_metric: String,
    pub current_value: f64,
    pub previous_value: f64,
    pub gain_percent: f64,
    /// "W" for power, "/km" for running, "/100m" for swimming
    pub unit: String,
    /// The sport the section was ranked under. A section travelled in two
    /// sports is ranked in each, and the card names which one it is offering.
    pub sport_type: String,
    /// The last efforts on the section, oldest first. The card's claim is that
    /// a fitness gain makes the section worth revisiting, and the efforts are
    /// what that claim is drawn against.
    pub recent_efforts: Vec<FfiSeriesPoint>,
    /// The activity the record being offered for a retry was set in.
    pub best_activity_id: Option<String>,
}

// ============================================================================
// Preview and cutover payloads
// ============================================================================

/// How a proposed catalogue compares with the live one.
///
/// One record for both payloads that carry it, because it is one struct:
/// `diff_catalogues_public` produces it for the preview run and for the
/// cutover diff alike. The cutover persists it as JSON in a settings row, so
/// it keeps its serde derives; the preview hands it straight across.
#[derive(Debug, Clone, uniffi::Record, Serialize, Deserialize)]
pub struct FfiCatalogueCounts {
    pub current: u32,
    pub proposed: u32,
    pub unchanged: u32,
    pub changed: u32,
    pub new: u32,
    pub gone: u32,
}

/// One section in a preview payload, in the same shape the live catalogue and
/// a run's result both use.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPreviewSection {
    pub id: String,
    /// The live section this one was paired with, when it was paired.
    pub live_id: Option<String>,
    /// "unchanged" | "changed" | "new" | "gone"
    pub status: String,
    pub name: Option<String>,
    /// Delta+varint encoded coordinates (`codec::encode_polyline`). Bytes
    /// rather than the base64 the JSON payload carried, since a record has no
    /// reason to spell them.
    pub polyline: Vec<u8>,
    pub visits: u32,
    pub distance_m: f64,
    pub elevation_gain_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub pinned: bool,
}

/// What the run had to detect over.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewPool {
    pub activities: u32,
    pub empty: u32,
    pub unreadable: u32,
}

/// One preview run's result.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewResult {
    pub pool: FfiPreviewPool,
    /// `f64` rather than `u64`, since a record field TypeScript lifts as a
    /// bigint throws the first time a caller stringifies the record
    /// (`scripts/lint-ffi-bigint.mjs`).
    pub elapsed_ms: f64,
    pub config: FfiSectionConfig,
    pub counts: FfiCatalogueCounts,
    pub sections: Vec<FfiPreviewSection>,
}

/// The config the cutover replaced beside the one it wrote.
#[derive(Debug, Clone, uniffi::Record, Serialize, Deserialize)]
pub struct FfiCutoverSettingsReset {
    pub previous: FfiSectionConfig,
    pub current: FfiSectionConfig,
}

/// The stored cutover diff the change card reads.
///
/// Counts and the reset only: a section is a reference activity and the
/// indices of a pass over it, so a row per section put both catalogues'
/// geometry in a settings row for the life of the install. An older payload
/// still carries those rows and is read past rather than rejected.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCutoverDiff {
    pub token: String,
    pub counts: FfiCatalogueCounts,
    /// Dropped alone when it is half readable, never taking the diff with it.
    pub settings_reset: Option<FfiCutoverSettingsReset>,
}
