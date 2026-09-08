/**
 * Scenario: a rider taps record on a home-screen widget and wants to be
 * recording, not looking at a picker.
 *
 * Expected behaviour: every record surface deep-links to
 * `veloq://recording/<type>`, which starts the ride on mount, and falls back to
 * `veloq://record` only when no sport is known. The sport rides in the snapshot
 * as `lastRecordingType`, a nullable schema-5 field, so a snapshot written
 * before the field still opens the picker rather than nothing.
 */

import fs from 'fs';
import path from 'path';

import {
  composeSnapshot,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type RawWidgetData,
} from '@/features/home/lib/widgetSnapshot';

const widgetDir = path.join(__dirname, '../../widget');
const read = (rel: string) => fs.readFileSync(path.join(widgetDir, rel), 'utf8');

const KOTLIN_RENDERER = read('android/java/WidgetRenderer.kt');
const KOTLIN_SNAPSHOT = read('android/java/WidgetSnapshot.kt');
const KOTLIN_RECORD_PROVIDER = read('android/java/VeloqRecordWidgetProvider.kt');
const SWIFT_MODEL = read('ios/VeloqWidget/WidgetSnapshotModel.swift');
const SWIFT_WIDGET = read('ios/VeloqWidget/VeloqWidget.swift');
const SWIFT_VIEWS = read('ios/VeloqWidget/WidgetViews.swift');

function raw(overrides: Partial<RawWidgetData> = {}): RawWidgetData {
  return {
    sparklines: null,
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: 1_700_000_000,
    ...overrides,
  };
}

describe('the snapshot carries the sport a one-tap record should start', () => {
  it('is schema 5, because the field is new', () => {
    expect(WIDGET_SNAPSHOT_SCHEMA_VERSION).toBe(5);
    expect(composeSnapshot(raw()).schemaVersion).toBe(5);
  });

  it('carries the last recorded type through', () => {
    expect(composeSnapshot(raw({ lastRecordingType: 'Ride' })).lastRecordingType).toBe('Ride');
  });

  it('is null when nothing has been recorded, so the surfaces fall back', () => {
    expect(composeSnapshot(raw()).lastRecordingType).toBeNull();
    expect(composeSnapshot(raw({ lastRecordingType: null })).lastRecordingType).toBeNull();
  });

  it('treats a blank type as no type at all', () => {
    expect(composeSnapshot(raw({ lastRecordingType: '   ' })).lastRecordingType).toBeNull();
  });
});

describe('Android points its record surfaces at a started recording', () => {
  it('parses the field null-safely, so an older snapshot still reads', () => {
    expect(KOTLIN_SNAPSHOT).toContain('val lastRecordingType: String?');
    expect(KOTLIN_SNAPSHOT).toContain('lastRecordingType =');
    expect(KOTLIN_SNAPSHOT).toMatch(/optString\("lastRecordingType"[^)]*\)[\s\S]{0,60}takeIf/);
  });

  it('builds the URL in one place, with the picker as the only fallback', () => {
    expect(KOTLIN_RENDERER).toContain('fun recordUrl(lastRecordingType: String?): String');
    expect(KOTLIN_RENDERER).toContain('"veloq://recording/"');
    expect(KOTLIN_RENDERER).toContain('Uri.encode(');
    // The picker literal survives only as the fallback inside that one function.
    expect(KOTLIN_RENDERER.match(/"veloq:\/\/record"/g)).toHaveLength(1);
  });

  it('gives every record surface the snapshot, so the URL can vary', () => {
    expect(KOTLIN_RENDERER).toContain('fun recordIntent(context: Context, snap: WidgetSnapshot?)');
    expect(KOTLIN_RENDERER).toContain('recordIntent(context, snap)');
    expect(KOTLIN_RECORD_PROVIDER).toContain('WidgetSnapshot.read(context)');
    expect(KOTLIN_RECORD_PROVIDER).toContain('WidgetRenderer.recordIntent(context, snap)');
  });

  it('refreshes the pending intent, because its URL is no longer constant', () => {
    expect(KOTLIN_RENDERER).toContain('PendingIntent.FLAG_UPDATE_CURRENT');
  });
});

describe('iOS points its record surfaces at a started recording', () => {
  it('decodes the field as optional, so an older snapshot still decodes', () => {
    expect(SWIFT_MODEL).toContain('let lastRecordingType: String?');
  });

  it('builds the URL in one place, with the picker as the only fallback', () => {
    expect(SWIFT_MODEL).toContain('enum RecordDeepLink');
    expect(SWIFT_MODEL).toContain('static func url(for lastRecordingType: String?) -> URL');
    expect(SWIFT_MODEL).toContain('veloq://recording/');
    expect(SWIFT_MODEL).toContain('addingPercentEncoding');
  });

  it('leaves no record surface on the picker literal', () => {
    expect(SWIFT_WIDGET).not.toContain('veloq://');
    expect(SWIFT_VIEWS).not.toContain('veloq://');
    expect(SWIFT_WIDGET).toContain('RecordDeepLink.url(for:');
    expect(SWIFT_VIEWS).toContain('RecordDeepLink.url(for:');
  });

  it('loads the snapshot behind the standalone record widget, which had none', () => {
    expect(SWIFT_WIDGET).toContain('WidgetSnapshotStore.load()');
  });
});

describe('the gather path reads the sport the recording preferences published', () => {
  const mockEngine = { getWidgetSnapshot: jest.fn(() => undefined) };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
  });

  afterEach(() => {
    jest.dontMock('@/shared/native/engine');
  });

  function gatherWith(type: string | null) {
    const { setLastRecordingType } = require('@/shared/recording');
    setLastRecordingType(type);
    const { gatherWidgetSnapshot } = require('@/features/home/lib/widgetSnapshot');
    return gatherWidgetSnapshot({ locale: 'en-AU', isMetric: true, now: new Date(0) });
  }

  it('takes what the recording preferences published', () => {
    expect(gatherWith('Run').lastRecordingType).toBe('Run');
  });

  it('is null before anything has been recorded', () => {
    expect(gatherWith(null).lastRecordingType).toBeNull();
  });
});

describe('the recording preferences publish the sport for the widget path', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function store() {
    return require('@/features/recording/stores/RecordingPreferencesStore').useRecordingPreferences;
  }

  it('publishes on every start, so the newest sport wins', () => {
    const { getLastRecordingType } = require('@/shared/recording');
    store().getState().addRecentType('Ride');
    expect(getLastRecordingType()).toBe('Ride');
    store().getState().addRecentType('Run');
    expect(getLastRecordingType()).toBe('Run');
  });

  it('publishes on hydration, so a restart does not lose it', async () => {
    jest.doMock('@/shared/storage', () => ({
      getSetting: jest.fn(async () => JSON.stringify({ recentActivityTypes: ['Swim'] })),
      setSetting: jest.fn(async () => {}),
    }));
    const { getLastRecordingType } = require('@/shared/recording');
    await store().getState().initialize();
    expect(getLastRecordingType()).toBe('Swim');
    jest.dontMock('@/shared/storage');
  });

  it('reads null when nothing has been recorded', async () => {
    jest.doMock('@/shared/storage', () => ({
      getSetting: jest.fn(async () => JSON.stringify({ recentActivityTypes: [] })),
      setSetting: jest.fn(async () => {}),
    }));
    const { getLastRecordingType } = require('@/shared/recording');
    await store().getState().initialize();
    expect(getLastRecordingType()).toBeNull();
    jest.dontMock('@/shared/storage');
  });
});
