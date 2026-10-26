/**
 * The old-versus-new sections read as the GeoJSON the detection preview draws, and as the
 * words a tap on one line says about the lines on its ground.
 *
 * The engine decides which retired and current sections share ground and hands the pairs over.
 * Nothing here measures an overlap or finds a pair: it carries the engine's pairs onto the
 * features and onto the selection.
 */
import { RetiredPairLink } from 'veloqrs';
import type { RetiredMapData, RetiredMapPair } from 'veloqrs';
import { decodeCoordsFlat } from 'veloqrs/src/coords';
import type { LngLat, LngLatBounds } from '@/features/maps';
import { previewAreaBounds, type PreviewAreaCentre } from './previewMapCamera';

export type RetiredLineRole = 'idle' | 'selected' | 'pair' | 'other';

/** How the engine tied a retired section to a current one. */
export type RetiredPairKind = 'ledger' | 'supersedes' | 'ground';

export interface RetiredLineOptions {
  /** Turns the stored bytes into points. Absent, the engine's own polyline decoder. */
  decode?: (polyline: ArrayBuffer) => LngLat[];
  /** The riding area the map is on. A line with no point inside it is not drawn. */
  area?: LngLatBounds | null;
  /** The tapped line, retired or current. */
  selectedId?: string | null;
}

/** One retired section as the list shows it, drawn or not. */
export interface RetiredLineRow {
  id: string;
  hasLine: boolean;
}

export interface RetiredLines {
  /** Retired sections that have a line. */
  retired: GeoJSON.FeatureCollection;
  /** Every catalogue row that has a line, hidden ones flagged. */
  current: GeoJSON.FeatureCollection;
  /** The selected line and the lines paired with it. */
  selection: GeoJSON.FeatureCollection;
  /** Every retired section, whether or not it has a line to draw. */
  rows: RetiredLineRow[];
}

export interface RetiredSelectionPair {
  id: string;
  name: string | null;
  kind: 'retired' | 'current';
  link: RetiredPairKind;
  /** The larger coverage fraction of a ground pair, else null. */
  overlap: number | null;
  /** The paired current row is hidden behind another section. */
  hidden: boolean;
}

export interface RetiredSelection {
  id: string;
  kind: 'retired' | 'current';
  name: string | null;
  /** The ledger version a retired section can be restored from; null when the engine named none. */
  restorableVersion?: number | null;
  pairs: RetiredSelectionPair[];
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function decodeLngLat(polyline: ArrayBuffer): LngLat[] {
  const out: LngLat[] = [];
  try {
    const flat = decodeCoordsFlat(polyline);
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const lat = flat[at];
      const lng = flat[at + 1];
      // A non-finite pair in a LineString crashes the iOS renderer.
      if (lat === undefined || lng === undefined) continue;
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lng, lat]);
    }
  } catch {
    return [];
  }
  return out;
}

function linkKind(link: RetiredMapPair['link']): RetiredPairKind {
  if (link === RetiredPairLink.Ledger) return 'ledger';
  if (link === RetiredPairLink.Supersedes) return 'supersedes';
  return 'ground';
}

function touches(area: LngLatBounds | null | undefined, points: LngLat[]): boolean {
  if (!area) return true;
  return points.some(
    ([lng, lat]) => lng >= area.sw[0] && lng <= area.ne[0] && lat >= area.sw[1] && lat <= area.ne[1]
  );
}

