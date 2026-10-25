use super::*;
use crate::fit_synthetic::{indoor_ride, outdoor_ride};
use crate::persistence::origin::{ActivityOrigin, origin_of};
use serde_json::json;
use tempfile::TempDir;

const GARMIN_ID: i64 = 18_342_901_776;

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    (dir, engine)
}

fn listed(id: i64) -> ListedActivity {
    serde_json::from_value(json!({
        "activityId": id,
        "activityName": "Lake loop",
        "startTimeLocal": "2026-03-14 09:00:00",
        "startTimeGMT": "2026-03-14 07:00:00",
        "activityType": {"typeKey": "cycling"},
        "duration": 99.0,
        "elapsedDuration": 99.0,
        "distance": 1.0
    }))
    .unwrap()
}

fn kept_at(dir: &TempDir, key: &str) -> PathBuf {
    dir.path().join("recordings").join(format!("{key}.fit"))
}

fn body_of_row(engine: &PersistentEngine, key: &str) -> serde_json::Value {
    serde_json::from_str(&engine.get_activity_body(key).expect("a stored body")).unwrap()
}

fn stream<'a>(streams: &'a [StreamDto], kind: &str) -> Option<&'a StreamDto> {
    streams.iter().find(|s| s.kind == kind)
}

/// Scenario: intervals.icu stops serving a Garmin ride, and the original the
/// athlete's own key downloads is all that is left of it.
///
/// Expected behaviour: a `src-garmin-` row with the ride's track, its heart
/// rate and power at the length of the track and its clock, its totals, and,
/// with the original kept for upload, the original on disk beside the
/// recordings.
#[test]
fn an_outdoor_original_becomes_a_complete_activity() {
    let (dir, mut engine) = engine();
    let fit = outdoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);
    let path = kept_at(&dir, &key);

    let ingested = ingest_into(&mut engine, Some(&path), &listed(GARMIN_ID), &fit).expect("stored");

    assert_eq!(ingested, Ingested::Stored { tracked: true });
    assert_eq!(key, "src-garmin-18342901776");
    assert_eq!(origin_of(&key), ActivityOrigin::Source);
    assert_eq!(std::fs::read(&path).unwrap(), fit);

    let track = engine.get_gps_track(&key).expect("a stored track");
    assert_eq!(track.len(), 30);
    assert!((track[10].latitude - 46.501).abs() < 1e-5);
    assert!(track[10].elevation.is_some_and(|e| (e - 505.0).abs() < 0.5));
    assert!(
        engine
            .get_activities_missing_time_streams(std::slice::from_ref(&key))
            .is_empty(),
        "the clock is stored"
    );
    let streams = engine.load_activity_streams(&key).unwrap();
    let heart_rate = stream(&streams, "heartrate").expect("heart rate");
    let power = stream(&streams, "watts").expect("power");
    assert_eq!(heart_rate.data.len(), track.len());
    assert_eq!(power.data.len(), track.len());
    assert_eq!(heart_rate.data[3], Some(123.0));
    assert_eq!(power.data[29], Some(229.0));

    let body = body_of_row(&engine, &key);
    assert_eq!(body["id"], key);
    assert_eq!(body["name"], "Lake loop");
    assert_eq!(body["type"], "Ride");
    assert_eq!(body["start_date_local"], "2026-03-14T09:00:00");
    assert_eq!(body["moving_time"], 28);
    assert_eq!(body["elapsed_time"], 30);
    assert_eq!(body["distance"], 174.0);
    assert_eq!(body["total_elevation_gain"], 15.0);
    assert_eq!(body["average_heartrate"], 135.0);
    assert_eq!(body["icu_average_watts"], 214.0);
    let metrics = &engine.activity_metrics[&key];
    assert_eq!(metrics.moving_time, 28);
    assert_eq!(metrics.elapsed_time, 30);
    assert_eq!(metrics.avg_hr, Some(135));
    assert_eq!(metrics.avg_power, Some(214));
    assert_eq!(metrics.sport_type, "Ride");
    assert_eq!(metrics.date, 1_773_471_600 + 7_200);
}

