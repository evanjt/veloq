//! FFI-safe types with UniFFI derives.
//!
//! These types mirror tracematch types but add UniFFI derives for mobile FFI.
//! Conversion is done at the FFI boundary.

use serde::{Deserialize, Serialize};
use tracematch::{Bounds, GpsPoint};

// ============================================================================
// Integers on the wire
// ============================================================================
//
// A timestamp, duration, rowid or run id, version, day count or byte count
// crosses the FFI as `f64`, because an `i64` or `u64` lifts as a `bigint` in
// TypeScript and `JSON.stringify` refuses one. `f64` is exact to 2^53, which
// every one of those kinds stays under. Going out it is `value as f64`. Coming
// in it is one of the two below, so every export floors the same way. A record
// field holds `crate::WholeNumber`, which does both.

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

/// An activity's chart series as they cross the bridge: no JSON, no per-value
/// objects. Every series but `latlng` is its samples as little-endian 64-bit
/// floats, read through a `Float64Array`, and a gap is NaN. `latlng` is the
/// engine's one track encoding, unframed. A series the activity does not have
/// is an empty buffer. All the series share one index space, so sample `i` of
/// one is sample `i` of every other.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct FfiActivityStreams {
    pub latlng: Vec<u8>,
    pub time: Vec<u8>,
    pub altitude: Vec<u8>,
    pub heartrate: Vec<u8>,
    pub watts: Vec<u8>,
    /// Cadence in the sport's cadence unit, so steps a minute on foot.
    pub cadence: Vec<u8>,
    pub velocity_smooth: Vec<u8>,
    pub distance: Vec<u8>,
    pub grade_smooth: Vec<u8>,
    pub temp: Vec<u8>,
    /// W' balance in joules remaining.
    pub wbal: Vec<u8>,
    /// Grade-adjusted pace in minutes per kilometre.
    pub gap: Vec<u8>,
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

/// One saved route near the recording fix, with what the record screen shows for it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiNearbyRoute {
    pub group_id: String,
    pub name: String,
    /// The route's own length, the representative's distance in metres, 0 when unmeasured.
    pub distance_meters: f64,
    /// How far the route's bounding box lies from the fix, 0 when it contains it.
    pub away_meters: f64,
    /// The best counted time in the route's sport, `None` when no attempt has one.
    pub best_time_seconds: Option<u32>,
    /// The representative's simplified line, empty when it has no stored signature.
    pub encoded_coords: Vec<u8>,
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

// The matcher's track point and bounding box cross the boundary as they are.
// The field lists repeat the matcher's, and the macro reads every field, so a
// field added there fails this build until it is declared here.
/// A track point, elevation in metres when the source recorded one.
#[uniffi::remote(Record)]
#[uniffi(name = "FfiGpsPoint")]
pub struct GpsPoint {
    pub latitude: f64,
    pub longitude: f64,
    pub elevation: Option<f64>,
}

/// A bounding box in degrees.
#[uniffi::remote(Record)]
#[uniffi(name = "FfiBounds")]
pub struct Bounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
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
            power_zone_times: None,
            hr_zone_times: None,
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
    /// The week is still running, so its totals cover only the days so far.
    pub partial: bool,
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
    /// Each zone's share of the time as a whole percent, beside `seconds`,
    /// totalling 100 when any zone holds time and all zero when none does.
    pub shares: Vec<u32>,
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
    /// eFTP of the newest day on or before `lookback_days` earlier than
    /// `latest_date`. It may equal `latest_ftp`
    pub previous_ftp: Option<u16>,
    /// That day's epoch (Unix timestamp seconds)
    pub previous_date: Option<f64>,
    /// The step from `previous_ftp` to `latest_ftp` in watts, with its sign.
    /// Derived here so a screen, a widget and a notification cannot each
    /// subtract and round their own way. `None` when there is nothing to
    /// compare against.
    pub delta_watts: Option<i32>,
    /// The arrow the step draws, judged by [`crate::trend_table::glyph`]: up
    /// for a gain, flat inside the deadband, `None` when there is nothing to
    /// compare against.
    pub glyph: Option<String>,
    /// The window in days `delta_watts` was measured across, carried so a
    /// caption names the window of the step it shows rather than the range of
    /// the chart it sits on, which can be longer.
    pub lookback_days: u32,
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
///
/// Beside each arrow is what it was judged against, so the card can state the
/// method: `*_previous` is the baseline value, `*_previous_date` the day it was
/// read (Unix timestamp seconds of that day's midnight, UTC, as `FfiFtpTrend`
/// dates its estimates), and `*_basis` the evidence behind the claim. A metric
/// with no baseline row carries no previous value and no date.
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
    pub fitness_previous: Option<f64>,
    pub fitness_previous_date: Option<f64>,
    pub fitness_basis: Option<FfiClaimBasis>,
    pub form_previous: Option<f64>,
    pub form_previous_date: Option<f64>,
    pub form_basis: Option<FfiClaimBasis>,
    pub hrv_previous: Option<f64>,
    pub hrv_previous_date: Option<f64>,
    pub hrv_basis: Option<FfiClaimBasis>,
    pub rhr_previous: Option<f64>,
    pub rhr_previous_date: Option<f64>,
    pub rhr_basis: Option<FfiClaimBasis>,
    pub weight_previous: Option<f64>,
    pub weight_previous_date: Option<f64>,
    pub weight_basis: Option<FfiClaimBasis>,
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
    pub weight_previous: Option<f64>,
    /// The day each baseline was read, as `FfiWellnessSummary` dates them.
    /// Fatigue shares fitness's row, and form is read off that row too.
    pub load_previous_date: Option<f64>,
    pub hrv_previous_date: Option<f64>,
    pub rhr_previous_date: Option<f64>,
    pub weight_previous_date: Option<f64>,
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
            fitness_previous: w.fitness_previous,
            fitness_previous_date: w.fitness_previous.and(w.load_previous_date),
            fitness_basis: w.fitness_basis,
            form_previous: w.form_previous,
            form_previous_date: w.form_previous.and(w.load_previous_date),
            form_basis: w.form_basis,
            hrv_previous: w.hrv_previous,
            hrv_previous_date: w.hrv_previous_date,
            hrv_basis: w.hrv_basis,
            rhr_previous: w.rhr_previous,
            rhr_previous_date: w.rhr_previous_date,
            rhr_basis: w.rhr_basis,
            weight_previous: w.weight_previous,
            weight_previous_date: w.weight_previous_date,
            weight_basis: w.weight_basis,
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
    /// The arrow for this week's hours so far against the same part of the
    /// week before, on hours rounded to a tenth as the card prints them.
    pub week_hours_trend: Option<String>,
    /// The same for this week's activity count.
    pub week_count_trend: Option<String>,
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
    pub bounds: Option<Bounds>,
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
            bounds: g.bounds,
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
            bounds: g.bounds,
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
    /// What the row recorded, read from the stored payload. Absent when the
    /// row stored none or stored something unreadable.
    pub details: Option<FfiSectionEventDetails>,
    pub geometry_version: Option<f64>,
}

/// The fixed fields of a ledger row's stored payload. Keys a row does not
/// carry read as empty lists and absent options, and keys this record does
/// not name are ignored, so a row written by an older or newer build reads.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionEventDetails {
    /// Activities that arrived while the change was pending.
    pub around: Vec<String>,
    /// Activities a fork at the line's end collected.
    pub fork_around: Vec<String>,
    /// The era's records, one per sport and direction; a row written before
    /// records were held per direction carries no direction, and one written
    /// before they were held per sport carries one record and no sport.
    pub prs: Vec<FfiSectionEraRecord>,
    /// A re-based record's time before and after, within `pr_sport` and
    /// `pr_direction`.
    pub pr_from: Option<f64>,
    pub pr_to: Option<f64>,
    pub pr_sport: Option<String>,
    /// `same` or `reverse`; absent on a row written before records were held
    /// per direction.
    pub pr_direction: Option<String>,
    /// The sections a split left behind, in line order.
    pub siblings: Vec<String>,
    pub version: Option<f64>,
    /// The activity a re-anchor moved the line off, and the one it moved to.
    pub reanchored_from: Option<String>,
    pub reanchored_to: Option<String>,
    /// Whether an anchoring moved the line; absent on a row that does not say.
    pub moved: Option<bool>,
    /// The section a split piece was carved from, with its standing now.
    pub split_from: Option<FfiSectionLink>,
    /// The pieces a split left, with their standing now.
    pub split_into: Vec<FfiSectionLink>,
    /// Why the detector cut the line where it did, one entry per record that
    /// names this section, in the detector's order. Empty when the change
    /// recorded none.
    pub boundaries: Vec<FfiBoundaryReason>,
}

