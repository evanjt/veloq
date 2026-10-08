//! The refresh a native caller makes with the app closed: open the engine,
//! pull the last fortnight of wellness, compose the widget snapshot.
//!
//! One owner for that sequence, so the JNI and the C entry both marshal into it
//! and neither decides anything. The snapshot reads stored rows only, so a
//! refresh that skipped the pull would redraw the form and fitness of the last
//! foreground sync under a button that says it refreshed.
//!
//! A pull that cannot complete does not cost the caller its widget: the
//! snapshot is composed from the stored rows and the status says why the pull
//! did not land, so the caller writes the file and shows the age honestly.
//! There is no snapshot to compose, and the caller keeps the file it has, when
//! the engine will not open or the app has never stored a context.

use std::time::Duration;

use crate::net::NetError;
use crate::objects::{WELLNESS_REFRESH_DAYS, refresh_wellness};
use crate::push::{
    open_native_engine, prepare_native_session, prepare_native_session_from_keychain,
};
use crate::widget_snapshot::{
    native_snapshot_json, native_snapshot_json_as_of_last_sync, stored_context,
};

/// How long a refresh waits for the wellness pull. The caller is a widget
/// button or a background slot, and a pull that outlasts this is answered from
/// the stored rows rather than holding the process.
pub const PULL_DEADLINE: Duration = Duration::from_secs(15);

/// What happened to the wellness pull, in the words the caller writes beside
/// the snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullStatus {
    /// The last fortnight of wellness was fetched and stored.
    Pulled,
    /// The server refused the credential, so the snapshot is from stored rows.
    Expired,
    /// The pull did not finish inside the deadline.
    TimedOut,
    /// The server or the network failed the pull.
    Failed,
    /// There was no credential to pull with, so nothing was asked.
    NoCredential,
}

impl PullStatus {
    /// The token the native callers read.
    pub fn token(self) -> &'static str {
        match self {
            PullStatus::Pulled => "pulled",
            PullStatus::Expired => "expired",
            PullStatus::TimedOut => "timed_out",
            PullStatus::Failed => "failed",
            PullStatus::NoCredential => "no_credential",
        }
    }
}

/// A composed snapshot and what became of the pull behind it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WidgetRefresh {
    pub status: PullStatus,
    pub snapshot_json: String,
}

impl WidgetRefresh {
    /// `{"status": <token>, "snapshot": <the snapshot object>}`, the one string
    /// that crosses to the native caller.
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"status":"{}","snapshot":{}}}"#,
            self.status.token(),
            self.snapshot_json
        )
    }
}

/// The credential a native caller holds, in the shape its platform gives it.
#[derive(Debug, Clone, Copy)]
pub enum NativeCredential<'a> {
    /// A method and a secret, as the Android worker stores them.
    Method {
        method: &'a str,
        secret: &'a str,
        athlete_id: &'a str,
    },
    /// The keychain items as read, any of them absent, as the iOS side holds
    /// them. The choice between them is the push session's.
    Keychain {
        access_token: Option<&'a str>,
        api_key: Option<&'a str>,
        athlete_id: Option<&'a str>,
    },
}

/// Refresh the widget snapshot for a caller with no JavaScript. None when the
/// engine will not open or no context has been stored, and then the caller
/// keeps the file it has.
pub fn refresh_snapshot(db_path: &str, credential: NativeCredential<'_>) -> Option<WidgetRefresh> {
    refresh_snapshot_within(db_path, credential, PULL_DEADLINE)
}

fn refresh_snapshot_within(
    db_path: &str,
    credential: NativeCredential<'_>,
    deadline: Duration,
) -> Option<WidgetRefresh> {
    if prepare(db_path, credential).is_err() {
        // A credential the session could not take still leaves an engine that
        // opens, and the stored rows are worth a snapshot.
        open_native_engine(db_path).ok()?;
    }
    refresh_open_engine(deadline)
}

/// Open the engine and set the credential, leaving both alone where the app
/// already holds them.
fn prepare(db_path: &str, credential: NativeCredential<'_>) -> Result<(), String> {
    match credential {
        NativeCredential::Method {
            method,
            secret,
            athlete_id,
        } => prepare_native_session(db_path, method, secret, athlete_id),
        NativeCredential::Keychain {
            access_token,
            api_key,
            athlete_id,
        } => prepare_native_session_from_keychain(db_path, access_token, api_key, athlete_id),
    }
}

/// The pull and the compose, against whatever engine and credential the
/// process holds. The context is checked first so a library the app has never
/// described costs no request.
fn refresh_open_engine(deadline: Duration) -> Option<WidgetRefresh> {
    let has_context =
        crate::persistence::read_pool::with_read_conn(|conn| stored_context(conn).is_some())?;
    if !has_context {
        return None;
    }

    let status = match crate::objects::current_session() {
        Some(Ok((transport, athlete_id))) => {
            let install = crate::persistence::engine_install();
            let pull = refresh_wellness(install, &transport, &athlete_id, WELLNESS_REFRESH_DAYS);
            match crate::runtime::block_on(async { tokio::time::timeout(deadline, pull).await }) {
                Ok(Ok(())) => PullStatus::Pulled,
                Ok(Err(NetError::Unauthorized)) => PullStatus::Expired,
                Ok(Err(e)) => {
                    log::warn!("[widget] the wellness pull failed: {e}");
                    PullStatus::Failed
                }
                Err(_) => PullStatus::TimedOut,
            }
        }
        Some(Err(_)) | None => PullStatus::NoCredential,
    };

    // A snapshot the pull did not refresh is the last sync's rows redrawn, and
    // says so rather than carrying the time of the redraw as if it were current.
    let snapshot_json = match status {
        PullStatus::Pulled => native_snapshot_json()?,
        _ => native_snapshot_json_as_of_last_sync()?,
    };
    Some(WidgetRefresh {
        status,
        snapshot_json,
    })
}

#[cfg(test)]
mod tests;
