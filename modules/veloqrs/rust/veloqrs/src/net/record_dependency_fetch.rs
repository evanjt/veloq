//! Per-ID activity fetch for record restore dependencies.

use crate::GpsPoint;
use crate::governor::Lane;
use crate::net::endpoints;
use crate::net::transport::{NetError, Transport};
use crate::net::types::ActivityRecord;
use crate::persistence::ElevationSeries;

pub(crate) enum FetchedRecordActivity {
    Found {
        record: Box<ActivityRecord>,
        body: String,
        points: Vec<GpsPoint>,
        /// The series `points` carries its elevation from.
        series: ElevationSeries,
    },
    Missing,
}

/// Fetch the named activity and track without walking a date window.
pub(crate) async fn fetch_one_record_activity(
    transport: &Transport,
    activity_id: &str,
) -> Result<FetchedRecordActivity, NetError> {
    let body = match endpoints::fetch_activity_body(transport, activity_id, Lane::Backfill).await {
        Ok(body) => body,
        Err(NetError::Http { status: 404, .. }) => return Ok(FetchedRecordActivity::Missing),
        Err(error) => return Err(error),
    };
    let record: ActivityRecord = serde_json::from_str(&body)
        .map_err(|e| NetError::Decode(format!("activity {activity_id} detail: {e}")))?;
    if record.id != activity_id {
        return Err(NetError::Decode(format!(
            "activity {activity_id} detail named {}",
            record.id
        )));
    }
    let streams =
        match endpoints::fetch_streams(transport, activity_id, "latlng,altitude", Lane::Backfill)
            .await
        {
            Ok(streams) => streams,
            Err(NetError::Http { status: 404, .. }) => return Ok(FetchedRecordActivity::Missing),
            Err(error) => return Err(error),
        };
    if streams.latlng.is_empty() {
        return Ok(FetchedRecordActivity::Missing);
    }
    let series = ElevationSeries::upstream(streams.altitude_is_fixed);
    let points = streams
        .latlng
        .into_iter()
        .enumerate()
        .map(|(index, [latitude, longitude])| {
            streams
                .altitude
                .get(index)
                .copied()
                .filter(|elevation| elevation.is_finite())
                .map_or_else(
                    || GpsPoint::new(latitude, longitude),
                    |elevation| GpsPoint::with_elevation(latitude, longitude, elevation),
                )
        })
        .collect();
    Ok(FetchedRecordActivity::Found {
        record: Box::new(record),
        body,
        points,
        series,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use httpmock::prelude::*;
    use serde_json::json;

    use crate::governor::{AuthMethod, Governor, NoopPolicy};
    use crate::net::Transport;

    use super::{FetchedRecordActivity, fetch_one_record_activity};

    fn transport(base: String) -> Transport {
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, AuthMethod::ApiKey("test"), governor).unwrap()
    }

    #[test]
    fn test_fetch_one_record_activity_gets_exact_id_and_preserves_track_points() {
        let server = MockServer::start();
        let detail = server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride");
            then.status(200).json_body(json!({
                "id": "old-ride", "type": "Ride", "name": "Old ride",
                "start_date_local": "2024-01-01T10:00:00", "distance": 1000.0
            }));
        });
        let streams = server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride/streams.json");
            then.status(200).json_body(json!([
                {"type": "latlng", "data": [46.1, 46.2, 46.3, 46.4], "data2": [7.1, 7.2, 7.3, 7.4]},
                {"type": "altitude", "data": [400.0, 401.0, 402.0, 403.0]}
            ]));
        });
        let fetched = crate::runtime::block_on(fetch_one_record_activity(
            &transport(server.base_url()),
            "old-ride",
        ))
        .unwrap();
        let FetchedRecordActivity::Found { record, points, .. } = fetched else {
            panic!("activity must be found")
        };
        assert_eq!(record.id, "old-ride");
        assert_eq!(points.len(), 4);
        assert_eq!(points[1].latitude, 46.2);
        assert_eq!(points[1].longitude, 7.2);
        assert_eq!(points[1].elevation, Some(401.0));
        detail.assert_hits(1);
        streams.assert_hits(1);
    }

    #[test]
    fn test_fetch_one_record_activity_404_keeps_record_dormant() {
        let server = MockServer::start();
        let detail = server.mock(|when, then| {
            when.method(GET).path("/activity/old-ride");
            then.status(404);
        });
        let fetched = crate::runtime::block_on(fetch_one_record_activity(
            &transport(server.base_url()),
            "old-ride",
        ))
        .unwrap();
        assert!(matches!(fetched, FetchedRecordActivity::Missing));
        detail.assert_hits(1);
    }
}
