import { useHeroHeaderBottom } from '@/shared/ui';
import { layout, spacing } from '@/theme';

/** Most buttons the activity map's control column ever holds. */
export const MAX_MAP_CONTROLS = 6;

export interface ActivityMapControlFlags {
  /** Whether the column is drawn at all. */
  shown: boolean;
  /** Whether the gradient toggle is drawn. */
  hasGradientData: boolean;
  /** Whether the 3D toggle is drawn. */
  hasRoute: boolean;
  /** Whether the fullscreen button is drawn. */
  enableFullscreen: boolean;
}

/**
 * Buttons the activity map's control column draws: style, compass and location always, then one
 * for each optional button whose flag is set. The column and the hero text beside it both size
 * from this, so the reserve is never wider than the buttons.
 */
export function activityMapControlCount({
  shown,
  hasGradientData,
  hasRoute,
  enableFullscreen,
}: ActivityMapControlFlags): number {
  if (!shown) return 0;
  return 3 + Number(hasGradientData) + Number(hasRoute) + Number(enableFullscreen);
}

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
 * The place of a column of `count` buttons in a hero map `mapHeight` tall. The map runs under the
 * status bar and the transparent header is drawn over it, taking the touches there, so the column
 * starts at the header's measured bottom edge.
 */
export function useMapControlColumn(mapHeight: number, count: number): MapControlColumn {
  const top = useHeroHeaderBottom();
  return { top, ...mapControlColumnLayout(count, mapHeight, top) };
}
