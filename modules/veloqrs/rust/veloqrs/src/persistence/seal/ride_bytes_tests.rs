//! Scenario: a ride that no connector can serve again, and one that can, are
//! packed from the same function, and a fresh library restores either from the
//! bytes alone.
//!
//! Expected behaviour: every ride packs its decoded rows, a ride with a kept
//! original also packs that file, the rows read back exactly as they were
//! stored, a restored ride is not owed by the next census pull unless its
//! version moved, a key already held is left as it is, and bytes this build
//! cannot read are refused by name.

use super::*;
use crate::net::types::ActivityCensusEntry;
use crate::persistence::PersistentEngine;
use crate::persistence::activities::pooled::census_owed_count;
use crate::persistence::codec;
use crate::persistence::originals::keep_original;
use crate::persistence::seal::pack::EntryKind;
use rusqlite::params;

const ATHLETE: &str = "i-athlete";

fn engine() -> PersistentEngine {
    PersistentEngine::in_memory().expect("in-memory engine")
}

/// An intervals.icu ride holding every kind of row a ride can have.
fn seed_synced_ride(engine: &PersistentEngine, key: &str, sync_date: &str) {
    let db = &engine.db;
    db.execute(
        "INSERT INTO activities
            (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng,
             created_at, start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?1, 'Ride', 46.2, 46.3, 7.3, 7.4, 1700000000, 1699950000,
                 'Lake loop', 42100.5, 5400)",
        params![key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO activity_bodies (activity_id, date, raw, intervals_id)
         VALUES (?1, 1699950000, '{\"type\":\"Ride\",\"name\":\"Lake loop\"}', ?1)",
        params![key],
    )
    .unwrap();
    let points: Vec<tracematch::GpsPoint> = (0..50)
        .map(|i| tracematch::GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
        .collect();
    db.execute(
        "INSERT INTO gps_tracks
            (activity_id, track_data, point_count, elevation_source,
             elevation_settled_version, elevation_state, elevation_attempts)
         VALUES (?1, ?2, 50, 2, 'v7', 1, 3)",
        params![key, codec::encode_polyline(&points)],
    )
    .unwrap();
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES (?1, ?2, 50)",
        params![
            key,
            codec::serialize(&(0..50u32).collect::<Vec<_>>()).unwrap()
        ],
    )
    .unwrap();
    for (kind, scale) in [("heartrate", 1.0), ("watts", 1.0), ("altitude", 10.0)] {
        let samples: Vec<Option<f64>> = (0..50)
            .map(|i| (i % 7 != 0).then(|| 100.0 + f64::from(i)))
            .collect();
        db.execute(
            "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
             VALUES (?1, ?2, ?3, 50)",
            params![key, kind, codec::encode_series(&samples, scale)],
        )
        .unwrap();
    }
    db.execute(
        "INSERT INTO interval_bodies (activity_id, raw) VALUES (?1, '[{\"type\":\"WORK\"}]')",
        params![key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO activity_census
            (athlete_id, intervals_id, start_date_local, created, icu_sync_date,
             fetched_sync_date, has_latlng, has_series)
         VALUES (?1, ?2, '2023-11-14T08:00:00', '2023-11-14T10:00:00Z', ?3, ?3, 1, 1)",
        params![ATHLETE, key, sync_date],
    )
    .unwrap();
}

/// An imported ride: no connector id, no census row, a kept original.
fn seed_imported_ride(engine: &PersistentEngine, key: &str) -> Vec<u8> {
    let db = &engine.db;
    db.execute(
        "INSERT INTO activities
            (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date, name)
         VALUES (?1, 'Ride', 0, 0, 0, 0, 1699960000, 'Evening spin')",
        params![key],
    )
    .unwrap();
    db.execute(
        "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 1699960000, '{}')",
        params![key],
    )
    .unwrap();
    db.execute(
        "INSERT OR REPLACE INTO ride_identity
            (activity_id, device_serial, created_unix, start_local, sport)
         VALUES (?1, 3922001234, 1699955555, 1699960000, 'Ride')",
        params![key],
    )
    .unwrap();
    let fit = crate::fit::recorded_ride_fit();
    keep_original(db, key, "import", "fit", &fit, 10).unwrap();
    fit
}

fn kinds(entries: &[(EntryKind, Vec<u8>)]) -> Vec<EntryKind> {
    entries.iter().map(|(kind, _)| *kind).collect()
}

fn rows_entry(entries: &[(EntryKind, Vec<u8>)]) -> &[u8] {
    &entries
        .iter()
        .find(|(kind, _)| *kind == EntryKind::StreamsBin)
        .expect("a rows entry")
        .1
}

fn census_owed(engine: &PersistentEngine) -> u32 {
    census_owed_count(&engine.db, ATHLETE, "2000-01-01", "2100-01-01").unwrap()
}

fn census_pull(engine: &mut PersistentEngine, key: &str, sync_date: &str) {
    engine
        .record_activity_census(
            ATHLETE,
            &[ActivityCensusEntry {
                id: key.to_string(),
                start_date_local: Some("2023-11-14T08:00:00".to_string()),
                created: Some("2023-11-14T10:00:00Z".to_string()),
                icu_sync_date: Some(sync_date.to_string()),
                has_latlng: true,
                has_series: true,
            }],
        )
        .unwrap();
}

fn count(engine: &PersistentEngine, table: &str) -> i64 {
    engine
        .db
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_ride_with_no_original_packs_its_rows_and_a_ride_with_one_packs_both() {
    let engine = engine();
    seed_synced_ride(&engine, "i100", "2023-11-14T10:05:00Z");
    let fit = seed_imported_ride(&engine, "src-imp-1");

    let synced = packed_entries(&engine.db, "i100").unwrap();
    assert_eq!(kinds(&synced), vec![EntryKind::StreamsBin]);

    let imported = packed_entries(&engine.db, "src-imp-1").unwrap();
    assert_eq!(
        kinds(&imported),
        vec![EntryKind::OriginalFit, EntryKind::StreamsBin]
    );
    assert_eq!(imported[0].1, fit);

    assert_eq!(packed_entries(&engine.db, "i-unknown").unwrap().len(), 0);
}

#[test]
fn the_rows_read_back_exactly_as_they_were_stored() {
    let engine = engine();
    seed_synced_ride(&engine, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&engine.db, "i100").unwrap();

    let ride = unpack_rows(rows_entry(&entries)).unwrap();

    assert_eq!(ride.key, "i100");
    let activity = ride.activity.as_ref().expect("activities row");
    assert_eq!(activity.name.as_deref(), Some("Lake loop"));
    assert_eq!(activity.intervals_id.as_deref(), Some("i100"));
    let stored_track: Vec<u8> = engine
        .db
        .query_row(
            "SELECT track_data FROM gps_tracks WHERE activity_id = 'i100'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let track = ride.track.as_ref().expect("gps_tracks row");
    assert_eq!(track.track_data, stored_track);
    assert_eq!(
        (
            track.elevation_source,
            track.elevation_state,
            track.elevation_attempts
        ),
        (2, 1, 3)
    );
    assert_eq!(track.elevation_settled_version.as_deref(), Some("v7"));
    let kinds: Vec<&str> = ride.streams.iter().map(|s| s.kind.as_str()).collect();
    assert_eq!(kinds, vec!["altitude", "heartrate", "watts"]);
    assert_eq!(ride.interval_body.as_deref(), Some("[{\"type\":\"WORK\"}]"));
    let census = ride.census.as_ref().expect("census row");
    assert_eq!(census.athlete_id, ATHLETE);
    assert_eq!(
        census.icu_sync_date.as_deref(),
        Some("2023-11-14T10:05:00Z")
    );

    // Packing the same rows again gives the same bytes.
    assert_eq!(packed_entries(&engine.db, "i100").unwrap(), entries);
}

#[test]
fn a_restored_ride_equals_the_ride_that_was_packed() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    seed_imported_ride(&source, "src-imp-1");

    let target = engine();
    for key in ["i100", "src-imp-1"] {
        let entries = packed_entries(&source.db, key).unwrap();
        let ride = unpack_rows(rows_entry(&entries)).unwrap();
        assert!(store_packed_ride(&target.db, &ride).unwrap());
    }

    for key in ["i100", "src-imp-1"] {
        let packed = packed_entries(&source.db, key).unwrap();
        let restored = packed_entries(&target.db, key).unwrap();
        assert_eq!(rows_entry(&restored), rows_entry(&packed), "{key}");
    }
    // A key is never re-minted.
    assert_eq!(count(&target, "activities"), 2);
    assert_eq!(count(&target, "gps_tracks"), 1);
    assert_eq!(count(&target, "activity_streams"), 3);
    // The imported ride's file is not part of the rows.
    assert_eq!(count(&target, "ride_originals"), 0);
}

#[test]
fn a_restored_ride_is_owed_by_a_census_pull_only_when_its_version_moved() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&source.db, "i100").unwrap();
    let ride = unpack_rows(rows_entry(&entries)).unwrap();

    let mut target = engine();
    assert!(store_packed_ride(&target.db, &ride).unwrap());
    assert_eq!(census_owed(&target), 0);

    census_pull(&mut target, "i100", "2023-11-14T10:05:00Z");
    assert_eq!(census_owed(&target), 0);

    census_pull(&mut target, "i100", "2023-11-15T09:00:00Z");
    assert_eq!(census_owed(&target), 1);
}

#[test]
fn a_census_row_a_pull_wrote_first_is_marked_fetched_only_for_the_same_version() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&source.db, "i100").unwrap();
    let ride = unpack_rows(rows_entry(&entries)).unwrap();

    let mut same = engine();
    census_pull(&mut same, "i100", "2023-11-14T10:05:00Z");
    assert_eq!(census_owed(&same), 1);
    assert!(store_packed_ride(&same.db, &ride).unwrap());
    assert_eq!(census_owed(&same), 0);

    let mut moved = engine();
    census_pull(&mut moved, "i100", "2023-11-15T09:00:00Z");
    assert!(store_packed_ride(&moved.db, &ride).unwrap());
    assert_eq!(census_owed(&moved), 1);
}

