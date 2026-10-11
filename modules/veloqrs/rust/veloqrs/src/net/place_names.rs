//! Names the routes and sections that appeared while geocoding was on, from
//! the places they start and end in.
//!
//! The queue is written when the engine first numbers an item
//! (`persistence::geocoded_names`), and this pass empties it after a sync or a
//! detection run, never on a timer: the provider counts periodic requests as
//! bulk geocoding. A route or section that loops is named after its start,
//! one that ends in another place after both, and one that ends in the place
//! it started in without closing the loop after its start alone. A lookup
//! the provider answers with no place, or with an error that is not a
//! refusal, leaves the numbered label and is not asked again. A lookup that
//! never reached the provider, because it could not be sent or the network
//! was absent, leaves the item queued for the next pass, and no pass runs
//! while the device is offline. A provider that throttles, blocks or fails (a
//! 429, a 403 or a 5xx) has not answered either: the pass stops there, leaving
//! that item and the rest queued, and the geocoder sends nothing until the
//! refusal's cool-down ends.
//!
//! An item that existed before the switch is never queued, and one numbered
//! since over rides that all started before it is never asked about. Either is
//! named only when the athlete asks for that one item (`name_on_demand`),
//! through the same geocoder and the same rules.

use std::sync::atomic::{AtomicBool, Ordering};

use tracematch::GpsPoint;

use super::geocode::{GeocodeTransport, Geocoder, Lookup};
use crate::persistence::geocoded_names::{
    NamedKind, PlaceNameWords, is_typed, keep_name, place_name_words_from, queued, settle, unqueue,
};
use crate::persistence::read_pool::with_read_conn;
use crate::persistence::settings::{geocoding_enabled_from, match_config_from};
use crate::persistence::{
    engine_install, haversine_distance_meters, with_persistent_engine_blocking_for,
};

/// What a queued item is when the pass reaches it.
enum Queued {
    /// Its row is gone, or it has no line to name it from.
    Gone,
    /// The athlete typed a name for it, which no geocoded name shows over.
    Typed,
    /// Owed a name, from these two points.
    Ends { start: GpsPoint, end: GpsPoint },
}

/// What the pass reads before it asks anything: the words, the queue and how
/// close a start and an end have to be for the item to be a loop.
struct Plan {
    words: PlaceNameWords,
    items: Vec<(NamedKind, String)>,
    loop_within_m: f64,
}

/// Name every queued item, asking `geocoder` at `endpoint`. Answers how many
/// were given a name.
///
/// Sends nothing while the device is offline, while geocoding is off or
/// before the app has stored the words a name is put together with. Stops at
/// the first lookup that never reached the provider or that the provider
/// refused, so a missing endpoint, a dead network, a switch turned off
/// mid-pass or a provider asking to be left alone leaves the rest queued as
/// they were.
pub async fn name_queued<T: GeocodeTransport>(
    geocoder: &Geocoder<T>,
    endpoint: Option<&str>,
) -> usize {
    if super::connectivity::is_offline() {
        return 0;
    }
    let install = engine_install();
    let Some(plan) = with_read_conn(read_plan).flatten() else {
        return 0;
    };
    let mut named = 0;
    for (kind, id) in plan.items {
        let Some(state) = with_read_conn(|conn| queued_state(conn, kind, &id)) else {
            return named;
        };
        let (start, end) = match state {
            Queued::Gone | Queued::Typed => {
                let id = id.clone();
                with_persistent_engine_blocking_for(install, move |engine| {
                    unqueue(&engine.db, kind, &id)
                })
                .await;
                continue;
            }
            Queued::Ends { start, end } => (start, end),
        };
        let name = match name_from_ends(
            geocoder,
            endpoint,
            &plan.words,
            plan.loop_within_m,
            start,
            end,
        )
        .await
        {
            Lookup::NotSent | Lookup::Refused => return named,
            Lookup::NoPlace | Lookup::Failed => None,
            Lookup::Place(name) => Some(name),
        };
        let gave_name = name.is_some();
        let settled = with_persistent_engine_blocking_for(install, move |engine| {
            let now = crate::persistence::attempts::now_ms();
            let settled = settle(&engine.db, kind, &id, name.as_deref(), now)?;
            if settled && gave_name && kind == NamedKind::Route {
                engine.apply_route_names()?;
            }
            Ok::<_, rusqlite::Error>(settled)
        })
        .await;
        match settled {
            Some(Ok(true)) if gave_name => named += 1,
            Some(Ok(_)) => {}
            Some(Err(e)) => log::warn!("veloqrs: [PlaceNames] keeping a name: {e}"),
            None => return named,
        }
    }
    named
}

