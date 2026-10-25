//! Consolidated intervals.icu networking.
//!
//! One pooled transport carries every request through the shared governor
//! (`crate::governor`), so all outbound traffic obeys a single dispatch pace and
//! unified retry. Endpoint fetchers (`endpoints`) build requests and parse
//! responses with serde, replacing the per-endpoint axios methods in TypeScript.
//!
//! The `SyncManager` service (`crate::objects::sync`) owns a `Transport` plus
//! credentials and drives these fetchers; TypeScript only issues commands and
//! reads status.

pub mod transport;
pub use transport::{FilePart, NetError, Transport};

pub mod types;

pub mod chart_streams;

pub mod intervals;
pub use intervals::endpoints;

/// What Garmin's Personal API speaks, behind the same governor.
pub mod garmin;

/// The source the app runs, named once for every caller.
pub mod live;
pub use live::LiveSource;
pub(crate) use live::{LIVE_BASE_URL, live_source};

/// What the sync and an upload ask the athlete's source, implemented by the
/// session.
pub mod source;
pub use source::{Source, SourceWrites};

#[cfg(test)]
#[path = "tests/recording_source.rs"]
pub(crate) mod recording_source;

pub mod elevation_backfill;

pub mod stream_backfill;

/// The engine's own wake-up when a refusal lifts.
pub mod resume;

pub mod offline_prefetch;
pub(crate) mod record_dependency_fetch;

/// The connectivity state TypeScript pushes, and the only thing in this crate
/// that knows whether there is a network at all.
pub mod connectivity;

/// Whether the athlete is touching the screen, and the gap a background pass
/// leaves at its boundaries while they are.
pub mod pacing;

/// When the recording upload queue is due, and the drain that follows.
pub mod upload_schedule;

/// One recording's upload, from the begin to the effort.
pub mod upload_recording;

/// Swapping Garmin's file into an activity intervals.icu imported, and undoing it.
pub mod garmin_swap;

/// The athlete's switch that swaps Garmin's file into each new Garmin ride.
pub(crate) mod garmin_auto_swap;
