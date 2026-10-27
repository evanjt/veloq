import { useCallback } from 'react';
import { useDebugStore } from '../stores/DebugStore';
import type { ExperimentalFeatureKey } from './experimentalFeatures';

interface ExperimentalSwitches {
  experimentalEnabled: boolean;
  experimentalFeatures: Partial<Record<ExperimentalFeatureKey, boolean>>;
}

/**
 * A tour slide, card, row or screen that belongs to an experimental feature
 * names it here, and `surfaceShown` alone decides whether it shows.
 */
export interface ExperimentalSurface {
  experimental?: ExperimentalFeatureKey;
}

/** A surface shows only with the master switch on and its own entry explicitly chosen on. */
export function isExperimentalOn(
  state: ExperimentalSwitches,
  key: ExperimentalFeatureKey
): boolean {
  return state.experimentalEnabled && state.experimentalFeatures[key] === true;
}

/** A surface that names no experimental feature always shows; one that does, only while it is on. */
export function surfaceShown(state: ExperimentalSwitches, surface: ExperimentalSurface): boolean {
  return surface.experimental === undefined || isExperimentalOn(state, surface.experimental);
}

/** Whether one experimental feature is on, for a render. */
export function useExperimental(key: ExperimentalFeatureKey): boolean {
  return useDebugStore((s) => isExperimentalOn(s, key));
}

/** `surfaceShown` bound to the current switches, for filtering a list in a render. */
export function useSurfaceShown(): (surface: ExperimentalSurface) => boolean {
  const experimentalEnabled = useDebugStore((s) => s.experimentalEnabled);
  const experimentalFeatures = useDebugStore((s) => s.experimentalFeatures);
  return useCallback(
    (surface: ExperimentalSurface) =>
      surfaceShown({ experimentalEnabled, experimentalFeatures }, surface),
    [experimentalEnabled, experimentalFeatures]
  );
}

/** Whether one experimental feature is on, for code outside a render. */
export function experimentalOn(key: ExperimentalFeatureKey): boolean {
  return isExperimentalOn(useDebugStore.getState(), key);
}
