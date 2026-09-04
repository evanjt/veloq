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

pub mod endpoints;

pub mod elevation_backfill;

/// The connectivity state TypeScript pushes, and the only thing in this crate
/// that knows whether there is a network at all.
pub mod connectivity;
