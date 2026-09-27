/**
 * The names a user typed onto sections, as durable corridor intents. A name
 * outlives the section it was given to: the engine keys it to ground, so it
 * goes dormant rather than disappearing when the detector re-cuts.
 */

import { useCallback, useMemo } from 'react';
import { decodeCoords, type LatLng } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

export interface NamedCorridor {
  intentId: string;
  name: string;
  /** The ground the name is keyed to, decoded for a static preview. */
  footprint: LatLng[];
  sportType?: string | undefined;
  createdAt: string;
  /** Visible section carrying the name, absent while dormant. */
  sectionId?: string | undefined;
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
  const readCorridors = useEngineRead(['sections']);

  const corridors = useMemo(() => {
    // Engine order is the persisted order. Sorting here would fight it.
    return (
      readCorridors((engine) =>
        engine.getNamedCorridors().map((c) => ({
          intentId: c.intentId,
          name: c.name,
          footprint: decodeCoords(c.encodedFootprint),
          sportType: c.sportType ?? undefined,
          createdAt: c.createdAt,
          sectionId: c.sectionId ?? undefined,
          coverage: c.coverage,
          primary: c.primary,
          dormant: c.sectionId == null,
        }))
      ) ?? []
    );
  }, [readCorridors]);

  // The removal announces `sections` from the client
  // (`delegates/sections/mutations.ts`), which is what brings the read back.
  const remove = useCallback((intentId: string): boolean => {
    const engine = getEngine();
    if (!engine) return false;
    return engine.removeNamedCorridor(intentId);
  }, []);

  return { corridors, remove };
}
