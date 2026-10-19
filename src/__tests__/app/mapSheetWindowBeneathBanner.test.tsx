/**
 * Scenario: a banner fills the top slot, so the stack beneath it reads no top inset, and a map
 * detail screen presents its sheet on a small iPhone.
 *
 * Expected behaviour: the sheet's detents are worked out from the device's insets, since iOS sizes
 * the sheet against the window and the status bar whatever the slot holds. Detents worked out
 * from the stack's zero top inset assume a largest sheet 20 pt taller than iOS gives, so every
 * stop rests lower than the map is fitted for, by 17 pt at Full.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import {
  createMapSheetHostLayout,
  MapSheetHostMap,
  MapSheetHostSheet,
} from '@/shared/app/MapSheetHost';
import { useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';
import { mapSheetScreenOptions } from '@/shared/app/screenHeaders';
import {
  BeneathTopSlot,
  TopSafeAreaProvider,
  useSheetWindow,
} from '@/shared/app/TopSafeAreaContext';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true, offlineBannerShown: false }),
}));
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => ({ lastError: null, lastSuccessAt: null }),
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 375, height: 667, scale: 2, fontScale: 1 }),
}));

const SMALL_PHONE = { width: 375, height: 667 };
const DEVICE = { top: 20, bottom: 0, left: 0, right: 0 };
const OS_VERSION = '26.2';
const DEVICE_WINDOW = { ...SMALL_PHONE, topInset: DEVICE.top, bottomInset: DEVICE.bottom };

const originalOS = Platform.OS;
const originalVersion = Platform.Version;

function setVersion(version: string | number) {
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

let bannerShown = false;

function Root() {
  return (
    <SafeAreaInsetsContext.Provider value={DEVICE}>
      <TopSafeAreaProvider startupErrorShown={bannerShown}>
        <BeneathTopSlot>
          <Stack screenOptions={{ headerShown: false }} />
        </BeneathTopSlot>
      </TopSafeAreaProvider>
    </SafeAreaInsetsContext.Provider>
  );
}

function SheetWindowReport() {
  return <Text testID="sheet-window">{JSON.stringify(useSheetWindow())}</Text>;
}

function OrchardMap() {
  return (
    <MapSheetHostMap panel={null}>
      <SheetWindowReport />
    </MapSheetHostMap>
  );
}

function OrchardSheet() {
  return (
    <MapSheetHostSheet>
      <Text>orchard</Text>
    </MapSheetHostSheet>
  );
}

let app: Awaited<ReturnType<typeof renderRouter>>;

async function openOrchard() {
  app = await renderRouter(
    {
      _layout: Root,
      index: () => <Text>feed</Text>,
      'orchard/[id]/_layout': createMapSheetHostLayout('section'),
      'orchard/[id]/index': OrchardMap,
      'orchard/[id]/sheet': OrchardSheet,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push('/orchard/pear'));
}

/** The detents the presented form sheet hands the native stack. */
function presentedDetents(): unknown {
  const sheets = app.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.props.stackPresentation === 'formSheet'
  );
  expect(sheets).toHaveLength(1);
  return sheets[0]!.props.sheetAllowedDetents;
}

beforeEach(() => {
  Platform.OS = 'ios';
  setVersion(OS_VERSION);
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
});

afterEach(() => {
  Platform.OS = originalOS;
  setVersion(originalVersion);
});

describe.each([true, false])('a map sheet on a small iPhone, banner shown: %s', (banner) => {
  beforeEach(() => {
    bannerShown = banner;
  });

  it('presents the sheet at the detents the device insets give', async () => {
    await openOrchard();

    const expected = mapSheetScreenOptions('ios', OS_VERSION, DEVICE_WINDOW).sheetAllowedDetents;
    expect(expected).toHaveLength(3);
    expect(presentedDetents()).toEqual(expected);
  });

  it('lays the map out against the window with the device insets', async () => {
    await openOrchard();

    const report = app.getByTestId('sheet-window', { includeHiddenElements: true });
    expect(JSON.parse(report.props.children)).toEqual(DEVICE_WINDOW);
  });
});