/// The name for an item that starts at `start` and ends at `end`: after its
/// start alone when it loops or ends in the place it started in, after both
/// otherwise. A start that names no place or fails gives no name; an end that
/// does leaves the name of the start. A lookup at either end that was never
/// sent or was refused is what the whole comes to, so the item stays owed.
async fn name_from_ends<T: GeocodeTransport>(
    geocoder: &Geocoder<T>,
    endpoint: Option<&str>,
    words: &PlaceNameWords,
    loop_within_m: f64,
    start: GpsPoint,
    end: GpsPoint,
) -> Lookup {
    let looped =
        haversine_distance_meters(start.latitude, start.longitude, end.latitude, end.longitude)
            < loop_within_m;
    let place = match geocoder
        .lookup(endpoint, start.latitude, start.longitude, &words.locale)
        .await
    {
        Lookup::Place(place) => place,
        other => return other,
    };
    if looped {
        return Lookup::Place(words.looped(&place));
    }
    match geocoder
        .lookup(endpoint, end.latitude, end.longitude, &words.locale)
        .await
    {
        unsettled @ (Lookup::NotSent | Lookup::Refused) => unsettled,
        Lookup::Place(other) if other != place => Lookup::Place(words.journey(&place, &other)),
        Lookup::Place(_) | Lookup::NoPlace | Lookup::Failed => Lookup::Place(place),
    }
}

/// What asking for one item's name came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnDemand {
    /// The item now shows the name.
    Named,
    /// The provider answered and named no place. The item keeps what it
    /// showed.
    NoPlace,
    /// The lookup could not be sent, was refused or came back with no answer.
    /// The item keeps what it showed, and asking again may answer.
    Failed,
    /// Geocoding is off, the athlete typed a name for the item, or it has no
    /// line to name it from. Nothing was sent.
    Refused,
}

/// Name one route or section because the athlete asked for it, whether or
/// not it was ever queued. Refuses, sending nothing, while geocoding is off
/// or when the item has a typed name: `endpoint` is awaited only once the
/// item is owed a lookup. The lookup waits its turn behind any other in the
/// engine, and only a name found is kept: a lookup that finds no place or
/// fails leaves the item as it was.
pub async fn name_on_demand<T: GeocodeTransport>(
    geocoder: &Geocoder<T>,
    endpoint: impl Future<Output = Option<String>>,
    kind: NamedKind,
    id: &str,
) -> OnDemand {
    let install = engine_install();
    let read = with_read_conn(|conn| {
        if !geocoding_enabled_from(conn) {
            return None;
        }
        Some((
            queued_state(conn, kind, id),
            place_name_words_from(conn),
            loop_within_m(conn),
        ))
    })
    .flatten();
    let Some((state, words, loop_within_m)) = read else {
        return OnDemand::Refused;
    };
    let (start, end) = match state {
        Queued::Gone | Queued::Typed => return OnDemand::Refused,
        Queued::Ends { start, end } => (start, end),
    };
    let Some(words) = words else {
        return OnDemand::Failed;
    };
    let endpoint = endpoint.await;
    let name = match name_from_ends(
        geocoder,
        endpoint.as_deref(),
        &words,
        loop_within_m,
        start,
        end,
    )
    .await
    {
        Lookup::Place(name) => name,
        Lookup::NoPlace => return OnDemand::NoPlace,
        Lookup::NotSent | Lookup::Refused | Lookup::Failed => return OnDemand::Failed,
    };
    let id = id.to_string();
    let kept = with_persistent_engine_blocking_for(install, move |engine| {
        // Read again on the write: the athlete may have typed a name while
        // the lookup waited, and a typed name is never stood in for.
        if !geocoding_enabled_from(&engine.db) || is_typed(&engine.db, kind, &id) {
            return Ok(false);
        }
        keep_name(
            &engine.db,
            kind,
            &id,
            &name,
            crate::persistence::attempts::now_ms(),
        )?;
        if kind == NamedKind::Route {
            engine.apply_route_names()?;
        }
        Ok::<_, rusqlite::Error>(true)
    })
    .await;
    match kept {
        Some(Ok(true)) => OnDemand::Named,
        Some(Ok(false)) => OnDemand::Refused,
        Some(Err(e)) => {
            log::warn!("veloqrs: [PlaceNames] keeping a name asked for: {e}");
            OnDemand::Failed
        }
        None => OnDemand::Failed,
    }
}

