use std::sync::Mutex;

use super::*;
use crate::net::upload_schedule::schedule_loop;
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};
use tempfile::TempDir;

const ATHLETE: &str = "i1";
const NOW: i64 = 1_700_000_000_000;

/// intervals.icu as a script: each send takes the next answer, and every
/// request is written down so a test can say what was and was not sent.
struct Fake {
    athlete: Mutex<Option<String>>,
    /// Who holds the credential once the post has gone out, for a sign-in
    /// that lands while the request is in flight.
    athlete_after_send: Option<Option<String>>,
    answers: Mutex<Vec<FfiCallOutcome>>,
    rpe_answer: FfiCallKind,
    sent: Mutex<Vec<String>>,
    manual_bodies: Mutex<Vec<ManualActivityBody>>,
    rpe: Mutex<Vec<(String, u32)>>,
    during_send: Option<Box<dyn Fn() + Send + Sync>>,
}

impl Fake {
    fn answering(answers: Vec<FfiCallOutcome>) -> Self {
        Self {
            athlete: Mutex::new(Some(ATHLETE.to_string())),
            athlete_after_send: None,
            answers: Mutex::new(answers.into_iter().rev().collect()),
            rpe_answer: FfiCallKind::Ok,
            sent: Mutex::new(Vec::new()),
            manual_bodies: Mutex::new(Vec::new()),
            rpe: Mutex::new(Vec::new()),
            during_send: None,
        }
    }

    fn sent(&self) -> Vec<String> {
        self.sent.lock().unwrap().clone()
    }

    fn answer(&self, ride: &FfiRecordingEntry) -> FfiCallOutcome {
        self.sent.lock().unwrap().push(ride.id.clone());
        if let Some(during) = &self.during_send {
            during();
        }
        if let Some(after) = &self.athlete_after_send {
            *self.athlete.lock().unwrap() = after.clone();
        }
        self.answers
            .lock()
            .unwrap()
            .pop()
            .expect("a send the script did not expect")
    }
}

impl Uplink for Fake {
    fn signed_in(&self) -> Option<String> {
        self.athlete.lock().unwrap().clone()
    }

    fn send_file(&self, ride: &FfiRecordingEntry) -> FfiCallOutcome {
        self.answer(ride)
    }

    fn send_manual(&self, ride: &FfiRecordingEntry, body: ManualActivityBody) -> FfiCallOutcome {
        self.manual_bodies.lock().unwrap().push(body);
        self.answer(ride)
    }

    fn send_rpe(&self, intervals_id: &str, rpe: u32) -> FfiCallOutcome {
        self.rpe
            .lock()
            .unwrap()
            .push((intervals_id.to_string(), rpe));
        answer(self.rpe_answer, None, None)
    }
}

fn answer(kind: FfiCallKind, id: Option<&str>, status: Option<u16>) -> FfiCallOutcome {
    FfiCallOutcome {
        kind,
        id: id.map(str::to_string),
        status,
        detail: None,
        message: format!("{kind:?}"),
    }
}

fn landed(id: &str) -> FfiCallOutcome {
    answer(FfiCallKind::Ok, Some(id), None)
}

fn http(status: u16, detail: &str) -> FfiCallOutcome {
    FfiCallOutcome {
        detail: Some(detail.to_string()),
        ..answer(FfiCallKind::Http, None, Some(status))
    }
}

/// A pending ride whose FIT is on disk, recorded by the signed-in athlete.
fn ride(dir: &TempDir, id: &str, created_at: i64) -> FfiRecordingEntry {
    let fit = dir.path().join(format!("{id}.fit"));
    std::fs::write(&fit, b"not parsed by the fake").unwrap();
    FfiRecordingEntry {
        id: id.to_string(),
        kind: "fit".to_string(),
        fit_path: format!("file://{}", fit.display()),
        streams_path: None,
        activity_type: "Ride".to_string(),
        name: format!("Ride {id}"),
        start_time: created_at as f64,
        duration_seconds: 3600.0,
        distance_meters: 20_000.0,
        elevation_gain: None,
        avg_heartrate: None,
        paired_event_id: None,
        created_at: created_at as f64,
        upload_status: "pending".to_string(),
        retry_count: 0,
        last_attempt_at: None,
        last_error: None,
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: Some(ATHLETE.to_string()),
        notes: None,
        rpe: None,
        rpe_sent: false,
    }
}

