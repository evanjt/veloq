/**
 * Scenario: the cold-start harness read `[FFI] name: Nms` logcat lines, which the
 * app no longer writes, so every run reported a detection time of 0.
 *
 * Expected behaviour: detection time is the summed totalMs of detection, section
 * and sync calls in the FFI ring summary, read bare or under `ffiMetrics`. A
 * missing or empty ring is unknown, never 0.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const LIB = path.resolve(__dirname, '../../../scripts/lib/ffi-ring.mjs');

// The module is plain ESM, which Jest does not transform, so it runs in node.
async function load() {
  return {
    detectionMsFromRing(dump: unknown): number | null {
      const res = spawnSync(
        'node',
        [
          '--input-type=module',
          '-e',
          `import { detectionMsFromRing } from ${JSON.stringify(LIB)};
           console.log(JSON.stringify(detectionMsFromRing(JSON.parse(process.argv[1]))));`,
          JSON.stringify(dump),
        ],
        { encoding: 'utf8' }
      );
      if (res.status !== 0) throw new Error(res.stderr);
      return JSON.parse(res.stdout);
    },
  };
}

const stat = (totalMs: number) => ({
  calls: 1,
  totalMs,
  avgMs: totalMs,
  maxMs: totalMs,
  p95Ms: totalMs,
});

describe('detectionMsFromRing', () => {
  it('sums the detection, section and sync calls and ignores the rest', async () => {
    const { detectionMsFromRing } = await load();
    const ring = {
      detectSections: stat(1200.4),
      getSectionSummaries: stat(30),
      syncNow: stat(500),
      getActivities: stat(9000),
    };
    expect(detectionMsFromRing(ring)).toBe(1730);
  });

  it('reads the ring under ffiMetrics in a debug snapshot', async () => {
    const { detectionMsFromRing } = await load();
    expect(detectionMsFromRing({ ffiMetrics: { detectSections: stat(250) } })).toBe(250);
  });

  it('strips a place tag when matching the call name', async () => {
    const { detectionMsFromRing } = await load();
    expect(detectionMsFromRing({ 'detectSections@launch': stat(80) })).toBe(80);
  });

  it('is unknown rather than 0 for an empty or missing ring', async () => {
    const { detectionMsFromRing } = await load();
    expect(detectionMsFromRing({})).toBeNull();
    expect(detectionMsFromRing({ ffiMetrics: {} })).toBeNull();
    expect(detectionMsFromRing(null)).toBeNull();
  });

  it('is 0 when the ring has calls but none are detection calls', async () => {
    const { detectionMsFromRing } = await load();
    expect(detectionMsFromRing({ getActivities: stat(40) })).toBe(0);
  });
});
