/**
 * A year of mixed training as a scripted phone answers it to the connect page:
 * the same library on every run, drawn from a fixed seed, so a screenshot of a
 * page changes only when the page does.
 */

import methods from '../../../web/connect/methods.json';
import { baseResults, newestFirst, type DemoActivity, type DemoResults } from './connectDemoBase';
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
    anyTile: results['heatmap.tile'].png ?? '',
    device: 'Sam’s phone',
    stats: [],
  };
}
