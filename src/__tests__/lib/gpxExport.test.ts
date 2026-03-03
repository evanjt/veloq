/**
 * Tests for GPX 1.1 file generation.
 *
 * Covers: generateGpx, escapeXml
 * Bug fix validated: NaN/Infinity coordinates are filtered or sanitized
 */

// escapeXml is not exported, so we test it indirectly through generateGpx name/sport/time fields.
// generateGpx is the main export.
import { generateGpx } from '@/lib/export/gpx';

describe('generateGpx', () => {
  it('generates valid GPX 1.1 XML structure', () => {
    const gpx = generateGpx({
      name: 'Morning Ride',
      points: [{ latitude: 48.8566, longitude: 2.3522, elevation: 35 }],
    });
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('creator="Veloq"');
    expect(gpx).toContain('<trk>');
    expect(gpx).toContain('<trkseg>');
    expect(gpx).toContain('<trkpt');
  });

  it('includes name in metadata and trk', () => {
    const gpx = generateGpx({ name: 'Test', points: [] });
    const nameMatches = gpx.match(/<name>Test<\/name>/g);
    expect(nameMatches).toHaveLength(2); // metadata + trk
  });

  it('includes time tag when provided', () => {
    const gpx = generateGpx({
      name: 'Test',
      points: [],
      time: '2026-01-01T10:00:00Z',
    });
    expect(gpx).toContain('<time>2026-01-01T10:00:00Z</time>');
  });

  it('includes sport as type tag', () => {
    const gpx = generateGpx({ name: 'Test', points: [], sport: 'Ride' });
    expect(gpx).toContain('<type>Ride</type>');
  });

  it('omits time and type tags when not provided', () => {
    const gpx = generateGpx({ name: 'Test', points: [] });
    expect(gpx).not.toContain('<time>');
    expect(gpx).not.toContain('<type>');
  });

  it('renders trackpoints with lat/lon', () => {
    const gpx = generateGpx({
      name: 'Test',
      points: [{ latitude: 51.5074, longitude: -0.1278 }],
    });
    expect(gpx).toContain('lat="51.5074"');
    expect(gpx).toContain('lon="-0.1278"');
  });
});

describe('generateGpx - NaN/Infinity filtering (BUG FIX)', () => {
  it('NaN latitude produces valid XML (point skipped)', () => {
    const gpx = generateGpx({
      name: 'Test',
      points: [{ latitude: NaN, longitude: 0 }],
    });
    expect(gpx).not.toContain('lat="NaN"');
    expect(gpx).not.toContain('<trkpt');
  });

  it('Infinity latitude is filtered out', () => {
    const gpx = generateGpx({
      name: 'Test',
      points: [{ latitude: Infinity, longitude: 0 }],
    });
    expect(gpx).not.toContain('Infinity');
    expect(gpx).not.toContain('<trkpt');
  });

  it('Infinity elevation is omitted while point is kept', () => {
    const gpx = generateGpx({
      name: 'Test',
      points: [{ latitude: 10, longitude: 20, elevation: Infinity }],
    });
    expect(gpx).toContain('lat="10"');
    expect(gpx).not.toContain('Infinity');
    expect(gpx).not.toContain('<ele>');
  });

  it('valid points kept when mixed with invalid', () => {
    const gpx = generateGpx({
      name: 'Mixed',
      points: [
        { latitude: NaN, longitude: 0 },
        { latitude: 48.8566, longitude: 2.3522 },
        { latitude: Infinity, longitude: -Infinity },
      ],
    });
    const trkptCount = (gpx.match(/<trkpt/g) || []).length;
    expect(trkptCount).toBe(1);
    expect(gpx).toContain('lat="48.8566"');
  });
});

describe('escapeXml (tested via generateGpx)', () => {
  it('escapes ampersand', () => {
    const gpx = generateGpx({ name: 'A & B', points: [] });
    expect(gpx).toContain('A &amp; B');
    expect(gpx).not.toContain('A & B');
  });

  it('escapes double quotes', () => {
    const gpx = generateGpx({ name: 'A "B" C', points: [] });
    expect(gpx).toContain('A &quot;B&quot; C');
  });
});
