//! The workspace root and the tracematch crate declare the same release build.
//!
//! Cargo honours a profile only at a workspace root, so a veloq build takes the
//! root's and a standalone tracematch build takes the crate's. Both compile the
//! same detector, and the corpus baselines are recorded from one checkout and
//! judged from the other, so a difference between them reports the build rather
//! than the detector. Cargo cannot check this: it ignores the member profile
//! without comparing it.

const ROOT: &str = include_str!("../../Cargo.toml");
const TRACEMATCH: &str = include_str!("../../tracematch/Cargo.toml");

/// The settings in a manifest's `[profile.release]`, as key and value.
fn release_profile(manifest: &str, whose: &str) -> Vec<(String, String)> {
    let start = manifest
        .find("[profile.release]")
        .unwrap_or_else(|| panic!("{whose} declares [profile.release]"));
    let body = &manifest[start + "[profile.release]".len()..];
    let body = match body.find("\n[") {
        Some(end) => &body[..end],
        None => body,
    };
    let mut settings: Vec<(String, String)> = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let (key, value) = line.split_once('=').expect("a key = value line");
            (key.trim().to_string(), value.trim().to_string())
        })
        .collect();
    settings.sort();
    settings
}

#[test]
fn the_root_and_tracematch_release_profiles_are_the_same() {
    assert_eq!(
        release_profile(ROOT, "the workspace root"),
        release_profile(TRACEMATCH, "the tracematch crate"),
        "a veloq build and a standalone tracematch build would compile the detector differently"
    );
}
