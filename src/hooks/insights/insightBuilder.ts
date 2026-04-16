/**
 * Canonical insight builder.
 *
 * Every category generator used to duplicate this helper with slightly
 * different optional-field lists. A minimal copy could silently drop fields
 * like `subtitle` or `confidence`. This version allows every optional field
 * that any generator currently uses.
 */

import type { Insight, InsightMethodology, InsightSupportingData } from '@/types';

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
}

/** Build an Insight with `isNew: false` default. */
export function makeInsight(fields: InsightFields): Insight {
  return { ...fields, isNew: false } as Insight;
}
