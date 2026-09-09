type HermesGlobal = {
  HermesInternal?: { getInstrumentedStats?: () => Record<string, number> };
};

/** Hermes heap counters, or null off Hermes or without instrumentation. */
export function hermesStats(): Record<string, number> | null {
  return (globalThis as HermesGlobal).HermesInternal?.getInstrumentedStats?.() ?? null;
}