/** Pair ids by section id, from either side of each pair, in the engine's order. */
function pairIndex(pairs: RetiredMapPair[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (key: string, other: string) => {
    const held = index.get(key);
    if (held) held.push(other);
    else index.set(key, [other]);
  };
  for (const pair of pairs) {
    add(pair.retiredId, pair.currentId);
    add(pair.currentId, pair.retiredId);
  }
  return index;
}

export function buildRetiredLines(
  data: RetiredMapData,
  { decode = decodeLngLat, area, selectedId = null }: RetiredLineOptions = {}
): RetiredLines {
  const pairsOf = pairIndex(data.pairs);
  const selectedPairs = selectedId ? new Set(pairsOf.get(selectedId) ?? []) : new Set<string>();

  const roleOf = (id: string): RetiredLineRole => {
    if (selectedId === null) return 'idle';
    if (id === selectedId) return 'selected';
    return selectedPairs.has(id) ? 'pair' : 'other';
  };

  const feature = (
    id: string,
    points: LngLat[],
    extra: Record<string, unknown>
  ): GeoJSON.Feature => ({
    type: 'Feature',
    properties: {
      id,
      role: roleOf(id),
      pairIds: (pairsOf.get(id) ?? []).join(','),
      ...extra,
    },
    geometry: { type: 'LineString', coordinates: points },
  });

  const retired: GeoJSON.Feature[] = [];
  const current: GeoJSON.Feature[] = [];
  const rows: RetiredLineRow[] = [];

  for (const r of data.retired) {
    const id = r.section.sectionId;
    // One point is not a line, and the renderer crashes on it.
    const points = r.encodedPolyline ? decode(r.encodedPolyline) : [];
    const drawable = points.length >= 2;
    rows.push({ id, hasLine: drawable });
    if (drawable && touches(area, points)) retired.push(feature(id, points, { layer: 'retired' }));
  }

  for (const c of data.current) {
    const points = decode(c.encodedPolyline);
    if (points.length < 2 || !touches(area, points)) continue;
    current.push(feature(c.id, points, { layer: 'current', hidden: c.hidden }));
  }

  // The highlight draws over both layers, so it takes its own copy of the lines it marks.
  const selection = selectedId
    ? [...retired, ...current].filter((f) => {
        const role = f.properties?.role;
        return role === 'selected' || role === 'pair';
      })
    : [];

  return {
    retired: { type: 'FeatureCollection', features: retired },
    current: { type: 'FeatureCollection', features: current },
    selection: selection.length ? { type: 'FeatureCollection', features: selection } : EMPTY,
    rows,
  };
}

/**
 * What a tap on a line says: the section's name and each section the engine paired with it,
 * from whichever side was tapped. Null for an id the read does not hold.
 */
export function describeRetiredSelection(
  data: RetiredMapData,
  id: string
): RetiredSelection | null {
  const retiredNames = new Map(data.retired.map((r) => [r.section.sectionId, r.section.name]));
  const restorable = data.retired.find((r) => r.section.sectionId === id)?.section
    .restorableVersion;
  const currentRows = new Map(data.current.map((c) => [c.id, c]));

  const pairs: RetiredSelectionPair[] = [];
  const tappedRetired = retiredNames.has(id);
  const tappedCurrent = currentRows.has(id);
  if (!tappedRetired && !tappedCurrent) return null;

  for (const pair of data.pairs) {
    const link = linkKind(pair.link);
    const overlap = link === 'ground' ? (pair.overlap ?? null) : null;
    if (tappedRetired && pair.retiredId === id) {
      const row = currentRows.get(pair.currentId);
      pairs.push({
        id: pair.currentId,
        name: row?.name ?? null,
        kind: 'current',
        link,
        overlap,
        hidden: row?.hidden ?? false,
      });
    } else if (tappedCurrent && pair.currentId === id) {
      pairs.push({
        id: pair.retiredId,
        name: retiredNames.get(pair.retiredId) ?? null,
        kind: 'retired',
        link,
        overlap,
        hidden: false,
      });
    }
  }

  return {
    id,
    kind: tappedRetired ? 'retired' : 'current',
    name: (tappedRetired ? retiredNames.get(id) : currentRows.get(id)?.name) ?? null,
    restorableVersion: restorable != null ? Number(restorable) : null,
    pairs,
  };
}

/**
 * The riding area the retired layer opens on: the one holding the most retired lines, so the
 * first frame shows something. The first area when none hold any, null when there are no areas.
 */
export function busiestCentre<C extends PreviewAreaCentre>(
  centres: readonly C[],
  data: RetiredMapData,
  decode: (polyline: ArrayBuffer) => LngLat[] = decodeLngLat
): C | null {
  const lines = data.retired.flatMap((r) => {
    const points = r.encodedPolyline ? decode(r.encodedPolyline) : [];
    return points.length >= 2 ? [points] : [];
  });
  let best: C | null = centres[0] ?? null;
  let bestCount = 0;
  for (const centre of centres) {
    const area = previewAreaBounds(centre);
    if (!area) continue;
    const count = lines.filter((points) => touches(area, points)).length;
    if (count > bestCount) {
      best = centre;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The riding area holding one named retired line, so a row opened from the list lands where its
 * section is. The busiest area when the id has no line or no area holds it.
 */
export function centreHoldingRetired<C extends PreviewAreaCentre>(
  centres: readonly C[],
  data: RetiredMapData,
  id: string,
  decode: (polyline: ArrayBuffer) => LngLat[] = decodeLngLat
): C | null {
  const entry = data.retired.find((r) => r.section.sectionId === id);
  const points = entry?.encodedPolyline ? decode(entry.encodedPolyline) : [];
  if (points.length >= 2) {
    for (const centre of centres) {
      if (touches(previewAreaBounds(centre), points)) return centre;
    }
  }
  return busiestCentre(centres, data, decode);
}