fn insert(entry: &FfiRecordingEntry) {
    with_persistent_engine(|e| e.insert_recording(entry).unwrap()).unwrap();
}

/// The row as the database holds it, read whatever install is open.
fn row(id: &str) -> FfiRecordingEntry {
    with_persistent_engine(|e| e.get_recording(id).unwrap())
        .unwrap()
        .expect("the row")
}

/// Give the ride the provisional activity a save writes, under `key`.
fn with_provisional(mut entry: FfiRecordingEntry, key: &str) -> FfiRecordingEntry {
    let body = crate::FfiActivityBody {
        activity_id: key.to_string(),
        date: 1_700_000_000.0,
        raw: format!(r#"{{"id":"{key}","name":"Ride","type":"Ride","distance":50}}"#),
    };
    with_persistent_engine(|e| {
        e.save_provisional_activity(
            key,
            vec![
                tracematch::GpsPoint::new(46.0, 7.0),
                tracematch::GpsPoint::new(46.001, 7.001),
            ],
            &body,
        )
        .unwrap()
    })
    .unwrap();
    entry.engine_activity_id = Some(key.to_string());
    entry
}

fn intervals_id_of_activity(key: &str) -> Option<String> {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT intervals_id FROM activities WHERE id = ?",
            [key],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap()
    })
    .unwrap()
}

fn now() -> i64 {
    NOW
}

#[test]
fn test_file_upload_name_uses_recording_id() {
    let dir = TempDir::new().unwrap();
    let mut first = ride(&dir, "recording-one", 1_000);
    let mut second = ride(&dir, "recording-two", 2_000);
    first.name = "Canal Loop".into();
    second.name = first.name.clone();

    assert_eq!(file_upload_name(&first), "recording-one.fit");
    assert_eq!(file_upload_name(&second), "recording-two.fit");
}

/// One pass of the schedule worker over the open engine, as the app runs it,
/// with the request faked: the queue says a ride is due, and the worker acts.
fn one_scheduled_pass(uplink: &dyn Uplink) {
    let mut wakes = 0;
    schedule_loop(
        now,
        || {
            crate::objects::error::with_reader(crate::persistence::recordings::pooled::next_due_at)
                .ok()
                .and_then(Result::ok)
                .flatten()
        },
        |_| {
            wakes += 1;
            wakes < 1
        },
        || false,
        || drain(uplink, &now),
    );
}

/// Scenario: a ride is due and the device is online, and nothing on the
/// JavaScript side is running.
/// Expected behaviour: the schedule uploads it itself, the row is `uploaded`
/// with the server's id, and the provisional row has taken that id so the next
/// sync does not store the ride twice.
#[test]
fn a_due_ride_online_is_uploaded_and_its_provisional_row_reconciled() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_due_ride.db");
    insert(&with_provisional(ride(&dir, "r1", 1_000), "local-r1"));
    let fake = Fake::answering(vec![landed("i9")]);

    one_scheduled_pass(&fake);

    assert_eq!(fake.sent(), vec!["r1"]);
    let r1 = row("r1");
    assert_eq!(r1.upload_status, "uploaded");
    assert_eq!(r1.intervals_activity_id.as_deref(), Some("i9"));
    assert!(r1.engine_reconciled, "the provisional row took the id");
    assert_eq!(intervals_id_of_activity("local-r1").as_deref(), Some("i9"));
}

