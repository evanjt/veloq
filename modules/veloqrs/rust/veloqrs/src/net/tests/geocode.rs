use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use httpmock::prelude::*;

use super::*;
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};

const ENDPOINT: &str = "https://places.example";

/// A point in one cell, another in the same cell and one a cell away.
const HERE: (f64, f64) = (-37.7701, 145.0102);
const HERE_AGAIN: (f64, f64) = (-37.7702, 145.0099);
const THERE: (f64, f64) = (-37.8101, 144.9602);

fn answer(suburb: &str) -> String {
    format!(r#"{{"address":{{"road":"High Street","suburb":"{suburb}","city":"Melbourne"}}}}"#)
}

/// One request as the stub saw it: what was asked and when it ran.
struct Sent {
    url: String,
    language: String,
    began: Instant,
    ended: Instant,
}

/// What the stub answers a request for a URL with.
type Reply = Box<dyn Fn(&str) -> Result<String, GeocodeError> + Send + Sync>;

/// The provider as a script: every request is written down with when it
/// started and ended, and each takes a while so two in flight would overlap.
struct Stub {
    sent: Mutex<Vec<Sent>>,
    reply: Reply,
}

impl Stub {
    fn answering(
        reply: impl Fn(&str) -> Result<String, GeocodeError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            reply: Box::new(reply),
        }
    }

    fn count(&self) -> usize {
        self.sent.lock().unwrap().len()
    }
}

impl GeocodeTransport for Stub {
    async fn get(&self, url: &str, language: &str) -> Result<String, GeocodeError> {
        let began = Instant::now();
        tokio::time::sleep(Duration::from_millis(150)).await;
        let out = (self.reply)(url);
        self.sent.lock().unwrap().push(Sent {
            url: url.to_string(),
            language: language.to_string(),
            began,
            ended: Instant::now(),
        });
        out
    }
}

fn switch(on: bool) {
    with_persistent_engine(|e| e.set_geocoding_enabled(on).unwrap()).expect("engine");
}

fn lookup<T: GeocodeTransport>(geocoder: &Geocoder<T>, at: (f64, f64)) -> Option<String> {
    crate::runtime::block_on(geocoder.place_name(Some(ENDPOINT), at.0, at.1, "en-AU"))
}

#[test]
fn geocoding_is_off_on_a_fresh_library_and_sends_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_off.db");
    let geocoder = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Northcote"))));

    assert!(!with_persistent_engine(|e| e.geocoding_enabled()).unwrap());
    assert_eq!(lookup(&geocoder, HERE), None);
    assert_eq!(geocoder.transport().count(), 0);

    switch(true);
    switch(false);
    assert_eq!(lookup(&geocoder, HERE), None);
    assert_eq!(geocoder.transport().count(), 0);
}

#[test]
fn with_no_endpoint_nothing_is_sent() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_no_endpoint.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Northcote"))));

    let name = crate::runtime::block_on(geocoder.place_name(None, HERE.0, HERE.1, "en-AU"));

    assert_eq!(name, None);
    assert_eq!(geocoder.transport().count(), 0);
}

#[test]
fn configured_stop_sends_no_point() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_config_stop.db");
    switch(true);
    let geocoder =
        Geocoder::with_transport(Stub::answering(|_| Ok(r#"{"endpoint":null}"#.to_string())));

    let name = crate::runtime::block_on(geocoder.configured_place_name(HERE.0, HERE.1, "en-AU"));

    assert_eq!(name, None);
    let sent = geocoder.transport().sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].url, "https://auth.veloq.fit/geocoder");
}

#[test]
fn configured_endpoint_routes_the_point_to_its_provider() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_config_endpoint.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|url| {
        if url.ends_with("/geocoder") {
            Ok(r#"{"endpoint":"https://places.example"}"#.to_string())
        } else {
            Ok(answer("Northcote"))
        }
    }));

    let name = crate::runtime::block_on(geocoder.configured_place_name(HERE.0, HERE.1, "en-AU"));

    assert_eq!(name.as_deref(), Some("Northcote"));
    let sent = geocoder.transport().sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].url, "https://auth.veloq.fit/geocoder");
    assert!(sent[1].url.starts_with("https://places.example/reverse?"));
}

#[test]
fn failed_config_fetch_on_fresh_engine_sends_no_point() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_config_unreachable.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| {
        Err(GeocodeError::Unreachable("offline".to_string()))
    }));

    let name = crate::runtime::block_on(geocoder.configured_place_name(HERE.0, HERE.1, "en-AU"));

    assert_eq!(name, None);
    assert_eq!(geocoder.transport().count(), 1);
}

