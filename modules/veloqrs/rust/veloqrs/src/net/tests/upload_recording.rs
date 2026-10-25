use std::collections::HashMap;
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
    /// Each send's answer, and the id of the activity the server created for
    /// it whatever the answer said, `None` when it created nothing.
    answers: Mutex<Vec<(FfiCallOutcome, Option<String>)>>,
    /// The activities intervals.icu holds, as the duplicate check lists them.
    server: Mutex<Vec<ListedActivity>>,
    /// Whether a manual create keeps the external id it was sent.
    keeps_external_id: bool,
    /// What looking for a landed activity answers instead of the server's
    /// list, for a look that fails.
    find_answer: Option<FfiCallOutcome>,
    looked: Mutex<Vec<String>>,
    rpe_answer: FfiCallKind,
    sent: Mutex<Vec<String>>,
    /// The external id each file send carried.
    external_ids: Mutex<Vec<String>>,
    /// The FIT path each file send was handed.
    sent_paths: Mutex<Vec<String>>,
    manual_bodies: Mutex<Vec<ManualActivityBody>>,
    rpe: Mutex<Vec<(String, u32)>>,
    during_send: Option<Box<dyn Fn() + Send + Sync>>,
    /// What reading each activity back answers, by intervals id. An id with
    /// no answer reads as a request that never arrived.
    read_back: Mutex<HashMap<String, FfiCallOutcome>>,
    read: Mutex<Vec<String>>,
    during_read_back: Option<Box<dyn Fn() + Send + Sync>>,
}

impl Fake {
    fn answering(answers: Vec<FfiCallOutcome>) -> Self {
        Self::scripted(
            answers
                .into_iter()
                .map(|reply| {
                    let created = (reply.kind == FfiCallKind::Ok)
                        .then(|| reply.id.clone())
                        .flatten();
                    (reply, created)
                })
                .collect(),
        )
    }

    /// Each send answers its reply, and the server creates the activity named
    /// beside it whatever the reply says.
    fn scripted(answers: Vec<(FfiCallOutcome, Option<String>)>) -> Self {
        Self {
            athlete: Mutex::new(Some(ATHLETE.to_string())),
            athlete_after_send: None,
            answers: Mutex::new(answers.into_iter().rev().collect()),
            server: Mutex::new(Vec::new()),
            keeps_external_id: true,
            find_answer: None,
            looked: Mutex::new(Vec::new()),
            rpe_answer: FfiCallKind::Ok,
            sent: Mutex::new(Vec::new()),
            external_ids: Mutex::new(Vec::new()),
            sent_paths: Mutex::new(Vec::new()),
            manual_bodies: Mutex::new(Vec::new()),
            rpe: Mutex::new(Vec::new()),
            during_send: None,
            read_back: Mutex::new(HashMap::new()),
            read: Mutex::new(Vec::new()),
            during_read_back: None,
        }
    }

    /// Script what reading `intervals_id` back answers.
    fn reads(self, intervals_id: &str, answer: FfiCallOutcome) -> Self {
        self.read_back
            .lock()
            .unwrap()
            .insert(intervals_id.to_string(), answer);
        self
    }

    fn read(&self) -> Vec<String> {
        self.read.lock().unwrap().clone()
    }

    fn sent(&self) -> Vec<String> {
        self.sent.lock().unwrap().clone()
    }

    fn answer(&self, ride: &FfiRecordingEntry, created: ListedActivity) -> FfiCallOutcome {
        self.sent.lock().unwrap().push(ride.id.clone());
        if let Some(during) = &self.during_send {
            during();
        }
        if let Some(after) = &self.athlete_after_send {
            *self.athlete.lock().unwrap() = after.clone();
        }
        let (reply, created_id) = self
            .answers
            .lock()
            .unwrap()
            .pop()
            .expect("a send the script did not expect");
        if let Some(id) = created_id {
            self.server
                .lock()
                .unwrap()
                .push(ListedActivity { id, ..created });
        }
        reply
    }

    /// The activities the server holds, by id.
    fn created(&self) -> Vec<String> {
        self.server
            .lock()
            .unwrap()
            .iter()
            .map(|a| a.id.clone())
            .collect()
    }

    fn looked(&self) -> Vec<String> {
        self.looked.lock().unwrap().clone()
    }
}

impl Uplink for Fake {
    fn signed_in(&self) -> Option<String> {
        self.athlete.lock().unwrap().clone()
    }

    fn send_file(&self, ride: &FfiRecordingEntry) -> FfiCallOutcome {
        self.sent_paths.lock().unwrap().push(ride.fit_path.clone());
        self.external_ids.lock().unwrap().push(external_id_of(ride));
        let created = ListedActivity {
            external_id: Some(external_id_of(ride)),
            activity_type: Some(ride.activity_type.clone()),
            ..ListedActivity::default()
        };
        self.answer(ride, created)
    }

    fn send_manual(&self, ride: &FfiRecordingEntry, body: ManualActivityBody) -> FfiCallOutcome {
        let created = ListedActivity {
            external_id: body.external_id.clone().filter(|_| self.keeps_external_id),
            start_date_local: Some(body.start_date_local.clone()),
            activity_type: Some(body.activity_type.clone()),
            ..ListedActivity::default()
        };
        self.manual_bodies.lock().unwrap().push(body);
        self.answer(ride, created)
    }

