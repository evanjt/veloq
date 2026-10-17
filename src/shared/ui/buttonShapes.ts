import { useSyncExternalStore } from 'react';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The iOS Button Shapes setting, which React Native does not expose. It is read
 * once and then followed through the module's change event, so turning it on
 * while the app runs reaches every button without a restart. Android has no
 * such setting and reads off, as does a build with no module to ask.
 */

interface VeloqAccessibilityModule {
  buttonShapes(): boolean;
  addListener?(
    name: 'onButtonShapesChange',
    listener: (event: { enabled: boolean }) => void
  ): { remove(): void };
}

const native = requireOptionalNativeModule<VeloqAccessibilityModule>('VeloqAccessibility');

let setting: boolean | null = null;
let following = false;
const listeners = new Set<() => void>();

function publish(enabled: boolean): void {
  if (enabled === setting) return;
  setting = enabled;
  for (const listener of listeners) listener();
}

function read(): boolean {
  try {
    return native?.buttonShapes() === true;
  } catch {
    return false;
  }
}

function follow(): void {
  if (following) return;
  following = true;
  // The subscription lives as long as the app: the setting has one owner and
  // it is read for the whole session.
  native?.addListener?.('onButtonShapesChange', ({ enabled }) => publish(enabled === true));
  publish(read());
}

function subscribe(listener: () => void): () => void {
  follow();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readEnabled(): boolean {
  if (setting === null) setting = read();
  return setting;
}

/** Whether Button Shapes is on, re-rendering when the athlete changes it. */
export function useButtonShapes(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, readEnabled);
}
