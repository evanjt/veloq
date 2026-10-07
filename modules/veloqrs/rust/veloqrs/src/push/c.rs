//! The C entry points the iOS notification service extension calls.
//!
//! An extension is a second process with no JavaScript and no JSI, and iOS has
//! no JNI, so the shortest path from `didReceive` to the engine is a plain C
//! symbol in the static library: the twin of `jni.rs` and the same shape as
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
/// On a refusal `refusal` is written with the sentence behind it, which the
/// caller hands to [`veloq_push_record_refusal`] and then to
/// [`veloq_push_string_free`]. It is left untouched on success, and may be
/// null when the caller wants no sentence.
///
/// # Safety
///
/// Every argument is a NUL-terminated string or null, and `refusal` is null or
/// points at a writable `char *`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_prepare(
    db_path: *const c_char,
    access_token: *const c_char,
    api_key: *const c_char,
    athlete_id: *const c_char,
    refusal: *mut *mut c_char,
) -> bool {
    crate::ffi_refuse_on_panic("push prepare", false, || {
        // SAFETY: the caller's contract above.
        let (db_path, access_token, api_key, athlete_id) = unsafe {
            (
                read(db_path),
                read(access_token),
                read(api_key),
                read(athlete_id),
            )
        };
        let refuse = |why: String| {
            log::warn!("[push] prepare refused: {why}");
            if !refusal.is_null() {
                // SAFETY: the caller's contract above says `refusal` is writable.
                unsafe { *refusal = hand_over(why) };
            }
            false
        };
        let Some(db_path) = db_path else {
            return refuse("prepare was handed no database path".to_string());
        };

        match super::prepare_native_session_from_keychain(
            db_path,
            access_token,
            api_key,
            athlete_id,
        ) {
            Ok(()) => true,
            Err(e) => refuse(e),
        }
    })
}

/// One activity push, end to end: the gate, the detail body, the track and its
/// index, then the title and body to post, as JSON.
///
/// The same entry the Android worker calls through `nativeActivityPush`, and
/// the reason the extension makes one call rather than three: the detail body
/// is what writes the `activity_metrics` row the ladder needs to date a lap,
/// and it also carries the ride's name, which the push itself does not.
///
/// Null when the switch is off, the athlete differs or the engine is not open.
/// The extension delivers the server's original notification in that case.
///
/// The string is the caller's until it hands it back to
/// [`veloq_push_string_free`]. Nothing else may free it.
///
/// # Safety
///
/// Both arguments are NUL-terminated strings or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_activity(
    activity_id: *const c_char,
    athlete_id: *const c_char,
) -> *mut c_char {
    crate::ffi_refuse_on_panic("push activity", std::ptr::null_mut(), || {
        // SAFETY: the caller's contract above.
        let (Some(activity_id), Some(athlete_id)) =
            (unsafe { (read(activity_id), read(athlete_id)) })
        else {
            log::warn!("[push] an activity push was asked for without an activity id");
            return std::ptr::null_mut();
        };

        match super::activity_push_json(activity_id, athlete_id) {
            Ok(Some(json)) => hand_over(json),
            Ok(None) => std::ptr::null_mut(),
            Err(e) => {
                log::warn!("[push] nothing to post for {activity_id}: {e}");
                std::ptr::null_mut()
            }
        }
    })
}

/// Record a push that ended before the engine answered, as a `failed` run
/// with `reason`, in the database at `db_path`.
///
/// The extension calls it on every exit that has a database path and posts
/// nothing enriched: an unreadable payload, a keychain that answered nothing,
/// a refused prepare, an answer that would not parse, the time running out.
/// A null or empty `activity_id` is a payload that named none, and is kept as
/// an empty id. Best effort and silent, so a diagnostic never fails a push.
///
/// # Safety
///
/// Every argument is a NUL-terminated string or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_record_refusal(
    db_path: *const c_char,
    activity_id: *const c_char,
    reason: *const c_char,
) {
    crate::ffi_refuse_on_panic("push record refusal", (), || {
        // SAFETY: the caller's contract above.
        let (db_path, activity_id, reason) =
            unsafe { (read(db_path), read(activity_id), read(reason)) };
        let (Some(db_path), Some(reason)) = (db_path, reason) else {
            log::warn!("[push] a refusal was handed no database path or reason");
            return;
        };
        super::record_refusal(db_path, activity_id.unwrap_or(""), reason);
    })
}

/// The reason for a payload the extension could not read, from key names only.
///
/// Each argument is the key names joined by newlines; `body_keys` is null when
/// the payload has no `body` dictionary. Values never cross the boundary, so
/// none can reach the stored reason. Null when it will not fit in a C string.
/// The caller hands the string back to [`veloq_push_string_free`].
///
/// # Safety
///
/// Both arguments are NUL-terminated strings or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_push_payload_reason(
    top_level_keys: *const c_char,
    body_keys: *const c_char,
) -> *mut c_char {
    crate::ffi_refuse_on_panic("push payload reason", std::ptr::null_mut(), || {
        // SAFETY: the caller's contract above.
        let (top, body) = unsafe { (read(top_level_keys), read(body_keys)) };
        let top: Vec<&str> = top.map(|t| t.lines().collect()).unwrap_or_default();
        let body: Option<Vec<&str>> = body.map(|b| b.lines().collect());
        hand_over(super::payload_refusal_reason(&top, body.as_deref()))
    })
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
