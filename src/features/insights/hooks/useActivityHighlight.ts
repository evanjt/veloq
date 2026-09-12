/**
 * The finding the enriched notification made about one activity, for a screen.
 *
 * The resolver reads the engine, which blocks the JS thread, so it runs once
 * per activity behind a query rather than on every render. The notification
 * builder calls the same resolver from the background task, so the sentence
 * the athlete was shown and the one the screen shows come from one place.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { formatHighlightSentence } from '@/features/insights/lib/activityNotificationBody';
import {
  type ActivityHighlight,
  type ActivityHighlightTier,
  type ActivityInfo,
  resolveActivityHighlight,
} from '@/features/insights/lib/activityHighlight';
import { useNotificationPreferences } from '@/features/settings';
import { queryKeys } from '@/shared/query/queryKeys';
import type { TFunc } from '@/features/insights/types';

const TITLE_KEYS: Record<ActivityHighlightTier, string> = {
  pr: 'notifications.activityPr.title',
  faster: 'notifications.activityFaster.title',
  recorded: 'notifications.activityRecorded.title',
};

export interface ActivityHighlightView {
  highlight: ActivityHighlight;
  tier: ActivityHighlightTier;
  /** The tier's own heading, the one the lock screen puts above the body. */
  title: string;
  /** The finding whole, with no place name given up to a character cap. */
  sentence: string | null;
}

export function useActivityHighlight(
  activityId: string | undefined,
  info: ActivityInfo | null
): ActivityHighlightView | null {
  const { t } = useTranslation();
  const announcePrs = useNotificationPreferences((s) => s.categories.sectionPr);

  const { data } = useQuery({
    queryKey: queryKeys.activities.highlight(activityId ?? 'none', announcePrs),
    queryFn: () => resolveActivityHighlight(activityId as string, [], announcePrs, info),
    // The engine is the source and a sync wakes it, so no clock decides this.
    staleTime: Infinity,
    enabled: !!activityId,
  });

  if (!data) return null;
  return {
    highlight: data.highlight,
    tier: data.tier,
    title: t(TITLE_KEYS[data.tier] as never),
    sentence: formatHighlightSentence(data.highlight, t as unknown as TFunc, info),
  };
}
