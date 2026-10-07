// The engine's own entries, exported by the Rust static library beside the UniFFI
// surface. See `modules/veloqrs/rust/veloqrs/src/push/c.rs`, whose tests link
// these same names on the host. Plain C because an app extension has no
// JavaScript, no JSI and no JNI, and it links the static library directly
// rather than through the `Veloqrs` pod, which depends on React.
//
// The extension uses these entries. A string answer hands ownership
// over with it: give it back to
// `veloq_push_string_free` and to nothing else.

#ifndef VeloqPushExtension_Bridging_Header_h
#define VeloqPushExtension_Bridging_Header_h

#include <stdbool.h>

bool veloq_push_prepare(const char *db_path, const char *access_token, const char *api_key,
                        const char *athlete_id, char **refusal);
void veloq_push_record_refusal(const char *db_path, const char *activity_id, const char *reason);
char *veloq_push_payload_reason(const char *top_level_keys, const char *body_keys);
char *veloq_push_activity(const char *activity_id, const char *athlete_id);
void veloq_push_string_free(char *text);

#endif
