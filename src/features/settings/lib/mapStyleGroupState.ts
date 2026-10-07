import type { MapStyleType } from '@/features/maps';
import type { ActivityType, Terrain3DMode } from '@/types';

export type GroupColumnState<T extends string> = { mixed: true } | { mixed: false; value: T };

function unanimous<T extends string>(values: T[]): GroupColumnState<T> {
  const first = values[0];
  return values.every((v) => v === first) ? { mixed: false, value: first } : { mixed: true };
}

export function groupStyleState(
  types: readonly ActivityType[],
  byType: Partial<Record<ActivityType, MapStyleType>>
): GroupColumnState<MapStyleType | 'default'> {
  return unanimous(types.map((tp) => byType[tp] ?? 'default'));
}

export function groupTerrainState(
  types: readonly ActivityType[],
  byType: Partial<Record<ActivityType, Terrain3DMode>>,
  globalMode: Terrain3DMode
): GroupColumnState<Terrain3DMode> {
  return unanimous(types.map((tp) => byType[tp] ?? globalMode));
}
