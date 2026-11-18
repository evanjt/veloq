#ifndef VeloqWatchEngine_h
#define VeloqWatchEngine_h

#include <stdint.h>

// The engine's C entries for a watch, out of the Rust static library the app
// links through the Veloqrs pod. This pod does not depend on that pod, so the
// signatures are declared here, and the symbols resolve when the app links.

/// Answer one link request, a NUL-terminated UTF-8 string. The reply is freed
/// with `veloq_watch_free`; null for a null request.
char *veloq_watch_answer(const char *request);

/// The reply to a watch that speaks versions `min` through `max`: the highest
/// version both hold, or a refusal naming both ranges. Freed with
/// `veloq_watch_free`.
char *veloq_watch_hello(uint32_t min, uint32_t max);

/// Free a string the two entries above returned.
void veloq_watch_free(char *reply);

#endif
