/**
 * Scenario: a name is written in two languages, or in a native file and the
 * JavaScript or config that must agree with it. A rename on one side compiles
 * on both and fails on a device, as a push never enriched, a map with no tiles,
 * a widget that never decodes or a bridge call that answers undefined.
 *
 * Expected behaviour: every such pair agrees. Only agreements live here: what
 * one native file does inside itself is the build's business, not this suite's.
 */

import fs from 'fs';
import path from 'path';

import { VELOQ_TILE_SCHEME } from '@/features/maps/lib/tileTransport';
import { VELOQ_WEBVIEW_COMPONENT_NAME } from '@/features/maps/lib/veloqWebView';
import { SATELLITE_SOURCES } from '@/features/maps/components/mapStyles';
import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';
import { widgetPalette } from '@/shared/theme/widgetTheme';
import { RECORD_PICKER_URL, WIDGET_STRING_KEYS } from '@/features/home/lib/widgetSnapshot';
import { buildContentState } from '@/features/recording/lib/liveActivity/contentState';
import { KEYCHAIN_ACCESS_GROUP } from '@/shared/app/credentialKeychain';
import { PANIC_LOG_NAME, ROUTE_DB_FILES } from '@/shared/storage/routeDbLocation';
import { QUARANTINE_INFIX } from '@/features/settings/lib/databaseSidecars';
import { RECORD_TEMP_PREFIX } from '@/shared/storage/platformRecord';
import { ACTIVITY_LINK_ATHLETE_PARAM } from '@/features/insights/lib/pushPayload';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';
import { DETAIL_STREAM_TYPES, streamTypesKey } from '@/features/activity/lib/engineStreams';
import { ENGINE_ERROR_TAGS } from '@/shared/native/engineError';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import { MUSCLE_NAME_KEYS } from '@/features/strength/lib/muscleNames';
import { resolvedLocale } from '../i18n/resolvedLocale';

import * as stub from '../__shared__/veloqrsStub';
import {
  BINDING,
  HELPERS,
  engineSurface,
  overrides,
  previewSurface,
  valueExports,
  wrongDefaults,
} from '../__shared__/bindingSurface';

const nativeStrings = require('@/../src/plugins/nativeStrings.js');

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GENERATED = 'modules/veloqrs/src/generated/veloqrs.ts';
const RUST = 'modules/veloqrs/rust/veloqrs/src';

it('uses the Rust launch activity window as the TypeScript default', () => {
  const source = read('modules/veloqrs/rust/veloqrs/src/objects/sync.rs');
  const days = source.match(/const ACTIVITY_DAYS: i64 = (\d+);/);
  expect(days).not.toBeNull();
  expect(DEFAULT_ACTIVITY_DAYS).toBe(Number(days?.[1]));
});

// The first-use step stores the detail streams under this key, and the detail
// screen reads them under the key the front end builds.
it('keys the first-use detail streams as the detail screen reads them', () => {
  const key = read(`${RUST}/objects/sync.rs`).match(
    /const DETAIL_STREAM_TYPES_KEY: &str = "([^"]*)"/s
  )?.[1];
  expect(key).toBeDefined();
  expect(key?.replace(/\\\s*/g, '')).toBe(streamTypesKey(DETAIL_STREAM_TYPES));
});

// The FTP milestone compares eFTP against the value this many days earlier,
// and every locale's methodology says so in words.
it('says the FTP comparison window Rust uses in every locale', () => {
  const days = read(`${RUST}/persistence/fitness/derivations.rs`).match(
    /const FTP_LOOKBACK_DAYS: i64 = (\d+);/
  )?.[1];
  expect(days).toBeDefined();
  const locales = fs
    .readdirSync(path.join(ROOT, 'src/i18n/locales'))
    .filter((f) => f.endsWith('.json'));
  const missing = locales.filter((file) => {
    const bundle = resolvedLocale(file.replace('.json', ''));
    return !new RegExp(`\\b${days}\\b`).test(bundle.insights.methodology.ftpEstimation);
  });
  expect(missing).toEqual([]);
});

type Side = { file: string; has?: string | RegExp; lacks?: string | RegExp };
type Contract = { agree: string; a: Side; b: Side };

const PUSH = 'push/ios/VeloqPushExtension';
const PUSH_RS = 'modules/veloqrs/rust/veloqrs/src/push';
const TILE_IOS = 'modules/veloqrs/ios';
const TILE_ANDROID = 'modules/veloqrs/android/src/main/java/com/veloq';
const APP_GROUP = KEYCHAIN_ACCESS_GROUP;

