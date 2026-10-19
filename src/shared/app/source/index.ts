/**
 * What the signed-in source is and what it can do, read from the auth state
 * the caller already selects. The scheme is the credential owner's fact, kept
 * in the keychain and handed to the engine one way, so the engine has nothing
 * to read it from. This stays a pure function: a store, a hook or a cached copy
 * would give the fact a second reader.
 */

import { INTERVALS_URLS } from '@/shared/app/constants';

/** The athlete id demo mode signs in as. */
export const DEMO_ATHLETE_ID = 'demo';

export type AuthMethod = 'oauth' | 'apiKey' | 'demo' | null;

export interface SourceCapabilities {
  /** Registers a push token. The server proves the athlete with an OAuth token alone. */
  push: boolean;
  /** The credential carries scopes, so writing needs a write scope it may lack. */
  scoped: boolean;
  /**
   * Recordings leave the device. A source that cannot upload keeps every
   * recording's FIT, since only an intervals.icu read-back deletes one, and
   * offers no upload for it.
   */
  uploads: boolean;
}

export interface Source {
  id: 'intervals' | 'demo';
  scheme: Exclude<AuthMethod, null>;
  /** The source's own pages, or null when it has none to send an athlete to. */
  links: typeof INTERVALS_URLS | null;
  can: SourceCapabilities;
}

function source(value: Source): Source {
  Object.freeze(value.can);
  return Object.freeze(value);
}

const SOURCES = Object.freeze({
  oauth: source({
    id: 'intervals',
    scheme: 'oauth',
    links: INTERVALS_URLS,
    can: { push: true, scoped: true, uploads: true },
  }),
  apiKey: source({
    id: 'intervals',
    scheme: 'apiKey',
    links: INTERVALS_URLS,
    can: { push: false, scoped: false, uploads: true },
  }),
  demo: source({
    id: 'demo',
    scheme: 'demo',
    links: null,
    can: { push: false, scoped: false, uploads: false },
  }),
});

/**
 * What each sign-in method is called on the account card and the Account
 * screen: the method in the athlete's words, never the protocol's name.
 */
export const SCHEME_LABEL_KEY = Object.freeze({
  oauth: 'settings.authOAuth',
  apiKey: 'settings.authApiKey',
  demo: 'settings.authDemo',
} as const);

export interface AuthInputs {
  authMethod: AuthMethod;
  isDemoMode?: boolean;
  athleteId?: string | null;
}

/**
 * The source for an auth state, or null when nobody is signed in. Any sign of
 * demo wins: the method, the flag, or the demo athlete id. A caller passes the
 * values it selects and no more, so each gate answers from what it reads.
 */
export function sourceFor({
  authMethod,
  isDemoMode = false,
  athleteId = null,
}: AuthInputs): Source | null {
  if (authMethod === 'demo' || isDemoMode || athleteId === DEMO_ATHLETE_ID) return SOURCES.demo;
  if (authMethod === 'oauth') return SOURCES.oauth;
  if (authMethod === 'apiKey') return SOURCES.apiKey;
  return null;
}
