/**
 * The finding the enriched notification made about one activity, for a screen.
 *
 * The ladder and both renderings are the engine's, and the notification the
 * athlete was shown came from the same call, so the sentence on the lock
 * screen and the sentence on the screen cannot drift apart.
 *
 * The read blocks the JS thread, so it runs once per activity behind a query
 * rather than on every render.
 */

import { useQuery } from '@tanstack/react-query';

import { useNotificationPreferences } from '@/features/settings';
import { queryKeys } from '@/shared/query/queryKeys';
import { engine } from 'veloqrs';

export type ActivityHighlightTier = 'pr' | 'faster' | 'recorded';

export interface ActivityHighlightView {
  tier: ActivityHighlightTier;
  /** The tier's own heading, the one the lock screen puts above the body. */
  title: string;
  /** The finding whole, with no place name given up to a character cap. */
  sentence: string | null;
}

export function useActivityHighlight(activityId: string | undefined): ActivityHighlightView | null {
  const announcePrs = useNotificationPreferences((s) => s.categories.sectionPr);

  const { data } = useQuery({
    queryKey: queryKeys.activities.highlight(activityId ?? 'none', announcePrs),
    // No activity name: the screen shows the finding whole and the name only
    // ever went into the capped body, beside it on the lock screen.
    queryFn: () => engine.activityNotification(activityId as string, '', announcePrs),
    // The engine is the source and a sync wakes it, so no clock decides this.
    staleTime: Infinity,
    enabled: !!activityId,
  });

  if (!data) return null;
  return {
    tier: data.tier as ActivityHighlightTier,
    title: data.title,
    sentence: data.sentence ?? null,
  };
}
