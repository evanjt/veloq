//! A push for a ride intervals.icu will not serve completes it from the
//! athlete's Garmin original before the notification is built.
//!
//! The handler fetches the ride's detail, meets the stub, downloads the
//! original with the athlete's own key, stores it as the linked Garmin row and
//! builds the sentence from that row. Every Garmin failure leaves the push as
//! it was without a key, and nothing is asked of Garmin for a ride
//! intervals.icu serves.

use super::*;
use crate::governor::{Governor, NoopPolicy};
use crate::net::garmin::GarminClient;
use crate::objects::garmin_key::GARMIN_KEY;
use crate::persistence::origin::garmin_source_key;
use crate::test_globals::serial_global_state;
use base64::Engine;
use httpmock::prelude::*;
use serde_json::json;
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

const ATHLETE: &str = "i1";
const TOKEN_SIGNATURE: &str = "c2lnLTlkMWU3YzQ";
const KEY_TEXT: &str = "pasted-garmin-key-4f9c";
const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
const GARMIN_RIDE: i64 = 24_686_966_034;
const NEXT_GARMIN_RIDE: i64 = 24_686_966_035;

/// The process-wide state a test here changes, put back when it ends.
struct Held {
    _library: tempfile::TempDir,
}

impl Drop for Held {
    fn drop(&mut self) {
        GARMIN_KEY.clear();
        crate::net::upload_recording::set_files_root("");
        set_step_limit(None);
        crate::objects::clear_test_credentials();
    }
}

fn library() -> Held {
    let tmp = crate::test_globals::init_global_engine("garmin-push.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_setting(crate::persistence::settings_keys::ATHLETE_ID, ATHLETE)
            .expect("the owner");
        engine
            .set_setting("veloq-notification-preferences", r#"{"enabled":true}"#)
            .expect("the preferences");
        engine
            .set_notification_templates("en-AU", &super::tests::bundle())
            .expect("the strings");
    })
    .expect("the engine");
    crate::objects::clear_test_credentials();
    crate::objects::set_credentials_from_native("api_key", "icu-key", ATHLETE)
        .expect("the credential");
    crate::net::upload_recording::set_files_root(&tmp.path().to_string_lossy());
    GARMIN_KEY.clear();
    Held { _library: tmp }
}

/// A token that expires in 2100, so the same string is issued every time and
/// a test can look for it.
fn token() -> String {
    let b64 = |v: serde_json::Value| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
    };
    format!(
        "{}.{}.{TOKEN_SIGNATURE}",
        b64(json!({"alg": "RS256"})),
        b64(json!({"exp": 4_102_444_800_i64}))
    )
}

fn zip_of(fit: &[u8]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file("ride.fit", zip::write::SimpleFileOptions::default())
        .expect("entry");
    writer.write_all(fit).expect("bytes");
    writer.finish().expect("zip").into_inner()
}

/// The activity as intervals.icu answers for one it holds and will not serve.
fn stub(id: &str, garmin_id: i64) -> String {
    json!({
        "id": id,
        "start_date_local": "2026-03-14T09:00:00",
        "type": "Ride",
        "source": "GARMIN_CONNECT",
        "external_id": garmin_id.to_string(),
        "_note": "not available via the API"
    })
    .to_string()
}

/// The same activity served in full.
fn served(id: &str, garmin_id: i64) -> String {
    json!({
        "id": id,
        "icu_athlete_id": ATHLETE,
        "name": "Morning ride",
        "start_date_local": "2026-03-14T09:00:00",
        "type": "Ride",
        "source": "GARMIN_CONNECT",
        "external_id": garmin_id.to_string(),
        "moving_time": 28,
        "elapsed_time": 30,
        "distance": 171.5,
        "icu_sync_date": "2026-03-14T09:05:00Z",
    })
    .to_string()
}

fn serve_detail<'a>(server: &'a MockServer, id: &str, body: String) -> httpmock::Mock<'a> {
    let path = format!("/activity/{id}");
    server.mock(move |when, then| {
        when.method(GET).path(path);
        then.status(200).body(body);
    })
}

/// No activity here has streams or intervals behind it.
fn serve_nothing_else(server: &MockServer) {
    server.mock(|when, then| {
        when.method(GET)
            .path_matches(r"^/activity/[^/]+/(streams\.json|intervals)$");
        then.status(404);
    });
}