/// One reason the detector gave for where a section's line was cut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiBoundaryReason {
    /// The reason's serde tag: usage_change, fork, traffic_cliff, trim,
    /// low_support, terminus, pass_end or seam_clip.
    pub kind: String,
    /// How much of the drawn line a seam clip took off, in metres; absent on
    /// every other reason.
    pub clipped_metres: Option<f64>,
}

/// One sport's record in one direction on a section when an era ended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionEraRecord {
    pub sport: Option<String>,
    /// `same` or `reverse`; absent on a row written before records were held
    /// per direction.
    pub direction: Option<String>,
    /// Seconds.
    pub time: f64,
}

/// A section the ledger names, with whether the catalogue still shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionLink {
    pub id: String,
    pub name: Option<String>,
    pub available: bool,
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

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBackupScreenData {
    pub home_lat: Option<String>,
    pub home_lng: Option<String>,
    pub radius_m: Option<String>,
    pub suggestion: Option<crate::persistence::SuggestedHome>,
    /// History rows the latest restore left in its backup file because no
    /// section here covers their ground.
    pub not_restored: u32,
    /// Route names the latest restore gave up on because the grouping here
    /// merged their routes into one that already took a restored name.
    pub names_not_restored: u32,
    /// The running record backup's id, for `cancel_run`, or nothing running.
    /// Read from the job, not the database: a backup is single-flight.
    pub record_backup_run: Option<f64>,
}

/// What the record screen offers before a recording starts.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRecordScreenData {
    /// Sport types the library holds, the one with most activities first, ties
    /// in name order. Empty for a library with no activity.
    pub library_sports: Vec<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCacheScreenData {
    pub stream_retention_days: f64,
    pub stream_store_bytes: f64,
    pub activity_year_counts: Vec<FfiYearCount>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiYearCount {
    pub year: u32,
    pub count: u32,
}

/// What the background jobs have done and still owe, read once each time a job
/// settles or activities land. The running progress is not here: it moves on
/// every item and stays on the routes status poll.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBackgroundJobsData {
    /// The last run of each job that has run on this install.
    pub runs: Vec<crate::persistence::job_runs::JobRun>,
    /// Stored activities no detect has seen. `None` when it cannot be counted,
    /// which must not read as nothing left to do.
    pub detection_awaiting: Option<u32>,
    /// Whether a section rebuild is still owed.
    pub cutover_owed: bool,
    /// Whole days the stream backfill's daily allowance takes to draw what it
    /// owes, when that is more than one day. `None` when the queue fits in a
    /// day, is empty, or cannot be counted.
    pub stream_days_to_finish: Option<u32>,
    /// The Garmin pull, `None` while no Garmin key is held.
    pub garmin_pull: Option<FfiGarminPull>,
    /// When the elevation and stream downloads may next be asked again, in
    /// epoch milliseconds, while a refusal's cooldown or the request budget
    /// holds them. `None` when nothing holds them.
    pub downloads_held_until_ms: Option<f64>,
    /// Whether intervals.icu asked for that wait, rather than this install's
    /// own request budget.
    pub downloads_held_by_upstream: bool,
    /// Whether the one-time pass recount is running on its own thread now.
    pub pass_recount_running: bool,
}

/// What Retry now did.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FfiRetryNow {
    /// Both downloads were restarted.
    pub started: bool,
    /// When the hold that refused the restart lifts, epoch milliseconds.
    pub held_until_ms: Option<f64>,
    /// Whether intervals.icu asked for that wait.
    pub held_by_upstream: bool,
}

/// Where the Garmin pull stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiGarminPullPhase {
    /// No pass has run in this process; the next sync starts one.
    Idle,
    Running,
    /// Garmin asked for a pause; nothing is sent before `resume_at`.
    Paused,
    /// Every ride back to the oldest has been walked.
    Done,
    /// The pass ended on `halt`.
    Stopped,
}

/// Why a Garmin pass stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiGarminHalt {
    KeyRejected,
    Unreachable,
    Unstorable,
}

/// The Garmin pull's count, month and terminal state, for the settings screen.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct FfiGarminPull {
    pub phase: FfiGarminPullPhase,
    /// Milliseconds since the epoch that a paused pass resumes at.
    pub resume_at: Option<crate::WholeNumber>,
    /// Set when `phase` is `Stopped`.
    pub halt: Option<FfiGarminHalt>,
    /// Originals this device has stored from Garmin.
    pub stored: u32,
    /// The earliest month the history pull has finished, as `YYYY-MM`.
    pub reached_month: Option<String>,
    /// Whether the history pull has passed the oldest ride.
    pub backfill_done: bool,
}

/// A recent change on a live section, for the insights feed.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionChange {
    pub section_id: String,
    /// The name the athlete is shown for the section: their own, else its
    /// number, else the composition from its split parent. The id when the
    /// section has none.
    pub section_name: String,
    pub kind: String,
    pub at: String,
    /// The section's line as it now stands, delta+varint encoded and thinned
    /// as `FfiRecentPR.encoded_polyline` is. Empty when it cannot be read.
    pub encoded_polyline: Vec<u8>,
}

/// Section performance result for FFI.
/// Complete performance data for a section across all activities.
/// Replaces the JSON-returning `persistent_engine_get_section_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<crate::SectionPerformanceRecord>,
    /// Best record in forward/same direction
    pub best_forward_record: Option<crate::SectionPerformanceRecord>,
    /// Best record in reverse direction
    pub best_reverse_record: Option<crate::SectionPerformanceRecord>,
    /// Whether the forward best strictly beats another forward outing.
    pub best_forward_is_pr: bool,
    /// Whether the reverse best strictly beats another reverse outing.
    pub best_reverse_is_pr: bool,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<crate::DirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<crate::DirectionStats>,
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
            records: r.records,
            best_forward_is_pr,
            best_reverse_is_pr,
            best_forward_record: r.best_forward_record,
            best_reverse_record: r.best_reverse_record,
            forward_stats: r.forward_stats,
            reverse_stats: r.reverse_stats,
        }
    }
}

/// Tier 5.5: result of a user-initiated section polyline recalc.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionRecalcResult {
    pub section_id: String,
    pub distance_meters: f64,
}

/// Route performance result for FFI.
/// Complete performance data for a route group across all activities.
/// Replaces the JSON-returning `persistent_engine_get_route_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<crate::RoutePerformance>,
    /// Activity metrics for all activities in the route (inlined to avoid duplicate FFI call)
    pub activity_metrics: Vec<FfiActivityMetrics>,
    /// Fastest forward performance, or fastest reverse when none ran forward.
    pub best: Option<crate::RoutePerformance>,
    /// Best performance in forward/same direction
    pub best_forward: Option<crate::RoutePerformance>,
    /// Best performance in reverse direction
    pub best_reverse: Option<crate::RoutePerformance>,
    /// Best performance in the current activity's direction.
    pub current_direction_best: Option<crate::RoutePerformance>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<crate::DirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<crate::DirectionStats>,
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
    /// Variables of this direction that carried an estimate: the family the
    /// mover label was Holm-adjusted across. The same on every row of a
    /// direction, and 0 when none of them had enough pairs.
    pub family_size: u32,
}

/// A correlation, or the reason there is none. An enum so a coefficient cannot
/// be read off a state that has none.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum FfiCorrelation {
    /// Fewer complete pairs than the floor.
    TooFew { n: u32 },
    /// One series never varies.
    Undefined { n: u32 },
    /// No relationship that holds across the direction's family: the 95 per
    /// cent interval spans zero, or excludes it but not by enough to survive
    /// Holm's correction.
    Inconclusive { r: f64, n: u32, low: f64, high: f64 },
    /// Holds under Holm's correction across the family, so the 95 per cent
    /// interval excludes zero too.
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
            performances: r.performances,
            activity_metrics: r
                .activity_metrics
                .into_iter()
                .map(FfiActivityMetrics::from)
                .collect(),
            best: r.best,
            best_forward: r.best_forward,
            best_reverse: r.best_reverse,
            current_direction_best: r.current_direction_best,
            forward_stats: r.forward_stats,
            reverse_stats: r.reverse_stats,
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
    pub bounds: Option<Bounds>,
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

/// A retired section as the old-versus-new map draws it: the ledger's record
/// of it and its newest stored line that decodes.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRetiredMapSection {
    pub section: crate::persistence::sections::RetiredSection,
    /// Delta+varint encoded coordinates; `None` when no stored version decodes.
    pub encoded_polyline: Option<Vec<u8>>,
}

