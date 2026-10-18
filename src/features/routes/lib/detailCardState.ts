/**
 * What a route or section card shares with the map it sits over, kept as the card's state in the
 * host's entry (`mapSheetHost`): the attempt the chart picked, the sport on show, the line the
 * delta plot colours and the direction the chart is on. The card writes it and the map reads it,
 * each field on its own, so a scrub renders the map and not the card.
 */
import { useMemo } from 'react';

import { patchHostTopCard, useHostTopCardField } from '@/shared/app/mapSheetHost';
import type { RoutePoint } from '@/types';
import type { SectionDeltaLine } from './deltaLayout';
import type { MapHighlight } from './mapHighlight';
import type { ChartDirection } from './scatterData';

const ATTEMPT_ID = 'attemptId';
const ATTEMPT_LAP_POINTS = 'attemptLapPoints';
/** The attempt's date as epoch milliseconds, so the same day compares equal. */
const ATTEMPT_DATE = 'attemptDateMs';
const SPORT = 'sport';
const DELTA_LINE = 'deltaLine';
const SHOWN_DIRECTION = 'shownDirection';

export interface DetailCardWriter {
  /** The chart's picked attempt, bound so it can be handed to a chart as a stable callback. */
  selectAttempt: (activityId: string | null, lapPoints?: RoutePoint[], date?: Date) => void;
  setSport: (sport: string | undefined) => void;
  setDeltaLine: (deltaLine: SectionDeltaLine | null) => void;
  setShownDirection: (direction: ChartDirection | null) => void;
}

/** The writes a card makes to the card on show in its host. */
export function detailCardWriter(hostKey: string): DetailCardWriter {
  return {
    selectAttempt: (activityId, lapPoints, date) =>
      patchHostTopCard(hostKey, {
        [ATTEMPT_ID]: activityId,
        [ATTEMPT_LAP_POINTS]: lapPoints,
        [ATTEMPT_DATE]: date?.getTime(),
      }),
    setSport: (sport) => patchHostTopCard(hostKey, { [SPORT]: sport }),
    setDeltaLine: (deltaLine) => patchHostTopCard(hostKey, { [DELTA_LINE]: deltaLine }),
    setShownDirection: (direction) => patchHostTopCard(hostKey, { [SHOWN_DIRECTION]: direction }),
  };
}

/** The attempt the card picked, for the map to draw over the rest. */
export function useCardAttempt(hostKey: string): MapHighlight {
  const activityId = useHostTopCardField<string | null>(hostKey, ATTEMPT_ID) ?? null;
  const lapPoints = useHostTopCardField<RoutePoint[]>(hostKey, ATTEMPT_LAP_POINTS);
  const dateMs = useHostTopCardField<number>(hostKey, ATTEMPT_DATE);
  return useMemo(
    () => ({
      activityId,
      lapPoints,
      date: dateMs === undefined ? undefined : new Date(dateMs),
    }),
    [activityId, lapPoints, dateMs]
  );
}

/** The sport the card shows. */
export function useCardSport(hostKey: string): string | undefined {
  return useHostTopCardField<string>(hostKey, SPORT);
}

/** The line the card's delta plot colours. */
export function useCardDeltaLine(hostKey: string): SectionDeltaLine | null {
  return useHostTopCardField<SectionDeltaLine | null>(hostKey, DELTA_LINE) ?? null;
}

/** The direction the card's chart is on. */
export function useCardShownDirection(hostKey: string): ChartDirection | null {
  return useHostTopCardField<ChartDirection | null>(hostKey, SHOWN_DIRECTION) ?? null;
}
