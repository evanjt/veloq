/**
 * The cutover diff parser sits between a Rust payload and the change card.
 * A malformed payload must degrade to null or drop the bad row, never throw
 * and never surface a half-built section to the UI.
 */

import { parseCutoverDiff } from '../../../modules/veloqrs/src/delegates/cutover';

const validPayload = {
  token: 'unified-1',
  counts: { current: 12, proposed: 14, unchanged: 9, changed: 3, new: 2, gone: 0 },
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
    {
      id: 'sec_2',
      live_id: null,
      status: 'new',
      name: null,
      sport: 'Ride',
      polyline: 'BBBB',
      visits: 3,
      distance_m: 900,
      elevation_gain_m: null,
      avg_grade_percent: null,
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
    expect(result!.sections).toHaveLength(2);
    expect(result!.sections[0].liveId).toBe('sec_old_1');
    expect(result!.sections[0].elevationGainM).toBe(45.5);
    expect(result!.sections[1].liveId).toBeNull();
    expect(result!.sections[1].elevationGainM).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(parseCutoverDiff('not json at all')).toBeNull();
    expect(parseCutoverDiff('')).toBeNull();
  });

  it('returns null when the token is missing', () => {
    const { token: _token, ...rest } = validPayload;
    expect(parseCutoverDiff(JSON.stringify(rest))).toBeNull();
  });

  it('returns null when sections is not an array', () => {
    expect(parseCutoverDiff(JSON.stringify({ ...validPayload, sections: 'nope' }))).toBeNull();
  });

  it('drops a row with an unrecognised status rather than failing the payload', () => {
    const payload = {
      ...validPayload,
      sections: [...validPayload.sections, { id: 'sec_3', status: 'exploded' }],
    };
    const result = parseCutoverDiff(JSON.stringify(payload));
    expect(result!.sections).toHaveLength(2);
  });

  it('drops a row with no id', () => {
    const payload = {
      ...validPayload,
      sections: [{ status: 'new', sport: 'Ride' }],
    };
    const result = parseCutoverDiff(JSON.stringify(payload));
    expect(result!.sections).toHaveLength(0);
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
      sections: [],
    };
    const result = parseCutoverDiff(JSON.stringify(payload));
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(0);
  });
});