/// A catalogue row as the old-versus-new map draws it, hidden rows included.
/// A row whose line will not decode has nothing to draw and is left out.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCurrentMapSection {
    pub id: String,
    pub name: Option<String>,
    pub is_user_defined: bool,
    pub pinned: bool,
    /// Disabled, or hidden behind the section `superseded_by` names.
    pub hidden: bool,
    pub superseded_by: Option<String>,
    /// Delta+varint encoded coordinates.
    pub encoded_polyline: Vec<u8>,
}

/// Why a retired section and a catalogue row are shown together.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "camelCase")]
pub enum FfiRetiredPairLink {
    /// The ledger's `into` chain from the retired section ends at the row.
    Ledger,
    /// The row is hidden behind the retired section's id.
    Supersedes,
    /// The two lines share ground.
    Ground,
}

/// One retired section set against one catalogue row.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRetiredMapPair {
    pub retired_id: String,
    pub current_id: String,
    pub link: FfiRetiredPairLink,
    /// The larger of the two coverage fractions, for a `Ground` pair only.
    pub overlap: Option<f64>,
}

/// Everything the old-versus-new sections map draws, in one read.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRetiredMapData {
    pub retired: Vec<FfiRetiredMapSection>,
    pub current: Vec<FfiCurrentMapSection>,
    pub pairs: Vec<FfiRetiredMapPair>,
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
    pub bounds: Option<Bounds>,
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
    /// Auto sections the athlete disabled or a custom one superseded, over the
    /// whole catalogue. Taken before `hide_disabled` runs, which is the filter
    /// this figure is the count for and which hides them by default. Distinct
    /// from `ledger_retired_count`: a disabled row is still in the catalogue,
    /// a ledger retirement has left it.
    pub removed_count: u32,
    /// Sections that left the catalogue through a fired retirement and still
    /// hold a ledger, the graveyard the retired screen lists, a record
    /// restore's pending states included. This is what the entry points to the
    /// graveyard gate on, and it is not the `removed_count` of disabled rows.
    pub ledger_retired_count: u32,
    /// Of those, the ones that hold an `archived` row: the cutover's, or a
    /// record restore's pending state. A later detect that dissolves a section
    /// leaves no archived row, so a library with no cutover reads zero here,
    /// which is what the "your matching changed" card gates on.
    pub archived_retired_count: u32,
    /// The sports the athlete has activities in, which the sport chips offer.
    pub available_sport_types: Vec<String>,
    /// Why the routes catalogue holds no route with the minimum activity
    /// count, whatever the search and the sport filter. `None` while it holds
    /// one, so an empty page under a search is a search that matched nothing.
    pub group_empty_reason: Option<FfiCatalogueEmptyReason>,
    /// Why the sections catalogue holds no section of any kind, hidden or not.
    /// `None` while it holds one.
    pub section_empty_reason: Option<FfiCatalogueEmptyReason>,
}

/// Why a routes or sections catalogue is empty, so the list states its cause
/// rather than promising rows that cannot come.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum FfiCatalogueEmptyReason {
    /// No stored activity in the synced range has a GPS track, so detection
    /// has nothing to compare: trainer, pool or strength sessions only.
    NoGpsActivities,
    /// Activities with GPS that no detect has seen yet, and nothing holding
    /// the detect that would see them.
    NotYetRun { awaiting: u32 },
    /// A detect is running now. `phase` is the detector's own phase token.
    Running { phase: String, percent: u32 },
    /// A detect is owed and something is refusing it.
    Held { hold: FfiDetectionHold },
    /// Every activity with GPS has been through a detect and none met the
    /// threshold: the least activities on a shared path that make one.
    NoneFound { min_activities: u32 },
}

/// What is refusing a detect that is owed.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum FfiDetectionHold {
    /// The athlete paused the elevation download, and only resuming it lifts
    /// the hold.
    ElevationPaused,
    /// An elevation pass is running and holds detection until it ends.
    ElevationRunning,
    /// Stored tracks are still owed elevation and wait on the network.
    ElevationWaiting { remaining: u32 },
    /// The detector migration has to run before any other detect.
    Cutover,
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
    /// A route attempt outside the band around the route's usual distance:
    /// drawn, but never the record, fitted or binned. Always false on a
    /// section.
    pub outside_distance_band: bool,
    /// How much of the route the attempt matched, 0 to 100. `None` on a
    /// section, and on a route attempt with no stored match.
    pub match_percentage: Option<f64>,
    /// Which side of its direction's focus range the point lies past, so the
    /// scatter draws it at the edge with a flag rather than stretching the
    /// axis.
    pub off_scale: FfiOffScale,
    /// Seconds behind the direction's record: zero for the record holder,
    /// positive for a slower attempt. `None` for an excluded attempt, one
    /// outside a route's distance band, and in a direction with no record.
    pub record_gap_secs: Option<f64>,
    /// Metres per second behind the direction's record, signed as
    /// `record_gap_secs` is: positive is slower. `None` where it is.
    pub record_gap_speed: Option<f64>,
}

/// Where a scatter point lies against its direction's focus range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiOffScale {
    /// Inside the range.
    None,
    /// Past the slow end: below the range on a speed axis, above it on a time
    /// axis.
    Slow,
    /// Past the fast end.
    Fast,
}

/// The range a direction's scatter axis draws, in the axis's own unit: metres
/// per second on a section, seconds on a route.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiFocusRange {
    pub low: f64,
    pub high: f64,
    /// Points drawn past the slow end.
    pub slow_count: u32,
    /// Points drawn past the fast end.
    pub fast_count: u32,
}

/// The focus range per direction. `None` for a direction with no point.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiScatterFocus {
    pub forward: Option<FfiFocusRange>,
    pub reverse: Option<FfiFocusRange>,
}

/// One step of a direction's record progression: an eligible lap strictly
/// faster than every eligible lap before it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiRecordStep {
    pub activity_id: String,
    pub lap_id: String,
    /// Unix seconds.
    pub activity_date: f64,
    /// Seconds.
    pub section_time: f64,
    /// Metres per second.
    pub speed: f64,
    /// Seconds faster than the step before. `None` on the first step.
    pub improvement_secs: Option<f64>,
    /// Metres per second faster than the step before. `None` on the first
    /// step.
    pub improvement_speed: Option<f64>,
}

/// The record progression per direction, oldest step first, over the whole
/// included history. Empty in a direction that holds no record.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiRecordProgressions {
    pub forward: Vec<FfiRecordStep>,
    pub reverse: Vec<FfiRecordStep>,
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
    /// The oldest point's date, unix seconds.
    pub first_activity_date: Option<f64>,
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

/// One stored activity as the detail screen reads it, typed from the body
/// intervals.icu sent. A figure the body does not carry is `None`; the three
/// the screen always draws are zero instead, as a manual entry sends them.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiActivityRecord {
    /// The key the body is stored under, which is the id the screen asked for.
    pub id: String,
    /// Whether the body is the detail form rather than the list row, which
    /// lacks most of the figures below until the detail fetch replaces it.
    pub is_detail: bool,
    pub name: Option<String>,
    /// The sport as the body names it, absent when it names none.
    pub sport_type: Option<String>,
    /// The wall-clock start, as stored.
    pub start_date_local: Option<String>,
    pub description: Option<String>,
    pub device_name: Option<String>,
    /// Seconds.
    pub moving_time: u32,
    /// Metres.
    pub distance: f64,
    /// Metres climbed.
    pub elevation_gain: f64,
    /// Beats per minute.
    pub avg_hr: Option<f64>,
    pub max_hr: Option<f64>,
    /// Watts.
    pub avg_power: Option<f64>,
    pub max_power: Option<f64>,
    /// Kilocalories.
    pub calories: Option<f64>,
    pub training_load: Option<f64>,
    /// Intensity factor as a percentage.
    pub intensity: Option<f64>,
    /// The FTP the activity was scored against, and the eFTP it estimated.
    pub ftp: Option<f64>,
    pub eftp: Option<f64>,
    pub trimp: Option<f64>,
    pub strain_score: Option<f64>,
    /// Heart rate recovery, the drop in beats per minute.
    pub hr_recovery: Option<f64>,
    pub efficiency_factor: Option<f64>,
    /// Aerobic decoupling in percent, `None` when intervals.icu stored no
    /// finite value.
    pub decoupling: Option<f64>,
    /// Whether the temperatures below include intervals.icu's weather.
    pub has_weather: bool,
    /// Degrees Celsius from the weather.
    pub weather_temp: Option<f64>,
    /// Degrees Celsius from the device's own sensor.
    pub sensor_temp: Option<f64>,
    /// Degrees Celsius, from whichever of its names the body carries.
    pub feels_like: Option<f64>,
    /// Metres a second.
    pub wind_speed: Option<f64>,
    /// The stream kinds intervals.icu holds for the activity.
    pub stream_types: Vec<String>,
}

