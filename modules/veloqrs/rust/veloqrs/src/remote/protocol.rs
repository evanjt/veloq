//! What a linked browser may ask, and the answer to each ask.
//!
//! A request is `{"id": n, "method": "...", "params": {...}}` and its answer
//! `{"id": n, "result": ...}` or `{"id": n, "error": "..."}`. Every method is
//! a read the app's own screens make, answered by the same function, so the
//! browser never sees a number the app does not.
//!
//! Reads are answered from a pooled connection and can write nothing. Writes
//! are rows of the same table marked as writes, answered under the engine lock
//! by the function the phone's own screen calls. Asks are answered on worker
//! threads, so replies may come in any order; the id says which ask a reply
//! answers. A browser withdraws an ask it no longer wants with
//! `{"method": "cancel", "params": {"id": n}}`, which has no reply of its own:
//! an ask still queued is never run, and the reply of one already running is
//! dropped. A connection with [`MAX_OUTSTANDING`] asks outstanding answers the
//! next with the error [`BUSY`]. None of these is a row of the table below: the
//! table is the reads and writes, and a cancel is not one. A method
//! not in the table is `unknown method`, which is how a phone-only operation
//! (credentials, sign-out, clearing the library, backup, restore, linked
//! devices, pairing, experimental and debug switches, deletes) is refused: it
//! is never added. A screen that shows a phone-only operation's state is a
//! read and is answered; the operation itself is not.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The detail screen's own minimum, so the browser reads what the app reads.
const MIN_ROUTE_ACTIVITIES: u32 = 1;

/// The largest feed page one request may ask for.
pub const MAX_PAGE: u32 = 100;

/// The most asks one connection may have outstanding, queued or running. The
/// next is answered with [`BUSY`] at once and is not run.
pub const MAX_OUTSTANDING: usize = 16;

/// The error a connection answers an ask with when [`MAX_OUTSTANDING`] are
/// already outstanding.
pub const BUSY: &str = "busy";

/// The settings a linked browser may read, by key: the preferences the
/// settings screens show. A key not listed here is refused by name and its
/// value is never read, so the credential, the account and the engine's own
/// bookkeeping keys can never cross the link.
pub const SETTING_KEYS: &[&str] = &[
    "veloq-theme-preference",
    "veloq-language-preference",
    "veloq-unit-preference",
    "veloq-resolved-unit-system",
    "veloq-primary-sport",
    "veloq-wellness-smoothing",
    "veloq-map-preferences",
    "veloq-route-settings",
    "veloq-map-routes-visible",
    "veloq-map-heatmap-visible",
    "veloq-map-activities-visible",
    "veloq-heatmap-enabled",
    "veloq-notification-preferences",
    "veloq-recording-preferences",
    "veloq-experimental",
    "dashboard_summary_card",
];

/// Who is asking: the fingerprint the browser presented, the athlete the phone
/// is signed in as and the connections that are up, for the reads that mark
/// the asker or keep to that athlete's rows.
#[derive(Debug, Clone, Copy, Default)]
pub struct Caller<'a> {
    pub browser: &'a str,
    /// The athlete the phone is signed in as, `None` when nobody is.
    pub athlete: Option<&'a str>,
    pub connections: &'a [(String, i64)],
}

/// The newest version of the request, answer and reply-frame shapes this build
/// speaks. A method added within a version is additive; a method removed or
/// reshaped bumps it, and so does any change to the frame layout or its
/// encoding. The tests pin the wire format to this number, so a change to the
/// wire format without a bump fails.
pub const PROTOCOL_VERSION: u32 = 3;

/// The oldest version this build still answers. The support window is this
/// version through [`PROTOCOL_VERSION`]: a bump raises the newest and, once the
/// version two behind has no page build kept online, the oldest. A page and a
/// phone each name a range in `link.hello` and speak the highest version both
/// hold, so an app one release behind the page keeps working.
pub const MIN_PROTOCOL_VERSION: u32 = 2;

/// The first version whose replies are binary frames. Before it a reply is one
/// text message.
pub const FRAMED_FROM: u32 = 3;

/// The highest version in both `min..=max` and this build's own range, or None
/// when the two do not meet or `min` is above `max`.
pub fn negotiate(min: u32, max: u32) -> Option<u32> {
    let highest = max.min(PROTOCOL_VERSION);
    (min <= max && highest >= MIN_PROTOCOL_VERSION.max(min)).then_some(highest)
}

/// The version a request asks its reply in: its `protocol` field, held to this
/// build's range. A request with none comes from a page built before the field
/// existed, which reads the oldest format.
pub fn wire_of(request: &str) -> u32 {
    #[derive(Deserialize)]
    struct Asked {
        protocol: Option<u32>,
    }
    serde_json::from_str::<Asked>(request)
        .ok()
        .and_then(|asked| asked.protocol)
        .map_or(MIN_PROTOCOL_VERSION, |version| {
            version.clamp(MIN_PROTOCOL_VERSION, PROTOCOL_VERSION)
        })
}

/// What `link.hello` is asked: the newest protocol the page speaks, the
/// oldest when it speaks more than one, and a name for the page. A page that
/// names no oldest speaks `protocol` alone.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHello {
    pub protocol: u32,
    #[serde(default)]
    pub min_protocol: Option<u32>,
    pub page: String,
}

/// What `link.hello` answers: the protocol the two will speak (the phone's own
/// newest when the ranges do not meet), the phone's range, the app version,
/// the name of every method it answers, and the name of the phone when it has
/// one. The name is optional, so a page reads an answer without it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHelloAnswer {
    pub protocol: u32,
    pub min_protocol: u32,
    pub max_protocol: u32,
    pub app: String,
    pub methods: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
}

/// What `feed.page` is asked: a window of the feed, narrowed by a search, a
/// set of sport families and a span of start times, as the phone's own filter
/// chips narrow it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkFeedPageAsk {
    #[serde(default)]
    pub offset: u32,
    /// None asks for the largest page the phone allows.
    pub limit: Option<u32>,
    #[serde(default)]
    pub needle: String,
    /// Empty matches every sport.
    #[serde(default)]
    pub sport_families: Vec<crate::FfiSportFamily>,
    /// Inclusive start time in epoch seconds; None reaches the oldest.
    #[serde(default)]
    pub oldest_ts: Option<f64>,
    /// Inclusive start time in epoch seconds; None reaches the newest.
    #[serde(default)]
    pub newest_ts: Option<f64>,
}

/// What `feed.page` answers: the feed read the phone's own list draws, and the
/// preview line of each card on it that has a stored track.
///
/// The lines are the phone card's own (`get_preview_track`), so the browser
/// never simplifies a track itself, and they ride with the page so a row
/// never waits on a second ask.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkFeedPage {
    pub cards: Vec<crate::FfiFeedCard>,
    /// Every stored activity the query matched, not only this page.
    pub matched_count: u32,
    pub has_more: bool,
    /// One per card with GPS and a stored track; a card with none is absent.
    pub previews: Vec<crate::FfiPreviewTrack>,
}

/// What `feed.summary` is asked: the phone's wall-clock time in seconds, from
/// which the engine resolves this week and the one before.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSummaryAsk {
    pub now_wall_seconds: f64,
}

/// What `feed.sparklines` is asked: how many days the series reach back.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSparklinesAsk {
    pub days: u32,
}

/// What `feed.highlights` is asked: the cards a page shows, at most one page.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHighlightsAsk {
    pub ids: Vec<String>,
}

/// What `settings.get` is asked: the keys to read.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSettingsAsk {
    pub keys: Vec<String>,
}

/// One setting as stored; `value` is none when no row is stored.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSettingValue {
    pub key: String,
    pub value: Option<String>,
}

/// What `settings.get` answers: the allowed keys with their values, and the
/// keys refused, which were not read.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSettingsAnswer {
    pub values: Vec<FfiLinkSettingValue>,
    pub refused: Vec<String>,
}

/// What a read that takes nothing is asked.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkNoAsk {
    #[serde(default)]
    pub unused: Option<bool>,
}

/// What `status.linkedDevices` answers: every linked device and the id of the
/// one that asked.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkDevicesAnswer {
    pub devices: Vec<crate::persistence::linked_devices::LinkedDevice>,
    pub this_browser: Option<String>,
}

/// What `map.screen` is asked: the phone's map filters. The date window is in
/// epoch seconds, as the phone reads it; an empty `sportTypes` keeps every sport.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkMapAsk {
    pub start_date: f64,
    pub end_date: f64,
    #[serde(default)]
    pub sport_types: Vec<String>,
    pub distance_band: crate::MapDistanceBand,
    #[serde(default)]
    pub is_metric: bool,
    #[serde(default)]
    pub name_needle: String,
}

/// What `map.screen` answers: the phone's map read without its line layers,
/// and the revisions of the two layers the page fetches by URL, so a filter
/// change that leaves a layer alone refetches nothing.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkMapScreen {
    pub screen: crate::FfiMapScreenData,
    /// The route group generation the route-line layer is built from; `None`
    /// while there is no layer.
    pub route_generation: Option<f64>,
    /// The database state the section layer is read in; `None` when the read
    /// cannot vouch for one.
    pub section_stamp: Option<f64>,
}

