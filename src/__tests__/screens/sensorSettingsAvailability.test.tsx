/**
 * Scenario: the Sensors screen constructed the BLE manager while rendering,
 * which raises the iOS Bluetooth prompt on arrival, and a refused permission,
 * Bluetooth off or an empty scan each left the screen saying nothing, or
 * "Searching…" for ever.
 *
 * Expected behaviour: nothing touches the radio until Scan is pressed. A
 * refusal, the radio off and an empty scan each draw a notice with the one
 * action that fixes it, and a grant made in the system settings is read on
 * the way back.
 */

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
jest.mock('@/shared/ui', () => ({
  EmptyState: jest.requireActual('@/shared/ui/EmptyState').EmptyState,
  signalColor: jest.requireActual('@/shared/ui/SignalStatus').signalColor,
  ScreenSafeAreaView: require('react-native').View,
  ScreenScrollView: require('react-native').ScrollView,
  useBottomClearance: () => 0,
  useScrollEndInset: () => 0,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));

let mockStateListeners: ((state: string) => void)[] = [];
const mockConstructed = jest.fn();
const mockStartDeviceScan = jest.fn();

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => {
    mockConstructed();
    return {
      onStateChange: jest.fn((listener: (state: string) => void) => {
        mockStateListeners.push(listener);
        return { remove: jest.fn() };
      }),
      state: jest.fn(async () => 'Unknown'),
      startDeviceScan: mockStartDeviceScan,
      stopDeviceScan: jest.fn(),
      enable: jest.fn(async () => undefined),
    };
  }),
}));

type Rtl = typeof import('@testing-library/react-native/pure');

// The manager keeps the radio and the grant in module state, so every case
// loads the screen, the manager, React and the renderer fresh, together.
let rn: typeof import('react-native');
let rtl: Rtl;
let manager: typeof import('@/features/sensors/lib/sensorManager');
let appStateListeners: ((state: string) => void)[] = [];

function renderScreen(): ReturnType<Rtl['render']> {
  const { createElement } = require('react');
  const Screen = require('@/app/sensor-settings').default;
  return rtl.render(createElement(Screen));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function press(testID: string): Promise<void> {
  await rtl.act(async () => {
    await rtl.fireEvent.press(rtl.screen.getByTestId(testID));
    await flush();
  });
}

async function emitAdapter(state: string): Promise<void> {
  await rtl.act(() => {
    for (const listener of mockStateListeners) listener(state);
  });
}

async function emitAppState(state: string): Promise<void> {
  await rtl.act(async () => {
    for (const listener of appStateListeners) listener(state);
    await flush();
  });
}

function setPlatform(os: 'ios' | 'android', version: number): void {
  Object.defineProperty(rn.Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(rn.Platform, 'Version', { value: version, configurable: true });
}

function androidAnswers(result: string): void {
  const { PermissionsAndroid } = rn;
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: result,
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: result,
  } as never);
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockStateListeners = [];
  appStateListeners = [];
  rn = require('react-native');
  rn.NativeModules.BlePlx = {};
  jest.spyOn(rn.AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void
  ) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  rtl = require('@testing-library/react-native/pure');
  manager = require('@/features/sensors/lib/sensorManager');
  setPlatform('ios', 17);
});

afterEach(() => {
  rtl.cleanup();
  manager.stopScan();
  jest.useRealTimers();
});

