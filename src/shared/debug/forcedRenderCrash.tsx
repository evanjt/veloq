import { useState } from 'react';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * A render throw a debug native build can request, so the global crash screen
 * can be reached on a device.
 *
 * The request is set natively, by a receiver in the Android debug source set or
 * a launch argument read only in the iOS Debug configuration, and a release
 * build answers no. Reading it spends it natively, so a relaunch does not throw
 * again.
 *
 * A request read is held here until the boundary has caught the throw, not
 * spent on the first render: React retries a render that threw before it
 * reaches a boundary, and a request spent on the first attempt lets the retry
 * succeed. Each mount reads once.
 */
interface VeloqDebugCrashModule {
  takeRequest(): boolean;
}

let held = false;

function readRequest(): boolean {
  try {
    return (
      requireOptionalNativeModule<VeloqDebugCrashModule>('VeloqDebugCrash')?.takeRequest() === true
    );
  } catch {
    // A debug aid that throws on its own read would be a crash nobody asked for.
    return false;
  }
}

class ForcedRenderCrashError extends Error {
  constructor() {
    super('Forced render crash requested by a debug build');
    this.name = 'ForcedRenderCrashError';
  }
}

/** Mounted inside the root error boundary; throws while a request is held. */
export function ForcedRenderCrash(): null {
  useState(() => {
    if (!held) held = readRequest();
  });
  if (held) throw new ForcedRenderCrashError();
  return null;
}

/** Called by the boundary that caught `error`; a forced throw is then spent. */
export function settleForcedRenderCrash(error: unknown): void {
  if (error instanceof ForcedRenderCrashError) held = false;
}
