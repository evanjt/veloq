/**
 * The store shot list: which shots each store target carries, in order, how
 * each is framed, and whether the capture flow takes it or composition draws it.
 * The capture flow (.maestro/store-capture.yaml) takes the captured stems, the
 * compositor frames them, and a test holds the flow to this list.
 */
import { getRouteCoordinates } from '@/shared/demo/routes/routes';
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
  /** The demo route whose fixes the device plays while the shot is taken, so the map never shows the handset's own location. */
  position?: { routeId: string };
}

const EVERY = ['play', 'appstore', 'ipad'] as const;

/** Every shot, in the order the stems number them. */
export const STORE_SHOTS: readonly StoreShot[] = [
  { stem: '01-feed', layout: 'whole', source: 'captured', targets: EVERY },
  { stem: '02-map', layout: 'detail', source: 'captured', targets: EVERY },
  { stem: '03-activity', layout: 'detail', source: 'captured', targets: EVERY },
  { stem: '04-section', layout: 'whole', source: 'captured', targets: EVERY },
  { stem: '05-insights', layout: 'whole', source: 'captured', targets: EVERY },
  { stem: '06-fitness', layout: 'whole', source: 'captured', targets: EVERY },
  { stem: '07-strength', layout: 'detail', source: 'captured', targets: EVERY },
  {
    stem: '08-recording',
    layout: 'whole',
    source: 'captured',
    targets: EVERY,
    position: { routeId: 'route-valais-ride-1' },
  },
  // The fitness and strength shots carry their widget (SHOT_WIDGETS in store-panels.ts) on every
  // store. The composed shots are App Store only.
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

const TRACK_FIXES = 12;

export type CaptureDevice = 'emulator' | 'simulator' | 'physical';

/**
 * The [lat, lng] fixes the device plays for the capture, or null when no shot
 * declares a position. A physical handset cannot be given a position without a
 * mock-location app, so it is refused rather than left on its real one.
 */
export function capturePosition(device: CaptureDevice): [number, number][] | null {
  const shot = STORE_SHOTS.find((s) => s.position);
  if (!shot?.position) return null;
  if (device === 'physical') {
    throw new Error(
      `${shot.stem} needs a mocked position and a physical handset cannot be given one`
    );
  }
  const coords = getRouteCoordinates(shot.position.routeId);
  if (coords.length < TRACK_FIXES) throw new Error(`No demo route ${shot.position.routeId}`);
  const step = (coords.length - 1) / (TRACK_FIXES - 1);
  return Array.from(
    { length: TRACK_FIXES },
    (_, i) => coords[Math.round(i * step)] as [number, number]
  );
}

// `npx tsx scripts/store-shots.ts track <emulator|simulator|physical>` prints one `lat,lng`
// waypoint per line, which the capture scripts play.
if (/store-shots\.ts$/.test(process.argv[1] ?? '') && process.argv[2] === 'track') {
  for (const [lat, lng] of capturePosition(process.argv[3] as CaptureDevice) ?? []) {
    console.log(`${lat},${lng}`);
  }
}
