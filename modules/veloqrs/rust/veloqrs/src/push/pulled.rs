//! The post-ride notification for a Garmin ride the phone pulled itself.
//!
//! intervals.icu announces a ride through a webhook the worker turns into a
//! push. A Garmin ride it serves as a stub may never be announced that way, so
//! the pull that stores the original announces it. The entry is built by the
//! same function the push builds it with and recorded in the same table, so
//! the ride is announced once whichever route reaches the phone first: the
//! record of one row of the ride stops the other.

use super::{PushRunOutcome, activity_notification_entry, fallback_entry, handler_gate, runs};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};

/// How old a ride may be, from its start, and still be announced when the pull
/// stores it. The backfill and the first window reach back months: those rides
/// are history, not news.
const ANNOUNCE_WITHIN: Duration = Duration::hours(48);

/// Whether a ride that started at `start_gmt` (Garmin's `YYYY-MM-DD HH:MM:SS`
/// in UTC) is recent enough to announce at `now`. A start that cannot be read
/// is not announced.
pub(crate) fn is_recent(start_gmt: Option<&str>, now: DateTime<Utc>) -> bool {
    let Some(start) = start_gmt
        .and_then(|t| NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").ok())
        .map(|t| t.and_utc())
    else {
        return false;
    };
    start <= now && now - start <= ANNOUNCE_WITHIN
}

/// Announce the stored Garmin ride `key`, once. Returns whether an entry was
/// put forward for the app to post: false when notifications are off, or when
/// a run for any row of this ride already put an entry in the tray.
pub(crate) fn announce_pulled_ride(install: u64, key: &str, name: &str) -> bool {
    let row = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES,
        )
        .ok()
        .flatten()
    })
    .flatten();
    let Some((announce_prs, announce_milestones)) = handler_gate(row.as_deref()) else {
        return false;
    };
    let (outcome, entry, detail) =
        match activity_notification_entry(key, name, announce_prs, announce_milestones) {
            Ok(Ok(entry)) => (PushRunOutcome::Posted, entry, None),
            Ok(Err(outcome)) => (outcome, fallback_entry(Some(name)), None),
            Err(e) => (PushRunOutcome::Failed, fallback_entry(Some(name)), Some(e)),
        };
    let posts = runs::settle_for(
        install,
        key,
        outcome,
        detail.as_deref(),
        &entry.title,
        &entry.body,
    );
    if posts {
        // Recorded owed until the app confirms it presented the entry: a
        // presentation that fails, or a process that dies first, leaves the
        // ride owed, so a later push still posts and a registration presents
        // it again.
        runs::mark_owed(install, key);
        if crate::objects::observer::is_registered() {
            crate::objects::observer::notify(crate::objects::observer::Announcement::BodyStored {
                kind: RIDE_NOTIFICATION.to_string(),
                activity_id: key.to_string(),
            });
        }
    }
    posts
}

/// Present the rides still owed, now that an observer is registered. A ride
/// stays owed until `confirm_pulled_ride_posted`, so one the app failed to
/// present is presented again. Called at registration.
pub(crate) fn present_owed_rides() {
    for key in runs::owed_rides(crate::persistence::engine_install()) {
        crate::objects::observer::notify(crate::objects::observer::Announcement::BodyStored {
            kind: RIDE_NOTIFICATION.to_string(),
            activity_id: key,
        });
    }
}

/// Record that the app presented the entry for the pulled ride `key`, with the
/// title and body it showed. The ride is announced from here on, and a later
/// push for it posts nothing.
pub(crate) fn confirm_pulled_ride_posted(install: u64, key: &str, title: &str, body: &str) {
    runs::confirm_posted(install, key, title, body);
}

