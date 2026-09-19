const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Expo config plugin that shares the credential keychain with the app's
 * extensions.
 *
 * A notification service extension is a different bundle id, so it cannot see
 * a keychain item the app wrote into its own group. A shared access group is
 * how iOS lets both read one item.
 *
 * The group is the App Group id `with-app-groups.js` already pins. An access
 * group normally has to carry the team prefix (`$(AppIdentifierPrefix)…`),
 * which would mean hard-coding a team id; an App Group identifier is accepted
 * as a keychain access group as it stands, and it is already registered on the
 * developer portal for the widget.
 *
 * Every extension target has to declare the SAME group in its own
 * entitlements. Because the native dirs are checked in (no prebuild), this is
 * also mirrored by hand into each target's `.entitlements`.
 */

const KEYCHAIN_ACCESS_GROUP = 'group.com.veloq.app';
const KEYCHAIN_ACCESS_GROUPS_KEY = 'keychain-access-groups';

/** Add the group to one entitlements object, leaving everything else alone. */
function addKeychainAccessGroup(entitlements) {
  const existing = Array.isArray(entitlements[KEYCHAIN_ACCESS_GROUPS_KEY])
    ? entitlements[KEYCHAIN_ACCESS_GROUPS_KEY]
    : [];
  if (!existing.includes(KEYCHAIN_ACCESS_GROUP)) {
    entitlements[KEYCHAIN_ACCESS_GROUPS_KEY] = [...existing, KEYCHAIN_ACCESS_GROUP];
  }
  return entitlements;
}

module.exports = function withKeychainAccessGroup(config) {
  return withEntitlementsPlist(config, (mod) => {
    addKeychainAccessGroup(mod.modResults);
    return mod;
  });
};

module.exports.KEYCHAIN_ACCESS_GROUP = KEYCHAIN_ACCESS_GROUP;
module.exports.KEYCHAIN_ACCESS_GROUPS_KEY = KEYCHAIN_ACCESS_GROUPS_KEY;
module.exports.addKeychainAccessGroup = addKeychainAccessGroup;
