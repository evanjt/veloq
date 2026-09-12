/**
 * Scenario: the preview delegate handed every section's polyline across as a
 * base64 string and the map component ran its own `atob` plus a `charCodeAt`
 * loop to get bytes back, once per section, per centre change and per run
 * result. Every other track in the app crosses as bytes already.
 *
 * Expected behaviour: the delegate decodes once, where the engine's JSON is
 * already being read, and the section carries the bytes the decoder wants.
 */

import { parsePreviewSections } from '../../../modules/veloqrs/src/delegates/preview';

const BYTES = [0x01, 0x7f, 0x00, 0xff, 0x80];
const BASE64 = Buffer.from(BYTES).toString('base64');

function rawSection(polyline: string) {
  return {
    id: 's1',
    live_id: null,
    status: 'new',
    name: null,
    sport: 'Ride',
    polyline,
    visits: 3,
    distance_m: 1200,
    elevation_gain_m: 40,
    avg_grade_percent: 3.3,
    pinned: false,
  };
}

describe('a previewed section crosses with its polyline as bytes', () => {
  it('decodes the base64 the engine sends, high bytes included', () => {
    const [section] = parsePreviewSections(JSON.stringify([rawSection(BASE64)]));
    expect(Array.from(new Uint8Array(section.polyline))).toEqual(BYTES);
  });

  it('carries an empty buffer for a section with no polyline', () => {
    const [section] = parsePreviewSections(JSON.stringify([rawSection('')]));
    expect(section.polyline.byteLength).toBe(0);
  });

  /// A malformed payload must not take the whole preview down: the section is
  /// still listed, with nothing to draw.
  it('carries an empty buffer when the base64 will not decode', () => {
    const [section] = parsePreviewSections(JSON.stringify([rawSection('not base64!!')]));
    expect(section.polyline.byteLength).toBe(0);
  });
});
