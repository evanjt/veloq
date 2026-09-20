//! What a push handler with no JavaScript calls, and the two boundaries it
//! calls it through: JNI on Android, plain C on iOS.
//!
//! A data push wakes the app process, and on a cold start there is no
//! JavaScript in it: nothing has opened the engine and nothing has set the
//! credential, both of which TypeScript does at launch. So the handler has to
//! carry what a session needs and hand it over in one call.
//!
//! Android's handler shares the app process; the iOS one is a Notification
//! Service Extension, a second process against the same App Group container.
//! Both arrive with an id and nothing else, so both hand over a database path
//! and a credential first.
//!
//! The surface is hand-written JNI rather than generated Kotlin bindings.
//! `uniffi-bindgen` has no way to generate a Kotlin binding without its
//! callback-interface initialisation, and a second installer of that vtable in
//! one process makes Rust dispatch a JavaScript-registered observer through
//! another language's handle map. `scripts/lint-one-observer-vtable.mjs`
//! refuses one. Three symbols beside the tile store's is the whole cost of
//! avoiding the question. iOS has no JNI and the same objection, so `c.rs` is
//! the twin: plain C symbols in the xcframework, the shape `basemap/c.rs`
//! already uses for the tile scheme handler.
//!
//! The functions here hold the decisions and the two boundary files only
//! marshal, so everything below is tested on the host rather than on a device.

#[cfg(target_os = "android")]
mod jni;

mod c;
pub mod runs;

pub use runs::{FfiPushRun, PushRunOutcome};

/// Open the engine and set the credential for a caller that arrived without
/// JavaScript, and say whether a fetch can now be attempted.
///
/// Neither half is overwritten if it is already there. A push can land while
/// the app is in the foreground, and re-opening the database would swap the
/// engine out from under the connection JavaScript is reading through, while a
/// credential JavaScript holds is the fresher of the two: a token refresh
/// writes it there first.
pub fn prepare_native_session(
    db_path: &str,
    auth_method: &str,
    secret: &str,
    athlete_id: &str,
) -> Result<(), String> {
    if crate::persistence::with_persistent_engine(|_| ()).is_none()
        && !crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path.to_string())
    {
        return Err(format!("the engine did not open at {db_path}"));
    }
    if crate::objects::current_transport().is_none() {
        crate::objects::set_credentials_from_native(auth_method, secret, athlete_id)?;
    }
    Ok(())
}

/// Which credential a handler that read the keychain itself should use, and
/// the athlete it belongs to.
///
/// The same order `AuthStore` hydrates in: OAuth first, an API key behind it,
/// and neither without an athlete id. A blank item is an absent one, which is
/// what a key written and then cleared reads as, and what `isValidCredential`
/// already rejects on the JavaScript side.
///
/// `None` is a handler with nothing to fetch with. On iOS that is the phone
/// rebooted and not yet unlocked, where `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
/// has no key in memory and every read comes back empty.
pub fn native_auth_choice<'a>(
    access_token: Option<&'a str>,
    api_key: Option<&'a str>,
    athlete_id: Option<&'a str>,
) -> Option<(&'static str, &'a str, &'a str)> {
    let present = |value: Option<&'a str>| value.map(str::trim).filter(|v| !v.is_empty());
    let athlete = present(athlete_id)?;
    if let Some(token) = present(access_token) {
        return Some(("oauth", token, athlete));
    }
    Some(("api_key", present(api_key)?, athlete))
}

/// Open the engine and set the credential for a handler holding what the
/// keychain gave it rather than a method and a secret.
///
/// The iOS extension reads three items and cannot tell which session they
/// belong to; the choice is the same one `AuthStore` makes and belongs here
/// rather than in Swift, where nothing can test it. Refused before anything
/// is opened when there is no credential: a handler with none has nothing to
/// fetch with, and opening the database to discover that costs an athlete's
/// notification the time it takes.
pub fn prepare_native_session_from_keychain(
    db_path: &str,
    access_token: Option<&str>,
    api_key: Option<&str>,
    athlete_id: Option<&str>,
) -> Result<(), String> {
    let (method, secret, athlete) = native_auth_choice(access_token, api_key, athlete_id)
        .ok_or_else(|| "the keychain held no credential this handler can use".to_string())?;
    prepare_native_session(db_path, method, secret, athlete)
}

/// One activity's index summary as JSON, for a caller that speaks no UniFFI.
///
/// Three scalars and no strings, so it is written rather than serialised: the
/// type is a `uniffi::Record` shared with the JavaScript surface and giving it
/// a serde derive for one caller would put the wire format of the JSI path at
/// the mercy of a field rename here.
pub fn index_summary_json(summary: &crate::FfiIndexActivitySummary) -> String {
    format!(
        "{{\"matchedSections\":{},\"insertedPortions\":{},\"regrouped\":{}}}",
        summary.matched_sections, summary.inserted_portions, summary.regrouped
    )
}

