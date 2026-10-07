//! The Java entry points the push worker calls.
//!
//! Six symbols, and none installs a callback vtable: that is the whole
//! reason this is hand-written rather than a generated Kotlin binding. All
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
    crate::ffi_refuse_on_panic("push prepare", u8::from(false), || {
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
    })
}

/// `com.veloq.PushBridge.nativeOpen`. Opens the engine with no credential, for
/// a worker whose stored credential is missing or unreadable: the failed run
/// can then be recorded and the plain entry can read the stored title.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeOpen<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    db_path: JString<'local>,
) -> jboolean {
    crate::ffi_refuse_on_panic("push open", u8::from(false), || {
        let Some(db_path) = read(&mut env, &db_path) else {
            log::warn!("[push] open was handed a string it could not read");
            return u8::from(false);
        };
        match super::open_native_engine(&db_path) {
            Ok(()) => u8::from(true),
            Err(e) => {
                log::warn!("[push] open refused: {e}");
                u8::from(false)
            }
        }
    })
}

/// `com.veloq.PushBridge.nativeActivityPush`. The notification to post as
/// JSON, or a skip marker when the switch is off or the athlete differs.
/// Null is a failed call. Every other outcome answers with an entry, because
/// this is now the only thing that posts to an Android tray. Which outcome
/// it was is in `push_runs`, which the Developer Dashboard reads: a device
/// build logs at `Warn` and keeps no logcat an athlete can hand over.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeActivityPush<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    activity_id: JString<'local>,
    athlete_id: JString<'local>,
) -> jstring {
    crate::ffi_refuse_on_panic("push activity", std::ptr::null_mut(), || {
        let null = std::ptr::null_mut();
        let (Some(activity_id), Some(athlete_id)) =
            (read(&mut env, &activity_id), read(&mut env, &athlete_id))
        else {
            log::warn!("[push] activity push was handed a string it could not read");
            return null;
        };

        match super::activity_push_json(&activity_id, &athlete_id) {
            Ok(Some(json)) => match env.new_string(&json) {
                Ok(s) => s.into_raw(),
                Err(e) => {
                    log::warn!(
                        "[push] could not hand the notification for {activity_id} to Java: {e}"
                    );
                    null
                }
            },
            Ok(None) => {
                log::warn!("[push] nothing to post for {activity_id}, see the recorded run");
                env.new_string("{\"skip\":true}")
                    .map_or(null, |s| s.into_raw())
            }
            Err(e) => {
                log::warn!("[push] {activity_id} was not handled: {e}");
                null
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeFallbackNotification<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jstring {
    crate::ffi_refuse_on_panic("push fallback notification", std::ptr::null_mut(), || {
        env.new_string(super::fallback_notification_json(None))
            .map_or(std::ptr::null_mut(), |s| s.into_raw())
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeRecordFailure<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    activity_id: JString<'local>,
    reason: JString<'local>,
) {
    crate::ffi_refuse_on_panic("push record failure", (), || {
        if let (Some(activity_id), Some(reason)) =
            (read(&mut env, &activity_id), read(&mut env, &reason))
        {
            super::runs::record(&activity_id, super::PushRunOutcome::Failed, Some(&reason));
        }
    })
}

/// `com.veloq.PushBridge.nativeWidgetSnapshot`. The widget snapshot as the
/// file holds it, from the context the app last stored, or null when the
/// engine is not open or no context has been stored, and then the worker
/// leaves the file it has.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_veloq_PushBridge_nativeWidgetSnapshot<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jstring {
    crate::ffi_refuse_on_panic("push widget snapshot", std::ptr::null_mut(), || {
        match crate::widget_snapshot::native_snapshot_json() {
            Some(json) => env
                .new_string(json)
                .map_or(std::ptr::null_mut(), |s| s.into_raw()),
            None => {
                log::warn!("[push] no widget snapshot: engine closed or no stored context");
                std::ptr::null_mut()
            }
        }
    })
}