const CONTRACTS: Contract[] = [
  // The push extension and the engine it calls.
  ...[
    'veloq_push_prepare',
    'veloq_push_activity',
    'veloq_push_string_free',
    'veloq_push_record_refusal',
    'veloq_push_payload_reason',
  ].map((name) => ({
    agree: `the push extension's ${name} is a symbol Rust exports`,
    a: { file: `${PUSH}/VeloqPushExtension-Bridging-Header.h`, has: `${name}(` },
    b: { file: `${PUSH_RS}/c.rs`, has: `pub unsafe extern "C" fn ${name}(` },
  })),
  {
    agree: 'iOS and Android push through the one composed entry',
    a: { file: `${PUSH_RS}/c.rs`, has: 'super::activity_push_json(activity_id, athlete_id)' },
    b: { file: `${PUSH_RS}/jni.rs`, has: 'super::activity_push_json(&activity_id, &athlete_id)' },
  },
  {
    agree: 'the iOS push payload passes its athlete to the native sentence call',
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: 'data["athlete_id"]' },
    b: { file: `${PUSH}/VeloqPushEngine.swift`, has: 'veloq_push_activity(id, athlete)' },
  },
  {
    agree: 'the extension point names the class the extension declares',
    a: { file: `${PUSH}/Info.plist`, has: '$(PRODUCT_MODULE_NAME).NotificationService' },
    b: {
      file: `${PUSH}/NotificationService.swift`,
      has: 'class NotificationService: UNNotificationServiceExtension',
    },
  },
  {
    agree: 'the worker asks APNs for the extension the plist registers',
    a: { file: 'oauth-proxy/src/pushMessages.ts', has: 'mutableContent: true' },
    b: { file: `${PUSH}/Info.plist`, has: 'com.apple.usernotifications.service' },
  },
  {
    agree: 'the prebuild runs the plugin that writes the extension target',
    a: { file: 'app.json', has: '"./src/plugins/with-ios-push-extension"' },
    b: { file: 'src/plugins/with-ios-push-extension.js' },
  },
  {
    agree: 'the extension reads push data where expo-notifications puts it',
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: 'userInfo["body"]' },
    b: {
      file: 'node_modules/expo-notifications/ios/ExpoNotifications/Notifications/NotificationRecords.swift',
      has: 'userInfo["body"]',
    },
  },
  ...['ACTIVITY_UPLOADED', 'ACTIVITY_ANALYZED'].map((event) => ({
    agree: `the extension enriches ${event}, which the worker sends`,
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: `"${event}"` },
    b: { file: 'oauth-proxy/src/worker.ts', has: `"${event}"` },
  })),
  {
    agree: 'the extension reads the activity id under the key the worker writes',
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: 'data["activity_id"]' },
    b: { file: 'oauth-proxy/src/pushMessages.ts', has: 'data.activity_id' },
  },
  {
    agree: 'the extension opens the database under the name the app moved it to',
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: `"${ROUTE_DB_FILES[0]}"` },
    b: { file: 'src/shared/storage/routeDbLocation.ts', has: `'${ROUTE_DB_FILES[0]}'` },
  },
  {
    agree: 'the wipe deletes the quarantined copy under the name the engine gives it',
    a: {
      file: `${RUST}/persistence/mod.rs`,
      has: `format!("{}${QUARANTINE_INFIX}{}{}", db_path, ts, suffix)`,
    },
    b: {
      file: 'src/features/settings/lib/databaseSidecars.ts',
      has: `QUARANTINE_INFIX = '${QUARANTINE_INFIX}'`,
    },
  },
  ...[
    {
      rust: 'EXPORT_HOME_LAT: &str = "__export_home_lat"',
      file: 'src/features/settings/components/ExportPrivacyRow.tsx',
      ts: "HOME_LAT_KEY = '__export_home_lat'",
    },
    {
      rust: 'EXPORT_HOME_LNG: &str = "__export_home_lng"',
      file: 'src/features/settings/components/ExportPrivacyRow.tsx',
      ts: "HOME_LNG_KEY = '__export_home_lng'",
    },
    {
      rust: 'EXPORT_PRIVACY_RADIUS_M: &str = "__export_privacy_radius_m"',
      file: 'src/features/settings/components/ExportPrivacyRow.tsx',
      ts: "RADIUS_KEY = '__export_privacy_radius_m'",
    },
    {
      rustFile: 'objects/sync.rs',
      rust: 'OLDEST_ACTIVITY_DATE_KEY: &str = "oldest_activity_date"',
      file: 'src/shared/app/useOldestActivityDate.ts',
      ts: "OLDEST_ACTIVITY_DATE_KEY = 'oldest_activity_date'",
    },
    {
      rustFile: 'objects/sync.rs',
      rust: 'ACTIVITY_YEAR_COUNTS_KEY: &str = "activity_year_counts"',
      file: 'src/shared/app/useActivityYearCounts.ts',
      ts: "ACTIVITY_YEAR_COUNTS_KEY = 'activity_year_counts'",
    },
  ].map(({ rustFile = 'persistence/settings.rs', rust, file, ts }) => ({
    agree: `the engine's clear takes the setting ${file} reads as ${ts.split(' =')[0]}`,
    a: { file: `${RUST}/${rustFile}`, has: rust },
    b: { file, has: ts },
  })),
  {
    agree: 'the wipe and the open use the panic log name the engine appends to',
    a: { file: `${RUST}/persistence/mod.rs`, has: `.join("${PANIC_LOG_NAME}")` },
    b: {
      file: 'src/shared/storage/routeDbLocation.ts',
      has: `PANIC_LOG_NAME = '${PANIC_LOG_NAME}'`,
    },
  },
  {
    agree: 'the wipe deletes the record temporaries under the prefix the engine gives them',
    a: {
      file: `${RUST}/persistence/record_backup.rs`,
      has: `RECORD_TEMP_PREFIX: &str = "${RECORD_TEMP_PREFIX}";`,
    },
    b: {
      file: 'src/shared/storage/platformRecord.ts',
      has: `RECORD_TEMP_PREFIX = '${RECORD_TEMP_PREFIX}'`,
    },
  },
  {
    agree: 'the native activity entry names its athlete where the app reads it',
    a: {
      file: `${TILE_ANDROID}/ActivityNotificationPoster.kt`,
      has: `veloq://activity/\${Uri.encode(activityId)}?${ACTIVITY_LINK_ATHLETE_PARAM}=`,
    },
    b: {
      file: 'src/features/insights/lib/pushPayload.ts',
      has: `ACTIVITY_LINK_ATHLETE_PARAM = '${ACTIVITY_LINK_ATHLETE_PARAM}'`,
    },
  },
  {
    agree: 'the extension reads the keychain group the app writes into',
    a: { file: `${PUSH}/VeloqCredentials.swift`, has: `accessGroup = "${KEYCHAIN_ACCESS_GROUP}"` },
    b: { file: 'src/shared/app/credentialKeychain.ts', has: `'${KEYCHAIN_ACCESS_GROUP}'` },
  },
  {
    agree: 'the extension is entitled to the App Group it reads credentials through',
    a: {
      file: `${PUSH}/VeloqPushExtension.entitlements`,
      has: 'com.apple.security.application-groups',
    },
    b: {
      file: `${PUSH}/VeloqPushExtension.entitlements`,
      has: `<string>${KEYCHAIN_ACCESS_GROUP}</string>`,
    },
  },
  {
    agree: 'the extension is entitled to the App Group whose container it opens',
    a: {
      file: `${PUSH}/VeloqPushExtension.entitlements`,
      has: 'com.apple.security.application-groups',
    },
    b: { file: `${PUSH}/VeloqPushPayload.swift`, has: `"${APP_GROUP}"` },
  },
  ...['intervals_athlete_id', 'intervals_access_token', 'intervals_api_key'].map((key) => ({
    agree: `the extension reads ${key}, which the auth store writes`,
    a: { file: `${PUSH}/VeloqCredentials.swift`, has: `"${key}"` },
    b: { file: 'src/shared/app/AuthStore.ts', has: `'${key}'` },
  })),
  {
    agree: 'the extension queries the services expo-secure-store writes under',
    a: { file: `${PUSH}/VeloqCredentials.swift`, has: '["app:no-auth", "app:auth", "app"]' },
    b: {
      file: 'node_modules/expo-secure-store/ios/SecureStoreModule.swift',
      has: '"auth" : "no-auth"',
    },
  },

  // The tile transport, on both platforms.
  ...['veloq_tile_get_or_fetch', 'veloq_tile_free'].map((name) => ({
    agree: `the iOS scheme handler's ${name} is a symbol Rust exports`,
    a: { file: `${TILE_IOS}/VeloqTileSchemeHandler.m`, has: `${name}(` },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/c.rs',
      has: `pub unsafe extern "C" fn ${name}(`,
    },
  })),
  {
    agree: 'the Android tile bridge hands Rust the status array its JNI symbol writes',
    a: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: /nativeGetOrFetch\(\s*String source, int z, int x, int y, int\[\] status\)/,
    },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs',
      has: "status: JIntArray<'local>,",
    },
  },
  {
    agree: 'the iOS scheme handler passes the status out-parameter its C symbol writes',
    a: { file: `${TILE_IOS}/VeloqTileSchemeHandler.m`, has: 'size_t *len, uint16_t *status)' },
    b: { file: 'modules/veloqrs/rust/veloqrs/src/basemap/c.rs', has: 'status: *mut u16,' },
  },
  {
    agree:
      'a throttling tile host reaches the page as the statuses the snapshot worker backs off on',
    a: {
      file: 'src/features/maps/lib/htmlBuilders/snapshotWorker.ts',
      has: 'status === 429 || status === 503',
    },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/mod.rs',
      has: /Rejected \{ status: 429 \} => 429,\s*TileFetchError::Rejected \{ status: 503 \} => 503,/,
    },
  },
  {
    agree: 'the Android interceptor hands the bridge the status array it answers with',
    a: {
      file: `${TILE_ANDROID}/VeloqTileWebViewClient.java`,
      has: 'TileBridge.getOrFetch(source, z, x, y, status)',
    },
    b: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: 'getOrFetch(String source, int z, int x, int y, int[] status)',
    },
  },
  {
    agree: 'the iOS handler registers the scheme the page loads on',
    a: {
      file: `${TILE_IOS}/VeloqTileSchemeHandler.m`,
      has: `VeloqTileScheme = @"${VELOQ_TILE_SCHEME}";`,
    },
    b: { file: 'src/features/maps/lib/tileTransport.ts', has: `'${VELOQ_TILE_SCHEME}'` },
  },
  {
    agree: 'the iOS view manager is named what the map mounts ask for',
    a: {
      file: `${TILE_IOS}/VeloqWebViewManager.mm`,
      has: `RCT_EXPORT_MODULE(${VELOQ_WEBVIEW_COMPONENT_NAME})`,
    },
    b: { file: 'src/features/maps/lib/veloqWebView.ts', has: `'${VELOQ_WEBVIEW_COMPONENT_NAME}'` },
  },
  {
    agree: 'the Android view manager is named what the map mounts ask for',
    a: {
      file: `${TILE_ANDROID}/VeloqWebViewManager.java`,
      has: `NAME = "${VELOQ_WEBVIEW_COMPONENT_NAME}";`,
    },
    b: { file: 'src/features/maps/lib/veloqWebView.ts', has: `'${VELOQ_WEBVIEW_COMPONENT_NAME}'` },
  },
  {
    agree: 'the Android package registers that view manager',
    a: { file: `${TILE_ANDROID}/VeloqrsPackage.kt`, has: 'VeloqWebViewManager()' },
    b: { file: `${TILE_ANDROID}/VeloqWebViewManager.java`, has: 'class VeloqWebViewManager' },
  },

  // Native module functions the JavaScript bridge calls.
  {
    agree: 'the Android push module has the name the wipe looks up',
    a: { file: `${TILE_ANDROID}/VeloqPushModule.kt`, has: 'Name("VeloqPush")' },
    b: {
      file: 'src/features/insights/lib/activityPushJobs.ts',
      has: "requireOptionalNativeModule<VeloqPushModule>('VeloqPush')",
    },
  },
  {
    agree: 'the Android push module defines the cancellation the wipe calls',
    a: {
      file: `${TILE_ANDROID}/VeloqPushModule.kt`,
      has: 'Function("cancelQueuedActivityPushes")',
    },
    b: {
      file: 'src/features/insights/lib/activityPushJobs.ts',
      has: '?.cancelQueuedActivityPushes()',
    },
  },
  {
    agree: 'autolinking registers the Android push module class',
    a: {
      file: 'modules/veloqrs/expo-module.config.json',
      has: '"com.veloq.VeloqPushModule"',
    },
    b: {
      file: `${TILE_ANDROID}/VeloqPushModule.kt`,
      has: /^package com\.veloq\s[\s\S]*class VeloqPushModule\b/m,
    },
  },
  {
    agree: 'the widget module defines publishRecordShortcuts, which the bridge calls',
    a: {
      file: 'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
      has: 'Function("publishRecordShortcuts")',
    },
    b: { file: 'src/features/home/lib/widgetBridge.ts', has: 'publishRecordShortcuts?.(' },
  },
  ...[
    'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
    'modules/veloq-widget/ios/VeloqWidgetModule.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} defines clearSnapshot, which the wipe calls through the bridge`,
    a: { file, has: 'Function("clearSnapshot")' },
    b: { file: 'src/features/home/lib/widgetBridge.ts', has: 'VeloqWidget.clearSnapshot()' },
  })),
  ...['serviceRunning', 'clear'].map((name) => ({
    agree: `the recording notification module defines ${name}, which the bridge calls`,
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: `Function("${name}")`,
    },
    b: {
      file: 'src/features/recording/lib/recordingNotification.ts',
      has: `VeloqRecordingNotification.${name}()`,
    },
  })),
  ...[
    'bookmarkFolder',
    'writeToBookmarkedFolder',
    'listBookmarkedFolder',
    'readFromBookmarkedFolder',
  ].map((name) => ({
    agree: `the iOS backup module defines ${name}, which the backup folder bridge calls`,
    a: {
      file: 'modules/veloq-backup-exclusion/ios/VeloqBackupExclusionModule.swift',
      has: `Function("${name}")`,
    },
    b: { file: 'src/shared/native/backupFolder.ts', has: `nativeModule().${name}(` },
  })),
  {
    agree: 'the Android backup module defines releaseFolderGrant, which the bridge calls',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'Function("releaseFolderGrant")',
    },
    b: { file: 'src/shared/native/backupFolder.ts', has: '?.releaseFolderGrant(' },
  },
  {
    agree: 'the Android backup module defines getAppStorageStats, which the storage total calls',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'AsyncFunction("getAppStorageStats")',
    },
    b: { file: 'src/shared/native/appStorageStats.ts', has: 'mod.getAppStorageStats' },
  },
  {
    agree: 'the Android backup module is registered under the name the bridge asks for',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'Name("VeloqBackupExclusion")',
    },
    b: { file: 'src/shared/native/backupFolder.ts', has: "'VeloqBackupExclusion'" },
  },
  {
    agree: 'autolinking registers the Android backup module class',
    a: {
      file: 'modules/veloq-backup-exclusion/expo-module.config.json',
      has: '"com.veloq.backupexclusion.VeloqBackupExclusionModule"',
    },
    b: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'package com.veloq.backupexclusion',
    },
  },
  {
    agree: 'an unreachable backup folder crosses with the code the bridge reads',
    a: {
      file: 'modules/veloq-backup-exclusion/ios/VeloqBackupExclusionModule.swift',
      has: 'code: "ERR_FOLDER_UNAVAILABLE"',
    },
    b: { file: 'src/shared/native/backupFolder.ts', has: "'ERR_FOLDER_UNAVAILABLE'" },
  },
  {
    agree: 'the running-service check names the service expo-location starts',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: 'expo.modules.location.services.LocationTaskService',
    },
    b: {
      file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
      has: 'package expo.modules.location.services',
    },
  },

  // The privacy page describes the webhook check the worker makes. A security
  // claim the code does not make is the one an athlete reads before trusting it.
  {
    agree:
      'the privacy page claims the shared-secret webhook check the worker makes, and no signature',
    a: {
      file: 'oauth-proxy/src/worker.ts',
      has: 'secretsMatch(payload.secret, env.WEBHOOK_SECRET)',
    },
    b: {
      file: 'docs/privacy/index.html',
      has: '"security.item4": "Webhook requests verified against a shared secret"',
      lacks: /HMAC/i,
    },
  },
  {
    agree: 'every language on the privacy page names the shared secret the worker checks',
    a: {
      file: 'oauth-proxy/src/worker.ts',
      has: 'secretsMatch(payload.secret, env.WEBHOOK_SECRET)',
    },
    b: {
      file: 'docs/privacy/index.html',
      lacks: /"security\.item4":\s*"(?![^"]*\b(?:[Ss]ecret|secreto)\b)[^"]*"/,
    },
  },
  ...['shared secret', 'secreto compartido', 'secret partagé'].map((claim) => ({
    agree: `the privacy page's "${claim}" claim is the check the worker makes`,
    a: {
      file: 'oauth-proxy/src/worker.ts',
      has: 'secretsMatch(payload.secret, env.WEBHOOK_SECRET)',
    },
    b: {
      file: 'docs/privacy/index.html',
      has: new RegExp(`"security\\.item4":\\s*"[^"]*${claim}[^"]*"`),
    },
  })),

  // The privacy page states what the worker holds and for how long. A retention
  // figure the page does not name is data the athlete was not told about.
  ...[
    ['en', 'IP address[^"]*60 seconds', '5 minutes', '2 minutes'],
    ['es', 'dirección IP[^"]*60 segundos', '5 minutos', '2 minutos'],
    ['fr', 'adresse IP[^"]*60 secondes', '5 minutes', '2 minutes'],
  ].flatMap(([lang, ip, dedupe, code]) => {
    const page = (key: string, text: string) => ({
      file: 'docs/privacy/index.html',
      has: new RegExp(`"${key}":\\s*"[^"]*${text}[^"]*"`),
    });
    const rate = { file: 'oauth-proxy/src/worker.ts', has: 'RATE_LIMIT_WINDOW_SECONDS = 60;' };
    const seen = { file: 'oauth-proxy/src/worker.ts', has: '{ expirationTtl: 300 }' };
    const exchange = {
      file: 'oauth-proxy/src/worker.ts',
      has: 'EXCHANGE_CODE_TTL_SECONDS = 120;',
    };
    return [
      {
        agree: `the ${lang} privacy page names the IP rate counter and its window`,
        a: rate,
        b: page('thirdParty.cloudflare.item3', ip),
      },
      {
        agree: `the ${lang} privacy page names the webhook dedupe record and its lifetime`,
        a: seen,
        b: page('thirdParty.cloudflare.item4', dedupe),
      },
      {
        agree: `the ${lang} privacy page names the parked sign-in code and its lifetime`,
        a: exchange,
        b: page('authMethods.oauth.item6', code),
      },
    ];
  }),
  {
    agree: 'the privacy page does not claim the proxy holds nothing about the athlete',
    a: { file: 'oauth-proxy/src/worker.ts', has: 'rateKey(' },
    b: {
      file: 'docs/privacy/index.html',
      lacks:
        /"thirdParty\.cloudflare\.item\d":\s*"[^"]*(?:or p\w+ data|ni datos \w+|ni les données \w+)/,
    },
  },

  // The widgets, the App Shortcut and the record link.
  {
    agree: 'the push worker writes the snapshot file the Android widgets read',
    a: { file: `${TILE_ANDROID}/WidgetSnapshotFile.kt`, has: 'NAME = "widget-snapshot.json"' },
    b: {
      file: 'widget/android/java/WidgetSnapshot.kt',
      has: 'SNAPSHOT_FILE = "widget-snapshot.json"',
    },
  },
  {
    agree: 'the push worker writes the snapshot file the app writes',
    a: { file: `${TILE_ANDROID}/WidgetSnapshotFile.kt`, has: 'NAME = "widget-snapshot.json"' },
    b: {
      file: 'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
      has: 'SNAPSHOT_FILE = "widget-snapshot.json"',
    },
  },
  {
    agree: 'the Android widgets fall back to the picker link the snapshot names',
    a: { file: 'widget/android/java/WidgetRenderer.kt', has: `"${RECORD_PICKER_URL}"` },
    b: { file: 'src/features/home/lib/widgetSnapshot.ts', has: `'${RECORD_PICKER_URL}'` },
  },
  {
    agree: 'the small Android widget binds the snapshot age into a view its layout declares',
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: /private fun renderSmall[\s\S]*?bindUpdatedAt\(context, v, R\.id\.small_updated, snap\)/,
    },
    b: { file: 'widget/android/res/layout/widget_small.xml', has: '@+id/small_updated' },
  },
  {
    agree: 'the small iOS widget shows the snapshot age under the sparkline',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetViews.swift',
      has: /struct SmallWidgetView[\s\S]*?SnapshotAgeLine\(generatedAt: snapshot\?\.generatedAt[\s\S]*?struct MediumWidgetView/,
    },
    b: { file: 'widget/ios/VeloqWidget/WidgetViews.swift', has: 'struct SnapshotAgeLine' },
  },
  {
    agree: 'the dashboard widget gates its record button on the flag the plugin writes',
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: /getBoolean\(R\.bool\.widget_record_enabled\)[\s\S]*setOnClickPendingIntent\(R\.id\.large_record,/,
    },
    b: { file: 'src/plugins/with-android-widget.js', has: '<bool name="widget_record_enabled">' },
  },
  {
    agree: 'the dashboard widget attaches the record link to the button the layout declares once',
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: 'setOnClickPendingIntent(R.id.large_record,',
      lacks:
        /setOnClickPendingIntent\(R\.id\.large_record,[\s\S]*setOnClickPendingIntent\(R\.id\.large_record,/,
    },
    b: {
      file: 'widget/android/res/layout/widget_large.xml',
      has: 'android:id="@+id/large_record"',
    },
  },
  ...['VISIBLE', 'GONE'].map((visibility) => ({
    agree: `the dashboard widget sets ${visibility} on the record button the large layout declares`,
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: `setViewVisibility(R.id.large_record, View.${visibility})`,
    },
    b: {
      file: 'widget/android/res/layout/widget_large.xml',
      has: 'android:id="@+id/large_record"',
    },
  })),
  {
    agree: 'the iOS record surfaces fall back to the picker link the snapshot names',
    a: { file: 'widget/ios/shared/RecordDeepLink.swift', has: `"${RECORD_PICKER_URL}"` },
    b: { file: 'src/features/home/lib/widgetSnapshot.ts', has: `'${RECORD_PICKER_URL}'` },
  },
  {
    agree: 'the picker link opens a screen',
    a: { file: 'src/features/home/lib/widgetSnapshot.ts', has: `'${RECORD_PICKER_URL}'` },
    b: { file: 'src/app/record.tsx' },
  },
  {
    agree:
      'the configurable Record widget keeps the static one’s kind, so a placed widget survives',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetRecordIntent.swift',
      has: 'let kind = "VeloqRecordWidget"',
    },
    b: { file: 'widget/ios/VeloqWidget/VeloqWidget.swift', has: 'let kind = "VeloqRecordWidget"' },
  },
  {
    agree:
      'below iOS 18 the Siri intent opens the record link in the running app rather than returning a bare result',
    a: {
      file: 'widget/ios/shared/VeloqAppShortcuts.swift',
      has: /await UIApplication\.shared\.open\(url\)\s*return \.result\(\)/,
    },
    b: { file: 'widget/ios/shared/RecordDeepLink.swift' },
  },
  {
    agree:
      'the snapshot writer asks the app target to relearn the Siri sport values by the class name the app declares',
    a: {
      file: 'modules/veloq-widget/ios/VeloqWidgetModule.swift',
      has: '"VeloqAppShortcutRefresher"',
    },
    b: {
      file: 'widget/ios/shared/VeloqAppShortcuts.swift',
      has: '@objc(VeloqAppShortcutRefresher)',
    },
  },
  ...[
    'widget/ios/shared/RecordSportEntity.swift',
    'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
    'modules/veloq-widget/ios/VeloqWidgetModule.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} reads the App Group the plugin entitles`,
    a: { file, has: `"${APP_GROUP}"` },
    b: { file: 'src/plugins/with-app-groups.js', has: `"${APP_GROUP}"` },
  })),
  {
    agree: 'the widget reads the snapshot file the app module writes',
    a: { file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift', has: '"widget-snapshot.json"' },
    b: { file: 'modules/veloq-widget/ios/VeloqWidgetModule.swift', has: '"widget-snapshot.json"' },
  },

  // The engine observer. The binding lowers an optional through its byte
  // cursor, which never consults the handle map a JavaScript implementation
  // lives in, so an optional observer threw on every launch and every screen
  // ran deaf. `observerLoweredByHandle.test.ts` holds the runtime half.
  {
    agree: 'the committed bindings take the bare observer Rust takes, never an optional',
    a: {
      file: GENERATED,
      has: /setObserver\(observer: EngineObserver\): void/,
      lacks: 'FfiConverterOptionalTypeEngineObserver',
    },
    b: {
      file: `${RUST}/objects/engine.rs`,
      has: 'fn set_observer(&self, observer: Arc<dyn crate::objects::observer::EngineObserver>)',
    },
  },

  // A config plugin's entry that a build without it silently lacks.
  {
    agree: 'the checked-in Info.plist carries the portrait mask app.json pins',
    a: {
      file: 'ios/VeloqDev/Info.plist',
      has: /<key>EXDefaultScreenOrientationMask<\/key>\s*<string>UIInterfaceOrientationMaskPortrait<\/string>/,
    },
    b: { file: 'app.json', has: '"initialOrientation": "PORTRAIT_UP"' },
  },
  {
    agree: 'the checked-in Info.plist offers no landscape app.json does not ask for',
    a: { file: 'ios/VeloqDev/Info.plist', lacks: 'UIInterfaceOrientationLandscape' },
    b: { file: 'app.json', has: '"orientation": "portrait"' },
  },
];