    fn find_landed(
        &self,
        ride: &FfiRecordingEntry,
        manual: Option<&ManualActivityBody>,
    ) -> FfiCallOutcome {
        self.looked.lock().unwrap().push(ride.id.clone());
        if let Some(failed) = &self.find_answer {
            return failed.clone();
        }
        let found = landed_match(&external_id_of(ride), manual, &self.server.lock().unwrap());
        answer(FfiCallKind::Ok, found.as_deref(), None)
    }

    fn send_rpe(&self, intervals_id: &str, rpe: u32) -> FfiCallOutcome {
        self.rpe
            .lock()
            .unwrap()
            .push((intervals_id.to_string(), rpe));
        answer(self.rpe_answer, None, None)
    }

    fn read_back(&self, intervals_id: &str) -> FfiCallOutcome {
        self.read.lock().unwrap().push(intervals_id.to_string());
        if let Some(during) = &self.during_read_back {
            during();
        }
        self.read_back
            .lock()
            .unwrap()
            .get(intervals_id)
            .cloned()
            .unwrap_or_else(|| answer(FfiCallKind::Network, None, None))
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
        || sweep(uplink, &now),
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
    assert_eq!(
        posted[0].external_id.as_deref(),
        Some("m1"),
        "the entry is posted under its own id"
    );
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

/// A manual entry with its body on disk, recorded by the signed-in athlete.
fn manual_entry(dir: &TempDir, id: &str, created_at: i64) -> FfiRecordingEntry {
    let body_path = dir.path().join(format!("{id}.manual.json"));
    std::fs::write(
        &body_path,
        r#"{"type":"Rowing","name":"Erg","start_date_local":"2026-01-02T07:00:00",
            "elapsed_time":1800}"#,
    )
    .unwrap();
    let mut entry = ride(dir, id, created_at);
    entry.kind = "manual".into();
    entry.fit_path = String::new();
    entry.streams_path = Some(format!("file://{}", body_path.display()));
    entry
}

fn in_doubt(id: &str) -> bool {
    with_persistent_engine(|e| e.recording_upload_in_doubt(id).unwrap())
        .unwrap()
        .expect("the row")
}

/// An hour on, past any backoff a first attempt sets.
fn an_hour_later() -> i64 {
    NOW + 3_600_000
}

/// Scenario: a manual entry's create is applied by the server, but the answer
/// is lost: once to a read timeout, once to a proxy's 502. The queue drains
/// again once the backoff has run.
/// Expected behaviour: the second drain finds the activity on the server and
/// settles the ride as uploaded with its id, and the server holds one
/// activity, never two.
#[test]
fn a_manual_entry_whose_create_landed_unanswered_is_not_posted_again() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_manual_unanswered.db");
    let lost_answers = [
        answer(FfiCallKind::Network, None, None),
        http(502, "bad gateway"),
    ];
    for (i, lost) in lost_answers.into_iter().enumerate() {
        let id = format!("m{i}");
        let mut entry = manual_entry(&dir, &id, 1_000 + i as i64);
        entry.rpe = Some(5);
        insert(&entry);
        let created = format!("i{}", 90 + i);
        let fake = Fake::scripted(vec![
            (lost, Some(created.clone())),
            (landed("i-duplicate"), Some("i-duplicate".into())),
        ]);

        drain(&fake, &now);
        drain(&fake, &an_hour_later);

        assert_eq!(fake.sent(), vec![id.clone()], "{id} was posted again");
        assert_eq!(fake.created(), vec![created.clone()], "{id}");
        let settled = row(&id);
        assert_eq!(settled.upload_status, "uploaded", "{id}");
        assert_eq!(settled.intervals_activity_id, Some(created.clone()), "{id}");
        assert!(!in_doubt(&id), "{id}");
        assert_eq!(
            *fake.rpe.lock().unwrap(),
            vec![(created, 5)],
            "the effort goes to the activity found"
        );
    }
}

/// Scenario: the server applies a manual create and drops the external id it
/// was sent, and the answer is lost to a timeout.
/// Expected behaviour: the next attempt finds the activity by its start and
/// type, and posts nothing.
#[test]
fn a_landed_manual_entry_without_its_external_id_is_found_by_start_and_type() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_manual_no_external_id.db");
    insert(&manual_entry(&dir, "m1", 1_000));
    let mut fake = Fake::scripted(vec![(
        answer(FfiCallKind::Network, None, None),
        Some("i9".into()),
    )]);
    fake.keeps_external_id = false;

    drain(&fake, &now);
    drain(&fake, &an_hour_later);

    assert_eq!(fake.sent(), vec!["m1"]);
    assert_eq!(row("m1").intervals_activity_id.as_deref(), Some("i9"));
}

