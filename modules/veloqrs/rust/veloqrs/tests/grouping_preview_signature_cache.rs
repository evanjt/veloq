//! Starting a grouping preview must not touch the signature cache.
//!
//! The preview groups the whole library, so it wants every signature at once.
//! Walking them through `get_signature` on a library larger than the 200-entry
//! LRU evicts what the rest of the app warmed and reads every blob back a row
//! at a time. That is the failure `load_all_signatures` was written to avoid
//! and documents in its own comment, and the preview is the caller that never
//! got it.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test grouping_preview_signature_cache -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::route_grouping_preview::PreviewStrictness;
use veloqrs::persistence::with_persistent_engine;

/// Comfortably past the 200-entry signature LRU, so any walk over the library
/// has to evict, and far enough past it that the survivors of a walk cannot
/// coincide with what the cache already held.
const ACTIVITIES: usize = 260;

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_engine() {
    with_persistent_engine(|engine| {
        for i in 0..ACTIVITIES {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .expect("engine installed");
}

#[test]
fn a_preview_start_leaves_the_signature_cache_alone() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed_engine();

    let mut before = with_persistent_engine(|engine| engine.signature_cache_ids()).expect("engine");
    before.sort();
    assert!(
        before.len() >= 200,
        "the seed should have filled the LRU, found {} entries",
        before.len()
    );

    let started = with_persistent_engine(|engine| {
        engine
            .grouping_preview_background(PreviewStrictness {
                min_match_percentage: 70.0,
                endpoint_threshold: 100.0,
            })
            .is_some()
    })
    .expect("engine");
    assert!(started, "the preview should start on a seeded library");

    let mut after = with_persistent_engine(|engine| engine.signature_cache_ids()).expect("engine");
    after.sort();

    assert_eq!(
        before,
        after,
        "starting a preview changed which signatures are cached, so it walked the library through \
         the 200-entry LRU instead of reading it in one statement. {} entries differ, and every \
         one of them is ground the route list or the map will now read back a row at a time",
        before.iter().filter(|id| !after.contains(id)).count()
    );
}
