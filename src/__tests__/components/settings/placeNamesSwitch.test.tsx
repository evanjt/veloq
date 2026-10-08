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

function toggle(tree: ReturnType<typeof render>, value: boolean) {
  fireEvent(tree.getByTestId('settings-place-names-toggle'), 'valueChange', value);
}

function press(buttonText: string) {
  const button = lastAlert().buttons.find((b) => b.text === buttonText);
  act(() => {
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
  it('renders off on a fresh install and credits OpenStreetMap beneath it', () => {
    const tree = render(<PlaceNamesSwitch />);
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
    expect(tree.getByText('settings.placeNames.attribution')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('renders on when the mockEngine already holds consent', () => {
    mockEngine.stored = true;
    const tree = render(<PlaceNamesSwitch />);
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(true);
  });

  it('opens the notice on turning on, with Cancel first, and writes nothing yet', () => {
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, true);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const { title, body, buttons, options } = lastAlert();
    expect(title).toBe('settings.placeNames.noticeTitle');
    expect(body).toBe('settings.placeNames.noticeBody');
    expect(buttons.map((b) => b.text)).toEqual([
      'common.cancel',
      'settings.placeNames.readPolicy',
      'settings.placeNames.accept',
    ]);
    expect(buttons[0].style).toBe('cancel');
    expect(options.cancelable).toBe(true);
    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
  });

  it('Cancel leaves it off', () => {
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, true);
    press('common.cancel');

    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
  });

  it('dismissing the notice leaves it off', () => {
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, true);
    act(() => {
      lastAlert().options.onDismiss?.();
    });

    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
  });

  it('Accept writes the engine switch on', () => {
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, true);
    press('settings.placeNames.accept');

    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledTimes(1);
    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledWith(true);
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(true);
  });

  it('the policy button opens the usage policy and presents the notice again', () => {
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, true);
    press('settings.placeNames.readPolicy');

    expect(openUrl).toHaveBeenCalledWith(NOMINATIM_POLICY_URL);
    expect(NOMINATIM_POLICY_URL).toBe('https://operations.osmfoundation.org/policies/nominatim/');
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(mockEngine.setGeocodingEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
  });

  it('turning it off writes false with no notice', () => {
    mockEngine.stored = true;
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, false);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockEngine.setGeocodingEnabled).toHaveBeenCalledWith(false);
    expect(tree.getByTestId('settings-place-names-toggle').props.value).toBe(false);
  });

  it('turning it on again after turning it off asks again', () => {
    mockEngine.stored = true;
    const tree = render(<PlaceNamesSwitch />);
    toggle(tree, false);
    toggle(tree, true);

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
