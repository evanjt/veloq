use super::*;
use crate::governor::NoopPolicy;
use httpmock::prelude::*;
use serde_json::json;
use std::io::Write;

const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
const LIST_PATH: &str = "/activitylist-service/activities/search/activities";
const SETTINGS_PATH: &str = "/userprofile-service/userprofile/settings";

fn token_expiring_in(secs: i64) -> String {
    let b64 = |v: serde_json::Value| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
    };
    let exp = (Utc::now() + Duration::seconds(secs)).timestamp();
    format!(
        "{}.{}.sig",
        b64(json!({"alg": "RS256"})),
        b64(json!({"iat": exp - 86_400, "exp": exp}))
    )
}

fn client(server: &MockServer) -> GarminClient {
    let gov = Arc::new(
        Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(std::time::Duration::ZERO),
    );
    GarminClient::with_governor(server.base_url(), "pasted-key", gov)
}

fn day() -> Duration {
    Duration::hours(24)
}

fn activities(first: i64, n: usize) -> serde_json::Value {
    let rows: Vec<_> = (0..n as i64)
        .map(|i| {
            json!({
                "activityId": first + i,
                "startTimeLocal": "2026-10-20 07:00:00",
                "startTimeGMT": "2026-10-20 05:00:00",
                "activityType": {"typeKey": "cycling"},
                "duration": 3600.5,
                "elapsedDuration": 3700.0,
                "distance": 30000.0,
                "manualActivity": false,
                "unreadField": 1
            })
        })
        .collect();
    json!(rows)
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn the_token_request_carries_the_key_and_a_second_call_reuses_the_token() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    let exchange = server.mock(|when, then| {
        when.method(POST)
            .path(TOKEN_PATH)
            .header("authorization", "ApiKey pasted-key");
        then.status(200)
            .header("content-type", "text/plain")
            .body(&token);
    });
    let list = server.mock(|when, then| {
        when.method(GET)
            .path(LIST_PATH)
            .header("authorization", format!("Bearer {token}"));
        then.status(200).json_body(activities(1, 2));
    });
    let c = client(&server);
    let first = crate::runtime::block_on(c.list_activities("2026-10-01", "2026-10-25", dispatch()))
        .unwrap();
    crate::runtime::block_on(c.list_activities("2026-10-01", "2026-10-25", dispatch())).unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].activity_id, 1);
    assert_eq!(first[0].activity_type.as_ref().unwrap().type_key, "cycling");
    assert_eq!(
        first[0].start_time_gmt.as_deref(),
        Some("2026-10-20 05:00:00")
    );
    assert_eq!(first[0].duration, Some(3600.5));
    exchange.assert_calls(1);
    list.assert_calls(2);
}

#[test]
fn a_token_inside_the_renewal_margin_is_exchanged_again() {
    let server = MockServer::start();
    let near_expiry = token_expiring_in(60);
    let exchange = server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&near_expiry);
    });
    server.mock(|when, then| {
        when.method(GET).path(LIST_PATH);
        then.status(200).json_body(json!([]));
    });
    let c = client(&server);
    crate::runtime::block_on(c.list_activities("2026-10-01", "2026-10-25", dispatch())).unwrap();
    crate::runtime::block_on(c.list_activities("2026-10-01", "2026-10-25", dispatch())).unwrap();
    exchange.assert_calls(2);
}

#[test]
fn a_full_page_asks_for_the_next_and_a_short_one_stops() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    let first = server.mock(|when, then| {
        when.method(GET)
            .path(LIST_PATH)
            .query_param("start", "0")
            .query_param("limit", "99")
            .query_param("startDate", "2026-01-01")
            .query_param("endDate", "2026-10-25");
        then.status(200).json_body(activities(1000, 99));
    });
    let second = server.mock(|when, then| {
        when.method(GET).path(LIST_PATH).query_param("start", "99");
        then.status(200).json_body(activities(2000, 3));
    });
    let third = server.mock(|when, then| {
        when.method(GET).path(LIST_PATH).query_param("start", "102");
        then.status(200).json_body(json!([]));
    });
    let all = crate::runtime::block_on(client(&server).list_activities(
        "2026-01-01",
        "2026-10-25",
        dispatch(),
    ))
    .unwrap();
    assert_eq!(all.len(), 102);
    first.assert_calls(1);
    second.assert_calls(1);
    third.assert_calls(0);
}

