/**
 * The cutover diff parser sits between a Rust payload and the change card.
 * A malformed payload must degrade to null, never throw. The payload carries
 * counts and the settings reset only; an older build also wrote a row per
 * section, which is read past rather than rejected.
 */

import { parseCutoverDiff } from '../../../modules/veloqrs/src/delegates/cutover';

const validPayload = {
  token: 'unified-1',
  counts: { current: 12, proposed: 14, unchanged: 9, changed: 3, new: 2, gone: 0 },
};

/** What an older build stored: both catalogues' geometry, in a row. */
const olderBuildPayload = {
  ...validPayload,
  sections: [
    {
      id: 'sec_1',
      live_id: 'sec_old_1',
      status: 'unchanged',
      name: 'Section 1',
      sport: 'Ride',
      polyline: 'AAAA',
      visits: 7,
      distance_m: 2200,
      elevation_gain_m: 45.5,
      avg_grade_percent: 2.1,
    },
  ],
};

describe('parseCutoverDiff', () => {
  it('parses a well-formed payload', () => {
    const result = parseCutoverDiff(JSON.stringify(validPayload));
    expect(result).not.toBeNull();
    expect(result!.token).toBe('unified-1');
    expect(result!.counts.current).toBe(12);
    expect(result!.counts.gone).toBe(0);
  });

  it('reads a payload an older build wrote, rows and all', () => {
    const result = parseCutoverDiff(JSON.stringify(olderBuildPayload));
    expect(result).not.toBeNull();
    expect(result!.counts.current).toBe(12);
    expect(result).not.toHaveProperty('sections');
  });

  it('returns null on invalid JSON', () => {
    expect(parseCutoverDiff('not json at all')).toBeNull();
    expect(parseCutoverDiff('')).toBeNull();
  });

  it('returns null when the token is missing', () => {
    const { token: _token, ...rest } = validPayload;
    expect(parseCutoverDiff(JSON.stringify(rest))).toBeNull();
  });

  it('coerces non-finite counts to zero rather than emitting NaN', () => {
    const payload = {
      ...validPayload,
      counts: { current: 'twelve', proposed: null, unchanged: 9, changed: 3, new: 2, gone: 0 },
    };
    const result = parseCutoverDiff(JSON.stringify(payload));
    expect(result!.counts.current).toBe(0);
    expect(result!.counts.proposed).toBe(0);
    expect(result!.counts.unchanged).toBe(9);
  });

  it('accepts an empty catalogue', () => {
    const payload = {
      token: 'unified-1',
      counts: { current: 0, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 0 },
    };
    const result = parseCutoverDiff(JSON.stringify(payload));
    expect(result).not.toBeNull();
    expect(result!.counts.current).toBe(0);
  });

  it('returns null when the counts are missing', () => {
    const { counts: _counts, ...rest } = validPayload;
    expect(parseCutoverDiff(JSON.stringify(rest))).toBeNull();
  });

  describe('the settings reset', () => {
    const parsed = (payload: unknown) => {
      const result = parseCutoverDiff(JSON.stringify(payload));
      if (!result) throw new Error('the diff did not parse');
      return result;
    };
    const reset = {
      previous: {
        proximityThreshold: 100,
        minSectionLength: 50,
        maxSectionLength: 200000,
        minActivities: 3,
        divergenceThreshold: 0.1,
        poolSports: true,
      },
      current: {
        proximityThreshold: 200,
        minSectionLength: 150,
        maxSectionLength: 200000,
        minActivities: 2,
        divergenceThreshold: 0.15,
        poolSports: true,
      },
    };

    it('carries both configs when the flip moved a value', () => {
      expect(parsed({ ...validPayload, settings_reset: reset }).settingsReset).toEqual({
        previous: {
          proximityThreshold: 100,
          minSectionLength: 50,
          maxSectionLength: 200000,
          minActivities: 3,
          divergenceThreshold: 0.1,
        },
        current: {
          proximityThreshold: 200,
          minSectionLength: 150,
          maxSectionLength: 200000,
          minActivities: 2,
          divergenceThreshold: 0.15,
        },
      });
    });

    it('reads a null or absent reset as none', () => {
      expect(parsed(validPayload).settingsReset).toBeNull();
      expect(parsed({ ...validPayload, settings_reset: null }).settingsReset).toBeNull();
    });

    it('drops a reset with a missing or non-numeric field rather than the diff', () => {
      const broken = {
        ...reset,
        previous: { ...reset.previous, minActivities: 'three' },
      };
      expect(parsed({ ...validPayload, settings_reset: broken }).settingsReset).toBeNull();
      const { proximityThreshold: _p, ...short } = reset.previous;
      const missing = { ...reset, previous: short };
      expect(parsed({ ...validPayload, settings_reset: missing }).settingsReset).toBeNull();
    });
  });
});
