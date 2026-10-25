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
        crate::objects::observer::notify(crate::objects::observer::Announcement::BodyStored {
            kind: RIDE_NOTIFICATION.to_string(),
            activity_id: key.to_string(),
        });
    }
    posts
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
    fn a_webhook_after_the_pull_for_the_same_ride_posts_nothing() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":true}"#);
        let install = crate::persistence::engine_install();
        store_stub("i900", "7001");

        assert!(announce_pulled_ride(install, KEY, "Morning Ride"));
        let answer = webhook_for("i900").expect("the push is answered");

        assert_eq!(answer["repeat"], true, "{answer}");
        assert_eq!(posted_runs("i900"), 0);
    }

    #[test]
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
    fn notifications_off_announces_nothing() {
        let _guard = serial_global_state();
        let _tmp = engine_with(r#"{"enabled":false}"#);
        let install = crate::persistence::engine_install();

        assert!(!announce_pulled_ride(install, KEY, "Morning Ride"));
        assert_eq!(posted_runs(KEY), 0);
    }

    #[test]
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
