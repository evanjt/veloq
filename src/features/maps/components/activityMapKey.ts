/**
 * The rows of the activity map's key, read from the same input that builds its
 * layers, so every colour the map draws is named beside it.
 *
 * Some colours need no row of their own. The activity's own line is the
 * subject of the page. The casing, the badge ink and the location ring outline
 * or letter a mark that is already named. The endpoint discs carry their own
 * glyphs, the location dot is the athlete's position, the scrub point follows
 * the chart's cursor, and section creation draws under its own instructions.
 */
import type { MapPalette } from '@/theme';
import type { DivergingKind } from '../lib/divergingStep';

export interface ActivityKeyInput {
  palette: MapPalette;
  overlayHasData: boolean;
  gradientActive: boolean;
  hasSectionOverlays: boolean;
  /** A personal record is among the section portions or markers drawn. */
  hasRecord: boolean;
  highlightedSectionId?: string | null | undefined;
}

export type ActivityKeyRow =
  | { kind: 'diverging'; id: 'grade'; diverging: DivergingKind; colours: readonly string[] }
  | {
      kind: 'line';
      id: 'matched-route' | 'activity' | 'selected-section' | 'record';
      colour: string;
      labelKey:
        | 'activityDetail.lineKeyRoute'
        | 'activityDetail.lineKeyActivity'
        | 'maps.keySelectedSection'
        | 'sections.legendRecord';
    };

/** Layers whose marks name themselves, by the id prefix the layer builder gives them. */
export const UNKEYED_LAYER_PREFIXES = [
  'endpoint',
  'highlight-',
  'user-location',
  'section-creation-',
  'section-marker-label',
] as const;

/** Colours that outline or letter a mark rather than meaning anything of their own. */
export function unkeyedColours(palette: MapPalette): string[] {
  return [
    palette.route,
    palette.casing,
    palette.badgeInk,
    palette.locationRing,
    palette.layer.boundaryCasing,
  ];
}

export function activityKeyRows(input: ActivityKeyInput): ActivityKeyRow[] {
  const { palette, overlayHasData, gradientActive, hasSectionOverlays, hasRecord } = input;
  const highlighted = !!input.highlightedSectionId;
  const rows: ActivityKeyRow[] = [];
  if (gradientActive) {
    rows.push({
      kind: 'diverging',
      id: 'grade',
      diverging: 'grade',
      colours: Object.values(palette.div),
    });
  }
  if (highlighted) {
    // The highlighted portion stands out in ink and the rest of the track,
    // matched route included, drops to the muted colour.
    rows.push({
      kind: 'line',
      id: 'selected-section',
      colour: palette.ink,
      labelKey: 'maps.keySelectedSection',
    });
    rows.push({
      kind: 'line',
      id: 'activity',
      colour: palette.muted,
      labelKey: 'activityDetail.lineKeyActivity',
    });
  } else if (overlayHasData) {
    rows.push({
      kind: 'line',
      id: 'matched-route',
      colour: palette.muted,
      labelKey: 'activityDetail.lineKeyRoute',
    });
  }
  if (hasSectionOverlays && hasRecord) {
    rows.push({
      kind: 'line',
      id: 'record',
      colour: palette.record,
      labelKey: 'sections.legendRecord',
    });
  }
  return rows;
}

/** Every colour the rows name. */
export function keyedColours(rows: readonly ActivityKeyRow[]): Set<string> {
  return new Set(rows.flatMap((row) => (row.kind === 'diverging' ? row.colours : [row.colour])));
}
