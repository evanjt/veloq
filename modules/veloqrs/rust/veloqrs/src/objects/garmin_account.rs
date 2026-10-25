//! What Garmin's account says about the key the athlete connected: the name on
//! it, and how the rides of the last thirty days line up with intervals.icu.
//!
//! Garmin is asked for the name and for the window's rides, intervals.icu for
//! its activities in the same window, and the Garmin ids of the rides are
//! compared with the ids intervals.icu holds for its Garmin imports. The
//! judgement is made here, once, and every surface shows it. Nothing is
//! stored: the name is shown and dropped, and the match is read again on each
//! connect.

use std::collections::HashSet;
use std::future::Future;

use chrono::{Duration, Local};

use crate::net::garmin::{GarminClient, dispatch};
use crate::net::intervals::wire::ListedActivity;
use crate::persistence::origin::garmin_id_named;

/// How many days before today the match looks, as the first window of the
/// Garmin pull does.
const WINDOW_DAYS: i64 = 30;

/// What the window's rides show about the account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum GarminMatch {
    /// Nothing to say: no Garmin ride in the window, intervals.icu could not be
    /// read, or none of the rides are held there and its Garmin import is off.
    Silent,
    /// The rides intervals.icu holds are all there is to say. `matched_count`
    /// is how many of the window's Garmin rides it holds.
    Matched,
    /// Garmin rides in the window that intervals.icu does not hold, while its
    /// Garmin import is on: the key may belong to another account.
    WrongAccount,
}

/// The account behind the key Garmin accepted.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GarminAccount {
    /// The name Garmin gives the account, when its settings name one.
    pub display_name: Option<String>,
    pub matched: GarminMatch,
    /// How many of the window's Garmin rides intervals.icu holds.
    pub matched_count: u32,
}

/// Judge the window: `garmin_ids` are the Garmin rides of the window, and
/// `intervals` the activities intervals.icu holds in the same window. Returns
/// the verdict and how many of the Garmin rides intervals.icu holds.
pub(crate) fn judge(
    garmin_ids: &[i64],
    intervals: &[ListedActivity],
    import_on: bool,
) -> (GarminMatch, u32) {
    let garmin: HashSet<i64> = garmin_ids.iter().copied().collect();
    if garmin.is_empty() {
        return (GarminMatch::Silent, 0);
    }
    let held: HashSet<i64> = intervals
        .iter()
        .filter_map(|a| garmin_id_named(a.source.as_deref(), a.external_id.as_deref()))
        .collect();
    let matched = garmin.iter().filter(|id| held.contains(*id)).count();
    let unheld = garmin.len() - matched;
    let matched = matched as u32;
    if unheld == 0 {
        (GarminMatch::Matched, matched)
    } else if import_on {
        (GarminMatch::WrongAccount, matched)
    } else if matched > 0 {
        (GarminMatch::Matched, matched)
    } else {
        (GarminMatch::Silent, 0)
    }
}

/// The account behind the key held in this process, or `None` when no key is
/// held.
pub(crate) async fn garmin_account() -> Option<GarminAccount> {
    let client = super::garmin_key::GARMIN_KEY.client()?;
    let import_on = crate::objects::error::with_reader(|conn| {
        crate::persistence::settings::athlete_profile(conn)
            .and_then(|profile| profile.garmin_syncs_activities)
    })
    .ok()
    .flatten()
    .unwrap_or(false);
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::runtime::spawn(async move {
        let account = read_account(&client, import_on, |oldest, newest| {
            crate::objects::sync::activities_for_garmin_match(oldest, newest)
        })
        .await;
        let _ = tx.send(account);
    });
    rx.await.ok()
}