#[test]
fn a_page_of_exactly_ninety_nine_is_followed_by_one_more_ask() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    server.mock(|when, then| {
        when.method(GET).path(LIST_PATH).query_param("start", "0");
        then.status(200).json_body(activities(1, 99));
    });
    let empty = server.mock(|when, then| {
        when.method(GET).path(LIST_PATH).query_param("start", "99");
        then.status(200).json_body(json!([]));
    });
    let all = crate::runtime::block_on(client(&server).list_activities(
        "2026-01-01",
        "2026-10-25",
        dispatch(),
    ))
    .unwrap();
    assert_eq!(all.len(), 99);
    empty.assert_calls(1);
}

#[test]
fn a_download_yields_the_fit_inside_the_zip() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    let fit = b"\x0e\x10fit-bytes".to_vec();
    let archive = zip_of(&[("readme.txt", b"x"), ("4242_ACTIVITY.fit", &fit)]);
    let download = server.mock(|when, then| {
        when.method(GET)
            .path("/download-service/files/activity/4242");
        then.status(200).body(archive);
    });
    let got =
        crate::runtime::block_on(client(&server).download_original(4242, dispatch())).unwrap();
    assert_eq!(got, fit);
    download.assert_calls(1);
}

#[test]
fn a_zip_without_a_fit_is_a_decode_error() {
    let err = endpoints::unzip_fit(&zip_of(&[("readme.txt", b"x")])).unwrap_err();
    assert!(matches!(err, NetError::Decode(_)), "{err}");
    assert!(matches!(
        endpoints::unzip_fit(b"not a zip"),
        Err(NetError::Decode(_))
    ));
}

#[test]
fn the_token_endpoint_refusing_the_key_reports_it_rejected_or_malformed() {
    for (status, rejected) in [(401, true), (400, false)] {
        let server = MockServer::start();
        let exchange = server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(status).body("no");
        });
        let err = crate::runtime::block_on(client(&server).check_key(dispatch())).unwrap_err();
        if rejected {
            assert!(matches!(err, GarminError::KeyRejected), "{err}");
        } else {
            assert!(matches!(err, GarminError::KeyMalformed), "{err}");
        }
        exchange.assert_calls(1);
    }
}

#[test]
fn a_401_on_data_after_a_fresh_token_parks_the_key_without_retrying() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    let exchange = server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    let list = server.mock(|when, then| {
        when.method(GET).path(LIST_PATH);
        then.status(401);
    });
    let err = crate::runtime::block_on(client(&server).list_activities(
        "2026-10-01",
        "2026-10-25",
        dispatch(),
    ))
    .unwrap_err();
    assert!(matches!(err, GarminError::KeyRejected), "{err}");
    exchange.assert_calls(1);
    list.assert_calls(1);
}

#[test]
fn a_401_on_a_cached_token_renews_it_once_and_asks_again() {
    let server = MockServer::start();
    let old = token_expiring_in(day().num_seconds());
    let new = token_expiring_in(day().num_seconds() + 7);
    let c = client(&server);
    *c.cached.lock().unwrap() = Some(CachedToken {
        token: old.clone(),
        expires_at: Utc::now() + day(),
    });
    let stale = server.mock(|when, then| {
        when.method(GET)
            .path(LIST_PATH)
            .header("authorization", format!("Bearer {old}"));
        then.status(401);
    });
    let exchange = server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&new);
    });
    let renewed = server.mock(|when, then| {
        when.method(GET)
            .path(LIST_PATH)
            .header("authorization", format!("Bearer {new}"));
        then.status(200).json_body(activities(1, 1));
    });
    let got = crate::runtime::block_on(c.list_activities("2026-10-01", "2026-10-25", dispatch()))
        .unwrap();
    assert_eq!(got.len(), 1);
    stale.assert_calls(1);
    exchange.assert_calls(1);
    renewed.assert_calls(1);
}

#[test]
fn the_client_shares_the_process_governor_in_its_own_lane() {
    let c = GarminClient::new("pasted-key");
    assert!(Arc::ptr_eq(c.governor(), &governor::GOVERNOR));
    assert_eq!(dispatch().lane, Lane::Garmin);
    assert_ne!(dispatch().lane, Lane::Backfill);
}

#[test]
fn neither_the_key_nor_a_token_appears_in_the_debug_text() {
    let c = GarminClient::new("pasted-key");
    *c.cached.lock().unwrap() = Some(CachedToken {
        token: "tok-secret".into(),
        expires_at: Utc::now(),
    });
    let text = format!("{c:?}");
    assert!(
        !text.contains("pasted-key") && !text.contains("tok-secret"),
        "{text}"
    );
}

