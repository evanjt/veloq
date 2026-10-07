//! Fetch and store the activities restored records name.
//!
//! A restore persists the ids it still needs, and every sync works that list
//! as its own step, so an import made offline, or killed part way, carries on
//! at the next sync. A 404 is final and leaves the list; any other failure
//! keeps the id owed for the next pass.

use crate::net::Transport;
use crate::net::record_dependency_fetch::{FetchedRecordActivity, fetch_one_record_activity};
use crate::net::transport::NetError;
use crate::persistence::PersistentEngine;

use super::observer::{self, Announcement};
use super::sync::{activity_metrics_row, start_date_to_timestamp, still_signed_in};

/// The sync step: fetch every owed activity, then retry the records waiting
/// on them. Any failure but a rejected credential keeps its id owed for the
/// next sync and is not the sync's failure: one old activity the server keeps
/// failing on must not mark every sync after it failed. A 401 is returned, so
/// the sync's credential latch sees it.
pub(crate) async fn fetch_owed_record_activities(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    cancelled: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(u32, u32) + Sync),
) -> Result<(), NetError> {
    let owner = athlete_id.to_string();
    let owed = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        let library_owner = engine
            .get_setting(crate::persistence::settings_keys::ATHLETE_ID)
            .map_err(|e| e.to_string())?;
        // Another athlete's records never spend this athlete's requests.
        if library_owner.is_some_and(|library_owner| library_owner != owner) {
            return Ok(Vec::new());
        }
        engine.owed_record_activities()
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(NetError::Storage)?;
    if owed.is_empty() {
        return Ok(());
    }
    let mut fetched = 0u32;
    let count = u32::try_from(owed.len()).unwrap_or(u32::MAX);
    progress(0, count);
    // A sign-out ends the walk before the next request and before the next
    // store, as it ends every other walk on this athlete's credential. What
    // is still owed stays owed for the next signed-in sync.
    let signed_out = |fetched: u32| {
        if fetched > 0 {
            observer::notify(Announcement::ActivitiesStored);
        }
        Ok(())
    };
    for (index, activity_id) in owed.into_iter().enumerate() {
        if cancelled() {
            break;
        }
        if !still_signed_in(athlete_id) {
            return signed_out(fetched);
        }
        match fetch_one_record_activity(transport, &activity_id).await {
            Ok(FetchedRecordActivity::Missing) => {
                crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
                    engine.mark_record_activity_unavailable(&activity_id)
                })
                .await
                .ok_or(NetError::EngineClosed)?
                .map_err(NetError::Storage)?;
            }
            Ok(found) => {
                if !still_signed_in(athlete_id) {
                    return signed_out(fetched);
                }
                let stored = crate::persistence::with_persistent_engine_blocking_for(
                    install,
                    move |engine| store_record_dependency(engine, found),
                )
                .await
                .ok_or(NetError::EngineClosed)?
                .map_err(NetError::Storage)?;
                if stored {
                    fetched += 1;
                }
            }
            // Not an activity upstream has lost: the credential was refused,
            // and every id after this one would be refused the same way. The
            // sync's step loop confirms it against the profile and parks.
            Err(NetError::Unauthorized) => {
                if fetched > 0 {
                    observer::notify(Announcement::ActivitiesStored);
                }
                return Err(NetError::Unauthorized);
            }
            Err(error) => {
                log::warn!("[Record restore] activity {activity_id} fetch deferred: {error}");
            }
        }
        progress(u32::try_from(index + 1).unwrap_or(u32::MAX), count);
    }
    let restored = crate::persistence::with_persistent_engine_blocking_for(install, |engine| {
        engine.retry_record_restore()
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(NetError::Storage)?;
    if fetched > 0 {
        observer::notify(Announcement::ActivitiesStored);
    }
    if restored.placed > 0 {
        observer::notify(Announcement::DetectionApplied);
    }
    Ok(())
}

/// Store a fetched dependency as an ordinary library activity.
pub(crate) fn store_record_dependency(
    engine: &mut PersistentEngine,
    fetched: FetchedRecordActivity,
) -> Result<bool, String> {
    let FetchedRecordActivity::Found {
        record,
        body,
        points,
        series,
    } = fetched
    else {
        return Ok(false);
    };
    let date = start_date_to_timestamp(record.start_date_local.as_deref())
        .ok_or_else(|| format!("activity {} has no usable start date", record.id))?;
    let sport = record
        .activity_type
        .clone()
        .unwrap_or_else(|| "Ride".to_string());
    let source = crate::persistence::elevation_source_of(&points, series);
    engine
        .add_activity(record.id.clone(), points, sport)
        .map_err(|e| e.to_string())?;
    // The store resets the series to unknown, so it is recorded after.
    engine
        .record_elevation_source(&[(record.id.clone(), source)])
        .map_err(|e| e.to_string())?;
    engine
        .update_activity_metadata(
            &record.id,
            Some(date),
            record.name.as_deref(),
            record.distance,
            record.moving_time,
        )
        .map_err(|e| e.to_string())?;
    engine
        .upsert_activity_bodies(&[(record.id.clone(), date, body)])
        .map_err(|e| e.to_string())?;
    engine
        .set_activity_metrics(vec![activity_metrics_row(*record, date)])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use httpmock::prelude::*;
    use serde_json::json;

    use crate::GpsPoint;
    use crate::governor::{AuthMethod, Governor, NoopPolicy};
    use crate::net::Transport;
    use crate::net::record_dependency_fetch::fetch_one_record_activity;
    use crate::persistence::{PersistentEngine, codec};

    use super::store_record_dependency;

    #[test]
    fn test_store_record_dependency_retries_dormant_pin_from_exact_track() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("record.db").to_str().unwrap()).unwrap();
        let points: Vec<GpsPoint> = (0..80)
            .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.00009, 7.36 + f64::from(i) * 0.00011))
            .collect();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins",
            "values": {"section_id": "foreign-id", "version": 7},
            "ground": {"rep_activity_id": "old-ride", "rep_start_index": 10,
                "rep_end_index": 40, "point_count": 80,
                "polyline_json": serde_json::to_string(&points[10..40]).unwrap()}
        }]});
        let pending = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(pending.missing_activity_ids, ["old-ride"]);
        engine.db.execute("INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters) VALUES ('local-id', 'auto', 'Ride', ?1, 1000)", [serde_json::to_string(&points[10..40]).unwrap()]).unwrap();

        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride");
            then.status(200).json_body(json!({"id": "old-ride", "type": "Ride", "start_date_local": "2024-01-01T10:00:00"}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride/streams.json");
            then.status(200).json_body(json!([{
                "type": "latlng",
                "data": points.iter().map(|p| p.latitude).collect::<Vec<_>>(),
                "data2": points.iter().map(|p| p.longitude).collect::<Vec<_>>()
            }]));
        });
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("test"), governor)
                .unwrap();
        let fetched =
            crate::runtime::block_on(fetch_one_record_activity(&transport, "old-ride")).unwrap();
        store_record_dependency(&mut engine, fetched).unwrap();
        let placed = engine.retry_record_restore().unwrap();
        assert_eq!(placed.placed, 1);
        let blob: Vec<u8> = engine
            .db
            .query_row(
                "SELECT blob FROM section_geometry WHERE section_id='local-id' AND version=7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(blob, codec::encode_polyline(&points[10..40]));
    }

    fn owed_pin(activity_id: &str) -> serde_json::Value {
        json!({"table": "section_pins",
            "values": {"section_id": format!("pin-{activity_id}"), "version": 1},
            "ground": {"rep_activity_id": activity_id, "rep_start_index": 0,
                "rep_end_index": 10, "point_count": 80, "polyline_json": null}})
    }

    fn mock_found<'a>(server: &'a MockServer, id: &str, points: &[GpsPoint]) -> httpmock::Mock<'a> {
        server.mock(|when, then| {
            when.method(GET)
                .path(format!("/activity/{id}/streams.json"));
            then.status(200).json_body(json!([{
                "type": "latlng",
                "data": points.iter().map(|p| p.latitude).collect::<Vec<_>>(),
                "data2": points.iter().map(|p| p.longitude).collect::<Vec<_>>()
            }]));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/activity/{id}"));
            then.status(200).json_body(
                json!({"id": id, "type": "Ride", "start_date_local": "2024-01-01T10:00:00"}),
            );
        })
    }

    #[test]
    fn test_owed_fetch_retries_a_transient_failure_and_never_a_404() {
        let _serial = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("owed.db");
        crate::objects::sync::set_credentials_from_native("api_key", "test", "i1")
            .expect("credential");
        let points: Vec<GpsPoint> = (0..80)
            .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.00009, 7.36 + f64::from(i) * 0.00011))
            .collect();
        let payload = json!({"version": 1, "entries":
            [owed_pin("found-ride"), owed_pin("gone-ride"), owed_pin("flaky-ride")]});
        crate::persistence::with_persistent_engine(|engine| {
            engine.restore_record_json(&payload.to_string()).unwrap();
            assert_eq!(
                engine.owed_record_activities().unwrap(),
                ["flaky-ride", "found-ride", "gone-ride"]
            );
        })
        .unwrap();
        let install = crate::persistence::engine_install();
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));

        let server = MockServer::start();
        mock_found(&server, "found-ride", &points);
        let gone = server.mock(|when, then| {
            when.method(GET).path("/activity/gone-ride");
            then.status(404);
        });
        let mut flaky = server.mock(|when, then| {
            when.method(GET).path("/activity/flaky-ride");
            then.status(500);
        });
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("test"), governor)
                .unwrap();
        let first = crate::runtime::block_on(super::fetch_owed_record_activities(
            install,
            &transport,
            "i1",
            &|| false,
            &|_, _| {},
        ));
        assert!(
            first.is_ok(),
            "one failing activity is not the sync's failure"
        );
        crate::persistence::with_persistent_engine(|engine| {
            assert_eq!(engine.owed_record_activities().unwrap(), ["flaky-ride"]);
            let reasons: Vec<String> = engine
                .unplaced_records()
                .unwrap()
                .into_iter()
                .map(|record| record.reason)
                .collect();
            assert!(reasons.contains(&"activity_unavailable".to_string()));
            assert!(reasons.contains(&"activity_pending".to_string()));
        })
        .unwrap();

        flaky.delete();
        mock_found(&server, "flaky-ride", &points);
        let second = crate::runtime::block_on(super::fetch_owed_record_activities(
            install,
            &transport,
            "i1",
            &|| false,
            &|_, _| {},
        ));
        assert!(second.is_ok());
        gone.assert_hits(1);
        crate::persistence::with_persistent_engine(|engine| {
            assert!(engine.owed_record_activities().unwrap().is_empty());
            assert!(engine.has_activity("flaky-ride"));
            assert!(!engine.has_activity("gone-ride"));
        })
        .unwrap();
        crate::objects::sync::clear_test_credentials();
        // Delivered on the announce thread: drained under the serial lock so
        // the next test's observer does not hear this one's notices.
        crate::objects::observer::flush();
    }

    #[test]
    fn test_owed_fetch_hands_a_rejected_credential_to_the_sync() {
        let _serial = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("owed-401.db");
        crate::objects::sync::set_credentials_from_native("api_key", "test", "i1")
            .expect("credential");
        let payload = json!({"version": 1, "entries": [owed_pin("old-ride")]});
        crate::persistence::with_persistent_engine(|engine| {
            engine.restore_record_json(&payload.to_string()).unwrap();
        })
        .unwrap();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride");
            then.status(401);
        });
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("test"), governor)
                .unwrap();
        let outcome = crate::runtime::block_on(super::fetch_owed_record_activities(
            crate::persistence::engine_install(),
            &transport,
            "i1",
            &|| false,
            &|_, _| {},
        ));
        assert!(matches!(
            outcome,
            Err(crate::net::transport::NetError::Unauthorized)
        ));
        crate::persistence::with_persistent_engine(|engine| {
            assert_eq!(engine.owed_record_activities().unwrap(), ["old-ride"]);
        })
        .unwrap();
        crate::objects::sync::clear_test_credentials();
        crate::objects::observer::flush();
    }

    #[test]
    fn test_missing_record_dependency_leaves_pin_pending() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("missing.db").to_str().unwrap()).unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins",
            "values": {"section_id": "foreign-id", "version": 7},
            "ground": {"rep_activity_id": "missing-ride", "rep_start_index": 0,
                "rep_end_index": 10, "point_count": 20, "polyline_json": null}
        }]});
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .unplaced,
            1
        );
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/missing-ride");
            then.status(404);
        });
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("test"), governor)
                .unwrap();
        let fetched =
            crate::runtime::block_on(fetch_one_record_activity(&transport, "missing-ride"))
                .unwrap();
        assert!(!store_record_dependency(&mut engine, fetched).unwrap());
        let result = engine.retry_record_restore().unwrap();
        assert_eq!(result.unplaced, 1);
        assert_eq!(result.missing_activity_ids, ["missing-ride"]);
    }

    /// Scenario: a restored record needs an activity the library lacks, and
    /// the fetch for it asks for the device altitude series alone.
    ///
    /// Expected behaviour: the stored track says its elevation is the device
    /// series, so a climb ranking does not read it as corrected.
    #[test]
    fn a_stored_dependency_records_the_series_of_its_elevation() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("record.db").to_str().unwrap()).unwrap();
        let record: crate::net::types::ActivityRecord = serde_json::from_value(json!({
            "id": "hill-ride", "type": "Ride", "start_date_local": "2024-01-01T10:00:00"
        }))
        .unwrap();
        let points: Vec<GpsPoint> = (0..20)
            .map(|i| GpsPoint::with_elevation(46.2 + f64::from(i) * 0.0001, 7.36, 600.0))
            .collect();
        let fetched = crate::net::record_dependency_fetch::FetchedRecordActivity::Found {
            record: Box::new(record),
            body: "{}".to_string(),
            points,
            series: crate::persistence::ElevationSeries::Device,
        };

        assert!(store_record_dependency(&mut engine, fetched).unwrap());

        assert_eq!(
            engine.elevation_source_of_track("hill-ride"),
            Some(crate::persistence::ELEVATION_SOURCE_DEVICE)
        );
    }
}