/// The rows of a sample library, in the shapes the stores take them, for the
/// widgets to draw while no account is signed in.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSampleLibrary {
    pub athlete_json: String,
    pub sport_settings_json: String,
    pub wellness: Vec<crate::persistence::wellness::WellnessRow>,
    pub activities: Vec<FfiActivityBody>,
    /// The sets of the library's strength sessions, each naming its activity.
    pub exercise_sets: Vec<FfiExerciseSet>,
}

/// The family a sport is drawn and filtered in, in stack order. The feed's
/// chips and the map's counts are one per family, and Other takes every
/// sport no family lists, so a sport nobody listed still answers to a chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiSportFamily {
    Ride,
    Winter,
    Run,
    Water,
    Foot,
    Strength,
    Other,
}

impl FfiSportFamily {
    pub const ALL: [Self; 7] = [
        Self::Ride,
        Self::Winter,
        Self::Run,
        Self::Water,
        Self::Foot,
        Self::Strength,
        Self::Other,
    ];

    /// The one family a sport is in.
    pub fn of(sport: &str) -> Self {
        let name = crate::sport::sport_family(sport);
        Self::ALL
            .into_iter()
            .find(|family| family.name() == name)
            .unwrap_or(Self::Other)
    }

    /// The family's name in `sport::FAMILIES`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Ride => "Ride",
            Self::Winter => "Winter",
            Self::Run => "Run",
            Self::Water => "Water",
            Self::Foot => "Foot",
            Self::Strength => "Strength",
            Self::Other => "Other",
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
    /// An empty list matches every sport; otherwise any selected family matches.
    pub sport_families: Vec<FfiSportFamily>,
    pub offset: u32,
    /// None returns every match from the offset on.
    pub limit: Option<u32>,
}

/// What one feed card draws, typed from the stored body.
///
/// Built from the body rather than `activity_metrics`, which files a body
/// with no sport as a ride and keeps heart rate and power as whole numbers.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiFeedCard {
    /// The row key the body is stored under. A route or a fetch names the
    /// activity by this, never by the body's own `id`, which for an uploaded
    /// recording is the server's id rather than the row's.
    pub id: String,
    /// The intervals.icu id a web link may name. None for a demo row and for
    /// a recording no server has named.
    pub intervals_web_id: Option<String>,
    /// The sport as the body carries it. None when it names none.
    pub sport_type: Option<String>,
    /// Empty when the body has none.
    pub name: String,
    /// The wall-clock start as the body carries it, with no zone. Empty when
    /// the body has none.
    pub start_date_local: String,
    /// Metres.
    pub distance: Option<f64>,
    /// Seconds.
    pub moving_time: Option<f64>,
    /// Metres climbed.
    pub elevation_gain: Option<f64>,
    /// Beats per minute.
    pub avg_hr: Option<f64>,
    /// Watts.
    pub avg_power: Option<f64>,
    pub training_load: Option<f64>,
    /// Kilocalories.
    pub calories: Option<f64>,
    pub has_weather: bool,
    /// Degrees Celsius.
    pub average_weather_temp: Option<f64>,
    /// The elevation skyline as intervals.icu encodes it, base64.
    pub skyline_chart_bytes: Option<String>,
    /// Whether the activity recorded a `latlng` stream.
    pub has_gps: bool,
    /// Whether the activity recorded an `altitude` stream, which makes a zero
    /// climb a measurement rather than a missing one.
    pub has_altitude: bool,
    /// The fault the last sync met readying this activity, which the card
    /// marks with a retry. None when its last readying was clean.
    pub sync_failure: Option<crate::persistence::activity_sync_failures::ActivitySyncFailure>,
}

/// One page of feed cards, newest first, with the count of everything the
/// query matched.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiFeedCardsPage {
    pub cards: Vec<FfiFeedCard>,
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

/// The stored wellness days of a window and whether the window was pulled.
///
/// An empty `days` is either a window the account holds nothing in or one the
/// device never downloaded, and the charts drawing it said the same for both.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWellnessDays {
    /// Oldest first.
    pub days: Vec<FfiWellnessDay>,
    pub coverage: crate::RangeCoverage,
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
    /// moving apart by more than their own scatter, `lastTwoDays` for the
    /// override fired by two consecutive readings below the window mean and
    /// apart from the readings before them. Both can say
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
    /// Timed, eligible laps in the record's direction.
    pub standing_count: u32,
    /// Percent of other counted laps slower than the record, when at least three count.
    pub percentile_faster: Option<u32>,
    /// The next fastest counted lap in the record's direction.
    pub previous_best_time: Option<f64>,
    pub previous_best_date: Option<f64>,
    pub delta_seconds: Option<f64>,
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
    /// The trend's size: the recent median moving time minus the previous
    /// median, in seconds, negative faster. `None` where `trend` is 0.
    pub trend_seconds: Option<f64>,
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
    /// Swimming pace trend
    pub swim_pace_trend: FfiPaceTrend,
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
    /// Start of the current week, filled by the engine from current_end
    pub current_start: f64,
    /// Current wall-clock second; the engine derives both week windows from it
    pub current_end: f64,
    /// Start of the previous week, filled by the engine
    pub prev_start: f64,
    /// End of the previous elapsed week, filled by the engine
    pub prev_end: f64,
    /// Start of the four-week chronic window, filled by the engine
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
    /// Whether the engine holds this activity's track. The map then draws the
    /// line from the engine's `veloq-geo` URL rather than receiving it as text;
    /// without one it is sent inline from the streams.
    pub has_gps_track: bool,
    /// Total sections held by the engine
    pub section_count: u32,
    /// The route group this activity belongs to, if it meets the caller's
    /// minimum. At most one: the screen asks which group holds this activity,
    /// so the catalogue was what it searched rather than what it needed.
    pub route_groups: Vec<FfiRouteGroup>,
    /// The stored signature of that group's representative activity, delta+varint
    /// encoded: the line the Routes tab draws over the map. Empty when the
    /// activity is in no group or the representative has no signature.
    pub representative_signature: Vec<u8>,
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
    /// own zones, then the sport setting for its type, then 190. The stat card
    /// and the zones chart both divide by it.
    pub max_hr: f64,
    /// Which of those `max_hr` came from, so a screen can tell the athlete's
    /// own maximum from the default.
    pub max_hr_source: FfiMaxHrSource,
    /// The heart rate zone bands for this activity and the time in each, from
    /// the same resolver live recording classifies with. Empty when the
    /// activity has no heart rate time to show.
    pub hr_zones: Vec<FfiHrZoneBand>,
    /// The summary stored with the activity, read whether or not its streams
    /// were ever fetched.
    pub summary: FfiActivitySummary,
    /// The power zone bands in watts for this activity and the time in each,
    /// from its own zones and FTP. Empty when the activity has no power zone
    /// time or no zones to place it in.
    pub power_zones: Vec<FfiPowerZoneBand>,
    /// Section changes whose ledger rows name this activity, newest first.
    pub ledger_changes: Vec<crate::persistence::sections::history::ActivityLedgerChange>,
    /// The intervals.icu id a web link may name. None for a demo row and for
    /// a recording no server has named, which have no page there.
    pub intervals_id: Option<String>,
    /// A pool swim's lengths, rests, SWOLF and per-stroke totals. None for
    /// every sport but `Swim`.
    pub pool_swim: Option<FfiPoolSwim>,
    /// The fault the last sync met readying this activity, which the screen
    /// marks with a retry. None when its last readying was clean.
    pub sync_failure: Option<crate::persistence::activity_sync_failures::ActivitySyncFailure>,
    /// Set when intervals.icu holds this activity but does not serve it to
    /// apps, which is why its figures are empty. None for a served activity.
    pub held_back: Option<crate::persistence::activity_held_back::ActivityHeldBack>,
    /// Where the activity's data was filled from, so the screen can say so.
    pub provenance: crate::persistence::origin::ActivityProvenance,
}

/// Where a pool swim's lengths stand, read from its FIT file. The
/// discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiPoolSwimState {
    /// The file has not been read yet: no verdict is stored for it.
    Owed = 1,
    /// The file was read and its lengths are stored.
    Read = 2,
    /// Settled with no lengths: upstream has no file, the file carries none,
    /// or the decoder refused it.
    NoLengths = 3,
}