struct GarminServer {
    server: MockServer,
}

impl GarminServer {
    fn start() -> Self {
        Self {
            server: MockServer::start(),
        }
    }

    fn token(&self) -> httpmock::Mock<'_> {
        let token = token();
        self.server.mock(move |when, then| {
            when.method(POST)
                .path(TOKEN_PATH)
                .header("authorization", format!("ApiKey {KEY_TEXT}"));
            then.status(200).body(token);
        })
    }

    fn original(&self, garmin_id: i64) -> httpmock::Mock<'_> {
        let zipped = zip_of(&crate::fit_synthetic::outdoor_ride().to_fit());
        self.server.mock(move |when, then| {
            when.method(GET)
                .path(format!("/download-service/files/activity/{garmin_id}"));
            then.status(200).body(zipped);
        })
    }

    fn anything(&self) -> httpmock::Mock<'_> {
        self.server.mock(|when, then| {
            when.any_request();
            then.status(500);
        })
    }

    /// Hold a client on this server, as the handler's session setup holds the
    /// key the keychain gave it.
    fn hold_key(&self) {
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        GARMIN_KEY.hold(GarminClient::with_governor(
            self.server.base_url(),
            KEY_TEXT,
            governor,
        ));
    }
}

/// One push for `id`, in the library it started in: the sentence, or why there
/// is none.
fn push(id: &str) -> Result<Entry, Quiet> {
    activity_push_run(
        crate::persistence::engine_install(),
        id,
        ATHLETE,
        false,
        false,
    )
    .expect("the push ran")
    .expect("the library was not the one the push started in")
}

fn track_len(key: &str) -> usize {
    crate::persistence::with_persistent_engine(|engine| {
        engine.get_gps_track(key).map_or(0, |t| t.len())
    })
    .expect("the engine")
}

fn body_named(key: &str) -> Option<String> {
    crate::persistence::with_persistent_engine(|engine| engine.get_activity_body(key))
        .expect("the engine")
}

fn claimed_by(intervals_id: &str) -> Option<String> {
    crate::persistence::with_persistent_engine(|engine| {
        engine.activity_id_for_intervals_id(intervals_id)
    })
    .expect("the engine")
}

fn name_of(key: &str) -> Option<String> {
    let raw = body_named(key)?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()?
        .get("name")?
        .as_str()
        .map(str::to_string)
}

/// Scenario: intervals.icu answers the push's fetch with a stub for a Garmin
/// ride, and the athlete's Garmin key is held.
///
/// Expected behaviour: the original is downloaded once, stored as the Garmin
/// row with its track, linked to the intervals.icu id so it is the one row for
/// the ride, and the sentence is built from that row. No second body is kept
/// under the intervals.icu id.
#[test]
fn a_stub_with_a_key_held_is_completed_from_the_original() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    let exchange = garmin.token();
    let download = garmin.original(GARMIN_RIDE);
    garmin.hold_key();

    let run = push("i900");

    let key = garmin_source_key(GARMIN_RIDE);
    exchange.assert_calls(1);
    download.assert_calls(1);
    assert_eq!(track_len(&key), 30, "the original's track is stored");
    assert_eq!(claimed_by("i900").as_deref(), Some(key.as_str()));
    assert_eq!(
        body_named("i900"),
        None,
        "the ride is one row, not the Garmin row and a stub beside it"
    );
    let quiet = run.expect_err("a lone ride has no sentence to announce");
    assert_eq!(
        quiet.outcome,
        PushRunOutcome::NothingWorthPosting,
        "the ladder ran on the stored original and found nothing, not a missing ride"
    );
    assert_eq!(
        quiet.activity_name.as_deref(),
        name_of(&key).as_deref(),
        "the entry names the ride the original made"
    );
    assert!(quiet.activity_name.is_some());
    drop(held);
}

