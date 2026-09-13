//! The Java entry points the push worker calls.
//!
//! Two symbols, and neither installs a callback vtable: that is the whole
//! reason this is hand-written rather than a generated Kotlin binding. Both
//! block, which is what an expedited worker wants, since it is already off the
//! main thread and has a budget measured in seconds.
//!
//! Every decision is in the parent module, so the only thing here is the
//! marshalling, which cannot be tested off a device.

use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jstring};

/// Read a Java string, or `None` when it is null or not UTF-8.
fn read<'local>(env: &mut JNIEnv<'local>, value: &JString<'local>) -> Option<String> {
    env.get_string(value).ok().map(Into::into)
}

/// `com.veloq.PushBridge.nativePrepare`. False when the engine could not be
/// opened or the credential was not one Rust knows, in which case the worker
/// has nothing to try and should give up rather than retry.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativePrepare<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    db_path: JString<'local>,
    auth_method: JString<'local>,
    secret: JString<'local>,
    athlete_id: JString<'local>,
) -> jboolean {
    let (Some(db_path), Some(auth_method), Some(secret), Some(athlete_id)) = (
        read(&mut env, &db_path),
        read(&mut env, &auth_method),
        read(&mut env, &secret),
        read(&mut env, &athlete_id),
    ) else {
        log::warn!("[push] prepare was handed a string it could not read");
        return u8::from(false);
    };

    match super::prepare_native_session(&db_path, &auth_method, &secret, &athlete_id) {
        Ok(()) => u8::from(true),
        Err(e) => {
            log::warn!("[push] prepare refused: {e}");
            u8::from(false)
        }
    }
}

/// `com.veloq.PushBridge.nativeFetchAndIndex`. Null for anything that did not
/// end in an indexed activity, with the reason logged: the caller has no screen
/// to put it on, and the tile bridge beside this one answers the same way.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeFetchAndIndex<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    activity_id: JString<'local>,
    sport_type: JString<'local>,
) -> jstring {
    let null = std::ptr::null_mut();
    let (Some(activity_id), Some(sport_type)) =
        (read(&mut env, &activity_id), read(&mut env, &sport_type))
    else {
        log::warn!("[push] fetch was handed a string it could not read");
        return null;
    };

    match super::fetch_and_index_json(&activity_id, &sport_type) {
        Ok(json) => match env.new_string(&json) {
            Ok(s) => s.into_raw(),
            Err(e) => {
                log::warn!("[push] could not hand the summary of {activity_id} to Java: {e}");
                null
            }
        },
        Err(e) => {
            log::warn!("[push] {activity_id} was not indexed: {e}");
            null
        }
    }
}
