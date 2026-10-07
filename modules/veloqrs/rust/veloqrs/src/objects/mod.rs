pub mod activities;
mod basemap;
pub mod coverage;
pub(crate) mod detection;
mod engine;
pub mod error;
mod fitness;
pub mod init;
pub mod library;
mod maps;
pub mod observer;
pub mod preview;
pub mod quarantine;
mod record_dependency;
mod recordings;
mod routes;
pub mod sections;
mod settings;
pub mod start;
pub mod strength;
pub(crate) mod sync;
mod tiles;
pub(crate) mod tracks;

pub use coverage::RangeCoverage;
pub use detection::DetectionManager;
pub use engine::VeloqEngine;
pub use error::VeloqError;
pub use init::FfiInitOutcome;
pub use library::LibraryCoverage;
pub use preview::SectionPreview;
pub use quarantine::{FfiQuarantineReport, take_quarantine_report};
pub use start::{FfiStartOutcome, FfiStartResult};
pub use sync::{
    FfiCallKind, FfiCallOutcome, FfiSyncStatus, SYNC_SERVICE, SyncManager, SyncState,
    current_session, current_transport, park_auth_expired, set_credentials_from_native,
};
#[cfg(test)]
pub(crate) use sync::{clear_test_credentials, test_credentials};
