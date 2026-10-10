//! Routes and sections that appear while geocoding is on are named from the
//! places they start and end in, through a stub provider. What existed before
//! the switch, and anything the athlete named, is never asked about, and a
//! geocoded name shows only while geocoding is on.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::params;
use tracematch::GpsPoint;

use super::*;
use crate::RouteGroup;
use crate::net::geocode::{GeocodeError, GeocodeTransport, Geocoder};
use crate::net::place_names::{OnDemand, name_on_demand, name_queued};
use crate::persistence::{PersistentEngine, with_persistent_engine};
use crate::test_globals::{init_global_engine, serial_global_state};

const ENDPOINT: &str = "https://places.example";

/// Two points in one suburb a cell apart, one in another suburb, one the
/// provider names no place for and one it answers with a server error.
const NORTHCOTE: (f64, f64) = (-37.7701, 145.0102);
const NORTHCOTE_EAST: (f64, f64) = (-37.7701, 145.0302);
const SOUTHBANK: (f64, f64) = (-37.8101, 144.9602);
const OPEN_WATER: (f64, f64) = (-38.5001, 145.5001);
const UNANSWERED: (f64, f64) = (-39.0001, 145.5001);

/// The provider as a script, keyed on the latitude of the cell asked about,
/// writing down every request and the language it carried. While `offline`
/// is set no request reaches it, as on a device with no connection.
struct Provider {
    sent: Mutex<Vec<(String, String)>>,
    offline: AtomicBool,
}

impl Provider {
    fn new() -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            offline: AtomicBool::new(false),
        }
    }

    fn count(&self) -> usize {
        self.sent.lock().unwrap().len()
    }
}

impl GeocodeTransport for Provider {
    async fn get(&self, url: &str, language: &str) -> Result<String, GeocodeError> {
        self.sent
            .lock()
            .unwrap()
            .push((url.to_string(), language.to_string()));
        if self.offline.load(Ordering::SeqCst) {
            return Err(GeocodeError::Unreachable("connection refused".to_string()));
        }
        let suburb = if url.contains("lat=-37.770") {
            "Northcote"
        } else if url.contains("lat=-37.810") {
            "Southbank"
        } else if url.contains("lat=-38.500") {
            return Ok(r#"{"address":{"water":"Bass Strait"}}"#.to_string());
        } else {
            return Err(GeocodeError::Rejected { status: 500 });
        };
        Ok(format!(
            r#"{{"address":{{"road":"High Street","suburb":"{suburb}","city":"Melbourne"}}}}"#
        ))
    }
}

fn line(from: (f64, f64), to: (f64, f64)) -> Vec<GpsPoint> {
    (0..=30)
        .map(|i| {
            let t = f64::from(i) / 30.0;
            GpsPoint::new(from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t)
        })
        .collect()
}

/// Out from `at` and back to it.
fn round_trip(at: (f64, f64)) -> Vec<GpsPoint> {
    let turn = (at.0 - 0.01, at.1 + 0.01);
    let mut points = line(at, turn);
    points.extend(line(turn, at).into_iter().skip(1));
    points
}

fn switch(on: bool) {
    with_persistent_engine(|e| e.set_geocoding_enabled(on).unwrap()).expect("engine");
}

fn store_words() {
    let words = PlaceNameWords {
        locale: "en-AU".to_string(),
        loop_name: "{{place}} Loop".to_string(),
        journey: "{{start}} to {{end}}".to_string(),
    };
    with_persistent_engine(|e| {
        e.set_setting(
            settings_keys::PLACE_NAME_WORDS,
            &serde_json::to_string(&words).unwrap(),
        )
        .unwrap()
    })
    .expect("engine");
}

/// A start a second after geocoding was last turned on, or now when it never
/// has been: a ride on ground the athlete rode after the switch.
fn ridden_after_switch() -> i64 {
    with_persistent_engine(|e| e.geocoding_enabled_at().unwrap())
        .expect("engine")
        .map_or_else(
            || crate::persistence::attempts::now_ms() / 1000,
            |at| at / 1000 + 1,
        )
}

/// Store a ride over `track` that started at `started`, in epoch seconds.
fn add_ride(e: &mut PersistentEngine, id: &str, track: Vec<GpsPoint>, started: i64) {
    e.add_activity(id.to_string(), track, "Ride".to_string())
        .unwrap();
    e.update_activity_metadata(id, Some(started), None, None, None)
        .unwrap();
}

fn add_route(id: &str, track: Vec<GpsPoint>) {
    add_route_ridden(id, track, ridden_after_switch());
}

fn add_route_ridden(id: &str, track: Vec<GpsPoint>, started: i64) {
    with_persistent_engine(|e: &mut PersistentEngine| {
        let ride = format!("{id}-ride");
        add_ride(e, &ride, track, started);
        let mut groups = e.groups.clone();
        groups.push(RouteGroup {
            group_id: id.to_string(),
            representative_id: ride.clone(),
            activity_ids: vec![ride],
            sport_type: "Ride".to_string(),
            bounds: None,
            custom_name: None,
            best_time: None,
            avg_time: None,
            best_pace: None,
            best_activity_id: None,
        });
        e.groups = groups;
        e.route_identity_reseed();
        e.save_groups().unwrap();
    })
    .expect("engine");
}

fn add_section(id: &str, track: Vec<GpsPoint>) {
    add_section_ridden(id, track, ridden_after_switch());
}

/// A section over `track` whose one traversal is a ride that started at
/// `started`, the row first and the traversal after, as detection writes them.
fn add_section_ridden(id: &str, track: Vec<GpsPoint>, started: i64) {
    with_persistent_engine(|e: &mut PersistentEngine| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES (?1, 'auto', 'Ride', ?2, 1000)",
            params![id, serde_json::to_string(&track).unwrap()],
        )
        .unwrap();
        let ride = format!("{id}-ride");
        let last = track.len() - 1;
        add_ride(e, &ride, track, started);
        e.db.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                 end_index, distance_meters)
             VALUES (?1, ?2, 'same', 0, ?3, 1000)",
            params![id, ride, last as i64],
        )
        .unwrap();
    })
    .expect("engine");
}

