//! Veloqrs - Mobile FFI bindings for tracematch algorithms
//!
//! This crate provides:
//! - UniFFI bindings for iOS/Android
//! - SQLite persistence layer
//! - HTTP client for intervals.icu API

// Re-export algorithm types from tracematch (without UniFFI derives)
pub use tracematch::*;

// FFI-safe types with UniFFI derives
pub mod ffi_types;
pub use ffi_types::*;

// Persistence layer with SQLite storage
pub mod persistence;
pub use persistence::{
    GroupSummary, PERSISTENT_ENGINE, PersistentEngineStats, PersistentRouteEngine,
    SectionDetectionHandle, SectionSummary, with_persistent_engine,
};

// HTTP client for activity fetching
pub mod http;
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

// Tile generation for heatmaps
pub mod tiles;
pub use tiles::{TileConfig, TileResult, generate_tile, generate_all_tiles, tiles_for_tracks};

// FFI bindings for mobile platforms
pub mod ffi;

uniffi::setup_scaffolding!();

/// Initialize logging for Android
#[cfg(target_os = "android")]
pub(crate) fn init_logging() {
    use android_logger::Config;
    use log::LevelFilter;

    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("veloqrs"),
    );
}

#[cfg(not(target_os = "android"))]
pub(crate) fn init_logging() {
    // No-op on non-Android platforms
}
