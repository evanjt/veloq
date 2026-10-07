//! The C entry points the iOS notification service extension calls, through
//! the symbols it links.
//!
//! iOS has no JNI, so the extension is a second process reaching the crate
//! through plain C symbols in the static library: the twin of `push/jni.rs` and
//! the same shape as `basemap/c.rs`. These tests call them by that name, the
//! way `NotificationService.swift` does, so a rename on either side fails here
//! rather than at link time on a Mac nobody is watching.
//!
//! The engine is process-wide and `prepare` opens it once: a second call with
//! another path is a no-op by design, since a push can land on a warm process.
//! So exactly one test here opens one, and the rest are refusals that never
//! reach it.
//!
//! What no test here can do is take a sentence across the boundary. The one
//! entry that answers with one fetches the ride's detail body first, so every
//! non-null answer needs a network round trip. The ladder and the templates
//! are covered on the host in `push::tests`; what is covered here is the
//! marshalling and the contracts either side of it.
//!
//! Run: `cargo test -p veloqrs --test push_service_extension`

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use tempfile::TempDir;
use veloqrs::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES;
use veloqrs::push::native_auth_choice;
use veloqrs::sections::CreateSectionParams;
use veloqrs::{ActivityMetrics, Direction, GpsPoint, PersistentEngine, SectionPortion};

unsafe extern "C" {
    fn veloq_push_prepare(
        db_path: *const c_char,
        access_token: *const c_char,
        api_key: *const c_char,
        athlete_id: *const c_char,
        refusal: *mut *mut c_char,
    ) -> bool;
    fn veloq_push_activity(activity_id: *const c_char, athlete_id: *const c_char) -> *mut c_char;
    fn veloq_push_string_free(text: *mut c_char);
    fn veloq_push_payload_reason(
        top_level_keys: *const c_char,
        body_keys: *const c_char,
    ) -> *mut c_char;
}

/// Hold the `CString`s alive for the length of the call, the way the Swift
/// side holds its own buffers.
fn prepare(
    db_path: &str,
    access_token: Option<&str>,
    api_key: Option<&str>,
    athlete: Option<&str>,
) -> bool {
    let db = CString::new(db_path).unwrap();
    let token = access_token.map(|s| CString::new(s).unwrap());
    let key = api_key.map(|s| CString::new(s).unwrap());
    let athlete = athlete.map(|s| CString::new(s).unwrap());
    let ptr = |s: &Option<CString>| s.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    unsafe {
        veloq_push_prepare(
            db.as_ptr(),
            ptr(&token),
            ptr(&key),
            ptr(&athlete),
            std::ptr::null_mut(),
        )
    }
}

/// `prepare` with the refusal's sentence taken back, as the extension does.
fn prepare_refusal(db_path: &str) -> Option<String> {
    let db = CString::new(db_path).unwrap();
    let mut refusal: *mut c_char = std::ptr::null_mut();
    let ok = unsafe {
        veloq_push_prepare(
            db.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            &mut refusal,
        )
    };
    assert!(!ok);
    take(refusal)
}

/// Take a string the crate handed out and give it straight back, which is
/// what the extension does with it.
fn take(answer: *mut c_char) -> Option<String> {
    if answer.is_null() {
        return None;
    }
    let owned = unsafe { CStr::from_ptr(answer) }
        .to_string_lossy()
        .into_owned();
    unsafe { veloq_push_string_free(answer) };
    Some(owned)
}

fn activity_push(activity_id: &str) -> Option<String> {
    let id = CString::new(activity_id).unwrap();
    let athlete = CString::new("i1").unwrap();
    take(unsafe { veloq_push_activity(id.as_ptr(), athlete.as_ptr()) })
}

