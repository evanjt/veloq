import type { CrankData } from './gatt';

/**
 * Derive cadence (rpm) from successive crank revolution samples.
 *
 * Both the revolution counter (uint16 for power meters, uint16 for CSC) and
 * the event time (uint16, 1/1024 s) wrap around, so deltas are computed
 * modulo 2^16. A repeated event time means no new crank event — the rider has
 * stopped pedalling; after a short grace window cadence decays to 0.
 */
export function createCrankCadenceCalculator(options?: { zeroAfterMs?: number }): {
  update: (sample: CrankData, now: number) => number | null;
  reset: () => void;
} {
  const zeroAfterMs = options?.zeroAfterMs ?? 3000;
  let prev: CrankData | null = null;
  let lastEventAt: number | null = null;
  let lastCadence = 0;

  return {
    update(sample: CrankData, now: number): number | null {
      if (prev === null) {
        prev = sample;
        lastEventAt = now;
        return null;
      }

      const revDelta = (sample.cumulativeRevs - prev.cumulativeRevs + 0x10000) % 0x10000;
      const timeDelta1024 = (sample.eventTime1024 - prev.eventTime1024 + 0x10000) % 0x10000;

      if (revDelta === 0 || timeDelta1024 === 0) {
        // No new crank event — coasting. Decay to 0 after the grace window.
        if (lastEventAt !== null && now - lastEventAt > zeroAfterMs) {
          lastCadence = 0;
          return 0;
        }
        return null;
      }

      prev = sample;
      lastEventAt = now;
      const rpm = (revDelta / (timeDelta1024 / 1024)) * 60;
      // Anything above 220 rpm is not human pedalling — treat as noise
      if (!Number.isFinite(rpm) || rpm < 0 || rpm > 220) return null;
      lastCadence = Math.round(rpm);
      return lastCadence;
    },

    reset() {
      prev = null;
      lastEventAt = null;
      lastCadence = 0;
    },
  };
}
