import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HERO_HEADER_HEIGHT } from '@/shared/ui';
import { layout, spacing } from '@/theme';

/** Most buttons the activity map's control column ever holds. */
export const MAX_MAP_CONTROLS = 6;

export interface MapControlColumnLayout {
  /** Columns the buttons wrap into. */
  columns: number;
  /** Height the column is bounded by, so no button leaves the map. */
  maxHeight: number;
  /** Width from the map's right edge that the column occupies; text beside it stays clear of this. */
  footprint: number;
}

/**
 * Lays `count` round tap-target buttons down the right edge of a map `mapHeight` tall, starting `top` below its top edge. When they do
 * not fit one column they wrap into further columns to its left.
 */
export function mapControlColumnLayout(
  count: number,
  mapHeight: number,
  top: number
): MapControlColumnLayout {
  if (count <= 0) return { columns: 0, maxHeight: 0, footprint: 0 };
  const step = layout.minTapTarget + spacing.sm;
  const maxHeight = Math.max(step, mapHeight - top - layout.cardMargin);
  const perColumn = Math.max(1, Math.floor((maxHeight + spacing.sm) / step));
  const columns = Math.ceil(count / perColumn);
  return { columns, maxHeight, footprint: layout.cardMargin + columns * step };
}

export interface MapControlColumn extends MapControlColumnLayout {
  /** Distance from the top of the map to the column. */
  top: number;
}

/**
 * The column's place in a hero map `mapHeight` tall. The map runs under the status bar and the
 * transparent header is drawn over it, taking the touches there, so the column starts below the
 * inset and the header row.
 */
export function useMapControlColumn(mapHeight: number): MapControlColumn {
  const top = useSafeAreaInsets().top + HERO_HEADER_HEIGHT;
  return { top, ...mapControlColumnLayout(MAX_MAP_CONTROLS, mapHeight, top) };
}
