/** Plain-language lines for the stored cutover diff and the settings it reset. */

import { formatPercent } from '@/shared/format';
import type { CutoverCounts, CutoverSettings, CutoverSettingsReset } from 'veloqrs';

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

const SETTING_LABELS: Record<keyof CutoverSettings, string> = {
  proximityThreshold: 'whatsNew.v040.settingsResetProximity',
  minSectionLength: 'whatsNew.v040.settingsResetMinLength',
  maxSectionLength: 'whatsNew.v040.settingsResetMaxLength',
  minActivities: 'whatsNew.v040.settingsResetMinActivities',
  divergenceThreshold: 'whatsNew.v040.settingsResetDivergence',
};

function settingValue(field: keyof CutoverSettings, value: number): string {
  if (field === 'minActivities') return String(value);
  if (field === 'divergenceThreshold') return formatPercent(Math.round(value * 100));
  return `${Math.round(value)} m`;
}

/** The stored diff in one line: the totals and the breakdown, or that nothing moved. */
export function describeCutoverCounts(counts: CutoverCounts, t: Translate): string {
  if (counts.changed + counts.new + counts.gone === 0) {
    return t('whatsNew.v040.diffUnchanged', { count: counts.unchanged });
  }
  // The detector kept none of the library. The totals alone read as a deletion, so say that it kept none.
  if (counts.proposed === 0 && counts.current > 0) {
    return t('whatsNew.v040.diffNoneKept', { count: counts.gone });
  }
  return t('common.sentencePair', {
    first: t('whatsNew.v040.diffTotals', { current: counts.current, proposed: counts.proposed }),
    second: t('whatsNew.v040.diffBreakdown', {
      new: counts.new,
      changed: counts.changed,
      gone: counts.gone,
    }),
  });
}

/** One clause per value the flip moved, so an untouched slider is not named. */
export function describeSettingsReset(reset: CutoverSettingsReset, t: Translate): string {
  const fields = Object.keys(SETTING_LABELS) as (keyof CutoverSettings)[];
  return fields
    .filter((field) => reset.previous[field] !== reset.current[field])
    .map((field) =>
      t('whatsNew.v040.settingsResetChange', {
        label: t(SETTING_LABELS[field]),
        from: settingValue(field, reset.previous[field]),
        to: settingValue(field, reset.current[field]),
      })
    )
    .join(', ');
}
