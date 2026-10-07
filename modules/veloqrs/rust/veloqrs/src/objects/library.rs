//! How much of the athlete's library is on the device.
//!
//! Every progress figure the app had was the current run's own queue, so a
//! library of 1,598 rides with 400 tracks stored showed "12/12" and then
//! nothing. This is the window the athlete asked for instead, from the census.

/// The four counts the sync row reports, for the signed-in athlete.
///
/// Two pairs rather than one: the activity pages arrive with the window syncs
/// and the tracks with the GPS pass, so one can be current while the other is
/// short, and a single fraction would hide whichever is further behind.
///
/// All four are zero for an athlete whose census has never been pulled. Nothing
/// is known about the account then, and a zero pair reads as nothing to report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, uniffi::Record)]
pub struct LibraryCoverage {
    /// Activities the server says the account holds.
    pub upstream: u32,
    /// Of those, the ones stored locally at the version the census names.
    pub fetched: u32,
    /// Activities the server says carry a GPS track.
    pub tracks_upstream: u32,
    /// Of those, the ones whose track is on the device.
    pub tracks_stored: u32,
}
