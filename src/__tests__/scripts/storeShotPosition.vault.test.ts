/**
 * Scenario: the recording shot shows a live map under the device's position. A
 * capture that sets none shows the capturing handset's real location on the
 * public site and in the store sets.
 *
 * Expected behaviour: the recording stem carries a mocked track inside the demo
 * library's bounds, a capture on an emulator or simulator plays it, and a
 * physical handset is refused because it cannot be given a position.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { demoRoutes } from '@/shared/demo/routes/routes';
import { STORE_SHOTS, capturePosition } from '../../../scripts/store-shots';

const ROOT = path.resolve(__dirname, '../../..');

function demoBounds() {
  const all = demoRoutes.flatMap((r) => r.coordinates);
  const lats = all.map((c) => c[0]);
  const lngs = all.map((c) => c[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

describe('the recording shot position', () => {
  it('is declared on the recording stem and no other', () => {
    const withPosition = STORE_SHOTS.filter((s) => s.position).map((s) => s.stem);
    expect(withPosition).toEqual(['08-recording']);
  });

  it('is a moving track of several fixes inside the demo library bounds', () => {
    const track = capturePosition('emulator');
    expect(track).not.toBeNull();
    expect(track!.length).toBeGreaterThanOrEqual(8);
    const b = demoBounds();
    for (const [lat, lng] of track!) {
      expect(lat).toBeGreaterThanOrEqual(b.minLat);
      expect(lat).toBeLessThanOrEqual(b.maxLat);
      expect(lng).toBeGreaterThanOrEqual(b.minLng);
      expect(lng).toBeLessThanOrEqual(b.maxLng);
    }
    expect(new Set(track!.map((c) => c.join(','))).size).toBe(track!.length);
  });

  it('plays on a simulator too', () => {
    expect(capturePosition('simulator')).toEqual(capturePosition('emulator'));
  });

  it('is refused for a physical handset', () => {
    expect(() => capturePosition('physical')).toThrow(/physical/);
  });

  it('prints one "lat,lng" waypoint per line for the capture scripts', () => {
    const run = spawnSync(
      'npx',
      ['--no-install', 'tsx', 'scripts/store-shots.ts', 'track', 'emulator'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );
    expect(run.status).toBe(0);
    const lines = run.stdout.trim().split('\n');
    expect(lines).toHaveLength(capturePosition('emulator')!.length);
    for (const line of lines) expect(line).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);
  });
});
