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

export const BUCKET_THRESHOLD = 100;

export type BucketType = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const BUCKET_TYPES: {
  id: BucketType;
  labelKey:
    | 'sections.bestPerWeek'
    | 'sections.bestPerMonth'
    | 'sections.bestPerQuarter'
    | 'sections.bestPerYear';
}[] = [
  { id: 'weekly', labelKey: 'sections.bestPerWeek' },
  { id: 'monthly', labelKey: 'sections.bestPerMonth' },
  { id: 'quarterly', labelKey: 'sections.bestPerQuarter' },
  { id: 'yearly', labelKey: 'sections.bestPerYear' },
];

export const DEFAULT_BUCKET_TYPE: Record<SectionTimeRange, BucketType> = {
  '1m': 'weekly',
  '3m': 'monthly',
  '6m': 'monthly',
  '1y': 'quarterly',
  all: 'yearly',
};
