/**
 * The names a user typed onto sections, as durable corridor intents. A name
 * outlives the section it was given to: the engine keys it to ground, so it
 * goes dormant rather than disappearing when the detector re-cuts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeCoords, type LatLng } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';

export interface NamedCorridor {
  intentId: string;
  name: string;
  /** The ground the name is keyed to, decoded for a static preview. */
  footprint: LatLng[];
  sportType?: string;
  createdAt: string;
  /** Visible section carrying the name, absent while dormant. */
  sectionId?: string;
  coverage: number;
  /** Whether this intent is the one displayed on its section. */
  primary: boolean;
  /** No visible section covers this name's ground. */
  dormant: boolean;
}

export interface UseNamedCorridorsResult {
  corridors: NamedCorridor[];
  remove: (intentId: string) => boolean;
}

export function useNamedCorridors(): UseNamedCorridorsResult {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((k) => k + 1), []);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;
    return engine.subscribe('sections', reload);
  }, [reload]);

  const corridors = useMemo(() => {
    const engine = getEngine();
    if (!engine) return [];
    // Engine order is the persisted order. Sorting here would fight it.
    return engine.getNamedCorridors().map((c) => ({
      intentId: c.intentId,
      name: c.name,
      footprint: decodeCoords(c.encodedFootprint),
      sportType: c.sportType ?? undefined,
      createdAt: c.createdAt,
      sectionId: c.sectionId ?? undefined,
      coverage: c.coverage,
      primary: c.primary,
      dormant: c.sectionId == null,
    }));
  }, [tick]);

  const remove = useCallback(
    (intentId: string): boolean => {
      const engine = getEngine();
      if (!engine) return false;
      const ok = engine.removeNamedCorridor(intentId);
      if (ok) reload();
      return ok;
    },
    [reload]
  );

  return { corridors, remove };
}
