//! Names the routes and sections that appeared while geocoding was on, from
//! the places they start and end in.
//!
//! The queue is written when the engine first numbers an item
//! (`persistence::geocoded_names`), and this pass empties it after a sync or a
//! detection run, never on a timer: the provider counts periodic requests as
//! bulk geocoding. A route or section that loops is named after its start,
//! one that ends in another place after both, and one that ends in the place
//! it started in without closing the loop after its start alone. A lookup
//! that finds no place or fails leaves the numbered label and is not asked
//! again. A lookup that could not be sent leaves the item queued for the next
//! pass.

use std::sync::atomic::{AtomicBool, Ordering};

use tracematch::GpsPoint;

use super::geocode::{GeocodeTransport, Geocoder, Lookup};
use crate::persistence::geocoded_names::{
    NamedKind, PlaceNameWords, place_name_words_from, queued, settle, unqueue,
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
/// Sends nothing while geocoding is off or before the app has stored the
/// words a name is put together with. Stops at the first lookup that could
/// not be sent, so a missing endpoint or a switch turned off mid-pass leaves
/// the rest queued as they were.
pub async fn name_queued<T: GeocodeTransport>(
    geocoder: &Geocoder<T>,
    endpoint: Option<&str>,
) -> usize {
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
        let looped =
            haversine_distance_meters(start.latitude, start.longitude, end.latitude, end.longitude)
                < plan.loop_within_m;
        let words = &plan.words;
        let name = match geocoder
            .lookup(endpoint, start.latitude, start.longitude, &words.locale)
            .await
        {
            Lookup::NotSent => return named,
            Lookup::NoPlace | Lookup::Failed => None,
            Lookup::Place(place) if looped => Some(words.looped(&place)),
            Lookup::Place(place) => match geocoder
                .lookup(endpoint, end.latitude, end.longitude, &words.locale)
                .await
            {
                Lookup::NotSent => return named,
                Lookup::Place(other) if other != place => Some(words.journey(&place, &other)),
                Lookup::Place(_) | Lookup::NoPlace | Lookup::Failed => Some(place),
            },
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
    let loop_within_m = match_config_from(conn)
        .map(|config| config.endpoint_threshold)
        .unwrap_or_else(|_| tracematch::MatchConfig::default().endpoint_threshold);
    Some(Plan {
        words,
        items,
        loop_within_m,
    })
}

fn queued_state(conn: &rusqlite::Connection, kind: NamedKind, id: &str) -> Queued {
    let line = match kind {
        NamedKind::Route => {
            if crate::persistence::routes::pooled::has_typed_name(conn, id) {
                return Queued::Typed;
            }
            crate::persistence::routes::pooled::representative_route(conn, id).unwrap_or_default()
        }
        NamedKind::Section => {
            if crate::persistence::sections::numbers::has_own_name(conn, id) {
                return Queued::Typed;
            }
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