fn loop_within_m(conn: &rusqlite::Connection) -> f64 {
    match_config_from(conn)
        .map(|config| config.endpoint_threshold)
        .unwrap_or_else(|_| tracematch::MatchConfig::default().endpoint_threshold)
}

fn read_plan(conn: &rusqlite::Connection) -> Option<Plan> {
    if !geocoding_enabled_from(conn) {
        return None;
    }
    let words = place_name_words_from(conn)?;
    let items = queued(conn)
        .map_err(|e| log::warn!("veloqrs: [PlaceNames] reading the queue: {e}"))
        .ok()?;
    if items.is_empty() {
        return None;
    }
    Some(Plan {
        words,
        items,
        loop_within_m: loop_within_m(conn),
    })
}

fn queued_state(conn: &rusqlite::Connection, kind: NamedKind, id: &str) -> Queued {
    if is_typed(conn, kind, id) {
        return Queued::Typed;
    }
    let line = match kind {
        NamedKind::Route => {
            crate::persistence::routes::pooled::representative_route(conn, id).unwrap_or_default()
        }
        NamedKind::Section => {
            crate::persistence::sections::geometry::stored_line(conn, id).unwrap_or_default()
        }
    };
    match (line.first(), line.last()) {
        (Some(start), Some(end)) => Queued::Ends {
            start: *start,
            end: *end,
        },
        _ => Queued::Gone,
    }
}

/// Whether a pass is running, and whether another was asked for meanwhile.
static RUNNING: AtomicBool = AtomicBool::new(false);
static ASKED_AGAIN: AtomicBool = AtomicBool::new(false);

/// Name what appeared, off the calling thread. Called after a sync and after
/// a detection run lands. One pass at a time: a call while one runs makes it
/// go round once more rather than starting a second.
pub fn name_new_items() {
    if with_read_conn(geocoding_enabled_from) != Some(true) {
        return;
    }
    ASKED_AGAIN.store(true, Ordering::SeqCst);
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    crate::runtime::ASYNC_RUNTIME.spawn(async {
        loop {
            while ASKED_AGAIN.swap(false, Ordering::SeqCst) {
                // Offline the endpoint fetch would go into a dead network too,
                // and the queue keeps until a later sync or detection run.
                if super::connectivity::is_offline() {
                    continue;
                }
                match Geocoder::new() {
                    Ok(geocoder) => {
                        let endpoint = geocoder.configured_endpoint().await;
                        name_queued(&geocoder, endpoint.as_deref()).await;
                    }
                    Err(e) => log::warn!("veloqrs: [PlaceNames] {e}"),
                }
            }
            RUNNING.store(false, Ordering::SeqCst);
            // A call between the last check and the store above found the
            // pass still running and left it to go round again.
            if !ASKED_AGAIN.load(Ordering::SeqCst) || RUNNING.swap(true, Ordering::SeqCst) {
                break;
            }
        }
    });
}
