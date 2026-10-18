/**
 * The cards a route or section screen's sheet can hold, by kind, and the stack that draws them.
 *
 * Each kind's card takes the subject's id and what it was opened with. A kind with no card here
 * opens as its own screen, which the activity does until its card joins.
 */
import React from 'react';

import {
  MapSheetCards,
  type MapSheetCardProps,
  type MapSheetCardRegistry,
} from '@/shared/app/MapSheetCards';
import type { MapSheetCardParams } from '@/shared/app/mapSheetHost';
import { RouteDetailCard } from './RouteDetailCard';
import { SectionDetailCard } from './SectionDetailCard';
import { SectionHistoryCard } from './SectionHistoryCard';
import { SectionLapsCard } from './SectionLapsCard';

function RouteCard({ id, params }: MapSheetCardProps) {
  return <RouteDetailCard id={id} activityId={params.activityId} />;
}

function SectionCard({ id, params }: MapSheetCardProps) {
  return <SectionDetailCard id={id} activityId={params.activityId} />;
}

function SectionHistory({ id }: MapSheetCardProps) {
  return <SectionHistoryCard id={id} />;
}

function SectionLaps({ id, params }: MapSheetCardProps) {
  return <SectionLapsCard id={id} range={params.range} sport={params.sport} />;
}

export const DETAIL_CARDS: MapSheetCardRegistry = {
  route: RouteCard,
  section: SectionCard,
  'section-history': SectionHistory,
  'section-laps': SectionLaps,
};

/** The host's sheet of cards. `rootParams` are what the host's route was opened with. */
export function DetailCardStack({ rootParams }: { rootParams: MapSheetCardParams }) {
  return <MapSheetCards registry={DETAIL_CARDS} rootParams={rootParams} />;
}
