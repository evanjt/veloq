use crate::http::{DownloadPriority, enqueue_download, run_download_progress};
use crate::net::connectivity;
use crate::net::elevation_backfill;
use crate::test_globals::serial_global_state;

#[test]
fn test_serial_global_state_resets_process_state_between_calls() {
    {
        let _serial = serial_global_state();
        enqueue_download(9_999_999, 1, DownloadPriority::Bulk);
        connectivity::set_online(false);
        elevation_backfill::pause_elevation_backfill();
        std::mem::forget(crate::objects::test_credentials());
    }

    let _serial = serial_global_state();
    assert!(!run_download_progress(9_999_999).2);
    assert!(!connectivity::is_offline());
    assert_eq!(connectivity::last_push(), None);
    assert!(!elevation_backfill::elevation_backfill_paused());
    assert!(crate::objects::current_transport().is_none());
}
