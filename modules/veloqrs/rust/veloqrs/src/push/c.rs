//! The C entry points the iOS notification service extension calls.
//!
//! An extension is a second process with no JavaScript and no JSI, and iOS has
//! no JNI, so the shortest path from `didReceive` to the engine is a plain C
//! symbol in the xcframework: the twin of `jni.rs` and the same shape as
//! `basemap/c.rs`. All three block, which is what the extension wants, since
//! it does the work off its main thread and answers `contentHandler` once the
//! sentence is in hand.
//!
//! Not gated on the target, because a C symbol costs nothing elsewhere and the
//! tests that link them by name run on the host.
//!
//! Every decision is in the parent module, so the only thing here is the
//! marshalling.

use std::ffi::{CStr, CString, c_char};

/// A NUL-terminated string as a `&str`, or `None` for null or non-UTF-8.
///
/// # Safety
///
/// `value` is NUL-terminated or null.
unsafe fn read<'a>(value: *const c_char) -> Option<&'a str> {
    if value.is_null() {
        return None;
    }
    // SAFETY: the caller's contract above says `value` is NUL-terminated.
    unsafe { CStr::from_ptr(value) }.to_str().ok()
}

/// Hand a string to the extension, which gives it back to
/// [`veloq_push_string_free`]. Null when it will not fit in a C string, which
/// is a NUL byte in a route name and reads the same as nothing to post.
fn hand_over(text: String) -> *mut c_char {
    match CString::new(text) {
        Ok(owned) => owned.into_raw(),
        Err(e) => {
            log::warn!("[push] the answer could not cross the boundary: {e}");
            std::ptr::null_mut()
        }
    }
}

/// Open the engine at `db_path` and set the credential the extension read out
/// of the shared keychain, and say whether a fetch can now be attempted.
///
/// The three credential arguments are the keychain items as they were read,
/// null for anything absent: the choice between them is Rust's, the way
/// `AuthStore` makes it. False is a handler that should post the notification
/// it was given unchanged, which is what a phone rebooted and not yet unlocked
/// gets: nothing can read the token there, and a silent failure would be a
/// notification that never arrives.
///
/// # Safety
///
/// Every argument is a NUL-terminated string or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_prepare(
    db_path: *const c_char,
    access_token: *const c_char,
    api_key: *const c_char,
    athlete_id: *const c_char,
) -> bool {
    // SAFETY: the caller's contract above.
    let (db_path, access_token, api_key, athlete_id) = unsafe {
        (
            read(db_path),
            read(access_token),
            read(api_key),
            read(athlete_id),
        )
    };
    let Some(db_path) = db_path else {
        log::warn!("[push] prepare was handed no database path");
        return false;
    };

    match super::prepare_native_session_from_keychain(db_path, access_token, api_key, athlete_id) {
        Ok(()) => true,
        Err(e) => {
            log::warn!("[push] prepare refused: {e}");
            false
        }
    }
}

/// Fetch one activity's track, store it and index it, and answer with the
/// summary as JSON.
///
/// Null for anything that did not end in an indexed activity, with the reason
/// logged: the extension has no screen to put it on. `sport_type` may be null,
/// which is what a push carrying no sport is.
///
/// The string is the caller's until it hands it back to
/// [`veloq_push_string_free`]. Nothing else may free it.
///
/// # Safety
///
/// Both arguments are NUL-terminated strings or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_fetch_and_index(
    activity_id: *const c_char,
    sport_type: *const c_char,
) -> *mut c_char {
    // SAFETY: the caller's contract above.
    let (activity_id, sport_type) = unsafe { (read(activity_id), read(sport_type)) };
    let Some(activity_id) = activity_id else {
        log::warn!("[push] fetch was handed no activity id");
        return std::ptr::null_mut();
    };

    match super::fetch_and_index_json(activity_id, sport_type.unwrap_or_default()) {
        Ok(json) => hand_over(json),
        Err(e) => {
            log::warn!("[push] {activity_id} was not indexed: {e}");
            std::ptr::null_mut()
        }
    }
}

/// One activity push, end to end: the gate, the detail body, the track and its
/// index, then the title and body to post, as JSON.
///
/// The same entry the Android worker calls through `nativeActivityPush`, and
/// the reason the extension makes one call rather than three: the detail body
/// is what writes the `activity_metrics` row the ladder needs to date a lap,
/// and it also carries the ride's name, which the push itself does not.
///
/// Null when there is nothing to post: the switch is off, the ladder found
/// nothing, or no string bundle has been pushed. The extension delivers the
/// notification the worker wrote in that case, rather than replacing it with
/// an empty line. A step that failed is null too, with the reason logged: the
/// extension has no screen to put it on and no second attempt inside a push's
/// budget that would go differently.
///
/// The string is the caller's until it hands it back to
/// [`veloq_push_string_free`]. Nothing else may free it.
///
/// # Safety
///
/// `activity_id` is a NUL-terminated string or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_activity(activity_id: *const c_char) -> *mut c_char {
    // SAFETY: the caller's contract above.
    let Some(activity_id) = (unsafe { read(activity_id) }) else {
        log::warn!("[push] an activity push was asked for without an activity id");
        return std::ptr::null_mut();
    };

    match super::activity_push_json(activity_id) {
        Ok(Some(json)) => hand_over(json),
        Ok(None) => std::ptr::null_mut(),
        Err(e) => {
            log::warn!("[push] nothing to post for {activity_id}: {e}");
            std::ptr::null_mut()
        }
    }
}

/// Give back what either of the two above handed out. Null is a no-op, which
/// is the answer the extension sees most.
///
/// # Safety
///
/// `text` is exactly what one call above returned, and it is handed back once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_string_free(text: *mut c_char) {
    if text.is_null() {
        return;
    }
    // SAFETY: the caller's contract above says this is the leaked string.
    drop(unsafe { CString::from_raw(text) });
}
