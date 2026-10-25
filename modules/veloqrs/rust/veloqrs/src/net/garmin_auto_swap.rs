//! Swapping Garmin's file into each new Garmin ride on intervals.icu, when the
//! athlete has switched that on.
//!
//! The switch is a settings row whose value is the moment it was turned on, so
//! "never a ride imported before the switch" needs no second row. A pass runs
//! after a sync, looks at the rides intervals.icu imported from Garmin in the
//! last 48 hours, and hands each one not yet handled to the per-ride swap in
//! [`super::garmin_swap`], which keeps the earlier file and reads the new one
//! back. The first refusal or mismatch turns the switch off and keeps the
//! reason. Nothing here looks at history older than the window.

use chrono::{DateTime, Duration, Utc};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

static ACTIVE: AtomicBool = AtomicBool::new(false);

use crate::net::garmin_swap::{FfiSwapOutcome, FfiSwapResult};

/// The moment the athlete turned the switch on, or `"false"` when it is off.
pub(crate) const SWITCH: &str = "veloq-garmin-auto-swap";
/// Why a pass turned the switch off, shown beside it until it is turned on.
pub(crate) const STOPPED: &str = "veloq-garmin-auto-swap-stopped";
/// The imports in the window already swapped or found not to need it, one id
/// per line.
pub(crate) const HANDLED: &str = "veloq-garmin-auto-swap-handled";

/// The settings rows the pass keeps, which stay on this device.
pub(crate) const SETTING_KEYS: [&str; 3] = [SWITCH, STOPPED, HANDLED];

/// Hours after intervals.icu's import a ride is still swapped.
const WINDOW_HOURS: i64 = 48;

/// An activity intervals.icu imported from Garmin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Imported {
    pub id: String,
    /// When intervals.icu created it, as it wrote it.
    pub created: String,
}

/// What a pass reads and writes on the device.
pub(crate) trait AutoStore {
    fn setting(&self, key: &str) -> Option<String>;
    fn set_setting(&self, key: &str, value: &str);
    /// Garmin imports, newest first, that intervals.icu created recently.
    fn recent_imports(&self) -> Vec<Imported>;
}

/// The moment a switch value says it was turned on, `None` when it is off.
pub(crate) fn switched_on_since(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// intervals.icu writes `created` with an offset, or without one in UTC.
fn created_at(text: &str) -> Option<DateTime<Utc>> {
    if let Ok(t) = DateTime::parse_from_rfc3339(text) {
        return Some(t.with_timezone(&Utc));
    }
    chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|t| t.and_utc())
}

/// Whether a result means intervals.icu or the file cannot take the swap, so
/// the switch goes off.
fn stops_the_switch(outcome: FfiSwapOutcome) -> bool {
    matches!(
        outcome,
        FfiSwapOutcome::Mismatch
            | FfiSwapOutcome::Refused
            | FfiSwapOutcome::PermissionBlocked
            | FfiSwapOutcome::AuthExpired
    )
}

/// Whether a ride needs no further try: it was swapped, holds nothing more, or
/// is not an exact import. A call that could not be made is tried again.
fn settled(outcome: FfiSwapOutcome) -> bool {
    matches!(
        outcome,
        FfiSwapOutcome::Replaced | FfiSwapOutcome::Unchanged | FfiSwapOutcome::NotEligible
    )
}

/// One pass: swap each import in the window that was created after the switch
/// and not yet handled, through `swap`.
pub(crate) fn run(
    store: &dyn AutoStore,
    now: DateTime<Utc>,
    mut swap: impl FnMut(&str) -> FfiSwapResult,
) {
    let Some(since) = store.setting(SWITCH).as_deref().and_then(switched_on_since) else {
        return;
    };
    let earliest = since.max(now - Duration::hours(WINDOW_HOURS));
    let in_window: Vec<String> = store
        .recent_imports()
        .into_iter()
        .filter(|i| created_at(&i.created).is_some_and(|t| t >= earliest && t <= now))
        .map(|i| i.id)
        .collect();
    let mut handled: HashSet<String> = store
        .setting(HANDLED)
        .unwrap_or_default()
        .lines()
        .filter(|id| in_window.iter().any(|w| w == id))
        .map(str::to_string)
        .collect();
    for id in &in_window {
        if handled.contains(id) {
            continue;
        }
        let result = swap(id);
        if stops_the_switch(result.outcome) {
            let reason = result
                .detail
                .unwrap_or_else(|| format!("{:?}", result.outcome));
            store.set_setting(STOPPED, &reason);
            store.set_setting(SWITCH, "false");
            break;
        }
        if settled(result.outcome) {
            handled.insert(id.clone());
        }
    }
    let kept: Vec<&str> = in_window
        .iter()
        .map(String::as_str)
        .filter(|id| handled.contains(*id))
        .collect();
    store.set_setting(HANDLED, &kept.join("\n"));
}

/// The library open at one install.
pub(crate) struct InstallStore(pub(crate) u64);

impl AutoStore for InstallStore {
    fn setting(&self, key: &str) -> Option<String> {
        crate::objects::error::with_reader(|conn| {
            crate::persistence::settings::setting_from(conn, key)
                .ok()
                .flatten()
        })
        .ok()
        .flatten()
    }

    fn set_setting(&self, key: &str, value: &str) {
        let written =
            crate::persistence::with_persistent_engine_for(self.0, |e| e.set_setting(key, value));
        if !matches!(written, Some(Ok(()))) {
            log::warn!("veloqrs: [garmin] an automatic swap setting did not store: {key}");
        }
    }

    fn recent_imports(&self) -> Vec<Imported> {
        crate::objects::error::with_reader(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.intervals_id, c.created, b.raw
                 FROM activity_census c
                 JOIN activity_bodies b ON b.activity_id = c.intervals_id
                 WHERE c.created IS NOT NULL
                 ORDER BY c.created DESC LIMIT 200",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            Ok::<_, rusqlite::Error>(
                rows.filter_map(Result::ok)
                    .filter(|(_, _, raw)| crate::net::garmin::pull::body_is_from_garmin(raw))
                    .map(|(id, created, _)| Imported { id, created })
                    .collect(),
            )
        })
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
    }
}

/// Run a pass for the library open at `install` on a thread of its own, unless
/// the switch is off or no Garmin key is held.
pub(crate) fn start(install: u64) {
    let store = InstallStore(install);
    if store
        .setting(SWITCH)
        .as_deref()
        .and_then(switched_on_since)
        .is_none()
        || crate::objects::garmin_key::GARMIN_KEY.client().is_none()
    {
        return;
    }
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    crate::threads::spawn_named("garmin-autoswap", move || {
        run(&store, Utc::now(), |id| {
            crate::net::garmin_swap::replace(&crate::net::garmin_swap::Live, id)
        });
        ACTIVE.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
#[path = "tests/garmin_auto_swap.rs"]
mod tests;