/// A GeoJSON `FeatureCollection` as its text.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkGeoText {
    pub text: String,
}

/// What `geo.route` and `geo.routeLatest` are asked: one route group.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkGeoGroupAsk {
    pub group_id: String,
}

/// What `geo.section` and `geo.sectionPasses` are asked: one section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkGeoSectionAsk {
    pub section_id: String,
}

/// What `heatmap.tile` is asked: one tile and the base map it is painted for.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHeatmapTileAsk {
    pub z: u32,
    pub x: u32,
    pub y: u32,
    /// `light`, `dark` or `satellite`.
    pub base: String,
}

/// What `heatmap.tile` answers: the PNG, or `None` for a tile with no heat or
/// one the pass has not drawn yet.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHeatmapTile {
    #[serde(with = "crate::remote::bytes::option")]
    pub png: Option<Vec<u8>>,
}

/// What `heatmap.progress` answers: the tiles the pass has drawn of the tiles
/// it owes, both 0 while no pass runs.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHeatmapProgress {
    pub processed: u32,
    pub total: u32,
}

/// What a method that reads one activity is asked.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkActivityAsk {
    pub id: String,
}

/// What `activity.streams` is asked: the activity and the series the chart
/// draws, in any order.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkStreamsAsk {
    pub id: String,
    pub types: Vec<String>,
}

/// What `activity.record` answers: the stored body typed as the detail screen
/// reads it, or none when nothing is stored.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkActivityRecord {
    pub record: Option<crate::FfiActivityRecord>,
}

/// What `activity.intervals` answers: the laps, or none when the body was
/// never fetched or will not parse.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkActivityIntervals {
    pub intervals: Option<crate::persistence::intervals::FfiActivityIntervals>,
}

/// What `activity.sections` answers: the visible custom sections that name
/// the activity.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkActivitySections {
    pub sections: Vec<crate::FfiSection>,
}

/// What `route.detail` and `route.attempts` are asked about, and what
/// `route.attempts` narrows by: the route, the activity being viewed and a sport.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRouteAttemptsAsk {
    pub id: String,
    #[serde(default)]
    pub current_activity_id: Option<String>,
    #[serde(default)]
    pub sport_type_filter: Option<String>,
}

/// What `route.performance` and `section.performance` are asked: the route or
/// section, how many days back the range reaches, the sport and the activity
/// to mark.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPerformanceAsk {
    pub id: String,
    pub time_range_days: u32,
    #[serde(default)]
    pub sport_filter: Option<String>,
    #[serde(default)]
    pub highlight_activity_id: Option<String>,
}

/// What `section.excluded` answers: the activities whose every traversal of
/// the section is excluded.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionExcluded {
    pub activity_ids: Vec<String>,
}

/// What `section.history` answers: the change ledger, oldest first, the
/// stored geometry versions with the pinned one flagged, and the names of the
/// activities the ledger's chips draw, so the page asks once.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionHistory {
    pub history: Vec<crate::FfiSectionHistoryEvent>,
    pub geometry_versions: Vec<crate::FfiSectionGeometryVersion>,
    pub pinned_version: Option<f64>,
    pub names: Vec<crate::FfiActivityName>,
}

/// How many activities of one ledger row get a name. The history panel draws
/// this many chips per row, so the names it is never going to draw are not read.
const LEDGER_CHIPS_PER_ROW: usize = 3;

/// What `section.rename` is asked: the section and its new name, where an
/// empty name clears it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionRenameAsk {
    pub id: String,
    pub name: String,
}

/// What a method that edits one section is asked.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionAsk {
    pub id: String,
}

/// What `section.setLift` is asked: the section and whether it is a lift.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionLiftAsk {
    pub id: String,
    pub is_lift: bool,
}

/// What the exclude and include methods are asked: the section or route and
/// the activity.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkExcludeAsk {
    pub id: String,
    pub activity_id: String,
}

/// What `section.excludeLap` and `section.includeLap` are asked: the
/// traversal, addressed by the activity and its start index.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkLapAsk {
    pub id: String,
    pub activity_id: String,
    pub start_index: u32,
}

/// What `route.rename` is asked: the route and its new name, where an empty
/// name clears it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRouteRenameAsk {
    pub id: String,
    pub name: String,
}

/// What `heatmap.setHidden` is asked: the activity and whether the heatmap
/// leaves it out.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHeatmapHiddenAsk {
    pub activity_id: String,
    pub hidden: bool,
}

/// What `detection.setEnabled` is asked: whether route matching is on.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkDetectionEnabledAsk {
    pub enabled: bool,
}

/// The two numbers route grouping is matched by, as the phone's grouping
/// preview sets them: how much of a route has to match, in percent, and how
/// far apart the two ends may be, in metres.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkStrictness {
    pub min_match_pct: f64,
    pub endpoint_threshold: f64,
}

/// What `detection.settings` answers: the switch, the match strictness and the
/// section config, each as the engine reads it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkDetectionSettings {
    pub enabled: bool,
    pub strictness: FfiLinkStrictness,
    pub section_config: crate::FfiSectionConfig,
}

/// What `strength.screen` is asked: the phone's wall clock in seconds and the span
/// of days the period reads, as the strength tab picks it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkStrengthAsk {
    pub now_wall_seconds: f64,
    pub period_days: u32,
}

/// What `strength.exercise` is asked: the exercise category.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkExerciseAsk {
    pub exercise_category: u16,
}

/// What `strength.muscle` is asked: one activity and the muscle the diagram
/// was tapped on.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkMuscleAsk {
    pub activity_id: String,
    pub muscle_slug: String,
}

/// What `recordings.list` is asked: nothing, the library is the signed-in
/// athlete's.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRecordingsAsk {}

/// What `recordings.get` is asked: the recording's id.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRecordingAsk {
    pub id: String,
}

/// What `recordings.list` answers: the rows the signed-in athlete may see, newest first.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRecordingsAnswer {
    pub recordings: Vec<crate::persistence::recordings::FfiRecordingEntry>,
}

/// What `recordings.get` answers: the row, or `None` when it is absent or held by
/// another athlete, as the phone's own read answers `null`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkRecordingAnswer {
    pub recording: Option<crate::persistence::recordings::FfiRecordingEntry>,
}

/// The trailing weeks the strength tab draws, which the page asks for.
pub const STRENGTH_WEEKS: u32 = 4;

/// What a write answers once it is made.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkWriteDone {
    pub ok: bool,
}

/// What `fitness.screen` is asked: the spans the decoupling ride and the
/// strip's activities are read for, and the windows the calendar, the weekly
/// card and the year comparison are read over.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkFitnessScreenAsk {
    #[serde(default)]
    pub span_days: Vec<u32>,
    pub windows: crate::FfiFitnessScreenWindows,
}

/// What `fitness.wellness` is asked: an inclusive window of `YYYY-MM-DD` days.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkWellnessAsk {
    pub oldest: String,
    pub newest: String,
}

/// What `insights.plannedEvents` is asked: an inclusive window of wall-clock
/// seconds, as the phone's calendar read takes it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPlannedEventsAsk {
    pub oldest_ts: f64,
    pub newest_ts: f64,
}

/// What `insights.plannedEvents` answers: the calendar events in the window,
/// oldest first.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPlannedEvents {
    pub events: Vec<crate::persistence::calendar::FfiPlannedEvent>,
}

/// What `insights.workoutSections` is asked: the sport and how many sections
/// the list holds at most.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkWorkoutSectionsAsk {
    pub sport_type: String,
    pub limit: u32,
}

/// What `insights.workoutSections` answers: the ranked sections for the sport.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkWorkoutSections {
    pub sections: Vec<crate::FfiWorkoutSection>,
}

/// What `fitness.loads` is asked: an inclusive window of wall-clock seconds.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkLoadsAsk {
    pub start_ts: f64,
    pub end_ts: f64,
}

/// What `fitness.loads` answers: a load for each day with activities.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkDayLoads {
    pub days: Vec<crate::FfiDayLoad>,
}

/// What `fitness.zones` is asked: a sport, a zone kind (`power` or `hr`) and an
/// inclusive window of wall-clock seconds.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkZonesAsk {
    pub sport_type: String,
    pub zone_type: String,
    pub start_ts: f64,
    pub end_ts: f64,
}

/// What `fitness.powerCurve` is asked: a sport and a window in days, where 0
/// is all time.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPowerCurveAsk {
    pub sport: String,
    pub days: f64,
}

/// What `fitness.paceCurve` is asked: a sport, a window in days and whether the
/// pace is grade adjusted.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPaceCurveAsk {
    pub sport: String,
    pub days: f64,
    #[serde(default)]
    pub gap: bool,
}

/// What `fitness.powerCurve` answers: the stored curve, or none when it was
/// never fetched.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPowerCurve {
    pub curve: Option<crate::persistence::curves::FfiPowerCurve>,
}

/// What `fitness.paceCurve` answers: the stored curve, or none when it was
/// never fetched.
#[derive(Debug, Clone, Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkPaceCurve {
    pub curve: Option<crate::persistence::curves::FfiPaceCurve>,
}