function holds(side: Side): void {
  const full = path.join(ROOT, side.file);
  expect(fs.existsSync(full)).toBe(true);
  const text = fs.readFileSync(full, 'utf8');
  if (side.has !== undefined) {
    if (typeof side.has === 'string') expect(text).toContain(side.has);
    else expect(text).toMatch(side.has);
  }
  if (side.lacks !== undefined) {
    if (typeof side.lacks === 'string') expect(text).not.toContain(side.lacks);
    else expect(text).not.toMatch(side.lacks);
  }
}

describe('names written on two sides agree', () => {
  it.each(CONTRACTS.map((c) => [c.agree, c] as const))('%s', (_agree, c) => {
    holds(c.a);
    holds(c.b);
  });
});

/** Property names a Swift struct declares directly, not those of a type nested in it. */
function swiftProperties(swift: string, structName: string): string[] {
  const header = new RegExp(`^([ ]*)(?:public )?struct ${structName}\\b`, 'm');
  const match = header.exec(swift);
  if (!match) throw new Error(`no struct ${structName}`);
  const indent = ' '.repeat(match[1].length + 2);
  const own = new RegExp(`^${indent}(?:public )?let (\\w+):`, 'gm');
  const after = swift.slice(match.index + match[0].length);
  const body = after.slice(0, after.search(new RegExp(`^${match[1]}\\}`, 'm')));
  return [...body.matchAll(own)].map((m) => m[1]);
}

