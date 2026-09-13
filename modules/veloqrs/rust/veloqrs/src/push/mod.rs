//! What a push handler with no JavaScript calls, and the JNI symbols it calls
//! it through.
//!
//! A data push wakes the app process, and on a cold start there is no
//! JavaScript in it: nothing has opened the engine and nothing has set the
//! credential, both of which TypeScript does at launch. So the handler has to
//! carry what a session needs and hand it over in one call.
//!
//! The surface is hand-written JNI rather than generated Kotlin bindings.
//! `uniffi-bindgen` has no way to generate a Kotlin binding without its
//! callback-interface initialisation, and a second installer of that vtable in
//! one process makes Rust dispatch a JavaScript-registered observer through
//! another language's handle map. `scripts/lint-one-observer-vtable.mjs`
//! refuses one. Two symbols beside the tile store's is the whole cost of
//! avoiding the question.
//!
//! The functions here hold the decisions and the JNI file only marshals, so
//! everything below is tested on the host rather than on a device.

#[cfg(target_os = "android")]
mod jni;

/// Open the engine and set the credential for a caller that arrived without
/// JavaScript, and say whether a fetch can now be attempted.
///
/// Neither half is overwritten if it is already there. A push can land while
/// the app is in the foreground, and re-opening the database would swap the
/// engine out from under the connection JavaScript is reading through, while a
/// credential JavaScript holds is the fresher of the two: a token refresh
/// writes it there first.
pub fn prepare_native_session(
    db_path: &str,
    auth_method: &str,
    secret: &str,
    athlete_id: &str,
) -> Result<(), String> {
    if crate::persistence::with_persistent_engine(|_| ()).is_none()
        && !crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path.to_string())
    {
        return Err(format!("the engine did not open at {db_path}"));
    }
    if crate::objects::current_transport().is_none() {
        crate::objects::set_credentials_from_native(auth_method, secret, athlete_id)?;
    }
    Ok(())
}

/// One activity's index summary as JSON, for a caller that speaks no UniFFI.
///
/// Three scalars and no strings, so it is written rather than serialised: the
/// type is a `uniffi::Record` shared with the JavaScript surface and giving it
/// a serde derive for one caller would put the wire format of the JSI path at
/// the mercy of a field rename here.
pub fn index_summary_json(summary: &crate::FfiIndexActivitySummary) -> String {
    format!(
        "{{\"matchedSections\":{},\"insertedPortions\":{},\"regrouped\":{}}}",
        summary.matched_sections, summary.inserted_portions, summary.regrouped
    )
}

/// Fetch, store and index one activity, and answer with the summary as JSON.
///
/// The error is a sentence the caller logs. It has no screen to put it on and
/// nothing to retry with that would go differently, so the shapes the JSI path
/// distinguishes are worth nothing here.
pub fn fetch_and_index_json(activity_id: &str, sport_type: &str) -> Result<String, String> {
    crate::ffi::fetch_and_index_activity(activity_id.to_string(), sport_type.to_string())
        .map(|summary| index_summary_json(&summary))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::serial_global_state;

    #[test]
    fn the_summary_is_json_a_java_caller_can_read() {
        let json = index_summary_json(&crate::FfiIndexActivitySummary {
            matched_sections: 3,
            inserted_portions: 5,
            regrouped: true,
        });

        assert_eq!(
            json,
            "{\"matchedSections\":3,\"insertedPortions\":5,\"regrouped\":true}"
        );
    }

    /// Scenario: a data push cold-starts the process. Nothing has opened the
    /// engine, so the entry point has to.
    #[test]
    fn a_cold_start_opens_the_engine_at_the_path_it_was_given() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let db = tmp.path().join("routes.db");
        crate::persistence::clear_persistent_engine();

        prepare_native_session(&db.to_string_lossy(), "api_key", "a-secret", "i1")
            .expect("the session");

        assert!(crate::persistence::with_persistent_engine(|_| ()).is_some());
        assert!(db.exists(), "the file the handler named");
        assert!(
            crate::objects::current_transport().is_some(),
            "the credential the handler carried"
        );
        crate::persistence::clear_persistent_engine();
    }

    /// Scenario: the push lands while the app is in the foreground. The engine
    /// and the credential are JavaScript's, and both are fresher than what the
    /// handler carries.
    ///
    /// Expected behaviour: neither is replaced. Re-opening the file would swap
    /// the connection out from under the screens reading through it.
    #[test]
    fn a_warm_process_keeps_the_engine_and_the_credential_it_has() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let before =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_ids().len())
                .expect("the engine JavaScript opened");
        let other = tempfile::TempDir::new().expect("tempdir");
        let unused = other.path().join("routes.db");

        prepare_native_session(&unused.to_string_lossy(), "api_key", "b-secret", "i2")
            .expect("the session");

        assert!(!unused.exists(), "the handler's path is not opened");
        let after =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_ids().len())
                .expect("the same engine");
        assert_eq!(after, before);
    }
}