/// Scenario: intervals.icu's Garmin import is left on, the default, so Garmin
/// holds the original and nothing is uploaded from the phone.
///
/// Expected behaviour: the row, its track and its streams are stored, and no
/// original is written.
#[test]
fn a_stored_original_is_not_kept_on_the_phone_by_default() {
    let (dir, mut engine) = engine();
    let fit = outdoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);

    ingest_into(&mut engine, None, &listed(GARMIN_ID), &fit).expect("stored");

    assert!(!kept_at(&dir, &key).exists(), "no original is kept");
    assert!(engine.has_stored_activity(&key));
    assert_eq!(
        engine.get_gps_track(&key).expect("a stored track").len(),
        30
    );
    assert!(!engine.load_activity_streams(&key).unwrap().is_empty());
    assert!(engine.get_activity_body(&key).is_some());
}

/// Scenario: a trainer ride has no fix.
///
/// Expected behaviour: the streams are stored in the file's own samples with
/// their `time`, and the activity has no track.
#[test]
fn an_indoor_original_keeps_its_streams_and_has_no_track() {
    let (dir, mut engine) = engine();
    let fit = indoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);

    let ingested = ingest_into(
        &mut engine,
        Some(&kept_at(&dir, &key)),
        &listed(GARMIN_ID),
        &fit,
    )
    .expect("stored");

    assert_eq!(ingested, Ingested::Stored { tracked: false });
    assert!(engine.get_gps_track(&key).is_none());
    let streams = engine.load_activity_streams(&key).unwrap();
    let time = stream(&streams, "time").expect("time");
    assert_eq!(time.data.len(), 30);
    for kind in [
        "heartrate",
        "watts",
        "cadence",
        "distance",
        "velocity_smooth",
    ] {
        assert_eq!(stream(&streams, kind).expect(kind).data.len(), 30, "{kind}");
    }
    assert!(stream(&streams, "latlng").is_none());
    assert!(stream(&streams, "altitude").is_none());
    assert!(engine.has_stored_activity(&key));
    assert_eq!(engine.activity_metrics[&key].avg_power, Some(214));
}

/// Scenario: the next census or queue pass runs with a Garmin original stored.
///
/// Expected behaviour: the row is not a census candidate, so a sync does not
/// reconcile it away for being absent from intervals.icu, and no queue that
/// asks intervals.icu for bodies, streams or elevation names it.
#[test]
fn a_garmin_original_is_named_by_no_upstream_queue() {
    let (dir, mut engine) = engine();
    for (id, fit) in [
        (GARMIN_ID, outdoor_ride().to_fit()),
        (GARMIN_ID + 1, indoor_ride().to_fit()),
    ] {
        let key = garmin_source_key(id);
        ingest_into(&mut engine, Some(&kept_at(&dir, &key)), &listed(id), &fit).expect("stored");
    }

    let keys = [
        garmin_source_key(GARMIN_ID),
        garmin_source_key(GARMIN_ID + 1),
    ];
    let candidates = engine.census_candidates("2030-01-01");
    let missing_streams = engine.activities_missing_streams(10).unwrap();
    let missing_intervals = engine.activities_missing_interval_bodies().unwrap();
    for key in &keys {
        assert!(!candidates.iter().any(|(id, _)| id == key), "census {key}");
        assert!(
            !missing_streams.iter().any(|gap| &gap.activity_id == key),
            "streams {key}"
        );
        assert!(!missing_intervals.contains(key), "intervals {key}");
    }
    assert_eq!(
        crate::net::elevation_backfill::pooled_elevation_backfill_remaining(&engine.db).unwrap(),
        0
    );
    let reconciled = engine.reconcile_against_census(&["i1".to_string()], "2030-01-01");
    assert!(reconciled.is_empty(), "{reconciled:?}");
    assert!(keys.iter().all(|key| engine.has_stored_activity(key)));
}

