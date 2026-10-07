import { periodOptions, periodRangeDays, type Period } from '@/shared/app/period';

export type SectionTimeRange = Extract<Period, '1m' | '3m' | '6m' | '1y' | 'all'>;

export const SECTION_TIME_RANGES = periodOptions<SectionTimeRange>(['1m', '3m', '6m', '1y', 'all']);

/** Days the engine limits a section read to, zero for no limit. */
export const RANGE_DAYS: Record<SectionTimeRange, number> = Object.fromEntries(
  SECTION_TIME_RANGES.map((o) => [o.id, periodRangeDays(o.id)])
) as Record<SectionTimeRange, number>;
