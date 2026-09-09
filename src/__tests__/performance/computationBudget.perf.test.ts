/**
 * Throughput of the pure formatters, measured rather than asserted tightly.
 *
 * Wall-clock in a shared checkout is a load measurement as much as a code one,
 * so this file is out of the ordinary suite: `npm run test:perf` runs it and
 * `scripts/perf-compare.ts` reads the per-test durations out of that run. The
 * ceiling here is deliberately far above any real machine, so it catches an
 * algorithmic blowup and never a busy one.
 */
import { formatDistance, formatDuration, formatPace } from '@/shared/format/format';

/** 100k calls take about 40 ms on an idle machine. This is two orders above. */
const BLOWUP_CEILING_MS = 10_000;
const CALLS = 100_000;

describe('Computation budget', () => {
  describe('formatting throughput', () => {
    it('each core formatter completes 100k calls', () => {
      const formatters: [string, (i: number) => unknown][] = [
        ['formatDistance', (i) => formatDistance(i * 10, true)],
        ['formatDuration', (i) => formatDuration(i)],
        ['formatPace', (i) => formatPace(3 + (i % 10), true)],
      ];
      for (const [name, run] of formatters) {
        const start = performance.now();
        let produced = 0;
        for (let i = 0; i < CALLS; i++) {
          if (run(i) !== undefined) produced += 1;
        }
        const elapsed = performance.now() - start;
        expect(produced).toBe(CALLS);
        expect({ name, elapsed: elapsed < BLOWUP_CEILING_MS }).toEqual({ name, elapsed: true });
      }
    });
  });
});