/// What `fitness.bestEfforts` is asked: a window in days, where 0 is all time.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkBestEffortsAsk {
    pub days: f64,
}

/// How a method is answered: a read from a pooled connection, or a write
/// under the engine lock.
enum Run {
    Read(fn(&Connection, Value) -> Result<Value, String>),
    ReadAs(fn(&Connection, &Caller, Value) -> Result<Value, String>),
    Write(fn(&mut crate::persistence::PersistentEngine, Value) -> Result<Written, String>),
}

/// What a write did, for the answer, the log and the announcement.
struct Written {
    result: Value,
    /// The fact that moved, the name of the channel a screen re-reads.
    moved: &'static str,
    target_id: String,
    /// The write in words, naming its target and its new value.
    summary: String,
    /// Whether the write owes the elevation backfill a start, as the phone's
    /// switch gives it when route matching turns on.
    starts_backfill: bool,
}

/// The answer to a write, and the announcement it owes. The announcement is
/// made by [`Answered::announce`] once the caller has released the engine
/// lock, since the screens it wakes read through that lock.
pub struct Answered {
    reply: String,
    moved: Option<&'static str>,
    starts_backfill: bool,
}

impl Answered {
    /// Announce what moved, if the write succeeded, and return the reply.
    pub fn announce(self) -> String {
        if let Some(kind) = self.moved {
            crate::objects::observer::notify(crate::objects::observer::Announcement::RemoteWrote(
                kind.to_owned(),
            ));
        }
        if self.starts_backfill {
            crate::net::elevation_backfill::start_elevation_backfill();
        }
        self.reply
    }

    /// Whether [`Answered::announce`] starts the elevation backfill.
    pub fn starts_backfill(&self) -> bool {
        self.starts_backfill
    }
}

/// One method of the protocol: its name, the records its ask and its answer
/// are, and the read or write that answers it.
pub struct Method {
    pub name: &'static str,
    /// The `uniffi::Record` the params deserialise into.
    pub params: &'static str,
    /// The `uniffi::Record` the result serialises from.
    pub result: &'static str,
    run: Run,
}

impl Method {
    /// Whether the write channel, not the read channel, answers this method.
    pub fn is_write(&self) -> bool {
        matches!(self.run, Run::Write(_))
    }
}

/// Every method a linked browser may ask. `answer` and `answer_write`
/// dispatch through it, the `link.hello` answer lists it and
/// `web/connect/methods.json` is rendered from it, so a method is a row here
/// and an arm nowhere else. The pairing methods are not rows: they are
/// answered before a browser is linked. Adding a write is a change to the
/// test that pins the writes.
pub const METHODS: &[Method] = &[
    Method {
        name: "link.hello",
        params: "FfiLinkHello",
        result: "FfiLinkHelloAnswer",
        run: Run::Read(hello),
    },
    Method {
        name: "feed.page",
        params: "FfiLinkFeedPageAsk",
        result: "FfiLinkFeedPage",
        run: Run::Read(feed_page),
    },
    Method {
        name: "feed.summary",
        params: "FfiLinkSummaryAsk",
        result: "FfiSummaryCardData",
        run: Run::Read(feed_summary),
    },
    Method {
        name: "feed.sparklines",
        params: "FfiLinkSparklinesAsk",
        result: "FfiWellnessSparklines",
        run: Run::Read(feed_sparklines),
    },
    Method {
        name: "feed.highlights",
        params: "FfiLinkHighlightsAsk",
        result: "FfiActivityHighlightsBundle",
        run: Run::Read(feed_highlights),
    },
    Method {
        name: "activity.summary",
        params: "FfiLinkActivityAsk",
        result: "FfiActivitySummary",
        run: Run::Read(activity_summary),
    },
    Method {
        name: "activity.detail",
        params: "FfiLinkActivityAsk",
        result: "FfiActivityDetailData",
        run: Run::Read(activity_detail),
    },
    Method {
        name: "activity.record",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkActivityRecord",
        run: Run::Read(activity_record),
    },
    Method {
        name: "activity.streams",
        params: "FfiLinkStreamsAsk",
        result: "FfiActivityStreams",
        run: Run::Read(activity_streams),
    },
    Method {
        name: "activity.intervals",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkActivityIntervals",
        run: Run::Read(activity_intervals),
    },
    Method {
        name: "activity.sections",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkActivitySections",
        run: Run::Read(activity_sections),
    },
    Method {
        name: "activity.exerciseSets",
        params: "FfiLinkActivityAsk",
        result: "FfiExerciseSession",
        run: Run::Read(activity_exercise_sets),
    },
    Method {
        name: "insights.data",
        params: "FfiInsightsParams",
        result: "FfiInsightsData",
        run: Run::Read(insights_data),
    },
    Method {
        name: "insights.plannedEvents",
        params: "FfiLinkPlannedEventsAsk",
        result: "FfiLinkPlannedEvents",
        run: Run::Read(insights_planned_events),
    },
    Method {
        name: "insights.workoutSections",
        params: "FfiLinkWorkoutSectionsAsk",
        result: "FfiLinkWorkoutSections",
        run: Run::Read(insights_workout_sections),
    },
    Method {
        name: "routes.screen",
        params: "FfiRoutesScreenQuery",
        result: "FfiRoutesScreenData",
        run: Run::Read(routes_screen),
    },
    Method {
        name: "route.detail",
        params: "FfiLinkActivityAsk",
        result: "FfiRouteDetailData",
        run: Run::Read(route_detail),
    },
    Method {
        name: "route.performance",
        params: "FfiLinkPerformanceAsk",
        result: "FfiSectionPerformanceData",
        run: Run::Read(route_performance),
    },
    Method {
        name: "route.attempts",
        params: "FfiLinkRouteAttemptsAsk",
        result: "FfiRoutePerformanceResult",
        run: Run::Read(route_attempts),
    },
    Method {
        name: "section.detail",
        params: "FfiLinkActivityAsk",
        result: "FfiSectionDetailData",
        run: Run::Read(section_detail),
    },
    Method {
        name: "section.performance",
        params: "FfiLinkPerformanceAsk",
        result: "FfiSectionPerformanceData",
        run: Run::Read(section_performance),
    },
    Method {
        name: "section.history",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkSectionHistory",
        run: Run::Read(section_history),
    },
    Method {
        name: "section.excluded",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkSectionExcluded",
        run: Run::Read(section_excluded),
    },
    Method {
        name: "sections.retired",
        params: "FfiLinkNoAsk",
        result: "FfiRetiredMapData",
        run: Run::Read(sections_retired),
    },
    Method {
        name: "fitness.screen",
        params: "FfiLinkFitnessScreenAsk",
        result: "FfiFitnessScreenData",
        run: Run::Read(fitness_screen),
    },
    Method {
        name: "fitness.wellness",
        params: "FfiLinkWellnessAsk",
        result: "FfiWellnessDays",
        run: Run::Read(fitness_wellness),
    },
    Method {
        name: "fitness.loads",
        params: "FfiLinkLoadsAsk",
        result: "FfiLinkDayLoads",
        run: Run::Read(fitness_loads),
    },
    Method {
        name: "fitness.zones",
        params: "FfiLinkZonesAsk",
        result: "FfiZoneDistribution",
        run: Run::Read(fitness_zones),
    },
    Method {
        name: "fitness.powerCurve",
        params: "FfiLinkPowerCurveAsk",
        result: "FfiLinkPowerCurve",
        run: Run::Read(fitness_power_curve),
    },
    Method {
        name: "fitness.paceCurve",
        params: "FfiLinkPaceCurveAsk",
        result: "FfiLinkPaceCurve",
        run: Run::Read(fitness_pace_curve),
    },
    Method {
        name: "fitness.bestEfforts",
        params: "FfiLinkBestEffortsAsk",
        result: "FfiBestEffortsData",
        run: Run::Read(fitness_best_efforts),
    },
    Method {
        name: "strength.screen",
        params: "FfiLinkStrengthAsk",
        result: "FfiStrengthScreenData",
        run: Run::Read(strength_screen),
    },
    Method {
        name: "strength.exercise",
        params: "FfiLinkExerciseAsk",
        result: "FfiExerciseDetailData",
        run: Run::Read(strength_exercise),
    },
    Method {
        name: "strength.muscle",
        params: "FfiLinkMuscleAsk",
        result: "FfiMuscleGroupDetail",
        run: Run::Read(strength_muscle),
    },
    Method {
        name: "recordings.list",
        params: "FfiLinkRecordingsAsk",
        result: "FfiLinkRecordingsAnswer",
        run: Run::ReadAs(recordings_list),
    },
    Method {
        name: "recordings.get",
        params: "FfiLinkRecordingAsk",
        result: "FfiLinkRecordingAnswer",
        run: Run::ReadAs(recordings_get),
    },
    Method {
        name: "map.screen",
        params: "FfiLinkMapAsk",
        result: "FfiLinkMapScreen",
        run: Run::Read(map_screen),
    },
    Method {
        name: "geo.routeLines",
        params: "FfiLinkNoAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_route_lines),
    },
    Method {
        name: "geo.track",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_track),
    },
    Method {
        name: "geo.activityOverlay",
        params: "FfiLinkActivityAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_activity_overlay),
    },
    Method {
        name: "geo.sections",
        params: "FfiLinkNoAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_sections),
    },
    Method {
        name: "geo.route",
        params: "FfiLinkGeoGroupAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_route),
    },
    Method {
        name: "geo.routeLatest",
        params: "FfiLinkGeoGroupAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_route_latest),
    },
    Method {
        name: "geo.section",
        params: "FfiLinkGeoSectionAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_section),
    },
    Method {
        name: "geo.sectionPasses",
        params: "FfiLinkGeoSectionAsk",
        result: "FfiLinkGeoText",
        run: Run::Read(geo_section_passes),
    },
    Method {
        name: "heatmap.tile",
        params: "FfiLinkHeatmapTileAsk",
        result: "FfiLinkHeatmapTile",
        run: Run::Read(heatmap_tile),
    },
    Method {
        name: "heatmap.progress",
        params: "FfiLinkNoAsk",
        result: "FfiLinkHeatmapProgress",
        run: Run::Read(heatmap_progress),
    },
    Method {
        name: "settings.get",
        params: "FfiLinkSettingsAsk",
        result: "FfiLinkSettingsAnswer",
        run: Run::Read(settings_get),
    },
    Method {
        name: "settings.profile",
        params: "FfiLinkNoAsk",
        result: "AthleteProfile",
        run: Run::Read(settings_profile),
    },
    Method {
        name: "status.backgroundJobs",
        params: "FfiLinkNoAsk",
        result: "FfiBackgroundJobsData",
        run: Run::Read(status_background_jobs),
    },
    Method {
        name: "status.cache",
        params: "FfiLinkNoAsk",
        result: "FfiCacheScreenData",
        run: Run::Read(status_cache),
    },
    Method {
        name: "status.backup",
        params: "FfiLinkNoAsk",
        result: "FfiBackupScreenData",
        run: Run::Read(status_backup),
    },
    Method {
        name: "status.linkedDevices",
        params: "FfiLinkNoAsk",
        result: "FfiLinkDevicesAnswer",
        run: Run::ReadAs(status_linked_devices),
    },
    Method {
        name: "status.coverage",
        params: "FfiLinkNoAsk",
        result: "LibraryCoverage",
        run: Run::Read(status_coverage),
    },
    Method {
        name: "status.sync",
        params: "FfiLinkNoAsk",
        result: "FfiSyncStatus",
        run: Run::Read(status_sync),
    },
    Method {
        name: "section.rename",
        params: "FfiLinkSectionRenameAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_rename),
    },
    Method {
        name: "section.setLift",
        params: "FfiLinkSectionLiftAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_set_lift),
    },
    Method {
        name: "section.accept",
        params: "FfiLinkSectionAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_accept),
    },
    Method {
        name: "section.acceptAll",
        params: "FfiLinkNoAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_accept_all),
    },
    Method {
        name: "section.enable",
        params: "FfiLinkSectionAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_enable),
    },
    Method {
        name: "section.disable",
        params: "FfiLinkSectionAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_disable),
    },
    Method {
        name: "section.excludeActivity",
        params: "FfiLinkExcludeAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_exclude_activity),
    },
    Method {
        name: "section.includeActivity",
        params: "FfiLinkExcludeAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_include_activity),
    },
    Method {
        name: "section.excludeLap",
        params: "FfiLinkLapAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_exclude_lap),
    },
    Method {
        name: "section.includeLap",
        params: "FfiLinkLapAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_include_lap),
    },
    Method {
        name: "route.rename",
        params: "FfiLinkRouteRenameAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(route_rename),
    },
    Method {
        name: "route.excludeActivity",
        params: "FfiLinkExcludeAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(route_exclude_activity),
    },
    Method {
        name: "route.includeActivity",
        params: "FfiLinkExcludeAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(route_include_activity),
    },
    Method {
        name: "heatmap.setHidden",
        params: "FfiLinkHeatmapHiddenAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(heatmap_set_hidden),
    },
    Method {
        name: "detection.settings",
        params: "FfiLinkNoAsk",
        result: "FfiLinkDetectionSettings",
        run: Run::Read(detection_settings),
    },
    Method {
        name: "detection.setEnabled",
        params: "FfiLinkDetectionEnabledAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(detection_set_enabled),
    },
    Method {
        name: "detection.setStrictness",
        params: "FfiLinkStrictness",
        result: "FfiLinkWriteDone",
        run: Run::Write(detection_set_strictness),
    },
    Method {
        name: "detection.setSectionConfig",
        params: "FfiSectionConfig",
        result: "FfiLinkWriteDone",
        run: Run::Write(detection_set_section_config),
    },
];

