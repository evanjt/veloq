// The fitness page's panels, each a read of the query layer under its own
// arguments. A panel whose arguments do not change with the range or the sport
// keeps its answer when they do, and a panel the phone cannot answer says so in
// its own place.

import { useMemo } from 'react';

import { bestEffortsAsk, rangeAsks, screenAsk, settledNow } from './fitness';
import type { ReadState } from './query';
import { useReads } from './useRead';

/** The panels by slot: `wellness`, `loads`, `zones`, `powerCurve`, `paceCurve`, `screen`, `bestEfforts`. */
export type Panels = Readonly<Record<string, ReadState<unknown>>>;

export function useFitness(range: number, sport: string, bestEffortDays: number): Panels {
  const now = useMemo(() => settledNow(), []);
  const asks = useMemo(
    () => [...rangeAsks(range, now, sport), screenAsk(now), bestEffortsAsk(bestEffortDays)],
    [range, sport, bestEffortDays, now]
  );
  const states = useReads(asks.map((ask) => ({ method: ask.method, args: ask.params })));
  return useMemo(
    () => Object.fromEntries(asks.map((ask, at) => [ask.slot, states[at] as ReadState<unknown>])),
    [asks, states]
  );
}