/// Scenario: a create times out without reaching the server, and the next
/// attempt looks and finds nothing.
/// Expected behaviour: the entry is posted again and lands, and the mark is
/// gone once it has.
#[test]
fn a_ride_the_server_does_not_hold_is_sent_again_after_the_look() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_manual_not_landed.db");
    insert(&manual_entry(&dir, "m1", 1_000));
    let fake = Fake::scripted(vec![
        (answer(FfiCallKind::Network, None, None), None),
        (landed("i10"), Some("i10".into())),
    ]);

    drain(&fake, &now);
    assert!(in_doubt("m1"), "a lost answer leaves the ride in doubt");
    drain(&fake, &an_hour_later);

    assert_eq!(fake.looked(), vec!["m1"]);
    assert_eq!(fake.sent(), vec!["m1", "m1"]);
    assert_eq!(fake.created(), vec!["i10"]);
    let settled = row("m1");
    assert_eq!(settled.upload_status, "uploaded");
    assert_eq!(settled.intervals_activity_id.as_deref(), Some("i10"));
    assert!(!in_doubt("m1"));
}

/// Scenario: a ride in doubt is due, and the look itself fails: once to the
/// network, once to a 500, once to a 400.
/// Expected behaviour: nothing is posted, the ride stays pending and in doubt,
/// and the next attempt looks again.
#[test]
fn a_failed_look_sends_nothing_and_keeps_the_ride_in_doubt() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_look_failed.db");
    let failures = [
        (
            answer(FfiCallKind::Network, None, None),
            FfiUploadOutcome::Network,
        ),
        (http(500, "busy"), FfiUploadOutcome::Retriable),
        (http(400, "bad window"), FfiUploadOutcome::Retriable),
    ];
    for (i, (failure, outcome)) in failures.into_iter().enumerate() {
        let id = format!("m{i}");
        insert(&manual_entry(&dir, &id, 1_000 + i as i64));
        with_persistent_engine(|e| e.set_recording_upload_in_doubt(&id, true).unwrap()).unwrap();
        let mut fake = Fake::answering(vec![]);
        fake.find_answer = Some(failure);

        let result = upload_ride(&id, false, &fake, &now);

        assert_eq!(result.outcome, outcome, "{id}");
        assert_eq!(fake.looked(), vec![id.clone()], "{id}");
        assert!(fake.sent().is_empty(), "{id}");
        assert_eq!(row(&id).upload_status, "pending", "{id}");
        assert!(in_doubt(&id), "{id}");
    }
}

/// Scenario: a ride's request is in flight, and the answers that follow: a
/// rate limit and a rejection the server gave before acting, and a 408.
/// Expected behaviour: the ride is in doubt while the request is out; a
/// refusal settles it, so the next attempt posts without looking, and a 408
/// leaves it in doubt.
#[test]
fn the_mark_is_written_before_the_request_and_cleared_by_a_refusal() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_mark_cleared.db");
    let cases = [
        (answer(FfiCallKind::RateLimited, None, Some(429)), false),
        (http(400, "bad file"), false),
        (http(403, "forbidden"), false),
        (http(408, "timeout"), true),
    ];
    for (i, (reply, doubt_after)) in cases.into_iter().enumerate() {
        let id = format!("r{i}");
        insert(&ride(&dir, &id, 1_000 + i as i64));
        let seen = std::sync::Arc::new(Mutex::new(None));
        let mut fake = Fake::answering(vec![reply]);
        let (seen_in, watched) = (seen.clone(), id.clone());
        fake.during_send = Some(Box::new(move || {
            *seen_in.lock().unwrap() = Some(in_doubt(&watched));
        }));

        upload_ride(&id, false, &fake, &now);

        assert_eq!(*seen.lock().unwrap(), Some(true), "{id} in flight");
        assert_eq!(in_doubt(&id), doubt_after, "{id} after");
        assert!(fake.looked().is_empty(), "{id}");
    }
}

/// Scenario: the app was killed while a ride was uploading.
/// Expected behaviour: releasing it leaves it in doubt, so its next attempt
/// looks for it before sending.
#[test]
fn a_ride_stranded_mid_upload_is_in_doubt() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_stranded_doubt.db");
    let mut stranded = ride(&dir, "r1", 1_000);
    stranded.upload_status = "uploading".into();
    insert(&stranded);

    with_persistent_engine(|e| e.release_stranded_uploads(NOW).unwrap()).unwrap();

    assert!(in_doubt("r1"));
}

/// Scenario: a FIT upload's answer is lost after the server took it, and the
/// server filed it under the file's name rather than the external id.
/// Expected behaviour: the next attempt finds it by that name and sends
/// nothing.
#[test]
fn a_landed_file_upload_is_found_by_its_file_name() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_file_landed_unanswered.db");
    insert(&ride(&dir, "r1", 1_000));
    let fake = Fake::scripted(vec![(
        answer(FfiCallKind::Network, None, None),
        Some("i9".into()),
    )]);

    drain(&fake, &now);
    fake.server.lock().unwrap()[0].external_id = Some("r1.fit".into());
    drain(&fake, &an_hour_later);

    assert_eq!(fake.sent(), vec!["r1"]);
    assert_eq!(row("r1").intervals_activity_id.as_deref(), Some("i9"));
}

fn listed(id: &str, external_id: Option<&str>, start: &str, kind: &str) -> ListedActivity {
    ListedActivity {
        id: id.into(),
        external_id: external_id.map(str::to_string),
        start_date_local: Some(start.into()),
        activity_type: Some(kind.into()),
    }
}

