//! Veloqrs - Mobile FFI bindings for tracematch algorithms
//!
//! This crate provides:
//! - UniFFI bindings for iOS/Android
//! - SQLite persistence layer
//! - HTTP client for intervals.icu API

// Re-export all public types from tracematch
pub use tracematch::*;

// Persistence layer with SQLite storage
pub mod persistence;
pub use persistence::{
    GroupSummary, PERSISTENT_ENGINE, PersistentEngineStats, PersistentRouteEngine,
    SectionDetectionHandle, SectionSummary, with_persistent_engine,
};

// HTTP client for activity fetching
pub mod http;
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

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
