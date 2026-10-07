// Reads the FFI ring summary a debug snapshot carries as `ffiMetrics`, or a bare
// summary, which is what the Developer Dashboard shows. The app writes no
// per-call logcat lines, so the ring is the only record of an engine call's time.

export function ringSummary(dump) {
  if (!dump || typeof dump !== 'object') return {};
  const summary = dump.ffiMetrics ?? dump;
  return typeof summary === 'object' && summary !== null ? summary : {};
}

const DETECTION_CALL = /detect|section|sync/;

// Summed time of the detection, section and sync calls, or null when the ring
// holds no calls at all, so a missing dump is never read as a zero-cost run.
export function detectionMsFromRing(dump) {
  const entries = Object.entries(ringSummary(dump));
  if (entries.length === 0) return null;
  let totalMs = 0;
  for (const [name, stat] of entries) {
    const call = name.split('@')[0].toLowerCase();
    if (DETECTION_CALL.test(call)) totalMs += Number(stat.totalMs) || 0;
  }
  return Math.round(totalMs);
}
