// Pieces the sections list and the section page both draw: the status badges of
// a section, its trend, and a toast region of their own so an edit's undo is
// offered on either page.

import { useTranslation } from 'react-i18next';

import type { Status } from '../sectionsList';
import { Badge } from '../ui';

const STATUS_KEYS = {
  custom: 'connectPage.sections.statusCustom',
  removed: 'connectPage.sections.statusRemoved',
  lift: 'connectPage.sections.statusLift',
  record: 'connectPage.sections.statusRecord',
} as const;

const BADGE_TONES = {
  custom: 'neutral',
  removed: 'warning',
  lift: 'neutral',
  record: 'record',
} as const;

/** What the engine reports of a section, as badges: a record is the one gold mark. */
export function StatusBadges({ status }: { status: readonly Status[] }) {
  const { t } = useTranslation();
  return (
    <span className="section-badges">
      {status.map((name) => (
        <Badge key={name} tone={BADGE_TONES[name]}>
          {t(STATUS_KEYS[name])}
        </Badge>
      ))}
    </span>
  );
}

/** Faster or slower, in words and an arrow; nothing for no trend. */
export function Trend({ value }: { value: number | null }) {
  const { t } = useTranslation();
  if (value === null || value === 0) return null;
  const faster = value > 0;
  return (
    <span data-trend={faster ? 'faster' : 'slower'}>
      <span aria-hidden="true">{faster ? '▲ ' : '▼ '}</span>
      {t(faster ? 'connectPage.sections.faster' : 'connectPage.sections.slower')}
    </span>
  );
}