/// The unit a pool is measured in, inferred from its length. The
/// discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiPoolUnit {
    Metres = 1,
    Yards = 2,
}

/// A pool swim's lengths as the activity detail screen paints them.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPoolSwim {
    pub state: FfiPoolSwimState,
    /// The pool length in metres, whichever unit the device showed.
    pub pool_length_m: Option<f64>,
    /// The unit the pool is measured in. Metres when the length is unknown.
    pub pool_unit: FfiPoolUnit,
    /// Every length in file order, rests in place. Empty unless `Read`.
    pub lengths: Vec<FfiPoolLength>,
    /// One per stroke swum, in the order each stroke first appears, over the
    /// active lengths alone.
    pub stroke_totals: Vec<FfiPoolStrokeTotal>,
}

/// One length of the pool, or one rest.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPoolLength {
    /// The length's place in the file, from zero, rests counted.
    pub index: u32,
    /// False for a rest, which the device records as an idle length.
    pub active: bool,
    /// The FIT SwimStroke number. None for a rest or an unrecorded stroke.
    pub stroke: Option<u8>,
    /// A locale key naming the stroke (`freestyle`, `breaststroke`, ...),
    /// `unknown` for an active length with no stroke. None for a rest.
    pub stroke_key: Option<String>,
    /// Seconds from the push-off to the wall, or the rest's duration.
    pub elapsed_secs: Option<f64>,
    pub strokes: Option<u16>,
    /// Metres per second over the pool length. None for a rest.
    pub speed_mps: Option<f64>,
    /// Elapsed seconds plus strokes. None for a rest or a length with no
    /// stroke count or no time.
    pub swolf: Option<f64>,
}

/// One stroke's share of a pool swim, over its active lengths.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPoolStrokeTotal {
    pub stroke: Option<u8>,
    pub stroke_key: String,
    pub lengths: u32,
    /// Lengths times the pool length. None when the pool length is unknown.
    pub distance_m: Option<f64>,
    pub elapsed_secs: f64,
    /// Distance over time. None when either is unknown or zero.
    pub speed_mps: Option<f64>,
    /// The mean SWOLF of the lengths that have one.
    pub avg_swolf: Option<f64>,
}

/// The summary intervals.icu stored with an activity. Each field is `None`
/// when the activity carries no positive value for it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivitySummary {
    /// Moving time in seconds
    pub moving_time: Option<f64>,
    /// Elapsed time in seconds, pauses and stops included
    pub elapsed_time: Option<f64>,
    /// Average speed in m/s
    pub average_speed: Option<f64>,
    /// Max speed in m/s
    pub max_speed: Option<f64>,
    /// Average cadence in `cadence_unit`: steps a minute on foot, where
    /// intervals.icu stores strides
    pub average_cadence: Option<f64>,
    /// The unit this sport's cadence is shown in, here and in its stream
    pub cadence_unit: FfiCadenceUnit,
}

/// The unit a sport's cadence is shown in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiCadenceUnit {
    /// Crank revolutions a minute, and the stored cycles of a sport no list names.
    Rpm,
    /// Steps a minute, twice the strides intervals.icu stores.
    StepsPerMinute,
    /// Strokes a minute, as stored.
    StrokesPerMinute,
}

/// Where an activity's max HR came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiMaxHrSource {
    /// The top bound of the activity's own heart rate zones.
    ActivityZones,
    /// The `max_hr` of the athlete's sport settings for the activity's type.
    SportSettings,
    /// Neither carries one, so the value is the engine's default.
    Default,
}

/// An activity's contribution against a rest day, before display rounding.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityFitnessImpact {
    pub fitness: f64,
    pub fatigue: f64,
    pub form: f64,
    /// The fitness time constant in days in effect on the activity's date
    pub fitness_days: u32,
    /// The fatigue time constant in days in effect on the activity's date
    pub fatigue_days: u32,
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
    /// The share as a whole percent, the bands' shares totalling 100
    pub share: u32,
}

/// One power zone of a saved activity.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPowerZoneBand {
    /// Zone number, from 1
    pub zone: u32,
    /// Lower edge in watts, 0 for zone 1
    pub min_watts: u32,
    /// Upper edge in watts, absent for the open top zone
    pub max_watts: Option<u32>,
    /// Seconds spent in the zone
    pub seconds: f64,
    /// Share of the total time in zones, 0 to 100
    pub percent: f64,
    /// The share as a whole percent, the bands' shares totalling 100
    pub share: u32,
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

/// An activity row in the section detail read.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionActivityRow {
    pub activity_id: String,
    pub name: String,
    pub sport_type: String,
    /// Unix seconds, as stored by the engine.
    pub start_time: f64,
    pub distance: f64,
    pub moving_time: u32,
    /// Metres per second; zero when moving time is zero.
    pub average_speed: f64,
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
    /// Display rows for every activity on the section
    pub activity_rows: Vec<FfiSectionActivityRow>,
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
    pub calendar_summary: Option<crate::CalendarSummary>,
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
    pub lap_records: Vec<crate::SectionPerformanceRecord>,
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
    /// True when this read left the curves owed rather than computing them:
    /// a detail screen's read serves them only once held, and
    /// `SectionManager::load_detail_performance` computes them off the JS
    /// thread.
    pub curves_pending: bool,
    /// Aerobic efficiency over the answered sport's counted efforts across the
    /// whole record, or `None` with fewer than three that carry heart rate.
    pub efficiency_trend: Option<FfiEfficiencyTrend>,
    /// The range each direction's scatter axis draws, with the points past it
    /// counted. Speed on a section, time on a route.
    pub scatter_focus: FfiScatterFocus,
    /// Each direction's record progression over the whole included history,
    /// whatever the range: the screen draws the steps inside the range and
    /// carries the level in from before it.
    pub record_progression: FfiRecordProgressions,
}

/// Whose attempts a performance read answers: a section's laps, or a route's
/// whole activities in the section read's shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiPerformanceSubject {
    Section,
    Route,
}

/// Which lap a direction's deltas are measured against. The stored curves are
/// measured against `Record` or `AthleteSet`; the others are references a
/// chart re-bases onto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiReferenceSource {
    /// The direction's record over the whole included history.
    Record,
    /// The activity the athlete set as the section's reference.
    AthleteSet,
    /// The lap that held the direction's record before the current one.
    PreviousRecord,
    /// The point-by-point median of the laps other than the record.
    Typical,
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

/// A run of 32-bit floats, held once and shared by every read that keeps it,
/// so a clone copies a pointer and not the values. It crosses the bridge as
/// its values in little-endian bytes and arrives as a `Float32Array`, so a
/// long curve is one copy rather than a lift per value. Both platforms the
/// app ships on are little-endian, which is the order a `Float32Array` reads.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FfiFloat32Array(std::sync::Arc<[f32]>);

impl FfiFloat32Array {
    pub fn to_le_bytes(&self) -> Vec<u8> {
        self.0
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    /// `None` for bytes that are not a whole number of floats.
    pub fn from_le_bytes(bytes: &[u8]) -> Option<Self> {
        let (floats, remainder) = bytes.as_chunks::<4>();
        if !remainder.is_empty() {
            return None;
        }
        Some(Self(
            floats
                .iter()
                .map(|&four| f32::from_le_bytes(four))
                .collect(),
        ))
    }
}

impl std::ops::Deref for FfiFloat32Array {
    type Target = [f32];

    fn deref(&self) -> &[f32] {
        &self.0
    }
}

impl<'a> IntoIterator for &'a FfiFloat32Array {
    type Item = &'a f32;
    type IntoIter = std::slice::Iter<'a, f32>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl From<Vec<f32>> for FfiFloat32Array {
    fn from(values: Vec<f32>) -> Self {
        Self(values.into())
    }
}

uniffi::custom_type!(FfiFloat32Array, Vec<u8>, {
    lower: |floats| floats.to_le_bytes(),
    try_lift: |bytes| match FfiFloat32Array::from_le_bytes(&bytes) {
        Some(floats) => Ok(floats),
        None => uniffi::deps::anyhow::bail!("{} bytes are not a run of f32", bytes.len()),
    },
});

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
    /// The largest number of seconds any of `laps` is behind or ahead of the
    /// reference, 0 when none has a finite delta.
    pub peak_delta_secs: f32,
    /// The typical lap's time against the reference per split, over the laps
    /// other than the reference. `None` when no split has enough laps.
    pub split_summary: Option<FfiSplitSummary>,
    /// The typical lap's delta at each grid point, the median over the laps
    /// other than the reference that reach it. NaN at a point fewer laps
    /// reach than a typical lap needs, and `None` when no point has enough.
    pub typical_delta_secs: Option<FfiFloat32Array>,
    /// The lap that held the record before the current one, measured against
    /// the reference like every lap, whatever the range. `None` when the
    /// record has never been beaten or that lap has no curve.
    pub previous_record: Option<FfiLapDelta>,
    /// The reference the chart opens on for the highlighted attempt: the
    /// athlete's own when set, else the record, else the previous record when
    /// the highlighted attempt is the record and so level with itself.
    pub default_reference: FfiReferenceSource,
}

