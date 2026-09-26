/**
 * Scenario: the five sliders cover the range the detector was validated over,
 * and nothing else could be reached at all. A preset has to set all five, and
 * a typed value has to be told apart from one the detector stops acting on.
 */

import {
  DETECTION_PARAM_RANGES,
  DETECTION_PRESETS,
  DETECTION_PRESET_NAMES,
  isPastClamp,
  parseParamInput,
  presetOf,
  type DetectionParamKey,
} from '@/features/routes/lib/detectionParams';
import { UNIFIED_CONFIG } from '@/shared/native/unifiedConfig.generated';

const KEYS = Object.keys(DETECTION_PARAM_RANGES) as DetectionParamKey[];

describe('the tested ranges', () => {
  it('covers every parameter the preview takes', () => {
    expect(KEYS.sort()).toEqual(Object.keys(UNIFIED_CONFIG).sort());
  });

  it('holds the configuration the detector is validated at', () => {
    for (const key of KEYS) {
      const { min, max } = DETECTION_PARAM_RANGES[key];
      expect(UNIFIED_CONFIG[key]).toBeGreaterThanOrEqual(min);
      expect(UNIFIED_CONFIG[key]).toBeLessThanOrEqual(max);
    }
  });

  it('states a clamp only where the detector has one, and inside the tested range', () => {
    expect(DETECTION_PARAM_RANGES.divergenceThreshold.clamp).toEqual({ min: 0.05, max: 0.5 });
    expect(DETECTION_PARAM_RANGES.proximityThreshold.clamp).toEqual({ min: 100, max: 300 });
    expect(DETECTION_PARAM_RANGES.minSectionLength.clamp).toBeUndefined();
    expect(DETECTION_PARAM_RANGES.maxSectionLength.clamp).toBeUndefined();
    expect(DETECTION_PARAM_RANGES.minActivities.clamp).toBeUndefined();
  });

  /**
   * The file's own rule: a slider that reaches a value nothing acts on is a
   * control that moves and does nothing. Proximity's slider started at 25 m,
   * inherited from the panel this replaced, while the detector tells nothing
   * apart below 100 m: a corpus sweep of 1,188 activities produced the same
   * catalogue in every column at 10, 50 and 100 m, and the same again at 300,
   * 450 and 600. Past a clamp is for typing, not for dragging.
   */
  it('never lets a slider reach past a clamp, which is what typing is for', () => {
    for (const key of KEYS) {
      const { min, max, clamp } = DETECTION_PARAM_RANGES[key];
      if (!clamp) continue;
      expect({ key, min }).toEqual({ key, min: Math.max(min, clamp.min) });
      expect({ key, max }).toEqual({ key, max: Math.min(max, clamp.max) });
    }
  });

  it('leaves every slider a range to move over', () => {
    for (const key of KEYS) {
      const { min, max, step } = DETECTION_PARAM_RANGES[key];
      expect(max).toBeGreaterThan(min);
      expect((max - min) / step).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('a value past the clamp', () => {
  it('is named for the two parameters that have one', () => {
    expect(isPastClamp('divergenceThreshold', 0.8)).toBe(true);
    expect(isPastClamp('divergenceThreshold', 0.01)).toBe(true);
    expect(isPastClamp('proximityThreshold', 500)).toBe(true);
    expect(isPastClamp('proximityThreshold', 50)).toBe(true);
  });

  it('is not claimed on the bound itself', () => {
    expect(isPastClamp('divergenceThreshold', 0.5)).toBe(false);
    expect(isPastClamp('divergenceThreshold', 0.05)).toBe(false);
    expect(isPastClamp('proximityThreshold', 100)).toBe(false);
    expect(isPastClamp('proximityThreshold', 300)).toBe(false);
  });

  it('is never claimed where the detector acts on whatever it is given', () => {
    expect(isPastClamp('minSectionLength', 999999)).toBe(false);
    expect(isPastClamp('maxSectionLength', 1)).toBe(false);
    expect(isPastClamp('minActivities', 400)).toBe(false);
  });
});

describe('a typed value', () => {
  it('is taken past the slider, which is the point of typing it', () => {
    expect(parseParamInput('maxSectionLength', '500000')).toBe(500000);
    expect(parseParamInput('divergenceThreshold', '0.8')).toBe(0.8);
  });

  it('is refused when it is not a number the detector could be given', () => {
    for (const text of ['', ' ', 'abc', '0', '-5', 'NaN', 'Infinity']) {
      expect(parseParamInput('minSectionLength', text)).toBeNull();
    }
  });

  it('reads a decimal comma, which half the locales type', () => {
    expect(parseParamInput('divergenceThreshold', '0,35')).toBeCloseTo(0.35);
  });

  it('is rounded where the parameter counts things', () => {
    expect(parseParamInput('minActivities', '3.6')).toBe(4);
    expect(parseParamInput('minSectionLength', '150.5')).toBe(150.5);
  });
});

describe('the presets', () => {
  it('set all five fields, so none is left where the last drag put it', () => {
    for (const name of DETECTION_PRESET_NAMES) {
      expect(Object.keys(DETECTION_PRESETS[name]).sort()).toEqual(KEYS.slice().sort());
    }
  });

  it('stay inside the tested range, because nothing outside it has been run', () => {
    for (const name of DETECTION_PRESET_NAMES) {
      for (const key of KEYS) {
        const { min, max } = DETECTION_PARAM_RANGES[key];
        expect(DETECTION_PRESETS[name][key]).toBeGreaterThanOrEqual(min);
        expect(DETECTION_PRESETS[name][key]).toBeLessThanOrEqual(max);
      }
    }
  });

  it('leaves the default as the configuration Rust declares', () => {
    expect(DETECTION_PRESETS.default).toEqual({ ...UNIFIED_CONFIG });
  });

  it('splits more eagerly when strict and less when relaxed', () => {
    expect(DETECTION_PRESETS.strict.divergenceThreshold).toBeLessThan(
      DETECTION_PRESETS.default.divergenceThreshold
    );
    expect(DETECTION_PRESETS.relaxed.divergenceThreshold).toBeGreaterThan(
      DETECTION_PRESETS.default.divergenceThreshold
    );
    expect(DETECTION_PRESETS.strict.minActivities).toBeGreaterThan(
      DETECTION_PRESETS.relaxed.minActivities
    );
  });

  it('names which preset a set of parameters is, and none when it is neither', () => {
    expect(presetOf(DETECTION_PRESETS.strict)).toBe('strict');
    expect(presetOf(DETECTION_PRESETS.default)).toBe('default');
    expect(presetOf({ ...DETECTION_PRESETS.strict, minActivities: 9 })).toBeNull();
  });
});
