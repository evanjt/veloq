pub mod activities;
mod basemap;
pub(crate) mod detection;
mod engine;
pub mod error;
mod fitness;
mod maps;
mod preview;
mod routes;
mod sections;
mod settings;
pub mod strength;
mod sync;
mod tiles;

pub use engine::VeloqEngine;
pub use error::VeloqError;
pub use preview::SectionPreview;
#[cfg(test)]
pub(crate) use sync::test_credentials;
pub use sync::{
    FfiCallOutcome, FfiManualActivity, FfiSyncStatus, SYNC_SERVICE, SyncManager, SyncState,
    current_transport, park_auth_expired,
};
