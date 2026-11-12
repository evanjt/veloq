// A card's track drawn as a small static line. The engine's preview track is
// the only simplification: this reads it and fits it to the thumbnail.

import { decodeCoordsFlat } from '../../modules/veloqrs/src/coords';

import { bytesOf } from './link';

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
 * The line fit to its own bounds, centred, with north up. Longitude is
 * squeezed by the cosine of the middle latitude so the shape keeps its
 * proportions. Null when fewer than two vertices remain.
 */
export function trackShape(preview: string): TrackShape | null {
  const bytes = bytesOf(preview);
  const flat = decodeCoordsFlat(bytes.buffer);
  const points: [lat: number, lng: number][] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    const lat = flat[at] as number;
    const lng = flat[at + 1] as number;
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
  }
  if (points.length < 2) return null;

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lng] of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const width = (east - west) * squeeze;
  const height = north - south;
  const span = Math.max(width, height);
  if (span === 0) return null;

  const room = THUMB - 2 * MARGIN;
  const scale = room / span;
  const left = MARGIN + (room - width * scale) / 2;
  const top = MARGIN + (room - height * scale) / 2;
  const place = ([lat, lng]: [number, number]): [number, number] => [
    round(left + (lng - west) * squeeze * scale),
    round(top + (north - lat) * scale),
  ];
  const placed = points.map(place);
  return {
    path: placed.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${x} ${y}`).join(''),
    start: placed[0] as [number, number],
    end: placed[placed.length - 1] as [number, number],
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

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