fn method(name: &str) -> Option<&'static Method> {
    METHODS.iter().find(|method| method.name == name)
}

/// Whether the write channel, not the read channel, answers this method.
pub fn is_write(name: &str) -> bool {
    method(name).is_some_and(Method::is_write)
}

/// The text of `web/connect/methods.json`: the newest and oldest version and
/// the table.
pub fn methods_json() -> String {
    let methods: Vec<Value> = METHODS
        .iter()
        .map(|method| {
            json!({
                "name": method.name,
                "params": method.params,
                "result": method.result,
                "write": method.is_write(),
            })
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "protocol": PROTOCOL_VERSION,
        "minProtocol": MIN_PROTOCOL_VERSION,
        "methods": methods,
    }))
    .expect("a table of strings serialises");
    text.push('\n');
    text
}

/// The raw size limit of one message on the data channel, header included.
/// Chrome refuses a message above 256 KiB whatever the peer advertises, and
/// str0m assumes 64 KiB when an offer advertises none, so 16 KiB is under
/// every limit and no peer's advertised size matters. `web/connect/link.ts`
/// holds the same number as `FRAME_BYTES`.
pub const FRAME_BYTES: usize = 16 * 1024;

/// The header every reply frame starts with, all numbers big-endian: a `u8`
/// version ([`FRAME_VERSION`]), a `u8` of flags ([`FRAME_GZIP`],
/// [`FRAME_LAST`]), the `u32` id of the request answered and the `u32` of this
/// frame's place in the reply, from 0. The id is what tells the page one
/// reply's frames from another's when several are in flight.
pub const FRAME_HEADER_BYTES: usize = 10;

/// The frame layout this build writes.
pub const FRAME_VERSION: u8 = 1;

/// Flag: the reply bytes, joined, are a gzip stream of the reply text.
pub const FRAME_GZIP: u8 = 1;

/// Flag: this is the last frame of its reply.
pub const FRAME_LAST: u8 = 2;

/// A reply text longer than this is gzipped before it is cut.
pub const GZIP_OVER: usize = 4 * 1024;

/// The gzip level a reply is compressed at.
const GZIP_LEVEL: u32 = 6;

/// A reply as the binary frames that carry it. Requests stay JSON text; every
/// reply is one or more frames of at most [`FRAME_BYTES`], a [`FRAME_HEADER_BYTES`]
/// header and then a slice of the reply, which is gzipped first when its text
/// is over [`GZIP_OVER`]. The request id comes from the reply's own `id`; a
/// reply with none (a request that did not parse) goes under id 0, which the
/// page never asks with.
pub fn frames(reply: &str) -> Vec<Vec<u8>> {
    #[derive(Deserialize)]
    struct Id {
        id: Option<u64>,
    }
    let id = serde_json::from_str::<Id>(reply)
        .ok()
        .and_then(|reply| reply.id)
        .and_then(|id| u32::try_from(id).ok())
        .unwrap_or(0);

    let (flags, body) = if reply.len() > GZIP_OVER {
        let mut gzip = flate2::write::GzEncoder::new(
            Vec::with_capacity(reply.len() / 4),
            flate2::Compression::new(GZIP_LEVEL),
        );
        let packed =
            std::io::Write::write_all(&mut gzip, reply.as_bytes()).and_then(|()| gzip.finish());
        match packed {
            Ok(packed) => (FRAME_GZIP, packed),
            Err(_) => (0, reply.as_bytes().to_vec()),
        }
    } else {
        (0, reply.as_bytes().to_vec())
    };

    let mut chunks: Vec<&[u8]> = body.chunks(FRAME_BYTES - FRAME_HEADER_BYTES).collect();
    if chunks.is_empty() {
        chunks.push(&[]);
    }
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(seq, chunk)| {
            let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + chunk.len());
            frame.push(FRAME_VERSION);
            frame.push(flags | if seq == last { FRAME_LAST } else { 0 });
            frame.extend_from_slice(&id.to_be_bytes());
            frame.extend_from_slice(&(seq as u32).to_be_bytes());
            frame.extend_from_slice(chunk);
            frame
        })
        .collect()
}

/// One message to write to the data channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub binary: bool,
    pub bytes: Vec<u8>,
}

