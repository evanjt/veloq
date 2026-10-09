//! The Java entry point a WebView's request interceptor calls.
//!
//! The map page asks for a tile with an ordinary HTTP request, which Android
//! hands to `shouldInterceptRequest` on a background thread. That thread has
//! no JavaScript context, so it cannot reach the UniFFI surface, which this
//! project generates for JSI and not for Kotlin. A direct JNI symbol is the
//! shortest path from the interceptor to the store. A tile is answered at once
//! and a miss completes later from the engine's runtime. A glyph range still
//! blocks for its bytes, since one is fetched only for a script the app does
//! not bundle.

use jni::objects::{GlobalRef, JClass, JIntArray, JObject, JString, JValue};
use jni::sys::{jbyteArray, jint};
use jni::{JNIEnv, JavaVM};

use super::TileLookup;

/// What `status[0]` reads when the bytes are on their way: the page has a
/// response and its body will follow. Kept equal to `TileBridge.PENDING`.
const PENDING: u16 = 202;

/// `com.veloq.TileBridge.nativeAnswer`. Answers what is held at once and
/// never waits on a tile host. Writes into `status[0]` what the interceptor
/// answers the page with: 200 with the bytes, and without them 404 for a
/// refusal, 429 or 503 when the tile host asked to be left alone, 502 when it
/// failed, and [`PENDING`] when the host is being asked. Then `pending`, a
/// `com.veloq.PendingTile`, is completed from the engine's runtime once the
/// host answers: `complete(byte[])` with the tile, or `fail(int)` with the
/// status it would have crossed as.
///
/// The interceptor runs on the WebView's own small pool, and that pool also
/// hands finished responses to the page. A miss that held its thread for the
/// whole upstream fetch put a pan's misses on the wire a few at a time, and
/// held up the tiles that had already arrived.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_TileBridge_nativeAnswer<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    source: JString<'local>,
    z: jint,
    x: jint,
    y: jint,
    status: JIntArray<'local>,
    pending: JObject<'local>,
) -> jbyteArray {
    crate::ffi_refuse_on_panic("tile answer", std::ptr::null_mut(), || {
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

        match super::lookup_tile(&source, z as u8, x as u32, y as u32) {
            TileLookup::Ready(bytes) if !bytes.is_empty() => {
                match env.byte_array_from_slice(&bytes) {
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
                }
            }
            TileLookup::Ready(_) => {
                report(&mut env, super::NO_TILE);
                null
            }
            TileLookup::Refused(code) => {
                report(&mut env, code);
                null
            }
            TileLookup::Miss(miss) => {
                let (Ok(vm), Ok(pending)) = (env.get_java_vm(), env.new_global_ref(&pending))
                else {
                    report(&mut env, super::UPSTREAM_FAILED);
                    return null;
                };
                miss.spawn(move |result| complete(&vm, &pending, result));
                report(&mut env, PENDING);
                null
            }
        }
    })
}

/// Hand a spawned miss's answer to the `PendingTile` the page is reading.
///
/// Runs on a runtime thread, which Java has never seen, so it attaches as a
/// daemon: the thread lives as long as the runtime and is never detached. Any
/// local reference made here is released with its frame, since a thread with
/// no Java frame of its own never releases one otherwise.
fn complete(vm: &JavaVM, pending: &GlobalRef, result: Result<Vec<u8>, u16>) {
    let mut env = match vm.attach_current_thread_as_daemon() {
        Ok(env) => env,
        Err(e) => {
            log::warn!("[basemap] could not reach Java to finish a tile: {}", e);
            return;
        }
    };
    let called = env.with_local_frame(4, |env| -> jni::errors::Result<()> {
        match &result {
            Ok(bytes) => {
                let array = env.byte_array_from_slice(bytes)?;
                env.call_method(
                    pending.as_obj(),
                    "complete",
                    "([B)V",
                    &[JValue::Object(&array)],
                )?;
            }
            Err(code) => {
                env.call_method(
                    pending.as_obj(),
                    "fail",
                    "(I)V",
                    &[JValue::Int(jint::from(*code))],
                )?;
            }
        }
        Ok(())
    });
    if let Err(e) = called {
        log::warn!("[basemap] could not finish a tile: {}", e);
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
    }
}

/// `com.veloq.TileBridge.nativeGetGlyph`. Returns null when there are no bytes
/// to hand over, and writes the status the interceptor answers with into
/// `status[0]`, as [`Java_com_veloq_TileBridge_nativeAnswer`] does.
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
