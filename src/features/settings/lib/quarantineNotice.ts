/**
 * What the "your library was rebuilt" notice says it kept.
 *
 * A quarantine renames a database that cannot be opened aside and starts a
 * fresh one, which is the right call: the alternative is an engine that is
 * bricked on every launch. The engine carries over the rows a rebuild cannot
 * re-derive and counts them; the catalogue is left behind because the next
 * sync refills it.
 *
 * This is only the rule for turning those five counts into a sentence. A count
 * of zero is left out rather than printed: an athlete who never pinned a
 * geometry reads "0 pins kept" as something lost.
 */
import type { FfiQuarantineReport } from 'veloqrs';

export type QuarantineNoticeKey = 'sections' | 'history' | 'geometry' | 'pins' | 'intents';

export interface QuarantineNoticePart {
  key: QuarantineNoticeKey;
  count: number;
}

/**
 * The athlete's own sections first, because those are what they would miss.
 * The rest follow in the order they mean something to someone reading: what
 * happened to those sections, then the geometry behind them, then the pins on
 * it, then the corridors they removed.
 */
const ORDER: QuarantineNoticeKey[] = ['sections', 'history', 'geometry', 'pins', 'intents'];

/**
 * The parts of the notice, or null when there is nothing worth saying. Null
 * covers both no quarantine and a rebuild that rescued nothing: the second
 * already has its log line, and a notice carrying no good news is a scare for
 * a fault the app recovered from.
 */
export function quarantineNoticeParts(
  report: FfiQuarantineReport | null
): QuarantineNoticePart[] | null {
  if (!report) return null;
  const parts = ORDER.map((key) => ({ key, count: report[key] })).filter(
    (part) => Number.isFinite(part.count) && part.count > 0
  );
  return parts.length > 0 ? parts : null;
}
