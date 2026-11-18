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

/// A watch's nearby ask: the link's reply text for the saved sections and
/// routes near the watch's own fix, `{"id":0,"result":{"places":[...]}}`.
/// Opens the engine when it is closed, over a database file that exists. Null
/// when there is none or the engine will not open, and then the watch keeps
/// the last answer it holds. Blocks, so call it off the main thread. The
/// caller hands a non-null answer to `veloq_push_string_free`.
char *_Nullable veloq_watch_nearby(
    const char *_Nullable db_path,
    double latitude,
    double longitude,
    const char *_Nullable sport);

/// The app entered the background: a suspension may now be prepared.
void veloq_engine_entered_background(void);

/// Stop the engine writing and wait up to `deadline_ms` for the writes in
/// flight to end. True when none is left open.
bool veloq_engine_prepare_for_suspension(uint32_t deadline_ms);

/// Start the engine writing again.
void veloq_engine_resume_after_suspension(void);

#endif
