pub mod activities;
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
pub use sync::{
    FfiCallOutcome, FfiManualActivity, FfiSyncStatus, SyncManager, current_athlete_id,
    current_auth_header, current_transport,
};
