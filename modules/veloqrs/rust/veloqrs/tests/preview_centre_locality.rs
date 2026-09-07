//! A ranked riding area carries the name of the place it covers.
//!
//! The name comes from the `locality` on the stored activity bodies, joined by
//! the activity's own bounding box against the bin the centre stands for. It
//! cannot come from `start_latlng`: the sync never asks intervals.icu for that
//! field, so no stored body carries one (B423).
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_centre_locality -p veloqrs`

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::SectionPreview;
use veloqrs::objects::preview::FfiPreviewCentre;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

const BIN_DEG: f64 = 0.045;

/// `SectionPreview::centres` reads the process-global engine, and so does the
/// seeding, so two tests running at once point it at each other's database and
/// whichever initialises last owns it. The harness runs these on threads, so
/// the loss only shows when the box is busy enough to spread them apart: this
/// target passed on a quiet machine and failed inside a full suite run, a
/// different test each time. Holding this for the whole of a test, init through
/// read, is what makes each one read its own library (`B497`, the same class as
/// `B50` inside the crate).
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// A ~1 km line at (base_lat, base_lng), well inside one bin.
fn line_track(base_lat: f64, base_lng: f64) -> Vec<GpsPoint> {
    (0..100)
        .map(|i| GpsPoint {
            latitude: base_lat + f64::from(i) * 0.0001,
            longitude: base_lng,
            elevation: None,
        })
        .collect()
}

/// The body the sync stores: a locality and no start position, which is the
/// shape every real body has.
fn body(locality: Option<&str>) -> String {
    match locality {
        Some(name) => format!(r#"{{"id":"a","locality":"{name}","country":"CH"}}"#),
        None => r#"{"id":"a","country":"CH"}"#.to_string(),
    }
}

/// Seed one activity per (id, lat, lng, locality) into the engine that is
/// installed now.
fn seed(pool: &[(&str, f64, f64, Option<&str>)]) {
    with_persistent_engine(|engine| {
        let mut epoch = 1_700_000_000i64;
        let mut bodies = Vec::new();
        for (id, lat, lng, locality) in pool {
            engine
                .add_activity((*id).to_string(), line_track(*lat, *lng), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(id, Some(epoch), None, None, None)
                .expect("metadata");
            bodies.push(((*id).to_string(), epoch, body(*locality)));
            epoch -= 14 * 86_400;
        }
        engine.upsert_activity_bodies(&bodies).expect("bodies");
    })
    .expect("engine installed");
}

/// Seed one activity per (id, lat, lng, locality) and return the ranked areas.
///
/// The lock is held from the init to the read, and the directory lives that
/// long too, so nothing else can point the global engine elsewhere in between
/// and the database is still on disk when the read runs.
fn centres_for(pool: &[(&str, f64, f64, Option<&str>)]) -> Vec<FfiPreviewCentre> {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed(pool);
    let centres = SectionPreview::new().centres(6).expect("centres");
    assert_eq!(
        visits(&centres),
        pool.len(),
        "the read ran against a library this test did not seed: {centres:?}"
    );
    centres
}

/// Every visit the ranked areas account for. One per seeded activity, so a
/// count that does not match the pool is a read of somebody else's library.
fn visits(centres: &[FfiPreviewCentre]) -> usize {
    centres.iter().map(|c| c.visit_total as usize).sum()
}

#[test]
fn a_centre_takes_the_most_common_locality_of_the_activities_in_its_bin() {
    let centres = centres_for(&[
        ("a1", 5.0, 10.0, Some("Winterthur")),
        ("a2", 5.001, 10.001, Some("Winterthur")),
        ("a3", 5.002, 10.002, Some("Uster")),
    ]);

    assert_eq!(centres.len(), 1, "one bin, got {centres:?}");
    assert_eq!(centres[0].locality.as_deref(), Some("Winterthur"));
}

#[test]
fn a_centre_with_no_locality_on_any_of_its_activities_carries_none() {
    let centres = centres_for(&[("a1", 5.0, 10.0, None), ("a2", 5.001, 10.001, None)]);

    assert_eq!(centres.len(), 1);
    assert_eq!(centres[0].locality, None);
}

#[test]
fn a_locality_from_another_bin_does_not_name_this_one() {
    // Twenty bins apart, so no radius the join uses could reach across.
    let far = 5.0 + BIN_DEG * 20.0;
    let centres = centres_for(&[
        ("near1", 5.0, 10.0, None),
        ("near2", 5.001, 10.001, None),
        ("far1", far, 10.0, Some("Faraway")),
        ("far2", far + 0.001, 10.001, Some("Faraway")),
    ]);

    assert_eq!(centres.len(), 2, "two bins, got {centres:?}");
    let near = centres
        .iter()
        .find(|c| c.lat < far - 0.1)
        .expect("the near bin");
    assert_eq!(near.locality, None, "got {:?}", near.locality);
    let distant = centres
        .iter()
        .find(|c| c.lat > far - 0.1)
        .expect("the far bin");
    assert_eq!(distant.locality.as_deref(), Some("Faraway"));
}

#[test]
fn a_tie_between_two_localities_settles_on_the_first_by_name() {
    let centres = centres_for(&[
        ("a1", 5.0, 10.0, Some("Uster")),
        ("a2", 5.001, 10.001, Some("Baden")),
    ]);

    assert_eq!(centres.len(), 1);
    assert_eq!(centres[0].locality.as_deref(), Some("Baden"));
}

/// Scenario: the tripwire in the fixture is what a future test added without
/// the lock trips on, so it has to actually notice.
///
/// Expected behaviour: pointing the global engine at another database between
/// the seeding and the read gives a count that does not match the pool. That
/// is the failure the fleet saw, held still rather than waited for.
#[test]
fn a_read_against_another_library_does_not_match_the_pool_it_seeded() {
    let _serial = serial();

    let seeded = TempDir::new().expect("tempdir");
    assert!(persistent_engine_init(
        seeded
            .path()
            .join("routes.db")
            .to_str()
            .expect("utf-8 path")
            .to_string()
    ));
    let pool = [
        ("a1", 5.0, 10.0, Some("Winterthur")),
        ("a2", 5.001, 10.001, Some("Winterthur")),
    ];
    seed(&pool);
    assert_eq!(
        visits(&SectionPreview::new().centres(6).expect("centres")),
        2
    );

    // What another test's init does to this one.
    let elsewhere = TempDir::new().expect("tempdir");
    assert!(persistent_engine_init(
        elsewhere
            .path()
            .join("routes.db")
            .to_str()
            .expect("utf-8 path")
            .to_string()
    ));

    assert_ne!(
        visits(&SectionPreview::new().centres(6).expect("centres")),
        pool.len(),
        "the tripwire has to notice a read against a library this test did not seed"
    );
}