#[test]
fn failed_refresh_keeps_the_last_endpoint() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_config_last_good.db");
    switch(true);
    let offline = Arc::new(AtomicBool::new(false));
    let config_offline = Arc::clone(&offline);
    let geocoder = Geocoder::with_transport(Stub::answering(move |url| {
        if url.ends_with("/geocoder") {
            if config_offline.load(Ordering::SeqCst) {
                Err(GeocodeError::Unreachable("offline".to_string()))
            } else {
                Ok(r#"{"endpoint":"https://places.example"}"#.to_string())
            }
        } else {
            Ok(answer("Northcote"))
        }
    }));

    crate::runtime::block_on(geocoder.configured_place_name(HERE.0, HERE.1, "en-AU"));
    crate::runtime::block_on(geocoder.configured_place_name(THERE.0, THERE.1, "en-AU"));
    assert_eq!(geocoder.transport().count(), 3);

    let mut copy = held_config().unwrap();
    copy.fetched_at_ms = 0;
    with_persistent_engine(|engine| {
        engine
            .set_setting(
                settings_keys::GEOCODER_CONFIG,
                &serde_json::to_string(&copy).unwrap(),
            )
            .unwrap();
    });
    offline.store(true, Ordering::SeqCst);

    let name = crate::runtime::block_on(geocoder.configured_place_name(37.3, -122.0, "en-AU"));

    assert_eq!(name.as_deref(), Some("Northcote"));
    let sent = geocoder.transport().sent.lock().unwrap();
    assert_eq!(sent.len(), 5);
    assert_eq!(sent[3].url, "https://auth.veloq.fit/geocoder");
    assert!(sent[4].url.starts_with("https://places.example/reverse?"));
}

#[test]
fn two_cells_asked_together_go_one_at_a_time_a_second_apart() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_paced.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|url| {
        Ok(answer(if url.contains("-37.77") {
            "Northcote"
        } else {
            "Southbank"
        }))
    }));

    let (here, there) = crate::runtime::block_on(async {
        tokio::join!(
            geocoder.place_name(Some(ENDPOINT), HERE.0, HERE.1, "en-AU"),
            geocoder.place_name(Some(ENDPOINT), THERE.0, THERE.1, "en-AU"),
        )
    });

    assert_eq!(here.as_deref(), Some("Northcote"));
    assert_eq!(there.as_deref(), Some("Southbank"));
    let mut sent = std::mem::take(&mut *geocoder.transport().sent.lock().unwrap());
    assert_eq!(sent.len(), 2);
    sent.sort_by_key(|s| s.began);
    assert!(
        sent[1].began >= sent[0].ended + PACE,
        "the second request began {:?} after the first ended",
        sent[1].began.saturating_duration_since(sent[0].ended)
    );
    for s in &sent {
        assert!(
            s.url.starts_with(&format!("{ENDPOINT}/reverse?")),
            "{}",
            s.url
        );
        assert_eq!(s.language, "en-AU");
    }
}

#[test]
fn a_third_lookup_waits_for_the_one_before_it_whichever_geocoder_asks() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_one_pacer.db");
    switch(true);
    let first = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Northcote"))));
    let second = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Southbank"))));

    assert_eq!(lookup(&first, HERE).as_deref(), Some("Northcote"));
    assert_eq!(lookup(&second, THERE).as_deref(), Some("Southbank"));

    let ended = first.transport().sent.lock().unwrap()[0].ended;
    let began = second.transport().sent.lock().unwrap()[0].began;
    assert!(began >= ended + PACE);
}

#[test]
fn a_cell_already_answered_is_never_asked_again() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_cached.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Northcote"))));

    assert_eq!(lookup(&geocoder, HERE).as_deref(), Some("Northcote"));
    assert_eq!(lookup(&geocoder, HERE_AGAIN).as_deref(), Some("Northcote"));
    assert_eq!(geocoder.transport().count(), 1);

    // The cache is the database, not the geocoder: a fresh one after a
    // relaunch asks nothing either.
    let after_relaunch = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Elsewhere"))));
    assert_eq!(lookup(&after_relaunch, HERE).as_deref(), Some("Northcote"));
    assert_eq!(after_relaunch.transport().count(), 0);
}

#[test]
fn an_answer_with_no_place_is_kept_and_not_asked_again() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_no_place.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| {
        Ok(r#"{"error":"Unable to geocode"}"#.to_string())
    }));

    assert_eq!(lookup(&geocoder, HERE), None);
    assert_eq!(lookup(&geocoder, HERE), None);
    assert_eq!(geocoder.transport().count(), 1);
}

