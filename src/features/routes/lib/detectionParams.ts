/**
 * The five detection parameters: what the detector was validated over, where
 * it stops distinguishing values, and the three presets that set all five at
 * once.
 *
 * The sliders cover the tested range. A value outside it is typed rather than
 * dragged, because the athlete is allowed to experiment and a slider that
 * reaches a value nothing acts on is a control that moves and does nothing.
 * `clampOf` names the point past which the detector stops distinguishing, so
 * the panel can say so instead of pretending.
 */

import { UNIFIED_CONFIG } from '@/shared/native/unifiedConfig.generated';
import type { PreviewParams } from '../../../../modules/veloqrs/src/delegates/preview';

export type DetectionParamKey = keyof PreviewParams;

interface ParamRange {
  /** The slider's own bounds: what the detector has been run over. */
  min: number;
  max: number;
  step: number;
  /**
   * Where the detector stops telling values apart, when it has such a point.
   * Both bounds are inclusive and taken from the clamps inside the detector,
   * not from the settings boundary, which saves whatever it is given.
   */
  clamp?: { min: number; max: number };
  /** Whole numbers only, so a typed 2.5 is not persisted as a visit count. */
  integer?: boolean;
}

/**
 * `divergenceThreshold`'s clamp is the detector's own, at
 * `tracematch/src/sections/mod.rs`' unified detector, and it is exactly the
 * slider's range. `proximityThreshold`'s clamp bounds its effect on the
 * coverage grid. The other three have no clamp: the detector acts on whatever
 * it is given.
 *
 * Both clamps are now measured rather than read off the expression. Swept over
 * 1,188 pooled activities, twice with identical counts, proximity 10, 50 and
 * 100 m produce the same catalogue in every column, and so do 300, 450 and
 * 600; divergence 0.01 and 0.05 are one value, and 0.5, 0.65 and 0.8 another.
 * Proximity's slider floor was 25 m, inherited from the panel this replaced,
 * so three of its twelve stops moved nothing.
 */
export const DETECTION_PARAM_RANGES: Record<DetectionParamKey, ParamRange> = {
  proximityThreshold: { min: 100, max: 300, step: 25, clamp: { min: 100, max: 300 } },
  minSectionLength: { min: 50, max: 2000, step: 50 },
  maxSectionLength: { min: 2000, max: 200000, step: 1000 },
  minActivities: { min: 2, max: 10, step: 1, integer: true },
  divergenceThreshold: { min: 0.05, max: 0.5, step: 0.05, clamp: { min: 0.05, max: 0.5 } },
};

export type DetectionPresetName = 'default' | 'strict' | 'relaxed';

/**
 * Every preset sets all five fields. The screen's own form models four, and a
 * preset that inherited that shape would leave `maxSectionLength` at whatever
 * the athlete last dragged it to while claiming to have set the lot.
 *
 * `minActivities` is already at its floor in the default, so relaxed has
 * nowhere below to go and widens the divergence instead.
 */
export const DETECTION_PRESETS: Record<DetectionPresetName, PreviewParams> = {
  default: { ...UNIFIED_CONFIG },
  strict: {
    proximityThreshold: 100,
    minSectionLength: 300,
    maxSectionLength: 200000,
    minActivities: 3,
    divergenceThreshold: 0.05,
  },
  relaxed: {
    proximityThreshold: 300,
    minSectionLength: 50,
    maxSectionLength: 200000,
    minActivities: 2,
    divergenceThreshold: 0.5,
  },
};

export const DETECTION_PRESET_NAMES: DetectionPresetName[] = ['default', 'strict', 'relaxed'];

/** Whether the detector still tells this value apart from the one beside it. */
export function isPastClamp(key: DetectionParamKey, value: number): boolean {
  const clamp = DETECTION_PARAM_RANGES[key].clamp;
  if (!clamp) return false;
  return value < clamp.min || value > clamp.max;
}

/**
 * Read a typed value, or null when it is not one the detector can be given.
 * Zero and below are refused for every parameter: a distance, a visit count
 * and a divergence are all positive or they are nothing.
 */
export function parseParamInput(key: DetectionParamKey, text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return DETECTION_PARAM_RANGES[key].integer ? Math.round(value) : value;
}

/** Which preset a set of parameters is, or null when it is none of them. */
export function presetOf(params: PreviewParams): DetectionPresetName | null {
  return (
    DETECTION_PRESET_NAMES.find((name) =>
      (Object.keys(DETECTION_PARAM_RANGES) as DetectionParamKey[]).every(
        (key) => DETECTION_PRESETS[name][key] === params[key]
      )
    ) ?? null
  );
}
