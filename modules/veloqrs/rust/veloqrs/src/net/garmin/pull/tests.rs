use super::*;
use crate::governor::{Governor, NoopPolicy};
use crate::{FfiGarminHalt, FfiGarminPullPhase};
use base64::Engine;
use httpmock::prelude::*;
use serde_json::json;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
const LIST_PATH: &str = "/activitylist-service/activities/search/activities";

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn token() -> String {
    let b64 = |v: serde_json::Value| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
    };
    let exp = (Utc::now() + Duration::hours(24)).timestamp();
    format!(
        "{}.{}.sig",
        b64(json!({"alg": "RS256"})),
        b64(json!({"exp": exp}))
    )
}

fn zip_of(bytes: &[u8]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file("ride.fit", zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(bytes).unwrap();
    writer.finish().unwrap().into_inner()
}

fn listing(ids: &[i64]) -> serde_json::Value {
    json!(
        ids.iter()
            .map(|id| json!({
                "activityId": id,
                "startTimeLocal": "2026-10-20 07:00:00",
                "startTimeGMT": "2026-10-20 05:00:00",
                "activityType": {"typeKey": "cycling"}
            }))
            .collect::<Vec<_>>()
    )
}

/// A Garmin that lists and serves what a test arranges.
struct Garmin {
    server: MockServer,
}

impl Garmin {
    fn new() -> Self {
        let server = MockServer::start();
        let token = token();
        server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(200).body(&token);
        });
        Self { server }
    }

    fn lists<'a>(&'a self, from: &'a str, to: &'a str, ids: &[i64]) -> httpmock::Mock<'a> {
        self.server.mock(|when, then| {
            when.method(GET)
                .path(LIST_PATH)
                .query_param("startDate", from)
                .query_param("endDate", to);
            then.status(200).json_body(listing(ids));
        })
    }

    fn serves(&self, id: i64) -> httpmock::Mock<'_> {
        self.server.mock(|when, then| {
            when.method(GET)
                .path(format!("/download-service/files/activity/{id}"));
            then.status(200)
                .body(zip_of(format!("fit-{id}").as_bytes()));
        })
    }

    /// Anything not arranged above lists empty. Created last, so it only
    /// answers what the others do not.
    fn lists_nothing_else(&self) {
        self.server.mock(|when, then| {
            when.method(GET).path(LIST_PATH);
            then.status(200).json_body(json!([]));
        });
    }

    fn client(&self) -> GarminClient {
        self.client_on(
            Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(std::time::Duration::ZERO),
        )
    }

    fn client_on(&self, governor: Governor) -> GarminClient {
        GarminClient::with_governor(self.server.base_url(), "pasted-key", Arc::new(governor))
    }
}

type OnSet = Box<dyn Fn(&str, &str) + Send + Sync>;

#[derive(Default)]
struct MemoryStore {
    settings: Mutex<HashMap<String, String>>,
    held: Mutex<HashSet<i64>>,
    ingested: Mutex<Vec<i64>>,
    on_set: Mutex<Option<OnSet>>,
}

impl MemoryStore {
    fn with_backfill_done() -> Self {
        let store = Self::default();
        store.set_setting(BACKFILL_DONE, "1");
        store
    }

    fn ingested(&self) -> Vec<i64> {
        self.ingested.lock().unwrap().clone()
    }

    fn get(&self, key: &str) -> Option<String> {
        self.setting(key)
    }
}

impl PullStore for MemoryStore {
    fn setting(&self, key: &str) -> Option<String> {
        self.settings.lock().unwrap().get(key).cloned()
    }

    fn set_setting(&self, key: &str, value: &str) {
        self.settings
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        if let Some(hook) = self.on_set.lock().unwrap().as_ref() {
            hook(key, value);
        }
    }

    fn completed(&self, ids: &[i64]) -> HashSet<i64> {
        let held = self.held.lock().unwrap();
        ids.iter().copied().filter(|id| held.contains(id)).collect()
    }

    fn ingest(&self, listed: &ListedActivity, _fit: &[u8]) -> Result<Ingested, IngestError> {
        self.ingested.lock().unwrap().push(listed.activity_id);
        self.held.lock().unwrap().insert(listed.activity_id);
        Ok(Ingested::Stored { tracked: true })
    }
}

