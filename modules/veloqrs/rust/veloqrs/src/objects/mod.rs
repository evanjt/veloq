pub mod activities;
mod basemap;
pub(crate) mod detection;
mod engine;
pub mod error;
mod fitness;
pub mod init;
mod maps;
pub mod observer;
pub mod preview;
pub mod quarantine;
mod recordings;
mod routes;
pub mod sections;
mod settings;
pub mod start;
pub mod strength;
pub(crate) mod sync;
mod tiles;

pub use detection::DetectionManager;
pub use engine::VeloqEngine;
pub use error::VeloqError;
pub use init::FfiInitOutcome;
pub use preview::SectionPreview;
pub use quarantine::{FfiQuarantineReport, take_quarantine_report};
pub use start::FfiStartOutcome;
#[cfg(test)]
pub(crate) use sync::test_credentials;
pub use sync::{
    FfiCallKind, FfiCallOutcome, FfiManualActivity, FfiSyncStatus, SYNC_SERVICE, SyncManager,
    SyncState, current_session, current_transport, park_auth_expired,
};
