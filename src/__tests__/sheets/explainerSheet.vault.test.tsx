/**
 * Scenario: an info control holds an explanation of how a screen works behind a press.
 *
 * Expected behaviour: the press opens the explainer sheet route rather than a system alert, and
 * the sheet shows the title in its title row and each paragraph of the body on its own, with a
 * close that goes back.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ExplainerSheet from '@/app/sheets/explainer';
import { InfoButton } from '@/features/settings/components/InfoButton';
import { initialiseI18n, i18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  alertSpy.mockRestore();
});

async function pressInfo() {
  await render(
    <InfoButton
      testID="info-tides"
      title="Tide tables"
      message={'When the water turns.\n\nSlack water lasts a few minutes.'}
    />
  );
  await fireEvent.press(screen.getByTestId('info-tides'));
}

describe('InfoButton', () => {
  it('opens the explainer sheet and raises no alert', async () => {
    await pressInfo();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0].pathname).toBe('sheets/explainer');
  });

  it('opens a fresh sheet on a second press', async () => {
    await pressInfo();
    await fireEvent.press(screen.getByTestId('info-tides'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls[1][0].params.request).not.toBe(
      mockPush.mock.calls[0][0].params.request
    );
  });
});

describe('explainer sheet', () => {
  async function openFromButton() {
    await pressInfo();
    mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
    await screen.unmount();
    await render(<ExplainerSheet />);
  }

  it('shows the title in its title row and each paragraph on its own', async () => {
    await openFromButton();
    expect(screen.getByRole('header')).toHaveTextContent('Tide tables');
    expect(screen.getByText('When the water turns.')).toBeTruthy();
    expect(screen.getByText('Slack water lasts a few minutes.')).toBeTruthy();
  });

  it('goes back from its close', async () => {
    await openFromButton();
    await fireEvent.press(screen.getByLabelText(i18n.t('common.close')));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('goes back and draws nothing when its request is unknown', async () => {
    mockParams = { request: 'sheet-unknown' };
    await render(<ExplainerSheet />);
    expect(screen.queryByRole('header')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
