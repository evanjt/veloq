use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};

/// Three rides of one corridor, grouped into one route. Returns the route,
/// the representative grouping chose, and a member that is not it.
fn grouped_library() -> (String, String, String) {
    crate::persistence::with_persistent_engine(|engine| {
        for (index, id) in ["r0", "r1", "r2"].into_iter().enumerate() {
            let east = index as f64 * 0.00002;
            let track: Vec<tracematch::GpsPoint> = (0..200)
                .map(|step| tracematch::GpsPoint::new(47.0 + f64::from(step) * 0.0001, 7.0 + east))
                .collect();
            engine
                .add_activity(id.into(), track, "Ride".into())
                .expect("add activity");
        }
        let group = engine
            .get_groups()
            .iter()
            .find(|group| group.activity_ids.len() == 3)
            .expect("the three rides group")
            .clone();
        let other = group
            .activity_ids
            .iter()
            .find(|id| **id != group.representative_id)
            .unwrap()
            .clone();
        (group.group_id, group.representative_id, other)
    })
    .expect("engine")
}

fn representative(route_id: &str) -> String {
    RouteManager::new()
        .get_all()
        .unwrap()
        .into_iter()
        .find(|group| group.group_id == route_id)
        .expect("route")
        .representative_id
}

/// Scenario: the athlete chooses another ride as the route's reference, then
/// resets it, each through the one async choice.
///
/// Expected behaviour: each resolves once written, and the route reads back
/// the representative it named.
#[test]
fn each_choice_resolves_with_the_representative_it_named() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("routes.db");
    let (route_id, automatic, other) = grouped_library();
    let routes = RouteManager::new();

    crate::runtime::block_on(routes.set_representative(route_id.clone(), Some(other.clone())))
        .expect("choose");
    assert_eq!(representative(&route_id), other);

    crate::runtime::block_on(routes.set_representative(route_id.clone(), None)).expect("reset");
    assert_eq!(representative(&route_id), automatic);
}

/// Scenario: a choice names a ride that is not on the route.
///
/// Expected behaviour: it resolves as an error, the representative is
/// unchanged, and the slot is free for the next choice.
#[test]
fn a_refused_choice_resolves_as_an_error_and_frees_the_slot() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("routes.db");
    let (route_id, automatic, other) = grouped_library();
    let routes = RouteManager::new();

    let refused = crate::runtime::block_on(
        routes.set_representative(route_id.clone(), Some("not-a-member".into())),
    );
    assert!(refused.is_err(), "a ride off the route is refused");
    assert_eq!(representative(&route_id), automatic);

    crate::runtime::block_on(routes.set_representative(route_id.clone(), Some(other.clone())))
        .expect("the slot is free after a refusal");
    assert_eq!(representative(&route_id), other);
}

/// Scenario: a second choice is made while the first is waiting on the engine.
///
/// Expected behaviour: the second is refused as busy without waiting, and the
/// first still completes once the engine is free.
#[test]
fn a_second_choice_while_one_runs_is_refused() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("routes.db");
    let (route_id, automatic, other) = grouped_library();
    let routes = RouteManager::new();

    let first = crate::persistence::with_persistent_engine(|_held| {
        let (first_route, first_choice) = (route_id.clone(), other.clone());
        let first = std::thread::spawn(move || {
            crate::runtime::block_on(
                RouteManager::new().set_representative(first_route, Some(first_choice)),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !REPRESENTATIVE_EDIT_IN_FLIGHT.load(Ordering::SeqCst) {
            assert!(
                Instant::now() < deadline,
                "the first choice never took the slot"
            );
            std::thread::yield_now();
        }

        let second = crate::runtime::block_on(
            routes.set_representative(route_id.clone(), Some(automatic.clone())),
        );
        assert!(
            matches!(second, Err(VeloqError::Busy { .. })),
            "the second choice must be refused, got {second:?}"
        );
        first
    })
    .expect("engine");

    first
        .join()
        .expect("first choice thread")
        .expect("first choice");
    assert_eq!(representative(&route_id), other);
}

/// Scenario: a choice is made against one library and a restore installs
/// another before the choice reaches the engine.
///
/// Expected behaviour: the choice resolves as an error, the restored
/// library's route keeps its representative, and the slot is free.
#[test]
fn a_choice_from_a_replaced_install_writes_nothing() {
    let _guard = serial_global_state();
    let _old = init_global_engine("routes.db");
    let stale = crate::persistence::engine_install();

    let _new = init_global_engine("restored.db");
    let (route_id, automatic, other) = grouped_library();

    let slot = InFlight::claim(&REPRESENTATIVE_EDIT_IN_FLIGHT, "taken").expect("slot");
    let outcome = crate::runtime::block_on(representative_edit_for(
        stale,
        route_id.clone(),
        Some(other.clone()),
        slot,
    ));

    assert!(
        outcome.is_err(),
        "a choice from a replaced install must fail"
    );
    assert_eq!(representative(&route_id), automatic);
    assert!(
        !REPRESENTATIVE_EDIT_IN_FLIGHT.load(Ordering::SeqCst),
        "a discarded choice frees the slot"
    );

    crate::runtime::block_on(
        RouteManager::new().set_representative(route_id.clone(), Some(other.clone())),
    )
    .expect("the same choice against the open library is written");
    assert_eq!(representative(&route_id), other);
}
