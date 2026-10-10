#ifndef VeloqWidgetRefreshEngine_h
#define VeloqWidgetRefreshEngine_h

#include <stdbool.h>
#include <stdint.h>

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

/// The app entered the background: a suspension may now be prepared.
void veloq_engine_entered_background(void);

/// Stop the engine writing and wait up to `deadline_ms` for the writes in
/// flight to end. True when none is left open.
bool veloq_engine_prepare_for_suspension(uint32_t deadline_ms);

/// Start the engine writing again.
void veloq_engine_resume_after_suspension(void);

#endif
