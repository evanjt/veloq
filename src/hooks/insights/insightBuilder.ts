/**
 * Canonical insight builder.
 *
 * Every category generator used to duplicate this helper with slightly
 * different optional-field lists. A minimal copy could silently drop fields
 * like `subtitle` or `confidence`. This version allows every optional field
 * that any generator currently uses.
 */

import type { Insight, InsightMeta, InsightMethodology, InsightSupportingData } from '@/types';

export interface InsightFields {
  id: string;
  category: Insight['category'];
  priority: Insight['priority'];
  icon: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  body?: string;
  navigationTarget?: string;
  timestamp: number;
  confidence?: number;
  supportingData?: InsightSupportingData;
  methodology?: InsightMethodology;
  /**
   * Optional structured metadata used by the rules pipeline (recency,
   * proximity, specificity, temporal-self framing). Generators attach this so
   * `rules.ts` can filter and rank without digging into category-specific
   * supportingData shapes.
   */
  meta?: InsightMeta;
}

/** Build an Insight with `isNew: false` default. */
export function makeInsight(fields: InsightFields): Insight {
  return { ...fields, isNew: false } as Insight;
}
