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
use jni::objects::{JClass, JString};
use jni::sys::{jbyteArray, jint};

/// `com.veloq.TileBridge.nativeGetOrFetch`. Returns null for anything that is
/// not a tile, which the interceptor turns into a 404 rather than a hole.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_TileBridge_nativeGetOrFetch<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    source: JString<'local>,
    z: jint,
    x: jint,
    y: jint,
) -> jbyteArray {
    let null = std::ptr::null_mut();
    if z < 0 || x < 0 || y < 0 || z > u8::MAX as jint {
        return null;
    }
    let Ok(source) = env.get_string(&source) else {
        return null;
    };
    let source: String = source.into();

    match super::get_or_fetch(&source, z as u8, x as u32, y as u32) {
        Some(bytes) => match env.byte_array_from_slice(&bytes) {
            Ok(array) => array.into_raw(),
            Err(e) => {
                log::warn!(
                    "[basemap] could not hand {} bytes to Java: {}",
                    bytes.len(),
                    e
                );
                null
            }
        },
        None => null,
    }
}