/// The request id a message carries: a frame's header names it, and a text
/// reply is the reply itself.
pub fn reply_id(message: &Message) -> Option<u32> {
    if message.binary {
        let bytes = message.bytes.get(2..6)?;
        return Some(u32::from_be_bytes(bytes.try_into().ok()?));
    }
    #[derive(Deserialize)]
    struct Replied {
        id: Option<u64>,
    }
    serde_json::from_slice::<Replied>(&message.bytes)
        .ok()?
        .id
        .and_then(|id| u32::try_from(id).ok())
}

/// A reply as the messages that carry it in the format of protocol `wire`: the
/// frames of [`frames`] from [`FRAMED_FROM`], and before that the reply text as
/// one text message.
pub fn messages(reply: &str, wire: u32) -> Vec<Message> {
    if wire >= FRAMED_FROM {
        return frames(reply)
            .into_iter()
            .map(|bytes| Message {
                binary: true,
                bytes,
            })
            .collect();
    }
    vec![Message {
        binary: false,
        bytes: reply.as_bytes().to_vec(),
    }]
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

fn params<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(params).map_err(|error| format!("bad params: {error}"))
}

fn to_result<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

/// The name the phone gives itself in its hello.
static DEVICE_NAME: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// Set the name the hello answer carries. An empty or blank name clears it.
pub fn set_device_name(name: &str) {
    let mut held = DEVICE_NAME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    name.trim().clone_into(&mut held);
}

fn hello(_conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkHello = params(ask)?;
    let oldest = ask.min_protocol.unwrap_or(ask.protocol);
    let name = DEVICE_NAME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    to_result(&hello_answer(
        &name,
        negotiate(oldest, ask.protocol).unwrap_or(PROTOCOL_VERSION),
    ))
}

/// The hello answer for a phone called `name` speaking `protocol`, which
/// carries no name when it is blank.
fn hello_answer(name: &str, protocol: u32) -> FfiLinkHelloAnswer {
    let name = name.trim();
    FfiLinkHelloAnswer {
        protocol,
        min_protocol: MIN_PROTOCOL_VERSION,
        max_protocol: PROTOCOL_VERSION,
        app: env!("CARGO_PKG_VERSION").to_owned(),
        methods: METHODS
            .iter()
            .map(|method| method.name.to_owned())
            .collect(),
        device: (!name.is_empty()).then(|| name.to_owned()),
    }
}

/// The deepest zoom a heatmap tile is drawn at, and the shallowest.
const HEATMAP_ZOOMS: std::ops::RangeInclusive<u32> = 1..=17;

/// The phone's map read with its line layers left out. The layers are
/// fetched by URL as GeoJSON written in Rust, so no polyline crosses the link.
fn map_screen(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkMapAsk = params(ask)?;
    let screen = crate::persistence::screens::pooled::map_screen_data(
        conn,
        crate::ffi_types::int_from_wire(ask.start_date),
        crate::ffi_types::int_from_wire(ask.end_date),
        ask.sport_types,
        ask.distance_band,
        ask.is_metric,
        crate::persistence::screens::pooled::MapLayers::default(),
        ask.name_needle,
    );
    let route_generation = crate::persistence::route_lines::pooled::counted_generation(conn)
        .ok()
        .flatten()
        .map(|(generation, _)| generation as f64);
    let section_stamp = crate::persistence::read_cache::stamp(conn).map(|stamp| stamp as f64);
    to_result(&FfiLinkMapScreen {
        screen,
        route_generation,
        section_stamp,
    })
}

fn geo_route_lines(conn: &Connection, ask: Value) -> Result<Value, String> {
    let _: FfiLinkNoAsk = params(ask)?;
    let text = crate::basemap::route_lines_collection(conn).map_err(|error| error.to_string())?;
    to_result(&FfiLinkGeoText { text })
}

/// One activity's stored line as the phone's `veloq-geo` track URL answers it.
fn geo_track(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::track_collection(conn, &ask.id),
    })
}

/// One activity's matched sections, its portions of them and its record
/// holdings, from the detail read's own fields.
fn geo_activity_overlay(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let detail = crate::persistence::screens::pooled::activity_detail_data(
        conn,
        &ask.id,
        MIN_ROUTE_ACTIVITIES,
    );
    let sections: Vec<_> = detail
        .matched_sections
        .iter()
        .map(|s| crate::basemap::OverlaySection {
            id: &s.id,
            name: s.name.as_deref(),
            polyline: &s.encoded_polyline,
        })
        .collect();
    let traces: Vec<(&str, &[u8])> = detail
        .section_traces
        .iter()
        .map(|t| (t.section_id.as_str(), t.encoded_coords.as_slice()))
        .collect();
    let encounters: Vec<_> = detail
        .encounters
        .iter()
        .map(|e| crate::basemap::OverlayEncounter {
            section_id: &e.section_id,
            direction: &e.direction,
            is_pr: e.is_pr,
        })
        .collect();
    let pr_ids: Vec<&str> = detail.pr_section_ids.iter().map(String::as_str).collect();
    to_result(&FfiLinkGeoText {
        text: crate::basemap::activity_overlay_features(&sections, &traces, &encounters, &pr_ids),
    })
}

fn geo_sections(conn: &Connection, ask: Value) -> Result<Value, String> {
    let _: FfiLinkNoAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::sections_collection(conn),
    })
}

fn geo_route(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkGeoGroupAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::route_feature(conn, &ask.group_id),
    })
}

fn geo_route_latest(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkGeoGroupAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::route_latest_feature(conn, &ask.group_id),
    })
}

fn geo_section(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkGeoSectionAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::section_feature(conn, &ask.section_id),
    })
}

fn geo_section_passes(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkGeoSectionAsk = params(ask)?;
    to_result(&FfiLinkGeoText {
        text: crate::basemap::section_passes_collection(conn, &ask.section_id),
    })
}

/// The tile the heatmap serves over a base, as the phone's own tile source
/// answers it, so a tile the pass drew is the same bytes on both.
fn heatmap_tile(_conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkHeatmapTileAsk = params(ask)?;
    let base = crate::tiles::HeatmapBase::from_name(&ask.base)
        .ok_or_else(|| format!("no heatmap base {}", ask.base))?;
    if !HEATMAP_ZOOMS.contains(&ask.z) {
        return Err(format!("zoom {} is outside the heatmap's range", ask.z));
    }
    let z = ask.z as u8;
    let span = 1u32 << z;
    if ask.x >= span || ask.y >= span {
        return Err(format!("tile {z}/{}/{} is off the world", ask.x, ask.y));
    }
    to_result(&FfiLinkHeatmapTile {
        png: crate::basemap::heatmap_tile(base, z, ask.x, ask.y),
    })
}

fn heatmap_progress(_conn: &Connection, ask: Value) -> Result<Value, String> {
    let _: FfiLinkNoAsk = params(ask)?;
    let (processed, total) = crate::objects::tiles::tile_generation_progress();
    to_result(&FfiLinkHeatmapProgress { processed, total })
}

fn feed_page(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkFeedPageAsk = params(ask)?;
    let query = crate::FfiActivityBodiesQuery {
        oldest_ts: ask.oldest_ts,
        newest_ts: ask.newest_ts,
        needle: ask.needle,
        sport_families: ask.sport_families,
        offset: ask.offset,
        limit: Some(ask.limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)),
    };
    let page = crate::persistence::activities::pooled::feed_card_page(conn, &query)
        .map_err(|error| error.to_string())?;
    let previews = page
        .cards
        .iter()
        .filter(|card| card.has_gps)
        .filter_map(|card| crate::persistence::screens::pooled::preview_track(conn, &card.id))
        .collect();
    to_result(&FfiLinkFeedPage {
        cards: page.cards,
        matched_count: page.matched_count,
        has_more: page.has_more,
        previews,
    })
}

fn feed_summary(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkSummaryAsk = params(ask)?;
    let (current_start, current_end, prev_start, prev_end) =
        crate::widget_snapshot::week_bounds(crate::ffi_types::int_from_wire(ask.now_wall_seconds));
    to_result(&crate::persistence::screens::pooled::summary_card(
        conn,
        current_start,
        current_end,
        prev_start,
        prev_end,
    ))
}

/// The series answer is `null` when the athlete has no wellness rows, as the
/// phone's read is `None`.
fn feed_sparklines(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkSparklinesAsk = params(ask)?;
    let lines = crate::persistence::wellness::pooled::sparklines_to(
        conn,
        ask.days,
        &crate::persistence::wellness::today_iso(),
    )
    .map_err(|error| error.to_string())?;
    to_result(&lines)
}

fn feed_highlights(conn: &Connection, ask: Value) -> Result<Value, String> {
    let mut ask: FfiLinkHighlightsAsk = params(ask)?;
    ask.ids.truncate(MAX_PAGE as usize);
    to_result(&crate::objects::activities::highlights_bundle(
        conn, &ask.ids,
    ))
}

fn activity_summary(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let detail = crate::persistence::screens::pooled::activity_detail_data(
        conn,
        &ask.id,
        MIN_ROUTE_ACTIVITIES,
    );
    to_result(&detail.summary)
}