fn rowing_body() -> ManualActivityBody {
    ManualActivityBody {
        activity_type: "Rowing".into(),
        name: "Erg".into(),
        start_date_local: "2026-01-02T07:00:00".into(),
        elapsed_time: 1800,
        moving_time: None,
        distance: None,
        total_elevation_gain: None,
        average_heartrate: None,
        description: None,
        trainer: false,
        commute: false,
        external_id: Some("m1".into()),
    }
}

/// Scenario: the activities around a recording, as the server lists them.
/// Expected behaviour: the ride's own external id matches in either form; an
/// activity with no external id matches a manual entry on start and type; an
/// activity another source filed, at the same start and type, never matches,
/// and neither does anything for a file upload without its external id.
#[test]
fn a_landed_activity_is_matched_by_its_external_id_or_a_bare_start_and_type() {
    let body = rowing_body();
    let start = "2026-01-02T07:00:00";

    let own = [listed("i1", Some("m1"), "2026-03-01T00:00:00", "Ride")];
    assert_eq!(landed_match("m1", None, &own).as_deref(), Some("i1"));
    let named = [listed("i2", Some("m1.fit"), start, "Rowing")];
    assert_eq!(landed_match("m1", None, &named).as_deref(), Some("i2"));

    let bare = [
        listed("i3", None, "2026-01-02T07:00:00.000", "Rowing"),
        listed("i4", Some(""), start, "Rowing"),
    ];
    assert_eq!(
        landed_match("m1", Some(&body), &bare).as_deref(),
        Some("i3")
    );
    assert_eq!(
        landed_match("m1", None, &bare),
        None,
        "a file has no fallback"
    );

    let others = [
        listed("i5", Some("98765432100"), start, "Rowing"),
        listed("i6", None, start, "Run"),
        listed("i7", None, "2026-01-02T07:00:01", "Rowing"),
        listed("i8", Some("m10"), start, "Rowing"),
    ];
    assert_eq!(landed_match("m1", Some(&body), &others), None);
    assert_eq!(landed_match("m1", Some(&body), &[]), None);
}

/// Scenario: the window a look lists, for a manual entry and for a ride.
/// Expected behaviour: the day either side of the entry's own local start, or
/// of the ride's start when it has no body.
#[test]
fn a_look_lists_the_day_either_side_of_the_start() {
    let dir = TempDir::new().unwrap();
    let mut entry = ride(&dir, "r1", 1_000);
    entry.start_time = 1_767_225_600_000.0;
    assert_eq!(
        search_window(&entry, Some(&rowing_body())),
        ("2026-01-01".to_string(), "2026-01-03".to_string())
    );
    assert_eq!(
        search_window(&entry, None),
        ("2025-12-31".to_string(), "2026-01-02".to_string())
    );
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
            .body_includes("filename=\"r1.fit\"")
            .body_includes("Bern loop")
            .body_includes("legs heavy")
            .body_includes("4321");
        then.status(200)
            .json_body(serde_json::json!({ "id": "i999" }));
    });
    let effort = server.mock(|when, then| {
        when.method(PUT)
            .path("/activity/i999")
            .body_includes("\"icu_rpe\":6");
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

/// A ride the server took, as the row reads once the upload has landed.
fn landed_ride(dir: &TempDir, id: &str, intervals_id: &str) -> FfiRecordingEntry {
    FfiRecordingEntry {
        upload_status: "uploaded".to_string(),
        intervals_activity_id: Some(intervals_id.to_string()),
        ..ride(dir, id, 1_000)
    }
}

fn gone() -> FfiCallOutcome {
    http(404, "not found")
}

fn present() -> FfiCallOutcome {
    landed("ignored")
}

fn exists(id: &str) -> bool {
    with_persistent_engine(|e| e.get_recording(id).unwrap())
        .unwrap()
        .is_some()
}

/// Scenario: a landed ride intervals.icu reads back, owing no effort, with its
/// FIT and a manual entry's body on the device.
/// Expected behaviour: the sweep deletes the row and both files.
#[test]
fn a_ride_read_back_present_is_deleted_with_its_files() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_present.db");
    let mut entry = landed_ride(&dir, "r1", "i9");
    let body = dir.path().join("r1.manual.json");
    std::fs::write(&body, "{}").unwrap();
    entry.streams_path = Some(format!("file://{}", body.display()));
    insert(&entry);
    let fake = Fake::answering(vec![]).reads("i9", present());

    sweep(&fake, &now);

    assert_eq!(fake.read(), vec!["i9"]);
    assert!(!exists("r1"), "the row is gone");
    assert!(!fit_on_disk(&entry), "the FIT is gone");
    assert!(!body.exists(), "the body is gone");
}

/// Scenario: a landed ride intervals.icu answers 404 for.
/// Expected behaviour: the ride parks as failed with the reason, and its FIT
/// stays, since it is now the only copy.
#[test]
fn a_ride_read_back_gone_parks_with_its_file_kept() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_gone.db");
    let entry = landed_ride(&dir, "r1", "i9");
    insert(&entry);
    let fake = Fake::answering(vec![]).reads("i9", gone());

    sweep(&fake, &now);

    let r1 = row("r1");
    assert_eq!(r1.upload_status, "failed");
    assert_eq!(
        r1.last_error.as_deref(),
        Some("intervals.icu no longer has this activity")
    );
    assert!(fit_on_disk(&entry));
}

