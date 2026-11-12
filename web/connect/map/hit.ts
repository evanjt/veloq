// Which feature a pointer means. Pure, so a test needs no renderer.

import { SURFACE_HIT_TEST_RADIUS_PX } from '@/features/maps/lib/surfaceHitRadius';

/** The box around a pointer that is searched for a line: the radius the phone searches with. */
export function hitBox(
  x: number,
  y: number,
  radius: number = SURFACE_HIT_TEST_RADIUS_PX
): [[number, number], [number, number]] {
  return [
    [x - radius, y - radius],
    [x + radius, y + radius],
  ];
}

/** A feature as the pane reports it. */
export interface PickedFeature {
  layerId: string;
  /** The feature's id, or its `id` property, else null. */
  id: string | null;
  properties: Record<string, unknown>;
}

interface Hit {
  id?: string | number | undefined;
  properties: Record<string, unknown>;
  layer: { id: string };
}

const idOf = (hit: Hit): string | null => {
  const id = hit.id ?? hit.properties.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
};

/**
 * The feature a pointer means among those under it. The layers come most
 * specific first, and the first layer with a hit wins, as the phone reads a
 * tap, so a line drawn over a marker cannot take a tap off it.
 */
export function pickFeature(hits: readonly Hit[], layers: readonly string[]): PickedFeature | null {
  for (const layer of layers) {
    const won = hits.find((hit) => hit.layer.id === layer);
    if (won) return { layerId: layer, id: idOf(won), properties: won.properties };
  }
  return null;
}