/// The name a route shows, read both ways a screen reads it: through the
/// pool and from the groups the engine holds.
fn route_name(id: &str) -> String {
    let pooled = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::persistence::routes::pooled::all_route_names(conn).remove(id)
    })
    .flatten();
    let held = with_persistent_engine(|e| e.get_route_name(id)).flatten();
    assert_eq!(pooled, held, "the pool and the engine show {id} alike");
    pooled.unwrap_or_default()
}

fn section_name(id: &str) -> String {
    crate::persistence::read_pool::with_read_conn(|conn| {
        crate::persistence::sections::naming::pooled::all_section_names(conn).remove(id)
    })
    .flatten()
    .unwrap_or_default()
}

fn run(provider: &Geocoder<Provider>) -> usize {
    crate::runtime::block_on(name_queued(provider, Some(ENDPOINT)))
}

#[test]
fn what_appears_after_the_switch_is_named_from_where_it_starts_and_ends() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_named.db");
    switch(true);
    store_words();
    add_route("loop", round_trip(NORTHCOTE));
    add_route("journey", line(NORTHCOTE, SOUTHBANK));
    add_route("across", line(NORTHCOTE, NORTHCOTE_EAST));
    add_section("climb", line(SOUTHBANK, NORTHCOTE));
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(run(&provider), 4);

    assert_eq!(route_name("loop"), "Northcote Loop");
    assert_eq!(route_name("journey"), "Northcote to Southbank");
    assert_eq!(
        route_name("across"),
        "Northcote",
        "a route that ends in the place it started is named after it once"
    );
    assert_eq!(section_name("climb"), "Southbank to Northcote");
    let sent = provider.transport().sent.lock().unwrap();
    assert_eq!(sent.len(), 3, "one request per cell: {sent:?}");
    assert!(sent.iter().all(|(_, language)| language == "en-AU"));
}

#[test]
fn what_existed_before_the_switch_keeps_its_number_and_is_never_asked_about() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_before.db");
    store_words();
    add_route("old-route", round_trip(NORTHCOTE));
    add_section("old-section", line(NORTHCOTE, SOUTHBANK));
    switch(true);
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(route_name("old-route"), "Route 1");
    assert_eq!(section_name("old-section"), "Section 1");

    add_route("new-route", round_trip(SOUTHBANK));
    assert_eq!(run(&provider), 1);
    assert_eq!(provider.transport().count(), 1);
    assert_eq!(route_name("new-route"), "Southbank Loop");
    assert_eq!(route_name("old-route"), "Route 1");
}