/// Scenario: a landed ride whose read-back never reached the server, and one
/// the server refused to answer for.
/// Expected behaviour: neither is an answer, so both stay uploaded with their
/// files.
#[test]
fn a_ride_whose_read_back_is_unknown_is_kept() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_unknown.db");
    let offline = landed_ride(&dir, "r1", "i9");
    insert(&offline);
    let refused = landed_ride(&dir, "r2", "i10");
    insert(&refused);
    let fake = Fake::answering(vec![]).reads("i10", http(500, "busy"));

    sweep(&fake, &now);

    assert_eq!(row("r1").upload_status, "uploaded");
    assert_eq!(row("r2").upload_status, "uploaded");
    assert!(fit_on_disk(&offline));
    assert!(fit_on_disk(&refused));
}

/// Scenario: a landed ride owes its effort, and the server refuses the effort
/// on one sweep and takes it on the next.
/// Expected behaviour: the first sweep keeps the ride and its file, since the
/// row is the effort's only record; the second sends the effort to the
/// activity the upload created and then deletes the ride.
#[test]
fn a_ride_owing_its_effort_is_kept_until_the_effort_is_sent() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_owed_effort.db");
    let mut entry = landed_ride(&dir, "r1", "i9");
    entry.rpe = Some(7);
    insert(&entry);

    let mut refusing = Fake::answering(vec![]).reads("i9", present());
    refusing.rpe_answer = FfiCallKind::Network;
    sweep(&refusing, &now);

    assert_eq!(*refusing.rpe.lock().unwrap(), vec![("i9".to_string(), 7)]);
    assert!(exists("r1"), "kept while the effort is owed");
    assert!(!row("r1").rpe_sent);
    assert!(fit_on_disk(&entry));

    let taking = Fake::answering(vec![]).reads("i9", present());
    sweep(&taking, &now);

    assert_eq!(*taking.rpe.lock().unwrap(), vec![("i9".to_string(), 7)]);
    assert!(!exists("r1"), "deleted once the effort is sent");
    assert!(!fit_on_disk(&entry));
}

/// Scenario: a landed ride owing its effort, read back gone.
/// Expected behaviour: it parks like any vanished upload, with its file.
#[test]
fn a_ride_owing_its_effort_read_back_gone_parks() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_owed_gone.db");
    let mut entry = landed_ride(&dir, "r1", "i9");
    entry.rpe = Some(7);
    insert(&entry);
    let mut fake = Fake::answering(vec![]).reads("i9", gone());
    fake.rpe_answer = FfiCallKind::Network;

    sweep(&fake, &now);

    assert_eq!(row("r1").upload_status, "failed");
    assert!(fit_on_disk(&entry));
}

/// Scenario: a ride landed while the engine was closed, so its provisional row
/// never took the server's id, and the server holds it.
/// Expected behaviour: the sweep writes the id onto the provisional row first,
/// so the next sync does not store the ride twice, and only then deletes the
/// recording.
#[test]
fn a_landed_ride_is_reconciled_before_it_is_confirmed() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_reconcile.db");
    let entry = with_provisional(landed_ride(&dir, "r1", "i9"), "local-r1");
    insert(&entry);
    let fake = Fake::answering(vec![]).reads("i9", present());

    sweep(&fake, &now);

    assert_eq!(intervals_id_of_activity("local-r1").as_deref(), Some("i9"));
    assert!(!exists("r1"));
}

/// Scenario: a ride whose provisional row has not taken the server's id, and
/// whose reconcile cannot run because the provisional row is not there.
/// Expected behaviour: it is settled anyway, since the row has gone, and the
/// confirmation then reads it back.
#[test]
fn a_reconcile_whose_provisional_row_has_gone_is_settled() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_reconcile_gone.db");
    let mut entry = landed_ride(&dir, "r1", "i9");
    entry.engine_activity_id = Some("local-missing".into());
    insert(&entry);
    let fake = Fake::answering(vec![]);

    sweep(&fake, &now);

    assert!(row("r1").engine_reconciled);
    assert_eq!(fake.read(), vec!["i9"]);
}

/// Scenario: landed rides while nobody is signed in, and while another
/// athlete is.
/// Expected behaviour: nothing is read back and no effort is sent, since the
/// request would go under nobody's credential or someone else's, and every
/// ride stays as it is.
#[test]
fn nothing_is_read_back_for_a_ride_that_is_not_the_signed_in_athletes() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_other_athlete.db");
    let mut mine = landed_ride(&dir, "r1", "i9");
    mine.rpe = Some(5);
    insert(&mine);
    let mut theirs = landed_ride(&dir, "r2", "i10");
    theirs.athlete_id = Some("i2".into());
    theirs.rpe = Some(5);
    insert(&theirs);

    let nobody = Fake::answering(vec![])
        .reads("i9", present())
        .reads("i10", gone());
    *nobody.athlete.lock().unwrap() = None;
    sweep(&nobody, &now);
    assert!(nobody.read().is_empty());
    assert!(nobody.rpe.lock().unwrap().is_empty());

    let me = Fake::answering(vec![])
        .reads("i9", gone())
        .reads("i10", gone());
    sweep(&me, &now);
    assert_eq!(me.read(), vec!["i9"], "only the signed-in athlete's ride");
    assert_eq!(*me.rpe.lock().unwrap(), vec![("i9".to_string(), 5)]);
    assert_eq!(row("r2").upload_status, "uploaded");
    assert!(!row("r2").rpe_sent);
    assert!(fit_on_disk(&theirs));
}

