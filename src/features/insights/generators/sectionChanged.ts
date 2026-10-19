import type { Insight } from '../types';
import { NO_POPULATION, maxPerCategoryFor } from '../lib/config';
import type { LatLngShort } from '@/shared/geo/distance';

/**
 * Section changed insights.
 *
 * The detector re-cut, split, restored or reverted a section recently, and
 * its ledger says so. The insight points at the section's history rather
 * than judging the change: what moved and when, never why it was right.
 *
 * Data source: the engine's ledger of visible changes on live sections
 * (`recent_section_changes` on `insights_data`), joined to display names by the caller.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

export interface SectionChangeInput {
  sectionId: string;
  sectionName: string;
  /** recut, split, restored or reverted. */
  kind: string;
  /** Epoch ms of the change. */
  at: number;
  points?: LatLngShort[] | undefined;
}

/** The kinds a card is written for, each with its row sentence. */
const LINE_KEYS = new Map([
  ['recut', 'insights.line.sectionChanged.recut'],
  ['split', 'insights.line.sectionChanged.split'],
  ['restored', 'insights.line.sectionChanged.restored'],
  ['reverted', 'insights.line.sectionChanged.reverted'],
]);

export function generateSectionChangedInsights(
  changes: SectionChangeInput[],
  now: number,
  t: TFunc
): Insight[] {
  if (changes.length === 0) return [];
  const cap = maxPerCategoryFor('section_changed');
  const seen = new Set<string>();
  const insights: Insight[] = [];
  // Newest first, one insight per section.
  const ordered = [...changes].sort((a, b) => b.at - a.at);
  for (const change of ordered) {
    if (insights.length >= cap) break;
    const lineKey = LINE_KEYS.get(change.kind);
    if (!lineKey || seen.has(change.sectionId)) continue;
    seen.add(change.sectionId);
    insights.push({
      id: `section_changed-${change.sectionId}-${change.at}`,
      category: 'section_changed',
      priority: 3,
      icon: 'history',
      iconTone: 'info',
      title: t('insights.sectionChanged.title', { name: change.sectionName }),
      subtitle: t(`insights.sectionChanged.${change.kind}`),
      line: t(lineKey, { name: change.sectionName }),
      body: t('insights.sectionChanged.body'),
      navigationTarget: `/section/${change.sectionId}`,
      timestamp: now,
      // The dot is the fingerprint diff's to set, so a card the athlete has
      // seen loses it.
      isNew: false,
      confidence: NO_POPULATION,
      supportingData:
        change.points && change.points.length >= 2
          ? {
              history: {
                kind: 'line',
                points: change.points,
                target: `/section/${change.sectionId}`,
              },
            }
          : undefined,
      meta: {
        sourceTimestamp: change.at,
        comparisonKind: 'none',
        placeName: change.sectionName,
        sectionId: change.sectionId,
      },
    });
  }
  return insights;
}