/// Scenario: the same push, and then the files and records the handler leaves
/// behind are read as bytes.
///
/// Expected behaviour: neither the key nor the token is in the database file,
/// its journal, anything kept beside it, or the reason a run records.
#[test]
fn a_push_leaves_neither_the_key_nor_the_token_on_disk() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    garmin.token();
    garmin.original(GARMIN_RIDE);
    garmin.hold_key();
    let issued = token();

    let _ = push("i900");
    runs::record_for(
        crate::persistence::engine_install(),
        "i900",
        PushRunOutcome::Posted,
        None,
    );

    let mut scanned = 0;
    let mut pending = vec![held._library.path().to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(dir).expect("a directory") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let bytes = std::fs::read(&path).expect("a file");
            scanned += 1;
            for secret in [KEY_TEXT, TOKEN_SIGNATURE, issued.as_str()] {
                assert!(
                    !bytes.windows(secret.len()).any(|w| w == secret.as_bytes()),
                    "{} holds a Garmin secret",
                    path.display()
                );
            }
        }
    }
    assert!(scanned > 1, "the database and the kept original were read");
    for recorded in runs::recent() {
        let detail = recorded.detail.unwrap_or_default();
        assert!(!detail.contains(KEY_TEXT), "{detail}");
    }
    drop(held);
}

/// Scenario: a stub arrives and no Garmin key is held.
///
/// Expected behaviour: Garmin is not asked anything, and the push stores the
/// stub as it always did.
#[test]
fn a_stub_with_no_key_held_asks_garmin_nothing() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    let requests = garmin.anything();

    let _ = push("i900");

    requests.assert_calls(0);
    assert!(body_named("i900").is_some(), "the stub is stored as before");
    assert_eq!(track_len(&garmin_source_key(GARMIN_RIDE)), 0);
    drop(held);
}

/// Scenario: intervals.icu serves the ride, and a Garmin key is held.
///
/// Expected behaviour: Garmin is not asked anything.
#[test]
fn a_served_ride_asks_garmin_nothing() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i901", served("i901", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    let requests = garmin.anything();
    garmin.hold_key();

    let _ = push("i901");

    requests.assert_calls(0);
    assert!(body_named("i901").is_some());
    drop(held);
}

/// Scenario: Garmin answers 429 for the original.
///
/// Expected behaviour: the push still ends with the stub stored as without a key,
/// and the ride is left for the next sync.
#[test]
fn a_refused_download_leaves_the_push_as_it_was_without_a_key() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    garmin.token();
    garmin.server.mock(|when, then| {
        when.method(GET)
            .path_matches(r"^/download-service/files/activity/\d+$");
        then.status(429).header("retry-after", "30");
    });
    garmin.hold_key();
    set_step_limit(Some(Duration::from_millis(1500)));

    let run = push("i900");

    assert!(run.is_err(), "no sentence, so the plain entry is posted");
    assert!(body_named("i900").is_some(), "the stub is stored as before");
    assert_eq!(track_len(&garmin_source_key(GARMIN_RIDE)), 0);
    drop(held);
}

/// Scenario: Garmin accepts the request and answers after the step's time.
///
/// Expected behaviour: the push gives up on Garmin at the limit and ends without
/// the original, which Garmin would have delivered had the push waited for it.
#[test]
fn a_slow_download_is_given_up_at_the_limit() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    garmin.token();
    let zipped = zip_of(&crate::fit_synthetic::outdoor_ride().to_fit());
    garmin.server.mock(move |when, then| {
        when.method(GET)
            .path(format!("/download-service/files/activity/{GARMIN_RIDE}"));
        then.status(200).delay(Duration::from_secs(6)).body(zipped);
    });
    garmin.hold_key();
    set_step_limit(Some(Duration::from_millis(800)));

    let run = push("i900");

    assert!(run.is_err());
    assert_eq!(track_len(&garmin_source_key(GARMIN_RIDE)), 0);
    assert!(body_named("i900").is_some());
    drop(held);
}