fn activity_detail(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    to_result(&crate::persistence::screens::pooled::activity_detail_data(
        conn,
        &ask.id,
        MIN_ROUTE_ACTIVITIES,
    ))
}

fn activity_record(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let record = crate::persistence::activities::pooled::activity_record(conn, &ask.id)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkActivityRecord { record })
}

/// The series the chart draws. An activity with none answers every series
/// empty, as the phone's read answers `None` and draws no chart. The cached
/// body's touch is a write, so the link leaves it to the phone.
fn activity_streams(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkStreamsAsk = params(ask)?;
    let mut types = ask.types;
    types.sort();
    let (streams, _) =
        crate::objects::activities::chart_streams_read(conn, &ask.id, &types.join(","))
            .map_err(|error| error.to_string())?;
    to_result(&streams.unwrap_or_default())
}

fn activity_intervals(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let intervals = crate::persistence::intervals::activity_intervals(conn, &ask.id)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkActivityIntervals { intervals })
}

fn activity_sections(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let names = crate::persistence::sections::named::pooled::overlay_names(conn);
    let sections = crate::persistence::sections::queries::pooled::custom_sections_naming_activity(
        conn, &ask.id, &names,
    )
    .into_iter()
    .map(crate::FfiSection::from)
    .collect();
    to_result(&FfiLinkActivitySections { sections })
}

/// The routes and sections lists, paged as the phone pages them. A page is cut
/// to [`MAX_PAGE`] rows of each list.
fn routes_screen(conn: &Connection, ask: Value) -> Result<Value, String> {
    let mut query: crate::FfiRoutesScreenQuery = params(ask)?;
    query.group_limit = query.group_limit.min(MAX_PAGE);
    query.section_limit = query.section_limit.min(MAX_PAGE);
    to_result(&crate::persistence::pooled_routes_screen_data(conn, query))
}

fn known_route(conn: &Connection, id: &str) -> Result<(), String> {
    crate::persistence::routes::pooled::group_by_id(conn, id)
        .map(|_| ())
        .ok_or_else(|| format!("unknown route: {id}"))
}

fn known_section(conn: &Connection, id: &str) -> Result<(), String> {
    crate::persistence::sections::queries::pooled::section_raw(conn, id)
        .map(|_| ())
        .ok_or_else(|| format!("unknown section: {id}"))
}

fn route_detail(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    known_route(conn, &ask.id)?;
    to_result(&crate::persistence::screens::pooled::route_detail_data(
        conn, &ask.id,
    ))
}

/// The route's attempts with the delta curves computed. The ask runs on a
/// worker thread like every other, so a slow one holds no other ask back.
fn route_performance(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkPerformanceAsk = params(ask)?;
    known_route(conn, &ask.id)?;
    to_result(
        &crate::persistence::screens::pooled::route_detail_performance(
            conn,
            &ask.id,
            ask.time_range_days,
            ask.sport_filter.as_deref(),
            ask.highlight_activity_id.as_deref(),
            crate::persistence::sections::lap_curves::pooled::CurveRead::Computed,
        ),
    )
}

fn route_attempts(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkRouteAttemptsAsk = params(ask)?;
    known_route(conn, &ask.id)?;
    to_result(&crate::FfiRoutePerformanceResult::from(
        crate::persistence::fitness::performances::route_performances_of(
            conn,
            &ask.id,
            ask.current_activity_id.as_deref(),
            ask.sport_type_filter.as_deref(),
        ),
    ))
}

/// A section that left the catalogue still answers with how it left; an id
/// that was never a section is an error.
fn section_detail(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let detail = crate::persistence::screens::pooled::section_detail_data(conn, &ask.id);
    if detail.section.is_none() && detail.retirement.is_none() {
        return Err(format!("unknown section: {}", ask.id));
    }
    to_result(&detail)
}

/// The section's attempts with the delta curves computed, on a worker thread
/// like every other ask.
fn section_performance(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkPerformanceAsk = params(ask)?;
    known_section(conn, &ask.id)?;
    to_result(
        &crate::persistence::screens::pooled::section_detail_performance(
            conn,
            &ask.id,
            ask.time_range_days,
            ask.sport_filter.as_deref(),
            ask.highlight_activity_id.as_deref(),
            crate::persistence::sections::lap_curves::pooled::CurveRead::Computed,
        ),
    )
}

fn section_history(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let detail = crate::persistence::screens::pooled::section_detail_data(conn, &ask.id);
    if detail.section.is_none() && detail.retirement.is_none() {
        return Err(format!("unknown section: {}", ask.id));
    }
    let mut seen = std::collections::HashSet::new();
    let ids: Vec<String> = detail
        .history
        .iter()
        .filter_map(|event| event.details.as_ref())
        .flat_map(|details| details.around.iter().take(LEDGER_CHIPS_PER_ROW))
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect();
    let named = crate::persistence::strength::pooled::activity_names(conn, &ids)
        .map_err(|error| error.to_string())?;
    let names = ids
        .into_iter()
        .filter_map(|id| {
            let (name, date) = named.get(&id)?;
            Some(crate::FfiActivityName {
                name: name.clone(),
                date: *date as f64,
                activity_id: id,
            })
        })
        .collect();
    to_result(&FfiLinkSectionHistory {
        history: detail.history,
        geometry_versions: detail.geometry_versions,
        pinned_version: detail.pinned_version,
        names,
    })
}

fn section_excluded(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    known_section(conn, &ask.id)?;
    to_result(&FfiLinkSectionExcluded {
        activity_ids: crate::persistence::sections::queries::pooled::excluded_activity_ids(
            conn, &ask.id,
        ),
    })
}

fn sections_retired(conn: &Connection, _ask: Value) -> Result<Value, String> {
    to_result(&*crate::persistence::screens::pooled::retired_map_data(
        conn,
    ))
}

fn activity_exercise_sets(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let session = crate::objects::strength::exercise_session_from(conn, &ask.id)
        .map_err(|error| error.to_string())?;
    to_result(&session)
}

/// The insights bundle. The week windows are the engine's: whatever the ask
/// carries in them is replaced from its clock, as the phone's own read does.
fn insights_data(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: crate::FfiInsightsParams = params(ask)?;
    let ask = crate::objects::fitness::with_week_bounds(ask);
    to_result(&crate::persistence::screens::pooled::insights_data(
        conn, &ask,
    ))
}

fn insights_planned_events(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkPlannedEventsAsk = params(ask)?;
    let events = crate::persistence::calendar::pooled::planned_events(
        conn,
        crate::ffi_types::int_from_wire(ask.oldest_ts),
        crate::ffi_types::int_from_wire(ask.newest_ts),
    )
    .map_err(|error| error.to_string())?;
    to_result(&FfiLinkPlannedEvents { events })
}

fn insights_workout_sections(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkWorkoutSectionsAsk = params(ask)?;
    let sections =
        crate::objects::sections::workout_sections_read(conn, &ask.sport_type, ask.limit);
    to_result(&FfiLinkWorkoutSections { sections })
}

fn bad(reason: &str) -> String {
    format!("bad params: {reason}")
}

/// The whole-second window the phone's own reads take, refused when it ends
/// before it starts or is not a number.
fn seconds_window(start: f64, end: f64) -> Result<(i64, i64), String> {
    if !start.is_finite() || !end.is_finite() {
        return Err(bad("a window edge is not a number"));
    }
    if end < start {
        return Err(bad("the window ends before it starts"));
    }
    Ok((
        crate::ffi_types::int_from_wire(start),
        crate::ffi_types::int_from_wire(end),
    ))
}

/// A window in days, 0 for all time.
fn day_window(days: f64) -> Result<i64, String> {
    if !days.is_finite() || days < 0.0 {
        return Err(bad("days is negative or not a number"));
    }
    Ok(crate::ffi_types::int_from_wire(days))
}

fn iso_day(day: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|_| bad(&format!("{day:?} is not a YYYY-MM-DD day")))
}

fn fitness_screen(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkFitnessScreenAsk = params(ask)?;
    let screen = crate::persistence::screens::pooled::fitness_screen_data(
        conn,
        &crate::persistence::wellness::today_iso(),
        &ask.span_days,
        &ask.windows,
    )
    .map_err(|error| error.to_string())?;
    to_result(&screen)
}

fn fitness_wellness(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkWellnessAsk = params(ask)?;
    if iso_day(&ask.newest)? < iso_day(&ask.oldest)? {
        return Err(bad("the window ends before it starts"));
    }
    let days =
        crate::persistence::wellness::pooled::days_with_coverage(conn, &ask.oldest, &ask.newest)
            .map_err(|error| error.to_string())?;
    to_result(&days)
}

fn fitness_loads(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkLoadsAsk = params(ask)?;
    let (start, end) = seconds_window(ask.start_ts, ask.end_ts)?;
    let days =
        crate::persistence::fitness::derivations::pooled::daily_activity_loads(conn, start, end);
    to_result(&FfiLinkDayLoads { days })
}

fn fitness_zones(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkZonesAsk = params(ask)?;
    let (start, end) = seconds_window(ask.start_ts, ask.end_ts)?;
    let zones = crate::persistence::fitness::derivations::pooled::zone_distribution_named(
        conn,
        &ask.sport_type,
        &ask.zone_type,
        start,
        end,
    );
    to_result(&zones)
}