/// Fetch, store and index one activity, and answer with the summary as JSON.
///
/// The error is a sentence the caller logs. It has no screen to put it on and
/// nothing to retry with that would go differently, so the shapes the JSI path
/// distinguishes are worth nothing here.
pub fn fetch_and_index_json(activity_id: &str, sport_type: &str) -> Result<String, String> {
    crate::ffi::fetch_and_index_activity(activity_id.to_string(), sport_type.to_string())
        .map(|summary| index_summary_json(&summary))
        .map_err(|e| e.to_string())
}

/// The title and body for one activity, as JSON, for a handler that speaks no
/// UniFFI.
///
/// The ladder and the templates are the same ones JavaScript reaches through
/// `activity_notification`, which is the whole reason this lives in the crate:
/// a Kotlin port would have left iOS to port it again to Swift.
///
/// `Ok(Err(..))` is no enriched sentence, and which of the two it was: the
/// ladder found nothing worth one, or no string bundle has been pushed yet.
/// Neither is a body of raw keys, and the two are told apart because on a
/// handset they are the difference between a quiet ride and an install whose
/// JavaScript has never had a full launch. What the Android worker does with
/// either is post the plain entry of [`fallback_notification_json`]; the iOS
/// extension leaves the notification it was handed as it is.
pub fn activity_notification_outcome(
    activity_id: &str,
    activity_name: &str,
    announce_prs: bool,
) -> Result<Result<String, PushRunOutcome>, String> {
    // Off the engine lock: the handler runs whenever the push lands, which is
    // as often as not while a sync page holds the writer.
    let built = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::notifications::build_notification_pooled(
            conn,
            activity_id,
            activity_name,
            announce_prs,
            None,
        )
    })
    .ok_or_else(|| "the engine is not open".to_string())?;

    let Some(notification) = built else {
        log::warn!("[push] no string bundle yet for {activity_id}");
        return Ok(Err(PushRunOutcome::NoStringBundle));
    };
    if notification.body.is_empty() {
        log::warn!("[push] the ladder found nothing for {activity_id}");
        return Ok(Err(PushRunOutcome::NothingWorthPosting));
    }

    Ok(Ok(format!(
        "{{\"title\":{},\"body\":{}}}",
        json_string(&notification.title),
        json_string(&notification.body)
    )))
}

/// The same sentence for a caller that only wants whether there is one.
pub fn activity_notification_json(
    activity_id: &str,
    activity_name: &str,
    announce_prs: bool,
) -> Result<Option<String>, String> {
    activity_notification_outcome(activity_id, activity_name, announce_prs).map(Result::ok)
}

/// What the preferences row allows: `None` to post nothing, otherwise whether
/// section PRs may be announced.
///
/// An absent or unreadable row is the store's default, which is off. A
/// missing `categories.sectionPr` is the store's default for that flag, which
/// is on: the row is spread over the defaults on read, so a row written
/// before the flag existed announces PRs there too.
pub fn handler_gate(row: Option<&str>) -> Option<bool> {
    let json: serde_json::Value = serde_json::from_str(row?).ok()?;
    if json.get("enabled").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    Some(
        json.get("categories")
            .and_then(|c| c.get("sectionPr"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
    )
}

/// The gated sentence for an activity the library already holds, which is what
/// the iOS notification service extension asks for.
///
/// iOS splits the work the Android worker does in one call: the extension is
/// handed a notification that is already on its way, fetches and indexes, then
/// asks for the sentence to rewrite it with. So the gate and the ladder are
/// wanted without the fetch that `activity_push_json` does first.
///
/// `Ok(None)` is post nothing, whether the gate or the ladder said so. The
/// error is the engine not being open, which is a caller that skipped
/// `prepare`, and is worth a log line rather than a quiet `None`.
pub fn activity_notification_for_handler(
    activity_id: &str,
    activity_name: &str,
) -> Result<Option<String>, String> {
    let announce_prs = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES,
        )
        .map_err(|e| e.to_string())
    })
    .ok_or_else(|| "the engine is not open".to_string())?
    .map(|row| handler_gate(row.as_deref()))?;

    match announce_prs {
        Some(announce_prs) => activity_notification_json(activity_id, activity_name, announce_prs),
        None => Ok(None),
    }
}

/// What the detail body gave the push: the name the sentence carries and the
/// sport the track fetch is stored under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityDetail {
    pub name: String,
    pub sport_type: String,
}

