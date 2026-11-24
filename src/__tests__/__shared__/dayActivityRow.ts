import type { DayActivity } from '@/features/activity/light';
import type { FeedCard } from '@/types';

/** A feed card as the day picker lists it. */
export function dayActivityRow(card: FeedCard): DayActivity {
  return {
    id: card.id,
    name: card.name,
    type: card.sportType ?? 'Other',
    load: card.trainingLoad ?? 0,
    startDateLocal: card.startDateLocal,
    movingTime: card.movingTime ?? 0,
    distance: card.distance ?? 0,
  };
}
