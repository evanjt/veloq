//! A push that ends before the engine answers is recorded as a failed run,
//! through the C entry the iOS extension links.
//!
//! Own binary because the engine is process-wide and the entry opens it at the
//! path it is given: sharing a process with another test that opens one would
//! make the path this test names depend on which ran first.
//!
//! Run: `cargo test -p veloqrs --test push_refusal_record`

use std::ffi::CString;
use std::os::raw::c_char;

use tempfile::TempDir;
use veloqrs::push::runs::recent;

unsafe extern "C" {
    fn veloq_push_record_refusal(
        db_path: *const c_char,
        activity_id: *const c_char,
        reason: *const c_char,
    );
}

fn record(db: &str, activity_id: &str, reason: &str) {
    let db = CString::new(db).unwrap();
    let id = CString::new(activity_id).unwrap();
    let reason = CString::new(reason).unwrap();
    unsafe { veloq_push_record_refusal(db.as_ptr(), id.as_ptr(), reason.as_ptr()) };
}

/// Scenario: the extension refuses before the engine is open, twice, the second
/// time for a payload that named no activity.
///
/// Expected behaviour: each refusal is a `failed` row carrying its reason,
/// newest first, and an empty activity id is kept.
#[test]
fn refusals_before_the_engine_opens_are_kept_newest_first() {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let path = db.to_str().unwrap();

    record(path, "a1", "keychain answered nothing");
    let runs = recent();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].outcome, "failed");
    assert_eq!(runs[0].activity_id, "a1");
    assert_eq!(runs[0].detail.as_deref(), Some("keychain answered nothing"));

    record(path, "", "payload not recognised: keys=[aps]");
    let runs = recent();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].activity_id, "");
    assert_eq!(
        runs[0].detail.as_deref(),
        Some("payload not recognised: keys=[aps]")
    );
    assert_eq!(runs[1].activity_id, "a1");
}
