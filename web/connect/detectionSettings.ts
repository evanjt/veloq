// The detection pane's fields and writes. Pure, so a test drives them without
// a browser. The phone's three detection writes each take a whole record, so a
// changed field is sent with the others as the phone holds them, and a value
// the engine would refuse is caught here with the phone's own words.

import type { ParseKeys } from 'i18next';

import type { Methods } from './schema';

export type DetectionSettings = Methods['detection.settings']['result'];

type Strictness = DetectionSettings['strictness'];
type SectionConfig = DetectionSettings['sectionConfig'];

export type DetectionField = {
  key: keyof Strictness | keyof SectionConfig;
  label: ParseKeys;
  group: 'strictness' | 'sectionConfig';
  /** The value must be a whole number. */
  whole: boolean;
  /** The largest value the engine takes, when it has one. */
  max?: number;
  read: (settings: DetectionSettings) => number;
};

function strictField(key: keyof Strictness, label: ParseKeys, max?: number): DetectionField {
  return {
    key,
    label,
    group: 'strictness',
    whole: false,
    ...(max === undefined ? {} : { max }),
    read: (s) => s.strictness[key],
  };
}

function sectionField(key: keyof SectionConfig, label: ParseKeys, whole = false): DetectionField {
  return { key, label, group: 'sectionConfig', whole, read: (s) => s.sectionConfig[key] };
}

/** The two grouping numbers, then the five section parameters, in the phone's order. */
export const DETECTION_FIELDS: readonly DetectionField[] = [
  strictField('minMatchPct', 'connectPage.settings.detection.minMatchPct', 100),
  strictField('endpointThreshold', 'connectPage.settings.detection.endpointThreshold'),
  sectionField('proximityThreshold', 'connectPage.settings.detection.proximity'),
  sectionField('minSectionLength', 'connectPage.settings.detection.minLength'),
  sectionField('maxSectionLength', 'connectPage.settings.detection.maxLength'),
  sectionField('minActivities', 'connectPage.settings.detection.minActivities', true),
  sectionField('divergenceThreshold', 'connectPage.settings.detection.divergence'),
];

export type Write = {
  [M in 'detection.setEnabled' | 'detection.setStrictness' | 'detection.setSectionConfig']: {
    ok: true;
    method: M;
    params: Methods[M]['params'];
  };
}['detection.setEnabled' | 'detection.setStrictness' | 'detection.setSectionConfig'];

/** The write for the on and off switch. */
export function enabledWrite(enabled: boolean) {
  return { method: 'detection.setEnabled' as const, params: { enabled } };
}

/**
 * The write for one edited field, or why none is made: `error` is the key of
 * the phone's words for a value the engine refuses, and null when the value is
 * the one the phone already holds.
 */
export function detectionWrite(
  held: DetectionSettings,
  key: DetectionField['key'],
  raw: string
): Write | { ok: false; error: ParseKeys | null } {
  const field = DETECTION_FIELDS.find((candidate) => candidate.key === key);
  if (!field) return { ok: false, error: null };
  const text = raw.trim();
  const value = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      error: field.whole ? 'settings.sectionParamInvalidWhole' : 'settings.sectionParamInvalid',
    };
  }
  if (field.whole && !Number.isInteger(value)) {
    return { ok: false, error: 'settings.sectionParamInvalidWhole' };
  }
  if (field.max !== undefined && value > field.max) {
    return { ok: false, error: 'settings.groupingParamInvalidPercent' };
  }
  if (value === field.read(held)) return { ok: false, error: null };
  if (field.group === 'strictness') {
    return {
      ok: true,
      method: 'detection.setStrictness',
      params: { ...held.strictness, [key]: value },
    };
  }
  return {
    ok: true,
    method: 'detection.setSectionConfig',
    params: { ...held.sectionConfig, [key]: value },
  };
}