fn run(
    garmin: &Garmin,
    store: &MemoryStore,
    today: NaiveDate,
    cancel: &AtomicBool,
) -> Result<(), Halt> {
    crate::runtime::block_on(run_pass(&garmin.client(), store, today, cancel))
}

fn never() -> AtomicBool {
    AtomicBool::new(false)
}

/// Scenario: a sync pulls a ride, and the next sync finds nothing new.
///
/// Expected behaviour: the original is downloaded once, and a second pass over
/// the same days lists them again and downloads nothing.
#[test]
fn a_second_pass_with_nothing_new_downloads_nothing() {
    let garmin = Garmin::new();
    garmin.lists("2026-09-25", "2026-10-25", &[1, 2]);
    garmin.lists("2026-10-23", "2026-10-26", &[1, 2]);
    let first = garmin.serves(1);
    let second = garmin.serves(2);
    let store = MemoryStore::with_backfill_done();

    run(&garmin, &store, day(2026, 10, 25), &never()).unwrap();
    run(&garmin, &store, day(2026, 10, 26), &never()).unwrap();

    assert_eq!(store.ingested(), vec![1, 2]);
    first.assert_calls(1);
    second.assert_calls(1);
}

/// Scenario: a ride finishes at 23:50 local on the 24th, after the pass of
/// that evening listed the day.
///
/// Expected behaviour: the next day's pass lists from two days before the
/// watermark to the local day, so the ride is not missed across midnight UTC.
#[test]
fn a_ride_that_finished_after_the_last_pass_is_found_the_next_day() {
    let garmin = Garmin::new();
    garmin.lists("2026-10-22", "2026-10-25", &[7]);
    let download = garmin.serves(7);
    let store = MemoryStore::with_backfill_done();
    set_date(&store, WATERMARK, day(2026, 10, 24));

    run(&garmin, &store, day(2026, 10, 25), &never()).unwrap();

    download.assert_calls(1);
    assert_eq!(store.ingested(), vec![7]);
    assert_eq!(store.get(WATERMARK).as_deref(), Some("2026-10-25"));
}

/// Scenario: intervals.icu already serves a ride in full, and another is
/// stored from an earlier pull.
///
/// Expected behaviour: neither original is downloaded; the one the device
/// lacks is.
#[test]
fn a_ride_already_complete_locally_is_not_downloaded_again() {
    let garmin = Garmin::new();
    garmin.lists("2026-09-25", "2026-10-25", &[3, 4, 5]);
    let held_a = garmin.serves(3);
    let held_b = garmin.serves(4);
    let owed = garmin.serves(5);
    let store = MemoryStore::with_backfill_done();
    store.held.lock().unwrap().extend([3, 4]);

    run(&garmin, &store, day(2026, 10, 25), &never()).unwrap();

    held_a.assert_calls(0);
    held_b.assert_calls(0);
    owed.assert_calls(1);
    assert_eq!(progress(&store).stored, 1);
}

/// Scenario: the backfill is stopped after two months.
///
/// Expected behaviour: it has checkpointed the second month, a new pass lists
/// the third and no earlier month again, and it ends at the oldest ride.
#[test]
fn a_backfill_killed_after_two_months_resumes_at_the_third() {
    let garmin = Garmin::new();
    garmin.lists("2026-09-25", "2026-10-25", &[]);
    let september = garmin.lists("2026-09-01", "2026-09-24", &[11]);
    let august = garmin.lists("2026-08-01", "2026-08-31", &[12]);
    let july = garmin.lists("2026-07-01", "2026-07-31", &[13]);
    for id in [11, 12, 13] {
        garmin.serves(id);
    }
    garmin.lists_nothing_else();
    let store = Arc::new(MemoryStore::default());
    let cancel = Arc::new(never());
    {
        let (cancel, seen) = (cancel.clone(), Arc::new(Mutex::new(0)));
        *store.on_set.lock().unwrap() = Some(Box::new(move |key, _| {
            if key == CURSOR {
                let mut seen = seen.lock().unwrap();
                *seen += 1;
                // The first checkpoint is the pass's own starting day.
                if *seen == 3 {
                    cancel.store(true, Ordering::SeqCst);
                }
            }
        }));
    }

    let stopped = run(&garmin, &store, day(2026, 10, 25), &cancel);

    assert_eq!(stopped, Err(Halt::Cancelled));
    assert_eq!(store.get(CURSOR).as_deref(), Some("2026-08-01"));
    assert_eq!(store.ingested(), vec![11, 12]);
    july.assert_calls(0);

    cancel.store(false, Ordering::SeqCst);
    *store.on_set.lock().unwrap() = None;
    run(&garmin, &store, day(2026, 10, 25), &cancel).unwrap();

    assert_eq!(store.ingested(), vec![11, 12, 13]);
    september.assert_calls(1);
    august.assert_calls(1);
    july.assert_calls(1);
    let done = progress(store.as_ref());
    assert!(done.backfill_done);
    assert_eq!(done.stored, 3);
}