describe('the Sensors screen', () => {
  it('does not touch the radio until Scan is pressed', async () => {
    await renderScreen();
    expect(mockConstructed).not.toHaveBeenCalled();

    await press('sensor-scan-button');
    expect(mockConstructed).toHaveBeenCalledTimes(1);
  });

  it('does not touch the radio when it is left without scanning', async () => {
    await renderScreen();
    rtl.cleanup();

    expect(mockConstructed).not.toHaveBeenCalled();
  });

  it('offers Open settings for a permission that will not be asked again', async () => {
    setPlatform('android', 33);
    androidAnswers('never_ask_again');
    const openSettings = jest.spyOn(rn.Linking, 'openSettings').mockResolvedValue(undefined);
    await renderScreen();

    await press('sensor-scan-button');
    expect(rtl.screen.getByTestId('sensor-availability-blocked')).toBeTruthy();
    expect(rtl.screen.queryByTestId('sensor-scan-button')).toBeNull();
    await press('sensor-availability-action');

    expect(openSettings).toHaveBeenCalled();
  });

  it('reads a grant made in the settings on the way back', async () => {
    setPlatform('android', 33);
    androidAnswers('never_ask_again');
    await renderScreen();
    await press('sensor-scan-button');
    expect(rtl.screen.getByTestId('sensor-availability-blocked')).toBeTruthy();

    jest.spyOn(rn.PermissionsAndroid, 'check').mockResolvedValue(true);
    await emitAppState('background');
    await emitAppState('active');

    expect(rtl.screen.queryByTestId('sensor-availability-blocked')).toBeNull();
    expect(rtl.screen.getByTestId('sensor-scan-button')).toBeTruthy();
  });

  it('asks again for a permission refused once', async () => {
    setPlatform('android', 33);
    androidAnswers('denied');
    await renderScreen();

    await press('sensor-scan-button');
    expect(rtl.screen.getByTestId('sensor-availability-unauthorised')).toBeTruthy();
    expect(mockStartDeviceScan).not.toHaveBeenCalled();

    androidAnswers('granted');
    await press('sensor-availability-action');

    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(2);
    expect(rtl.screen.queryByTestId('sensor-availability-unauthorised')).toBeNull();
  });

  it('asks the system to turn Bluetooth on when it is off on Android', async () => {
    setPlatform('android', 33);
    androidAnswers('granted');
    const sendIntent = jest.spyOn(rn.Linking, 'sendIntent').mockResolvedValue(undefined);
    await renderScreen();

    await press('sensor-scan-button');
    await emitAdapter('PoweredOff');
    expect(rtl.screen.getByTestId('sensor-availability-poweredOff')).toBeTruthy();
    expect(rtl.screen.queryByTestId('sensor-scan-button')).toBeNull();
    await press('sensor-availability-action');

    expect(sendIntent).toHaveBeenCalledWith('android.bluetooth.adapter.action.REQUEST_ENABLE');
  });

  it('offers no action for Bluetooth off on iOS, which lets an app do nothing about it', async () => {
    await renderScreen();

    await press('sensor-scan-button');
    await emitAdapter('PoweredOff');

    expect(rtl.screen.getByTestId('sensor-availability-poweredOff')).toBeTruthy();
    expect(rtl.screen.queryByTestId('sensor-availability-action')).toBeNull();
  });

  it('brings Scan back once the radio comes on', async () => {
    await renderScreen();

    await press('sensor-scan-button');
    await emitAdapter('PoweredOff');
    expect(rtl.screen.getByTestId('sensor-availability-poweredOff')).toBeTruthy();
    await emitAdapter('PoweredOn');

    expect(rtl.screen.queryByTestId('sensor-availability-poweredOff')).toBeNull();
    expect(rtl.screen.getByTestId('sensor-scan-button')).toBeTruthy();
  });

  it('ends an empty scan with a notice and Scan again', async () => {
    jest.useFakeTimers();
    await renderScreen();

    await press('sensor-scan-button');
    await emitAdapter('PoweredOn');
    await rtl.act(flush);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
    expect(rtl.screen.queryByTestId('sensor-scan-empty')).toBeNull();
    await rtl.act(() => {
      jest.advanceTimersByTime(manager.SCAN_WINDOW_MS);
    });

    expect(rtl.screen.getByTestId('sensor-scan-empty')).toBeTruthy();
    await press('sensor-availability-action');
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
    expect(rtl.screen.queryByTestId('sensor-scan-empty')).toBeNull();
  });
});
