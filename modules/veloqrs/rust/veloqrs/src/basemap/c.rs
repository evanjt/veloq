//! The C entry points the iOS scheme handler calls.
//!
//! A `WKURLSchemeHandler` runs with no JavaScript context, so it cannot reach
//! the UniFFI surface, and iOS has no JNI, so the shortest path from the
//! handler to the store is a plain C symbol in the static library: the twin of
//! `jni.rs`. A tile is answered through a callback, at once when it is held
//! and from the engine's runtime when the host is asked. A glyph range still
//! blocks for its bytes, since one is fetched only for a script the app does
//! not bundle. Not gated on the target, because a C symbol costs nothing
//! elsewhere and the test that links it by name runs on the host.

use std::ffi::{CStr, c_char, c_void};

use super::TileLookup;

/// How a tile's answer reaches the handler: its own `context`, then the bytes
/// and their length, or null and zero when there is no tile, then the status to
/// answer the page with. 200 comes with the bytes, and without them 404 is a
/// refusal, 429 or 503 the tile host asking to be left alone and 502 a
/// failure. See [`page_status`](super::page_status).
///
/// The bytes are the callee's until it hands them back to [`veloq_tile_free`]
/// with the same length. Nothing else may free them.
pub type VeloqTileDone =
    unsafe extern "C" fn(context: *mut c_void, bytes: *mut u8, len: usize, status: u16);

/// The handler's context, carried to the runtime thread a miss completes on.
/// Rust never reads it, only hands it back.
struct Context(*mut c_void);

// SAFETY: the pointer is opaque here and only ever passed back to `done`,
// whose contract below says it may be called from any thread.
unsafe impl Send for Context {}

/// Answer one tile through `done`, called exactly once. What is held, refused
/// or bundled is answered on the calling thread before this returns. A miss
/// returns at once and is answered later from the engine's runtime, so the
/// caller's thread is never held for the tile host: on iOS that thread comes
/// from a shared pool, and a pan's aborted misses each kept one for as long as
/// the host took.
///
/// The call itself can still wait on the disk, and once a day on a TileJSON,
/// so it is not for the main thread.
///
/// # Safety
///
/// `source` is a NUL-terminated string or null. `done` is null, in which case
/// nothing is answered, or a function that may be called from any thread with
/// `context` and takes ownership of the bytes it is handed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_tile_answer(
    source: *const c_char,
    z: u32,
    x: u32,
    y: u32,
    context: *mut c_void,
    done: Option<VeloqTileDone>,
) {
    crate::ffi_refuse_on_panic("tile answer", (), || {
        let Some(done) = done else {
            return;
        };
        let context = Context(context);
        let deliver = move |result: Result<Vec<u8>, u16>| {
            // Taken whole, so the closure holds the `Send` wrapper and not its
            // raw field.
            let context = context;
            let (bytes, len, status) = match result {
                Ok(bytes) if !bytes.is_empty() => {
                    let bytes = bytes.into_boxed_slice();
                    let len = bytes.len();
                    (Box::into_raw(bytes) as *mut u8, len, 200)
                }
                Ok(_) => (std::ptr::null_mut(), 0, super::NO_TILE),
                Err(code) => (std::ptr::null_mut(), 0, code),
            };
            // SAFETY: the caller's contract above. The box is leaked to the callee
            // for `veloq_tile_free` to reclaim.
            unsafe { done(context.0, bytes, len, status) };
        };

        // A panic in the lookup is ours rather than a refusal, and is still
        // answered.
        let lookup = crate::ffi_refuse_on_panic(
            "tile lookup",
            TileLookup::Refused(super::UPSTREAM_FAILED),
            || {
                if source.is_null() {
                    return TileLookup::Refused(super::NO_TILE);
                }
                let Ok(z) = u8::try_from(z) else {
                    return TileLookup::Refused(super::NO_TILE);
                };
                // SAFETY: the caller's contract above says `source` is NUL-terminated.
                let Ok(source) = unsafe { CStr::from_ptr(source) }.to_str() else {
                    return TileLookup::Refused(super::NO_TILE);
                };
                super::lookup_tile(source, z, x, y)
            },
        );
        match lookup {
            TileLookup::Ready(bytes) => deliver(Ok(bytes)),
            TileLookup::Refused(code) => deliver(Err(code)),
            TileLookup::Miss(miss) => miss.spawn(deliver),
        }
    })
}

/// Give back the bytes [`veloq_tile_answer`], [`veloq_glyph_get_or_fetch`] or
/// [`veloq_geo_get`] handed out. Null is a no-op.
///
/// # Safety
///
/// `bytes` and `len` are exactly what one answer handed out, and they are
/// handed back once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_tile_free(bytes: *mut u8, len: usize) {
    if bytes.is_null() {
        return;
    }
    // SAFETY: the caller's contract above says this is the leaked box.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(bytes, len)) });
}

/// One glyph range's bytes, or null with `len` left at zero. `status` is what
/// the handler answers the page with, as for [`veloq_tile_answer`]. The
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

/// One `veloq-geo` answer's bytes, `path` being everything after the marker,
/// or null with `len` left at zero. `status` is what the handler answers the
/// page with: 200 with the bytes, and without them 400 for a path that is not
/// `<kind>/<key>`, 404 for nothing stored there and 503 before the engine is
/// open. The bytes go back through [`veloq_tile_free`].
///
/// # Safety
///
/// `path` is a NUL-terminated string or null, `len` points at a writable
/// `usize` or is null, and `status` points at a writable `u16` or is null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn veloq_geo_get(
    path: *const c_char,
    len: *mut usize,
    status: *mut u16,
) -> *mut u8 {
    crate::ffi_refuse_on_panic("geo answer", std::ptr::null_mut(), || {
        let report = |code: u16| {
            if !status.is_null() {
                // SAFETY: the caller's contract above says `status` is writable.
                unsafe { *status = code };
            }
        };
        report(super::UPSTREAM_FAILED);
        let null = std::ptr::null_mut();
        if len.is_null() {
            report(super::geo::BAD_PATH);
            return null;
        }
        // SAFETY: the caller's contract above says `len` is writable.
        unsafe { *len = 0 };
        if path.is_null() {
            report(super::geo::BAD_PATH);
            return null;
        }
        // SAFETY: the caller's contract above says `path` is NUL-terminated.
        let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
            report(super::geo::BAD_PATH);
            return null;
        };

        match super::geo_answer(path) {
            Ok(bytes) => {
                let bytes = bytes.into_boxed_slice();
                // SAFETY: `len` is writable, and the box is leaked to the caller
                // for `veloq_tile_free` to reclaim.
                unsafe { *len = bytes.len() };
                report(200);
                Box::into_raw(bytes) as *mut u8
            }
            Err(code) => {
                report(code);
                null
            }
        }
    })
}