/// Scenario: a restore lands while a landed ride is being read back.
/// Expected behaviour: the answer is not written into the library that
/// replaced the one it was asked for, and the file stays.
#[test]
fn a_read_back_that_outlived_its_install_deletes_nothing() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_install_moved.db");
    let entry = landed_ride(&dir, "r1", "i9");
    insert(&entry);
    let mut fake = Fake::answering(vec![]).reads("i9", present());
    fake.during_read_back = Some(Box::new(crate::persistence::invalidate_engine_install));

    sweep(&fake, &now);

    assert!(exists("r1"));
    assert!(fit_on_disk(&entry));
}

/// Scenario: a pending ride, a parked one and one still in flight.
/// Expected behaviour: the sweep reads none of them back and touches none:
/// only a landed upload is confirmed.
#[test]
fn only_a_landed_upload_is_read_back() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_only_landed.db");
    for (id, status) in [("r1", "pending"), ("r2", "failed"), ("r3", "uploading")] {
        let mut entry = ride(&dir, id, 1_000);
        entry.upload_status = status.into();
        entry.intervals_activity_id = Some(format!("i-{id}"));
        insert(&entry);
    }
    let fake = Fake::answering(vec![])
        .reads("i-r1", present())
        .reads("i-r2", present())
        .reads("i-r3", present());

    sweep(&fake, &now);

    assert!(fake.read().is_empty());
    assert!(exists("r1") && exists("r2") && exists("r3"));
}

/// Scenario: the schedule's own pass uploads a due ride, and the server reads
/// it straight back.
/// Expected behaviour: the sweep after the drain deletes the ride, so nothing
/// on the JavaScript side has to run for a landed ride to leave the device.
#[test]
fn the_schedule_confirms_and_deletes_what_its_drain_uploaded() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_after_drain.db");
    let entry = ride(&dir, "r1", 1_000);
    insert(&entry);
    let fake = Fake::answering(vec![landed("i9")]).reads("i9", present());

    one_scheduled_pass(&fake);

    assert_eq!(fake.sent(), vec!["r1"]);
    assert!(!exists("r1"));
    assert!(!fit_on_disk(&entry));
}

/// The documents directory of an install whose container an update moved: a
/// `recordings/` directory under a temporary root, handed over as the app
/// hands it, with its scheme.
fn moved_container(dir: &TempDir) -> std::path::PathBuf {
    let recordings = dir.path().join("docs").join("recordings");
    std::fs::create_dir_all(&recordings).unwrap();
    set_files_root(&format!("file://{}/docs/", dir.path().display()));
    recordings
}

/// Scenario: a strength session stored by its name under the documents
/// directory, and one stored by an absolute path into a container an update
/// has since moved, both landing.
/// Expected behaviour: the sets are read out of each session's FIT where it
/// sits now, so both activities are settled.
#[test]
fn a_strength_session_is_read_for_its_sets_from_the_live_documents_directory() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_strength_files_root.db");
    let recordings = moved_container(&dir);
    let mut named = ride(&dir, "named", 1_000);
    named.fit_path = "recordings/named.fit".into();
    let mut moved = ride(&dir, "moved", 2_000);
    moved.fit_path = "file:///old-container/Documents/recordings/moved.fit".into();
    for session in [&mut named, &mut moved] {
        session.activity_type = "WeightTraining".into();
        std::fs::write(
            recordings.join(format!("{}.fit", session.id)),
            crate::fit::recorded_ride_fit(),
        )
        .unwrap();
        insert(session);
    }
    let fake = Fake::answering(vec![landed("i1"), landed("i2")]);

    let named_outcome = upload_ride("named", false, &fake, &now).outcome;
    let moved_outcome = upload_ride("moved", false, &fake, &now).outcome;
    set_files_root("");

    assert_eq!(named_outcome, FfiUploadOutcome::Uploaded);
    assert_eq!(moved_outcome, FfiUploadOutcome::Uploaded);
    with_persistent_engine(|e| {
        assert!(
            e.is_fit_processed("i1").unwrap(),
            "the named session is settled"
        );
        assert!(
            e.is_fit_processed("i2").unwrap(),
            "the moved session is settled"
        );
    })
    .unwrap();
}