#[test]
fn a_failed_request_is_not_kept_so_the_next_lookup_asks_again() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_failed.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| {
        Err(GeocodeError::Rejected {
            status: 404,
            retry_after: None,
        })
    }));

    assert_eq!(lookup(&geocoder, HERE), None);
    assert_eq!(lookup(&geocoder, HERE), None);

    let sent = geocoder.transport().sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert!(sent[1].began >= sent[0].ended + PACE);
}

fn refused_until() -> Option<i64> {
    crate::persistence::read_pool::with_read_conn(|conn| {
        setting_from(conn, settings_keys::GEOCODER_REFUSED_UNTIL)
            .unwrap()
            .and_then(|raw| raw.parse().ok())
    })
    .flatten()
}

#[test]
fn a_refusal_holds_every_lookup_until_its_cool_down_ends() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_refused.db");
    switch(true);
    let refusing = Arc::new(AtomicBool::new(true));
    let still_refusing = Arc::clone(&refusing);
    let geocoder = Geocoder::with_transport(Stub::answering(move |_| {
        if still_refusing.load(Ordering::SeqCst) {
            Err(GeocodeError::Rejected {
                status: 429,
                retry_after: None,
            })
        } else {
            Ok(answer("Northcote"))
        }
    }));
    let at = |point: (f64, f64)| {
        crate::runtime::block_on(geocoder.lookup(Some(ENDPOINT), point.0, point.1, "en-AU"))
    };

    let before = crate::persistence::attempts::now_ms();
    assert_eq!(at(HERE), Lookup::Refused);
    let after = crate::persistence::attempts::now_ms();
    let until = refused_until().expect("a refusal is held");
    let floor = REFUSAL_FLOOR.as_millis() as i64;
    assert!(until >= before + floor && until <= after + floor);

    refusing.store(false, Ordering::SeqCst);
    assert_eq!(at(THERE), Lookup::Refused, "another cell is held too");
    assert_eq!(at(HERE), Lookup::Refused);
    assert_eq!(geocoder.transport().count(), 1);

    with_persistent_engine(|e| {
        e.set_setting(
            settings_keys::GEOCODER_REFUSED_UNTIL,
            &(before - 1).to_string(),
        )
        .unwrap()
    })
    .expect("engine");
    assert_eq!(at(HERE), Lookup::Place("Northcote".to_string()));
    assert_eq!(geocoder.transport().count(), 2);
}

#[test]
fn a_cell_already_answered_is_answered_inside_a_cool_down() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_refused_cached.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|url| {
        if url.contains("-37.77") {
            Ok(answer("Northcote"))
        } else {
            Err(GeocodeError::Rejected {
                status: 503,
                retry_after: None,
            })
        }
    }));

    assert_eq!(lookup(&geocoder, HERE).as_deref(), Some("Northcote"));
    assert_eq!(lookup(&geocoder, THERE), None);
    assert_eq!(lookup(&geocoder, HERE_AGAIN).as_deref(), Some("Northcote"));
    assert_eq!(geocoder.transport().count(), 2);
}

#[test]
fn a_refusal_holds_for_what_the_provider_asked_and_otherwise_for_the_floor() {
    let now = 1_000_000;
    let ms = |d: Duration| d.as_millis() as i64;
    for status in [429, 403, 500, 502, 503, 599] {
        assert_eq!(
            refusal_ends_at(status, None, now),
            Some(now + ms(REFUSAL_FLOOR)),
            "{status}"
        );
        assert_eq!(
            refusal_ends_at(status, Some(Duration::from_secs(120)), now),
            Some(now + 120_000),
            "{status} honours what it asked"
        );
    }
    assert_eq!(
        refusal_ends_at(429, Some(Duration::from_secs(365 * 86_400)), now),
        Some(now + ms(REFUSAL_LONGEST)),
        "no answer holds the geocoder longer than the longest refusal"
    );
    for status in [400, 401, 404, 410, 418] {
        assert_eq!(
            refusal_ends_at(status, None, now),
            None,
            "{status} is an answer"
        );
    }
}

