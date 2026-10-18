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

/// A place name for a point, asked of the one geocoder the app is told to use.
pub mod geocode;

/// Names new routes and sections from the places they start and end in.
pub mod place_names;
