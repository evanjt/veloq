#ifndef VeloqWidgetRefreshEngine_h
#define VeloqWidgetRefreshEngine_h

// The engine's C entries the background refresh calls, out of the Rust static
// library the app links through the Veloqrs pod. This pod does not depend on
// that pod, so the signatures are declared here, and the symbols resolve when
// the app links.

/// Open the engine at `db_path`, pull the last fortnight of wellness and
/// compose the widget snapshot. The credential arguments are the keychain
/// items as read, null for any that is absent. Returns the JSON
/// `{"status": ..., "snapshot": {...}}`, or null when there is nothing to write.
/// The caller hands a non-null answer to `veloq_push_string_free`.
char *_Nullable veloq_widget_refresh(
    const char *_Nullable db_path,
    const char *_Nullable access_token,
    const char *_Nullable api_key,
    const char *_Nullable athlete_id);

void veloq_push_string_free(char *_Nullable text);

#endif