#[test]
fn a_name_the_athlete_typed_shows_and_is_never_asked_about() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_typed.db");
    switch(true);
    store_words();
    add_route("renamed-route", round_trip(NORTHCOTE));
    add_section("renamed-section", line(NORTHCOTE, SOUTHBANK));
    with_persistent_engine(|e| {
        e.set_route_name("renamed-route", Some("Hill repeats"))
            .unwrap();
        e.set_section_name("renamed-section", Some("The drag"))
            .unwrap();
    })
    .expect("engine");
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(route_name("renamed-route"), "Hill repeats");
    assert_eq!(section_name("renamed-section"), "The drag");

    add_route("named-then-typed", line(NORTHCOTE, SOUTHBANK));
    assert_eq!(run(&provider), 1);
    assert_eq!(route_name("named-then-typed"), "Northcote to Southbank");
    with_persistent_engine(|e| {
        e.set_route_name("named-then-typed", Some("Commute"))
            .unwrap()
    })
    .expect("engine");
    assert_eq!(route_name("named-then-typed"), "Commute");
    with_persistent_engine(|e| e.set_route_name("named-then-typed", None).unwrap())
        .expect("engine");
    assert_eq!(
        route_name("named-then-typed"),
        "Northcote to Southbank",
        "clearing the typed name shows the geocoded one again"
    );
}

#[test]
fn turning_geocoding_off_shows_the_numbers_again_and_keeps_the_names() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_off.db");
    switch(true);
    store_words();
    add_route("route", round_trip(NORTHCOTE));
    add_section("section", line(SOUTHBANK, NORTHCOTE));
    let provider = Geocoder::with_transport(Provider::new());
    assert_eq!(run(&provider), 2);
    let asked = provider.transport().count();

    switch(false);
    assert_eq!(route_name("route"), "Route 1");
    assert_eq!(section_name("section"), "Section 1");

    switch(true);
    assert_eq!(route_name("route"), "Northcote Loop");
    assert_eq!(section_name("section"), "Southbank to Northcote");
    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), asked);
}

#[test]
fn a_lookup_that_finds_no_place_or_fails_leaves_the_number_and_is_not_asked_again() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_failed.db");
    switch(true);
    store_words();
    add_route("at-sea", round_trip(OPEN_WATER));
    add_section(
        "out-of-reach",
        line(UNANSWERED, (UNANSWERED.0, UNANSWERED.1 + 0.02)),
    );
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(run(&provider), 0);
    let asked = provider.transport().count();
    assert_eq!(asked, 2);
    assert_eq!(route_name("at-sea"), "Route 1");
    assert_eq!(section_name("out-of-reach"), "Section 1");

    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), asked);
}

#[test]
fn a_lookup_that_never_reaches_the_provider_leaves_the_item_queued_for_the_next_pass() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_unreached.db");
    switch(true);
    store_words();
    add_route("loop", round_trip(NORTHCOTE));
    add_section("climb", line(SOUTHBANK, NORTHCOTE));
    let provider = Geocoder::with_transport(Provider::new());
    provider.transport().offline.store(true, Ordering::SeqCst);

    assert_eq!(run(&provider), 0);
    assert_eq!(
        provider.transport().count(),
        1,
        "the pass stops at the first lookup that never arrived"
    );
    assert_eq!(route_name("loop"), "Route 1");
    assert_eq!(waiting().len(), 2, "both stay queued");

    provider.transport().offline.store(false, Ordering::SeqCst);
    assert_eq!(run(&provider), 2);
    assert_eq!(route_name("loop"), "Northcote Loop");
    assert_eq!(section_name("climb"), "Southbank to Northcote");
    assert!(waiting().is_empty());
}

#[test]
fn an_end_that_never_reaches_the_provider_leaves_the_item_queued() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_end_unreached.db");
    switch(true);
    store_words();
    add_route("journey", line(NORTHCOTE, SOUTHBANK));
    let provider = Geocoder::with_transport(Provider::new());
    crate::runtime::block_on(provider.lookup(Some(ENDPOINT), NORTHCOTE.0, NORTHCOTE.1, "en-AU"));
    provider.transport().offline.store(true, Ordering::SeqCst);

    assert_eq!(run(&provider), 0);
    assert_eq!(route_name("journey"), "Route 1");
    assert_eq!(waiting().len(), 1);

    provider.transport().offline.store(false, Ordering::SeqCst);
    assert_eq!(run(&provider), 1);
    assert_eq!(route_name("journey"), "Northcote to Southbank");
}