/// Scenario: two pushes for two Garmin rides, one after the other, on the same
/// held key.
///
/// Expected behaviour: the key is exchanged once and the token is reused.
#[test]
fn a_second_push_reuses_the_token_the_first_one_got() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_detail(&icu, "i901", stub("i901", NEXT_GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    let exchange = garmin.token();
    garmin.original(GARMIN_RIDE);
    garmin.original(NEXT_GARMIN_RIDE);
    garmin.hold_key();

    let _ = push("i900");
    let _ = push("i901");

    exchange.assert_calls(1);
    assert_eq!(track_len(&garmin_source_key(GARMIN_RIDE)), 30);
    assert_eq!(track_len(&garmin_source_key(NEXT_GARMIN_RIDE)), 30);
    drop(held);
}

/// Scenario: the original is already stored and linked to the intervals.icu
/// activity, and a push arrives for it again with intervals.icu still serving a
/// stub. A webhook is delivered more than once, and the sync links before the
/// push lands as often as after it.
///
/// Expected behaviour: Garmin is not asked for the original a second time, the
/// stub does not replace the row's body, and no body is kept under the
/// intervals.icu id.
#[test]
fn a_repeated_stub_push_leaves_the_linked_row_alone() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    garmin.token();
    let download = garmin.original(GARMIN_RIDE);
    garmin.hold_key();
    let _ = push("i900");
    let key = garmin_source_key(GARMIN_RIDE);
    let before = body_named(&key);
    assert_eq!(track_len(&key), 30, "linked by the first push");

    let again = push("i900");

    download.assert_calls(1);
    assert_eq!(body_named(&key), before, "the stub did not replace the row");
    assert_eq!(body_named("i900"), None);
    assert_eq!(track_len(&key), 30);
    let quiet = again.expect_err("no sentence for a lone ride");
    assert_eq!(quiet.outcome, PushRunOutcome::NothingWorthPosting);
    drop(held);
}

/// Scenario: the Garmin row is linked to the intervals.icu activity, and a
/// push arrives for it after intervals.icu has begun serving it.
///
/// Expected behaviour: the served body replaces the row's body, as the sync's
/// copy would, and nothing is stored under the intervals.icu id beside it.
#[test]
fn a_served_push_for_a_linked_row_is_stored_on_that_row() {
    let _guard = serial_global_state();
    let held = library();
    let icu = MockServer::start();
    let _base = crate::objects::sync::test_base_url(icu.base_url());
    let mut detail = serve_detail(&icu, "i900", stub("i900", GARMIN_RIDE));
    serve_nothing_else(&icu);
    let garmin = GarminServer::start();
    garmin.token();
    garmin.original(GARMIN_RIDE);
    garmin.hold_key();
    let _ = push("i900");
    let key = garmin_source_key(GARMIN_RIDE);
    detail.delete();
    serve_detail(&icu, "i900", served("i900", GARMIN_RIDE));

    let _ = push("i900");

    assert_eq!(name_of(&key).as_deref(), Some("Morning ride"));
    assert_eq!(body_named("i900"), None, "no second body under the id");
    assert_eq!(claimed_by("i900").as_deref(), Some(key.as_str()));
    drop(held);
}

/// Scenario: the handler reads the keychain and finds a Garmin key.
///
/// Expected behaviour: it is held for the push; an absent or blank item holds
/// nothing; a key the app already holds is kept, token and all.
#[test]
fn the_session_setup_holds_the_keychains_garmin_key_unless_one_is_held() {
    let _guard = serial_global_state();
    let held = library();

    hold_native_garmin_key(None);
    assert!(GARMIN_KEY.client().is_none());
    hold_native_garmin_key(Some("   "));
    assert!(
        GARMIN_KEY.client().is_none(),
        "a blank item is an absent one"
    );

    hold_native_garmin_key(Some(KEY_TEXT));
    let first = GARMIN_KEY.client().expect("a client");
    hold_native_garmin_key(Some(KEY_TEXT));
    let second = GARMIN_KEY.client().expect("a client");
    assert!(
        Arc::ptr_eq(&first, &second),
        "a held client keeps the token it has"
    );
    drop(held);
}

/// Scenario: the iOS extension hands the key it read from the keychain across
/// the C boundary, as a pointer, or as null when the item was absent.
///
/// Expected behaviour: a key is held for the push; null holds nothing.
#[test]
fn the_c_entry_holds_the_key_it_is_handed() {
    let _guard = serial_global_state();
    let held = library();

    unsafe { super::c::veloq_push_hold_garmin_key(std::ptr::null()) };
    assert!(GARMIN_KEY.client().is_none());

    let key = std::ffi::CString::new(KEY_TEXT).unwrap();
    unsafe { super::c::veloq_push_hold_garmin_key(key.as_ptr()) };
    assert!(GARMIN_KEY.client().is_some());
    drop(held);
}