fn fitness_power_curve(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkPowerCurveAsk = params(ask)?;
    let days = day_window(ask.days)?;
    let (_, curve) = crate::persistence::curves::pooled::power_curve(conn, &ask.sport, days)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkPowerCurve { curve })
}

fn fitness_pace_curve(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkPaceCurveAsk = params(ask)?;
    let days = day_window(ask.days)?;
    let (_, curve) =
        crate::persistence::curves::pooled::pace_curve(conn, &ask.sport, days, ask.gap)
            .map_err(|error| error.to_string())?;
    to_result(&FfiLinkPaceCurve { curve })
}

fn fitness_best_efforts(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkBestEffortsAsk = params(ask)?;
    let days = day_window(ask.days)?;
    let data = crate::persistence::screens::pooled::best_efforts_data(
        conn,
        days,
        crate::widget_snapshot::Clock::now(),
    )
    .map_err(|error| error.to_string())?;
    to_result(&data)
}

fn strength_screen(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkStrengthAsk = params(ask)?;
    let (start, end, weeks) = crate::objects::strength::screen_windows(
        crate::ffi_types::int_from_wire(ask.now_wall_seconds),
        ask.period_days,
        STRENGTH_WEEKS,
    );
    let screen = crate::objects::strength::strength_screen_from(conn, start, end, weeks)
        .map_err(|error| error.to_string())?;
    to_result(&screen)
}

fn strength_exercise(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkExerciseAsk = params(ask)?;
    let detail = crate::persistence::screens::exercise_detail_data(conn, ask.exercise_category)
        .map_err(|error| error.to_string())?;
    to_result(&detail)
}

fn strength_muscle(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkMuscleAsk = params(ask)?;
    let detail =
        crate::objects::strength::muscle_detail_from(conn, &ask.activity_id, &ask.muscle_slug)
            .map_err(|error| error.to_string())?;
    to_result(&detail)
}

/// The library as the signed-in athlete sees it: their own rows and the
/// unstamped ones, never another athlete's held ride.
fn recordings_list(conn: &Connection, caller: &Caller, ask: Value) -> Result<Value, String> {
    let _: FfiLinkRecordingsAsk = params(ask)?;
    let recordings = crate::persistence::recordings::pooled::list_visible(conn, caller.athlete)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkRecordingsAnswer { recordings })
}

/// One recording the signed-in athlete may see. Another athlete's, or an id
/// with no row, answers `null`.
fn recordings_get(conn: &Connection, caller: &Caller, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkRecordingAsk = params(ask)?;
    let recording =
        crate::persistence::recordings::pooled::recording_visible(conn, &ask.id, caller.athlete)
            .map_err(|error| error.to_string())?;
    to_result(&FfiLinkRecordingAnswer { recording })
}

fn settings_get(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkSettingsAsk = params(ask)?;
    let mut answer = FfiLinkSettingsAnswer {
        values: Vec::new(),
        refused: Vec::new(),
    };
    for key in ask.keys {
        if !SETTING_KEYS.contains(&key.as_str()) {
            answer.refused.push(key);
            continue;
        }
        let value = crate::persistence::settings::setting_from(conn, &key)
            .map_err(|error| error.to_string())?;
        answer.values.push(FfiLinkSettingValue { key, value });
    }
    to_result(&answer)
}

fn settings_profile(conn: &Connection, _ask: Value) -> Result<Value, String> {
    to_result(&crate::persistence::settings::athlete_profile(conn))
}

fn status_background_jobs(conn: &Connection, _ask: Value) -> Result<Value, String> {
    let data = crate::persistence::screens::background_jobs_data(conn)
        .map_err(|error| error.to_string())?;
    to_result(&data)
}

fn status_cache(conn: &Connection, _ask: Value) -> Result<Value, String> {
    let data =
        crate::persistence::screens::cache_screen_data(conn).map_err(|error| error.to_string())?;
    to_result(&data)
}

fn status_backup(conn: &Connection, _ask: Value) -> Result<Value, String> {
    let data =
        crate::persistence::screens::backup_screen_data(conn).map_err(|error| error.to_string())?;
    to_result(&data)
}

fn status_linked_devices(conn: &Connection, caller: &Caller, _ask: Value) -> Result<Value, String> {
    let devices = crate::persistence::linked_devices::list(conn, caller.connections)
        .map_err(|error| error.to_string())?;
    let this_browser = crate::persistence::linked_devices::id_of(conn, caller.browser)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkDevicesAnswer {
        devices,
        this_browser,
    })
}

fn status_coverage(conn: &Connection, _ask: Value) -> Result<Value, String> {
    to_result(&crate::objects::sync::library_coverage_of(conn))
}

fn status_sync(_conn: &Connection, _ask: Value) -> Result<Value, String> {
    to_result(&crate::objects::sync::sync_status())
}

fn section_rename(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkSectionRenameAsk = params(ask)?;
    let shown = section_label(engine, &ask.id);
    crate::objects::sections::rename_section(engine, &ask.id, &ask.name)
        .map_err(|error| error.to_string())?;
    let summary = if ask.name.is_empty() {
        format!("Cleared the name of section {shown}")
    } else {
        format!("Renamed section {shown} to {}", ask.name)
    };
    Ok(Written {
        result: to_result(&FfiLinkWriteDone { ok: true })?,
        moved: "sections",
        target_id: ask.id,
        summary,
        starts_backfill: false,
    })
}

/// The answer every edit gives: it was made.
fn done(moved: &'static str, target_id: String, summary: String) -> Result<Written, String> {
    Ok(Written {
        result: to_result(&FfiLinkWriteDone { ok: true })?,
        moved,
        target_id,
        summary,
        starts_backfill: false,
    })
}

fn database_error(error: crate::objects::error::VeloqError) -> String {
    error.to_string()
}

/// The name a route is shown under now, else its id.
fn route_label(engine: &crate::persistence::PersistentEngine, id: &str) -> String {
    crate::persistence::routes::pooled::all_route_names(&engine.db)
        .remove(id)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| id.to_owned())
}

/// The name an activity is shown under, else its id.
fn activity_label(engine: &crate::persistence::PersistentEngine, id: &str) -> String {
    engine
        .db
        .query_row(
            "SELECT name FROM activity_metrics WHERE activity_id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| id.to_owned())
}

fn section_set_lift(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkSectionLiftAsk = params(ask)?;
    let shown = section_label(engine, &ask.id);
    engine.set_section_is_lift(&ask.id, ask.is_lift)?;
    let summary = if ask.is_lift {
        format!("Marked section {shown} as a lift")
    } else {
        format!("Unmarked section {shown} as a lift")
    };
    done("sections", ask.id, summary)
}

fn section_accept(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkSectionAsk = params(ask)?;
    let shown = section_label(engine, &ask.id);
    engine.accept_section(&ask.id)?;
    done("sections", ask.id, format!("Accepted section {shown}"))
}

fn section_accept_all(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let _: FfiLinkNoAsk = params(ask)?;
    let count = engine.accept_all_sections()?;
    let summary = match count {
        1 => "Accepted 1 section".to_owned(),
        count => format!("Accepted {count} sections"),
    };
    done("sections", String::new(), summary)
}

fn section_enable(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkSectionAsk = params(ask)?;
    let shown = section_label(engine, &ask.id);
    engine.enable_section(&ask.id)?;
    done("sections", ask.id, format!("Enabled section {shown}"))
}

fn section_disable(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkSectionAsk = params(ask)?;
    let shown = section_label(engine, &ask.id);
    engine.disable_section(&ask.id)?;
    done("sections", ask.id, format!("Disabled section {shown}"))
}

fn section_exclude_activity(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkExcludeAsk = params(ask)?;
    let section = section_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    crate::objects::sections::exclude_activity_from(engine, &ask.id, &ask.activity_id)
        .map_err(database_error)?;
    done(
        "sections",
        ask.id,
        format!("Excluded {activity} from section {section}"),
    )
}

fn section_include_activity(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkExcludeAsk = params(ask)?;
    let section = section_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    crate::objects::sections::include_activity_in(engine, &ask.id, &ask.activity_id)
        .map_err(database_error)?;
    done(
        "sections",
        ask.id,
        format!("Included {activity} in section {section}"),
    )
}

fn section_exclude_lap(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkLapAsk = params(ask)?;
    let section = section_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    crate::objects::sections::exclude_lap_from(engine, &ask.id, &ask.activity_id, ask.start_index)
        .map_err(database_error)?;
    done(
        "sections",
        ask.id,
        format!("Excluded a lap of {activity} from section {section}"),
    )
}

fn section_include_lap(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkLapAsk = params(ask)?;
    let section = section_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    crate::objects::sections::include_lap_in(engine, &ask.id, &ask.activity_id, ask.start_index)
        .map_err(database_error)?;
    done(
        "sections",
        ask.id,
        format!("Included a lap of {activity} in section {section}"),
    )
}

fn route_rename(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkRouteRenameAsk = params(ask)?;
    let shown = route_label(engine, &ask.id);
    crate::objects::routes::rename_route(engine, &ask.id, &ask.name).map_err(database_error)?;
    let summary = if ask.name.is_empty() {
        format!("Cleared the name of route {shown}")
    } else {
        format!("Renamed route {shown} to {}", ask.name)
    };
    done("groups", ask.id, summary)
}

fn route_exclude_activity(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkExcludeAsk = params(ask)?;
    let route = route_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    engine.exclude_activity_from_route(&ask.id, &ask.activity_id)?;
    done(
        "groups",
        ask.id,
        format!("Excluded {activity} from route {route}"),
    )
}

fn route_include_activity(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkExcludeAsk = params(ask)?;
    let route = route_label(engine, &ask.id);
    let activity = activity_label(engine, &ask.activity_id);
    engine.include_activity_in_route(&ask.id, &ask.activity_id)?;
    done(
        "groups",
        ask.id,
        format!("Included {activity} in route {route}"),
    )
}

fn heatmap_set_hidden(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkHeatmapHiddenAsk = params(ask)?;
    let activity = activity_label(engine, &ask.activity_id);
    engine
        .set_heatmap_hidden(&ask.activity_id, ask.hidden)
        .map_err(|error| error.to_string())?;
    let summary = if ask.hidden {
        format!("Hid {activity} from the heatmap")
    } else {
        format!("Showed {activity} on the heatmap")
    };
    done("activities", ask.activity_id, summary)
}

fn detection_settings(conn: &Connection, _ask: Value) -> Result<Value, String> {
    let strictness =
        crate::persistence::settings::match_config_from(conn).map_err(|error| error.to_string())?;
    let section_config = crate::persistence::settings::section_config_from(conn)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkDetectionSettings {
        enabled: crate::persistence::settings::detection_enabled_from(conn),
        strictness: FfiLinkStrictness {
            min_match_pct: strictness.min_match_percentage,
            endpoint_threshold: strictness.endpoint_threshold,
        },
        section_config: crate::FfiSectionConfig::from(&section_config),
    })
}