/// Scenario: two rides are due and the grant lacks write permission.
/// Expected behaviour: the first is `permissionBlocked`, the drain stops there
/// and the second is never sent, and the refusal is announced.
#[test]
fn a_403_leaves_the_ride_permission_blocked_and_stops_the_drain() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_403.db");
    insert(&ride(&dir, "r1", 1_000));
    insert(&ride(&dir, "r2", 2_000));
    let fake = Fake::answering(vec![http(403, "forbidden")]);

    one_scheduled_pass(&fake);

    assert_eq!(fake.sent(), vec!["r1"], "the second ride is not sent");
    assert_eq!(row("r1").upload_status, "permissionBlocked");
    assert_eq!(row("r2").upload_status, "pending");
}

/// Scenario: a restore lands while the request is in flight, which moves the
/// engine install on, and the server answers that it took the ride.
/// Expected behaviour: nothing is written: the row stays where the begin left
/// it, with no id, and the provisional row carries none.
#[test]
fn a_ride_whose_install_changed_mid_request_writes_nothing() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_install_moved.db");
    let mut entry = with_provisional(ride(&dir, "r1", 1_000), "local-r1");
    entry.rpe = Some(6);
    insert(&entry);
    let mut fake = Fake::answering(vec![landed("i9")]);
    fake.during_send = Some(Box::new(crate::persistence::invalidate_engine_install));

    let result = upload_ride("r1", false, &fake, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::Uploaded);
    let r1 = row("r1");
    assert_eq!(r1.upload_status, "uploading");
    assert_eq!(r1.intervals_activity_id, None);
    assert!(!r1.engine_reconciled);
    assert!(!r1.rpe_sent);
    assert_eq!(intervals_id_of_activity("local-r1"), None);
}

/// Scenario: each answer the server can give for one ride.
/// Expected behaviour: each lands the ride in the state the queue has always
/// put it in, and answers the outcome the review screen branches on.
#[test]
fn each_answer_moves_the_ride_by_its_own_transition() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_answers.db");
    let cases = [
        (
            answer(FfiCallKind::Unauthorized, None, Some(401)),
            FfiUploadOutcome::AuthExpired,
            "pending",
            0,
        ),
        (
            answer(FfiCallKind::Network, None, None),
            FfiUploadOutcome::Network,
            "pending",
            0,
        ),
        (http(500, "busy"), FfiUploadOutcome::Retriable, "pending", 1),
        (
            answer(FfiCallKind::RateLimited, None, Some(429)),
            FfiUploadOutcome::Retriable,
            "pending",
            1,
        ),
        (
            answer(FfiCallKind::Internal, None, None),
            FfiUploadOutcome::Retriable,
            "pending",
            1,
        ),
        (
            http(400, "bad file"),
            FfiUploadOutcome::Rejected,
            "failed",
            0,
        ),
    ];
    for (i, (reply, outcome, status, retries)) in cases.into_iter().enumerate() {
        let id = format!("r{i}");
        insert(&ride(&dir, &id, 1_000 + i as i64));
        let fake = Fake::answering(vec![reply]);
        let result = upload_ride(&id, false, &fake, &now);
        assert_eq!(result.outcome, outcome, "{id}");
        let now_row = row(&id);
        assert_eq!(now_row.upload_status, status, "{id}");
        assert_eq!(now_row.retry_count, retries, "{id}");
    }
    assert_eq!(
        row("r5").last_error.as_deref(),
        Some("bad file"),
        "the server's own words are kept"
    );
}

/// Scenario: another athlete signs in while the post is in flight, so the
/// engine refuses to send it under their credential.
/// Expected behaviour: the ride is held for its own athlete rather than
/// requeued for the one now signed in.
#[test]
fn a_post_refused_for_another_athlete_holds_the_ride() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_refused_other.db");
    insert(&ride(&dir, "r1", 1_000));
    let mut fake = Fake::answering(vec![answer(FfiCallKind::OtherAthlete, None, None)]);
    fake.athlete_after_send = Some(Some("i2".into()));

    let result = upload_ride("r1", false, &fake, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::OtherAthlete);
    let r1 = row("r1");
    assert_eq!(r1.upload_status, "localOnly");
    assert_eq!(r1.intervals_activity_id, None);
}

