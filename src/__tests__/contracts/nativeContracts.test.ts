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
import { composeSnapshot, RECORD_PICKER_URL } from '@/features/home/lib/widgetSnapshot';
import { buildContentState } from '@/features/recording/lib/liveActivity/contentState';
import { KEYCHAIN_ACCESS_GROUP } from '@/shared/app/credentialKeychain';
import { ROUTE_DB_FILES } from '@/shared/storage/routeDbLocation';

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type Side = { file: string; has?: string | RegExp; lacks?: string | RegExp };
type Contract = { agree: string; a: Side; b: Side };

const PUSH = 'push/ios/VeloqPushExtension';
const PUSH_RS = 'modules/veloqrs/rust/veloqrs/src/push';
const TILE_IOS = 'modules/veloqrs/ios';
const TILE_ANDROID = 'modules/veloqrs/android/src/main/java/com/veloq';
const APP_GROUP = KEYCHAIN_ACCESS_GROUP;

const CONTRACTS: Contract[] = [
  // The push extension and the engine it calls.
  ...['veloq_push_prepare', 'veloq_push_activity', 'veloq_push_string_free'].map((name) => ({
    agree: `the push extension's ${name} is a symbol Rust exports`,
    a: { file: `${PUSH}/VeloqPushExtension-Bridging-Header.h`, has: `${name}(` },
    b: { file: `${PUSH_RS}/c.rs`, has: `pub unsafe extern "C" fn ${name}(` },
  })),
  {
    agree: 'iOS and Android push through the one composed entry',
    a: { file: `${PUSH_RS}/c.rs`, has: 'super::activity_push_json(activity_id)' },
    b: { file: `${PUSH_RS}/jni.rs`, has: 'super::activity_push_json(&activity_id)' },
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
    agree: 'the extension reads the keychain group the app writes into',
    a: { file: `${PUSH}/VeloqCredentials.swift`, has: `accessGroup = "${KEYCHAIN_ACCESS_GROUP}"` },
    b: { file: 'src/shared/app/credentialKeychain.ts', has: `'${KEYCHAIN_ACCESS_GROUP}'` },
  },
  {
    agree: 'the extension is entitled to the keychain group it reads',
    a: { file: `${PUSH}/VeloqPushExtension.entitlements`, has: /keychain-access-groups/ },
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
    agree: 'the widget module defines publishRecordShortcuts, which the bridge calls',
    a: {
      file: 'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
      has: 'Function("publishRecordShortcuts")',
    },
    b: { file: 'src/features/home/lib/widgetBridge.ts', has: 'publishRecordShortcuts?.(' },
  },
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

  // The widgets, the App Shortcut and the record link.
  {
    agree: 'the Android widgets fall back to the picker link the snapshot names',
    a: { file: 'widget/android/java/WidgetRenderer.kt', has: `"${RECORD_PICKER_URL}"` },
    b: { file: 'src/features/home/lib/widgetSnapshot.ts', has: `'${RECORD_PICKER_URL}'` },
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
  ...[
    'widget/ios/shared/VeloqAppShortcuts.swift',
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

function snapshotKeys(): string[] {
  const snap = composeSnapshot({
    sparklines: null,
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: 1_700_000_000,
    nowWallSeconds: 1_700_000_000,
    recentRecordingTypes: ['Ride'],
  });
  return Object.keys(snap);
}

const liveState = buildContentState({
  status: 'recording',
  now: 1_700_000_600_000,
  startTime: 1_700_000_000_000,
  pausedDurationMs: 0,
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

type SetContract = {
  agree: string;
  /** `equal`: the two lists match. `within`: every name in `a` is in `b`. */
  mode: 'equal' | 'within';
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
    agree: 'every widget snapshot field Swift decodes is one TypeScript writes',
    mode: 'within',
    a: () =>
      swiftProperties(read('widget/ios/VeloqWidget/WidgetSnapshotModel.swift'), 'WidgetSnapshot'),
    b: snapshotKeys,
  },
  {
    agree: 'every widget snapshot field Kotlin reads is one TypeScript writes',
    mode: 'within',
    a: () =>
      [...read('widget/android/java/WidgetSnapshot.kt').matchAll(/\broot\.\w+\("(\w+)"/g)].map(
        (m) => m[1]
      ),
    b: snapshotKeys,
  },
];

describe('name lists written on two sides agree', () => {
  it.each(SETS.map((s) => [s.agree, s] as const))('%s', (_agree, s) => {
    const a = [...new Set(s.a())].sort();
    const b = [...new Set(s.b())].sort();
    // An empty read is a broken extractor, not an agreement.
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    if (s.mode === 'equal') expect(a).toEqual(b);
    else expect(a.filter((name) => !b.includes(name))).toEqual([]);
  });
});