#[test]
fn a_pass_while_the_device_is_offline_sends_nothing_and_keeps_the_queue() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_offline.db");
    switch(true);
    store_words();
    add_route("loop", round_trip(NORTHCOTE));
    let provider = Geocoder::with_transport(Provider::new());
    crate::net::connectivity::set_online(false);

    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(waiting().len(), 1);

    crate::net::connectivity::set_online(true);
    assert_eq!(run(&provider), 1);
    assert_eq!(route_name("loop"), "Northcote Loop");
}

#[test]
fn nothing_is_sent_without_the_words_or_an_endpoint_and_the_item_stays_queued() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_unready.db");
    switch(true);
    add_route("waiting", round_trip(NORTHCOTE));
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(run(&provider), 0, "no words stored yet");
    store_words();
    assert_eq!(
        crate::runtime::block_on(name_queued(&provider, None)),
        0,
        "no endpoint"
    );
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(route_name("waiting"), "Route 1");

    assert_eq!(run(&provider), 1);
    assert_eq!(route_name("waiting"), "Northcote Loop");
}

#[test]
fn a_geocoded_name_never_stands_in_the_way_of_a_typed_one() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_unique.db");
    switch(true);
    store_words();
    // A street apart: the same cells at each end, on ground of their own.
    add_section("first", line(SOUTHBANK, NORTHCOTE));
    add_section(
        "second",
        line(
            (SOUTHBANK.0, SOUTHBANK.1 + 0.002),
            (NORTHCOTE.0, NORTHCOTE.1 + 0.002),
        ),
    );
    let provider = Geocoder::with_transport(Provider::new());
    assert_eq!(run(&provider), 2);
    assert_eq!(section_name("first"), "Southbank to Northcote");
    assert_eq!(section_name("second"), "Southbank to Northcote");

    with_persistent_engine(|e| {
        e.set_section_name("second", Some("Southbank to Northcote"))
            .unwrap()
    })
    .expect("engine");
    assert_eq!(section_name("second"), "Southbank to Northcote");
    assert_eq!(
        with_persistent_engine(|e| e.set_section_name("first", Some("Southbank to Northcote")))
            .expect("engine"),
        Err(
            crate::persistence::sections::naming::SectionNameError::Taken(
                "Southbank to Northcote".to_string()
            )
        ),
        "a typed name is still unique among typed names"
    );
}