/// Scenario: a ride stamped with another athlete, and one with no stamp, are
/// due while this athlete is signed in.
/// Expected behaviour: neither is sent, both are held, and the drain stops.
#[test]
fn another_athletes_ride_is_held_and_never_sent() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_other_athlete.db");
    let mut theirs = ride(&dir, "r1", 1_000);
    theirs.athlete_id = Some("i2".into());
    insert(&theirs);
    let mut nobodys = ride(&dir, "r2", 2_000);
    nobodys.athlete_id = None;
    insert(&nobodys);
    let fake = Fake::answering(vec![]);

    assert_eq!(
        upload_ride("r1", false, &fake, &now).outcome,
        FfiUploadOutcome::OtherAthlete
    );
    drain(&fake, &now);

    assert!(fake.sent().is_empty());
    assert_eq!(row("r1").upload_status, "localOnly");
    assert_eq!(row("r2").upload_status, "localOnly");
}

/// Scenario: a ride whose FIT has gone from the device is due, ahead of one
/// whose file is there.
/// Expected behaviour: the first parks as failed and says why, and the drain
/// goes on to upload the second.
#[test]
fn a_missing_file_parks_the_ride_and_the_drain_goes_on() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_missing.db");
    let mut gone = ride(&dir, "r1", 1_000);
    gone.fit_path = format!("file://{}/nowhere.fit", dir.path().display());
    insert(&gone);
    insert(&ride(&dir, "r2", 2_000));
    let fake = Fake::answering(vec![landed("i9")]);

    drain(&fake, &now);

    assert_eq!(fake.sent(), vec!["r2"]);
    let r1 = row("r1");
    assert_eq!(r1.upload_status, "failed");
    assert_eq!(r1.last_error.as_deref(), Some("FIT file missing on device"));
    assert_eq!(row("r2").upload_status, "uploaded");
}

/// Scenario: a 500 counts an attempt and sets a backoff, and the drain runs
/// again straight after.
/// Expected behaviour: the ride is not due yet, so it is not sent twice.
#[test]
fn a_ride_in_its_backoff_is_not_sent_again_by_the_next_drain() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_backoff.db");
    insert(&ride(&dir, "r1", 1_000));
    let fake = Fake::answering(vec![http(503, "busy")]);

    drain(&fake, &now);
    drain(&fake, &now);

    assert_eq!(fake.sent(), vec!["r1"]);
}

/// Scenario: the athlete taps Upload now on a ride that parked as failed, and
/// again on one already in flight.
/// Expected behaviour: the parked ride is requeued and sent; the one in flight
/// is not sent a second time.
#[test]
fn upload_now_requeues_a_parked_ride_and_leaves_one_in_flight() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_now.db");
    let mut parked = ride(&dir, "r1", 1_000);
    parked.upload_status = "failed".into();
    parked.retry_count = 5;
    insert(&parked);
    let mut sending = ride(&dir, "r2", 2_000);
    sending.upload_status = "uploading".into();
    insert(&sending);
    let fake = Fake::answering(vec![landed("i9")]);

    assert_eq!(
        upload_ride("r1", true, &fake, &now).outcome,
        FfiUploadOutcome::Uploaded
    );
    assert_eq!(
        upload_ride("r2", true, &fake, &now).outcome,
        FfiUploadOutcome::NotStarted
    );

    assert_eq!(fake.sent(), vec!["r1"]);
    assert_eq!(row("r1").upload_status, "uploaded");
    assert_eq!(row("r2").upload_status, "uploading");
}

