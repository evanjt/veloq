// What the insights page decides before it draws: the cards grouped by their
// category, the window of planned events the page asks for, and which planned
// events fall on today. Pure, so a test drives it without a browser.

import type { Insight, InsightCategory } from '@/features/insights/types';

import type { Methods } from './schema';

export type PlannedEvent = Methods['insights.plannedEvents']['result']['events'][number];

export type CardGroup = { category: InsightCategory; insights: Insight[] };

/**
 * The cards grouped by category. A group sits where its best-ranked card sat
 * in the list, and cards keep the order they came in inside it, so the engine's
 * ranking leads both ways.
 */
export function groupByCategory(insights: readonly Insight[]): CardGroup[] {
  const groups = new Map<InsightCategory, Insight[]>();
  for (const insight of insights) {
    const held = groups.get(insight.category);
    if (held) held.push(insight);
    else groups.set(insight.category, [insight]);
  }
  return [...groups].map(([category, held]) => ({ category, insights: held }));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Wall-clock seconds of a local midnight, which is what the phone's calendar read takes. */
function wallSeconds(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) / 1000;
}

/**
 * The ask for the coming `days` days: from the start of today to the last
 * second of the final day, inclusive, in wall-clock seconds.
 */
export function plannedWindow(
  now: Date,
  days: number
): Methods['insights.plannedEvents']['params'] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return {
    oldestTs: wallSeconds(y, m, d),
    newestTs: wallSeconds(y, m, d + days) - 1,
  };
}

/** The events planned for the given local day, in the order the phone sent them. */
export function eventsOn(events: readonly PlannedEvent[], day: string): PlannedEvent[] {
  return events.filter((event) => event.day === day);
}

/** Whether a card has a series long enough to draw. */
export function hasHistory(insight: Insight): boolean {
  const history = insight.supportingData?.history;
  return !!history && 'series' in history && history.series.some((s) => s.points.length > 1);
}
