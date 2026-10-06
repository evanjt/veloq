//! The C entry point the iOS scheme handler calls.
//!
//! A `WKURLSchemeHandler` runs with no JavaScript context, so it cannot reach
//! the UniFFI surface, and iOS has no JNI, so the shortest path from the
//! handler to the store is a plain C symbol in the static library: the twin of
//! `jni.rs`. It blocks, which is what the handler wants, since it moves the
//! call off the main thread itself and answers WebKit once the bytes are in
//! hand. Not gated on the target, because a C symbol costs nothing elsewhere
//! and the test that links it by name runs on the host.

use std::ffi::{CStr, c_char};

/// One tile's bytes, or null with `len` left at zero when there is no tile to
/// hand over. `status` is what the handler answers the page with: 200 with the
/// bytes, and without them 404 for a refusal, 429 or 503 when the tile host
/// asked to be left alone, and 502 when it failed. See
/// [`page_status`](super::page_status).
///
/// The bytes are the caller's until it hands them back to [`veloq_tile_free`]
/// with the same length. Nothing else may free them.
///
/// # Safety
///
/// `source` is a NUL-terminated string or null, `len` points at a writable
/// `usize` or is null, in which case nothing can be returned, and `status`
/// points at a writable `u16` or is null, in which case it is not reported.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_tile_get_or_fetch(
    source: *const c_char,
    z: u32,
    x: u32,
    y: u32,
    len: *mut usize,
    status: *mut u16,
) -> *mut u8 {
    crate::ffi_refuse_on_panic("tile get or fetch", std::ptr::null_mut(), || {
        let report = |code: u16| {
            if !status.is_null() {
                // SAFETY: the caller's contract above says `status` is writable.
                unsafe { *status = code };
            }
        };
        // A panic below answers nothing more, and it is ours rather than a
        // refusal.
        report(super::UPSTREAM_FAILED);
        let null = std::ptr::null_mut();
        let refuse = || {
            report(super::NO_TILE);
            null
        };
        if len.is_null() {
            return refuse();
        }
        // SAFETY: the caller's contract above says `len` is writable.
        unsafe { *len = 0 };
        let Ok(z) = u8::try_from(z) else {
            return refuse();
        };
        if source.is_null() {
            return refuse();
        }
        // SAFETY: the caller's contract above says `source` is NUL-terminated.
        let Ok(source) = unsafe { CStr::from_ptr(source) }.to_str() else {
            return refuse();
        };

        match super::tile_bytes(source, z, x, y) {
            Ok(bytes) if !bytes.is_empty() => {
                let bytes = bytes.into_boxed_slice();
                // SAFETY: `len` is writable, and the box is leaked to the caller
                // for `veloq_tile_free` to reclaim.
                unsafe { *len = bytes.len() };
                report(200);
                Box::into_raw(bytes) as *mut u8
            }
            Ok(_) => refuse(),
            Err(code) => {
                report(code);
                null
            }
        }
    })
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

/// One glyph range's bytes, or null with `len` left at zero. `status` is what
/// the handler answers the page with, as for [`veloq_tile_get_or_fetch`]. The
/// bytes go back through [`veloq_tile_free`].
///
/// # Safety
///
/// `fontstack` and `range` are NUL-terminated strings or null, `len` points at
/// a writable `usize` or is null, and `status` points at a writable `u16` or is
/// null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_glyph_get_or_fetch(
    fontstack: *const c_char,
    range: *const c_char,
    len: *mut usize,
    status: *mut u16,
) -> *mut u8 {
    crate::ffi_refuse_on_panic("glyph get or fetch", std::ptr::null_mut(), || {
        let report = |code: u16| {
            if !status.is_null() {
                // SAFETY: the caller's contract above says `status` is writable.
                unsafe { *status = code };
            }
        };
        report(super::UPSTREAM_FAILED);
        let null = std::ptr::null_mut();
        let refuse = || {
            report(super::NO_TILE);
            null
        };
        if len.is_null() || fontstack.is_null() || range.is_null() {
            return refuse();
        }
        // SAFETY: the caller's contract above says `len` is writable.
        unsafe { *len = 0 };
        // SAFETY: the caller's contract above says both are NUL-terminated.
        let (Ok(fontstack), Ok(range)) = (
            unsafe { CStr::from_ptr(fontstack) }.to_str(),
            unsafe { CStr::from_ptr(range) }.to_str(),
        ) else {
            return refuse();
        };

        match super::glyphs::range_bytes(fontstack, range) {
            Ok(bytes) if !bytes.is_empty() => {
                let bytes = bytes.into_boxed_slice();
                // SAFETY: `len` is writable, and the box is leaked to the caller
                // for `veloq_tile_free` to reclaim.
                unsafe { *len = bytes.len() };
                report(200);
                Box::into_raw(bytes) as *mut u8
            }
            Ok(_) => refuse(),
            Err(code) => {
                report(code);
                null
            }
        }
    })
}
