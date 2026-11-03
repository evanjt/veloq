/**
 * The one key for the preview map. It lists the diff strip's four categories,
 * each in the colour the map draws it in, and a category appears only while the
 * run holds sections of it. Before a run the key is the current catalogue and
 * the area box.
 */

import type { MapPalette } from '@/theme';
import type { PreviewResult } from 'veloqrs';
import { buildPreviewLayers } from './previewMapLayerSpecs';

export type PreviewKeyCounts = Pick<
  PreviewResult['counts'],
  'unchanged' | 'changed' | 'new' | 'gone'
>;

export type PreviewKeyId = 'current' | 'unchanged' | 'changed' | 'new' | 'gone' | 'area';

export interface PreviewKeyEntry {
  id: PreviewKeyId;
  /** Sections in the category, absent for the entries that are not counted. */
  count?: number;
  swatch: string;
  dashed: boolean;
}

const DIFF_CATEGORIES = ['unchanged', 'changed', 'new', 'gone'] as const;

/** The colour the map draws a category in, read off the layer specs so the two cannot drift. */
function categoryColour(id: (typeof DIFF_CATEGORIES)[number], palette: MapPalette): string {
  const layers = buildPreviewLayers(palette, false, true);
  if (id === 'gone')
    return layers.find((l) => l.id === 'gone-line')?.paint?.['line-color'] as string;
  const match = layers.find((l) => l.id === 'proposed-line')?.paint?.['line-color'] as unknown[];
  const at = match.indexOf(id);
  return (at === -1 ? match[match.length - 1] : match[at + 1]) as string;
}

export function buildPreviewKey(
  counts: PreviewKeyCounts | null,
  palette: MapPalette,
  hasArea: boolean
): PreviewKeyEntry[] {
  const entries: PreviewKeyEntry[] = [];
  if (!counts) {
    entries.push({
      id: 'current',
      swatch: palette.layer.sections[0] ?? palette.layer.current,
      dashed: false,
    });
  } else {
    entries.push({ id: 'current', swatch: palette.layer.current, dashed: true });
    for (const id of DIFF_CATEGORIES) {
      if (counts[id] > 0) {
        entries.push({
          id,
          count: counts[id],
          swatch: categoryColour(id, palette),
          dashed: id === 'gone',
        });
      }
    }
  }
  if (hasArea) entries.push({ id: 'area', swatch: palette.layer.casing, dashed: true });
  return entries;
}
