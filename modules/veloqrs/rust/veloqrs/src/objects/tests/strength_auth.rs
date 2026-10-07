use super::*;
use std::cell::Cell;

#[test]
fn test_fit_batch_sign_out_stops_before_next_download() {
    let signed_in = Cell::new(true);
    let asked = Cell::new(0usize);
    let ids = vec!["first".to_string(), "second".to_string()];

    let result = crate::runtime::block_on(drain_fit_batch_with(
        &ids,
        || signed_in.get(),
        |_| {
            asked.set(asked.get() + 1);
            signed_in.set(false);
            async { Ok(true) }
        },
    ));

    assert!(matches!(result, Ok(1)));
    assert_eq!(asked.get(), 1);
}
