use super::pooled;
use crate::persistence::fitness::performances::pooled as performances;

#[test]
fn test_section_detail_performance_repeat_uses_cache() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("pooled_performance_cache.db");
    performances::reset_test_computations();

    for _ in 0..2 {
        crate::persistence::read_pool::with_read_conn(|conn| {
            let detail = pooled::section_detail_performance(conn, "missing", 14, None);
            assert!(detail.performances.records.is_empty());
        })
        .expect("reader");
    }
    assert_eq!(performances::computations(), 1);
}
