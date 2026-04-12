/**
 * Constants for the section detail page.
 */

export type SectionTimeRange = '1m' | '3m' | '6m' | '1y' | 'all';

export const SECTION_TIME_RANGES: { id: SectionTimeRange; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: 'all', label: 'All' },
];

export const RANGE_DAYS: Record<SectionTimeRange, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  all: 0,
};
