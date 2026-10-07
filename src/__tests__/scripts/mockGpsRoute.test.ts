/**
 * Scenario: a recording on the handset needs GPS movement and no agent can ride.
 *
 * Expected behaviour: the route is a closed loop of about 2 km at riding speed,
 * one fix per second with a usable accuracy, and the command list always ends
 * by removing the test provider and restoring the mock-location appop.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE = join(__dirname, '../../../scripts/lib/mock-gps-route.mjs');

/** The module is ESM and Jest is not, so it is evaluated by node and read back as JSON. */
const evaluate = <T>(expression: string): T =>
  JSON.parse(
    execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import * as m from ${JSON.stringify(MODULE)}; console.log(JSON.stringify(${expression}))`,
      ],
      { encoding: 'utf8' }
    )
  );

type Fix = { lat: number; lng: number; accuracy: number; offsetSeconds: number };

const LOOP_METRES = evaluate<number>('m.LOOP_METRES');
const routeFixes = (o: { lat: number; lng: number }, speed: number, seconds: number) =>
  evaluate<Fix[]>(`m.routeFixes(${JSON.stringify(o)}, ${speed}, ${seconds})`);
const setupCommands = () => evaluate<string[][]>('m.setupCommands()');
const cleanupCommands = () => evaluate<string[][]>('m.cleanupCommands()');
const sessionCommands = (fixes: Fix[]) =>
  evaluate<string[][]>(`m.sessionCommands(${JSON.stringify(fixes)})`);

const origin = { lat: -33.85, lng: 151.2 };
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

describe('mock GPS route', () => {
  it('moves at riding speed, one fix per second', () => {
    const fixes = routeFixes(origin, 8, 60);
    expect(fixes).toHaveLength(61);
    for (let i = 1; i < fixes.length; i++) {
      expect(fixes[i].offsetSeconds - fixes[i - 1].offsetSeconds).toBe(1);
      expect(metres(fixes[i - 1], fixes[i])).toBeGreaterThan(7);
      expect(metres(fixes[i - 1], fixes[i])).toBeLessThan(9);
    }
  });

  it('closes the loop within 20 m after one lap', () => {
    expect(LOOP_METRES).toBeGreaterThan(1800);
    expect(LOOP_METRES).toBeLessThan(2200);
    const fixes = routeFixes(origin, 8, Math.round(LOOP_METRES / 8));
    expect(metres(fixes[0], fixes[fixes.length - 1])).toBeLessThan(20);
  });

  it('keeps going past one lap rather than stopping', () => {
    expect(routeFixes(origin, 8, 600)).toHaveLength(601);
  });

  it('reports accuracy at or below 5 m on every fix', () => {
    for (const fix of routeFixes(origin, 8, 30)) expect(fix.accuracy).toBeLessThanOrEqual(5);
  });

  it('returns no fixes for a zero duration beyond the first', () => {
    expect(routeFixes(origin, 8, 0)).toHaveLength(1);
  });

  it('ends every session in the cleanup, and the cleanup stands alone for an interrupt', () => {
    const all = sessionCommands(routeFixes(origin, 8, 3));
    const cleanup = cleanupCommands();
    expect(all.slice(-cleanup.length)).toEqual(cleanup);
    expect(cleanup.map((c) => c.join(' '))).toEqual([
      expect.stringContaining('remove-test-provider gps'),
      expect.stringContaining('appops set com.android.shell android:mock_location default'),
    ]);
    expect(all.slice(0, setupCommands().length)).toEqual(setupCommands());
    expect(setupCommands().join('|')).toContain('android:mock_location,allow');
  });
});