/// Scenario: the backfill meets a year with no rides.
///
/// Expected behaviour: twelve empty months in a row end it, the rides behind
/// them are not looked for, and a pass after that asks only for the new days.
#[test]
fn the_backfill_ends_after_a_year_with_no_rides() {
    let garmin = Garmin::new();
    garmin.lists_nothing_else();
    let store = MemoryStore::default();

    run(&garmin, &store, day(2026, 10, 25), &never()).unwrap();

    let done = progress(&store);
    assert!(done.backfill_done);
    assert_eq!(done.reached, Some(day(2025, 10, 1)));
    assert_eq!(store.get(EMPTY_MONTHS).as_deref(), Some("12"));
}

/// Scenario: Garmin answers a download with a 429 and `Retry-After`.
///
/// Expected behaviour: the pass ends paused until then without failing, the
/// ride stays owed and the watermark does not move; once the hold lifts the
/// settled run stores the ride.
#[test]
fn a_429_pauses_for_retry_after_and_the_run_continues() {
    let _clock = crate::test_globals::real_clock();
    let garmin = Garmin::new();
    garmin.lists("2026-09-25", "2026-10-25", &[5]);
    let mut refused = garmin.server.mock(|when, then| {
        when.method(GET).path("/download-service/files/activity/5");
        then.status(429).header("retry-after", "1");
    });
    let store = MemoryStore::with_backfill_done();
    let client = garmin.client();
    let before = Utc::now();

    let paused = crate::runtime::block_on(run_pass(&client, &store, day(2026, 10, 25), &never()));

    let Err(Halt::Paused { until }) = paused else {
        panic!("{paused:?}");
    };
    assert!(until - before >= Duration::seconds(1) && until - before < Duration::seconds(3));
    assert!(store.ingested().is_empty());
    assert_eq!(store.get(WATERMARK), None);
    refused.assert_calls(1);

    refused.delete();
    let served = garmin.serves(5);
    let settled =
        crate::runtime::block_on(run_settled(&client, &store, || day(2026, 10, 25), &never()));

    assert_eq!(settled, Ok(()));
    assert_eq!(store.ingested(), vec![5]);
    served.assert_calls(1);
}

/// Scenario: Garmin refuses with a 429 that names no `Retry-After`.
///
/// Expected behaviour: the pass pauses fifteen minutes, and a pass begun
/// inside the hold sends nothing.
#[test]
fn a_429_without_retry_after_pauses_fifteen_minutes_and_sends_nothing_more() {
    let garmin = Garmin::new();
    garmin.lists("2026-09-25", "2026-10-25", &[5, 6]);
    let refused = garmin.server.mock(|when, then| {
        when.method(GET).path("/download-service/files/activity/5");
        then.status(429);
    });
    let other = garmin.serves(6);
    let store = MemoryStore::with_backfill_done();
    let client = garmin.client();
    let before = Utc::now();

    let paused = crate::runtime::block_on(run_pass(&client, &store, day(2026, 10, 25), &never()));

    let Err(Halt::Paused { until }) = paused else {
        panic!("{paused:?}");
    };
    let held = until - before;
    assert!(
        held >= Duration::minutes(15) && held < Duration::minutes(16),
        "{held}"
    );
    refused.assert_calls(1);
    other.assert_calls(0);
    let again = crate::runtime::block_on(run_pass(&client, &store, day(2026, 10, 25), &never()));
    assert_eq!(again, Err(Halt::Paused { until }));
    refused.assert_calls(1);
}

