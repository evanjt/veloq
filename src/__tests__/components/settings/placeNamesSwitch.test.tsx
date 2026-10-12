/**
 * Scenario: place names send the end points of each new route or section to a
 * third-party geocoder, so the switch is off until the athlete has read the
 * notice and accepted it.
 *
 * Expected behaviour: a fresh install shows the switch off; turning it on
 * opens the notice and writes nothing; only Accept writes the engine switch;
 * Cancel and dismissal leave it off; turning it off needs no notice.
 */

import React from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import {
  PlaceNamesSwitch,
  NOMINATIM_POLICY_URL,
} from '@/features/settings/components/PlaceNamesSwitch';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const mockEngine: {
  stored: boolean;
  getGeocodingEnabled: jest.Mock<boolean, []>;
  setGeocodingEnabled: jest.Mock<void, [boolean]>;
} = {
  stored: false,
  getGeocodingEnabled: jest.fn(() => mockEngine.stored),
  setGeocodingEnabled: jest.fn((value: boolean) => {
    mockEngine.stored = value;
  }),
};
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

let alertSpy: jest.SpyInstance;
let openUrl: jest.SpyInstance;

function lastAlert() {
  const [title, body, buttons, options] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1] as [
    string,
    string,
    AlertButton[],
    { cancelable?: boolean; onDismiss?: () => void },
  ];
  return { title, body, buttons, options };
}

/** A tap on the row asks for the state it does not show, so it shows the other one first. */
async function toggle(tree: Awaited<ReturnType<typeof render>>, value: boolean) {
  const row = tree.getByTestId('settings-place-names-toggle');
  expect(row.props.accessibilityState.checked).toBe(!value);
  await fireEvent.press(row);
}

async function press(buttonText: string) {
  const button = lastAlert().buttons.find((b) => b.text === buttonText);
  await act(() => {
    button?.onPress?.();
  });
}

beforeEach(() => {
  mockEngine.stored = false;
  mockEngine.getGeocodingEnabled.mockClear();
  mockEngine.setGeocodingEnabled.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  alertSpy.mockRestore();
  openUrl.mockRestore();
});

describe('the place names switch', () => {
  it('renders off on a fresh install and credits OpenStreetMap beneath it', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
    expect(tree.getByText('settings.placeNames.attribution')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('renders on when the mockEngine already holds consent', async () => {
    mockEngine.stored = true;
    const tree = await render(<PlaceNamesSwitch />);
    expect(tree.getByTestId('settings-place-names-toggle')).toBeChecked();
  });

  it('opens the notice on turning on, with Cancel beside Accept, and writes nothing yet', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, true);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const { title, body, buttons, options } = lastAlert();
    expect(title).toBe('settings.placeNames.noticeTitle');
    expect(body).toBe('settings.placeNames.noticeBody');
    expect(buttons.map((b) => b.text)).toEqual([
      'settings.placeNames.readPolicy',
      'common.cancel',
      'settings.placeNames.accept',
    ]);
    expect(buttons[1].style).toBe('cancel');
    expect(options.cancelable).toBe(true);
    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
  });

  it('Cancel leaves it off', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, true);
    await press('common.cancel');

    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
  });

  it('dismissing the notice leaves it off', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, true);
    await act(() => {
      lastAlert().options.onDismiss?.();
    });

    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
  });

  it('Accept writes the engine switch on', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, true);
    await press('settings.placeNames.accept');

    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledTimes(1);
    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledWith(true);
    expect(tree.getByTestId('settings-place-names-toggle')).toBeChecked();
  });

  it('the policy button opens the usage policy and presents the notice again', async () => {
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, true);
    await press('settings.placeNames.readPolicy');

    expect(openUrl).toHaveBeenCalledWith(NOMINATIM_POLICY_URL);
    expect(NOMINATIM_POLICY_URL).toBe('https://operations.osmfoundation.org/policies/nominatim/');
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
  });

  it('turning it off writes false with no notice', async () => {
    mockEngine.stored = true;
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, false);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledWith(false);
    expect(tree.getByTestId('settings-place-names-toggle')).not.toBeChecked();
  });

  it('turning it on again after turning it off asks again', async () => {
    mockEngine.stored = true;
    const tree = await render(<PlaceNamesSwitch />);
    await toggle(tree, false);
    await toggle(tree, true);

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
