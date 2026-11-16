/**
 * Scenario: the detection pane on the connect page draws the phone's
 * `detection.settings` answer and turns an edited field into the matching
 * write.
 *
 * Expected behaviour: each field shows the value the phone holds, an edit of
 * the switch, of a strictness number or of a section number asks the one
 * write that owns it with the whole record the engine takes, and a value the
 * engine would refuse is caught first and names its message.
 */

import {
  DETECTION_FIELDS,
  detectionWrite,
  enabledWrite,
  type DetectionSettings,
} from '../../../web/connect/detectionSettings';

const held: DetectionSettings = {
  enabled: true,
  strictness: { minMatchPct: 80, endpointThreshold: 200 },
  sectionConfig: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 5000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
};

describe('detection pane writes', () => {
  vaultIt(
    'lists the two grouping numbers then the five section parameters, each with its value',
    () => {
      expect(DETECTION_FIELDS.map((field) => field.key)).toEqual([
        'minMatchPct',
        'endpointThreshold',
        'proximityThreshold',
        'minSectionLength',
        'maxSectionLength',
        'minActivities',
        'divergenceThreshold',
      ]);
      expect(DETECTION_FIELDS.map((field) => field.read(held))).toEqual([
        80, 200, 50, 500, 5000, 3, 0.2,
      ]);
    }
  );

  vaultIt('sends the switch as detection.setEnabled', () => {
    expect(enabledWrite(false)).toEqual({
      method: 'detection.setEnabled',
      params: { enabled: false },
    });
  });

  vaultIt('sends a changed grouping number with the other one unchanged', () => {
    expect(detectionWrite(held, 'minMatchPct', '90')).toEqual({
      ok: true,
      method: 'detection.setStrictness',
      params: { minMatchPct: 90, endpointThreshold: 200 },
    });
  });

  vaultIt('sends a changed section number with the other four unchanged', () => {
    expect(detectionWrite(held, 'maxSectionLength', '8000')).toEqual({
      ok: true,
      method: 'detection.setSectionConfig',
      params: { ...held.sectionConfig, maxSectionLength: 8000 },
    });
  });

  vaultIt('refuses what the engine refuses before asking, with the phone own words', () => {
    expect(detectionWrite(held, 'proximityThreshold', '')).toEqual({
      ok: false,
      error: 'settings.sectionParamInvalid',
    });
    expect(detectionWrite(held, 'proximityThreshold', '0')).toMatchObject({ ok: false });
    expect(detectionWrite(held, 'proximityThreshold', '-4')).toMatchObject({ ok: false });
    expect(detectionWrite(held, 'divergenceThreshold', 'abc')).toMatchObject({ ok: false });
    expect(detectionWrite(held, 'minActivities', '2.5')).toEqual({
      ok: false,
      error: 'settings.sectionParamInvalidWhole',
    });
    expect(detectionWrite(held, 'minActivities', '0')).toMatchObject({ ok: false });
    expect(detectionWrite(held, 'minMatchPct', '101')).toEqual({
      ok: false,
      error: 'settings.groupingParamInvalidPercent',
    });
    expect(detectionWrite(held, 'minMatchPct', '100')).toMatchObject({ ok: true });
  });

  vaultIt('asks nothing when the value is the one held', () => {
    expect(detectionWrite(held, 'minSectionLength', '500')).toEqual({ ok: false, error: null });
  });
});
