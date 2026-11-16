/**
 * The scripted phones a person or a screenshot run can pair the connect page
 * with, each a variation on the demo library's phone.
 */

import { PAGE_MIN_PROTOCOL, normaliseFingerprint, proof } from '../../../web/connect/link';
import { demoScript } from './connectDemoLibrary';
import type { Script } from './connectPhoneShim';

export const PHONE_KINDS = ['demo', 'unpaired', 'failing', 'slow', 'old', 'behind'] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];

export const BROWSER_FINGERPRINT = normaliseFingerprint('sha-256', 'AA:11:22:33');
export const PHONE_FINGERPRINT = normaliseFingerprint('sha-256', 'BB:44:55:66');
/** The page draws its secret from 32 bytes of 2 under the shim's fixed random bytes. */
const SECRET = new Uint8Array(32).fill(2);

/** What a phone at the oldest protocol the page speaks answers: the first screen reads. */
export const OLD_METHODS = [
  'link.hello',
  'feed.page',
  'feed.summary',
  'feed.sparklines',
  'insights.data',
  'status.sync',
];

/** What a phone one app version behind lists: the first screens' reads, at the current protocol. */
const BEHIND_METHODS = ['link.hello', 'feed.page', 'feed.summary', 'feed.sparklines'];

/** Each reply of the slow phone waits this long, so loading states stay on screen. */
const SLOW_MS = 1_500;

export function isPhoneKind(name: string): name is PhoneKind {
  return (PHONE_KINDS as readonly string[]).includes(name);
}

export async function phoneScript(kind: PhoneKind): Promise<Script> {
  const script = demoScript({
    browserFingerprint: BROWSER_FINGERPRINT,
    phoneFingerprint: PHONE_FINGERPRINT,
    phoneProof: await proof(SECRET, 'phone', BROWSER_FINGERPRINT, PHONE_FINGERPRINT),
  });
  switch (kind) {
    case 'unpaired':
      return { ...script, invite: null, linked: null };
    case 'failing':
      // The phone lists its methods and answers none of them.
      return { ...script, results: {} };
    case 'slow':
      return { ...script, delayMs: SLOW_MS };
    case 'behind':
      return {
        ...script,
        methods: BEHIND_METHODS,
        results: Object.fromEntries(
          Object.entries(script.results).filter(([method]) => BEHIND_METHODS.includes(method))
        ),
        byActivity: {},
      };
    case 'old':
      // The shim answers `link.hello` from `protocol` and `methods`, so the demo's hello, which
      // names every method of the protocol, is left out rather than carried into the script.
      return {
        ...script,
        protocol: PAGE_MIN_PROTOCOL,
        methods: OLD_METHODS,
        results: Object.fromEntries(
          Object.entries(script.results).filter(
            ([method]) => OLD_METHODS.includes(method) && method !== 'link.hello'
          )
        ),
        byActivity: {},
      };
    default:
      return script;
  }
}
