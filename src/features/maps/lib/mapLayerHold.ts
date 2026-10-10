/**
 * What the map keeps of a layer the engine stamps.
 *
 * The map read stamps its route-line and section layers with the database state they were
 * read in. The filters narrow the activities alone, so a filter change or a keystroke reads
 * the map again under the same stamp. The read passes the held stamp back, the engine leaves
 * that layer's lines out while nothing has committed, and the hold hands back the value it
 * built last time. The value keeps its identity, so nothing downstream rebuilds or
 * re-serialises it.
 */

export interface StampedLayer {
  /** The database state the layer was read in, absent when the engine could not vouch for one */
  stamp?: number | undefined;
}

export interface LayerHold<L extends StampedLayer, T> {
  /** The stamp to pass back to the next read, absent while nothing stamped is held */
  stamp(): number | undefined;
  /** The value for the layer a read returned, built only when its stamp is not the held one */
  take(layer: L | undefined): T;
}

/**
 * `build` turns a layer that carries its lines into the held value, and returns undefined
 * for one that carries none. A layer under the held stamp is never built again, whether the
 * engine left its lines out or sent them anyway.
 */
export function createLayerHold<L extends StampedLayer, T>(
  empty: T,
  build: (layer: L) => T | undefined
): LayerHold<L, T> {
  let stamp: number | undefined;
  let held = empty;
  const forget = () => {
    stamp = undefined;
    held = empty;
    return held;
  };
  return {
    stamp: () => stamp,
    take(layer) {
      if (!layer) return forget();
      if (stamp !== undefined && layer.stamp === stamp) return held;
      const built = build(layer);
      // Lines left out under a stamp this hold does not have: there is nothing to draw.
      if (built === undefined) return forget();
      held = built;
      stamp = layer.stamp;
      return held;
    },
  };
}
