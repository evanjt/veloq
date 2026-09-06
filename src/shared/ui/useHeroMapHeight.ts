import { useWindowDimensions } from 'react-native';

/** Share of the window a detail hero map takes on the activity, route and section screens. */
export const HERO_MAP_FRACTION = 0.42;

/** Height of a detail hero map, following the window so a rotation resizes it. */
export function useHeroMapHeight(fraction = HERO_MAP_FRACTION): number {
  const { height } = useWindowDimensions();
  return Math.round(height * fraction);
}
