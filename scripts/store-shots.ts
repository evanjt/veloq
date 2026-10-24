/**
 * The store shot list: which shots each store target carries, in order, how
 * each is framed, and whether the capture flow takes it or composition draws it.
 * The capture flow (.maestro/store-capture.yaml) takes the captured stems, the
 * compositor frames them, and a test holds the flow to this list.
 */
import type { ShotLayout } from './store-device';

export type StoreTarget = 'play' | 'appstore' | 'ipad';

export interface StoreShot {
  stem: string;
  /** A whole shot shows the entire device; a detail shot is drawn larger and runs off the bottom. */
  layout: ShotLayout;
  /** `captured` is taken by the capture flow, `composed` is drawn after it. */
  source: 'captured' | 'composed';
  /** The targets that carry the shot. */
  targets: readonly StoreTarget[];
}

const PHONES = ['play', 'appstore'] as const;
const EVERY = ['play', 'appstore', 'ipad'] as const;

/** Every shot, in the order the stems number them. */
export const STORE_SHOTS: readonly StoreShot[] = [
  { stem: '01-feed', layout: 'whole', source: 'captured', targets: EVERY },
  { stem: '02-map', layout: 'detail', source: 'captured', targets: EVERY },
  { stem: '03-activity', layout: 'detail', source: 'captured', targets: EVERY },
  { stem: '04-section', layout: 'whole', source: 'captured', targets: PHONES },
  { stem: '05-insights', layout: 'whole', source: 'captured', targets: PHONES },
  { stem: '06-fitness', layout: 'whole', source: 'captured', targets: PHONES },
  { stem: '07-strength', layout: 'detail', source: 'captured', targets: PHONES },
  { stem: '08-recording', layout: 'whole', source: 'captured', targets: PHONES },
  // The fitness and strength shots carry their widget (SHOT_WIDGETS in store-panels.ts) on every
  // store. Play's phone set is full at eight, so the composed shots are App Store only.
  { stem: '09-widgets', layout: 'whole', source: 'composed', targets: ['appstore'] },
  { stem: '10-privacy', layout: 'whole', source: 'composed', targets: ['appstore'] },
];

/** The stems the capture flow takes, in the order it takes them. */
export const CAPTURED_STEMS: readonly string[] = STORE_SHOTS.filter(
  (s) => s.source === 'captured'
).map((s) => s.stem);

export const SHOT_LAYOUTS: Readonly<Record<string, ShotLayout>> = Object.fromEntries(
  STORE_SHOTS.map((s) => [s.stem, s.layout])
);

/** A target's shots, in order. */
export function shotsFor(target: StoreTarget): StoreShot[] {
  return STORE_SHOTS.filter((s) => s.targets.includes(target));
}
