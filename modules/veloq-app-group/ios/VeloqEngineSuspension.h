#ifndef VeloqEngineSuspension_h
#define VeloqEngineSuspension_h

#include <stdbool.h>
#include <stdint.h>

// The engine's C entries for suspension, out of the Rust static library the
// app links through the Veloqrs pod. This pod does not depend on that pod, so
// the signatures are declared here, and the symbols resolve when the app links.

/// The app entered the background: a suspension may now be prepared.
void veloq_engine_entered_background(void);

/// Stop the engine writing and wait up to `deadline_ms` for the writes in
/// flight to end. True when none is left open.
bool veloq_engine_prepare_for_suspension(uint32_t deadline_ms);

/// Start the engine writing again.
void veloq_engine_resume_after_suspension(void);

#endif
