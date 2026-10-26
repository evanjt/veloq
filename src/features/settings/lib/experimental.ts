import { useDebugStore } from '../stores/DebugStore';
import type { ExperimentalFeatureKey } from './experimentalFeatures';

interface ExperimentalSwitches {
  experimentalEnabled: boolean;
  experimentalFeatures: Partial<Record<ExperimentalFeatureKey, boolean>>;
}

/** A surface shows only with the master switch and its own entry both on. */
export function isExperimentalOn(
  state: ExperimentalSwitches,
  key: ExperimentalFeatureKey
): boolean {
  return state.experimentalEnabled && state.experimentalFeatures[key] !== false;
}

/** Whether one experimental feature is on, for a render. */
export function useExperimental(key: ExperimentalFeatureKey): boolean {
  return useDebugStore((s) => isExperimentalOn(s, key));
}

/** Whether one experimental feature is on, for code outside a render. */
export function experimentalOn(key: ExperimentalFeatureKey): boolean {
  return isExperimentalOn(useDebugStore.getState(), key);
}
