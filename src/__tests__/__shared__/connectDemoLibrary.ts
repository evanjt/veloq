/**
 * A year of mixed training as a scripted phone answers it to the connect page:
 * the same library on every run, drawn from a fixed seed, so a screenshot of a
 * page changes only when the page does.
 */

import methods from '../../../web/connect/methods.json';
import {
  baseResults,
  card,
  heatTilePng,
  isoLocal,
  newestFirst,
  previewOf,
  WELLNESS,
  type DemoActivity,
  type DemoResults,
} from './connectDemoBase';
import { keyedResults, moreResults } from './connectDemoMore';
import type { Script } from './headlessConnectPage';

export {
  ACTIVITIES,
  FEED,
  LIBRARY_END,
  LOADS,
  encodeTrack,
  heatTilePng,
  type DemoActivity,
  type DemoResults,
} from './connectDemoBase';

const names = (methods as { methods: { name: string }[] }).methods.map((entry) => entry.name);

/**
 * The answer to every method of the protocol. The type is the protocol's own, so a method added
 * to it without an answer here does not compile.
 */
export function demoResults(): DemoResults {
  return { ...baseResults(), ...moreResults(names) };
}

/** The newest ride, which has a track and a power stream, and which the activity route opens. */
export const SHOWN_ACTIVITY = (newestFirst.find((a) => a.sport.type === 'Ride') as DemoActivity).id;

/** The newest swim, which has heart rate and speed streams and no track, and which the no-GPS state opens. */
export const UNTRACKED_ACTIVITY = (newestFirst.find((a) => a.sport.type === 'Swim') as DemoActivity)
  .id;

/** The script of a phone holding the demo library. */
export function demoScript(
  base: Pick<Script, 'browserFingerprint' | 'phoneProof'> & { phoneFingerprint: string }
): Script {
  const results = demoResults();
  return {
    browserFingerprint: base.browserFingerprint,
    phoneProof: base.phoneProof,
    invite: { fingerprint: base.phoneFingerprint },
    linked: { fingerprint: base.phoneFingerprint },
    methods: names,
    results,
    byActivity: keyedResults(),
    tilesByBase: {
      light: heatTilePng('light'),
      dark: heatTilePng('dark'),
      satellite: heatTilePng('satellite'),
    },
    anyTile: results['heatmap.tile'].png ?? '',
    windowed: {
      feed: {
        families: ['ride', 'run', 'water', 'foot', 'strength'],
        entries: newestFirst.map((a) => ({
          ts: Math.floor(Date.parse(`${isoLocal(a.start)}Z`) / 1000),
          family: a.sport.family,
          name: a.name,
          sport: a.sport.type,
          card: card(a),
          preview: previewOf(a),
        })),
      },
      routes: results['routes.screen'] as unknown as Record<string, unknown>,
      picker: results['strength.picker'] as unknown as Record<string, unknown>,
      days: {
        'fitness.wellness': {
          field: 'days',
          bounds: 'day',
          rows: WELLNESS.days,
          alongside: { form: WELLNESS.form },
          rest: {
            coverage: WELLNESS.coverage,
            formAsPercent: WELLNESS.formAsPercent,
            formZoneEdges: WELLNESS.formZoneEdges,
          },
        },
        'fitness.loads': {
          field: 'days',
          bounds: 'wall',
          rows: results['fitness.loads'].days,
          rest: {},
        },
      },
    },
    device: 'Sam’s phone',
    stats: [],
  };
}
