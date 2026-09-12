import { getIntlLocale } from '@/shared/format/format';

/**
 * The date under a sparkline crosshair, `daysAgo` back from today.
 *
 * Both summary-card sparklines draw the same window and share this, because
 * they sat side by side spelling the month differently: one passed the app's
 * locale and the other passed none, which is the device's.
 */
export function scrubDateLabel(daysAgo: number, today: Date = new Date()): string {
  const date = new Date(today);
  date.setDate(date.getDate() - daysAgo);

  return date.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' });
}
