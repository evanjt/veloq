/**
 * Scenario: the version line is tapped five times in the settings footer.
 *
 * Expected behaviour: the experimental switch appears above the debug switch,
 * the experimental page row shows only while the switch is on, and the page
 * lists one row per feature with its blurb, its own switch and a link to it.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { FooterSection } from '@/features/settings/components/FooterSection';
import { ExperimentalFeatures } from '@/features/settings/components/ExperimentalFeatures';
import { EXPERIMENTAL_FEATURES } from '@/features/settings/lib/experimentalFeatures';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { navigateTo } from '@/shared/app/navigation';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useDebugStore.setState({ unlocked: false, enabled: false });
  useDebugStore.setState({
    experimentalUnlocked: false,
    experimentalEnabled: false,
    experimentalFeatures: {},
  });
});

describe('the experimental switch in the settings footer', () => {
  it('is hidden until the version line is tapped five times', async () => {
    const { queryByTestId, getByLabelText } = await render(<FooterSection />);
    expect(queryByTestId('settings-experimental-switch')).toBeNull();

    for (let i = 0; i < 4; i++) await fireEvent.press(getByLabelText(/t\(settings.version\)/));
    expect(queryByTestId('settings-experimental-switch')).toBeNull();

    await fireEvent.press(getByLabelText(/t\(settings.version\)/));
    expect(queryByTestId('settings-experimental-switch')).toBeTruthy();
    expect(queryByTestId('settings-debug-switch')).toBeTruthy();
  });

  it('sits above the debug switch', async () => {
    useDebugStore.setState({ unlocked: true });
    useDebugStore.setState({ experimentalUnlocked: true });
    const screen = await render(<FooterSection />);
    const order = screen
      .getAllByRole('switch')
      .map((s) => s.props.testID as string)
      .filter(Boolean);
    expect(order).toEqual(['settings-experimental-switch', 'settings-debug-switch']);
  });

  it('shows the page row only while the switch is on', async () => {
    useDebugStore.setState({ experimentalUnlocked: true });
    const screen = await render(<FooterSection />);
    expect(screen.queryByTestId('settings-experimental-dashboard-link')).toBeNull();

    await fireEvent.press(screen.getByTestId('settings-experimental-switch'));
    await waitFor(() => expect(useDebugStore.getState().experimentalEnabled).toBe(true));
    await fireEvent.press(screen.getByTestId('settings-experimental-dashboard-link'));
    expect(navigateTo).toHaveBeenCalledWith('/experimental');
  });

  it('is not turned on by debug mode', async () => {
    useDebugStore.setState({ unlocked: true, enabled: true });
    const screen = await render(<FooterSection />);
    expect(screen.queryByTestId('settings-experimental-dashboard-link')).toBeNull();
    expect(useDebugStore.getState().experimentalEnabled).toBe(false);
  });
});

describe('the experimental page', () => {
  it('lists every feature with its blurb, its switch and a link to it', async () => {
    useDebugStore.setState({ experimentalUnlocked: true, experimentalEnabled: true });
    const screen = await render(<ExperimentalFeatures />);

    for (const feature of EXPERIMENTAL_FEATURES) {
      expect(screen.getByText(`t(${feature.titleKey})`)).toBeTruthy();
      expect(screen.getByText(`t(${feature.blurbKey})`)).toBeTruthy();
      expect(screen.getByTestId(`experimental-switch-${feature.key}`)).toBeTruthy();
      await fireEvent.press(screen.getByTestId(`experimental-link-${feature.key}`));
      expect(navigateTo).toHaveBeenLastCalledWith(feature.route);
    }
  });

  it('turns one feature off without touching the others', async () => {
    useDebugStore.setState({ experimentalUnlocked: true, experimentalEnabled: true });
    const screen = await render(<ExperimentalFeatures />);

    await fireEvent.press(screen.getByTestId('experimental-switch-garminUpdate'));

    await waitFor(() =>
      expect(useDebugStore.getState().experimentalFeatures).toEqual({ garminUpdate: false })
    );
    expect(
      screen.getByTestId('experimental-switch-efficiencyTrends').props.accessibilityState.checked
    ).toBe(true);
  });
});
