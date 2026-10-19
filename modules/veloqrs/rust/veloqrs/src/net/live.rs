//! The source the app runs, named once.
//!
//! Every caller outside the source's own module holds a [`LiveSource`], builds
//! one with [`live_source`] and reaches the default API root through
//! [`LIVE_BASE_URL`], so plugging in another [`Source`](crate::net::Source)
//! is a change to this file and that source's module. The alias keeps static
//! dispatch: it compiles to calls on the concrete type.

use crate::net::intervals::{self, IntervalsSession};
use crate::net::transport::Transport;

/// The source the app asks for the athlete's training data.
pub type LiveSource = IntervalsSession;

/// The API root a fresh process asks until something sets another.
pub(crate) const LIVE_BASE_URL: &str = intervals::BASE_URL;

/// The live source over `transport`, asking on behalf of `account`.
pub(crate) fn live_source(transport: Transport, account: impl Into<String>) -> LiveSource {
    IntervalsSession::new(transport, account)
}
