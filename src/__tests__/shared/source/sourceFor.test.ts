/**
 * Scenario: the auth state names a scheme, a demo flag and an athlete id, and
 * every gate asks what that source is and what it can do.
 *
 * Expected behaviour: one pure answer for every state, and every link the app
 * sends an athlete to is the literal it always was, so a moved URL cannot drift
 * by a character.
 */

import { sourceFor, DEMO_ATHLETE_ID, type AuthMethod } from '@/shared/app/source';
import { INTERVALS_URLS } from '@/shared/app/constants';
import * as supportLinks from '@/shared/app/supportLinks';

describe('sourceFor', () => {
  it.each<[AuthMethod, boolean, string | null, string | null]>([
    ['oauth', false, 'i1', 'oauth'],
    ['oauth', false, null, 'oauth'],
    ['apiKey', false, 'i1', 'apiKey'],
    ['apiKey', false, null, 'apiKey'],
    ['demo', true, 'demo', 'demo'],
    ['demo', false, null, 'demo'],
    [null, true, null, 'demo'],
    ['oauth', true, 'i1', 'demo'],
    ['apiKey', false, 'demo', 'demo'],
    [null, false, 'demo', 'demo'],
    [null, false, 'i1', null],
    [null, false, null, null],
  ])('reads %s, demo flag %s, athlete %s as %s', (authMethod, isDemoMode, athleteId, scheme) => {
    expect(sourceFor({ authMethod, isDemoMode, athleteId })?.scheme ?? null).toBe(scheme);
  });

  it('reads the scheme alone when the caller holds nothing else', () => {
    expect(sourceFor({ authMethod: 'oauth' })?.scheme).toBe('oauth');
    expect(sourceFor({ authMethod: null })).toBeNull();
  });

  it('gives push and the scope check to OAuth alone', () => {
    const oauth = sourceFor({ authMethod: 'oauth' })!;
    const apiKey = sourceFor({ authMethod: 'apiKey' })!;
    const demo = sourceFor({ authMethod: 'demo' })!;
    expect([oauth.id, oauth.can]).toEqual([
      'intervals',
      { push: true, scoped: true, uploads: true },
    ]);
    expect([apiKey.id, apiKey.can]).toEqual([
      'intervals',
      { push: false, scoped: false, uploads: true },
    ]);
    expect([demo.id, demo.can]).toEqual(['demo', { push: false, scoped: false, uploads: false }]);
  });

  it('links a real account to intervals.icu and a demo account nowhere', () => {
    expect(sourceFor({ authMethod: 'oauth' })!.links).toBe(INTERVALS_URLS);
    expect(sourceFor({ authMethod: 'apiKey' })!.links).toBe(INTERVALS_URLS);
    expect(sourceFor({ authMethod: 'demo' })!.links).toBeNull();
  });

  it('is frozen, so no caller can rewrite another caller’s answer', () => {
    const oauth = sourceFor({ authMethod: 'oauth' })!;
    expect(Object.isFrozen(oauth)).toBe(true);
    expect(Object.isFrozen(oauth.can)).toBe(true);
  });

  it('names the demo athlete', () => {
    expect(DEMO_ATHLETE_ID).toBe('demo');
  });
});

describe('links', () => {
  it('keeps every intervals.icu page byte for byte', () => {
    expect(INTERVALS_URLS.signup).toBe('https://intervals.icu');
    expect(INTERVALS_URLS.privacyPolicy).toBe('https://intervals.icu/privacy-policy.html');
    expect(INTERVALS_URLS.termsOfService).toBe('https://forum.intervals.icu/tos');
    expect(INTERVALS_URLS.apiTerms).toBe(
      'https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087'
    );
    expect(INTERVALS_URLS.settings).toBe('https://intervals.icu/settings');
    expect(INTERVALS_URLS.developerSettings).toBe('https://intervals.icu/settings#developer');
    expect(INTERVALS_URLS.fitnessPage).toBe('https://intervals.icu/fitness');
    expect(INTERVALS_URLS.subscription).toBe('https://intervals.icu/settings/subscription');
    expect(INTERVALS_URLS.athletePage('i42')).toBe('https://intervals.icu/athlete/i42/activities');
    expect(INTERVALS_URLS.athletePage('')).toBe('https://intervals.icu/athlete//activities');
    expect(INTERVALS_URLS.activityPage('i9001')).toBe('https://intervals.icu/activities/i9001');
  });

  it('keeps every Veloq page byte for byte', () => {
    expect(supportLinks.FORUM_URL).toBe(
      'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283'
    );
    expect(supportLinks.GITHUB_ISSUES_URL).toBe('https://github.com/evanjt/veloq/issues/new');
    expect(supportLinks.GITHUB_SPONSORS_URL).toBe('https://github.com/sponsors/evanjt');
    expect(supportLinks.VELOQ_PRIVACY_URL).toBe('https://veloq.fit/privacy');
    expect(supportLinks.REPOSITORY_URL).toBe('https://github.com/evanjt/veloq');
    expect(supportLinks.LICENCE_URL).toBe('https://github.com/evanjt/veloq/blob/main/LICENSE');
    expect(supportLinks.TRACEMATCH_URL).toBe('https://github.com/evanjt/tracematch');
  });
});