#[test]
fn storing_a_ride_twice_stores_one_and_leaves_the_held_one_alone() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&source.db, "i100").unwrap();
    let ride = unpack_rows(rows_entry(&entries)).unwrap();

    let target = engine();
    assert!(store_packed_ride(&target.db, &ride).unwrap());
    target
        .db
        .execute(
            "UPDATE activities SET name = 'Renamed' WHERE id = 'i100'",
            [],
        )
        .unwrap();
    assert!(!store_packed_ride(&target.db, &ride).unwrap());

    assert_eq!(count(&target, "activities"), 1);
    assert_eq!(count(&target, "activity_bodies"), 1);
    assert_eq!(count(&target, "activity_streams"), 3);
    assert_eq!(count(&target, "activity_census"), 1);
    let name: String = target
        .db
        .query_row("SELECT name FROM activities WHERE id = 'i100'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "Renamed");
}

#[test]
fn a_ride_held_under_the_same_intervals_id_is_not_stored_a_second_time() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&source.db, "i100").unwrap();
    let mut ride = unpack_rows(rows_entry(&entries)).unwrap();

    let target = engine();
    seed_synced_ride(&target, "i100", "2023-11-14T10:05:00Z");
    ride.key = "src-other".to_string();
    assert!(!store_packed_ride(&target.db, &ride).unwrap());
    assert_eq!(count(&target, "activities"), 1);
}