#[test]
fn the_words_need_every_placeholder_to_be_used() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        .unwrap();
    let store = |json: &str| {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![settings_keys::PLACE_NAME_WORDS, json],
        )
        .unwrap();
    };
    assert_eq!(place_name_words_from(&conn), None);
    store(r#"{"locale":"de-CH","loop":"{{place}} Rundi","journey":"{{start}} uf {{end}}"}"#);
    let words = place_name_words_from(&conn).unwrap();
    assert_eq!(words.looped("Wipkinge"), "Wipkinge Rundi");
    assert_eq!(words.journey("Wipkinge", "Oerlike"), "Wipkinge uf Oerlike");
    store(r#"{"locale":"de-CH","loop":"routes.placeLoop","journey":"{{start}} uf {{end}}"}"#);
    assert_eq!(place_name_words_from(&conn), None, "an unresolved key");
    store(r#"{"locale":"","loop":"{{place}} Loop","journey":"{{start}} to {{end}}"}"#);
    assert_eq!(place_name_words_from(&conn), None, "no language");
}

fn ask(provider: &Geocoder<Provider>, kind: NamedKind, id: &str) -> OnDemand {
    crate::runtime::block_on(name_on_demand(
        provider,
        async { Some(ENDPOINT.to_string()) },
        kind,
        id,
    ))
}

#[test]
fn an_item_from_before_the_switch_is_named_when_the_athlete_asks() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_on_demand.db");
    store_words();
    add_route("old-route", round_trip(NORTHCOTE));
    add_section("old-section", line(NORTHCOTE, SOUTHBANK));
    switch(true);
    let provider = Geocoder::with_transport(Provider::new());
    assert_eq!(
        run(&provider),
        0,
        "nothing from before the switch is queued"
    );

    assert_eq!(
        ask(&provider, NamedKind::Route, "old-route"),
        OnDemand::Named
    );
    assert_eq!(route_name("old-route"), "Northcote Loop");
    assert_eq!(
        ask(&provider, NamedKind::Section, "old-section"),
        OnDemand::Named
    );
    assert_eq!(section_name("old-section"), "Northcote to Southbank");
    assert_eq!(provider.transport().count(), 2, "one request per cell");

    assert_eq!(
        ask(&provider, NamedKind::Route, "old-route"),
        OnDemand::Named,
        "asking again answers from the kept cells"
    );
    assert_eq!(provider.transport().count(), 2);
    assert_eq!(run(&provider), 0, "a name asked for is not queued again");

    switch(false);
    assert_eq!(route_name("old-route"), "Route 1");
    switch(true);
    assert_eq!(route_name("old-route"), "Northcote Loop");
}

#[test]
fn asking_for_a_typed_name_or_with_geocoding_off_sends_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_on_demand_refused.db");
    store_words();
    add_route("typed-route", round_trip(NORTHCOTE));
    add_section("typed-section", line(NORTHCOTE, SOUTHBANK));
    add_route("plain-route", round_trip(SOUTHBANK));
    with_persistent_engine(|e| {
        e.set_route_name("typed-route", Some("Hill repeats"))
            .unwrap();
        e.set_section_name("typed-section", Some("The drag"))
            .unwrap();
    })
    .expect("engine");
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(
        ask(&provider, NamedKind::Route, "plain-route"),
        OnDemand::Refused,
        "geocoding is off"
    );
    switch(true);
    assert_eq!(
        ask(&provider, NamedKind::Route, "typed-route"),
        OnDemand::Refused
    );
    assert_eq!(
        ask(&provider, NamedKind::Section, "typed-section"),
        OnDemand::Refused
    );
    assert_eq!(
        ask(&provider, NamedKind::Route, "no-such-route"),
        OnDemand::Refused
    );
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(route_name("typed-route"), "Hill repeats");
    assert_eq!(section_name("typed-section"), "The drag");
    assert_eq!(route_name("plain-route"), "Route 2");
}

#[test]
fn a_lookup_asked_for_that_finds_no_place_or_fails_leaves_the_number() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_on_demand_failed.db");
    store_words();
    add_route("at-sea", round_trip(OPEN_WATER));
    add_section(
        "out-of-reach",
        line(UNANSWERED, (UNANSWERED.0, UNANSWERED.1 + 0.02)),
    );
    add_route("waiting", round_trip(NORTHCOTE));
    switch(true);
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(
        ask(&provider, NamedKind::Route, "at-sea"),
        OnDemand::NoPlace
    );
    assert_eq!(
        ask(&provider, NamedKind::Section, "out-of-reach"),
        OnDemand::Failed
    );
    assert_eq!(route_name("at-sea"), "Route 1");
    assert_eq!(section_name("out-of-reach"), "Section 1");

    assert_eq!(
        crate::runtime::block_on(name_on_demand(
            &provider,
            async { None },
            NamedKind::Route,
            "waiting"
        )),
        OnDemand::Failed,
        "no endpoint"
    );
    let asked = provider.transport().count();
    assert_eq!(ask(&provider, NamedKind::Route, "waiting"), OnDemand::Named);
    assert_eq!(provider.transport().count(), asked + 1);
}

#[test]
fn the_detail_reads_offer_a_name_only_while_geocoding_is_on_and_nothing_was_typed() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_offered.db");
    add_route("plain-route", round_trip(NORTHCOTE));
    add_route("typed-route", round_trip(SOUTHBANK));
    add_section("plain-section", line(NORTHCOTE, SOUTHBANK));
    add_section("typed-section", round_trip(OPEN_WATER));
    with_persistent_engine(|e| {
        e.set_route_name("typed-route", Some("Hill repeats"))
            .unwrap();
        e.set_section_name("typed-section", Some("The drag"))
            .unwrap();
    })
    .expect("engine");
    let offered = || {
        crate::persistence::read_pool::with_read_conn(|conn| {
            let route = |id: &str| {
                crate::persistence::screens::pooled::route_detail_data(conn, id, None, 1)
                    .can_name_from_places
            };
            let section = |id: &str| {
                crate::persistence::screens::pooled::section_detail_data(conn, id)
                    .can_name_from_places
            };
            [
                route("plain-route"),
                route("typed-route"),
                route("no-such-route"),
                section("plain-section"),
                section("typed-section"),
                section("no-such-section"),
            ]
        })
        .expect("engine")
    };

    assert_eq!(offered(), [false; 6], "geocoding is off");
    switch(true);
    assert_eq!(offered(), [true, false, false, true, false, false]);
}

