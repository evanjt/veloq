/**
 * Scenario: a previewed section's polyline used to cross as base64 inside a
 * JSON payload, because JSON has no bytes, and this side ran its own `atob`
 * and byte loop to get them back. The payload is a record now, so the
 * bytes cross as bytes.
 *
 * Expected behaviour: the delegate hands the map the record's own buffer
 * untouched, and narrows the two things a record cannot express: the four-word
 * status the engine writes as an open string, and the optionals the screen
 * reads as `null`.
 */

import { toPreviewSection } from '../../../modules/veloqrs/src/delegates/preview';
import type { FfiPreviewSection } from '../../../modules/veloqrs/src/generated/veloqrs';

const BYTES = [0x01, 0x7f, 0x00, 0xff, 0x80];

function row(overrides: Partial<FfiPreviewSection> = {}): FfiPreviewSection {
  return {
    id: 's1',
    status: 'new',
    polyline: new Uint8Array(BYTES).buffer,
    visits: 3,
    distanceM: 1200,
    pinned: false,
    ...overrides,
  };
}

describe('a previewed section crosses with its polyline as bytes', () => {
  it('hands the map the engine’s own buffer', () => {
    const section = toPreviewSection(row());

    expect(Array.from(new Uint8Array(section.polyline))).toEqual(BYTES);
  });

  it('carries an empty buffer for a section with no polyline', () => {
    const section = toPreviewSection(row({ polyline: new ArrayBuffer(0) }));

    expect(section.polyline.byteLength).toBe(0);
  });

  it('reads the absent fields as null, which is what the screen checks', () => {
    const section = toPreviewSection(row());

    expect(section.liveId).toBeNull();
    expect(section.name).toBeNull();
    expect(section.elevationGainM).toBeNull();
    expect(section.avgGradePercent).toBeNull();
  });

  it('keeps the four statuses and refuses a fifth', () => {
    for (const status of ['unchanged', 'changed', 'new', 'gone']) {
      expect(toPreviewSection(row({ status })).status).toBe(status);
    }
    // An engine that grew a fifth word must not put an unknown string into a
    // union the screen switches on.
    expect(toPreviewSection(row({ status: 'superseded' })).status).toBe('unchanged');
  });
});