/// Scenario: a history pull of thirty originals.
///
/// Expected behaviour: no two Garmin requests are scheduled less than two
/// seconds apart, the token exchange and the listing included.
#[test]
fn a_history_pull_of_thirty_originals_keeps_two_seconds_between_requests() {
    let _serial = crate::test_globals::serial_global_state();
    let garmin = Garmin::new();
    let ids: Vec<i64> = (100..130).collect();
    garmin.lists("2026-09-25", "2026-10-25", &ids);
    for id in &ids {
        garmin.serves(*id);
    }
    let store = MemoryStore::with_backfill_done();
    let client = garmin.client_on(Governor::new(1000, Box::new(NoopPolicy)));

    crate::runtime::block_on(run_pass(&client, &store, day(2026, 10, 25), &never())).unwrap();

    assert_eq!(store.ingested().len(), 30);
    let slots = client.governor().garmin_slots();
    assert_eq!(slots.len(), 32);
    for pair in slots.windows(2) {
        assert!(
            pair[1] - pair[0] >= crate::governor::GARMIN_MIN_GAP,
            "{:?}",
            pair[1] - pair[0]
        );
    }
}

/// Scenario: Garmin rejects the key.
///
/// Expected behaviour: the pass stops as rejected, stores nothing and moves no
/// checkpoint.
#[test]
fn a_rejected_key_stops_the_pass_without_moving_a_checkpoint() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(POST).path(TOKEN_PATH);
        then.status(401);
    });
    let garmin = Garmin { server };
    let store = MemoryStore::default();

    let ended = run(&garmin, &store, day(2026, 10, 25), &never());

    assert_eq!(ended, Err(Halt::KeyRejected));
    assert_eq!(store.get(WATERMARK), None);
    assert!(store.ingested().is_empty());
}

/// Scenario: five originals in a row fail to download.
///
/// Expected behaviour: the pass stops as unreachable rather than spending the
/// whole library on failures.
#[test]
fn downloads_that_keep_failing_stop_the_pass() {
    let garmin = Garmin::new();
    let ids: Vec<i64> = (1..=8).collect();
    garmin.lists("2026-09-25", "2026-10-25", &ids);
    let failing = garmin.server.mock(|when, then| {
        when.method(GET).path_matches("/download-service/");
        then.status(404);
    });
    let store = MemoryStore::with_backfill_done();

    let ended = run(&garmin, &store, day(2026, 10, 25), &never());

    assert_eq!(ended, Err(Halt::Unreachable));
    failing.assert_calls(5);
    assert_eq!(store.get(WATERMARK), None);
}

/// Scenario: a manual entry has no original to download.
///
/// Expected behaviour: it is skipped without a request.
#[test]
fn a_manual_entry_is_not_downloaded() {
    let garmin = Garmin::new();
    garmin.server.mock(|when, then| {
        when.method(GET).path(LIST_PATH);
        then.status(200).json_body(json!([
            {"activityId": 9, "manualActivity": true},
            {"activityId": 10, "manualActivity": false}
        ]));
    });
    let manual = garmin.serves(9);
    let recorded = garmin.serves(10);
    let store = MemoryStore::with_backfill_done();

    run(&garmin, &store, day(2026, 10, 25), &never()).unwrap();

    manual.assert_calls(0);
    recorded.assert_calls(1);
}

fn body(raw: serde_json::Value) -> String {
    raw.to_string()
}

