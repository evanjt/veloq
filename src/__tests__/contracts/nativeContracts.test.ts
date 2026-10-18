/**
 * Scenario: a name is written in two languages, or in a native file and the
 * JavaScript or config that must agree with it. A rename on one side compiles
 * on both and fails on a device, as a push never enriched, a map with no tiles,
 * a widget that never decodes or a bridge call that answers undefined.
 *
 * Expected behaviour: every such pair agrees. Only agreements live here: what
 * one native file does inside itself is the build's business, not this suite's.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  MAPLIBRE_GL_CSS_FILE,
  MAPLIBRE_GL_CSS_SHA256,
  MAPLIBRE_GL_JS_FILE,
  MAPLIBRE_GL_JS_SHA256,
} from '@/features/maps/assets/maplibreRenderer.generated';

import { VELOQ_TILE_SCHEME } from '@/features/maps/lib/tileTransport';
import { VELOQ_WEBVIEW_COMPONENT_NAME } from '@/features/maps/lib/veloqWebView';
import { SATELLITE_SOURCES } from '@/features/maps/components/mapStyles';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { mapPalette } from '@/theme';
import { HEATMAP_TILE_STOPS } from '@/features/maps/lib/heatmapPaint';
import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';
import { widgetPalette } from '@/shared/theme/widgetTheme';
import { SPORT_FAMILY_ORDER } from '@/shared/activity/sportCategories';
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
import { PHASE_DISPLAY_KEYS } from '@/features/routes/lib/detectionProgress';
import { SUPPORTED_LOCALES } from '@/i18n/types';
import { MUSCLE_NAME_KEYS } from '@/features/strength/lib/muscleNames';
import { FORM_ZONE_BOUNDARIES, formatForm, getFormZone } from '@/features/fitness/lib/fitness';
import { AVAILABLE_METRICS, HERO_METRICS } from '@/features/settings/stores/summaryCardPreferences';
import {
  ELEVATION_GAIN_HYSTERESIS_M,
  ELEVATION_SMOOTHING_POINTS,
} from '@/features/recording/lib/elevationChange';
import { pushDataFor } from '../../../oauth-proxy/src/pushMessages';
import { resolvedLocale } from '../i18n/resolvedLocale';

import * as stub from '../__shared__/veloqrsStub';
import { insightCategories } from '../__shared__/insightCategories';
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
const androidWidgetPlugin = require('@/../src/plugins/with-android-widget.js');

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GENERATED = 'modules/veloqrs/src/generated/veloqrs.ts';
const RUST = 'modules/veloqrs/rust/veloqrs/src';

it('limits native map release to pages with a registered rebuild path', () => {
  const manager = read('modules/veloqrs/android/src/main/java/com/veloq/VeloqWebViewManager.java');
  const marker = 'window._veloqReleasableMap';
  expect(manager).toContain(`${marker} && window.map`);
  expect(read('src/features/maps/lib/htmlBuilders/map3D.ts')).toContain(`${marker} = true`);
  expect(read('src/features/maps/lib/htmlBuilders/mapSurface.ts')).toContain(`${marker} = true`);
  expect(read('src/features/maps/lib/htmlBuilders/snapshotWorker.ts')).toContain(
    `${marker} = true`
  );
});

it('uses the Rust launch activity window as the TypeScript default', () => {
  const source = read('modules/veloqrs/rust/veloqrs/src/objects/sync.rs');
  const days = source.match(/const ACTIVITY_DAYS: i64 = (\d+);/);
  expect(days).not.toBeNull();
  expect(DEFAULT_ACTIVITY_DAYS).toBe(Number(days?.[1]));
});

// A recording's climbing is counted in TypeScript as it is recorded and
// uploaded as the activity's ascent, so it takes the engine's margin and mean.
it('counts recorded climbing on the margin and mean the engine uses', () => {
  const source = read('modules/veloqrs/rust/tracematch/src/geo_utils.rs');
  const margin = source.match(/const ELEVATION_GAIN_HYSTERESIS_M: f64 = ([\d.]+);/);
  expect(Number(margin?.[1])).toBe(ELEVATION_GAIN_HYSTERESIS_M);
  const window = source.match(
    /let lo = i\.saturating_sub\((\d+)\);\s*let hi = \(i \+ (\d+)\)\.min\(n - 1\);/
  );
  expect(window).not.toBeNull();
  expect(Number(window?.[1]) + Number(window?.[2]) + 1).toBe(ELEVATION_SMOOTHING_POINTS);
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

// The detail screen's stat cards read the engine's activity record by these
// generated names. A field the Rust record stops carrying draws as a card that
// silently never appears, which no type check on the screen can catch once a
// test double stands in for the record.
it('types every field the activity stat cards read in the engine record', () => {
  const block = read(GENERATED).match(/export type FfiActivityRecord = \{([\s\S]*?)\n\};/)?.[1];
  expect(block).toBeDefined();
  const fields = [...(block ?? '').matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
  expect(fields).toEqual(
    expect.arrayContaining([
      'isDetail',
      'sportType',
      'movingTime',
      'trainingLoad',
      'intensity',
      'trimp',
      'strainScore',
      'avgHr',
      'maxHr',
      'hrRecovery',
      'calories',
      'weatherTemp',
      'sensorTemp',
      'feelsLike',
      'windSpeed',
      'hasWeather',
      'avgPower',
      'maxPower',
      'eftp',
      'ftp',
      'efficiencyFactor',
      'decoupling',
    ])
  );
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

// Each native push parser, and how it reads one key of the worker's data.
const PUSH_PARSERS = [
  { file: `${PUSH}/VeloqPushPayload.swift`, read: (key: string) => `data["${key}"]` },
  { file: `${TILE_ANDROID}/ActivityPushEvent.kt`, read: (key: string) => `fields["${key}"]` },
];
// The keys come from running the worker's own builder, not from a copy of them.
const PUSH_KEYS = Object.keys(
  pushDataFor({ type: 'ACTIVITY_UPLOADED', athlete_id: 'i1', activity: { id: 'a1' } })
);

const CONTRACTS: Contract[] = [
  // The push extension and the engine it calls.
  ...[
    'veloq_push_prepare',
    'veloq_push_activity',
    'veloq_push_string_free',
    'veloq_push_record_refusal',
    'veloq_push_payload_reason',
    'veloq_push_widget_snapshot',
  ].map((name) => ({
    agree: `the push extension's ${name} is a symbol Rust exports`,
    a: { file: `${PUSH}/VeloqPushExtension-Bridging-Header.h`, has: `${name}(` },
    b: { file: `${PUSH_RS}/c.rs`, has: new RegExp(`pub (unsafe )?extern "C" fn ${name}\\(`) },
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
    agree: 'the iCloud carrier loads the module whose plugin entitles its container',
    a: { file: 'app.json', has: '"iCloudContainerIdentifier": "iCloud.com.veloq.app"' },
    b: {
      file: 'src/features/settings/lib/autobackup/backends/icloudBackend.ts',
      has: "require('react-native-cloud-storage')",
    },
  },
  {
    agree: 'the iCloud carrier names the container the config plugin entitles',
    a: { file: 'app.json', has: '"iCloudContainerIdentifier": "iCloud.com.veloq.app"' },
    b: {
      file: 'src/features/settings/lib/autobackup/backends/icloudBackend.ts',
      has: "ICLOUD_CONTAINER = 'iCloud.com.veloq.app'",
    },
  },
  {
    agree: 'the extension reads push data where expo-notifications puts it',
    a: { file: `${PUSH}/VeloqPushPayload.swift`, has: 'userInfo["body"]' },
    b: {
      file: 'node_modules/expo-notifications/ios/ExpoNotifications/Notifications/NotificationRecords.swift',
      has: 'userInfo["body"]',
    },
  },
  ...PUSH_PARSERS.flatMap((parser) =>
    PUSH_KEYS.map((key) => ({
      agree: `${path.basename(parser.file)} reads ${key}, a key pushDataFor writes`,
      a: { file: parser.file, has: parser.read(key) },
      b: { file: 'oauth-proxy/src/pushMessages.ts', has: 'export function pushDataFor(' },
    }))
  ),
  ...PUSH_PARSERS.flatMap((parser) =>
    ['ACTIVITY_UPLOADED', 'ACTIVITY_ANALYZED'].map((event) => ({
      agree: `${path.basename(parser.file)} enriches ${event}, which the worker sends`,
      a: { file: parser.file, has: `"${event}"` },
      b: { file: 'oauth-proxy/src/worker.ts', has: `"${event}"` },
    }))
  ),
  {
    agree: 'the extension opens the database under the name the app moved it to',
    a: { file: `${PUSH}/WidgetSnapshotFile.swift`, has: `"${ROUTE_DB_FILES[0]}"` },
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
  ].map(({ rustFile = 'persistence/settings.rs', rust, file, ts }) => ({
    agree: `the engine's clear takes the setting ${file} reads as ${ts.split(' =')[0]}`,
    a: { file: `${RUST}/${rustFile}`, has: rust },
    b: { file, has: ts },
  })),
  {
    agree: 'the history range reads typed year counts from the settings screen',
    a: { file: `${RUST}/ffi_types.rs`, has: 'pub activity_year_counts: Vec<FfiYearCount>' },
    b: { file: 'src/features/settings/hooks/useActivityYearCounts.ts', has: '.activityYearCounts' },
  },
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
    b: { file: `${PUSH}/WidgetSnapshotFile.swift`, has: `"${APP_GROUP}"` },
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

  // A torn-down JavaScript runtime lets go of its observer, on both platforms.
  ...[`${TILE_IOS}/Veloqrs.mm`, 'modules/veloqrs/android/cpp-adapter.cpp'].map((file) => ({
    agree: `${file} tears the runtime down through a symbol Rust exports`,
    a: { file, has: 'veloq_runtime_torn_down();' },
    b: {
      file: `${RUST}/objects/observer.rs`,
      has: 'pub extern "C" fn veloq_runtime_torn_down()',
    },
  })),
  {
    agree: 'the Android module declares the JNI symbol its runtime teardown calls',
    a: { file: `${TILE_ANDROID}/VeloqrsModule.kt`, has: 'external fun nativeRuntimeTornDown()' },
    b: {
      file: 'modules/veloqrs/android/cpp-adapter.cpp',
      has: 'Java_com_veloq_VeloqrsModule_nativeRuntimeTornDown(',
    },
  },
  {
    agree: 'both platforms tear the runtime down when React invalidates the module',
    a: {
      file: `${TILE_ANDROID}/VeloqrsModule.kt`,
      has: /override fun invalidate\(\) \{\s*nativeRuntimeTornDown\(\)/,
    },
    b: {
      file: `${TILE_IOS}/Veloqrs.mm`,
      has: /- \(void\)invalidate\s*\{\s*veloq_runtime_torn_down\(\);/,
    },
  },

  // The tile transport, on both platforms.
  ...['veloq_tile_answer', 'veloq_tile_free', 'veloq_glyph_get_or_fetch', 'veloq_geo_get'].map(
    (name) => ({
      agree: `the iOS scheme handler's ${name} is a symbol Rust exports`,
      a: { file: `${TILE_IOS}/VeloqTileSchemeHandler.m`, has: `${name}(` },
      b: {
        file: 'modules/veloqrs/rust/veloqrs/src/basemap/c.rs',
        has: `pub unsafe extern "C" fn ${name}(`,
      },
    })
  ),
  {
    agree: 'the iOS scheme handler takes a tile answer in the shape Rust calls it with',
    a: {
      file: `${TILE_IOS}/VeloqTileSchemeHandler.m`,
      has: 'typedef void (*VeloqTileDone)(void *context, uint8_t *bytes, size_t len, uint16_t status);',
    },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/c.rs',
      has: /unsafe extern "C" fn\(context: \*mut c_void, bytes: \*mut u8, len: usize, status: u16\)/,
    },
  },
  {
    agree:
      'the Android tile bridge hands Rust the status array and pending body its JNI symbol takes',
    a: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: /nativeAnswer\(\s*String source, int z, int x, int y, int\[\] status, PendingTile pending\)/,
    },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs',
      has: /status: JIntArray<'local>,\s*pending: JObject<'local>,/,
    },
  },
  {
    agree: 'the Android tile bridge and Rust read the same status as a body still to come',
    a: { file: `${TILE_ANDROID}/TileBridge.java`, has: 'public static final int PENDING = 202;' },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs',
      has: 'const PENDING: u16 = 202;',
    },
  },
  {
    agree: 'Rust completes a pending tile through the method the body declares',
    a: {
      file: `${TILE_ANDROID}/PendingTile.java`,
      has: 'public synchronized void complete(byte[] tile)',
    },
    b: { file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs', has: /"complete",\s*"\(\[B\)V"/ },
  },
  {
    agree: 'Rust fails a pending tile through the method the body declares',
    a: {
      file: `${TILE_ANDROID}/PendingTile.java`,
      has: 'public synchronized void fail(int status)',
    },
    b: { file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs', has: /"fail",\s*"\(I\)V"/ },
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
    agree: 'the Android interceptor answers tiles through the bridge',
    a: {
      file: `${TILE_ANDROID}/VeloqTileWebViewClient.java`,
      has: 'new TileIntercept(TileBridge::answer)',
    },
    b: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: /public static byte\[\] answer\(\s*String source, int z, int x, int y, int\[\] status, PendingTile pending\)/,
    },
  },
  {
    agree: 'the Android geo bridge hands Rust the path and status array its JNI symbol takes',
    a: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: 'private static native byte[] nativeGeo(String path, int[] status);',
    },
    b: {
      file: 'modules/veloqrs/rust/veloqrs/src/basemap/jni.rs',
      has: /fn Java_com_veloq_TileBridge_nativeGeo<'local>\(\s*mut env: JNIEnv<'local>,\s*_class: JClass<'local>,\s*path: JString<'local>,\s*status: JIntArray<'local>,\s*\)/,
    },
  },
  {
    agree: 'the Android interceptor answers geo requests through the bridge',
    a: {
      file: `${TILE_ANDROID}/VeloqTileWebViewClient.java`,
      has: 'new GeoIntercept(TileBridge::geo)',
    },
    b: {
      file: `${TILE_ANDROID}/TileBridge.java`,
      has: 'public static byte[] geo(String path, int[] status)',
    },
  },
  {
    agree: 'the Android interceptor routes the geo marker the page asks under',
    a: { file: `${TILE_ANDROID}/MapRequestPath.java`, has: 'GEO_PATH = "/veloq-geo/";' },
    b: { file: 'src/features/maps/lib/tileTransport.ts', has: '}veloq-geo/${kind}/' },
  },
  {
    agree: 'the iOS handler routes the geo marker the page asks under',
    a: { file: `${TILE_IOS}/VeloqTileSchemeHandler.m`, has: 'GeoPath = @"/veloq-geo/";' },
    b: { file: 'src/features/maps/lib/tileTransport.ts', has: '}veloq-geo/${kind}/' },
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
    agree: 'the iOS accessibility module defines the Button Shapes read the button calls',
    a: {
      file: 'modules/veloq-accessibility/ios/VeloqAccessibilityModule.swift',
      has: 'Function("buttonShapes")',
    },
    b: { file: 'src/shared/ui/buttonShapes.ts', has: 'native?.buttonShapes()' },
  },
  {
    agree:
      'the Android accessibility module defines the same read, so it answers rather than throws',
    a: {
      file: 'modules/veloq-accessibility/android/src/main/java/com/veloq/accessibility/VeloqAccessibilityModule.kt',
      has: 'Function("buttonShapes")',
    },
    b: { file: 'src/shared/ui/buttonShapes.ts', has: 'native?.buttonShapes()' },
  },
  {
    agree: 'the iOS accessibility module sends the change event the button follows',
    a: {
      file: 'modules/veloq-accessibility/ios/VeloqAccessibilityModule.swift',
      has: 'sendEvent("onButtonShapesChange", ["enabled": enabled])',
    },
    b: { file: 'src/shared/ui/buttonShapes.ts', has: "addListener?.('onButtonShapesChange'" },
  },
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
      has: 'AsyncFunction("cancelQueuedActivityPushes")',
    },
    b: {
      file: 'src/features/insights/lib/activityPushJobs.ts',
      has: '?.cancelQueuedActivityPushes()',
    },
  },
  {
    agree: 'the Android wipe removes finished push records after cancellation',
    a: {
      file: `${TILE_ANDROID}/ActivityPushWorker.kt`,
      has: /cancelAllWorkByTag\(ActivityPushWorker::class\.java\.name\)\.result\.get\(\)[\s\S]*?pruneWork\(\)\.result\.get\(\)/,
    },
    b: {
      file: 'src/features/insights/lib/activityPushJobs.ts',
      has: 'await requireOptionalNativeModule<VeloqPushModule>',
    },
  },
  {
    agree: 'the library wipe waits for native push records to be removed',
    a: {
      file: 'src/features/insights/lib/activityPushJobs.ts',
      has: 'await requireOptionalNativeModule<VeloqPushModule>',
    },
    b: {
      file: 'src/shared/storage/gpsStorage.ts',
      has: 'await cancelQueuedActivityPushes()',
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
  {
    agree: 'the iOS widget module defines publishRecordShortcuts, which the bridge calls',
    a: {
      file: 'modules/veloq-widget/ios/VeloqWidgetModule.swift',
      has: 'Function("publishRecordShortcuts")',
    },
    b: { file: 'src/features/home/lib/widgetBridge.ts', has: 'publishRecordShortcuts?.(' },
  },
  {
    agree: 'autolinking registers the subscriber that opens a chosen quick action',
    a: {
      file: 'modules/veloq-widget/expo-module.config.json',
      has: '"VeloqQuickActionSubscriber"',
    },
    b: {
      file: 'modules/veloq-widget/ios/VeloqQuickActionSubscriber.swift',
      has: 'class VeloqQuickActionSubscriber: ExpoAppDelegateSubscriber',
    },
  },
  ...[
    'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
    'modules/veloq-widget/ios/RecordQuickActions.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} reads the glyph the shortcut list carries`,
    a: { file, has: 'entry["glyph"]' },
    b: {
      file: 'src/features/home/lib/widgetSnapshot.ts',
      has: 'glyph: getActivityCategory(type).toLowerCase()',
    },
  })),
  ...SPORT_FAMILY_ORDER.filter((family) => family !== 'Other').flatMap((family) => {
    const key = family.toLowerCase();
    const engine = {
      file: 'modules/veloqrs/rust/veloqrs/src/sport.rs',
      has: `("${family}", FAMILY_${family.toUpperCase()})`,
    };
    return [
      {
        agree: `the Android launcher draws its own glyph for the ${key} family`,
        a: {
          file: 'modules/veloq-widget/android/src/main/java/com/veloq/widget/RecordShortcutIcons.kt',
          has: `"${key}" -> R.drawable.shortcut_glyph_`,
        },
        b: engine,
      },
      {
        agree: `the iOS quick actions draw their own symbol for the ${key} family`,
        a: { file: 'modules/veloq-widget/ios/RecordQuickActions.swift', has: `case "${key}":` },
        b: engine,
      },
    ];
  }),
  ...[
    'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
    'modules/veloq-widget/ios/VeloqWidgetModule.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} defines clearSnapshot, which the wipe calls through the bridge`,
    a: { file, has: 'Function("clearSnapshot")' },
    b: { file: 'src/features/home/lib/widgetBridge.ts', has: 'VeloqWidget.clearSnapshot()' },
  })),
  ...['startIndoorService', 'stopIndoorService'].map((name) => ({
    agree: `the recording notification module defines ${name}, which the bridge calls`,
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: `Function("${name}")`,
    },
    b: {
      file: 'src/features/recording/lib/recordingNotification.ts',
      has: `VeloqRecordingNotification.${name}(`,
    },
  })),
  {
    agree: 'the indoor service is declared with the foreground type it starts with',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/AndroidManifest.xml',
      has: /android:name="\.IndoorRecordingService"[\s\S]*?android:foregroundServiceType="connectedDevice"/,
    },
    b: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/IndoorRecordingService.kt',
      has: 'ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE',
    },
  },
  {
    agree: 'the app holds the permission the indoor service type needs to start',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/AndroidManifest.xml',
      has: 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
    },
    b: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/IndoorRecordingService.kt',
      has: 'ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE',
    },
  },
  {
    agree:
      'iOS keeps delivering sensor notifications to a suspended app, which samples an indoor ride from them',
    a: { file: 'app.json', has: '"bluetooth-central"' },
    b: { file: 'src/features/recording/lib/recordingSession.ts', has: 'sampleFromSensor()' },
  },
  ...['serviceRunning', 'clear', 'clearInterrupted', 'batteryOptimisationExempt'].map((name) => ({
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
  {
    agree: 'the recording notification module defines nameChannel, which the bridge calls',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: 'Function("nameChannel")',
    },
    b: {
      file: 'src/features/recording/lib/recordingNotification.ts',
      has: 'VeloqRecordingNotification?.nameChannel(',
    },
  },
  // The recording channel is named only because it is created first under the
  // id the location service posts on, and the service leaves an existing one.
  {
    agree: 'the recording channel takes the id expo-location gives its service channel',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/RecordingChannel.kt',
      has: '"$packageName:$LOCATION_TASK_NAME"',
    },
    b: {
      file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
      has: 'mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")',
    },
  },
  {
    agree: 'the app scope key in the channel id is the package name',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: 'RecordingChannel.spec(context.packageName,',
    },
    b: {
      file: 'node_modules/expo-constants/android/src/main/java/expo/modules/constants/ConstantsService.kt',
      has: /appScopeKey: String\?\s*get\(\) = context\.packageName/,
    },
  },
  {
    agree: 'the recording channel names the task the app registers',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/RecordingChannel.kt',
      has: 'LOCATION_TASK_NAME = "veloq-background-location"',
    },
    b: {
      file: 'src/features/recording/lib/backgroundLocationTask.ts',
      has: "BACKGROUND_LOCATION_TASK = 'veloq-background-location'",
    },
  },
  {
    agree: 'expo-location keeps a service channel that already exists',
    a: {
      file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
      has: /var channel = notificationManager\.getNotificationChannel\(id\)\s*if \(channel == null\)/,
    },
    b: {
      file: 'src/features/recording/lib/backgroundLocation.ts',
      has: /nameRecordingChannel\(\);\s*await Location\.startLocationUpdatesAsync/,
    },
  },
  {
    agree: 'the iOS backup module defines bookmarkFolder, which the backup folder bridge calls',
    a: {
      file: 'modules/veloq-backup-exclusion/ios/VeloqBackupExclusionModule.swift',
      has: 'Function("bookmarkFolder")',
    },
    b: { file: 'src/shared/native/backupFolder.ts', has: 'nativeModule().bookmarkFolder(' },
  },
  // A coordinated copy or listing in a cloud folder waits for the download, so
  // it runs off the JavaScript thread and the bridge awaits it.
  ...['writeToBookmarkedFolder', 'listBookmarkedFolder', 'readFromBookmarkedFolder'].map(
    (name) => ({
      agree: `the iOS backup module runs ${name} off the JavaScript thread, and the bridge awaits it`,
      a: {
        file: 'modules/veloq-backup-exclusion/ios/VeloqBackupExclusionModule.swift',
        has: `AsyncFunction("${name}")`,
      },
      b: { file: 'src/shared/native/backupFolder.ts', has: `await nativeModule().${name}(` },
    })
  ),
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
    agree: 'the Android backup module defines authorizeGoogleDrive, which the Drive bridge calls',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'AsyncFunction("authorizeGoogleDrive")',
    },
    b: { file: 'src/shared/native/googleDrive.ts', has: 'mod.authorizeGoogleDrive(' },
  },
  {
    agree: 'the Android backup module defines clearGoogleDriveToken, which the Drive bridge calls',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'AsyncFunction("clearGoogleDriveToken")',
    },
    b: { file: 'src/shared/native/googleDrive.ts', has: '?.clearGoogleDriveToken(' },
  },
  ...['ERR_GOOGLE_SIGN_IN_NEEDED', 'ERR_GOOGLE_SIGN_IN_CANCELLED'].map((code) => ({
    agree: `a Google Drive refusal crosses as ${code}, the code the bridge reads`,
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/GoogleDriveAuthorization.kt',
      has: `"${code}"`,
    },
    b: { file: 'src/shared/native/googleDrive.ts', has: `'${code}'` },
  })),
  {
    agree: 'the Android backup module defines getAutoBackupStatus, which the device row reads',
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: 'Function("getAutoBackupStatus")',
    },
    b: { file: 'src/shared/native/androidAutoBackup.ts', has: 'mod.getAutoBackupStatus()' },
  },
  ...[
    'backedUpAt',
    'backedUpBytes',
    'quotaExceededAt',
    'quotaExceededBytes',
    'quotaBytes',
    'restoredAt',
  ].map((field) => ({
    agree: `the Auto Backup record crosses with ${field}, which the bridge reads`,
    a: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupExclusionModule.kt',
      has: `"${field}" to status.${field}`,
    },
    b: { file: 'src/shared/native/androidAutoBackup.ts', has: `${field}: number | null;` },
  })),
  {
    agree: 'the manifest names the backup agent class the backup module defines',
    a: {
      file: 'src/plugins/with-android-backup.js',
      has: 'const BACKUP_AGENT = "com.veloq.backupexclusion.VeloqBackupAgent";',
    },
    b: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/VeloqBackupAgent.kt',
      has: /^package com\.veloq\.backupexclusion\s[\s\S]*class VeloqBackupAgent : BackupAgent\(\)/m,
    },
  },
  {
    agree: 'the agent sizes the record zip the backup rules carry',
    a: {
      file: 'src/plugins/with-android-backup.js',
      has: '<include domain="file" path="veloq-decisions.zip" />',
    },
    b: {
      file: 'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/AutoBackupLedger.kt',
      has: 'const val RECORD_ZIP = "veloq-decisions.zip"',
    },
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
  ...['channel', 'title', 'body'].map((key) => ({
    agree: `the interrupted-ride notice reads its ${key} from the payload the bridge writes`,
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      has: `interrupted?.optString("${key}")`,
    },
    b: {
      file: 'src/features/recording/lib/recordingNotification.ts',
      has: `'recording.interruptedNotice.${key}'`,
    },
  })),
  {
    agree: 'the Live Activity module hands ActivityKit the stale date the state carries',
    a: {
      file: 'modules/veloq-live-activity/ios/VeloqLiveActivityModule.swift',
      has: /staleDate: state\.staleDate[\s\S]*staleDate: state\.staleDate/,
      lacks: 'staleDate: nil',
    },
    b: {
      file: 'widget/ios/VeloqWidget/RecordingActivityAttributes.swift',
      has: 'var staleDate: Date?',
    },
  },
  {
    agree: 'the stale card shows the stopped line the controller translates',
    a: { file: 'widget/ios/VeloqWidget/RecordingLiveActivity.swift', has: 'stoppedLabel' },
    b: {
      file: 'src/features/recording/lib/liveActivity/controller.ts',
      has: "'recording.interruptedNotice.card'",
    },
  },
  {
    agree: 'autolinking finds the package that posts the interrupted-ride notice at process start',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationPackage.kt',
      has: 'import expo.modules.core.interfaces.Package',
    },
    b: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationPackage.kt',
      has: 'class VeloqRecordingNotificationPackage : Package',
    },
  },
  {
    agree: 'the running-service check names the service expo-location starts',
    a: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/LiveRide.kt',
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
    agree: 'the Android widgets read the snapshot file its one writer names',
    a: { file: `${TILE_ANDROID}/WidgetSnapshotFile.kt`, has: 'NAME = "widget-snapshot.json"' },
    b: {
      file: 'widget/android/java/WidgetSnapshot.kt',
      has: 'WidgetSnapshotFile.file(context.filesDir)',
      lacks: '"widget-snapshot.json"',
    },
  },
  {
    agree: 'the app writes and clears the snapshot through the writer the push worker uses',
    a: { file: `${TILE_ANDROID}/WidgetSnapshotFile.kt`, has: 'fun clear(dir: File)' },
    b: {
      file: 'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
      has: /WidgetSnapshotFile\.write\(context, json\)[\s\S]*WidgetSnapshotFile\.clear\(context\)/,
      lacks: '"widget-snapshot.json"',
    },
  },
  {
    agree: 'the Android widgets fall back to the picker link the snapshot names',
    a: { file: 'widget/android/java/WidgetRenderer.kt', has: `"${RECORD_PICKER_URL}"` },
    b: { file: 'src/features/home/lib/widgetSnapshot.ts', has: `'${RECORD_PICKER_URL}'` },
  },
  {
    agree: 'the Quick Settings tile opens a live ride where the ride notification does',
    a: { file: 'widget/android/java/RecordTile.kt', has: 'LIVE_URL = "veloq://record"' },
    b: {
      file: 'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/RideLink.kt',
      has: 'RECORD_URL = "veloq://record"',
    },
  },
  {
    agree: 'the small Android widget binds the snapshot age into a view its layout declares',
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: /private fun renderSmall[\s\S]*?bindUpdatedAt\(\w+, v, R\.id\.small_updated, snap\)/,
    },
    b: { file: 'widget/android/res/layout/widget_small.xml', has: '@+id/small_updated' },
  },
  {
    agree: 'the small iOS widget shows the snapshot age under the sparkline',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetViews.swift',
      has: /case \.small:[\s\S]*?SummaryChartView[\s\S]*?SnapshotAgeLine\(snapshot: snapshot[\s\S]*?case \.medium, \.large:/,
    },
    b: { file: 'widget/ios/VeloqWidget/WidgetViews.swift', has: 'struct SnapshotAgeLine' },
  },
  {
    agree:
      'the iOS Summary widget draws no latest activity or impact, which belong to the Last activity widget',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetViews.swift',
      has: 'struct SummaryWidgetView',
      lacks: /\.latest\b|\.impact\b|LatestBlock|ImpactView/,
    },
    b: { file: 'widget/ios/VeloqWidget/WidgetLatestActivity.swift', has: 'snapshot?.latest' },
  },
  {
    agree: 'a tap on the iOS Summary widget goes to the Fitness tab route',
    a: { file: 'widget/ios/VeloqWidget/SummaryWidgetModel.swift', has: '"veloq://fitness"' },
    b: { file: 'src/app/(tabs)/fitness/index.tsx' },
  },
  {
    agree: 'the iOS Summary widget decodes the metric list the engine writes for a placement',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let summaryMetrics: [WidgetSummaryEntry]?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub summary_metrics: Vec<SummaryEntry>' },
  },
  {
    agree: 'the iOS Summary widget decodes the six weeks of form the engine writes for Large',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let formHistory: WidgetFormHistory?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub form_history: Option<FormHistory>' },
  },
  {
    agree: 'the iOS Insights widget decodes the insight rows the engine writes',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let insights: [WidgetInsight]?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub insights: Vec<WidgetInsight>' },
  },
  {
    agree: 'the Android Insights widget reads the insight rows the engine writes',
    a: { file: 'widget/android/java/WidgetSnapshot.kt', has: 'root.optJSONArray("insights")' },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub insights: Vec<WidgetInsight>' },
  },
  {
    agree:
      'the iOS Last activity widget decodes the headline the engine writes for the latest activity',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let headline: WidgetHeadline?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub headline: Option<Headline>' },
  },
  {
    agree:
      'the Android Last activity widget reads the headline the engine writes for the latest activity',
    a: { file: 'widget/android/java/WidgetSnapshot.kt', has: 'latest.optJSONObject("headline")' },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub headline: Option<Headline>' },
  },
  {
    agree: 'the iOS Last activity widget decodes the load and section lines the engine words',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: /let loadText: String\?[\s\S]*let sectionPrsText: String\?/,
    },
    b: {
      file: `${RUST}/widget_snapshot.rs`,
      has: /pub load_text: Option<String>,[\s\S]*pub section_prs_text: Option<String>/,
    },
  },
  ...['veloq_widget_refresh(', 'veloq_push_string_free('].map((name) => ({
    agree: `the background refresh's ${name.slice(0, -1)} is a symbol Rust exports`,
    a: { file: 'modules/veloq-widget/ios/VeloqWidgetRefreshEngine.h', has: name },
    b: {
      file: `${PUSH_RS}/c.rs`,
      has: new RegExp(`pub (unsafe )?extern "C" fn ${name.slice(0, -1)}\\(`),
    },
  })),
  ...[
    'modules/veloq-widget/ios/VeloqWidgetRefreshEngine.h',
    'modules/veloq-app-group/ios/VeloqEngineSuspension.h',
  ].flatMap((header) =>
    [
      'veloq_engine_entered_background(',
      'veloq_engine_prepare_for_suspension(',
      'veloq_engine_resume_after_suspension(',
    ].map((name) => ({
      agree: `${path.basename(header)} declares ${name.slice(0, -1)}, a symbol Rust exports`,
      a: { file: header, has: name },
      b: {
        file: `${RUST}/persistence/suspension.rs`,
        has: new RegExp(`pub extern "C" fn ${name.slice(0, -1)}\\(`),
      },
    }))
  ),
  {
    agree: 'the pod registers the subscriber that reports the background to the engine',
    a: {
      file: 'modules/veloq-app-group/expo-module.config.json',
      has: '"appDelegateSubscribers": ["VeloqEngineSuspensionSubscriber"]',
    },
    b: {
      file: 'modules/veloq-app-group/ios/VeloqEngineSuspensionSubscriber.swift',
      has: 'public final class VeloqEngineSuspensionSubscriber: ExpoAppDelegateSubscriber',
    },
  },
  ...['beginBackgroundTask', 'endBackgroundTask'].map((name) => ({
    agree: `the App Group module defines the ${name} the app calls`,
    a: { file: 'src/shared/native/appGroup.ts', has: `mod?.${name}` },
    b: {
      file: 'modules/veloq-app-group/ios/VeloqAppGroupModule.swift',
      has: `Function("${name}")`,
    },
  })),
  {
    agree: 'the App Group module defines the prepareEngineForSuspension the app calls',
    a: { file: 'src/shared/native/appGroup.ts', has: 'mod?.prepareEngineForSuspension' },
    b: {
      file: 'modules/veloq-app-group/ios/VeloqAppGroupModule.swift',
      has: 'AsyncFunction("prepareEngineForSuspension")',
    },
  },
  ...[
    'modules/veloq-debug-crash/ios/VeloqDebugCrashModule.swift',
    'modules/veloq-debug-crash/android/src/main/java/com/veloq/debugcrash/VeloqDebugCrashModule.kt',
  ].flatMap((file) => [
    {
      agree: `the forced render crash reads the module ${file} registers`,
      a: { file: 'src/shared/debug/forcedRenderCrash.tsx', has: "'VeloqDebugCrash'" },
      b: { file, has: 'Name("VeloqDebugCrash")' },
    },
    {
      agree: `the forced render crash calls the takeRequest ${file} defines`,
      a: { file: 'src/shared/debug/forcedRenderCrash.tsx', has: '?.takeRequest()' },
      b: { file, has: 'Function("takeRequest")' },
    },
  ]),
  {
    agree: 'the task identifier the refresh submits is one the Info.plist permits',
    a: { file: 'app.json', has: '"$(PRODUCT_BUNDLE_IDENTIFIER).widget-refresh"' },
    b: { file: 'modules/veloq-widget/ios/VeloqWidgetRefresh.swift', has: '".widget-refresh"' },
  },
  {
    agree: 'the pod registers the subscriber that registers the task before launch finishes',
    a: {
      file: 'modules/veloq-widget/expo-module.config.json',
      has: /"appDelegateSubscribers": \[[^\]]*"VeloqWidgetRefreshSubscriber"/,
    },
    b: {
      file: 'modules/veloq-widget/ios/VeloqWidgetRefresh.swift',
      has: 'public final class VeloqWidgetRefreshSubscriber: ExpoAppDelegateSubscriber',
    },
  },
  {
    agree: 'the widget decodes the sync time Rust marks a refreshed snapshot with',
    a: { file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift', has: 'let dataAsOf: Double?' },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub data_as_of: Option<i64>' },
  },
  {
    agree: 'the widget decodes the words Rust marks a refreshed snapshot with',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let dataAsOfLabel: String?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub data_as_of_label: Option<String>' },
  },
  {
    agree: 'the widget decodes the label Rust marks a sample library snapshot with',
    a: {
      file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      has: 'let demoLabel: String?',
    },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub demo_label: Option<String>' },
  },
  {
    agree: 'the Android widget reads the label Rust marks a sample library snapshot with',
    a: { file: 'widget/android/java/WidgetSnapshot.kt', has: 'optText(display, "demoLabel")' },
    b: { file: `${RUST}/widget_snapshot.rs`, has: 'pub demo_label: Option<String>' },
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
  ...[0, 1, 2, 3].map((i) => ({
    agree: `the Summary renderer binds supporting cell ${i} that the shared row layout declares`,
    a: {
      file: 'widget/android/java/WidgetRenderer.kt',
      has: `R.id.sum_cell${i}_value`,
    },
    b: {
      file: 'widget/android/res/layout/widget_summary_cells.xml',
      has: `android:id="@+id/sum_cell${i}_value"`,
    },
  })),
  ...['small', 'medium', 'large'].map((size) => ({
    agree: `the Summary renderer opens Fitness from the root the ${size} layout declares, which has no activity or impact view`,
    a: { file: 'widget/android/java/WidgetRenderer.kt', has: 'android.R.id.background' },
    b: {
      file: `widget/android/res/layout/widget_${size}.xml`,
      has: 'android:id="@android:id/background"',
      // The latest activity and its impact belong to the Last activity widget.
      lacks: /@\+id\/\w*(?:activity|impact)\w*/,
    },
  })),
  {
    agree: 'a tap on the Summary widget goes to the Fitness tab route',
    a: { file: 'widget/android/java/WidgetRenderer.kt', has: 'FITNESS_URL = "veloq://fitness"' },
    b: { file: 'src/app/(tabs)/fitness/index.tsx' },
  },
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
  // OpenURLIntent opens universal links only, and the record links are on the
  // app's own scheme: an intent that returned one brought Veloq forward and
  // dropped the link, so the Control and Siri landed on the Feed.
  ...[
    'widget/ios/shared/VeloqAppShortcuts.swift',
    'widget/ios/shared/StartRecordingIntent.swift',
    'widget/ios/VeloqWidget/RecordControl.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} hands the record link to the app rather than to OpenURLIntent`,
    a: { file, lacks: 'OpenURLIntent(' },
    b: { file: 'widget/ios/shared/RecordDeepLink.swift' },
  })),
  {
    agree: 'the app opens the record link itself, so it lands where a widget tap does',
    a: {
      file: 'widget/ios/shared/VeloqAppShortcuts.swift',
      has: /enum RecordLinkOpener[\s\S]*await UIApplication\.shared\.open\(url\)/,
    },
    b: {
      file: 'widget/ios/shared/StartRecordingIntent.swift',
      has: 'RecordLinkOpener.open(',
    },
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
    'modules/veloq-widget/ios/WidgetSnapshotFile.swift',
  ].map((file) => ({
    agree: `${path.basename(file)} reads the App Group the plugin entitles`,
    a: { file, has: `"${APP_GROUP}"` },
    b: { file: 'src/plugins/with-app-groups.js', has: `"${APP_GROUP}"` },
  })),
  {
    agree: 'the widget reads the snapshot file the app module writes',
    a: { file: 'widget/ios/VeloqWidget/WidgetSnapshotModel.swift', has: '"widget-snapshot.json"' },
    b: { file: 'modules/veloq-widget/ios/WidgetSnapshotFile.swift', has: '"widget-snapshot.json"' },
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
  const keys = [...rust.matchAll(/(?:translate|phrase|fill)\(\s*ctx,\s*"([\w.]+)"/g)].map(
    (m) => m[1]
  );
  const zones = [...rust.matchAll(/^\s*"(highRisk|optimal|greyZone|fresh|transition)"/gm)];
  // A counted phrase is looked up in every plural form any locale gives the count.
  const counted = [...rust.matchAll(/counted\(\s*ctx,\s*"([\w.]+)"/g)].flatMap((m) =>
    ['one', 'few', 'many', 'other'].map((form) => `${m[1]}_${form}`)
  );
  // The composer names a muscle under its slug camel-cased, `lower-back` as `lowerBack`.
  const muscles = muscleSlugsInRust().map(
    (slug) => `strength.muscles.${slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`
  );
  return [...keys, ...zones.map((m) => `formZones.${m[1]}`), ...counted, ...muscles];
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
    /(?:\bText|\bLabel|\bNSLocalizedString|\.configurationDisplayName|\.description|\.displayName|IntentDescription|\b(?:title|name|shortTitle):|LocalizedStringResource =)\s*\(?\s*"((?:[^"\\]|\\.)*)"/g;
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

/** The kinds the Android Insights widget offers. */
function androidInsightKinds(): string[] {
  const block = /val KINDS =\s*listOf\(([^)]*)\)/.exec(
    read('widget/android/java/InsightsWidgetModel.kt')
  );
  return [...(block?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The kinds the iOS Insights widget offers: its model's list, and the picker's cases. */
function iosInsightKinds(): { model: string[]; picker: string[] } {
  const model = /static let kinds = \[([^\]]*)\]/.exec(
    read('widget/ios/VeloqWidget/InsightsWidgetModel.swift')
  );
  return {
    model: [...(model?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
    picker: [
      ...read('widget/ios/VeloqWidget/WidgetInsightsIntent.swift').matchAll(
        /^\s*case \w+ = "([a-z_]+)"/gm
      ),
    ].map((m) => m[1]),
  };
}

/** The strength windows the engine writes, by their snapshot keys. */
function engineStrengthWindows(): string[] {
  const block = /pub struct StrengthWindows \{([^}]*)\}/.exec(
    read('modules/veloqrs/rust/veloqrs/src/widget_snapshot.rs')
  );
  return [...(block?.[1] ?? '').matchAll(/pub (\w+):/g)].map((m) => m[1]);
}

/** The strength windows the iOS widget reads, in its model and in its Edit Widget picker. */
function iosStrengthWindows(): { model: string[]; picker: string[] } {
  const cases = (file: string, type: string) => {
    const block = new RegExp(`enum ${type}: String[^{]*\\{([^}]*)`).exec(
      read(`widget/ios/VeloqWidget/${file}`)
    );
    return [...(block?.[1] ?? '').matchAll(/^\s*case (\w+)$/gm)].map((m) => m[1]);
  };
  return {
    model: cases('StrengthWidgetModel.swift', 'StrengthWindowChoice'),
    picker: cases('WidgetStrengthIntent.swift', 'StrengthPeriod'),
  };
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
  const app: { receiver: { $: Record<string, string> }[] } = { receiver: [] };
  androidWidgetPlugin.applyReceivers(app);
  const manifest = app.receiver.flatMap((r) =>
    (r.$['android:label'] ?? '').startsWith('@string/')
      ? [r.$['android:label'].replace('@string/', '')]
      : []
  );
  return [...widget, ...poster, ...manifest].filter((name) => name !== 'app_name');
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

/** The members of a generated string enum, such as an enum's tags, as `A=A`. */
function generatedStringEnum(name: string): string[] {
  const block = read(GENERATED).match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`the generated binding declares no enum ${name}`);
  return [...block[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)",?$/gm)].map(
    (m) => `${m[1]}=${m[2]}`
  );
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
  const detection = read(`${RUST}/persistence/sections/detection.rs`);
  const cancelled = detection.match(/const PHASE_CANCELLED: &str = "(\w+)"/);
  if (cancelled && detection.includes('set_phase(PHASE_CANCELLED')) found.add(cancelled[1]);
  const cutover = read(`${RUST}/persistence/cutover.rs`);
  const cutoverConstants = new Map(
    [...cutover.matchAll(/pub const (PHASE_\w+): &str = "(\w+)"/g)].map((match) => [
      match[1],
      match[2],
    ])
  );
  for (const match of cutover.matchAll(/clock\.enter\((PHASE_\w+)\)/g)) {
    const phase = cutoverConstants.get(match[1]);
    if (phase) found.add(phase);
  }
  // Refusals, not positions in a run. The screen drops progress on them.
  for (const refusal of ['aborted', 'suspended', 'cutover_owed']) found.delete(refusal);
  return [...found];
}

it.each(SUPPORTED_LOCALES)('names every engine phase in %s', (locale) => {
  const bundle = resolvedLocale(locale);
  for (const phase of announcedPhases()) {
    const key = PHASE_DISPLAY_KEYS[phase as keyof typeof PHASE_DISPLAY_KEYS];
    expect(key).toBeDefined();
    if (key)
      expect(bundle.phaseNames[key.split('.')[1] as keyof typeof bundle.phaseNames]).toEqual(
        expect.any(String)
      );
  }
});

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
    b: () => javaTypeTable(read(`${TILE_ANDROID}/TileIntercept.java`)),
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
    agree: 'Edit Widget offers each metric the engine writes an entry for, in the picker’s order',
    mode: 'equal',
    atLeast: 10,
    a: () => {
      const swift = read('widget/ios/VeloqWidget/WidgetMetricIntent.swift');
      const body = /enum SummaryMetric: String, AppEnum \{([^}]*)\}/.exec(swift)?.[1] ?? '';
      return [...body.matchAll(/^\s*case (\w+)/gm)].map((m) => m[1]);
    },
    b: () => {
      const rust = read(`${RUST}/widget_snapshot.rs`);
      const body = /const SUMMARY_METRIC_IDS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)?.[1] ?? '';
      return [...body.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    },
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
    agree: 'every text the push extension Swift localises is a key of its generated catalogue',
    mode: 'equal',
    atLeast: 1,
    a: () =>
      walk(path.join(ROOT, PUSH), '.swift').flatMap((file) =>
        [
          ...fs.readFileSync(file, 'utf8').matchAll(/String\(localized:\s*"((?:[^"\\]|\\.)*)"/g),
        ].map((m) => m[1])
      ),
    b: () => nativeStrings.PUSH_EXTENSION_STRINGS.map((entry: { key: string }) => entry.key),
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
    agree: 'the kinds the Android Insights widget offers are the categories the app ranks',
    mode: 'equal',
    atLeast: 11,
    a: androidInsightKinds,
    b: insightCategories,
  },
  {
    agree: 'the kinds the iOS Insights widget filters on are the categories the app ranks',
    mode: 'equal',
    atLeast: 11,
    a: () => iosInsightKinds().model,
    b: insightCategories,
  },
  {
    agree:
      'the kinds the iOS Insights widget offers in Edit Widget are the categories the app ranks',
    mode: 'equal',
    atLeast: 11,
    a: () => iosInsightKinds().picker,
    b: insightCategories,
  },
  {
    agree: 'the windows the iOS Strength widget reads are the windows the engine writes',
    mode: 'equal',
    atLeast: 2,
    a: () => iosStrengthWindows().model,
    b: engineStrengthWindows,
  },
  {
    agree: 'the periods the iOS Strength widget offers in Edit Widget are the windows it reads',
    mode: 'equal',
    atLeast: 2,
    a: () => iosStrengthWindows().picker,
    b: () => iosStrengthWindows().model,
  },
  {
    agree: 'every category the app ranks has a name in the Android Insights picker',
    mode: 'within',
    atLeast: 11,
    a: () => insightCategories().map((kind) => `widget_insight_kind_${kind}`),
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
    b: () => Object.keys(PHASE_DISPLAY_KEYS),
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
  ...(
    [
      ['FfiReferenceSource', stub.FfiReferenceSource],
      ['FfiPlannedCategory', stub.FfiPlannedCategory],
      ['FfiPlanTarget', stub.FfiPlanTarget],
      ['FfiPlanLineKind', stub.FfiPlanLineKind],
      ['FfiTargetMetric', stub.FfiTargetMetric],
      ['FfiAbsoluteUnits', stub.FfiAbsoluteUnits],
    ] as const
  ).map(
    ([name, value]): SetContract => ({
      agree: `the binding stub carries ${name}, declared without discriminants, in the generated order`,
      mode: 'equal',
      a: () => enumMembers(value as unknown as Record<string, unknown>),
      // An undeclared discriminant is the member's position.
      b: () => generatedEnum(name).map((member, i) => member.replace('=unset', `=${i}`)),
    })
  ),
  ...(
    [
      ['FfiCallKind', stub.CallKind],
      ['FfiUploadOutcome', stub.UploadOutcome],
      ['FfiPlaceNameKind', stub.PlaceNameKind],
      ['FfiPlaceNameOutcome', stub.PlaceNameOutcome],
      ['SyncState', stub.SyncState],
      ['RangeCoverage', stub.RangeCoverage],
      ['FfiSyncErrorReason', stub.SyncErrorReason],
      ['FfiSyncStep', stub.SyncStep],
      ['FfiTrackStep', stub.TrackStep],
      ['BulkExportFormat', stub.BulkExportFormat],
      ['FfiStartOutcome', stub.StartOutcome],
      ['FfiInitOutcome', stub.InitOutcome],
      ['FfiPoolSwimState', stub.PoolSwimState],
      ['FfiPoolUnit', stub.PoolUnit],
    ] as const
  ).map(
    ([name, value]): SetContract => ({
      agree: `the binding stub carries ${name} as the generated binding declares it`,
      mode: 'equal',
      a: () => enumMembers(value as unknown as Record<string, unknown>),
      b: () => generatedEnum(name),
    })
  ),
  ...(
    [
      ['FfiCatalogueEmptyReason_Tags', stub.FfiCatalogueEmptyReason_Tags],
      ['FfiDetectionHold_Tags', stub.FfiDetectionHold_Tags],
      ['FfiMapEmptyReason_Tags', stub.FfiMapEmptyReason_Tags],
    ] as const
  ).map(
    ([name, value]): SetContract => ({
      agree: `the binding stub carries ${name} as the generated binding declares it`,
      mode: 'equal',
      atLeast: 4,
      a: () => Object.entries(value).map(([key, member]) => `${key}=${member}`),
      b: () => generatedStringEnum(name),
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

// The summary card's picker owns its choices. The engine writes them into the widget snapshot,
// which the Android picker reads, and Edit Widget declares them as enums, so a widget never
// offers a hero or a metric the card does not, and lists them in the card's order.
describe("the Summary widget offers the summary card's own choices, in its order", () => {
  const rustList = (name: string) => {
    const body =
      new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`).exec(
        read(`${RUST}/widget_snapshot.rs`)
      )?.[1] ?? '';
    return [...body.matchAll(/"(\w+)"/g)].map((m) => m[1]);
  };
  const swiftCases = (name: string) => {
    const body =
      new RegExp(`enum ${name}: String, AppEnum \\{([^}]*)\\}`).exec(
        read('widget/ios/VeloqWidget/WidgetMetricIntent.swift')
      )?.[1] ?? '';
    return [...body.matchAll(/^\s*case (\w+)/gm)].map((m) => m[1]);
  };

  it("the engine writes the card's hero list", () => {
    expect(rustList('SUMMARY_HERO_IDS')).toEqual([...HERO_METRICS]);
  });

  it('the engine writes an entry for every metric the card offers', () => {
    expect(rustList('SUMMARY_METRIC_IDS')).toEqual(AVAILABLE_METRICS.map((m) => m.id));
  });

  it("Edit Widget offers the card itself, then the card's heroes", () => {
    expect(swiftCases('WidgetMetric')).toEqual(['summary', ...HERO_METRICS]);
  });
});

describe('the light heatmap paint agrees with the contrast test that gates it', () => {
  const tiles = read(`${RUST}/tiles.rs`);
  const constant = (name: string) => {
    const match = tiles.match(new RegExp(`const ${name}: f32 = (-?[0-9.]+);`));
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };

  it.each([
    ['LIGHT_RASTER_OPACITY', 'raster-opacity'],
    ['LIGHT_BRIGHTNESS_MIN', 'raster-brightness-min'],
    ['LIGHT_BRIGHTNESS_MAX', 'raster-brightness-max'],
    ['LIGHT_HUE_ROTATE_DEGREES', 'raster-hue-rotate'],
  ])('%s is the %s of the regional heatmap layer', (name, property) => {
    const layer = buildRegionalLayers({
      palette: mapPalette('light'),
      heatmapEnabled: true,
      showHeatmap: true,
      hasSpider: false,
      showActivities: true,
      selectedActivityId: null,
      selectedSectionId: null,
      routeColor: '#FF6B35',
    } as unknown as Parameters<typeof buildRegionalLayers>[0]).find(
      (l) => l.id === 'heatmap-layer'
    );
    expect(layer?.paint?.[property]).toBe(constant(name));
  });
});

// The layers menu keys the heatmap with the ramp the engine paints its tiles in.
it('keys the heatmap in the colour stops the engine paints its tiles with', () => {
  const lut = read(`${RUST}/heatmap_ramp.rs`).match(/const HEATMAP_STOPS[^=]*= &\[([\s\S]*?)\];/);
  expect(lut).not.toBeNull();
  const stops = [...(lut?.[1] ?? '').replace(/\/\/.*$/gm, '').matchAll(/\(([^)]*)\)/g)]
    .map((match) => match[1].split(',').map(Number))
    .filter(([intensity]) => intensity > 0)
    .map(([intensity, r, g, b, a]) => ({ intensity, rgba: [r, g, b, a] }));
  expect(stops.length).toBeGreaterThan(2);
  expect(HEATMAP_TILE_STOPS).toEqual(stops);
});

describe('the widget palette agrees with the committed Android resources', () => {
  const resource = (dir: string) => read(`widget/android/res/${dir}/widget_theme.xml`);

  // The zone fills are the form chart's bands and the key dot beside a form value, whose text is
  // primary, so the renderer reads them by resource name.
  const ZONE_RESOURCES = [
    ['widget_form_high_risk', 'formHighRisk'],
    ['widget_form_optimal', 'formOptimal'],
    ['widget_form_grey_zone', 'formGreyZone'],
    ['widget_form_fresh', 'formFresh'],
    ['widget_form_transition', 'formTransition'],
  ] as const;

  it.each(ZONE_RESOURCES)('values/%s matches the light palette', (name, key) => {
    expect(resource('values')).toContain(
      `<color name="${name}">${widgetPalette.light[key]}</color>`
    );
  });

  it.each(ZONE_RESOURCES)('values-night/%s matches the dark palette', (name, key) => {
    expect(resource('values-night')).toContain(
      `<color name="${name}">${widgetPalette.dark[key]}</color>`
    );
  });
});

// A basemap clear walks and deletes every file under the tile root, so on the
// JS thread it freezes whatever awaits it, a sign-out's wipe spinner among them.
describe('every basemap clear runs off the JS thread', () => {
  const declared = () => {
    const source = read(GENERATED);
    const start = source.indexOf('export interface BasemapManagerLike {');
    const body = source.slice(start, source.indexOf('\n}', start));
    return new Map(
      [...body.matchAll(/^ {2}(clear\w*Tiles)\(([\s\S]*?)\n?\s*\)[^:\n]*:\s*([^;]+);/gm)].map(
        (m) => [m[1], m[3].trim()]
      )
    );
  };

  it.each(['clearTiles', 'clearSourceTiles', 'clearUnpinnedTiles'])(
    '%s returns a Promise',
    (name) => {
      expect(declared().get(name)).toMatch(/^Promise</);
    }
  );
});

describe('the renderer every map page asks for is the one both platforms ship', () => {
  // Android packages `modules/veloqrs/assets` as its assets, and the podspec
  // copies `assets/basemap` into the iOS resource bundle, so one file feeds both.
  const BASEMAP = 'modules/veloqrs/assets/basemap';
  const directory = MAPLIBRE_GL_JS_FILE.split('/')[0];

  it.each([
    [MAPLIBRE_GL_JS_FILE, MAPLIBRE_GL_JS_SHA256],
    [MAPLIBRE_GL_CSS_FILE, MAPLIBRE_GL_CSS_SHA256],
  ])('%s carries the bytes the generator pinned', (file, sha) => {
    const bytes = fs.readFileSync(path.join(ROOT, BASEMAP, file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
  });

  it('ships one version only, so a bump leaves no stale renderer behind', () => {
    expect(fs.readdirSync(path.join(ROOT, BASEMAP, directory)).sort()).toEqual(
      [MAPLIBRE_GL_CSS_FILE, MAPLIBRE_GL_JS_FILE].map((file) => path.basename(file)).sort()
    );
  });

  it('the iOS bundle is a copy of the directory Android packages', () => {
    expect(read('modules/veloqrs/scripts/sync-basemap-assets.js')).toContain(
      "path.join(__dirname, '..', 'assets', 'basemap')"
    );
    expect(read(`${TILE_IOS}/Veloqrs.podspec`)).toContain('"VeloqBasemap" => ["BasemapAssets"]');
  });

  it('both interceptors admit the renderer directory', () => {
    expect(read(`${TILE_ANDROID}/BasemapAssetPath.java`)).toContain(
      `static final String RENDERER = "${directory}";`
    );
    expect(read(`${TILE_IOS}/VeloqTileSchemeHandler.m`)).toContain(
      `RendererDirectory = @"${directory}";`
    );
  });

  it('both interceptors answer the renderer as a script and a stylesheet', () => {
    const android = read(`${TILE_ANDROID}/BasemapAssetPath.java`);
    expect(android).toContain('endsWith(".js")) return "text/javascript";');
    expect(android).toContain('endsWith(".css")) return "text/css";');
    const ios = read(`${TILE_IOS}/VeloqTileSchemeHandler.m`);
    expect(ios).toContain('isEqualToString:@"js"]) return @"text/javascript; charset=utf-8";');
    expect(ios).toContain('isEqualToString:@"css"]) return @"text/css; charset=utf-8";');
  });

  it('both interceptors let the WebView keep the versioned renderer', () => {
    const immutable = 'public, max-age=31536000, immutable';
    expect(read(`${TILE_ANDROID}/BasemapAssetPath.java`)).toContain(`"${immutable}"`);
    expect(read(`${TILE_ANDROID}/VeloqTileWebViewClient.java`)).toContain(
      'BasemapAssetPath.cacheControlFor(path)'
    );
    expect(read(`${TILE_IOS}/VeloqTileSchemeHandler.m`)).toContain(`@"${immutable}"`);
  });
});

/** One day's form as the engine zones and prints it, from the vectors its widget suite writes. */
interface FormVector {
  tsb: number;
  fitness: number | null;
  asPercent: boolean;
  zone: string | null;
  text: string | null;
}

describe('form is zoned and printed as the widget zones and prints it', () => {
  const vectors: { bounds: number[]; cases: FormVector[] } = JSON.parse(
    read('modules/veloqrs/rust/veloqrs/tests/fixtures/form_zone_vectors.json')
  );
  const name = (v: FormVector) =>
    `${v.tsb} on fitness ${v.fitness} ${v.asPercent ? 'as a percentage' : 'absolute'}`;

  it('has vectors on every band edge', () => {
    expect(vectors.bounds).toHaveLength(4);
    expect(vectors.cases.length).toBeGreaterThan(vectors.bounds.length * 3);
  });

  it('the chart bands meet at the engine edges', () => {
    const [highRisk, optimal, greyZone, fresh] = vectors.bounds;
    expect(FORM_ZONE_BOUNDARIES.highRisk.max).toBe(highRisk);
    expect(FORM_ZONE_BOUNDARIES.optimal).toMatchObject({ min: highRisk, max: optimal });
    expect(FORM_ZONE_BOUNDARIES.greyZone).toMatchObject({ min: optimal, max: greyZone });
    expect(FORM_ZONE_BOUNDARIES.fresh).toMatchObject({ min: greyZone, max: fresh });
    expect(FORM_ZONE_BOUNDARIES.transition.min).toBe(fresh);
  });

  it.each(vectors.cases.map((v) => [name(v), v] as const))('zones %s', (_name, v) => {
    expect(getFormZone(v.tsb, v.fitness, v.asPercent)).toBe(v.zone);
  });

  it.each(vectors.cases.map((v) => [name(v), v] as const))('prints %s', (_name, v) => {
    expect(formatForm(v.tsb, v.fitness, v.asPercent)).toBe(v.text);
  });
});
