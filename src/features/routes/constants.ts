export type SectionTimeRange = '1m' | '3m' | '6m' | '1y' | 'all';

export const SECTION_TIME_RANGES: { id: SectionTimeRange; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: 'all', label: 'All' },
];

export const RANGE_DAYS: Record<SectionTimeRange, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  all: 0,
};

// Patterns cycle first, then colors (6 patterns x 10 colors = 60 unique styles).
// Tight thatches keep dashed lines reading as continuous on the map.
export const SECTION_PATTERNS: (number[] | undefined)[] = [
  undefined,
  [4, 2],
  [2, 2],
  [6, 2, 2, 2],
  [3, 3],
  [8, 3],
];

// Hues chosen for contrast on both light and dark map styles. Avoids the teal
// primary and pure white/black for visibility on map tiles.
export const SECTION_COLORS = [
  '#00BCD4',
  '#4CAF50',
  '#FF9800',
  '#E91E63',
  '#3F51B5',
  '#009688',
  '#CDDC39',
  '#9C27B0',
  '#00E5FF',
  '#FF5722',
] as const;

// A separate warm/purple family so routes stay visually distinct from sections
// even when overlapping on the same map.
export const ROUTE_COLORS = [
  '#7C4DFF',
  '#AA00FF',
  '#D500F9',
  '#651FFF',
  '#6200EA',
  '#B388FF',
  '#EA80FC',
  '#CE93D8',
] as const;

export function getSectionStyle(index: number) {
  const patternIndex = index % SECTION_PATTERNS.length;
  const colorIndex = Math.floor(index / SECTION_PATTERNS.length) % SECTION_COLORS.length;
  return {
    pattern: SECTION_PATTERNS[patternIndex],
    color: SECTION_COLORS[colorIndex],
    patternIndex,
    colorIndex,
  };
}

export function getRouteStyle(index: number) {
  const colorIndex = index % ROUTE_COLORS.length;
  return {
    color: ROUTE_COLORS[colorIndex],
    colorIndex,
  };
}
