/**
 * Scenario: a rider taps record on a home-screen widget and wants to be
 * recording, not looking at a picker.
 *
 * Expected behaviour: every record surface opens the deep link the snapshot
 * carries for the most recent sport, which starts the ride on mount, and falls
 * back to `veloq://record` only when the snapshot names none. The link is
 * composed in `widgetSnapshot.ts` and read everywhere else, so a snapshot
 * written before the field, or before anything was recorded, opens the picker
 * rather than an empty path.
 */

import {
  composeSnapshot,
  RECORD_PICKER_URL,
  type RawWidgetData,
} from '@/features/home/lib/widgetSnapshot';

function raw(overrides: Partial<RawWidgetData> = {}): RawWidgetData {
  return {
    sparklines: null,
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: 1_700_000_000,
    nowWallSeconds: 1_700_000_000,
    ...overrides,
  };
}

describe('the deep link is composed once, in the snapshot', () => {
  it('starts the ride for a known sport', () => {
    const snap = composeSnapshot(raw({ recentRecordingTypes: ['Ride'] }));
    expect(snap.recordShortcuts[0].url).toBe('veloq://recording/Ride?from=quickstart');
  });

  it('escapes a sport whose name is not URL-safe', () => {
    const snap = composeSnapshot(raw({ recentRecordingTypes: ['Stand Up Paddling'] }));
    expect(snap.recordShortcuts[0].url).toBe(
      'veloq://recording/Stand%20Up%20Paddling?from=quickstart'
    );
  });

  it('names the picker as the fallback, and only there', () => {
    expect(RECORD_PICKER_URL).toBe('veloq://record');
    expect(composeSnapshot(raw()).recordShortcuts).toEqual([]);
  });
});

describe('the gather path reads the sports the recording preferences published', () => {
  // An engine with nothing in it still answers. Handing back undefined models
  // a shape the FFI never produces: it returns the payload or it throws.
  const mockEngine = {
    getWidgetSnapshot: jest.fn(() => ({
      sparklines: null,
      summary: null,
      latest: null,
      latestIsPr: false,
      latestGps: null,
    })),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/shared/native/engine', () => ({
      getEngine: () => mockEngine,
      isEngineReady: () => true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/shared/native/engine');
  });

  function gatherWith(types: string[]) {
    // Signed out the gather hands back nothing at all, so sign in first.
    require('@/shared/app/AuthStore').useAuthStore.setState({ authMethod: 'apiKey' });
    const { setRecentRecordingTypes } = require('@/shared/recording');
    setRecentRecordingTypes(types);
    const { gatherWidgetSnapshot } = require('@/features/home/lib/widgetSnapshot');
    return gatherWidgetSnapshot({ locale: 'en-AU', isMetric: true, now: new Date(0) });
  }

  it('takes them in the order they were published', () => {
    expect(
      gatherWith(['Run', 'Ride']).recordShortcuts.map((s: { type: string }) => s.type)
    ).toEqual(['Run', 'Ride']);
  });

  it('is empty before anything has been recorded, so the surfaces fall back', () => {
    expect(gatherWith([]).recordShortcuts).toEqual([]);
  });
});

describe('the recording preferences publish the sports for the widget path', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function store() {
    return require('@/features/recording/stores/RecordingPreferencesStore').useRecordingPreferences;
  }

  it('publishes on every start, so the newest sport leads', () => {
    const { getRecentRecordingTypes } = require('@/shared/recording');
    store().getState().addRecentType('Ride');
    expect(getRecentRecordingTypes()).toEqual(['Ride']);
    store().getState().addRecentType('Run');
    expect(getRecentRecordingTypes()).toEqual(['Run', 'Ride']);
  });

  it('publishes on hydration, so a restart does not lose them', async () => {
    jest.doMock('@/shared/storage', () => ({
      getSetting: jest.fn(async () => JSON.stringify({ recentActivityTypes: ['Swim', 'Hike'] })),
      setSetting: jest.fn(async () => {}),
    }));
    const { getRecentRecordingTypes } = require('@/shared/recording');
    await store().getState().initialize();
    expect(getRecentRecordingTypes()).toEqual(['Swim', 'Hike']);
    jest.dontMock('@/shared/storage');
  });

  it('reads empty when nothing has been recorded', async () => {
    jest.doMock('@/shared/storage', () => ({
      getSetting: jest.fn(async () => JSON.stringify({ recentActivityTypes: [] })),
      setSetting: jest.fn(async () => {}),
    }));
    const { getRecentRecordingTypes, getLastRecordingType } = require('@/shared/recording');
    await store().getState().initialize();
    expect(getRecentRecordingTypes()).toEqual([]);
    expect(getLastRecordingType()).toBeNull();
    jest.dontMock('@/shared/storage');
  });
});