/// Scenario: a ride is uploaded and the extension asks for the push, on an
/// athlete who has notifications switched off.
///
/// Expected behaviour: the engine opens at the App Group path it was given,
/// and the answer is nothing to post, reached without a network round trip
/// because the composed entry reads the gate before it fetches anything. This
/// is the only test here that opens an engine, because the process only gets
/// one.
#[test]
fn a_push_for_an_athlete_with_notifications_off_answers_nothing() {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    seed_a_section_pr(
        db.to_str().unwrap(),
        r#"{"enabled":false,"categories":{"sectionPr":true}}"#,
    );

    assert!(prepare(
        db.to_str().unwrap(),
        None,
        Some("a-key"),
        Some("i1")
    ));
    assert!(db.exists(), "the file the extension named");

    assert_eq!(activity_push("a1"), None);
}

/// A null id is a push whose payload the extension could not read, and the
/// answer is the same nothing rather than a panic across the boundary.
#[test]
fn an_activity_push_with_no_id_is_null() {
    assert_eq!(
        take(unsafe { veloq_push_activity(std::ptr::null(), std::ptr::null()) }),
        None
    );
}

/// Scenario: the phone has been rebooted and not unlocked, so
/// `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` has no key in memory and every
/// keychain read comes back empty. The extension posts the notification it was
/// given there rather than failing silently.
///
/// Expected behaviour: `prepare` refuses, and refuses before it opens
/// anything: a handler with no credential has nothing to fetch with, and the
/// database file is the proof nothing was done.
#[test]
fn a_handler_whose_keychain_would_not_answer_is_refused_before_anything_opens() {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let path = db.to_str().unwrap();

    assert!(!prepare(path, None, None, Some("i1")), "no secret");
    assert!(!prepare(path, Some("t"), None, None), "no athlete");
    assert!(
        !prepare(path, Some(""), Some(""), Some("i1")),
        "blank items"
    );
    assert!(!prepare(path, None, None, None), "nothing at all");
    assert!(!db.exists());
}

/// The choice between the two credentials is the crate's, not Swift's: the
/// extension reads three keychain items and cannot tell which session they
/// belong to. `AuthStore` hydrates OAuth first and falls back to the API key,
/// and a handler that picked the other way would sync as the wrong athlete.
#[test]
fn the_handler_picks_the_credential_the_auth_store_would() {
    assert_eq!(
        native_auth_choice(Some("token"), Some("key"), Some("i1")),
        Some(("oauth", "token", "i1"))
    );
    assert_eq!(
        native_auth_choice(None, Some("key"), Some("i1")),
        Some(("api_key", "key", "i1"))
    );
    assert_eq!(
        native_auth_choice(Some("  "), Some("key"), Some("i1")),
        Some(("api_key", "key", "i1")),
        "a blank item is an absent one"
    );
    assert_eq!(native_auth_choice(Some("token"), None, None), None);
    assert_eq!(native_auth_choice(None, None, Some("i1")), None);
}

/// Every string that crosses the boundary comes back, and the case the
/// extension hits most is the one where there was nothing to give back.
#[test]
fn freeing_a_null_answer_is_a_no_op() {
    unsafe { veloq_push_string_free(std::ptr::null_mut()) };
}

/// One ride over one section it holds the record on, with the string bundle
/// pushed and notifications on, so the only thing between the extension and a
/// sentence is the boundary under test.
///
/// The same rows as the fixture in `push::tests`, written through the public
/// engine rather than through SQL, since an integration test has no reach into
/// the connection.
fn seed_a_section_pr(db_path: &str, preferences: &str) {
    let mut engine = PersistentEngine::new(db_path).expect("the engine");
    engine
        .set_notification_templates("en-AU", &bundle())
        .expect("the templates");
    engine
        .set_setting(NOTIFICATION_PREFERENCES, preferences)
        .expect("the preferences");

    let coords: Vec<GpsPoint> = (0..8)
        .map(|i| GpsPoint {
            latitude: 46.2 + f64::from(i) * 0.001,
            longitude: 7.3,
            elevation: None,
        })
        .collect();
    engine
        .add_activity("a1".to_string(), coords.clone(), "Ride".to_string())
        .expect("the activity");
    engine
        .set_activity_metrics(vec![ActivityMetrics {
            activity_id: "a1".to_string(),
            name: "Morning Ride".to_string(),
            date: 1_700_000_000,
            distance: 400.0,
            moving_time: 8,
            elapsed_time: 8,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }])
        .expect("the metrics");
    engine.set_time_streams_flat(&["a1".to_string()], &(0..8).collect::<Vec<u32>>(), &[0]);

    let section = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: coords,
            distance_meters: 400.0,
            name: Some("Climb 1".to_string()),
            source_activity_id: Some("a1".to_string()),
            start_index: Some(1),
            end_index: Some(5),
        })
        .expect("the section");
    engine
        .add_section_activity_with_portion(
            &section,
            &SectionPortion {
                activity_id: "a1".to_string(),
                start_index: 1,
                end_index: 5,
                distance_meters: 400.0,
                direction: Direction::Same,
            },
            None,
            None,
        )
        .expect("the lap");
}

