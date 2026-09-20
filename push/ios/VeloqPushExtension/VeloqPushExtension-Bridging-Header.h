// The engine's own entries, exported by the Rust xcframework beside the UniFFI
// surface. See `modules/veloqrs/rust/veloqrs/src/push/c.rs`, whose tests link
// these same names on the host. Plain C because an app extension has no
// JavaScript, no JSI and no JNI, and it links the static library directly
// rather than through the `Veloqrs` pod, which depends on React.
//
// Three, the same three the Android worker calls over JNI. The one that
// answers a string hands ownership over with it: give it back to
// `veloq_push_string_free` and to nothing else.

#ifndef VeloqPushExtension_Bridging_Header_h
#define VeloqPushExtension_Bridging_Header_h

#include <stdbool.h>

bool veloq_push_prepare(const char *db_path, const char *access_token, const char *api_key,
                        const char *athlete_id);
char *veloq_push_activity(const char *activity_id);
void veloq_push_string_free(char *text);

#endif