/// Each split's distribution of `split_delta_secs` over a direction's laps,
/// the reference left out, in travel order. A split's median is NaN under
/// the laps a typical lap needs and its quartiles NaN under the laps a spread
/// needs.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSplitSummary {
    pub median_secs: FfiFloat32Array,
    pub lower_quartile_secs: FfiFloat32Array,
    pub upper_quartile_secs: FfiFloat32Array,
    /// The laps with a finite delta over each split, which its figures come
    /// from.
    pub laps: Vec<u32>,
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
    pub delta_secs: FfiFloat32Array,
    /// The change in delta over each split, in travel order. NaN for a split
    /// the lap does not fully cover.
    pub split_delta_secs: FfiFloat32Array,
    /// The lap's own seconds over each split, on the split grid of
    /// `split_delta_secs`. NaN for a split the lap does not fully cover.
    pub split_secs: FfiFloat32Array,
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

/// Everything the route detail screen paints with that one sport and one
/// range do not change. It carries this route and nothing of any other, so it
/// stays the same size as the library grows; the attempt times come from the
/// route detail performance read.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// The route itself, or `None` when the ID is unknown. Its `custom_name`
    /// is the name it is shown under.
    pub group: Option<FfiRouteGroup>,
    /// The representative activity's distance in meters, the figure the routes
    /// list shows and sorts on. Zero when the route is unknown.
    pub distance_meters: f64,
    /// The representative activity's elevation gain in meters, the climbing
    /// the route hero shows beside its distance. Zero when the route is
    /// unknown.
    pub elevation_gain_meters: f64,
    /// Representative activity's polyline, delta+varint encoded
    pub encoded_representative: Vec<u8>,
    /// Activities the user excluded from this route
    pub excluded_activity_ids: Vec<String>,
    /// Simplified GPS signatures for the route's activities
    pub map_signatures: Vec<FfiMapSignature>,
    /// The route's activities whose time streams still have to be fetched
    /// before the delta curves can draw them
    pub missing_time_stream_ids: Vec<String>,
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
    /// What the latest activity is measured against: its route, the sections
    /// it set a record on, and the load it usually carries
    pub latest_comparison: WidgetLatestComparison,
    /// The latest activity's GPS track, empty for indoor activities
    pub latest_gps: Vec<GpsPoint>,
    /// The ramp rate intervals.icu computed, off the newest wellness day that
    /// carries one. `None` before wellness has synced. The widget derived its
    /// own from the fitness sparkline, which is a different number from the
    /// same data.
    pub ramp_rate: Option<f64>,
    /// Strength work over today and the 29 days before it, the strength
    /// screen's 30-day window
    pub strength_last30: WidgetStrengthWindow,
    /// The `sex` of the stored intervals.icu profile, which picks the body the
    /// strength diagram draws
    pub athlete_sex: Option<String>,
}

/// One window of strength work, read as the strength screen reads its period.
#[derive(Debug, Clone, Default)]
pub struct WidgetStrengthWindow {
    pub summary: FfiStrengthSummary,
    /// Strength activities in the window whose sets have not been downloaded
    pub owed_count: u32,
    /// The sessions that worked each muscle, by slug
    pub muscle_sessions: std::collections::HashMap<String, u32>,
}

/// What the latest activity is compared against, read from the values the
/// feed card and the route screen already show.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WidgetLatestComparison {
    /// The route the activity rode, when it has at least one other attempt
    pub route: Option<WidgetRouteStanding>,
    /// How many sections the activity holds the record on
    pub section_pr_count: u32,
    /// The median recorded load of the same sport's activities in the four
    /// weeks before it, the load an activity with no route is judged against
    pub typical_load: Option<f64>,
}

/// Where the latest activity stands among the attempts at its route.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WidgetRouteStanding {
    pub route_name: String,
    /// The route screen's rank among comparable attempts, one a strict record
    pub rank: Option<u32>,
    /// Timed comparable attempts in the activity's direction, itself included
    pub attempt_count: u32,
    /// Seconds behind the route record, zero for the record itself
    pub time_delta_seconds: Option<i32>,
    /// Moving time of every other comparable attempt, oldest first
    pub prior_attempt_seconds: Vec<u32>,
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

/// What a best effort's checkpoint measures. The front end words it in the
/// athlete's language and units, so the engine sends no display string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiBestEffortKind {
    /// A duration in seconds, for power.
    Duration,
    /// A distance in metres, for pace.
    Distance,
    /// The half marathon, a distance in metres named for its race.
    HalfMarathon,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBestEffort {
    pub kind: FfiBestEffortKind,
    /// Seconds for power, metres for pace.
    pub checkpoint: f64,
    /// Watts for power, metres per second for pace. Empty when the curve
    /// holds no sample within tolerance of the checkpoint.
    pub value: Option<f64>,
    /// Seconds taken to cover the distance, for pace only.
    pub time: Option<f64>,
    pub activity_id: Option<String>,
    /// The name and start of the activity holding the best, when the device
    /// holds that activity. Empty for one it does not, which the screen shows
    /// as not cached.
    pub activity: Option<FfiActivityName>,
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
    /// The name and start of the activity holding the best, when the device
    /// holds that activity.
    pub activity: Option<FfiActivityName>,
}

// ============================================================================
// Fitness Screen Calendar Types
// ============================================================================

/// The windows the fitness tab's calendar, week and year cards draw, each
/// fixed for as long as it stays mounted. The front end names them because
/// its grid and its season cards lay out the same days.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiFitnessScreenWindows {
    /// The first day the heatmap may draw, its cap, and its last drawn day,
    /// `YYYY-MM-DD`, inclusive. The read answers the first day it draws.
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
    /// The instant the weekly card's periods run to, in the wall-clock seconds
    /// an activity's date is recorded in.
    pub now_wall_seconds: f64,
}

/// One total of a period against the same elapsed part of the period before,
/// judged once in the engine.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStatTrend {
    /// The glyph `trend_table::glyph` draws for the move.
    pub glyph: String,
    /// The size of the move in whole percent of the earlier total, absent for
    /// a move inside the deadband.
    pub percent: Option<u32>,
    /// The signed move in percent of the earlier total, unrounded, for a card
    /// that prints its own precision.
    pub change: f64,
}

/// A period against an earlier one, each window inclusive at both ends. A
/// trend is absent when the earlier period has none of that total, so nothing
/// is compared with zero, and every trend is absent while either period is
/// not fully on the device.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSummaryComparison {
    pub current: FfiTimestampRange,
    pub previous: FfiTimestampRange,
    pub current_stats: FfiPeriodStats,
    pub previous_stats: FfiPeriodStats,
    pub count: Option<FfiStatTrend>,
    pub duration: Option<FfiStatTrend>,
    pub distance: Option<FfiStatTrend>,
    pub load: Option<FfiStatTrend>,
    /// Whether each period's activities are on the device, by the census.
    pub current_coverage: crate::RangeCoverage,
    pub previous_coverage: crate::RangeCoverage,
}

/// Every range the weekly card offers, so a tap between them reads nothing.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSummaryComparisons {
    /// Monday to now, against the same weekday and hour of last week.
    pub week: FfiSummaryComparison,
    /// The calendar month to now.
    pub month: FfiSummaryComparison,
    /// This calendar month and the two before it, to now.
    pub three_months: FfiSummaryComparison,
    /// This calendar month and the five before it, to now.
    pub six_months: FfiSummaryComparison,
    /// The calendar year to now.
    pub year: FfiSummaryComparison,
}

// ============================================================================
// Fitness Screen Types
// ============================================================================