/// Record one activity's detail body the way a sync would have: the metrics
/// row, which is what dates a lap so the ladder can call it a record, and the
/// body itself, which the summary screen reads. JavaScript did both from the
/// same body, and a handler with no JavaScript has to.
pub fn record_activity_detail(
    engine: &mut crate::persistence::PersistentEngine,
    activity_id: &str,
    body: &str,
) -> Result<ActivityDetail, String> {
    let record: crate::net::types::ActivityRecord =
        serde_json::from_str(body).map_err(|e| format!("the body of {activity_id}: {e}"))?;
    let date = crate::objects::sync::start_date_to_timestamp(record.start_date_local.as_deref())
        .ok_or_else(|| format!("the body of {activity_id} carries no start date"))?;
    let detail = ActivityDetail {
        name: record.name.clone().unwrap_or_default(),
        sport_type: record
            .activity_type
            .clone()
            .unwrap_or_else(|| "Ride".to_string()),
    };
    engine
        .set_activity_metrics(vec![crate::objects::sync::activity_metrics_row(
            record, date,
        )])
        .map_err(|e| e.to_string())?;
    engine
        .upsert_activity_bodies(&[(activity_id.to_string(), date, body.to_string())])
        .map_err(|e| e.to_string())?;
    Ok(detail)
}

/// The title a fallback entry carries when no string bundle has been pushed
/// yet, so there is nothing to translate with.
///
/// English on purpose rather than a lookup: the case this exists for is a
/// fresh install whose JavaScript has never had a full launch, and the choice
/// is between this and no entry at all.
const FALLBACK_TITLE: &str = "New activity";

/// The plain entry to post when the ladder produced no sentence, or when a
/// step failed after the gate let the push through.
///
/// The stored title is used when there is one, so an athlete whose app has
/// launched at least once reads their own language. The body is the ride's
/// name when the run got far enough to learn it, and empty otherwise: the tap
/// target is the activity id, which the poster carries either way, so an entry
/// with no body still opens the ride.
fn fallback_notification_json(activity_name: Option<&str>) -> String {
    let title = crate::persistence::read_pool::with_read_conn(|conn| {
        let stored = crate::persistence::settings::notification_templates_from(conn).ok()??;
        stored
            .templates
            .get(crate::notifications::RECORDED_TITLE_KEY)
            .cloned()
    })
    .flatten()
    .unwrap_or_else(|| FALLBACK_TITLE.to_string());

    format!(
        "{{\"title\":{},\"body\":{}}}",
        json_string(&title),
        json_string(activity_name.unwrap_or_default())
    )
}

/// One activity push, end to end, for a handler that speaks no UniFFI: the
/// gate, the detail body, the track and its index, then the sentence.
///
/// `Ok(None)` is the athlete's own switch, and nothing else. The server no
/// longer sends the placeholder to Android, so this is the only thing that
/// posts, and every other outcome answers with an entry: the
/// enriched sentence when the ladder produced one, and the plain entry of
/// [`fallback_notification_json`] otherwise. A ride that reached the phone and
/// left no entry at all is the failure this exists to prevent.
///
/// `Err` is the engine not being open, which is a caller that skipped
/// `prepare`. A step that fails past the gate is not an error here: it is
/// recorded and answered with the plain entry, because the athlete's side of
/// it is the same either way.
///
/// Every one of the five outcomes is written to `push_runs` before the answer
/// is handed back, because the log is not a record an athlete's phone keeps:
/// a device build logs at `Warn` and logcat is gone by the time anyone asks.
/// The Developer Dashboard reads the table.
///
/// The gate is read before anything is fetched. An athlete who turned
/// notifications off gets no fetch on their behalf either, which is what the
/// JavaScript task did.
pub fn activity_push_json(activity_id: &str) -> Result<Option<String>, String> {
    let row = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES,
        )
        .map_err(|e| e.to_string())
    })
    .ok_or_else(|| "the engine is not open".to_string())??;
    let Some(announce_prs) = handler_gate(row.as_deref()) else {
        log::warn!("[push] notifications are off, leaving {activity_id} alone");
        runs::record(activity_id, PushRunOutcome::NotificationsOff, None);
        return Ok(None);
    };

    match activity_push_run(activity_id, announce_prs) {
        Ok(Ok(json)) => {
            runs::record(activity_id, PushRunOutcome::Posted, None);
            Ok(Some(json))
        }
        Ok(Err(quiet)) => {
            runs::record(activity_id, quiet.outcome, None);
            Ok(Some(fallback_notification_json(
                quiet.activity_name.as_deref(),
            )))
        }
        Err(e) => {
            log::warn!("[push] {activity_id} fell back to a plain entry: {e}");
            runs::record(activity_id, PushRunOutcome::Failed, Some(&e));
            Ok(Some(fallback_notification_json(None)))
        }
    }
}