/// Scenario: a ride stored by its name under the documents directory, and one
/// stored by an absolute path into a container an update has since moved.
/// Expected behaviour: both files are found under the live documents directory
/// and sent from there, and neither ride is parked as missing.
#[test]
fn a_ride_is_sent_from_the_live_documents_directory_whatever_its_row_stored() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_files_root.db");
    let recordings = moved_container(&dir);
    for id in ["named", "moved"] {
        std::fs::write(recordings.join(format!("{id}.fit")), b"fit").unwrap();
    }
    let mut named = ride(&dir, "named", 1_000);
    named.fit_path = "recordings/named.fit".into();
    let mut moved = ride(&dir, "moved", 2_000);
    moved.fit_path = "file:///old-container/Documents/recordings/moved.fit".into();
    insert(&named);
    insert(&moved);
    let fake = Fake::answering(vec![landed("i1"), landed("i2")]);

    drain(&fake, &now);
    set_files_root("");

    assert_eq!(fake.sent(), vec!["named", "moved"]);
    let sent = fake.sent_paths.lock().unwrap().clone();
    assert_eq!(
        sent.iter()
            .map(|p| std::path::PathBuf::from(crate::net::transport::strip_file_scheme(p)))
            .collect::<Vec<_>>(),
        vec![recordings.join("named.fit"), recordings.join("moved.fit")]
    );
    assert_eq!(row("named").upload_status, "uploaded");
    assert_eq!(row("moved").upload_status, "uploaded");
}

/// Scenario: a manual entry whose body is stored by its name.
/// Expected behaviour: the body is read from the live documents directory.
#[test]
fn a_manual_body_stored_by_name_is_read_from_the_live_documents_directory() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_files_root_manual.db");
    let recordings = moved_container(&dir);
    std::fs::write(
        recordings.join("m1.manual.json"),
        r#"{"type":"Rowing","name":"Erg","start_date_local":"2026-01-02T07:00:00",
            "elapsed_time":1800}"#,
    )
    .unwrap();
    let mut entry = ride(&dir, "m1", 1_000);
    entry.kind = "manual".into();
    entry.fit_path = String::new();
    entry.streams_path = Some("recordings/m1.manual.json".into());
    insert(&entry);
    let fake = Fake::answering(vec![landed("i9")]);

    let result = upload_ride("m1", false, &fake, &now);
    set_files_root("");

    assert_eq!(result.outcome, FfiUploadOutcome::Uploaded);
    assert_eq!(fake.manual_bodies.lock().unwrap().len(), 1);
}

/// Scenario: a ride stored by its name is due before the app has said where
/// its documents directory is.
/// Expected behaviour: nothing is sent and the ride is not parked as missing,
/// since its file may well be there.
#[test]
fn a_ride_stored_by_name_waits_for_the_documents_directory() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_files_root_unset.db");
    set_files_root("");
    let mut named = ride(&dir, "named", 1_000);
    named.fit_path = "recordings/named.fit".into();
    insert(&named);
    let fake = Fake::answering(vec![]);

    let result = upload_ride("named", false, &fake, &now);

    assert_eq!(result.outcome, FfiUploadOutcome::NotStarted);
    assert!(fake.sent().is_empty());
    assert_eq!(row("named").upload_status, "pending");
    assert_eq!(row("named").last_error, None);
}

/// Scenario: a landed ride stored by its names reads back present.
/// Expected behaviour: its files under the live documents directory go with
/// the row.
#[test]
fn a_confirmed_ride_stored_by_name_is_deleted_with_its_files() {
    let _serial = serial_global_state();
    let dir = init_global_engine("sweep_files_root.db");
    let recordings = moved_container(&dir);
    std::fs::write(recordings.join("r1.fit"), b"fit").unwrap();
    std::fs::write(recordings.join("r1.manual.json"), "{}").unwrap();
    let mut entry = landed_ride(&dir, "r1", "i9");
    entry.fit_path = "recordings/r1.fit".into();
    entry.streams_path = Some("file:///old-container/Documents/recordings/r1.manual.json".into());
    insert(&entry);
    let fake = Fake::answering(vec![]).reads("i9", present());

    sweep(&fake, &now);
    set_files_root("");

    assert!(!exists("r1"), "the row is gone");
    assert!(!recordings.join("r1.fit").exists(), "the FIT is gone");
    assert!(
        !recordings.join("r1.manual.json").exists(),
        "the body is gone"
    );
}

/// The Garmin id the stored originals in these tests carry.
const GARMIN_ID: i64 = 18_342_901_776;

fn garmin_key() -> String {
    crate::persistence::origin::garmin_source_key(GARMIN_ID)
}

/// Store the original of `GARMIN_ID` with its FIT kept under the documents
/// directory `dir`, as the pull does when the upload switch is on.
fn store_garmin_original(dir: &TempDir) {
    use crate::net::garmin::wire::ListedActivity as Listed;
    set_files_root(&dir.path().to_string_lossy());
    let listed: Listed = serde_json::from_value(serde_json::json!({
        "activityId": GARMIN_ID,
        "activityName": "Lake loop",
        "startTimeLocal": "2026-03-14 09:00:00",
        "startTimeGMT": "2026-03-14 07:00:00",
        "activityType": {"typeKey": "cycling"},
        "duration": 99.0,
        "elapsedDuration": 99.0,
        "distance": 1.0
    }))
    .unwrap();
    let fit = crate::fit_synthetic::outdoor_ride().to_fit();
    let path = source_fit_file(&garmin_key()).expect("a documents directory");
    with_persistent_engine(|e| {
        crate::net::garmin::ingest::ingest_into(e, Some(&path), &listed, &fit).expect("stored")
    })
    .unwrap();
}

fn garmin_upload_switch(on: bool) {
    with_persistent_engine(|e| {
        e.set_setting("veloq-garmin-upload", if on { "true" } else { "false" })
            .unwrap()
    })
    .unwrap();
}

