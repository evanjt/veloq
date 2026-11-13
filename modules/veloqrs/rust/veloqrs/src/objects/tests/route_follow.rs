use super::*;
use crate::test_globals::{init_global_engine, serial_global_state};

fn one_route() -> String {
    crate::persistence::with_persistent_engine(|engine| {
        for (index, id) in ["r0", "r1"].into_iter().enumerate() {
            let east = index as f64 * 0.00002;
            let track: Vec<tracematch::GpsPoint> = (0..200)
                .map(|step| tracematch::GpsPoint::new(47.0 + f64::from(step) * 0.0001, 7.0 + east))
                .collect();
            engine
                .add_activity(id.into(), track, "Ride".into())
                .expect("add activity");
        }
        engine
            .get_groups()
            .iter()
            .find(|group| group.activity_ids.len() == 2)
            .expect("the two rides group")
            .group_id
            .clone()
    })
    .expect("engine")
}

/// Scenario: a ride follows a saved route through the handle `follow` returns.
///
/// Expected behaviour: a fix beside the line's midpoint is on the route near
/// half way, and a route that is not saved is refused as not found.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_saved_route_is_followed_and_an_unknown_one_is_refused() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("routes.db");
    let route_id = one_route();
    let routes = RouteManager::new();

    let follower = routes.follow(route_id).expect("follow");
    let fix = follower.advance(47.0 + 100.0 * 0.0001, 7.00001);

    assert_eq!(fix.status, crate::FfiFollowStatus::OnRoute);
    let line_m = 199.0 * 0.0001 * 111_320.0;
    assert!(
        (fix.along_m - line_m / 2.0).abs() < 10.0,
        "along {} of {line_m}",
        fix.along_m
    );
    assert!((fix.along_m + fix.remaining_m - line_m).abs() < 10.0);

    assert!(matches!(
        routes.follow("nope".into()),
        Err(VeloqError::NotFound { .. })
    ));
}
