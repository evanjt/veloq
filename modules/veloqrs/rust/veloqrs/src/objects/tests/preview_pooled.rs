//! The preview screen's riding areas, read off committed rows so opening the
//! screen during a sync page does not wait out the write.

use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

#[test]
fn test_centres_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("preview_centres_under_writer.db");
    let preview = SectionPreview::new();
    assert!(read_while_writer_holds(|| preview.centres(5).unwrap()).is_empty());
}

#[test]
fn test_centres_match_the_engine() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let preview = SectionPreview::new();
    let pooled = preview.centres(5).unwrap();
    let locked = crate::with_persistent_engine(|e| e.preview_centres(5)).unwrap();
    assert!(
        !pooled.is_empty(),
        "the seeded activities fall back to bins"
    );
    assert_eq!(pooled.len(), locked.len());
    for (pooled, locked) in pooled.iter().zip(&locked) {
        assert_eq!(pooled.bin_key, locked.bin_key);
        assert_eq!(pooled.lat, locked.lat);
        assert_eq!(pooled.lng, locked.lng);
        assert_eq!(pooled.visit_total, locked.visit_total);
        assert_eq!(pooled.section_count, locked.section_count);
        assert_eq!(pooled.source, locked.source);
    }
}

fn create(lat: f64, lng: f64, name: &str, anchor: &str) -> String {
    let polyline: Vec<tracematch::GpsPoint> = (0..12)
        .map(|i| tracematch::GpsPoint::new(lat + f64::from(i) * 0.001, lng))
        .collect();
    let distance_meters = tracematch::matching::calculate_route_distance(&polyline);
    crate::with_persistent_engine(|e| {
        e.create_section(crate::sections::CreateSectionParams {
            sport_type: "Ride".into(),
            polyline,
            distance_meters,
            name: Some(name.into()),
            source_activity_id: Some(anchor.into()),
            start_index: Some(0),
            end_index: Some(11),
        })
        .unwrap()
    })
    .unwrap()
}

fn make_auto(id: &str) {
    crate::with_persistent_engine(|e| {
        e.db.execute(
            "UPDATE sections SET section_type = 'auto', is_user_defined = 0 WHERE id = ?1",
            [id],
        )
        .unwrap();
    })
    .unwrap();
}

#[test]
fn test_current_writer_held() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let preview = SectionPreview::new();
    let rows = read_while_writer_holds(|| preview.current(46.203, 7.35).unwrap());
    assert!(rows.expect("the seeded area is covered").is_empty());
}

/// Scenario: two separated riding areas, each with an auto section, a pin, an
/// overlay name and a user-defined section in the first area.
///
/// Expected behaviour: the first area reads only its own auto section with
/// the name, visits and pin it stores, and a point no activity covers reads
/// nothing.
#[test]
fn test_current_reads_the_area_catalogue_from_committed_rows() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    crate::with_persistent_engine(|e| {
        let track: Vec<tracematch::GpsPoint> = (0..8)
            .map(|i| tracematch::GpsPoint::new(47.5 + f64::from(i) * 0.001, 8.5))
            .collect();
        e.add_activity("far0".into(), track, "Ride".into()).unwrap();
    })
    .unwrap();
    let near = create(46.2, 7.35, "Near", "a0");
    let far = create(47.5, 8.5, "Far", "far0");
    let mine = create(46.2, 7.35, "Mine", "a0");
    make_auto(&near);
    make_auto(&far);
    crate::with_persistent_engine(|e| {
        e.set_section_name(&near, Some("Col Named")).unwrap();
        e.db.execute(
            "INSERT OR REPLACE INTO section_pins (section_id, version) VALUES (?1, 1)",
            [&near],
        )
        .unwrap();
    })
    .unwrap();

    let preview = SectionPreview::new();
    let rows = preview.current(46.203, 7.35).unwrap().expect("covered");

    assert_eq!(rows.len(), 1, "{rows:?}");
    let row = &rows[0];
    assert_eq!(row.id, near);
    assert_eq!(row.live_id.as_deref(), Some(near.as_str()));
    assert_eq!(row.status, "unchanged");
    assert_eq!(row.name.as_deref(), Some("Col Named"));
    assert!(row.pinned);
    assert!(rows.iter().all(|r| r.id != mine && r.id != far));

    assert!(preview.current(-33.9, 151.2).unwrap().is_none());
}