/// Scenario: an automatic pass meets a ride another run already began.
/// Expected behaviour: it is not sent, and the answer says nothing started.
#[test]
fn a_ride_that_is_not_pending_is_not_sent_by_an_automatic_pass() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_not_pending.db");
    let mut sending = ride(&dir, "r1", 1_000);
    sending.upload_status = "uploading".into();
    insert(&sending);
    let fake = Fake::answering(vec![]);

    let result = upload_ride("r1", false, &fake, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::NotStarted);
    assert!(fake.sent().is_empty());
    assert_eq!(
        upload_ride("nobody", false, &fake, &now).outcome,
        FfiUploadOutcome::NotStarted
    );
}

/// Scenario: a manual entry with its body on disk, and one whose body is gone.
/// Expected behaviour: the first posts the stored body with its times rounded
/// to whole seconds; the second parks as missing with nothing sent.
#[test]
fn a_manual_entry_posts_its_stored_body() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_manual.db");
    let body_path = dir.path().join("m1.json");
    std::fs::write(
        &body_path,
        r#"{"type":"Rowing","name":"Erg","start_date_local":"2026-01-02T07:00:00",
            "elapsed_time":1800.4,"moving_time":1799.6,"distance":6000,"trainer":true}"#,
    )
    .unwrap();
    let mut entry = ride(&dir, "m1", 1_000);
    entry.kind = "manual".into();
    entry.fit_path = String::new();
    entry.streams_path = Some(format!("file://{}", body_path.display()));
    insert(&entry);
    let mut bodiless = entry.clone();
    bodiless.id = "m2".into();
    bodiless.created_at = 2_000.0;
    bodiless.streams_path = Some(format!("{}/gone.json", dir.path().display()));
    insert(&bodiless);
    let fake = Fake::answering(vec![landed("i9")]);

    assert_eq!(
        upload_ride("m1", false, &fake, &now).outcome,
        FfiUploadOutcome::Uploaded
    );
    let missing = upload_ride("m2", false, &fake, &now);

    let posted = fake.manual_bodies.lock().unwrap().clone();
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0].activity_type, "Rowing");
    assert_eq!(posted[0].elapsed_time, 1800);
    assert_eq!(posted[0].moving_time, Some(1800));
    assert!(posted[0].trainer);
    assert!(!posted[0].commute);
    assert_eq!(missing.outcome, FfiUploadOutcome::Missing);
    assert_eq!(row("m2").upload_status, "failed");
    assert_eq!(fake.sent(), vec!["m1"]);
}

/// Scenario: the athlete set an effort, and the upload lands; once with the
/// effort taken, once with the second request refused.
/// Expected behaviour: the effort goes to the activity the upload created, and
/// the ride owes it only while the server has not taken it.
#[test]
fn the_effort_goes_up_after_the_upload_and_is_owed_when_refused() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_rpe.db");
    let mut taken = ride(&dir, "r1", 1_000);
    taken.rpe = Some(7);
    insert(&taken);
    let mut refused = ride(&dir, "r2", 2_000);
    refused.rpe = Some(4);
    insert(&refused);

    let fake = Fake::answering(vec![landed("i9")]);
    upload_ride("r1", false, &fake, &now);
    let mut failing = Fake::answering(vec![landed("i10")]);
    failing.rpe_answer = FfiCallKind::Network;
    upload_ride("r2", false, &failing, &now);

    assert_eq!(*fake.rpe.lock().unwrap(), vec![("i9".to_string(), 7)]);
    assert!(row("r1").rpe_sent);
    assert_eq!(*failing.rpe.lock().unwrap(), vec![("i10".to_string(), 4)]);
    assert!(!row("r2").rpe_sent);
    assert_eq!(row("r2").upload_status, "uploaded");
}