/// Why a run produced no sentence, and what it had learned by then.
///
/// The name is carried out because the fallback entry wants it: a run that got
/// as far as the detail body knows what the ride is called even when the
/// ladder had nothing to say about it.
struct Quiet {
    outcome: PushRunOutcome,
    activity_name: Option<String>,
}

impl From<PushRunOutcome> for Quiet {
    fn from(outcome: PushRunOutcome) -> Self {
        Quiet {
            outcome,
            activity_name: None,
        }
    }
}

/// The push itself, past the gate, answering with the sentence or with why
/// there is none.
///
/// Separate from [`activity_push_json`] so that every path out of it, the
/// early returns included, is recorded in one place rather than at each
/// `return`.
fn activity_push_run(
    activity_id: &str,
    announce_prs: bool,
) -> Result<Result<String, Quiet>, String> {
    let transport =
        crate::objects::current_transport().ok_or_else(|| "no credentials set".to_string())??;
    // The upstream id is a read, so it comes off the pool rather than the
    // engine lock, which a sync page may be holding.
    let upstream = crate::persistence::read_pool::with_read_conn(|conn| {
        conn.query_row(
            "SELECT intervals_id FROM activities WHERE id = ?",
            [activity_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    })
    .flatten()
    .unwrap_or_else(|| activity_id.to_string());
    let body = crate::runtime::block_on(crate::net::endpoints::fetch_activity_body(
        &transport,
        &upstream,
        crate::governor::Lane::Interactive,
    ))
    .map_err(|e| format!("the detail of {activity_id}: {e}"))?;

    // One take of the lock for the detail and, when the track is already
    // stored, the index. A webhook delivered twice, or one that arrived before
    // the track was indexed, has the track already, and indexing is
    // idempotent, so the second pass costs no network round trip.
    let (detail, indexed) = crate::persistence::with_persistent_engine(|engine| {
        let detail = record_activity_detail(engine, activity_id, &body)?;
        // Said before the index rather than after, and inside the same take of
        // the lock: a foreground that resumes between the two sees a token it
        // has not taken and re-reads, which costs a reload it could have
        // skipped. The other order loses the rows entirely, since it would
        // read the tiers before the token moved.
        if let Err(e) = engine.note_external_write() {
            log::warn!("[push] {activity_id} was written without a token: {e}");
        }
        if !engine.has_activity(activity_id) {
            return Ok((detail, false));
        }
        engine.index_new_activity(activity_id)?;
        Ok::<_, String>((detail, true))
    })
    .ok_or_else(|| "the engine is not open".to_string())??;
    crate::objects::observer::notify(crate::objects::observer::Announcement::BodyStored {
        kind: "activity_detail".to_string(),
        activity_id: activity_id.to_string(),
    });
    if !indexed {
        // The track's own store and index move the token again, inside the
        // take that does the indexing, so a foreground that already took the
        // first bump is told about this one too.
        fetch_and_index_json(activity_id, &detail.sport_type)?;
    }

    Ok(
        activity_notification_outcome(activity_id, &detail.name, announce_prs)?.map_err(
            |outcome| Quiet {
                outcome,
                activity_name: Some(detail.name.clone()),
            },
        ),
    )
}

/// A JSON string literal. The titles and bodies are translated and carry
/// whatever an athlete named a route, so quoting them is not optional.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::serial_global_state;

    #[test]
    fn the_summary_is_json_a_java_caller_can_read() {
        let json = index_summary_json(&crate::FfiIndexActivitySummary {
            matched_sections: 3,
            inserted_portions: 5,
            regrouped: true,
        });

        assert_eq!(
            json,
            "{\"matchedSections\":3,\"insertedPortions\":5,\"regrouped\":true}"
        );
    }

    /// Scenario: a data push cold-starts the process. Nothing has opened the
    /// engine, so the entry point has to.
    #[test]
    fn a_cold_start_opens_the_engine_at_the_path_it_was_given() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let db = tmp.path().join("routes.db");
        crate::persistence::clear_persistent_engine();

        prepare_native_session(&db.to_string_lossy(), "api_key", "a-secret", "i1")
            .expect("the session");

        assert!(crate::persistence::with_persistent_engine(|_| ()).is_some());
        assert!(db.exists(), "the file the handler named");
        assert!(
            crate::objects::current_transport().is_some(),
            "the credential the handler carried"
        );
        crate::persistence::clear_persistent_engine();
    }

    /// Scenario: a handler on an install whose JavaScript has never pushed a
    /// string bundle.
    ///
    /// Expected behaviour: no notification, rather than a body of raw keys,
    /// and the outcome says which of the two silent ones it was.
    #[test]
    fn a_handler_with_no_string_bundle_posts_nothing() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();

        assert_eq!(
            activity_notification_json("a1", "Morning Ride", true).expect("the engine"),
            None
        );
        assert_eq!(
            activity_notification_outcome("a1", "Morning Ride", true).expect("the engine"),
            Err(PushRunOutcome::NoStringBundle)
        );
    }

    /// Scenario: the ladder found nothing worth a push.
    ///
    /// Expected behaviour: the same `None`, so the generic tray entry the
    /// worker already posted is left standing rather than replaced by an empty
    /// line.
    #[test]
    fn a_ride_with_nothing_in_it_posts_nothing() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_notification_templates("en-AU", &bundle())
                .expect("the write");
        })
        .expect("the engine");

        assert_eq!(
            activity_notification_json("not-an-activity", "Morning Ride", true)
                .expect("the engine"),
            None
        );
        assert_eq!(
            activity_notification_outcome("not-an-activity", "Morning Ride", true)
                .expect("the engine"),
            Err(PushRunOutcome::NothingWorthPosting),
            "a quiet ride is not an install with no string bundle"
        );
    }

    /// The titles and bodies are translated and carry whatever an athlete
    /// named a route, so a quote in one must not end the JSON string.
    #[test]
    fn a_name_with_a_quote_in_it_is_escaped_rather_than_ending_the_string() {
        assert_eq!(json_string(r#"The "big" hill"#), r#""The \"big\" hill""#);
        assert_eq!(json_string("a\nb"), r#""a\nb""#);
        assert_eq!(json_string(r"back\slash"), r#""back\\slash""#);
    }

    /// Scenario: the switch and the section PR flag are one JSON row that
    /// JavaScript's preferences store persists through `setSetting`.
    ///
    /// Expected behaviour: an absent row, an unreadable row and `enabled:
    /// false` all mean post nothing. An enabled row carries the flag, and a
    /// row written before the categories existed reads as the store's
    /// default, which is on.
    #[test]
    fn the_gate_reads_the_row_the_preferences_store_wrote() {
        assert_eq!(handler_gate(None), None);
        assert_eq!(handler_gate(Some("not json")), None);
        assert_eq!(
            handler_gate(Some(r#"{"enabled":false,"categories":{"sectionPr":true}}"#)),
            None
        );
        assert_eq!(
            handler_gate(Some(r#"{"enabled":true,"categories":{"sectionPr":false}}"#)),
            Some(false)
        );
        assert_eq!(
            handler_gate(Some(r#"{"enabled":true,"categories":{"sectionPr":true}}"#)),
            Some(true)
        );
        assert_eq!(handler_gate(Some(r#"{"enabled":true}"#)), Some(true));
        assert_eq!(
            handler_gate(Some(r#"{"enabled":true,"categories":{}}"#)),
            Some(true)
        );
    }

    /// Scenario: an athlete who never turned notifications on uploads a ride
    /// that set a section record. The JS task returns before the ladder on
    /// `!prefs.enabled`, and the native worker has to do the same.
    ///
    /// Expected behaviour: nothing, with the row absent and with it written
    /// off, on a ride the ladder would otherwise have a sentence for. The gate
    /// is read before the transport is asked for, so neither reaches the
    /// network in a process with no credential.
    #[test]
    fn a_push_honours_the_switch_before_it_writes_a_sentence() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();
        crate::objects::clear_test_credentials();

        assert_eq!(activity_push_json("a1"), Ok(None), "no row");

        write_preferences(r#"{"enabled":false,"categories":{"sectionPr":true}}"#);
        assert_eq!(activity_push_json("a1"), Ok(None), "switch off");
    }

    /// Scenario: notifications are on and section PRs are off, and the ride's
    /// only story is a section PR. `activity_push_json` reads that flag off the
    /// row through `handler_gate` and hands it here.
    ///
    /// Expected behaviour: nothing. The flag reaches the ladder, which then
    /// has no rung left for this ride.
    #[test]
    fn the_sentence_honours_the_section_pr_flag() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();

        assert_eq!(
            activity_notification_json("a1", "Morning Ride", false).expect("the engine"),
            None
        );
    }

    /// Scenario: notifications are on and the row predates the category flags,
    /// so it carries none. `handler_gate` reads that as PRs on, which is
    /// asserted above, and the ladder is handed `true`.
    ///
    /// Expected behaviour: the section PR is announced.
    #[test]
    fn the_sentence_announces_a_section_pr_when_the_flag_is_on() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();

        let json = activity_notification_json("a1", "Morning Ride", true)
            .expect("the engine")
            .expect("a notification");

        assert!(json.contains("PR on Climb 1"), "{json}");
        assert!(json.contains("\"title\":\"New PR\""), "{json}");
    }

    /// Scenario: the tray holds only the placeholder and the phone is in
    /// hand. Which of the outcomes ended the run used to be a `log::info!`,
    /// which every device build drops at `Warn`.
    ///
    /// Expected behaviour: the run is in `push_runs` with the reason, where
    /// the Developer Dashboard reads it.
    #[test]
    fn a_push_records_why_it_posted_nothing() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();
        crate::objects::clear_test_credentials();
        write_preferences(r#"{"enabled":false,"categories":{"sectionPr":true}}"#);

        assert_eq!(activity_push_json("a1"), Ok(None));

        let recorded = runs::recent();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].activity_id, "a1");
        assert_eq!(recorded[0].outcome, "notifications-off");
    }

    /// Scenario: the gate is open and a step fails, which on a cold start is
    /// as ordinary as the phone being on a dead connection.
    ///
    /// Expected behaviour: the run carries the sentence the caller logs, so
    /// the failure is told apart from the three silent outcomes rather than
    /// reading as "nothing worth posting".
    #[test]
    fn a_failed_push_records_the_sentence_rather_than_a_silent_outcome() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();
        crate::objects::clear_test_credentials();
        write_preferences(r#"{"enabled":true}"#);

        assert!(
            activity_push_json("a1")
                .expect("a fallback, not an error")
                .is_some()
        );

        let recorded = runs::recent();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].outcome, "failed");
        assert!(
            recorded[0].detail.is_some(),
            "the reason, not just the word"
        );
    }

    /// Scenario: the engine is not open, which is a worker that skipped
    /// `prepare` or one whose `prepare` was refused.
    ///
    /// Expected behaviour: an error the worker logs, not a silent `None` that
    /// reads as "nothing worth posting".
    #[test]
    fn a_push_with_no_engine_is_told_so() {
        let _guard = serial_global_state();
        crate::persistence::clear_persistent_engine();

        assert!(activity_push_json("a1").is_err());
    }

    /// Scenario: an athlete who never turned notifications on uploads a ride
    /// that set a section record. The JS task returns before the ladder on
    /// `!prefs.enabled`, and the native worker has to do the same.
    ///
    /// Expected behaviour: nothing, with the row absent and with it written
    /// off, on a ride the ladder would otherwise have a sentence for.
    #[test]
    fn a_handler_honours_the_switch_before_it_writes_a_sentence() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();

        assert_eq!(
            activity_notification_for_handler("a1", "Morning Ride").expect("the engine"),
            None,
            "no row"
        );

        write_preferences(r#"{"enabled":false,"categories":{"sectionPr":true}}"#);
        assert_eq!(
            activity_notification_for_handler("a1", "Morning Ride").expect("the engine"),
            None,
            "switch off"
        );
    }

    /// Scenario: notifications are on and section PRs are off, and the ride's
    /// only story is a section PR.
    ///
    /// Expected behaviour: nothing. The flag reaches the ladder, which then
    /// has no rung left for this ride.
    #[test]
    fn a_handler_honours_the_section_pr_flag() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();

        write_preferences(r#"{"enabled":true,"categories":{"sectionPr":false}}"#);
        assert_eq!(
            activity_notification_for_handler("a1", "Morning Ride").expect("the engine"),
            None
        );
    }

    /// Scenario: notifications are on and the row predates the category
    /// flags, so it carries none.
    ///
    /// Expected behaviour: the section PR is announced, since the store's
    /// default for a missing category is on.
    #[test]
    fn a_handler_announces_a_section_pr_when_the_switch_is_on() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();

        write_preferences(r#"{"enabled":true}"#);
        let json = activity_notification_for_handler("a1", "Morning Ride")
            .expect("the engine")
            .expect("a notification");

        assert!(json.contains("PR on Climb 1"), "{json}");
        assert!(json.contains("\"title\":\"New PR\""), "{json}");
    }

    /// Scenario: the engine is not open, which is a worker that skipped
    /// `prepare` or one whose `prepare` was refused.
    ///
    /// Expected behaviour: an error the worker logs, not a silent `None` that
    /// reads as "nothing worth posting".
    #[test]
    fn a_handler_with_no_engine_is_told_so() {
        let _guard = serial_global_state();
        crate::persistence::clear_persistent_engine();

        assert!(activity_notification_for_handler("a1", "Morning Ride").is_err());
    }

    /// What JavaScript's `persist` writes, as `setSetting` hands it to the
    /// engine.
    fn write_preferences(json: &str) {
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_setting(
                    crate::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES,
                    json,
                )
                .expect("the write");
        })
        .expect("the engine");
    }

    /// The process-wide engine holding one ride over one section it holds the
    /// record on, with the string bundle pushed, so the only thing between the
    /// handler and a sentence is the gate.
    ///
    /// The same rows as the parity fixture in `notifications::tests`, seeded
    /// through the global engine because the entry under test reads through
    /// the pool that `persistent_engine_init` binds.
    fn global_engine_with_a_section_pr() -> tempfile::TempDir {
        use tracematch::GpsPoint;
        let tmp = crate::test_globals::init_global_engine("push_gate.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_notification_templates("en-AU", &bundle())
                .expect("the write");
            let coords: Vec<GpsPoint> = (0..8)
                .map(|i| GpsPoint {
                    latitude: 46.2 + f64::from(i) * 0.001,
                    longitude: 7.3,
                    elevation: None,
                })
                .collect();
            engine
                .add_activity("a1".to_string(), coords.clone(), "Ride".to_string())
                .expect("add activity");
            let polyline = serde_json::to_string(
                &coords
                    .iter()
                    .map(|p| [p.latitude, p.longitude])
                    .collect::<Vec<[f64; 2]>>(),
            )
            .expect("polyline");
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES ('s0', 'auto', 'Climb 1', 'Ride', ?, 400.0, 0, 1,
                        '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                    rusqlite::params![polyline],
                )
                .expect("the section");
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters)
                     VALUES ('s0', 'a1', 'same', 1, 5, 400.0)",
                    [],
                )
                .expect("the lap");
            engine
                .set_activity_metrics(vec![crate::ActivityMetrics {
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
        })
        .expect("the engine");
        tmp
    }

    /// The fifteen keys the push site resolves, as it stores them.
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
                "notifications.activityBody.fasterOnRoute",
                "Faster than usual on {{name}}",
            ),
            (
                "notifications.activityBody.fasterOnRouteDelta",
                "Faster than usual on {{name}} ({{delta}} off PR)",
            ),
            ("notifications.activityBody.onRoute", "On {{name}}"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    /// Scenario: the push lands while the app is in the foreground. The engine
    /// and the credential are JavaScript's, and both are fresher than what the
    /// handler carries.
    ///
    /// Expected behaviour: neither is replaced. Re-opening the file would swap
    /// the connection out from under the screens reading through it.
    #[test]
    fn a_warm_process_keeps_the_engine_and_the_credential_it_has() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let before =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_ids().len())
                .expect("the engine JavaScript opened");
        let other = tempfile::TempDir::new().expect("tempdir");
        let unused = other.path().join("routes.db");

        prepare_native_session(&unused.to_string_lossy(), "api_key", "b-secret", "i2")
            .expect("the session");

        assert!(!unused.exists(), "the handler's path is not opened");
        let after =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_ids().len())
                .expect("the same engine");
        assert_eq!(after, before);
    }

    /// The detail body a push fetches, as intervals.icu sends it, trimmed to
    /// the fields the row and the sentence take.
    fn detail_body(id: &str, name: &str, start: Option<&str>) -> String {
        let start = start
            .map(|s| format!(r#","start_date_local":"{s}""#))
            .unwrap_or_default();
        format!(
            r#"{{"id":"{id}","name":"{name}","type":"Run","moving_time":1800,"distance":5000.5{start}}}"#
        )
    }

    /// Scenario: the worker fetched the detail body for an activity the
    /// library has never seen.
    ///
    /// Expected behaviour: the metrics row exists and is dated, so the ladder
    /// can call a lap a record, and the body is readable under the push's id.
    #[test]
    fn recording_the_detail_writes_the_dated_metrics_row_and_the_body() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let body = detail_body("i9", "Evening Run", Some("2026-09-17T18:30:00"));

        let detail = crate::persistence::with_persistent_engine(|engine| {
            record_activity_detail(engine, "i9", &body)
        })
        .expect("the engine")
        .expect("the record");

        assert_eq!(
            detail,
            ActivityDetail {
                name: "Evening Run".to_string(),
                sport_type: "Run".to_string()
            }
        );
        let (name, date, moving, sport): (String, i64, u32, String) =
            crate::persistence::with_persistent_engine(|engine| {
                engine
                    .db
                    .query_row(
                        "SELECT name, date, moving_time, sport_type FROM activity_metrics
                         WHERE activity_id = 'i9'",
                        [],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .expect("the row")
            })
            .expect("the engine");
        assert_eq!(name, "Evening Run");
        assert_eq!(date, 1_789_669_800);
        assert_eq!(moving, 1800);
        assert_eq!(sport, "Run");
        let stored =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_body("i9"))
                .expect("the engine");
        assert_eq!(stored.as_deref(), Some(body.as_str()));
    }

    /// Scenario: the body carries no start date, so there is nothing to date
    /// the lap with. A row dated zero would put the ride before every other
    /// and make every lap on it a record.
    #[test]
    fn a_body_with_no_start_date_records_nothing() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let body = detail_body("i9", "Evening Run", None);

        let outcome = crate::persistence::with_persistent_engine(|engine| {
            record_activity_detail(engine, "i9", &body)
        })
        .expect("the engine");

        assert!(outcome.is_err());
        let rows: i64 = crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .query_row(
                    "SELECT count(*) FROM activity_metrics WHERE activity_id = 'i9'",
                    [],
                    |r| r.get(0),
                )
                .expect("the count")
        })
        .expect("the engine");
        assert_eq!(rows, 0);
    }

    /// Scenario: the athlete turned notifications off in Settings, and a push
    /// lands for a ride. Nothing has set a credential in this process.
    ///
    /// Expected behaviour: nothing is posted and nothing is fetched. The gate
    /// is read before the transport is asked for, so the missing credential is
    /// never reached.
    #[test]
    fn a_push_with_notifications_off_posts_nothing_and_fetches_nothing() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::objects::clear_test_credentials();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_setting("veloq-notification-preferences", r#"{"enabled":false}"#)
                .expect("the write");
        })
        .expect("the engine");

        assert_eq!(activity_push_json("i9"), Ok(None));
    }

    /// Scenario: the same push with notifications on, in a process where no
    /// credential was set and the worker's read of the store found none.
    ///
    /// Expected behaviour: a plain entry all the same. Since the server stopped
    /// sending the placeholder to Android, this handler is the only thing that
    /// posts, and a failed step would otherwise leave a ride that reached the
    /// phone with no entry at all. The reason is in the recorded run.
    #[test]
    fn a_push_that_fails_past_the_gate_still_posts_a_plain_entry() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::objects::clear_test_credentials();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_setting("veloq-notification-preferences", r#"{"enabled":true}"#)
                .expect("the write");
        })
        .expect("the engine");

        let json = activity_push_json("i9")
            .expect("not an error the worker drops")
            .expect("an entry");

        assert!(json.contains(FALLBACK_TITLE), "{json}");
        assert_eq!(
            runs::recent()[0].detail.as_deref(),
            Some("no credentials set"),
            "the reason is recorded rather than shown"
        );
    }

    /// Scenario: the ladder found nothing on an ordinary ride. The string
    /// bundle is stored, so the entry can be the athlete's own language.
    ///
    /// Expected behaviour: the stored "Activity Recorded" title and the ride's
    /// name, not the English constant.
    #[test]
    fn a_fallback_entry_uses_the_stored_title_when_there_is_one() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_notification_templates("en-AU", &bundle())
                .expect("the write");
        })
        .expect("the engine");

        let json = fallback_notification_json(Some("Morning Ride"));

        assert!(json.contains("\"title\":\"Activity Recorded\""), "{json}");
        assert!(json.contains("Morning Ride"), "{json}");
    }

    /// Scenario: a push lands before the first full launch of a fresh install,
    /// so nothing has pushed a string bundle and there is nothing to translate
    /// with.
    ///
    /// Expected behaviour: the entry is still posted, under the English
    /// constant, and it still names the ride.
    #[test]
    fn a_fallback_entry_with_no_string_bundle_still_names_the_ride() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();

        let json = fallback_notification_json(Some("Morning Ride"));

        assert!(json.contains(FALLBACK_TITLE), "{json}");
        assert!(json.contains("\"body\":\"Morning Ride\""), "{json}");
    }

    /// Scenario: the run failed before it read the detail body, so not even
    /// the ride's name is known.
    ///
    /// Expected behaviour: a title and an empty body. The tap target is the
    /// activity id, which the poster carries either way, so the athlete can
    /// still open the ride from the tray.
    #[test]
    fn a_fallback_entry_with_no_name_is_still_postable() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();

        let json = fallback_notification_json(None);

        assert_eq!(
            json,
            format!("{{\"title\":\"{FALLBACK_TITLE}\",\"body\":\"\"}}")
        );
    }

    /// The athlete's own choice is the one outcome that stays silent. A
    /// fallback here would post the entry they turned off.
    #[test]
    fn notifications_off_is_the_one_outcome_that_posts_nothing() {
        let _guard = serial_global_state();
        let _tmp = global_engine_with_a_section_pr();
        crate::objects::clear_test_credentials();
        write_preferences(r#"{"enabled":false,"categories":{"sectionPr":true}}"#);

        assert_eq!(activity_push_json("a1"), Ok(None));
    }
}