/// Whether a detection number is one the phone's numeric box accepts: a
/// distance, a count or a divergence is positive or it is nothing. The
/// sliders' ranges are where a slider reaches, not a limit: a value past them
/// is allowed, so only what the phone's input refuses is refused here.
fn positive(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be a positive number"))
    }
}

/// The checks the phone's grouping input makes: a match percentage past 100
/// can never be met.
fn check_strictness(ask: &FfiLinkStrictness) -> Result<(), String> {
    positive("minMatchPct", ask.min_match_pct)?;
    positive("endpointThreshold", ask.endpoint_threshold)?;
    if ask.min_match_pct > 100.0 {
        return Err("minMatchPct must be at most 100".to_owned());
    }
    Ok(())
}

/// The checks the phone's detection input makes: every parameter positive, and
/// a visit count of at least one.
fn check_section_config(config: &crate::FfiSectionConfig) -> Result<(), String> {
    positive("proximityThreshold", config.proximity_threshold)?;
    positive("minSectionLength", config.min_section_length)?;
    positive("maxSectionLength", config.max_section_length)?;
    positive("divergenceThreshold", config.divergence_threshold)?;
    if config.min_activities == 0 {
        return Err("minActivities must be at least 1".to_owned());
    }
    Ok(())
}

fn on_off(on: bool) -> &'static str {
    if on { "on" } else { "off" }
}

fn detection_set_enabled(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkDetectionEnabledAsk = params(ask)?;
    let was = engine.detection_enabled();
    engine
        .set_detection_enabled(ask.enabled)
        .map_err(|error| error.to_string())?;
    let mut written = done(
        "settings",
        String::new(),
        format!(
            "Switched route matching from {} to {}",
            on_off(was),
            on_off(ask.enabled)
        ),
    )?;
    written.starts_backfill = ask.enabled;
    Ok(written)
}

fn detection_set_strictness(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: FfiLinkStrictness = params(ask)?;
    check_strictness(&ask)?;
    let (was_pct, was_metres) = engine.match_strictness();
    engine.set_match_strictness(ask.min_match_pct, ask.endpoint_threshold);
    done(
        "settings",
        String::new(),
        format!(
            "Changed route matching from {was_pct}% and {was_metres} m to {}% and {} m",
            ask.min_match_pct, ask.endpoint_threshold
        ),
    )
}

fn detection_set_section_config(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Written, String> {
    let ask: crate::FfiSectionConfig = params(ask)?;
    check_section_config(&ask)?;
    let was = engine.get_section_config();
    let config: tracematch::SectionConfig = ask.into();
    let summary = format!(
        "Changed section detection: proximity {} to {} m, minimum length {} to {} m, \
         maximum length {} to {} m, minimum activities {} to {}, divergence {} to {}",
        was.proximity_threshold,
        config.proximity_threshold,
        was.min_section_length,
        config.min_section_length,
        was.max_section_length,
        config.max_section_length,
        was.min_activities,
        config.min_activities,
        was.divergence_threshold,
        config.divergence_threshold,
    );
    engine
        .set_section_config(config)
        .map_err(|refusal| crate::objects::detection::refusal_reason(refusal).to_owned())?;
    done("settings", String::new(), summary)
}

/// The name a section is shown under now: its own name, else the one
/// detection gave it, else its id.
fn section_label(engine: &crate::persistence::PersistentEngine, id: &str) -> String {
    crate::persistence::sections::naming::pooled::all_section_names(&engine.db)
        .remove(id)
        .or_else(|| {
            engine
                .db
                .query_row("SELECT name FROM sections WHERE id = ?1", [id], |row| {
                    row.get::<_, Option<String>>(0)
                })
                .ok()
                .flatten()
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| id.to_owned())
}

/// What one text message from a browser is, read without running anything.
#[derive(Debug, PartialEq, Eq)]
pub enum Incoming {
    /// Withdraw the ask with this id.
    Cancel(u64),
    /// An ask to answer, under its id when it has one. A message that is not
    /// a request is an ask too, and is answered `malformed request`.
    Ask(Option<u64>),
    /// A cancel that names no ask.
    Ignore,
}

/// Read what a message from a browser is.
pub fn incoming(request: &str) -> Incoming {
    let Ok(value) = serde_json::from_str::<Value>(request) else {
        return Incoming::Ask(None);
    };
    if value["method"] == "cancel" {
        return value["params"]["id"]
            .as_u64()
            .map_or(Incoming::Ignore, Incoming::Cancel);
    }
    Incoming::Ask(value["id"].as_u64())
}

/// The reply to an ask the connection has no room for.
pub fn busy(id: Option<u64>) -> String {
    json!({ "id": id, "error": BUSY }).to_string()
}

/// The reply to an ask whose answer panicked.
pub fn failed(id: Option<u64>) -> String {
    json!({ "id": id, "error": "internal error" }).to_string()
}

fn reply(id: u64, result: Result<Value, String>) -> String {
    match result {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(error) => json!({ "id": id, "error": error }),
    }
    .to_string()
}

fn malformed() -> String {
    json!({ "id": Value::Null, "error": "malformed request" }).to_string()
}

/// Answer one read from a linked browser. A write is unknown here, so the
/// pooled connection never runs one.
pub fn answer(conn: &Connection, request: &str) -> String {
    answer_from(conn, &Caller::default(), request)
}

/// Answer one read from the linked browser `caller` names.
pub fn answer_from(conn: &Connection, caller: &Caller, request: &str) -> String {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return malformed();
    };
    let result = match method(&request.method).map(|method| &method.run) {
        Some(Run::Read(run)) => run(conn, request.params),
        Some(Run::ReadAs(run)) => run(conn, caller, request.params),
        _ => Err(format!("unknown method: {}", request.method)),
    };
    reply(request.id, result)
}

/// Answer one write from the linked browser that presented `browser`, under
/// the engine lock the caller holds. `browser` is the fingerprint of the
/// browser that made the write: a write that succeeds is logged under it.
pub fn answer_write(
    engine: &mut crate::persistence::PersistentEngine,
    browser: &str,
    request: &str,
) -> Answered {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return Answered {
            reply: malformed(),
            moved: None,
            starts_backfill: false,
        };
    };
    let done = match method(&request.method).map(|method| &method.run) {
        Some(Run::Write(run)) => run(engine, request.params),
        _ => Err(format!("unknown method: {}", request.method)),
    };
    match done {
        Ok(written) => {
            let logged = crate::persistence::linked_devices::record_write(
                &engine.db,
                browser,
                &request.method,
                &written.target_id,
                &written.summary,
                super::service::now(),
            );
            if let Err(error) = logged {
                log::warn!("veloqrs: [remote] a write was made and not logged: {error}");
            }
            Answered {
                reply: reply(request.id, Ok(written.result)),
                moved: Some(written.moved),
                starts_backfill: written.starts_backfill,
            }
        }
        Err(error) => Answered {
            reply: reply(request.id, Err(error)),
            moved: None,
            starts_backfill: false,
        },
    }
}

#[cfg(test)]
#[path = "tests/protocol.rs"]
mod tests;