/// Scenario: the schedule's own loop, with nothing due.
/// Expected behaviour: nothing is drained and it rests.
#[test]
fn nothing_due_drains_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("upload_nothing_due.db");
    let fake = Fake::answering(vec![]);
    one_scheduled_pass(&fake);
    assert!(fake.sent().is_empty());
}

/// Scenario: a manual entry stored without the optional fields.
/// Expected behaviour: the request omits each unset field rather than sending
/// a null, and the two flags go up as false.
#[test]
fn a_stored_manual_body_omits_what_it_does_not_say() {
    let stored: StoredManualBody = serde_json::from_str(
        r#"{"type":"Yoga","name":"Evening","start_date_local":"2026-08-05T18:00:00",
            "elapsed_time":1800}"#,
    )
    .unwrap();
    let body = ManualActivityBody::from(stored);
    let json = serde_json::to_value(&body).unwrap();
    assert!(json.get("distance").is_none());
    assert!(json.get("moving_time").is_none());
    assert_eq!(json["type"], "Yoga");
    assert_eq!(json["trainer"], false);
    assert_eq!(json["commute"], false);
}

/// Scenario: saving a ride wakes the schedule, which begins it before the
/// review save asks for it, and the review save then asks.
/// Expected behaviour: the ride is sent once, and the review save waits for
/// that run and answers its outcome rather than saying nothing started.
#[test]
fn a_manual_call_on_a_ride_in_flight_answers_that_runs_outcome() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_join_flight.db");
    insert(&ride(&dir, "r1", 1_000));
    let (sending_tx, sending_rx) = std::sync::mpsc::channel::<()>();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let release_rx = Mutex::new(release_rx);
    let mut fake = Fake::answering(vec![landed("i9")]);
    fake.during_send = Some(Box::new(move || {
        sending_tx.send(()).unwrap();
        release_rx.lock().unwrap().recv().unwrap();
    }));
    let fake = std::sync::Arc::new(fake);

    let scheduled = {
        let fake = fake.clone();
        std::thread::spawn(move || upload_ride("r1", false, &*fake, &now))
    };
    sending_rx.recv().unwrap();
    let asked = {
        let fake = fake.clone();
        std::thread::spawn(move || upload_ride("r1", true, &*fake, &now))
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while in_flight().get("r1").map_or(0, Vec::len) == 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the manual call never joined the run"
        );
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    release_tx.send(()).unwrap();

    assert_eq!(
        scheduled.join().unwrap().outcome,
        FfiUploadOutcome::Uploaded
    );
    assert_eq!(asked.join().unwrap().outcome, FfiUploadOutcome::Uploaded);
    assert_eq!(fake.sent(), vec!["r1"]);
    assert!(in_flight().get("r1").is_none());
}

/// Scenario: the schedule begins a ride before the save has attached its
/// provisional key, and the save attaches it while the request is in flight.
/// Expected behaviour: the landed upload still writes the server's id onto the
/// provisional row.
#[test]
fn a_key_attached_while_the_request_is_in_flight_is_reconciled() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_late_key.db");
    let keyed = with_provisional(ride(&dir, "r1", 1_000), "local-r1");
    let mut unkeyed = keyed.clone();
    unkeyed.engine_activity_id = None;
    insert(&unkeyed);
    let mut fake = Fake::answering(vec![landed("i9")]);
    fake.during_send = Some(Box::new(|| {
        with_persistent_engine(|e| e.set_recording_engine_activity("r1", "local-r1").unwrap());
    }));

    upload_ride("r1", false, &fake, &now);

    assert!(row("r1").engine_reconciled);
    assert_eq!(intervals_id_of_activity("local-r1").as_deref(), Some("i9"));
}

/// Scenario: a ride is due while nobody is signed in.
/// Expected behaviour: there is nobody to hold it from, so it is neither sent
/// nor moved, and waits for its athlete.
#[test]
fn nobody_signed_in_leaves_the_ride_as_it_is() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_nobody.db");
    insert(&ride(&dir, "r1", 1_000));
    let fake = Fake::answering(vec![]);
    *fake.athlete.lock().unwrap() = None;

    let result = upload_ride("r1", false, &fake, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::OtherAthlete);
    assert!(fake.sent().is_empty());
    assert_eq!(row("r1").upload_status, "pending");
}

