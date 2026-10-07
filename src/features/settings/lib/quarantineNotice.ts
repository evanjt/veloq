/**
 * What the "your library was rebuilt" notice says it kept.
 *
 * A quarantine renames a database that cannot be opened aside and starts a
 * fresh one, which is the right call: the alternative is an engine that is
 * bricked on every launch. The engine carries over the rows a rebuild cannot
 * re-derive and counts them; the catalogue is left behind because the next
 * sync refills it.
 *
 * This is only the rule for turning the report counts into a sentence. A count
 * of zero is left out rather than printed: an athlete who never pinned a
 * geometry reads "0 pins kept" as something lost.
 */
import type { FfiQuarantineReport } from 'veloqrs';

export type QuarantineNoticeKey =
  | 'sections'
  | 'history'
  | 'geometry'
  | 'pins'
  | 'intents'
  | 'recordings'
  | 'routeNames';

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
const ORDER: QuarantineNoticeKey[] = [
  'recordings',
  'routeNames',
  'sections',
  'history',
  'geometry',
  'pins',
  'intents',
];

/**
 * The parts of the notice, or null when there was no quarantine. A rebuild
 * that rescued nothing answers an empty list: the notice still says what
 * happened, since the athlete who lost the most is the one who most needs
 * telling, and only the kept line is left out.
 */
export function quarantineNoticeParts(
  report: FfiQuarantineReport | null
): QuarantineNoticePart[] | null {
  if (!report) return null;
  const counts: Partial<Record<QuarantineNoticeKey, number>> = report;
  const parts = ORDER.map((key) => ({ key, count: counts[key] })).filter(
    (part): part is QuarantineNoticePart =>
      typeof part.count === 'number' && Number.isFinite(part.count) && part.count > 0
  );
  return parts;
}