/// The account as Garmin and intervals.icu answer for the window. `intervals`
/// reads intervals.icu's activities between two local days, and is not asked
/// when Garmin lists no ride.
async fn read_account<F, Fut>(client: &GarminClient, import_on: bool, intervals: F) -> GarminAccount
where
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Option<Vec<ListedActivity>>>,
{
    let display_name = client.display_name(dispatch()).await.ok().flatten();
    let silent = GarminAccount {
        display_name: display_name.clone(),
        matched: GarminMatch::Silent,
        matched_count: 0,
    };
    let today = Local::now().date_naive();
    let oldest = (today - Duration::days(WINDOW_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    let newest = today.format("%Y-%m-%d").to_string();
    let Ok(rides) = client.list_activities(&oldest, &newest, dispatch()).await else {
        return silent;
    };
    let garmin_ids: Vec<i64> = rides.iter().map(|ride| ride.activity_id).collect();
    if garmin_ids.is_empty() {
        return silent;
    }
    let Some(listed) = intervals(oldest, newest).await else {
        return silent;
    };
    let (matched, matched_count) = judge(&garmin_ids, &listed, import_on);
    GarminAccount {
        display_name,
        matched,
        matched_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{Governor, NoopPolicy};
    use base64::Engine;
    use chrono::Utc;
    use serde_json::json;
    use std::sync::Arc;

    fn intervals(source: Option<&str>, external: Option<&str>) -> ListedActivity {
        ListedActivity {
            id: "i1".into(),
            external_id: external.map(str::to_string),
            source: source.map(str::to_string),
            ..ListedActivity::default()
        }
    }

    #[test]
    fn every_garmin_ride_of_the_window_held_by_intervals_matches_with_its_count() {
        let held = [
            intervals(Some("GARMIN_CONNECT"), Some("910000001")),
            intervals(Some("GARMIN_CONNECT"), Some("910000002")),
        ];
        assert_eq!(
            judge(&[910000001, 910000002], &held, true),
            (GarminMatch::Matched, 2)
        );
        assert_eq!(
            judge(&[910000001, 910000002], &held, false),
            (GarminMatch::Matched, 2)
        );
    }

    #[test]
    fn rides_none_of_which_intervals_holds_warn_of_the_wrong_account_while_its_import_is_on() {
        let held = [intervals(Some("GARMIN_CONNECT"), Some("999"))];
        assert_eq!(
            judge(&[1, 2, 3], &held, true),
            (GarminMatch::WrongAccount, 0)
        );
    }

    #[test]
    fn a_partly_held_window_warns_while_the_import_is_on_and_counts_what_is_held() {
        let held = [intervals(Some("GARMIN_CONNECT"), Some("1"))];
        assert_eq!(judge(&[1, 2], &held, true), (GarminMatch::WrongAccount, 1));
    }

    #[test]
    fn a_partly_held_window_with_the_import_off_counts_what_is_held_without_warning() {
        let held = [intervals(Some("GARMIN_CONNECT"), Some("1"))];
        assert_eq!(judge(&[1, 2], &held, false), (GarminMatch::Matched, 1));
    }

    #[test]
    fn nothing_held_with_the_import_off_says_nothing() {
        assert_eq!(judge(&[1, 2], &[], false), (GarminMatch::Silent, 0));
    }

    #[test]
    fn an_empty_window_says_nothing_even_while_the_import_is_on() {
        let held = [intervals(Some("GARMIN_CONNECT"), Some("1"))];
        assert_eq!(judge(&[], &held, true), (GarminMatch::Silent, 0));
        assert_eq!(judge(&[], &[], true), (GarminMatch::Silent, 0));
    }

    #[test]
    fn a_digit_external_id_from_another_source_is_not_a_garmin_id() {
        let other = [intervals(Some("STRAVA"), Some("910000001"))];
        assert_eq!(
            judge(&[910000001], &other, true),
            (GarminMatch::WrongAccount, 0)
        );
    }

    #[test]
    fn an_upload_of_a_garmin_original_names_its_id_whatever_the_source() {
        let uploaded = [intervals(Some("STRAVA"), Some("garmin:910000001"))];
        assert_eq!(
            judge(&[910000001], &uploaded, true),
            (GarminMatch::Matched, 1)
        );
    }

    fn client(server: &httpmock::MockServer) -> GarminClient {
        let gov = Arc::new(
            Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(std::time::Duration::ZERO),
        );
        GarminClient::with_governor(server.base_url(), "pasted-key", gov)
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

    fn mock_garmin(server: &httpmock::MockServer, rides: &[i64]) {
        let token = token();
        server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/personalapitoken-service/personal-api/personal-api-key/token");
            then.status(200).body(&token);
        });
        server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/userprofile-service/userprofile/settings");
            then.status(200)
                .json_body(json!({"displayName": "Invented Athlete"}));
        });
        let listed: Vec<_> = rides
            .iter()
            .map(|id| json!({"activityId": id, "activityType": {"typeKey": "cycling"}}))
            .collect();
        server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/activitylist-service/activities/search/activities");
            then.status(200).json_body(json!(listed));
        });
    }

    #[test]
    fn a_key_whose_window_rides_intervals_holds_names_the_account_and_counts_them() {
        let server = httpmock::MockServer::start();
        mock_garmin(&server, &[910000001, 910000003]);
        let held = vec![
            intervals(Some("GARMIN_CONNECT"), Some("910000001")),
            intervals(Some("GARMIN_CONNECT"), Some("910000003")),
        ];
        let account = crate::runtime::block_on(read_account(&client(&server), true, |_, _| {
            let held = held.clone();
            async move { Some(held) }
        }));
        assert_eq!(
            account,
            GarminAccount {
                display_name: Some("Invented Athlete".into()),
                matched: GarminMatch::Matched,
                matched_count: 2,
            }
        );
    }

    #[test]
    fn a_window_whose_rides_intervals_does_not_hold_warns_while_its_import_is_on() {
        let server = httpmock::MockServer::start();
        mock_garmin(&server, &[910000001]);
        let account =
            crate::runtime::block_on(read_account(&client(&server), true, |_, _| async {
                Some(Vec::new())
            }));
        assert_eq!(account.matched, GarminMatch::WrongAccount);
        assert_eq!(account.matched_count, 0);
        assert_eq!(account.display_name.as_deref(), Some("Invented Athlete"));
    }

    #[test]
    fn an_empty_window_names_the_account_and_does_not_ask_intervals() {
        let server = httpmock::MockServer::start();
        mock_garmin(&server, &[]);
        let asked = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = asked.clone();
        let account =
            crate::runtime::block_on(read_account(&client(&server), true, move |_, _| {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                async { Some(Vec::new()) }
            }));
        assert_eq!(
            account,
            GarminAccount {
                display_name: Some("Invented Athlete".into()),
                matched: GarminMatch::Silent,
                matched_count: 0,
            }
        );
        assert!(!asked.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn a_key_garmin_refuses_names_no_account_and_says_nothing() {
        let server = httpmock::MockServer::start();
        server.mock(|when, then| {
            when.method(httpmock::Method::POST);
            then.status(401);
        });
        let account =
            crate::runtime::block_on(read_account(&client(&server), true, |_, _| async {
                Some(Vec::new())
            }));
        assert_eq!(
            account,
            GarminAccount {
                display_name: None,
                matched: GarminMatch::Silent,
                matched_count: 0,
            }
        );
    }
}
