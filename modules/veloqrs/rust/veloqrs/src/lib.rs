
pub mod ffi_types;

// Persistence layer with SQLite storage
pub use persistence::{
    with_persistent_engine, GroupSummary, PersistentEngineStats, PersistentRouteEngine,
    SectionDetectionHandle, SectionSummary, PERSISTENT_ENGINE,
};

// HTTP client for activity fetching
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

// FFI bindings for mobile platforms
pub mod ffi;

// Sections module (unification - 2026-01-28)
pub mod sections;
