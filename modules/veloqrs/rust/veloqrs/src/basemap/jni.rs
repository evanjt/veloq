//! The Java entry point a WebView's request interceptor calls.
//!
//! The map page asks for a tile with an ordinary HTTP request, which Android
//! hands to `shouldInterceptRequest` on a background thread. That thread has
//! no JavaScript context, so it cannot reach the UniFFI surface, which this
//! project generates for JSI and not for Kotlin. A direct JNI symbol is the
//! shortest path from the interceptor to the store, and it blocks, which is
//! what `shouldInterceptRequest` wants: it is already off the UI thread and it
//! expects the bytes in hand when it returns.

use jni::JNIEnv;
use jni::objects::{JClass, JIntArray, JString};
use jni::sys::{jbyteArray, jint};

/// `com.veloq.TileBridge.nativeGetOrFetch`. Returns null for anything that is
/// not a tile, and writes into `status[0]` what the interceptor answers the
/// page with: 200 with the bytes, and without them 404 for a refusal, 429 or
/// 503 when the tile host asked to be left alone, and 502 when it failed. See
/// [`page_status`](super::page_status).
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_TileBridge_nativeGetOrFetch<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    source: JString<'local>,
    z: jint,
    x: jint,
    y: jint,
    status: JIntArray<'local>,
) -> jbyteArray {
    crate::ffi_refuse_on_panic("tile get or fetch", std::ptr::null_mut(), || {
        let null = std::ptr::null_mut();
        let report = |env: &mut JNIEnv<'local>, code: u16| {
            if status.is_null() {
                return;
            }
            if let Err(e) = env.set_int_array_region(&status, 0, &[jint::from(code)]) {
                log::warn!("[basemap] could not hand the tile status to Java: {}", e);
            }
        };
        if z < 0 || x < 0 || y < 0 || z > u8::MAX as jint {
            report(&mut env, super::NO_TILE);
            return null;
        }
        let Ok(source) = env.get_string(&source) else {
            report(&mut env, super::NO_TILE);
            return null;
        };
        let source: String = source.into();

        match super::tile_bytes(&source, z as u8, x as u32, y as u32) {
            Ok(bytes) if !bytes.is_empty() => match env.byte_array_from_slice(&bytes) {
                Ok(array) => {
                    report(&mut env, 200);
                    array.into_raw()
                }
                Err(e) => {
                    log::warn!(
                        "[basemap] could not hand {} bytes to Java: {}",
                        bytes.len(),
                        e
                    );
                    report(&mut env, super::UPSTREAM_FAILED);
                    null
                }
            },
            Ok(_) => {
                report(&mut env, super::NO_TILE);
                null
            }
            Err(code) => {
                report(&mut env, code);
                null
            }
        }
    })
}

/// `com.veloq.TileBridge.nativeGetGlyph`. Returns null when there are no bytes
/// to hand over, and writes the status the interceptor answers with into
/// `status[0]`, as [`Java_com_veloq_TileBridge_nativeGetOrFetch`] does.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_TileBridge_nativeGetGlyph<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    fontstack: JString<'local>,
    range: JString<'local>,
    status: JIntArray<'local>,
) -> jbyteArray {
    crate::ffi_refuse_on_panic("glyph get or fetch", std::ptr::null_mut(), || {
        let null = std::ptr::null_mut();
        let report = |env: &mut JNIEnv<'local>, code: u16| {
            if status.is_null() {
                return;
            }
            if let Err(e) = env.set_int_array_region(&status, 0, &[jint::from(code)]) {
                log::warn!("[basemap] could not hand the glyph status to Java: {}", e);
            }
        };
        let (Ok(fontstack), Ok(range)) = (env.get_string(&fontstack), env.get_string(&range))
        else {
            report(&mut env, super::NO_TILE);
            return null;
        };
        let (fontstack, range): (String, String) = (fontstack.into(), range.into());

        match super::glyphs::range_bytes(&fontstack, &range) {
            Ok(bytes) if !bytes.is_empty() => match env.byte_array_from_slice(&bytes) {
                Ok(array) => {
                    report(&mut env, 200);
                    array.into_raw()
                }
                Err(e) => {
                    log::warn!(
                        "[basemap] could not hand {} glyph bytes to Java: {}",
                        bytes.len(),
                        e
                    );
                    report(&mut env, super::UPSTREAM_FAILED);
                    null
                }
            },
            Ok(_) => {
                report(&mut env, super::NO_TILE);
                null
            }
            Err(code) => {
                report(&mut env, code);
                null
            }
        }
    })
}