function walk(dir: string, ext: string): string[] {
  return fs.readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

/** Every `Java_pkg_Class_method` the crate exports. */
function rustJniSymbols(): string[] {
  return walk(path.join(ROOT, 'modules/veloqrs/rust/veloqrs/src'), '.rs').flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(/pub extern "system" fn (Java_[A-Za-z0-9_]+)/g)].map(
      (m) => m[1]
    )
  );
}

/** The symbol the JVM looks up for every `native` method a Java class declares. */
function javaNativeSymbols(): string[] {
  return walk(path.join(ROOT, 'modules/veloqrs/android/src/main/java'), '.java').flatMap((file) => {
    const body = fs.readFileSync(file, 'utf8');
    const pkg = /package ([\w.]+);/.exec(body)?.[1];
    const cls = /class (\w+)/.exec(body)?.[1];
    if (!pkg || !cls) return [];
    const prefix = `Java_${pkg.replace(/\./g, '_')}_${cls}`;
    return [...body.matchAll(/\bnative\s+[\w[\]<>.]+\s+(\w+)\s*\(/g)].map(
      (m) => `${prefix}_${m[1]}`
    );
  });
}

/** The `case "<ext>":` labels that fall through to one `return "<mime>";`. */
function javaTypeTable(java: string): string[] {
  const typed: string[] = [];
  let pending: string[] = [];
  for (const line of java.split('\n')) {
    const label = line.match(/case\s+"([a-z0-9]+)":/);
    if (label) {
      pending.push(label[1]);
      continue;
    }
    if (pending.length && /return\s+"[a-z-]+\/[a-z0-9.+-]+";/.test(line)) {
      typed.push(...pending);
      pending = [];
    }
  }
  return typed;
}

/** The extension of every tile template the map sources carry. */
function tileExtensions(): string[] {
  const templates = [
    ...Object.values(SATELLITE_SOURCES),
    ...Object.values(LIBERTY_SOURCES),
  ].flatMap((source) => ((source as { tiles?: string[] }).tiles ?? []) as string[]);
  return templates.map((t) => /\.([a-z0-9]+)(?:\?|$)/.exec(t)?.[1]).filter((e): e is string => !!e);
}

const WIDGET_RS = `${RUST}/widget_snapshot.rs`;

/** The top-level keys the engine's composer writes, as serde names them. */
function snapshotKeys(): string[] {
  const body = /pub struct WidgetSnapshot \{([^}]*)\}/.exec(read(WIDGET_RS))?.[1] ?? '';
  return [...body.matchAll(/^\s*pub (\w+):/gm)].map((m) =>
    m[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  );
}

/** Every key the engine's composer translates, the five form zones spelt out. */
function widgetKeysTranslated(): string[] {
  const rust = read(WIDGET_RS);
  const keys = [...rust.matchAll(/translate\(ctx, "([\w.]+)"\)/g)].map((m) => m[1]);
  const zones = [...rust.matchAll(/^\s*"(highRisk|optimal|greyZone|fresh|transition)"/gm)];
  return [...keys, ...zones.map((m) => `formZones.${m[1]}`)];
}

const liveState = buildContentState({
  status: 'recording',
  now: 1_700_000_600_000,
  movingMs: 600_000,
  distanceLabel: '12.4 km',
  speedLabel: '28.1 km/h',
  gps: Array.from({ length: 8 }, (_, i) => ({
    latitude: -33.86 + i * 0.001,
    longitude: 151.2 + i * 0.001,
    altitude: null,
    accuracy: null,
    speed: null,
    heading: null,
    timestamp: 0,
  })),
});

const LIVE_ACTIVITY = 'widget/ios/VeloqWidget/RecordingActivityAttributes.swift';

/** The Swift sources both widget-facing targets compile, comment lines dropped. */
function widgetSwift(): string[] {
  return ['widget/ios/VeloqWidget', 'widget/ios/shared'].flatMap((dir) =>
    walk(path.join(ROOT, dir), '.swift').map((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n')
    )
  );
}

/**
 * Every literal the widget Swift hands an API that looks it up in the
 * `Localizable` table. An interpolated literal is keyed by its format rather
 * than its text, and the brand name is not translated, so neither is listed.
 */
function swiftLocalisedLiterals(): string[] {
  const position =
    /(?:\bText|\bLabel|\.configurationDisplayName|\.description|\.displayName|IntentDescription|\b(?:title|name|shortTitle):|LocalizedStringResource =)\s*\(?\s*"((?:[^"\\]|\\.)*)"/g;
  return widgetSwift()
    .flatMap((swift) => [...swift.matchAll(position)].map((m) => m[1]))
    .filter((text) => !text.includes('\\(') && text !== 'Veloq');
}

