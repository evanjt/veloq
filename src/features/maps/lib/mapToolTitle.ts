import { formatDistance } from '@/shared/format/format';

/**
 * What a map tool's bar is headed with: the tool's name, then the length it has
 * drawn so far once there is one, as "New section · 7.6 km".
 */
export function mapToolTitle(label: string, meters: number | null, isMetric: boolean): string {
  if (meters === null) return label;
  return `${label} · ${formatDistance(meters, isMetric)}`;
}