/// Scenario: the library holds a ride stored from Garmin's original, one
/// intervals.icu serves in full from Garmin, one it holds back as an empty
/// stub, one from another service and a body that is not JSON.
///
/// Expected behaviour: the first two are complete and the rest are not.
#[test]
fn the_library_holds_a_garmin_ride_complete_when_it_is_stored_or_served_in_full() {
    let engine = crate::persistence::PersistentEngine::in_memory().unwrap();
    let insert = |id: &str, raw: String| {
        engine
            .db
            .execute(
                "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 1, ?2)",
                rusqlite::params![id, raw],
            )
            .unwrap();
    };
    insert("src-garmin-101", body(json!({"id": "src-garmin-101"})));
    insert(
        "i2",
        body(json!({"source": "GARMIN_CONNECT", "external_id": "202", "distance": 1.0})),
    );
    insert(
        "i3",
        body(json!({"source": "GARMIN_CONNECT", "external_id": "303"})),
    );
    engine
        .db
        .execute(
            "INSERT INTO activity_held_back (activity_id, source, external_id)
             VALUES ('i3', 'GARMIN_CONNECT', '303')",
            [],
        )
        .unwrap();
    insert(
        "i4",
        body(json!({"source": "STRAVA", "external_id": "404"})),
    );
    insert("i5", "not json".to_string());

    let held = held_garmin_ids(&engine.db).unwrap();

    assert_eq!(held, HashSet::from([101, 202]));
}

fn progress_of(pairs: &[(&str, &str)]) -> Progress {
    let store = MemoryStore::default();
    for (key, value) in pairs {
        store.set_setting(key, value);
    }
    progress(&store)
}

/// Scenario: Garmin asked for a pause and the pass sleeps until it ends.
///
/// Expected behaviour: the report names the pause, the instant it ends, the
/// stored count and the month the history pull has reached.
#[test]
fn a_paused_pass_reports_its_resume_time_and_the_month_reached() {
    let until = Utc::now() + Duration::minutes(15);
    let seen = progress_of(&[(STORED, "42"), (CURSOR, "2025-03-01")]);

    let report = report(&PullState::Paused { until }, &seen);

    assert_eq!(report.phase, FfiGarminPullPhase::Paused);
    assert_eq!(
        report.resume_at,
        Some(crate::WholeNumber(until.timestamp_millis()))
    );
    assert_eq!(report.halt, None);
    assert_eq!(report.stored, 42);
    assert_eq!(report.reached_month.as_deref(), Some("2025-03"));
    assert!(!report.backfill_done);
}

/// Expected behaviour: every terminal state is told apart, with the reason a
/// stopped pass ended on, and a pause carries no stale halt.
#[test]
fn the_report_tells_running_done_and_each_stop_apart() {
    let seen = progress_of(&[(BACKFILL_DONE, "1")]);
    let phase = |state: PullState| report(&state, &seen);

    assert_eq!(phase(PullState::Idle).phase, FfiGarminPullPhase::Idle);
    assert_eq!(phase(PullState::Running).phase, FfiGarminPullPhase::Running);
    assert_eq!(phase(PullState::Done).phase, FfiGarminPullPhase::Done);
    assert!(phase(PullState::Done).backfill_done);
    for (halt, expected) in [
        (Halt::KeyRejected, FfiGarminHalt::KeyRejected),
        (Halt::Unreachable, FfiGarminHalt::Unreachable),
        (Halt::Unstorable, FfiGarminHalt::Unstorable),
    ] {
        let stopped = phase(PullState::Stopped(halt));
        assert_eq!(stopped.phase, FfiGarminPullPhase::Stopped);
        assert_eq!(stopped.halt, Some(expected));
        assert_eq!(stopped.resume_at, None);
    }
    assert_eq!(phase(PullState::Running).reached_month, None);
}

/// Scenario: the athlete taps pull now while a pass sleeps out an hour's hold.
///
/// Expected behaviour: the sleep ends at once and the pass goes on; with no
/// request it would sleep out the hold.
#[test]
fn a_pull_now_request_ends_the_sleep_of_a_paused_pass() {
    let hour = Utc::now() + Duration::hours(1);
    request_resume();
    let started = std::time::Instant::now();

    let resumed = crate::runtime::block_on(wait_out(hour, &never()));

    assert!(resumed);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
}

/// Expected behaviour: only the source intervals.icu names decides whether a
/// webhook's activity came from Garmin.
#[test]
fn a_webhook_activity_is_garmin_by_the_source_its_body_names() {
    assert!(body_is_from_garmin(
        r#"{"id":"i1","source":"GARMIN_CONNECT","external_id":"77"}"#
    ));
    assert!(!body_is_from_garmin(r#"{"id":"i2","source":"STRAVA"}"#));
    assert!(!body_is_from_garmin(r#"{"id":"i3"}"#));
    assert!(!body_is_from_garmin("not json"));
}
