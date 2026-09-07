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

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::SectionPreview;
use veloqrs::objects::preview::FfiPreviewCentre;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

const BIN_DEG: f64 = 0.045;

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

/// Seed one activity per (id, lat, lng, locality) and return the ranked areas.
fn centres_for(pool: &[(&str, f64, f64, Option<&str>)]) -> Vec<FfiPreviewCentre> {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

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

    SectionPreview::new().centres(6).expect("centres")
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
