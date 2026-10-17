/**
 * Scenario: a discrete choice (a map style, the 3D item, a sub-tab, the
 * x-axis mode) is felt through the selection haptic, and a button that resets
 * state stays on a light impact.
 *
 * Expected behaviour: each choice calls selectionAsync once and no impact; the
 * reset calls one light impact and no selection.
 */

import React from 'react';
import { View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { PaperProvider } from 'react-native-paper';

import { SwipeableTabs } from '@/shared/ui';
import { ActivityCardContextMenu } from '@/features/activity/components/ActivityCardContextMenu';
import { ChartXAxisSwitch } from '@/features/activity/components/ChartXAxisSwitch';
import type { Activity } from '@/types';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockSetActivityOverride = jest.fn();
const mockClearActivityOverride = jest.fn();

jest.mock('@/features/maps', () => ({
  resolveTerrain3D: () => ({ show3D: false }),
}));

jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'auto',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => true,
    setActivityOverride: mockSetActivityOverride,
    clearActivityOverride: mockClearActivityOverride,
  }),
}));

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined }),
}));

jest.mock('expo-router', () => {
  function Link({ children }: { children: React.ReactNode }) {
    return children;
  }
  function Trigger({ children }: { children: React.ReactNode }) {
    return children;
  }
  function Hidden() {
    return null;
  }
  return {
    ...jest.requireActual('expo-router'),
    Link: Object.assign(Link, { Trigger, Preview: Hidden, Menu: Hidden, MenuAction: Hidden }),
    router: { push: jest.fn() },
  };
});

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const ACTIVITY = {
  id: 'a1',
  name: 'Morning ride',
  type: 'Ride',
  stream_types: [],
} as unknown as Activity;

// The card menu's popup, which a screen reader opens on iOS beside the system menu.
// Opening fires its own light impact, so the haptics are cleared once it is open
// and each test reads only what its row fires.
const renderCardMenu = async () => {
  const view = await render(
    <PaperProvider>
      <ActivityCardContextMenu visible onDismiss={jest.fn()} activity={ACTIVITY} hasMap>
        <View />
      </ActivityCardContextMenu>
    </PaperProvider>
  );
  jest.mocked(Haptics.impactAsync).mockClear();
  jest.mocked(Haptics.selectionAsync).mockClear();
  return view;
};

describe('selection haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('picking a map style fires one selection and no impact', async () => {
    const { getByText } = await renderCardMenu();

    await fireEvent.press(getByText('settings.dark'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockSetActivityOverride).toHaveBeenCalledWith('a1', { style: 'dark' });
  });

  it('checking the 3D item fires one selection and no impact', async () => {
    const { getByText } = await renderCardMenu();

    await fireEvent.press(getByText('activity.terrainRow'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockSetActivityOverride).toHaveBeenCalledWith('a1', { terrain3D: true });
  });

  it('the reset button stays a light impact', async () => {
    const { getByText } = await renderCardMenu();

    await fireEvent.press(getByText('activity.resetToDefault'));

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(mockClearActivityOverride).toHaveBeenCalledWith('a1');
  });

  it('switching the x-axis mode fires one selection, and pressing the active one fires none', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChartXAxisSwitch value="distance" onValueChange={onChange} />
    );

    await fireEvent.press(getByTestId('chart-x-axis-time'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('time');

    await fireEvent.press(getByTestId('chart-x-axis-distance'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('switching a sub-tab fires one selection, and pressing the active one fires none', async () => {
    const tabs = [
      { key: 'one', label: 'One', icon: 'lightbulb-outline' as const },
      { key: 'two', label: 'Two', icon: 'dumbbell' as const },
    ];
    const onTabChange = jest.fn();
    const { getByLabelText } = await render(
      <SwipeableTabs tabs={tabs} activeTab="one" onTabChange={onTabChange} isDark={false}>
        {tabs.map((tab) => (
          <React.Fragment key={tab.key} />
        ))}
      </SwipeableTabs>
    );

    await fireEvent.press(getByLabelText('One'));
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('Two'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onTabChange).toHaveBeenCalledWith('two');
  });
});