/// The title and body recorded for the pulled ride `key` when it was
/// announced: the entry the app posts. Whatever the ladder found, a plain entry
/// included, is what was recorded, so the app presents this rather than
/// building the entry a second time and finding a quiet ride empty. `None`
/// when no entry was recorded for the ride.
pub(crate) fn recorded_entry(key: &str) -> Option<crate::FfiPulledRideEntry> {
    crate::persistence::read_pool::with_read_conn(|conn| {
        conn.query_row(
            "SELECT posted_title, posted_body FROM push_runs
             WHERE activity_id = ? AND posted_title IS NOT NULL
             ORDER BY ts DESC, id DESC LIMIT 1",
            [key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            },
        )
        .ok()
    })
    .flatten()
    .map(|(title, body)| crate::FfiPulledRideEntry { title, body })
}

/// The entry recorded for a pulled ride, as the app presents it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiPulledRideEntry {
    pub title: String,
    pub body: String,
}

/// The `body_stored` kind that tells the app a pulled ride has an entry to post.
pub(crate) const RIDE_NOTIFICATION: &str = "ride_notification";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::serial_global_state;

    const KEY: &str = "src-garmin-7001";

    fn engine_with(preferences: &str) -> tempfile::TempDir {
        let tmp = crate::test_globals::seeded_global_engine();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .set_setting(
                    crate::persistence::settings::settings_keys::NOTIFICATION_PREFERENCES,
                    preferences,
                )
                .expect("the preferences");
        })
        .expect("the engine");
        tmp
    }

    /// An intervals.icu stub of the ride: it names the Garmin id and nothing else.
    fn store_stub(id: &str, external: &str) {
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute(
                    "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 0, ?2)",
                    rusqlite::params![
                        id,
                        format!(r#"{{"id":"{id}","source":"GARMIN_CONNECT","external_id":"{external}"}}"#)
                    ],
                )
                .expect("the stub");
        })
        .expect("the engine");
    }

    fn posted_runs(id: &str) -> i64 {
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .query_row(
                    "SELECT COUNT(*) FROM push_runs WHERE activity_id = ?1 AND posted_title IS NOT NULL",
                    [id],
                    |row| row.get(0),
                )
                .expect("the count")
        })
        .expect("the engine")
    }

    fn webhook_for(id: &str) -> Option<serde_json::Value> {
        crate::objects::clear_test_credentials();
        super::super::activity_push_json(id, "i1")
            .expect("an answer")
            .map(|json| serde_json::from_str(&json).expect("json"))
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_pulled_ride_no_push_announced_posts_one_entry() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        assert_eq!(posted_runs(KEY), 1);
    }

    #[test]
    fn the_same_pulled_ride_is_not_announced_twice() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        assert!(!announce_pulled_ride(install, KEY, "Morning Ride"));
        assert_eq!(posted_runs(KEY), 1);
    }

    #[test]
    fn a_quiet_pulled_ride_records_its_plain_entry_for_the_app_to_present() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();

        assert_eq!(
            recorded_entry(KEY),
            None,
            "nothing is recorded before the announcement"
        );
        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));

        let entry = recorded_entry(KEY).expect("the recorded entry");
        assert!(!entry.title.is_empty());
        assert_eq!(entry.body, "Morning Ride");
    }

    #[test]
    fn a_webhook_after_a_confirmed_post_for_the_same_ride_posts_nothing() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        crate::objects::observer::set_observer(Some(
            crate::objects::observer::recorder::Recorder::new(),
        ));
        store_stub("i900", "7001");

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        let entry = recorded_entry(KEY).expect("the recorded entry");
        confirm_pulled_ride_posted(install, KEY, &entry.title, &entry.body);
        let answer = webhook_for("i900").expect("the push is answered");

        assert_eq!(answer["repeat"], true, "{answer}");
        assert_eq!(posted_runs("i900"), 0);
        crate::objects::observer::set_observer(None);
    }

    #[test]
    fn a_ride_announced_to_an_observer_but_never_confirmed_still_posts_on_a_webhook() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        crate::objects::observer::set_observer(Some(
            crate::objects::observer::recorder::Recorder::new(),
        ));
        store_stub("i900", "7001");

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        let answer = webhook_for("i900").expect("the push is answered");

        assert_eq!(answer.get("repeat"), None, "{answer}");
        assert_eq!(posted_runs("i900"), 1);
        crate::objects::observer::set_observer(None);
    }

    #[test]
    fn an_unconfirmed_ride_is_presented_again_at_registration_until_confirmed() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        let first = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(first.clone()));

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        crate::objects::observer::set_observer(None);

        let second = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(second.clone()));
        crate::push::present_owed_rides();
        assert_eq!(
            second.events(),
            vec![format!("body_stored:{RIDE_NOTIFICATION}:{KEY}")]
        );

        confirm_pulled_ride_posted(install, KEY, "Ride recorded", "Morning Ride");
        crate::push::present_owed_rides();
        assert_eq!(
            second.events().len(),
            1,
            "a confirmed ride is not presented again"
        );
        crate::objects::observer::set_observer(None);
    }

    #[test]
    fn confirming_records_the_text_the_app_presented() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        confirm_pulled_ride_posted(install, KEY, "Shown title", "Shown body");

        assert_eq!(
            recorded_entry(KEY),
            Some(crate::FfiPulledRideEntry {
                title: "Shown title".into(),
                body: "Shown body".into()
            })
        );
        assert_eq!(posted_runs(KEY), 1);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_ride_pulled_with_no_observer_is_owed_and_a_later_webhook_still_posts() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        crate::objects::observer::set_observer(None);
        store_stub("i900", "7001");

        announce_pulled_ride(install, KEY, "Morning Ride");
        let answer = webhook_for("i900").expect("the push is answered");

        assert_eq!(answer.get("repeat"), None, "{answer}");
        assert_eq!(posted_runs("i900"), 1);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_ride_owed_is_presented_when_an_observer_registers() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        crate::objects::observer::set_observer(None);

        announce_pulled_ride(install, KEY, "Morning Ride");
        let recorder = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(recorder.clone()));
        crate::push::present_owed_rides();

        assert_eq!(
            recorder.events(),
            vec![format!("body_stored:{RIDE_NOTIFICATION}:{KEY}")]
        );
        confirm_pulled_ride_posted(install, KEY, "Ride recorded", "Morning Ride");
        crate::push::present_owed_rides();
        assert_eq!(
            recorder.events().len(),
            1,
            "a confirmed ride is not presented again"
        );
        crate::objects::observer::set_observer(None);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_webhook_first_leaves_the_pull_nothing_to_announce() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        store_stub("i900", "7001");

        let answer = webhook_for("i900").expect("the push is answered");
        assert_eq!(answer.get("repeat"), None, "{answer}");

        assert!(!announce_pulled_ride(install, KEY, "Morning Ride"));
        assert_eq!(posted_runs(KEY), 0);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn another_garmin_ride_is_announced_on_its_own() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        store_stub("i900", "7001");

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        assert!(announce_pulled_ride(
            install,
            "src-garmin-7002",
            "Evening Ride"
        ));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn notifications_off_announces_nothing() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":false}"#);
        let install = crate::persistence::engine_install();

        assert!(!announce_pulled_ride(install, KEY, "Morning Ride"));
        assert_eq!(posted_runs(KEY), 0);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn only_a_ride_from_the_last_two_days_is_news() {
        let now = DateTime::parse_from_rfc3339("2026-10-25T12:00:00Z")
            .expect("a time")
            .with_timezone(&Utc);
        assert!(is_recent(Some("2026-10-25 08:00:00"), now));
        assert!(is_recent(Some("2026-10-23 12:00:01"), now));
        assert!(!is_recent(Some("2026-10-23 11:59:59"), now));
        assert!(
            !is_recent(Some("2026-10-26 08:00:00"), now),
            "a start in the future"
        );
        assert!(!is_recent(Some("not a time"), now));
        assert!(!is_recent(None, now));
    }
}