#[test]
fn a_ride_with_no_track_series_or_census_row_round_trips() {
    let source = engine();
    source
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES ('i7', 1699950000, '{}')",
            [],
        )
        .unwrap();
    let entries = packed_entries(&source.db, "i7").unwrap();
    let ride = unpack_rows(rows_entry(&entries)).unwrap();
    assert!(ride.activity.is_none() && ride.track.is_none() && ride.census.is_none());
    assert_eq!(ride.streams.len(), 0);

    let target = engine();
    assert!(store_packed_ride(&target.db, &ride).unwrap());
    assert_eq!(count(&target, "activity_bodies"), 1);
    assert_eq!(count(&target, "activities"), 0);
}

#[test]
fn bytes_this_build_cannot_read_are_refused_by_name() {
    let source = engine();
    seed_synced_ride(&source, "i100", "2023-11-14T10:05:00Z");
    let entries = packed_entries(&source.db, "i100").unwrap();
    let bytes = rows_entry(&entries);

    let inflated = inflate_rows(bytes).unwrap();
    assert_eq!(inflated[0], ROWS_FORMAT_VERSION);

    let mut newer = inflated.clone();
    newer[0] = ROWS_FORMAT_VERSION + 1;
    let err = unpack_rows(&deflate_rows(&newer).unwrap()).unwrap_err();
    assert_eq!(err, RowsError::NewerVersion(ROWS_FORMAT_VERSION + 1));

    let mut zero = inflated.clone();
    zero[0] = 0;
    assert_eq!(
        unpack_rows(&deflate_rows(&zero).unwrap()).unwrap_err(),
        RowsError::UnsupportedVersion(0)
    );

    assert!(matches!(
        unpack_rows(&bytes[..bytes.len() / 2]),
        Err(RowsError::Damaged(_))
    ));
    assert!(matches!(unpack_rows(&[]), Err(RowsError::Damaged(_))));
    let mut trailing = inflated;
    trailing.extend_from_slice(&[1, 2, 3]);
    assert!(matches!(
        unpack_rows(&deflate_rows(&trailing).unwrap()),
        Err(RowsError::Damaged(_))
    ));
}
