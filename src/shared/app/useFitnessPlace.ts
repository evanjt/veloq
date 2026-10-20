/**
 * The page of the fitness tab in front, and the links that move it.
 *
 * A link that names a page while the screen is mounted moves to it, taken
 * while rendering so no frame shows the page it left. The param is cleared
 * once applied, so a later link to the same page moves the screen again
 * after the athlete has swiped elsewhere.
 */

import { useEffect, useState } from 'react';

import { fitnessPlaceOf, type FitnessEntry, type FitnessPlace } from './fitnessEntry';
import { useSetOwnParams } from './useSetOwnParams';

export function useFitnessPlace(entry: FitnessEntry) {
  const entryChart = entry.chart ?? null;
  const entryPlace = entry.place ?? null;
  const [place, setPlace] = useState<FitnessPlace>(() => fitnessPlaceOf(entry));
  const setParams = useSetOwnParams();

  const [placeLink, setPlaceLink] = useState(entryPlace);
  if (entryPlace !== placeLink) {
    setPlaceLink(entryPlace);
    if (entryPlace) setPlace(fitnessPlaceOf({ chart: entryChart, place: entryPlace }));
  }
  useEffect(() => {
    if (entryPlace) setParams({ tab: undefined });
  }, [entryPlace, setParams]);

  return [place, setPlace] as const;
}