/// Scenario: a download is cut short or corrupted in transit.
///
/// Expected behaviour: nothing of the ride is stored, no file is kept, the
/// failure is recorded against the Garmin key, and the same id stored from a
/// good download clears it. A pull that finds the key absent asks again.
#[test]
fn a_corrupt_original_stores_nothing_and_is_recorded_as_failed() {
    let (dir, mut engine) = engine();
    let good = outdoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);
    let path = kept_at(&dir, &key);
    let mut corrupt = good.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 0xFF;

    for bad in [corrupt, good[..good.len() / 2].to_vec(), Vec::new()] {
        let error = ingest_into(&mut engine, Some(&path), &listed(GARMIN_ID), &bad).unwrap_err();
        assert!(matches!(error, IngestError::Fit(_)), "{error}");
        assert!(!engine.has_stored_activity(&key));
        assert!(engine.get_activity_body(&key).is_none());
        assert!(engine.get_gps_track(&key).is_none());
        assert!(engine.load_activity_streams(&key).unwrap().is_empty());
        assert!(!path.exists());
        let failure = crate::persistence::activity_sync_failures::of(&engine.db, &key)
            .unwrap()
            .expect("the failure is recorded under the Garmin key");
        assert!(
            failure.message.contains("did not decode"),
            "{}",
            failure.message
        );
    }

    ingest_into(&mut engine, Some(&path), &listed(GARMIN_ID), &good).expect("the retry stores it");
    assert!(engine.has_stored_activity(&key));
    assert!(
        crate::persistence::activity_sync_failures::of(&engine.db, &key)
            .unwrap()
            .is_none(),
        "a clean store clears the failure"
    );
}

/// Scenario: a pull meets an activity it has already stored.
///
/// Expected behaviour: nothing is written a second time, the kept file is not
/// replaced, and the answer says so.
#[test]
fn storing_an_original_twice_changes_nothing() {
    let (dir, mut engine) = engine();
    let fit = outdoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);
    let path = kept_at(&dir, &key);
    ingest_into(&mut engine, Some(&path), &listed(GARMIN_ID), &fit).expect("stored");
    let stored = engine.get_activity_body(&key);

    let mut other = outdoor_ride();
    other.totals.timer_secs = Some(5.0);
    let again = ingest_into(
        &mut engine,
        Some(&path),
        &listed(GARMIN_ID),
        &other.to_fit(),
    )
    .unwrap();

    assert_eq!(again, Ingested::AlreadyStored);
    assert_eq!(engine.get_activity_body(&key), stored);
    assert_eq!(std::fs::read(&path).unwrap(), fit);
}

/// Scenario: the row cannot be stored after the original was written.
///
/// Expected behaviour: the file is taken back out, so a failed ingest keeps
/// neither half.
#[test]
fn a_row_that_fails_to_store_takes_its_file_back_out() {
    let (dir, mut engine) = engine();
    let fit = outdoor_ride().to_fit();
    let key = garmin_source_key(GARMIN_ID);
    let path = kept_at(&dir, &key);
    let mut prepared = prepare(&listed(GARMIN_ID), &fit).unwrap();
    prepared.body.activity_id = "another-key".to_string();

    let outcome = store(&mut engine, &prepared, &fit, Some(&path));

    assert!(
        matches!(outcome, Err(IngestError::Storage(_))),
        "{outcome:?}"
    );
    assert!(!path.exists());
    assert!(!engine.has_stored_activity(&key));
}

/// Scenario: a file whose list entry carries a figure the file lacks.
///
/// Expected behaviour: the list entry fills what the file does not say, the
/// file wins where it does, and a figure neither has is left out of the body
/// rather than written as zero.
#[test]
fn the_list_entry_fills_only_what_the_file_does_not_say() {
    let mut ride = outdoor_ride();
    ride.totals.timer_secs = None;
    ride.totals.ascent = None;
    ride.totals.calories = None;
    let prepared = prepare(&listed(GARMIN_ID), &ride.to_fit()).unwrap();

    let body: serde_json::Value = serde_json::from_str(&prepared.body.raw).unwrap();
    assert_eq!(body["moving_time"], 99);
    assert_eq!(body["elapsed_time"], 30);
    assert!(body.get("total_elevation_gain").is_none());
    assert!(body.get("calories").is_none());
}