/// The fifteen keys the push site resolves, as the engine stores them.
fn bundle() -> Vec<(String, String)> {
    [
        ("notifications.activityPr.title", "New PR"),
        ("notifications.activityFaster.title", "Faster Than Usual"),
        ("notifications.activityRecorded.title", "Activity Recorded"),
        ("notifications.activityBody.aSection", "a section"),
        ("notifications.activityBody.routePr", "Route PR on {{name}}"),
        (
            "notifications.activityBody.routePrDelta",
            "Route PR on {{name}} ({{delta}} faster)",
        ),
        ("notifications.activityBody.routePrUnnamed", "Route PR"),
        (
            "notifications.activityBody.routePrUnnamedDelta",
            "Route PR ({{delta}} faster)",
        ),
        ("notifications.activityBody.sectionPr", "PR on {{name}}"),
        (
            "notifications.activityBody.sectionPrDelta",
            "PR on {{name}} ({{delta}} faster)",
        ),
        (
            "notifications.activityBody.sectionPrCount",
            "PR on {{count}} sections",
        ),
        (
            "notifications.activityBody.sectionPrMany",
            "PR on {{name}} and {{count}} more",
        ),
        (
            "notifications.activityBody.sectionPrManyOne",
            "PR on {{name}} and one more",
        ),
        (
            "notifications.activityBody.fasterOnRoute",
            "Faster than usual on {{name}}",
        ),
        (
            "notifications.activityBody.fasterOnRouteDelta",
            "Faster than usual on {{name}} ({{delta}} off PR)",
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn payload_reason(top: &str, body: Option<&str>) -> String {
    let top = CString::new(top).unwrap();
    let body = body.map(|b| CString::new(b).unwrap());
    take(unsafe {
        veloq_push_payload_reason(
            top.as_ptr(),
            body.as_ref().map_or(std::ptr::null(), |b| b.as_ptr()),
        )
    })
    .expect("a reason")
}

/// The reason for an unrecognised payload names its shape from key names and
/// carries no value: the reason is stored and shown, and a payload can hold a
/// credential.
#[test]
fn the_payload_reason_keeps_key_names_and_no_values() {
    assert_eq!(
        payload_reason("body\naps", Some("event_type\nactivity_id")),
        "payload not recognised: keys=[aps,body] body=[activity_id,event_type]"
    );
    assert_eq!(
        payload_reason("aps", None),
        "payload not recognised: keys=[aps]"
    );
    // A secret sits in a value, which never crosses; a key that is itself long
    // is cut rather than stored whole.
    let long = "k".repeat(100);
    let reason = payload_reason(&long, Some(""));
    assert!(reason.contains(&"k".repeat(32)) && !reason.contains(&"k".repeat(33)));
}

/// A refused prepare hands its sentence across, so the run it is recorded
/// under says why rather than only that.
#[test]
fn a_refused_prepare_hands_its_reason_across() {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let reason = prepare_refusal(db.to_str().unwrap()).expect("a reason");
    assert!(reason.contains("keychain held no credential"), "{reason}");
}
