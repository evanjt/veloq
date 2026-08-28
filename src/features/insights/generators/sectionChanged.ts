import type { Insight } from '../types';
import { maxPerCategoryFor } from '../lib/config';
import { insightIcon } from '@/theme';

/**
 * Section changed insights.
 *
 * The detector re-cut, split, restored or reverted a section recently, and
 * its ledger says so. The insight points at the section's history rather
 * than judging the change: what moved and when, never why it was right.
 *
 * Data source: the engine's ledger of visible changes on live sections
 * (`getRecentSectionChanges`), joined to display names by the caller.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

export interface SectionChangeInput {
  sectionId: string;
  sectionName: string;
  /** recut, split, restored or reverted. */
  kind: string;
  /** Epoch ms of the change. */
  at: number;
}

const KINDS = new Set(['recut', 'split', 'restored', 'reverted']);

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
    if (!KINDS.has(change.kind) || seen.has(change.sectionId)) continue;
    seen.add(change.sectionId);
    insights.push({
      id: `section_changed-${change.sectionId}-${change.at}`,
      category: 'section_changed',
      priority: 3,
      icon: 'history',
      iconColor: insightIcon.info,
      title: t('insights.sectionChanged.title', { name: change.sectionName }),
      subtitle: t(`insights.sectionChanged.${change.kind}`),
      body: t('insights.sectionChanged.body'),
      navigationTarget: `/section/${change.sectionId}`,
      timestamp: now,
      isNew: true,
      meta: { sourceTimestamp: change.at, comparisonKind: 'none' },
    });
  }
  return insights;
}
