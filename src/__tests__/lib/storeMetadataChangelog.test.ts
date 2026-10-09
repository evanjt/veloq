/**
 * Scenario: a release is cut and fastlane uploads one changelog per locale.
 * Google Play rejects a release note over 500 characters, and the validator
 * is the only thing standing between a translation edit and a rejected
 * submission.
 *
 * Expected behaviour: the count is characters rather than bytes, the
 * trailing newline the file ends with is spent, and no locale's changelog
 * for the current version code is over the cap.
 */

import {
  PLAY_CHANGELOG_MAX_CHARS,
  changelogCharCount,
  oversizedChangelogs,
  unsupportedClaimsIn,
  validateMetadata,
} from '../../../scripts/validate-store-metadata';

describe('changelogCharCount', () => {
  it('counts characters, not bytes', () => {
    const kanji = 'セクション検出';
    expect(Buffer.byteLength(kanji, 'utf-8')).toBe(21);
    expect(changelogCharCount(kanji)).toBe(7);
  });

  it('counts an astral character once', () => {
    expect(changelogCharCount('🚵')).toBe(1);
  });

  it('spends the trailing newline', () => {
    expect(changelogCharCount('a\n')).toBe(2);
  });

  it('counts an empty file as nothing', () => {
    expect(changelogCharCount('')).toBe(0);
  });

  it('puts the cap at 500 characters', () => {
    expect(changelogCharCount('x'.repeat(500))).toBe(PLAY_CHANGELOG_MAX_CHARS);
    expect(changelogCharCount('x'.repeat(501))).toBeGreaterThan(PLAY_CHANGELOG_MAX_CHARS);
  });
});

describe('validateMetadata', () => {
  it('passes no changelog over the cap to the store', () => {
    const tooLong = validateMetadata().filter((e) => e.type === 'changelog_too_long');
    expect(tooLong.map((e) => e.message)).toEqual([]);
  });

  it('reports nothing else broken either', () => {
    expect(validateMetadata().map((e) => e.message)).toEqual([]);
  });
});

describe('unsupportedClaimsIn', () => {
  it('refuses advice and patterns no insight kind produces', () => {
    expect(
      unsupportedClaimsIn(
        'Daily insights: fitness milestones, activity patterns, and form advice. ' +
          'Positive, rest-day-aware framing.'
      )
    ).toEqual(['form advice', 'activity patterns', 'positive framing']);
  });

  it('refuses a no-personal-data promise in any case and any locale', () => {
    expect(unsupportedClaimsIn('A device token, No Personal Data is retained.')).toEqual([
      'no personal data kept',
    ]);
    expect(unsupportedClaimsIn('keine persönlichen Daten werden gespeichert')).toEqual([
      'no personal data kept',
    ]);
    expect(unsupportedClaimsIn('不保留任何个人数据')).toEqual(['no personal data kept']);
  });

  it('accepts a listing that names what the server stores', () => {
    expect(
      unsupportedClaimsIn(
        'Section PRs and trends, HRV trends. Optional push notifications store your ' +
          'athlete ID and a device token on our server, deleted after 30 days.'
      )
    ).toEqual([]);
  });

  it('finds no unsupported claim in any store description', () => {
    const claims = validateMetadata().filter((e) => e.type === 'unsupported_claim');
    expect(claims.map((e) => e.message)).toEqual([]);
  });
});

describe('oversizedChangelogs', () => {
  it('finds no changelog over the cap, for any version code', () => {
    expect(oversizedChangelogs().map((e) => e.message)).toEqual([]);
  });
});