/** The App Shortcut phrases, written as their catalogue keys. */
function swiftShortcutPhrases(): string[] {
  const swift = read('widget/ios/shared/VeloqAppShortcuts.swift');
  return [...swift.matchAll(/phrases: \[([^\]]*)\]/g)].flatMap((block) =>
    [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      m[1]
        .replace(/\\\(\.applicationName\)/g, '${applicationName}')
        .replace(/\\\(\\\.\$(\w+)\)/g, '${$1}')
    )
  );
}

/** Every string resource the widget and the channel poster read, but the app's own name. */
function androidStringReads(): string[] {
  const widget = [
    ...walk(path.join(ROOT, 'widget/android'), '.kt'),
    ...walk(path.join(ROOT, 'widget/android'), '.xml'),
  ]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .flatMap((text) => [...text.matchAll(/(?:R\.string\.|@string\/)(\w+)/g)].map((m) => m[1]));
  const poster = [
    ...read(
      'modules/veloqrs/android/src/main/java/com/veloq/ActivityNotificationPoster.kt'
    ).matchAll(/appString\(context, "(\w+)"\)/g),
  ].map((m) => m[1]);
  return [...widget, ...poster].filter((name) => name !== 'app_name');
}

/** The generated `export enum Name { A = 1, B = 2 }`, as `A=1` entries. */
function generatedEnum(name: string): string[] {
  const block = read(GENERATED).match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`the generated binding declares no enum ${name}`);
  return block[1].split('\n').flatMap((line) => {
    const member = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(\d+))?,?$/);
    return member ? [`${member[1]}=${member[2] ?? 'unset'}`] : [];
  });
}

