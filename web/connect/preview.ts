// A card's track drawn as a small static line. The engine's preview track is
// the only simplification: this reads it and fits it to the thumbnail.

import { decodeCoordsFlat } from '../../modules/veloqrs/src/coords';

import { bytesOf } from './link';
import { fitLines, type LatLng } from './fit';

/** The thumbnail's box in SVG units. The row sizes it with CSS. */
export const THUMB = 48;
const MARGIN = 4;

export type TrackShape = {
  /** An SVG path: a move, then a line to each vertex. */
  path: string;
  start: [x: number, y: number];
  end: [x: number, y: number];
};

/**
 * The vertices of an engine track, as the base64 text the engine sends it in
 * (a preview line or a stream's `latlng`). Pairs with a non-finite value are
 * left out.
 */
export function pointsOf(track: string): LatLng[] {
  const flat = decodeCoordsFlat(bytesOf(track).buffer);
  const points: LatLng[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    const lat = flat[at] as number;
    const lng = flat[at + 1] as number;
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
  }
  return points;
}

/**
 * The line fit to its own bounds, centred, with north up. Null when fewer than
 * two vertices remain or the line has no extent.
 */
export function trackShape(preview: string): TrackShape | null {
  const points = pointsOf(preview);
  if (points.length < 2) return null;
  const fitted = fitLines([points], { width: THUMB, height: THUMB, margin: MARGIN });
  const placed = fitted?.[0];
  if (!placed) return null;
  return {
    path: placed.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${x} ${y}`).join(''),
    start: placed[0] as [number, number],
    end: placed[placed.length - 1] as [number, number],
  };
}

export type SportMark = { family: 'ride' | 'run' | 'swim' | 'walk' | 'other'; mark: string };

/** The family and glyph that stand for a sport where a card has no track. */
export function sportMark(sportType: string | null | undefined): SportMark {
  const sport = (sportType ?? '').toLowerCase();
  if (/ride|cycl|bike/.test(sport)) return { family: 'ride', mark: 'R' };
  if (/run/.test(sport)) return { family: 'run', mark: 'U' };
  if (/swim/.test(sport)) return { family: 'swim', mark: 'S' };
  if (/walk|hike/.test(sport)) return { family: 'walk', mark: 'W' };
  return { family: 'other', mark: sport ? sport.slice(0, 1).toUpperCase() : '?' };
}
