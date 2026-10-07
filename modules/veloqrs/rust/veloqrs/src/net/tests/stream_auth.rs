use super::*;
use std::cell::Cell;

#[test]
fn test_stream_walk_sign_out_stops_before_next_batch() {
    let signed_in = Cell::new(true);
    let asked = Cell::new(0usize);
    let queue: Vec<_> = (0..2 * BATCH)
        .map(|id| StreamGap {
            activity_id: format!("a{id}"),
            point_count: 3,
        })
        .collect();

    let (_, stopped) = drain_queue_with_auth(
        &queue,
        |batch| {
            asked.set(asked.get() + batch.len());
            signed_in.set(false);
            batch
                .iter()
                .map(|gap| (gap.activity_id.clone(), Fetched::Nothing))
                .collect()
        },
        |_| (0, 0),
        || false,
        || false,
        || signed_in.get(),
        || true,
    );

    assert_eq!(asked.get(), BATCH);
    assert!(matches!(stopped, Some(Stopped::SignedOut)));
}