fn a_sync_has_completed() {
    with_persistent_engine(|e| {
        e.set_setting(
            crate::persistence::settings::settings_keys::SYNC_LAST_SUCCESS_AT,
            "2026-03-14T10:00:00Z",
        )
        .unwrap()
    })
    .unwrap();
}

fn garmin_fit_on_disk() -> bool {
    source_fit_file(&garmin_key()).is_some_and(|p| p.is_file())
}

/// Scenario: a Garmin original no intervals.icu activity holds, the athlete's
/// upload switch on, and a sync that has completed.
/// Expected behaviour: one pass uploads it once with the Garmin id as its
/// external id, the Garmin row takes the id the answer gave, and a second pass
/// sends nothing.
#[test]
fn an_unmatched_original_with_the_switch_on_uploads_once_under_its_garmin_id() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_garmin_once.db");
    store_garmin_original(&dir);
    garmin_upload_switch(true);
    a_sync_has_completed();
    let fake = Fake::answering(vec![landed("i77")]);

    sweep(&fake, &now);
    one_scheduled_pass(&fake);
    one_scheduled_pass(&fake);

    assert_eq!(fake.sent(), vec![garmin_key()]);
    assert_eq!(
        *fake.external_ids.lock().unwrap(),
        vec![format!("garmin:{GARMIN_ID}")]
    );
    assert_eq!(
        intervals_id_of_activity(&garmin_key()).as_deref(),
        Some("i77")
    );
    assert_eq!(row(&garmin_key()).upload_status, "uploaded");
}

/// Scenario: the same original with the switch off, and with it on before any
/// sync has completed.
/// Expected behaviour: nothing is queued or sent, and the original stays.
#[test]
fn an_original_is_not_offered_with_the_switch_off_or_before_a_sync() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_garmin_off.db");
    store_garmin_original(&dir);
    let fake = Fake::answering(vec![]);

    a_sync_has_completed();
    garmin_upload_switch(false);
    sweep(&fake, &now);
    one_scheduled_pass(&fake);
    assert!(!exists(&garmin_key()), "switch off queues nothing");

    let dir = init_global_engine("upload_garmin_no_sync.db");
    store_garmin_original(&dir);
    garmin_upload_switch(true);
    sweep(&fake, &now);
    one_scheduled_pass(&fake);
    assert!(!exists(&garmin_key()), "no completed sync queues nothing");
    assert!(fake.sent().is_empty());
    assert!(garmin_fit_on_disk());
}

/// Scenario: intervals.icu refuses the write grant for a Garmin original.
/// Expected behaviour: the ride parks as permission blocked and its FIT stays.
#[test]
fn a_refused_scope_parks_a_garmin_original_with_its_file() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_garmin_403.db");
    store_garmin_original(&dir);
    garmin_upload_switch(true);
    a_sync_has_completed();
    let fake = Fake::answering(vec![http(403, "forbidden")]);

    sweep(&fake, &now);
    one_scheduled_pass(&fake);

    assert_eq!(row(&garmin_key()).upload_status, "permissionBlocked");
    assert!(garmin_fit_on_disk());
    assert_eq!(intervals_id_of_activity(&garmin_key()), None);
}

/// Scenario: a Garmin original has uploaded, and intervals.icu answers the
/// read-back first with nothing and then with the activity.
/// Expected behaviour: the FIT stays until the read-back says present, then the
/// queue row and the FIT go and the Garmin row keeps its activity.
#[test]
fn a_garmin_fit_is_deleted_only_after_the_read_back_says_present() {
    let _serial = serial_global_state();
    let dir = init_global_engine("upload_garmin_read_back.db");
    store_garmin_original(&dir);
    garmin_upload_switch(true);
    a_sync_has_completed();
    let fake = Fake::answering(vec![landed("i77")]);

    sweep(&fake, &now);
    one_scheduled_pass(&fake);
    assert!(garmin_fit_on_disk(), "no read-back answered yet");
    assert!(exists(&garmin_key()));

    let fake = Fake::answering(vec![]).reads("i77", present());
    sweep(&fake, &now);

    assert!(!garmin_fit_on_disk());
    assert!(!exists(&garmin_key()));
    assert!(with_persistent_engine(|e| e.has_stored_activity(&garmin_key())).unwrap());
    assert_eq!(
        intervals_id_of_activity(&garmin_key()).as_deref(),
        Some("i77")
    );
}

/// Scenario: a Garmin original's upload row and a recording's.
/// Expected behaviour: the Garmin one is sent under `garmin:<id>` with no name
/// or description, and a recording is sent under its own id.
#[test]
fn only_a_garmin_original_is_sent_under_the_garmin_form() {
    let dir = TempDir::new().unwrap();
    let mut garmin = ride(&dir, &garmin_key(), 1_000);
    garmin.kind = "garmin".to_string();
    assert_eq!(external_id_of(&garmin), format!("garmin:{GARMIN_ID}"));
    assert_eq!(external_id_of(&ride(&dir, "r1", 1_000)), "r1");
    assert_eq!(upload_name_of(&garmin), None);
    assert_eq!(
        upload_name_of(&ride(&dir, "r1", 1_000)).as_deref(),
        Some("Ride r1")
    );
}
