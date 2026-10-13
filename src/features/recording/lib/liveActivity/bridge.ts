import { requireOptionalNativeModule } from 'expo-modules-core';

import { debug } from '@/shared/debug/debug';

const log = debug.create('LiveActivity');

/**
 * ActivityKit bridge. Absent on Android and on any iOS the extension does not
 * cover, so every entry point no-ops rather than making callers guard. The card
 * is a mirror of the recording, never its source, so a failure here is logged
 * and swallowed: losing the card must not lose the ride.
 */
export interface LiveActivityControlEvent {
  action: string;
}

interface VeloqLiveActivityModule {
  addListener(
    event: 'onControl',
    listener: (event: LiveActivityControlEvent) => void
  ): { remove: () => void };
  isSupported(): boolean;
  start(attributesJson: string, stateJson: string): string | null;
  update(stateJson: string): void;
  end(finalStateJson: string | null): void;
  endAll(): void;
}

/**
 * Resolved on first use, not at import. The module registry is not populated
 * when this file is first pulled in by the recording session's import graph.
 */
let resolved: VeloqLiveActivityModule | null | undefined;

function native(): VeloqLiveActivityModule | null {
  if (resolved === undefined) {
    resolved = requireOptionalNativeModule<VeloqLiveActivityModule>('VeloqLiveActivity');
  }
  return resolved;
}

function guard<T>(what: string, call: () => T): T | null {
  try {
    return call();
  } catch (e) {
    log.warn(`${what} failed:`, e);
    return null;
  }
}

/** Whether this build carries the card at all, switched on or not. */
export function isLiveActivityAvailable(): boolean {
  return native() !== null;
}

export function isLiveActivitySupported(): boolean {
  const mod = native();
  if (!mod) return false;
  return guard('isSupported', () => mod.isSupported()) === true;
}

export function startNativeLiveActivity(attributesJson: string, stateJson: string): string | null {
  const mod = native();
  if (!mod) return null;
  return guard('start', () => mod.start(attributesJson, stateJson));
}

export function updateNativeLiveActivity(stateJson: string): void {
  const mod = native();
  if (!mod) return;
  guard('update', () => mod.update(stateJson));
}

/**
 * End the card. With a final state it stays up on those figures until the state's
 * stale date, then dismisses itself; with none it is gone at once.
 */
export function endNativeLiveActivity(finalStateJson: string | null): void {
  const mod = native();
  if (!mod) return;
  guard('end', () => mod.end(finalStateJson));
}

/**
 * Listen for the card's own controls. A `LiveActivityIntent` runs in the app
 * process, not the extension, so its tap arrives here as an event.
 */
export function onLiveActivityControl(
  listener: (event: LiveActivityControlEvent) => void
): () => void {
  const mod = native();
  if (!mod) return () => undefined;
  const subscription = guard('addListener', () => mod.addListener('onControl', listener));
  return () => subscription?.remove();
}

/**
 * End every card this app owns at once, whoever started it and whether or not it
 * has ended already. Reaps orphans at launch and clears a stopped ride's card.
 */
export function endAllNativeLiveActivities(): void {
  const mod = native();
  if (!mod) return;
  guard('endAll', () => mod.endAll());
}
