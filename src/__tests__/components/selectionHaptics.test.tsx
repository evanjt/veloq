/**
 * Scenario: a discrete choice (a map style, the 3D switch, a sub-tab, the
 * x-axis mode) is felt through the selection haptic, and a button that resets
 * state stays on a light impact.
 *
 * Expected behaviour: each choice calls selectionAsync once and no impact; the
 * reset calls one light impact and no selection.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { SwipeableTabs } from '@/shared/ui';
import { ActivityCardContextMenu } from '@/features/activity/components/ActivityCardContextMenu';
import { ChartDistanceIndicator } from '@/features/activity/components/ChartDistanceIndicator';
import type { Activity } from '@/types';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockSetActivityOverride = jest.fn();
const mockClearActivityOverride = jest.fn();

jest.mock('@/features/maps', () => ({
  getCameraOverride: () => undefined,
  resolveTerrain3D: () => ({ show3D: false }),
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'auto',
    hasActivityOverride: () => true,
    setActivityOverride: mockSetActivityOverride,
    clearActivityOverride: mockClearActivityOverride,
  }),
}));

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined }),
}));

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

describe('selection haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('picking a map style fires one selection and no impact', () => {
    const { getByText } = render(
      <ActivityCardContextMenu visible onDismiss={jest.fn()} activity={ACTIVITY} />
    );

    fireEvent.press(getByText('settings.dark'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockSetActivityOverride).toHaveBeenCalledWith('a1', { style: 'dark' });
  });

  it('flipping the 3D switch fires one selection and no impact', () => {
    const { UNSAFE_getByType } = render(
      <ActivityCardContextMenu visible onDismiss={jest.fn()} activity={ACTIVITY} />
    );
    const { Switch } = require('react-native-paper');

    UNSAFE_getByType(Switch).props.onValueChange(true);

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockSetActivityOverride).toHaveBeenCalledWith('a1', { terrain3D: true });
  });

  it('the reset button stays a light impact', () => {
    const { getByText } = render(
      <ActivityCardContextMenu visible onDismiss={jest.fn()} activity={ACTIVITY} />
    );

    fireEvent.press(getByText('activity.resetToDefault'));

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(mockClearActivityOverride).toHaveBeenCalledWith('a1');
  });

  it('switching the x-axis mode fires one selection and no impact', () => {
    const onToggle = jest.fn();
    const { getByText } = render(
      <ChartDistanceIndicator
        xAxisMode="distance"
        maxX={12.3}
        xUnit="km"
        isDark={false}
        canToggleXAxis
        onXAxisModeToggle={onToggle}
      />
    );

    fireEvent.press(getByText('12.3 km'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('switching a sub-tab fires one selection, and pressing the active one fires none', () => {
    const tabs = [
      { key: 'one', label: 'One', icon: 'lightbulb-outline' as const },
      { key: 'two', label: 'Two', icon: 'dumbbell' as const },
    ];
    const onTabChange = jest.fn();
    const { getByLabelText } = render(
      <SwipeableTabs tabs={tabs} activeTab="one" onTabChange={onTabChange} isDark={false}>
        {tabs.map((tab) => (
          <React.Fragment key={tab.key} />
        ))}
      </SwipeableTabs>
    );

    fireEvent.press(getByLabelText('One'));
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText('Two'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onTabChange).toHaveBeenCalledWith('two');
  });
});
