/**
 * A section's ledger: the changes it went through, the geometry versions
 * still stored, and the version it is pinned to, if any. The section screen
 * read carries the ledger, so this hook reads none of it: a revert or an
 * unpin writes, and the caller re-reads the screen read that holds the result.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getEngine } from '@/shared/native/engine';
import { engineErrorTag } from '@/shared/native/engineError';
import type { FfiDepartedRide, FfiSectionEventDetails } from 'veloqrs';
import type { RoutePoint } from '@/types';
import { announceDepartedRides } from '@/features/routes/lib/departedRides';

/** A ledger row, with the engine's 64-bit ids as numbers. */
export interface SectionHistoryEvent {
  id: number;
  at: string;
  kind: string;
  details?: FfiSectionEventDetails | undefined;
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
  versionPolyline: (version: number) => RoutePoint[];
  /** Resolves true once the version is the section's line, false when it was not written. */
  revert: (version: number) => Promise<boolean>;
  /** True while a revert runs; a second revert is refused until it ends. */
  isReverting: boolean;
  unpin: () => boolean;
}

const EMPTY: Pick<SectionLedger, 'history' | 'versions' | 'pinnedVersion'> = {
  history: [],
  versions: [],
  pinnedVersion: null,
};

/** The ledger as a screen bundle carries it, with the engine's 64-bit ids raw. */
export interface BundledLedger {
  history: readonly {
    id: bigint | number;
    at: string;
    kind: string;
    details?: FfiSectionEventDetails | null;
    geometryVersion?: bigint | number | null;
  }[];
  geometryVersions: readonly {
    version: bigint | number;
    createdAt: string;
    milestone: boolean;
    pinned: boolean;
  }[];
  pinnedVersion?: bigint | number | null | undefined;
}

export function useSectionLedger(
  sectionId: string | undefined,
  bundled?: BundledLedger
): SectionLedger {
  const { t } = useTranslation();
  const [isReverting, setIsReverting] = useState(false);
  const revertInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state = useMemo(() => {
    if (!bundled) return EMPTY;

    const history: SectionHistoryEvent[] = bundled.history.map((e) => ({
      id: Number(e.id),
      at: e.at,
      kind: e.kind,
      details: e.details ?? undefined,
      geometryVersion: e.geometryVersion == null ? null : Number(e.geometryVersion),
    }));
    const versions: SectionGeometryVersion[] = bundled.geometryVersions.map((v) => ({
      version: Number(v.version),
      createdAt: v.createdAt,
      milestone: v.milestone,
      pinned: v.pinned,
    }));
    return {
      history: history.reverse(),
      versions: versions.reverse(),
      pinnedVersion: bundled.pinnedVersion == null ? null : Number(bundled.pinnedVersion),
    };
  }, [bundled]);

  const versionPolyline = useCallback(
    (version: number): RoutePoint[] => {
      const engine = getEngine();
      if (!engine || !sectionId) return [];
      // Read during render to draw the version shown, so a failure draws no
      // line rather than taking the screen down with it.
      try {
        return engine.getSectionGeometryVersionPolyline(sectionId, version);
      } catch (error) {
        // empty-on-error: one version's outline drawn on demand; the ledger rows beside it
        // carry their own failure key, and a missing outline is not read as an empty section.
        console.warn(
          '[SectionLedger] Could not read a stored version:',
          engineErrorTag(error) ?? error
        );
        return [];
      }
    },
    [sectionId]
  );

  // A revert re-matches every ride against the stored line, so it runs as an
  // engine edit off the JS thread. One runs at a time, and a tap while it runs
  // is refused rather than queued.
  const revert = useCallback(
    async (version: number): Promise<boolean> => {
      const engine = getEngine();
      if (!engine || !sectionId || revertInFlight.current) return false;
      revertInFlight.current = true;
      setIsReverting(true);

      let departed: FfiDepartedRide[] | null = null;
      try {
        departed = await engine.runSectionBoundsEdit({ kind: 'revert', sectionId, version });
      } catch {
        departed = null;
      } finally {
        revertInFlight.current = false;
        if (mounted.current) setIsReverting(false);
      }

      if (!departed) {
        Alert.alert(t('common.error'), t('sectionHistory.revertFailed'));
        return false;
      }
      announceDepartedRides(departed, t);
      return true;
    },
    [sectionId, t]
  );

  const unpin = useCallback((): boolean => {
    const engine = getEngine();
    if (!engine || !sectionId) return false;
    return engine.unpinSection(sectionId);
  }, [sectionId]);

  return { ...state, versionPolyline, revert, isReverting, unpin };
}
