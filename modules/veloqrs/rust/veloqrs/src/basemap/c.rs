//! The C entry point the iOS scheme handler calls.
//!
//! A `WKURLSchemeHandler` runs with no JavaScript context, so it cannot reach
//! the UniFFI surface, and iOS has no JNI, so the shortest path from the
//! handler to the store is a plain C symbol in the xcframework: the twin of
//! `jni.rs`. It blocks, which is what the handler wants, since it moves the
//! call off the main thread itself and answers WebKit once the bytes are in
//! hand. Not gated on the target, because a C symbol costs nothing elsewhere
//! and the test that links it by name runs on the host.

use std::ffi::{CStr, c_char};

/// One tile's bytes, or null with `len` left at zero when there is no tile
/// to be had, which the handler turns into a 404 rather than a hole.
///
/// The bytes are the caller's until it hands them back to [`veloq_tile_free`]
/// with the same length. Nothing else may free them.
///
/// # Safety
///
/// `source` is a NUL-terminated string or null, and `len` points at a
/// writable `usize` or is null, in which case nothing can be returned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_tile_get_or_fetch(
    source: *const c_char,
    z: u32,
    x: u32,
    y: u32,
    len: *mut usize,
) -> *mut u8 {
    let null = std::ptr::null_mut();
    if len.is_null() {
        return null;
    }
    // SAFETY: the caller's contract above says `len` is writable.
    unsafe { *len = 0 };
    let Ok(z) = u8::try_from(z) else {
        return null;
    };
    if source.is_null() {
        return null;
    }
    // SAFETY: the caller's contract above says `source` is NUL-terminated.
    let Ok(source) = unsafe { CStr::from_ptr(source) }.to_str() else {
        return null;
    };

    match super::tile_bytes(source, z, x, y) {
        Some(bytes) if !bytes.is_empty() => {
            let bytes = bytes.into_boxed_slice();
            // SAFETY: `len` is writable, and the box is leaked to the caller
            // for `veloq_tile_free` to reclaim.
            unsafe { *len = bytes.len() };
            Box::into_raw(bytes) as *mut u8
        }
        _ => null,
    }
}

/// Give back what [`veloq_tile_get_or_fetch`] handed out. Null is a no-op.
///
/// # Safety
///
/// `bytes` and `len` are exactly what one call to `veloq_tile_get_or_fetch`
/// returned, and they are handed back once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_tile_free(bytes: *mut u8, len: usize) {
    if bytes.is_null() {
        return;
    }
    // SAFETY: the caller's contract above says this is the leaked box.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(bytes, len)) });
}
