/**
 * A section's ledger: the changes it went through, the geometry versions
 * still stored, and the version it is pinned to, if any. Re-reads when the
 * section refreshes and after a revert or unpin.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getEngine } from '@/shared/native/engine';
import { engineErrorKey, engineErrorTag, type EngineFailureKey } from '@/shared/native/engineError';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { RoutePoint } from '@/types';
import { parseEventDetails, type SectionLink } from '@/features/routes/lib/sectionLedger';
import { announceDepartedRides } from '@/features/routes/lib/departedRides';

/** A ledger row, with the engine's 64-bit ids as numbers. */
export interface SectionHistoryEvent {
  id: number;
  at: string;
  kind: string;
  details?: string | undefined;
  geometryVersion: number | null;
  splitFrom?: SectionLink | null;
  splitInto?: SectionLink[];
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
  /** Why the ledger could not be read, or null when it was. An empty ledger is not a failed one. */
  failureKey: EngineFailureKey | null;
  reload: () => void;
  versionPolyline: (version: number) => RoutePoint[];
  revert: (version: number) => boolean;
  unpin: () => boolean;
}

const EMPTY: Pick<SectionLedger, 'history' | 'versions' | 'pinnedVersion' | 'failureKey'> = {
  history: [],
  versions: [],
  pinnedVersion: null,
  failureKey: null,
};

/** The ledger as a screen bundle carries it, with the engine's 64-bit ids raw. */
export interface BundledLedger {
  history: readonly {
    id: bigint | number;
    at: string;
    kind: string;
    details?: string | null;
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

/**
 * `bundled` lets a caller that already read the ledger as part of a screen
 * bundle skip this hook's three FFI calls. A revert or an unpin bumps `tick`
 * and the bundle behind it has not been re-read, so the hook goes back to the
 * engine from then on.
 */
/** The three reads the bundle replaces, in the shape the bundle carries. */
function readLedger(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  sectionId: string
): BundledLedger {
  return {
    history: engine.getSectionHistory(sectionId),
    geometryVersions: engine.getSectionGeometryVersions(sectionId),
    pinnedVersion: engine.getPinnedSectionVersion(sectionId),
  };
}

export function useSectionLedger(
  sectionId: string | undefined,
  refreshKey = 0,
  bundled?: BundledLedger
): SectionLedger {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((k) => k + 1), []);
  const readSection = useEngineRead([], [refreshKey]);

  const state = useMemo(() => {
    let source: BundledLedger | undefined;
    try {
      source =
        bundled !== undefined && tick === 0
          ? bundled
          : sectionId
            ? readSection((engine) => readLedger(engine, sectionId))
            : undefined;
    } catch (error) {
      console.warn('[SectionLedger] Could not read the ledger:', engineErrorTag(error) ?? error);
      return { ...EMPTY, failureKey: engineErrorKey(error, 'engine.failure.database') };
    }
    if (!source) return EMPTY;

    const history: SectionHistoryEvent[] = source.history.map((e) => {
      const details = e.details ?? undefined;
      const links = parseEventDetails(details);
      return {
        id: Number(e.id),
        at: e.at,
        kind: e.kind,
        details,
        geometryVersion: e.geometryVersion == null ? null : Number(e.geometryVersion),
        splitFrom: links.splitFromLink ?? null,
        splitInto: links.splitIntoLinks,
      };
    });
    const versions: SectionGeometryVersion[] = source.geometryVersions.map((v) => ({
      version: Number(v.version),
      createdAt: v.createdAt,
      milestone: v.milestone,
      pinned: v.pinned,
    }));
    return {
      history: history.reverse(),
      versions: versions.reverse(),
      pinnedVersion: source.pinnedVersion == null ? null : Number(source.pinnedVersion),
      failureKey: null,
    };
  }, [sectionId, readSection, tick, bundled]);

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

  const revert = useCallback(
    (version: number): boolean => {
      const engine = getEngine();
      if (!engine || !sectionId) return false;
      const departed = engine.revertSectionToVersion(sectionId, version);
      if (!departed) return false;
      reload();
      announceDepartedRides(departed, t);
      return true;
    },
    [sectionId, reload, t]
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