fn every_file_under(dir: &std::path::Path, into: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            every_file_under(&path, into);
        } else {
            into.push(path);
        }
    }
}

fn holds(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

/// Scenario: the athlete connects a key, three activities are listed and one
/// original is stored in a library on disk.
///
/// Expected behaviour: neither the key nor the token it was exchanged for is in
/// the database, its `-wal` and `-shm`, or any file beside them, and neither is
/// in the text of a failure.
#[test]
fn neither_the_key_nor_the_token_reaches_a_file_or_a_failure_text() {
    use crate::governor::{Governor, NoopPolicy};
    use crate::net::garmin::GarminClient;
    use base64::Engine as _;
    use httpmock::prelude::*;
    use std::sync::Arc;

    const KEY: &str = "invented-key-7f3a91c2";
    let b64 = |v: serde_json::Value| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
    };
    let exp = (chrono::Utc::now() + chrono::Duration::hours(24)).timestamp();
    let token = format!(
        "{}.{}.invented-sig-5d1e",
        b64(json!({"alg": "RS256"})),
        b64(json!({"exp": exp}))
    );

    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(POST)
            .header("authorization", format!("ApiKey {KEY}"));
        then.status(200).body(&token);
    });
    server.mock(|when, then| {
        when.method(GET).path_includes("/activitylist-service/");
        then.status(200).json_body(json!([
            {"activityId": GARMIN_ID, "startTimeLocal": "2026-03-14 09:00:00",
             "startTimeGMT": "2026-03-14 07:00:00", "activityType": {"typeKey": "cycling"},
             "duration": 99.0, "elapsedDuration": 99.0, "distance": 1.0},
            {"activityId": GARMIN_ID + 1}, {"activityId": GARMIN_ID + 2}
        ]));
    });
    let fit = outdoor_ride().to_fit();
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    std::io::Write::write_all(
        &mut {
            writer
                .start_file("a.fit", zip::write::SimpleFileOptions::default())
                .unwrap();
            &mut writer
        },
        &fit,
    )
    .unwrap();
    let archive = writer.finish().unwrap().into_inner();
    server.mock(|when, then| {
        when.method(GET).path_includes("/download-service/");
        then.status(200).body(archive);
    });

    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let client = GarminClient::with_governor(server.base_url(), KEY, gov);
    let dispatch = crate::governor::Dispatch::from(crate::governor::Lane::Garmin);
    let listed =
        crate::runtime::block_on(client.list_activities("2026-03-01", "2026-03-31", dispatch))
            .unwrap();
    assert_eq!(listed.len(), 3);
    let original = crate::runtime::block_on(client.download_original(GARMIN_ID, dispatch)).unwrap();

    let (dir, mut engine) = engine();
    let key = garmin_source_key(GARMIN_ID);
    ingest_into(
        &mut engine,
        Some(&kept_at(&dir, &key)),
        &listed[0],
        &original,
    )
    .expect("stored");

    let mut files = Vec::new();
    every_file_under(dir.path(), &mut files);
    assert!(files.iter().any(|f| f.ends_with("routes.db")));
    for file in files {
        let bytes = std::fs::read(&file).unwrap();
        assert!(!holds(&bytes, KEY), "key in {file:?}");
        assert!(!holds(&bytes, &token), "token in {file:?}");
    }

    let refused = GarminClient::with_governor(
        server.base_url(),
        "other-invented-key",
        Arc::new(Governor::new(1000, Box::new(NoopPolicy))),
    );
    let err = crate::runtime::block_on(refused.check_key(dispatch)).unwrap_err();
    let text = format!("{err} {err:?}");
    assert!(
        !text.contains("other-invented-key") && !text.contains(&token),
        "{text}"
    );
}
