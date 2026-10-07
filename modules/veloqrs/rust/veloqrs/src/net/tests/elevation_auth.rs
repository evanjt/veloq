use super::*;
use std::cell::Cell;

#[test]
fn test_elevation_walk_sign_out_stops_before_next_batch() {
    let _serial = crate::test_globals::serial_global_state();
    crate::net::connectivity::reset();
    let signed_in = Cell::new(true);
    let asked = Cell::new(0usize);
    let queue: Vec<_> = (0..2 * BATCH)
        .map(|id| (format!("a{id}"), "Ride".to_string()))
        .collect();

    let walk = drain_queue_with_auth(
        engine_install(),
        &queue,
        true,
        || signed_in.get(),
        |ids, _| {
            asked.set(asked.get() + ids.len());
            signed_in.set(false);
            ids.iter()
                .map(|id| (id.clone(), Fetched::NoAltitude))
                .collect()
        },
    );

    assert_eq!(asked.get(), BATCH);
    assert!(matches!(walk.stopped, Some(Stopped::SignedOut)));
}
