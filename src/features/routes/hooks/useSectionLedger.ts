/**
 * A section's ledger: the changes it went through, the geometry versions
 * still stored, and the version it is pinned to, if any. Re-reads when the
 * section refreshes and after a revert or unpin.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEngine } from '@/shared/native/engine';
import type { RoutePoint } from '@/types';

/** A ledger row, with the engine's 64-bit ids as numbers. */
export interface SectionHistoryEvent {
  id: number;
  at: string;
  kind: string;
  details?: string;
  geometryVersion: number | null;
}

/** A stored geometry version, version as a number. */
export interface SectionGeometryVersion {
  version: number;
  createdAt: string;
  milestone: boolean;
  pinned: boolean;
}

export interface SectionLedger {
  history: SectionHistoryEvent[];
  versions: SectionGeometryVersion[];
  pinnedVersion: number | null;
  reload: () => void;
  versionPolyline: (version: number) => RoutePoint[];
  revert: (version: number) => boolean;
  unpin: () => boolean;
}

const EMPTY: Pick<SectionLedger, 'history' | 'versions' | 'pinnedVersion'> = {
  history: [],
  versions: [],
  pinnedVersion: null,
};

export function useSectionLedger(sectionId: string | undefined, refreshKey = 0): SectionLedger {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((k) => k + 1), []);

  const state = useMemo(() => {
    const engine = getEngine();
    if (!engine || !sectionId) return EMPTY;
    const history: SectionHistoryEvent[] = engine.getSectionHistory(sectionId).map((e) => ({
      id: Number(e.id),
      at: e.at,
      kind: e.kind,
      details: e.details ?? undefined,
      geometryVersion: e.geometryVersion == null ? null : Number(e.geometryVersion),
    }));
    const versions: SectionGeometryVersion[] = engine
      .getSectionGeometryVersions(sectionId)
      .map((v) => ({
        version: Number(v.version),
        createdAt: v.createdAt,
        milestone: v.milestone,
        pinned: v.pinned,
      }));
    return {
      history: history.reverse(),
      versions: versions.reverse(),
      pinnedVersion: engine.getPinnedSectionVersion(sectionId),
    };
  }, [sectionId, refreshKey, tick]);

  useEffect(() => {
    // A refresh from elsewhere on the screen re-reads on the next render.
  }, [refreshKey]);

  const versionPolyline = useCallback(
    (version: number): RoutePoint[] => {
      const engine = getEngine();
      if (!engine || !sectionId) return [];
      return engine.getSectionGeometryVersionPolyline(sectionId, version);
    },
    [sectionId]
  );

  const revert = useCallback(
    (version: number): boolean => {
      const engine = getEngine();
      if (!engine || !sectionId) return false;
      const ok = engine.revertSectionToVersion(sectionId, version);
      if (ok) reload();
      return ok;
    },
    [sectionId, reload]
  );

  const unpin = useCallback((): boolean => {
    const engine = getEngine();
    if (!engine || !sectionId) return false;
    const ok = engine.unpinSection(sectionId);
    if (ok) reload();
    return ok;
  }, [sectionId, reload]);

  return { ...state, reload, versionPolyline, revert, unpin };
}