/// Scenario: a ride lands, with no effort set on the review screen.
/// Expected behaviour: its FIT stays on the device, because a 200 is not a
/// confirmation and the file is the only other copy, and no effort is sent.
#[test]
fn a_landed_upload_keeps_its_file_and_sends_no_effort_it_was_not_given() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_keeps_file.db");
    let entry = ride(&dir, "r1", 1_000);
    insert(&entry);
    let fake = Fake::answering(vec![landed("i9")]);

    upload_ride("r1", false, &fake, &now);

    assert!(fit_on_disk(&entry));
    assert!(fake.rpe.lock().unwrap().is_empty());
    assert!(!row("r1").rpe_sent);
}

/// Scenario: a strength session lands, and a ride lands beside it.
/// Expected behaviour: the session's own FIT is read for its sets under the
/// activity the server created, so it is settled; the ride's is not read, and
/// neither upload fails over it.
#[test]
fn a_strength_session_is_read_for_its_sets_under_the_server_id() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_strength.db");
    let mut session = ride(&dir, "s1", 1_000);
    session.activity_type = "WeightTraining".into();
    std::fs::write(
        crate::net::transport::strip_file_scheme(&session.fit_path),
        crate::fit::recorded_ride_fit(),
    )
    .unwrap();
    insert(&session);
    insert(&ride(&dir, "r1", 2_000));
    let fake = Fake::answering(vec![landed("i9"), landed("i10")]);

    assert_eq!(
        upload_ride("s1", false, &fake, &now).outcome,
        FfiUploadOutcome::Uploaded
    );
    assert_eq!(
        upload_ride("r1", false, &fake, &now).outcome,
        FfiUploadOutcome::Uploaded
    );

    with_persistent_engine(|e| {
        assert!(e.is_fit_processed("i9").unwrap(), "the session is settled");
        assert!(
            !e.is_fit_processed("i10").unwrap(),
            "a ride has no sets to read"
        );
    })
    .unwrap();
}

/// Scenario: the live uplink against a stand-in for intervals.icu, with the
/// review's name, notes, paired workout and effort on the ride.
/// Expected behaviour: the file goes up under the athlete who recorded it with
/// the name, notes and paired workout, then the effort goes to the activity
/// the upload created.
#[test]
fn the_live_uplink_sends_what_the_review_saved() {
    use httpmock::prelude::*;
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_live.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let _creds = crate::objects::test_credentials();
    let posted = server.mock(|when, then| {
        when.method(POST)
            .path("/athlete/1/activities")
            .query_param("external_id", "r1")
            .body_contains("filename=\"r1.fit\"")
            .body_contains("Bern loop")
            .body_contains("legs heavy")
            .body_contains("4321");
        then.status(200)
            .json_body(serde_json::json!({ "id": "i999" }));
    });
    let effort = server.mock(|when, then| {
        when.method(PUT)
            .path("/activity/i999")
            .body_contains("\"icu_rpe\":6");
        then.status(200).json_body(serde_json::json!({}));
    });
    let mut entry = ride(&dir, "r1", 1_000);
    entry.athlete_id = Some("1".into());
    entry.name = "Bern loop".into();
    entry.notes = Some("legs heavy".into());
    entry.paired_event_id = Some(4321.0);
    entry.rpe = Some(6);
    insert(&entry);

    let result = upload_ride("r1", false, &Live, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::Uploaded);
    posted.assert();
    effort.assert();
    let r1 = row("r1");
    assert_eq!(r1.intervals_activity_id.as_deref(), Some("i999"));
    assert!(r1.rpe_sent);
}
