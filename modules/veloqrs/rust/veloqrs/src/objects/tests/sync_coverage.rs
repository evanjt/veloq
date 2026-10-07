use super::{FfiStartOutcome, RangeCoverage, SyncManager, test_credentials};
use crate::test_globals::read_while_writer_holds;

#[test]
fn test_sync_activities_window_covered_writer_held() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("covered_window_under_writer.db");
    let _creds = test_credentials();
    crate::with_persistent_engine(|engine| {
        let entry = crate::net::types::ActivityCensusEntry {
            id: "a1".into(),
            start_date_local: Some("2025-01-15T12:00:00".into()),
            created: None,
            icu_sync_date: Some("v1".into()),
            has_latlng: false,
        };
        engine
            .record_activity_census("1", &[entry])
            .expect("census");
        engine
            .store_synced_activity_bodies(
                "1",
                &[("a1".into(), 1_736_940_000, "{}".into())],
                &["a1".into()],
                vec![crate::ActivityMetrics {
                    activity_id: "a1".into(),
                    date: 1_736_940_000,
                    ..Default::default()
                }],
            )
            .expect("body and census version");
    });
    let outcome = read_while_writer_holds(|| {
        SyncManager::new()
            .sync_activities_window("2025-01-01".into(), "2025-01-31".into())
            .expect("covered window")
    });
    assert_eq!(outcome, FfiStartOutcome::NotOwed);
}

#[test]
fn test_coverage_reads_writer_held() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("coverage_under_a_writer.db");
    let _creds = test_credentials();
    let sync = SyncManager::new();
    read_while_writer_holds(|| {
        assert!(matches!(
            sync.range_coverage("2025-01-01".into(), "2025-01-31".into()),
            RangeCoverage::NotFetched
        ));
        assert_eq!(sync.library_coverage().upstream, 0);
    });
}
