/**
 * Scenario: the credential is written into a shared keychain access group so a
 * notification service extension can read it. Without the entitlement the
 * write fails at runtime and the athlete cannot sign in at all.
 *
 * Expected behaviour: the app target declares the group, and it is the App
 * Group id, which needs no team prefix and is already registered.
 */

const {
  KEYCHAIN_ACCESS_GROUP,
  KEYCHAIN_ACCESS_GROUPS_KEY,
  addKeychainAccessGroup,
} = require('../../plugins/with-keychain-access-group');

describe('with-keychain-access-group', () => {
  it('adds the group to an entitlements file that has none', () => {
    const entitlements: Record<string, unknown> = {};
    addKeychainAccessGroup(entitlements);
    expect(entitlements[KEYCHAIN_ACCESS_GROUPS_KEY]).toEqual([KEYCHAIN_ACCESS_GROUP]);
  });

  it('keeps entitlements it did not write', () => {
    const entitlements: Record<string, unknown> = {
      [KEYCHAIN_ACCESS_GROUPS_KEY]: ['$(AppIdentifierPrefix)com.veloq.app'],
      'com.apple.security.application-groups': ['group.com.veloq.app'],
    };
    addKeychainAccessGroup(entitlements);
    expect(entitlements[KEYCHAIN_ACCESS_GROUPS_KEY]).toEqual([
      '$(AppIdentifierPrefix)com.veloq.app',
      KEYCHAIN_ACCESS_GROUP,
    ]);
    expect(entitlements['com.apple.security.application-groups']).toEqual(['group.com.veloq.app']);
  });

  it('is idempotent across prebuilds', () => {
    const entitlements: Record<string, unknown> = {};
    addKeychainAccessGroup(entitlements);
    addKeychainAccessGroup(entitlements);
    expect(entitlements[KEYCHAIN_ACCESS_GROUPS_KEY]).toEqual([KEYCHAIN_ACCESS_GROUP]);
  });

  it('shares the App Group id, so no team prefix has to be pinned', () => {
    expect(KEYCHAIN_ACCESS_GROUP).toBe('group.com.veloq.app');
  });
});
