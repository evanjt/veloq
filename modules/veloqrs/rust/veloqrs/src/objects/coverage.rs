//! What a date range holds, for a screen rather than for a sync.
//!
//! `window_is_covered` answers a sync's question, "do I still owe this
//! download", and a bool is all that needs. A chart asks a different one: an
//! empty axis is either an athlete who rode nothing that month or a month the
//! device never pulled, and every reader collapsed the two into "no data".

/// Whether a date range holds nothing, owes a download, or is fully local.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum RangeCoverage {
    /// The census names nothing inside the range. The account holds nothing
    /// there, so an empty chart is the truth.
    Empty = 1,
    /// The census names activities the device has not stored at the version the
    /// census gives them. An empty chart here is ignorance, not an empty range.
    NotFetched = 2,
    /// Every activity the census names inside the range is local and current.
    Loaded = 3,
}
