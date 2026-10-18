//! The cost-band harness the tracematch gates use, shared with the engine's.
//!
//! The baseline format, the band, the rebase switch and its reason all live in
//! `tracematch/tests/bitwise`, so a gate here records and compares through the
//! same code as the fold's own and there is one baseline format. Included by
//! path because an integration test of one crate cannot depend on another's.
//!
//! These gates read a wall clock, so they run where the clock is steady: the
//! corpus machine, in release, behind `real-corpus`. A shared runner measures
//! the runner. They also read the heap through the counting allocator the
//! included module installs, which is the code's number rather than the
//! machine's and so takes the tighter `*_bytes` band.

#![allow(dead_code)]

#[path = "../../../tracematch/tests/bitwise/mod.rs"]
pub mod bitwise;
#[path = "../../../tracematch/tests/corpus/mod.rs"]
pub mod corpus;

use std::path::Path;

pub use bitwise::baseline::{self, Band};
#[allow(unused_imports)]
pub use bitwise::median_and_p95;

/// Run `body` and return what it produced with how far the live heap rose
/// above what was live when it started, in bytes. The allocator is
/// process-wide, so `body` must be the only thing running: call it between
/// quiesced spans, never while a background worker is still folding.
pub fn peak_rise<T>(body: impl FnOnce() -> T) -> (T, u64) {
    let window = baseline::anchor_peak();
    let out = body();
    (out, window.rise_bytes())
}

/// Judge `measured` against the baseline at `path`. A baseline recorded on
/// another shape of input is re-derived rather than compared, so growth reads
/// as growth and never as a regression.
pub fn judge(path: &Path, shape: &str, measured: &[(&str, u64)], band: &Band) {
    let digests = [shape.to_string()];
    let golden = std::fs::read_to_string(path).ok();
    if let Some(existing) = golden.as_deref()
        && baseline::digests_differ(existing, &digests)
    {
        println!(
            "input changed shape, was {:?}, now {shape:?}: re-deriving the baseline",
            baseline::digest_lines(existing)
        );
        baseline::check_rederiving(path, &digests, measured, band);
    } else {
        baseline::check(path, &digests, measured, band);
    }
}
