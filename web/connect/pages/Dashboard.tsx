// The fitness and insights pages. Each draws its own pane: fitness is the
// tabbed page over one range and sport, insights is the record tables.

import { useState } from 'react';

import { fitnessChoices, fitnessQuery } from '../dashboard';
import { BEST_EFFORT_PERIODS } from '../fitness';
import { useFitness } from '../fitnessReads';
import { useInsights, usePlannedEvents } from '../insightsReads';
import { go, queryValue, withQuery } from '../router';
import { FitnessPane } from './FitnessPane';
import { InsightsPane, parseOpened } from './InsightsPane';
import type { PageProps } from './types';

export function FitnessPage({ route }: PageProps) {
  const choices = fitnessChoices(route);
  const [bestEffortDays, setBestEffortDays] = useState<number>(BEST_EFFORT_PERIODS[0]);
  const panels = useFitness(choices.range, choices.sport, bestEffortDays);
  return (
    <FitnessPane
      panels={panels}
      bestEffortDays={bestEffortDays}
      route={route}
      choices={choices}
      onChoose={(next) => go(fitnessQuery(route, next))}
      onBestPeriod={setBestEffortDays}
    />
  );
}

export function InsightsPage({ route }: PageProps) {
  const insights = useInsights();
  const { events, today } = usePlannedEvents();
  return (
    <InsightsPane
      parts={insights.parts}
      error={insights.error}
      loading={insights.loading}
      onRetry={insights.retry}
      opened={parseOpened(queryValue(route, 'open'))}
      route={route}
      onRoute={go}
      onOpen={(key) => go(withQuery(route, { open: key }))}
      openCard={queryValue(route, 'card')}
      onOpenCard={(id) => go(withQuery(route, { card: id }))}
      planned={events}
      today={today}
    />
  );
}
