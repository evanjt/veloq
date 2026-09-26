/**
 * Scenario: a push lands on iOS and the notification service extension is
 * what iOS wakes for it. It is a second process with no JavaScript, no JSI and
 * no JNI, so it reaches the engine through plain C symbols in the Rust
 * xcframework, and it reaches the database and the token through the App Group
 * and the keychain group both targets declare.
 *
 * Expected behaviour: each of those is written in two languages, and each is
 * checked here to agree. A rename on either side compiles, links on the Mac
 * and fails at runtime as a notification that is never enriched, with nothing
 * naming the cause.
 */

import fs from 'fs';
import path from 'path';

import { KEYCHAIN_ACCESS_GROUP } from '@/shared/app/credentialKeychain';
import { ROUTE_DB_FILES } from '@/shared/storage/routeDbLocation';

const projectRoot = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const EXTENSION = 'push/ios/VeloqPushExtension';
const SERVICE = read(`${EXTENSION}/NotificationService.swift`);
const ENGINE = read(`${EXTENSION}/VeloqPushEngine.swift`);
const CREDENTIALS = read(`${EXTENSION}/VeloqCredentials.swift`);
const PAYLOAD = read(`${EXTENSION}/VeloqPushPayload.swift`);
const HEADER = read(`${EXTENSION}/VeloqPushExtension-Bridging-Header.h`);
const INFO_PLIST = read(`${EXTENSION}/Info.plist`);
const ENTITLEMENTS = read(`${EXTENSION}/VeloqPushExtension.entitlements`);
const RUST_ENTRY = read('modules/veloqrs/rust/veloqrs/src/push/c.rs');
const RUST_MOD = read('modules/veloqrs/rust/veloqrs/src/push/mod.rs');
const PUSH_MESSAGES = read('oauth-proxy/src/pushMessages.ts');
const APP_JSON = read('app.json');

/** The three the extension calls, which are the three the Android worker calls. */
const ENTRIES = ['veloq_push_prepare', 'veloq_push_activity', 'veloq_push_string_free'];

describe('the extension reaches the engine through the symbols Rust exports', () => {
  it.each(ENTRIES)('declares %s, and Rust exports it', (name) => {
    expect(HEADER).toContain(`${name}(`);
    expect(RUST_ENTRY).toContain(`pub unsafe extern "C" fn ${name}(`);
    expect(ENGINE).toContain(`${name}(`);
  });

  it('declares nothing the crate does not export', () => {
    const declared = [...HEADER.matchAll(/\b(veloq_[a-z_]+)\s*\(/g)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual([...ENTRIES].sort());
  });

  it('is compiled for every target, since the symbols are plain C', () => {
    expect(RUST_MOD).toMatch(/\nmod c;/);
    expect(RUST_MOD).not.toMatch(/#\[cfg\(target_os = "ios"\)\]\nmod c;/);
  });

  it('gives every string it is handed straight back', () => {
    expect(ENGINE).toContain('veloq_push_string_free(answer)');
  });
});

describe('the extension is the one APNs invokes', () => {
  it('registers at the notification service extension point', () => {
    expect(INFO_PLIST).toContain('com.apple.usernotifications.service');
    expect(INFO_PLIST).toContain('$(PRODUCT_MODULE_NAME).NotificationService');
    expect(SERVICE).toContain('class NotificationService: UNNotificationServiceExtension');
  });

  it('is only ever invoked because the worker asks for it', () => {
    expect(PUSH_MESSAGES).toContain('mutableContent: true');
  });

  it('is wired into the prebuild, or no target is written at all', () => {
    expect(APP_JSON).toContain('./src/plugins/with-ios-push-extension');
  });

  it('answers once, whether the work finished or the thirty seconds ran out', () => {
    expect(SERVICE).toContain('override func serviceExtensionTimeWillExpire()');
    expect(SERVICE).toContain('deliver = nil');
  });

  it('does the work off the main thread, which the expiry warning arrives on', () => {
    expect(SERVICE).toContain('DispatchQueue.global');
  });
});

describe('what the extension reads, and where the app put it', () => {
  it('opens the database under the name and the container the app moved it to', () => {
    expect(PAYLOAD).toContain(`"${ROUTE_DB_FILES[0]}"`);
    expect(PAYLOAD).toContain('forSecurityApplicationGroupIdentifier');
    expect(PAYLOAD).toContain(`"${KEYCHAIN_ACCESS_GROUP}"`);
  });

  it('leaves the server line standing until the app has moved the file', () => {
    expect(PAYLOAD).toContain('fileExists(atPath: path)');
  });

  it('reads the keychain in the group the app writes into', () => {
    expect(CREDENTIALS).toContain(`accessGroup = "${KEYCHAIN_ACCESS_GROUP}"`);
    expect(ENTITLEMENTS).toContain(`<string>${KEYCHAIN_ACCESS_GROUP}</string>`);
    expect(ENTITLEMENTS).toContain('keychain-access-groups');
    expect(ENTITLEMENTS).toContain('com.apple.security.application-groups');
  });

  it('asks for the three keys the auth store writes, by their own names', () => {
    for (const key of ['intervals_athlete_id', 'intervals_access_token', 'intervals_api_key']) {
      expect(CREDENTIALS).toContain(`"${key}"`);
    }
  });

  it('queries the services expo-secure-store writes under, in its own order', () => {
    expect(CREDENTIALS).toContain('["app:no-auth", "app:auth", "app"]');
  });

  it('leaves the choice between the two secrets to the crate', () => {
    expect(RUST_MOD).toContain('pub fn native_auth_choice');
    expect(CREDENTIALS).not.toContain('oauth');
  });

  it('asks for the push through the one entry Android asks through', () => {
    // The composed entry reads the gate before it fetches, writes the metrics
    // row the ladder needs to date a lap, and carries the ride's name. Calling
    // the fetch and the sentence separately skipped the first two.
    expect(RUST_ENTRY).toContain('super::activity_push_json(activity_id)');
    expect(read('modules/veloqrs/rust/veloqrs/src/push/jni.rs')).toContain(
      'super::activity_push_json(&activity_id)'
    );
  });
});

describe('which pushes it acts on', () => {
  it('reads the data out of the key expo-notifications puts it under', () => {
    expect(PAYLOAD).toContain('userInfo["body"]');
  });

  it('enriches the two activity events and nothing else', () => {
    expect(PAYLOAD).toContain('"ACTIVITY_UPLOADED"');
    expect(PAYLOAD).toContain('"ACTIVITY_ANALYZED"');
    expect(PAYLOAD).toContain('activity_id');
  });

  it('reads nothing out of the payload the crate resolves for itself', () => {
    // The sport and the name come off the detail body the composed entry
    // fetches. A second reading of them here would be a fact with two owners.
    expect(PAYLOAD).not.toContain('sport_type');
    expect(SERVICE).not.toContain('sportType');
  });
});