/// Everything the fitness tab paints with that stays fixed while it is
/// mounted, its calendar, weekly card and year comparison among it. Its sport
/// is chosen with a tap, so the reads over it are their own; the parts that
/// follow the range carry every span, and the weekly card every range, so a
/// tap reads nothing.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiFitnessScreenData {
    /// The cycling eFTP compared across the chart's three months, with the
    /// daily series of that window and every activity that moved it.
    pub ftp_trend: FfiFtpTrend,
    /// Whether the wellness the trend is read from was pulled for the days
    /// its chart draws. `NotFetched` makes an empty chart a download still
    /// owed rather than an athlete with no estimate.
    pub ftp_trend_coverage: crate::RangeCoverage,
    /// The last stored critical speeds, the threshold the running and
    /// swimming cards fall back on when no curve is to hand.
    pub run_pace_trend: FfiPaceTrend,
    pub swim_pace_trend: FfiPaceTrend,
    /// The rides, runs and swims among the latest activities, which the
    /// primary sport defaults to until the athlete chooses one.
    pub sport_mix: FfiSportMix,
    /// The fitness time constant in days in effect today
    pub fitness_days: u32,
    /// The fatigue time constant in days in effect today
    pub fatigue_days: u32,
    /// The cycling FTP the athlete set, in watts, else the one the newest
    /// cycling activity was analysed against.
    pub cycling_ftp_setting: Option<f64>,
    /// The running LTHR the athlete set, in bpm.
    pub running_lthr: Option<f64>,
    /// The decoupling ride of each span the read was asked for, in that order.
    pub decoupling_sources: Vec<FfiSpanDecoupling>,
    /// Every activity inside the longest span asked for, oldest first, for the
    /// strip under the fitness plot.
    pub load_dots: Vec<FfiLoadDot>,
    /// Days with activities from `calendar_first_day` to the window's last
    /// day, oldest first.
    pub heatmap: Vec<FfiHeatmapDay>,
    /// The calendar's first drawn day, `YYYY-MM-DD`: the Monday of the latest
    /// of the held window's oldest day and the account's oldest activity, and
    /// never before the window's first day, which is the calendar's cap.
    pub calendar_first_day: String,
    /// The activities from the cap to the day before `calendar_first_day`
    /// that the account holds and the device has not downloaded.
    pub calendar_older_owed: u32,
    /// Calendar months with activities inside the monthly span, oldest first.
    pub months: Vec<FfiMonthlyStats>,
    /// The year to date against the same span of last year.
    pub season_year: FfiSummaryComparison,
    /// Each month of this year to date against the same month a year before,
    /// January first: the months before this one whole, then this month to
    /// date against the same span of last year's.
    pub season_months: Vec<FfiSummaryComparison>,
    /// The weekly card's periods to now, each against the same span before.
    pub comparisons: FfiSummaryComparisons,
}

/// The ride the decoupling card names for one span of the range picker.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSpanDecoupling {
    /// The span's length in days, back from today.
    pub days: u32,
    /// `None` when no ride inside the span qualifies.
    pub source: Option<FfiDecouplingSource>,
}

/// The newest cycling activity of half an hour or more with power, heart rate
/// and a finite decoupling stored by intervals.icu, and that value.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDecouplingSource {
    pub activity_id: String,
    pub name: String,
    /// Wall-clock start, `YYYY-MM-DDTHH:MM:SS`.
    pub start_date_local: String,
    /// Percentage, as intervals.icu computed it.
    pub decoupling: f64,
}

/// One activity as the fitness strip marks it and its day picker lists it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiLoadDot {
    pub activity_id: String,
    pub name: String,
    pub sport_type: String,
    /// Wall-clock start, `YYYY-MM-DDTHH:MM:SS`.
    pub start_date_local: String,
    /// Seconds.
    pub moving_time: u32,
    /// Metres.
    pub distance: f64,
    /// The recorded training load, zero when none is recorded.
    pub load: f64,
}

/// The latest activities by the three sports the fitness tab draws.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSportMix {
    pub rides: u32,
    pub runs: u32,
    pub swims: u32,
    /// "Cycling", "Running" or "Swimming", whichever counts the most. `None`
    /// for an empty library or a tie, which is no evidence for either sport.
    pub dominant: Option<String>,
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
    /// The section overlay, present only while the layer is requested
    pub sections: Option<FfiMapSectionLayer>,
    /// Why the map draws no activity, from the date window's own counts.
    /// `None` while `activities` holds one.
    pub empty_reason: Option<FfiMapEmptyReason>,
    /// The window's activities with no stored track that pass the same sport,
    /// distance and name filters as `activities`, so the two together are
    /// every activity in the period the filters keep.
    pub unmapped: FfiMapUnmapped,
}

/// The activities a map read keeps but cannot draw, by why.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, uniffi::Record)]
pub struct FfiMapUnmapped {
    /// No track is owed: no GPS upstream, a track refused for good, or one the
    /// download gave up on, as `FfiMapEmptyReason::NoGps` reads it.
    pub without_gps: u32,
    /// A track is upstream and the GPS download has still to fetch it.
    pub downloading: u32,
}

/// Why the map draws no activity, so the tab names its cause rather than
/// showing a bare basemap.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum FfiMapEmptyReason {
    /// No activity falls inside the date window.
    NoActivities,
    /// The window holds tracks and the sport, distance or name filters leave
    /// none of them. `mapped` is the window's tracks before those filters.
    Filtered { mapped: u32 },
    /// The window's activities have no stored track yet, and `pending` of them
    /// have one upstream that the GPS download has still to fetch.
    TracksPending { activities: u32, pending: u32 },
    /// The window's activities have no track and none is owed: trainer, pool
    /// or strength sessions, or tracks the download gave up on.
    NoGps { activities: u32 },
}

/// The route-line layer the map draws, with the generation it was built from
/// so the front end can keep what it decoded while the generation is unchanged.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteLineLayer {
    /// The route group generation the lines were built from. Declared as a
    /// double, which holds every generation a library reaches exactly.
    pub generation: f64,
    /// The database state the layer was read in, which the caller passes back
    /// to say it still holds these lines. `None` when the read could not vouch
    /// for one.
    pub stamp: Option<f64>,
    /// The lines, absent when the caller passed back this layer's `stamp`:
    /// nothing has committed since, so the lines and names it holds are these.
    pub routes: Option<Vec<FfiRouteLine>>,
}