#[test]
fn a_redirect_answer_is_an_error_and_sends_nothing_to_the_other_host() {
    let origin = MockServer::start();
    let elsewhere = MockServer::start();
    let followed = elsewhere.mock(|when, then| {
        when.any_request();
        then.status(200).body("tok");
    });
    let exchange = origin.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(302)
            .header("location", format!("{}/stolen", elsewhere.base_url()));
    });
    let err = crate::runtime::block_on(client(&origin).exchange(dispatch())).unwrap_err();
    assert!(
        matches!(err, GarminError::Net(NetError::Http { status: 302, .. })),
        "{err}"
    );
    exchange.assert_calls(1);
    followed.assert_calls(0);
}

#[test]
fn a_plain_http_base_is_refused_without_a_request() {
    let server = MockServer::start();
    let any = server.mock(|when, _| {
        when.any_request();
    });
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let c = GarminClient::with_governor_requiring_https(server.base_url(), "pasted-key", gov);
    let err = crate::runtime::block_on(c.exchange(dispatch())).unwrap_err();
    assert!(
        matches!(err, GarminError::Net(NetError::Transport(_))),
        "{err}"
    );
    any.assert_calls(0);
}

#[test]
fn the_production_client_roots_at_garmin_over_https() {
    let c = GarminClient::new("pasted-key");
    assert!(c.base_url.starts_with("https://") && c.https_only);
    assert_eq!(c.base_url, endpoints::BASE_URL);
}

fn refused_download<'a>(
    server: &'a MockServer,
    retry_after: Option<&'a str>,
) -> httpmock::Mock<'a> {
    let token = token_expiring_in(day().num_seconds());
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    server.mock(|when, then| {
        when.method(GET)
            .path("/download-service/files/activity/4242");
        let then = then.status(429);
        if let Some(secs) = retry_after {
            then.header("retry-after", secs);
        }
    })
}

/// Scenario: Garmin answers a download with a 429 that names no `Retry-After`.
///
/// Expected behaviour: the request ends deferred to fifteen minutes on, the
/// retry loop sends nothing more, and the next request waits out the hold
/// without reaching Garmin.
#[test]
fn a_429_without_retry_after_holds_the_lane_fifteen_minutes() {
    let server = MockServer::start();
    let download = refused_download(&server, None);
    let c = client(&server);
    let before = Utc::now();
    let err = crate::runtime::block_on(c.download_original(4242, dispatch())).unwrap_err();
    let GarminError::Net(NetError::Deferred { until }) = err else {
        panic!("{err}");
    };
    let held = until - before;
    assert!(
        held >= Duration::minutes(15) && held < Duration::minutes(16),
        "{held}"
    );
    download.assert_calls(1);

    let err = crate::runtime::block_on(c.download_original(4242, dispatch())).unwrap_err();
    assert!(
        matches!(err, GarminError::Net(NetError::Deferred { until: u }) if u == until),
        "{err}"
    );
    download.assert_calls(1);
}

#[test]
fn a_429_with_retry_after_holds_the_lane_for_it_and_leaves_intervals_alone() {
    let server = MockServer::start();
    refused_download(&server, Some("7"));
    let c = client(&server);
    let before = Utc::now();
    let err = crate::runtime::block_on(c.download_original(4242, dispatch())).unwrap_err();
    let GarminError::Net(NetError::Deferred { until }) = err else {
        panic!("{err}");
    };
    let held = until - before;
    assert!(
        held >= Duration::seconds(7) && held < Duration::seconds(9),
        "{held}"
    );
    assert_eq!(c.governor().cooldown_until(Utc::now()), None);
}

#[test]
fn the_account_settings_are_read_with_the_token_and_name_the_account() {
    let server = MockServer::start();
    let token = token_expiring_in(day().num_seconds());
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(200).body(&token);
    });
    let settings = server.mock(|when, then| {
        when.method(GET)
            .path(SETTINGS_PATH)
            .header("authorization", format!("Bearer {token}"));
        then.status(200)
            .json_body(json!({"displayName": "Invented Athlete", "unitSystem": "metric"}));
    });
    let c = client(&server);
    let name = crate::runtime::block_on(c.display_name(dispatch())).unwrap();
    assert_eq!(name.as_deref(), Some("Invented Athlete"));
    settings.assert_calls(1);
}
