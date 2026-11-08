//! A card's preview line carries the elevation of the track it summarises.

use crate::persistence::PersistentEngine;
use crate::persistence::activities::{persist_refilled_signatures, pooled as stored};
use crate::persistence::codec::decode_polyline;
use crate::persistence::screens::pooled::preview_track_refilling;
use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;

fn track(with_elevation: bool) -> Vec<GpsPoint> {
    (0..300)
        .map(|i| {
            let t = f64::from(i);
            GpsPoint {
                latitude: 46.5 + t * 0.0004,
                longitude: 6.6 + (t * 0.5).sin() * 0.003,
                elevation: with_elevation.then_some(400.0 + t * 1.5),
            }
        })
        .collect()
}

fn library(dir: &TempDir, points: Vec<GpsPoint>) -> PersistentEngine {
    let path = dir.path().join("library.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), points, "Ride".into())
        .expect("add_activity");
    engine
}

/// Overwrite the stored signature with the same vertices and no elevation, as
/// a row written before signatures kept it.
fn strip_signature_elevation(engine: &PersistentEngine) {
    let mut signature = stored::signature(&engine.db, "a1").expect("signature");
    for point in &mut signature.points {
        point.elevation = None;
    }
    crate::persistence::activities::write_signature(&engine.db, "a1", &signature)
        .expect("write the bare signature");
}

fn decoded(track: &crate::FfiPreviewTrack) -> Vec<GpsPoint> {
    decode_polyline(&track.encoded_coords).expect("a decodable line")
}

/// Scenario: an activity stored with an altitude stream.
///
/// Expected behaviour: its preview line carries an elevation at every vertex,
/// the one the track holds there.
#[test]
fn a_stored_activity_with_elevation_previews_with_elevation() {
    let dir = TempDir::new().unwrap();
    let engine = library(&dir, track(true));

    let line = decoded(&engine.preview_track("a1").expect("preview"));

    assert!(line.len() >= 2);
    for point in &line {
        let source = track(true)
            .into_iter()
            .find(|t| {
                (t.latitude - point.latitude).abs() < 1e-6
                    && (t.longitude - point.longitude).abs() < 1e-6
            })
            .expect("a vertex of the track");
        assert!((point.elevation.expect("elevation") - source.elevation.unwrap()).abs() < 0.06);
    }
}

#[test]
fn a_stored_activity_without_elevation_previews_without_it() {
    let dir = TempDir::new().unwrap();
    let engine = library(&dir, track(false));

    let line = decoded(&engine.preview_track("a1").expect("preview"));

    assert!(line.iter().all(|p| p.elevation.is_none()));
}

/// Scenario: a signature row written before signatures kept elevation, over a
/// track that has it.
///
/// Expected behaviour: the first read draws the line with elevation and hands
/// back the signature to write; once it is written the row reads back with
/// elevation, the vertices where they were, and the next read rebuilds
/// nothing.
#[test]
fn a_signature_row_without_elevation_is_refilled_once() {
    let dir = TempDir::new().unwrap();
    let mut engine = library(&dir, track(true));
    let before = stored::signature(&engine.db, "a1").expect("signature");
    strip_signature_elevation(&engine);
    assert!(
        stored::signature(&engine.db, "a1")
            .unwrap()
            .points
            .iter()
            .all(|p| p.elevation.is_none())
    );

    let (first, rebuilt) = preview_track_refilling(&engine.db, "a1");
    let rebuilt = rebuilt.expect("the track has elevation the signature lacks");
    assert!(
        decoded(&first.expect("preview"))
            .iter()
            .all(|p| p.elevation.is_some())
    );

    engine
        .store_refilled_signatures(&[rebuilt])
        .expect("write back");
    let after = stored::signature(&engine.db, "a1").expect("signature");
    assert_eq!(after.points.len(), before.points.len());
    for (a, b) in after.points.iter().zip(&before.points) {
        assert_eq!((a.latitude, a.longitude), (b.latitude, b.longitude));
        assert!(a.elevation.is_some());
    }

    let (_, again) = preview_track_refilling(&engine.db, "a1");
    assert!(again.is_none(), "a refilled row costs no further decode");
}

#[test]
fn a_bare_signature_over_a_track_without_elevation_is_left_alone() {
    let dir = TempDir::new().unwrap();
    let engine = library(&dir, track(false));

    let (preview, rebuilt) = preview_track_refilling(&engine.db, "a1");

    assert!(preview.is_some());
    assert!(rebuilt.is_none());
}

#[test]
fn a_bare_signature_with_no_stored_track_is_left_alone() {
    let dir = TempDir::new().unwrap();
    let engine = library(&dir, track(true));
    strip_signature_elevation(&engine);
    engine
        .db
        .execute(
            "DELETE FROM gps_tracks WHERE activity_id = ?",
            params!["a1"],
        )
        .unwrap();

    let (preview, rebuilt) = preview_track_refilling(&engine.db, "a1");

    assert!(rebuilt.is_none());
    assert!(
        decoded(&preview.expect("preview"))
            .iter()
            .all(|p| p.elevation.is_none())
    );
}

/// Scenario: the activity is stored again, with elevation, after a reader
/// rebuilt its signature and before that write reached the engine.
///
/// Expected behaviour: the newer row stands.
#[test]
fn a_write_back_never_replaces_a_row_that_already_carries_elevation() {
    let dir = TempDir::new().unwrap();
    let mut engine = library(&dir, track(true));
    let current = stored::signature(&engine.db, "a1").expect("signature");
    let mut stale = current.clone();
    for point in &mut stale.points {
        point.elevation = Some(9_000.0);
    }

    engine
        .store_refilled_signatures(&[stale])
        .expect("write back");

    let after = stored::signature(&engine.db, "a1").expect("signature");
    assert!(after.points.iter().all(|p| p.elevation != Some(9_000.0)));
}

/// An engine other than the one the read ran against takes nothing.
#[test]
fn a_write_back_for_a_replaced_engine_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = library(&dir, track(true));
    strip_signature_elevation(&engine);
    let (_, rebuilt) = preview_track_refilling(&engine.db, "a1");

    persist_refilled_signatures(u64::MAX, &[rebuilt.expect("rebuilt")]);

    assert!(
        stored::signature(&engine.db, "a1")
            .unwrap()
            .points
            .iter()
            .all(|p| p.elevation.is_none())
    );
}