/** The members of a TypeScript numeric enum as `A=1`, without the reverse mapping. */
function enumMembers(value: Record<string, unknown>): string[] {
  return Object.entries(value)
    .filter(([, member]) => typeof member === 'number')
    .map(([key, member]) => `${key}=${member}`);
}

/** The phases the engine sets, read from the Rust that sets them. */
function announcedPhases(): string[] {
  const found = new Set<string>();
  for (const file of ['sections/preview.rs', 'sections/detection.rs']) {
    for (const m of read(`${RUST}/persistence/${file}`).matchAll(
      /(?:set_phase|announce_phase)\([^)]*?"(\w+)"/g
    )) {
      found.add(m[1]);
    }
  }
  // Refusals, not positions in a run. The screen drops progress on them.
  for (const refusal of ['aborted', 'suspended', 'cutover_owed']) found.delete(refusal);
  return [...found];
}

/** Every slug `exercise_muscle_groups` can put in a `MuscleActivation`. */
function muscleSlugsInRust(): string[] {
  const source = read(`${RUST}/fit.rs`);
  const start = source.indexOf('pub fn exercise_muscle_groups');
  if (start === -1) return [];
  const table = source.slice(start, source.indexOf('\n}', start));
  return [...table.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

/** The methods of the one `#[uniffi::export(with_foreign)]` trait, camel-cased. */
function observerMethodsInRust(): string[] {
  const source = read(`${RUST}/objects/observer.rs`);
  const start = source.indexOf('#[uniffi::export(with_foreign)]');
  if (start === -1) return [];
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return [...body.matchAll(/^\s*fn\s+(\w+)\s*\(/gm)].map((m) =>
    m[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  );
}

/** The methods the committed `EngineObserver` interface declares. */
function observerMethodsInBindings(): string[] {
  const source = read(GENERATED);
  const start = source.indexOf('export interface EngineObserver {');
  if (start === -1) return [];
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]);
}

const bindingExports = valueExports(path.join(BINDING, 'index.ts'));
const engine = engineSurface();
const preview = previewSurface();

/** The stub's engine members EngineClient declares, whose defaults are then held to it. */
const declaredStubMembers = () =>
  Object.keys(stub.engine).filter((name) => engine.members.has(name));
const previewStub = () => stub.createPreviewClientStub() as Record<string, unknown>;

type SetContract = {
  agree: string;
  /** `equal`: the two lists match. `within`: every name in `a` is in `b`. */
  mode: 'equal' | 'within';
  /** The fewest names `a` can hold before the read is a broken extractor. */
  atLeast?: number;
  a: () => string[];
  b: () => string[];
};

const SETS: SetContract[] = [
  {
    agree: 'the push extension declares only C symbols the crate exports',
    mode: 'within',
    a: () =>
      [
        ...read(`${PUSH}/VeloqPushExtension-Bridging-Header.h`).matchAll(/\b(veloq_[a-z_]+)\s*\(/g),
      ].map((m) => m[1]),
    b: () =>
      [...read(`${PUSH_RS}/c.rs`).matchAll(/extern "C" fn (veloq_[a-z_]+)\(/g)].map((m) => m[1]),
  },
  {
    agree: 'every Java native method has the JNI symbol the crate exports, and back',
    mode: 'equal',
    a: javaNativeSymbols,
    b: rustJniSymbols,
  },
  {
    agree: 'the Android tile interceptor types every extension a map source asks for',
    mode: 'within',
    // The vector basemap comes through TileJSON rather than a template, as pbf.
    a: () => [...tileExtensions(), 'pbf'],
    b: () => javaTypeTable(read(`${TILE_ANDROID}/VeloqTileWebViewClient.java`)),
  },
  {
    agree: 'the Live Activity state TypeScript writes is the ContentState Swift decodes',
    mode: 'equal',
    a: () => Object.keys(liveState),
    b: () => swiftProperties(read(LIVE_ACTIVITY), 'ContentState'),
  },
  {
    agree: 'the Live Activity trace TypeScript writes is the Trace Swift decodes',
    mode: 'equal',
    a: () => Object.keys(liveState.trace ?? {}),
    b: () => swiftProperties(read(LIVE_ACTIVITY), 'Trace'),
  },
  {
    agree: 'the Live Activity attributes TypeScript sends are the ones Swift decodes',
    mode: 'equal',
    a: () => {
      const ts = read('src/features/recording/lib/liveActivity/controller.ts');
      const body = /interface LiveActivityAttributes \{([^}]*)\}/.exec(ts)?.[1] ?? '';
      return [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    },
    b: () => swiftProperties(read(LIVE_ACTIVITY), 'VeloqRecordingAttributes'),
  },
  {
    agree: 'every widget snapshot field Swift decodes is one the engine writes',
    mode: 'within',
    a: () =>
      swiftProperties(read('widget/ios/VeloqWidget/WidgetSnapshotModel.swift'), 'WidgetSnapshot'),
    b: snapshotKeys,
  },
  {
    agree: 'every widget snapshot field Kotlin reads is one the engine writes',
    mode: 'within',
    a: () =>
      [...read('widget/android/java/WidgetSnapshot.kt').matchAll(/\broot\.\w+\("(\w+)"/g)].map(
        (m) => m[1]
      ),
    b: snapshotKeys,
  },
  {
    agree: 'every text the widget Swift localises is a key of the generated catalogue',
    mode: 'equal',
    atLeast: 20,
    a: swiftLocalisedLiterals,
    b: () => nativeStrings.APPLE_STRINGS.map((entry: { key: string }) => entry.key),
  },
  {
    agree: 'every Siri phrase the Swift declares is a key of the generated phrase catalogue',
    mode: 'equal',
    atLeast: 5,
    a: swiftShortcutPhrases,
    b: () => nativeStrings.APP_SHORTCUT_PHRASES.map((entry: { key: string }) => entry.key),
  },
  {
    agree: 'every string resource the widget and the channel poster read is one prebuild generates',
    mode: 'equal',
    atLeast: 5,
    a: androidStringReads,
    b: () => nativeStrings.ANDROID_STRINGS.map((entry: { name: string }) => entry.name),
  },
  {
    agree: 'every word the engine writes on the widget is one the app hands it',
    mode: 'within',
    atLeast: 18,
    a: widgetKeysTranslated,
    b: () => [...WIDGET_STRING_KEYS],
  },
  {
    agree: 'the engine error tags TypeScript reads are the variants the bindings carry',
    mode: 'equal',
    a: () => [...ENGINE_ERROR_TAGS],
    b: () => {
      const block = /export enum VeloqError_Tags \{([^}]*)\}/.exec(read(GENERATED));
      return [...(block?.[1] ?? '').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(
        (m) => m[1]
      );
    },
  },
  {
    agree: 'every detection phase Rust announces has a name TypeScript shows',
    mode: 'within',
    atLeast: 4,
    a: announcedPhases,
    b: () => announcedPhases().filter((phase) => getPhaseDisplayName(phase) !== phase),
  },
  {
    agree: 'every muscle slug Rust reports has the name TypeScript shows it under',
    mode: 'equal',
    atLeast: 11,
    a: muscleSlugsInRust,
    b: () => Object.keys(MUSCLE_NAME_KEYS),
  },
  {
    agree: 'every EngineObserver callback Rust declares is in the committed bindings',
    mode: 'within',
    atLeast: 6,
    a: observerMethodsInRust,
    b: observerMethodsInBindings,
  },
  // The Jest stub for the binding cannot import the generated module, so it
  // carries its own copy of each enum, held here member for member and value
  // for value.
  {
    agree:
      'the binding stub carries FfiReferenceSource, declared without discriminants, in the generated order',
    mode: 'equal',
    a: () => enumMembers(stub.FfiReferenceSource as unknown as Record<string, unknown>),
    // An undeclared discriminant is the member's position.
    b: () =>
      generatedEnum('FfiReferenceSource').map((member, i) => member.replace('=unset', `=${i}`)),
  },
  ...(
    [
      ['FfiCallKind', stub.CallKind],
      ['FfiUploadOutcome', stub.UploadOutcome],
      ['SyncState', stub.SyncState],
      ['RangeCoverage', stub.RangeCoverage],
      ['FfiSyncErrorReason', stub.SyncErrorReason],
      ['FfiSyncStep', stub.SyncStep],
      ['BulkExportFormat', stub.BulkExportFormat],
      ['FfiStartOutcome', stub.StartOutcome],
      ['FfiInitOutcome', stub.InitOutcome],
    ] as const
  ).map(
    ([name, value]): SetContract => ({
      agree: `the binding stub carries ${name} as the generated binding declares it`,
      mode: 'equal',
      a: () => enumMembers(value as unknown as Record<string, unknown>),
      b: () => generatedEnum(name),
    })
  ),
  {
    agree: 'the binding stub exports only values the binding exports, plus its helpers',
    mode: 'within',
    a: () => Object.keys(stub.withOverrides()),
    b: () => [...bindingExports, ...HELPERS],
  },
  {
    agree: 'the binding stub engine has only members EngineClient declares',
    mode: 'within',
    a: () => Object.keys(stub.engine),
    b: () => [...engine.members.keys()],
  },
  {
    agree: 'every binding stub engine default is of the kind EngineClient declares',
    mode: 'equal',
    a: declaredStubMembers,
    b: () => {
      const wrong = wrongDefaults(stub.engine, engine).map((line) => line.split(':')[0]);
      return declaredStubMembers().filter((name) => !wrong.includes(name));
    },
  },
  {
    agree: 'the binding stub preview client has exactly the PreviewClient members',
    mode: 'equal',
    a: () => Object.keys(previewStub()),
    b: () => [...preview.members.keys()],
  },
  {
    agree: 'every binding stub preview default is of the kind PreviewClient declares',
    mode: 'equal',
    a: () => Object.keys(previewStub()).filter((name) => preview.members.has(name)),
    b: () => {
      const wrong = wrongDefaults(previewStub(), preview).map((line) => line.split(':')[0]);
      return Object.keys(previewStub()).filter(
        (name) => preview.members.has(name) && !wrong.includes(name)
      );
    },
  },
  {
    agree: 'every stub override a suite writes names a binding export or EngineClient member',
    mode: 'within',
    a: () =>
      overrides().flatMap(({ key, members }) => [
        key,
        ...(key === 'engine' ? members.map((m) => `engine.${m}`) : []),
      ]),
    b: () => [
      ...bindingExports,
      ...HELPERS,
      ...[...engine.members.keys()].map((m) => `engine.${m}`),
    ],
  },
];

describe('name lists written on two sides agree', () => {
  it.each(SETS.map((s) => [s.agree, s] as const))('%s', (_agree, s) => {
    const a = [...new Set(s.a())].sort();
    const b = [...new Set(s.b())].sort();
    // An empty read is a broken extractor, not an agreement.
    expect(a.length).toBeGreaterThanOrEqual(s.atLeast ?? 1);
    expect(b.length).toBeGreaterThan(0);
    if (s.mode === 'equal') expect(a).toEqual(b);
    else expect(a.filter((name) => !b.includes(name))).toEqual([]);
  });
});

describe('the widget palette agrees with the committed Android resources', () => {
  const resource = (dir: string) => read(`widget/android/res/${dir}/widget_theme.xml`);

  const TEXT_RESOURCES = [
    ['widget_form_high_risk_text', 'formHighRiskText'],
    ['widget_form_optimal_text', 'formOptimalText'],
    ['widget_form_grey_zone_text', 'formGreyZoneText'],
    ['widget_form_fresh_text', 'formFreshText'],
    ['widget_form_transition_text', 'formTransitionText'],
  ] as const;

  it.each(TEXT_RESOURCES)('values/%s matches the light palette', (name, key) => {
    expect(resource('values')).toContain(
      `<color name="${name}">${widgetPalette.light[key]}</color>`
    );
  });

  it.each(TEXT_RESOURCES)('values-night/%s matches the dark palette', (name, key) => {
    expect(resource('values-night')).toContain(
      `<color name="${name}">${widgetPalette.dark[key]}</color>`
    );
  });

  it('keeps the fills, which the form bar draws as a ground', () => {
    expect(resource('values')).toContain(
      `<color name="widget_form_grey_zone">${widgetPalette.light.formGreyZone}</color>`
    );
  });
});