#[test]
fn retry_after_reads_seconds_or_a_date() {
    let now = chrono::DateTime::parse_from_rfc2822("Sat, 10 Oct 2026 10:00:00 GMT")
        .unwrap()
        .timestamp_millis();
    assert_eq!(retry_after_of("120", now), Some(Duration::from_secs(120)));
    assert_eq!(retry_after_of(" 0 ", now), Some(Duration::ZERO));
    assert_eq!(
        retry_after_of("Sat, 10 Oct 2026 10:05:00 GMT", now),
        Some(Duration::from_secs(300))
    );
    assert_eq!(
        retry_after_of("Sat, 10 Oct 2026 09:55:00 GMT", now),
        Some(Duration::ZERO),
        "a date already past asks for no wait"
    );
    assert_eq!(retry_after_of("soon", now), None);
    assert_eq!(retry_after_of("-5", now), None);
}

#[test]
fn a_refusal_over_http_carries_its_retry_after() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_retry_after.db");
    let host = MockServer::start();
    host.mock(|when, then| {
        when.method(GET).path("/reverse");
        then.status(429).header("retry-after", "90");
    });
    let transport = HttpTransport::new().expect("client");

    let reply = crate::runtime::block_on(transport.get(
        &format!("{}/reverse?format=jsonv2", host.base_url()),
        "en-AU",
    ));

    match reply {
        Err(GeocodeError::Rejected {
            status: 429,
            retry_after,
        }) => assert_eq!(retry_after, Some(Duration::from_secs(90))),
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_point_sent_is_the_cell_centre_not_the_ride() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_centre.db");
    switch(true);
    let geocoder = Geocoder::with_transport(Stub::answering(|_| Ok(answer("Northcote"))));

    lookup(&geocoder, HERE);

    let url = geocoder.transport().sent.lock().unwrap()[0].url.clone();
    assert!(url.contains("lat=-37.770&"), "{url}");
    assert!(url.contains("lon=145.010&"), "{url}");
}

fn enabled_at() -> Option<i64> {
    with_persistent_engine(|e| e.geocoding_enabled_at())
        .expect("engine")
        .expect("read")
}

#[test]
fn turning_it_on_stamps_the_moment_and_staying_on_keeps_it() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_stamp.db");

    assert_eq!(enabled_at(), None);

    let before = crate::persistence::attempts::now_ms();
    switch(true);
    let first = enabled_at().expect("turning it on stamps the moment");
    assert!(first >= before);

    std::thread::sleep(Duration::from_millis(5));
    switch(true);
    assert_eq!(enabled_at(), Some(first));

    switch(false);
    std::thread::sleep(Duration::from_millis(5));
    switch(true);
    let again = enabled_at().expect("stamped");
    assert!(again > first, "turning it back on moves the stamp");
}

#[test]
fn the_name_is_the_locality_the_address_carries() {
    let cases = [
        (
            r#"{"address":{"suburb":"Northcote","city":"Melbourne"}}"#,
            Some("Northcote"),
        ),
        (
            r#"{"address":{"village":"Zermatt","county":"Visp"}}"#,
            Some("Zermatt"),
        ),
        (
            r#"{"address":{"town":"Bright","state":"Victoria"}}"#,
            Some("Bright"),
        ),
        (
            r#"{"address":{"hamlet":"Tawonga South","municipality":"Alpine"}}"#,
            Some("Tawonga South"),
        ),
        (
            r#"{"address":{"road":"Great Alpine Road","county":"Alpine Shire"}}"#,
            Some("Alpine Shire"),
        ),
        (
            r#"{"address":{"suburb":"  ","city":"Melbourne"}}"#,
            Some("Melbourne"),
        ),
        (r#"{"address":{"road":"Great Alpine Road"}}"#, None),
        (r#"{"error":"Unable to geocode"}"#, None),
    ];
    for (body, expected) in cases {
        assert_eq!(locality_of(body).as_deref(), expected, "{body}");
    }
    assert!(locality_of("not json").is_none());
}

#[test]
fn every_request_names_the_app_and_the_language() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("geocode_user_agent.db");
    switch(true);
    let host = MockServer::start();
    let named = host.mock(|when, then| {
        when.method(GET)
            .path("/reverse")
            .header("user-agent", USER_AGENT)
            .header("accept-language", "fr-CH")
            .query_param("format", "jsonv2");
        then.status(200).body(answer("Plainpalais"));
    });
    let geocoder = Geocoder::new().expect("client");

    let name = crate::runtime::block_on(geocoder.place_name(
        Some(&host.base_url()),
        46.1975,
        6.1420,
        "fr-CH",
    ));

    assert_eq!(name.as_deref(), Some("Plainpalais"));
    named.assert_calls(1);
    assert!(USER_AGENT.starts_with("veloq/"));
    assert!(USER_AGENT.contains("https://veloq.fit"));
}
