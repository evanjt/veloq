//! What a trend or verdict stands on: the baseline it was measured against,
//! the window that baseline was drawn from and how many readings were in it.
//!
//! The engine owns the verdict, so it owns the floor below which a verdict is
//! not drawn at all, and the record a surface reads to state the method
//! beside it. A claim with no floor of its own takes [`MIN_PRIOR_READINGS`].

use crate::FfiClaimBasis;

/// The fewest earlier readings a claim needs inside its window before it says
/// anything. One earlier reading is a single comparison, and a move against it
/// is as likely to be that reading's noise as a change in the athlete.
pub const MIN_PRIOR_READINGS: u32 = 2;

/// The baseline is the newest earlier reading at least `lookback_days` back.
pub const EARLIER_READING: &str = "earlierReading";

/// Whether `basis` carries enough evidence for its claim to be drawn. A claim
/// with no basis has nothing behind it, so it does not hold either.
pub fn holds(basis: Option<&FfiClaimBasis>) -> bool {
    basis.is_some_and(|b| b.population >= MIN_PRIOR_READINGS)
}