/// The section overlay the map draws, stamped so a filter change that re-reads
/// the map does not ship a catalogue the caller already holds.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapSectionLayer {
    /// The database state the overlay was read in, passed back to say the
    /// caller still holds it. `None` when the read could not vouch for one.
    pub stamp: Option<f64>,
    /// The sections, absent when the caller passed back this layer's `stamp`.
    pub sections: Option<Vec<FfiMapSection>>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteLine {
    pub route_id: String,
    /// The number the route is shown under, absent until one is minted
    pub route_number: Option<u32>,
    /// The name the route is shown under, read when the map is, so a rename
    /// shows without the layer being rebuilt
    pub name: String,
    /// The activities in the route
    pub activity_count: u32,
    /// The representative's distance in metres, the figure the route list
    /// shows, read when the map is
    pub distance_meters: f64,
    /// The representative's signature in `codec::encode_polyline` form
    pub polyline: Vec<u8>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapCategoryCount {
    pub family: FfiSportFamily,
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

    // A second calendar struct beside the domain one let a new field reach the
    // engine and stop at the boundary, so the screen read carries the domain
    // value as it is and this only compiles while that holds.
    #[test]
    fn section_performance_data_carries_the_domain_calendar_summary() {
        fn calendar_of(data: &FfiSectionPerformanceData) -> Option<&crate::CalendarSummary> {
            data.calendar_summary.as_ref()
        }
        let _ = calendar_of;
    }

    fn lowered_and_lifted<T>(value: T) -> T
    where
        T: uniffi::Lower<crate::UniFfiTag> + uniffi::Lift<crate::UniFfiTag>,
    {
        let mut buf = Vec::new();
        <T as uniffi::Lower<crate::UniFfiTag>>::write(value, &mut buf);
        let mut bytes = buf.as_slice();
        let lifted = <T as uniffi::Lift<crate::UniFfiTag>>::try_read(&mut bytes).expect("lift");
        assert!(
            bytes.is_empty(),
            "the lift left {} bytes unread",
            bytes.len()
        );
        lifted
    }

    // The track point and the bounding box cross the boundary as the matcher's
    // own types, so a field the matcher gains cannot be dropped by a copy.
    #[test]
    fn matcher_point_and_bounds_cross_the_boundary_unchanged() {
        let bare = crate::GpsPoint::new(46.2, 7.35);
        let raised = crate::GpsPoint::with_elevation(-33.9, 151.2, 512.5);
        assert_eq!(lowered_and_lifted(bare), bare);
        assert_eq!(lowered_and_lifted(raised), raised);
        assert_eq!(lowered_and_lifted(vec![bare, raised]), vec![bare, raised]);

        let bounds = crate::Bounds {
            min_lat: 1.0,
            max_lat: 2.0,
            min_lng: 3.0,
            max_lng: 4.0,
        };
        assert_eq!(lowered_and_lifted(bounds), bounds);
        assert_eq!(lowered_and_lifted(Some(bounds)), Some(bounds));
    }

    /// Bytes `value` lowers to, read back as the type the app lifts them as.
    fn lowered_as<T, U>(value: T) -> U
    where
        T: uniffi::Lower<crate::UniFfiTag>,
        U: uniffi::Lift<crate::UniFfiTag>,
    {
        let mut buf = Vec::new();
        <T as uniffi::Lower<crate::UniFfiTag>>::write(value, &mut buf);
        let mut bytes = buf.as_slice();
        let read = <U as uniffi::Lift<crate::UniFfiTag>>::try_read(&mut bytes).expect("lift");
        assert!(bytes.is_empty(), "{} bytes left unread", bytes.len());
        read
    }

    // A record the domain struct carries across itself keeps its integers as
    // numbers the app reads, never a bigint, and a job run keeps its job and
    // outcome as the tokens the app keys its rows on.
    #[test]
    fn whole_numbers_and_job_tokens_cross_as_the_app_reads_them() {
        use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome};
        assert_eq!(
            lowered_as::<_, f64>(crate::WholeNumber(1_791_000_000_000)),
            1_791_000_000_000.0
        );
        assert_eq!(
            lowered_as::<_, Option<f64>>(direction_stats().last_activity),
            Some(1_700_000_000.0)
        );
        assert_eq!(
            lowered_as::<_, crate::WholeNumber>(27_000.9_f64),
            crate::WholeNumber(27_000)
        );
        assert_eq!(
            lowered_as::<_, crate::WholeNumber>(-0.5_f64),
            crate::WholeNumber(-1),
            "a value from the app is floored, as every export floors"
        );
        assert_eq!(
            lowered_as::<_, String>(BackgroundJob::ElevationBackfill),
            "elevationBackfill"
        );
        assert_eq!(lowered_as::<_, String>(RunOutcome::Deferred), "deferred");
        let mut unknown = Vec::new();
        <String as uniffi::Lower<crate::UniFfiTag>>::write("rebalance".to_string(), &mut unknown);
        assert!(
            <BackgroundJob as uniffi::Lift<crate::UniFfiTag>>::try_read(&mut unknown.as_slice())
                .is_err(),
            "an unknown token is refused"
        );

        let run = JobRun {
            job: BackgroundJob::StreamBackfill,
            finished_at: crate::WholeNumber(1_791_000_000_000),
            outcome: RunOutcome::Partial,
            handled: 2,
            added: 0,
            changed: 1,
            retired: 0,
            failed: 1,
        };
        assert_eq!(lowered_and_lifted(run.clone()), run);

        let lap = lowered_and_lifted(section_lap());
        assert_eq!((lap.start_index, lap.end_index), (17, 104));
        assert_eq!(lap.coverage, Some(1.0));
    }

    fn direction_stats() -> crate::DirectionStats {
        crate::DirectionStats {
            avg_time: Some(300.0),
            last_activity: Some(crate::WholeNumber(1700000000)),
            count: 5,
            avg_speed: Some(4.5),
            outside_band_count: 1,
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
            outside_distance_band: false,
            match_percentage: None,
            is_record: false,
        }
    }

    fn section_record(direction: &str, best_time: f64) -> crate::SectionPerformanceRecord {
        crate::SectionPerformanceRecord {
            activity_id: format!("act_{direction}"),
            activity_name: format!("{direction} effort"),
            activity_date: crate::WholeNumber(1700000000),
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
            date: crate::WholeNumber(1700000000),
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
    fn activity_metrics_from_the_ffi_carry_no_zone_seconds() {
        let ffi = FfiActivityMetrics {
            activity_id: "act_1".to_string(),
            name: "Ride".to_string(),
            date: 1_700_000_000.0,
            distance: 1000.0,
            moving_time: 300,
            elapsed_time: 300,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: Some(40.0),
            ftp: Some(250),
        };
        let row = crate::ActivityMetrics::from(ffi);
        assert_eq!(row.training_load, Some(40.0));
        assert_eq!(row.ftp, Some(250));
        assert_eq!(row.power_zone_times, None);
        assert_eq!(row.hr_zone_times, None);
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
                last_activity: Some(crate::WholeNumber(1700000000)),
                count: 5,
                avg_speed: Some(4.5),
                outside_band_count: 0,
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(crate::WholeNumber(1690000000)),
                count: 2,
                avg_speed: Some(3.1),
                outside_band_count: 0,
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
        assert_eq!(ffi.forward_stats.as_ref().unwrap().outside_band_count, 0);
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
                last_activity: Some(crate::WholeNumber(1700000000)),
                count: 5,
                avg_speed: Some(4.5),
                outside_band_count: 1,
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(crate::WholeNumber(1690000000)),
                count: 2,
                avg_speed: Some(3.1),
                outside_band_count: 2,
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
        assert_eq!(ffi.forward_stats.as_ref().unwrap().outside_band_count, 1);
        assert_eq!(ffi.reverse_stats.as_ref().unwrap().outside_band_count, 2);
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

/// What one strength feed card paints, read for a batch of activities at once.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthCardSummary {
    pub activity_id: String,
    /// Stored sets exist, or the FIT file has a recorded outcome. False means a
    /// download is still owed, in flight or failed, so an empty card says nothing.
    pub settled: bool,
    /// Rest, warmup and cooldown sets are not counted.
    pub active_set_count: u32,
    /// Distinct exercise names among the active sets.
    pub exercise_count: u32,
    /// Weight times repetitions over active sets.
    pub total_volume_kg: f64,
    /// Muscle groups the active sets work, primary over secondary.
    pub muscles: Vec<FfiMuscleGroup>,
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
    /// Body-diagram shade, 1 (lightest) to `DIAGRAM_SHADES`, against the
    /// most trained muscle in the same summary
    pub shade: u8,
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
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct FfiStrengthSummary {
    /// Start of the summary's range in Unix seconds, or zero for an undated aggregate.
    pub start_ts: f64,
    /// Per-muscle-group volume data
    pub muscle_volumes: Vec<FfiMuscleVolume>,
    /// Number of WeightTraining activities in the period
    pub activity_count: u32,
    /// Total active sets across all activities
    pub total_sets: u32,
    /// One entry per opposing pair, trained or not
    pub balance: Vec<FfiStrengthBalancePair>,
    /// The most trained muscle's weighted sets, the top of the diagram's
    /// scale, or zero when nothing was trained
    pub max_weighted_sets: f64,
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
/// activity IDs, and the strength cards among them, delivered in a single FFI
/// round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityHighlightsBundle {
    pub indicators: Vec<FfiActivityIndicator>,
    pub route_highlights: Vec<FfiActivityRouteHighlight>,
    /// Tile coverage against earlier activities, for the activities with any.
    pub new_ground: Vec<FfiActivityNewGround>,
    /// One row per strength activity among the ids, with what its card paints.
    pub strength_cards: Vec<FfiStrengthCardSummary>,
}

/// How much of an activity's ground no earlier activity had covered, counted
/// in z17 tiles. It is coverage of a fixed grid, not metres of new road.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiActivityNewGround {
    pub activity_id: String,
    /// `new_tiles` over `tiles`, from 0 to 1.
    pub fraction: f64,
    /// Tiles the activity touches.
    pub tiles: u32,
    /// Tiles no earlier activity touched.
    pub new_tiles: u32,
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
    /// Start of each activity in history_times, Unix seconds, so the sparkline
    /// can place each outing at its date
    pub history_dates: Vec<f64>,
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
    /// Distance ridden from the activity's first point to the pass's first
    /// point, in metres, so the athlete can place the pass along the ride.
    pub start_distance_meters: f64,
}

/// Result of cheap per-activity section indexing after ingest.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiIndexActivitySummary {
    pub matched_sections: u32,
    pub inserted_portions: u32,
    pub regroup_scheduled: bool,
}

impl From<crate::sections::IndexActivitySummary> for FfiIndexActivitySummary {
    fn from(s: crate::sections::IndexActivitySummary) -> Self {
        Self {
            matched_sections: s.matched_sections,
            inserted_portions: s.inserted_portions,
            regroup_scheduled: s.regroup_scheduled,
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
    /// The candidate's line thinned to what a row thumbnail draws, delta+varint
    /// encoded as `FfiRecentPR.encoded_polyline` is. Empty when it cannot be read.
    pub encoded_polyline: Vec<u8>,
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
