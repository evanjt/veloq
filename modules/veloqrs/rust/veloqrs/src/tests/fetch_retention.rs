use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    ActivitySportMapping, start_fetch_and_store_with_fetcher, take_fetch_and_store_result,
};
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use crate::http::{ActivityFetcher, DownloadPriority};
use crate::net::transport::Transport;
use crate::test_globals::read_while_writer_holds;

/// Starting a fetch reads the stream retention window before it spawns, on
/// the caller's thread. A sync page holding the engine write lock must not
/// hold the start with it.
#[test]
fn test_start_fetch_and_store_retention_read_writer_held() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_retention_under_writer.db");
    crate::with_persistent_engine(|e| e.set_stream_retention_days(30).unwrap()).unwrap();

    // Nothing listens here, and no activity is asked for, so the run settles
    // without a request.
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let transport =
        Transport::with_governor("http://127.0.0.1:9", AuthMethod::ApiKey("test"), governor)
            .expect("transport");
    let mapping = ActivitySportMapping {
        activity_id: "a1".into(),
        sport_type: "Ride".into(),
        start_date: Some(chrono::Utc::now().timestamp() as f64),
    };

    let run = read_while_writer_holds(|| {
        start_fetch_and_store_with_fetcher(
            vec![],
            vec![mapping],
            DownloadPriority::Bulk,
            ActivityFetcher::with_transport(transport),
        )
    });

    // Leave nothing running behind this test.
    let deadline = Instant::now() + Duration::from_secs(10);
    let settled = loop {
        if let Some(result) = take_fetch_and_store_result(run) {
            break Some(result);
        }
        if Instant::now() > deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    assert!(settled.is_some(), "the empty run settles");
}