/// What the naming pass would ask about, read as the pass reads it.
fn waiting() -> Vec<(NamedKind, String)> {
    crate::persistence::read_pool::with_read_conn(|conn| queued(conn).unwrap()).expect("engine")
}

#[test]
fn a_wiped_library_resynced_is_never_named_in_bulk_and_the_switch_goes_with_it() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_wiped.db");
    switch(true);
    store_words();
    let library = || {
        add_route("loop", round_trip(NORTHCOTE));
        add_route("journey", line(NORTHCOTE, SOUTHBANK));
        add_section("climb", line(SOUTHBANK, NORTHCOTE));
    };
    library();
    let provider = Geocoder::with_transport(Provider::new());
    assert_eq!(run(&provider), 3);
    let asked = provider.transport().count();

    with_persistent_engine(|e| e.clear().unwrap()).expect("engine");
    assert!(!with_persistent_engine(|e| e.geocoding_enabled()).expect("engine"));
    assert_eq!(
        with_persistent_engine(|e| e.geocoding_enabled_at().unwrap()).expect("engine"),
        None,
        "the consent belonged to the library that went"
    );

    store_words();
    library();
    assert_eq!(run(&provider), 0);
    assert_eq!(
        provider.transport().count(),
        asked,
        "nothing sent after the wipe"
    );
    assert_eq!(route_name("loop"), "Route 1");
    assert_eq!(section_name("climb"), "Section 1");

    switch(true);
    assert_eq!(
        run(&provider),
        0,
        "turning it on again names nothing ridden before"
    );
    assert_eq!(provider.transport().count(), asked);
}

#[test]
fn history_ridden_before_the_switch_is_never_queued_whenever_it_arrives() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("place_names_history.db");
    switch(true);
    store_words();
    let switched_on = ridden_after_switch() - 1;
    let a_year_before = switched_on - 365 * 86_400;
    add_route_ridden("old-route", round_trip(NORTHCOTE), a_year_before);
    add_section_ridden("old-section", line(NORTHCOTE, SOUTHBANK), a_year_before);
    add_route_ridden("undated-route", round_trip(SOUTHBANK), a_year_before);
    with_persistent_engine(|e| {
        e.update_activity_metadata("undated-route-ride", None, None, None, None)
            .unwrap()
    })
    .expect("engine");
    let provider = Geocoder::with_transport(Provider::new());

    assert_eq!(waiting(), Vec::new());
    assert_eq!(run(&provider), 0);
    assert_eq!(provider.transport().count(), 0);
    assert_eq!(route_name("old-route"), "Route 1");
    assert_eq!(section_name("old-section"), "Section 1");

    add_route_ridden("new-route", line(NORTHCOTE, SOUTHBANK), switched_on + 1);
    add_section_ridden("new-section", line(SOUTHBANK, NORTHCOTE), switched_on + 1);
    assert_eq!(
        waiting(),
        vec![
            (NamedKind::Route, "new-route".to_string()),
            (NamedKind::Section, "new-section".to_string()),
        ]
    );
    assert_eq!(run(&provider), 2);
    assert_eq!(route_name("new-route"), "Northcote to Southbank");
    assert_eq!(section_name("new-section"), "Southbank to Northcote");
    assert_eq!(route_name("old-route"), "Route 1");

    with_persistent_engine(|e| {
        e.update_activity_metadata(
            "undated-route-ride",
            Some(switched_on + 1),
            None,
            None,
            None,
        )
        .unwrap()
    })
    .expect("engine");
    assert_eq!(
        waiting(),
        vec![(NamedKind::Route, "undated-route".to_string())],
        "a ride whose date was not known yet waits for it rather than being asked about"
    );
}
