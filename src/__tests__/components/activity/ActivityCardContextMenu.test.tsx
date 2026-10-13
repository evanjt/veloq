/**
 * Scenario: a hold on a feed card opens its menu, at any text size and on a
 * small phone.
 *
 * Expected behaviour: the menu is the shared context menu, the system's own on
 * iOS with the map styles and 3D terrain as checkable items. On Android it is
 * an anchored popup whose items scroll inside the window at 200 per cent text,
 * never a fixed-width card in a react-native Modal. A card that draws no map,
 * one with no GPS track or a weight-training card, offers no map style, 3D
 * terrain or reset, on either platform. Share links to intervals.icu only with
 * the id the feed read hands over, never the row key, and is not offered when
 * intervals.icu holds no page for the activity.
 */

import React from 'react';
import { Dimensions, Modal, Platform, Share, StyleSheet, View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { ActivityCardContextMenu } from '@/features/activity/components/ActivityCardContextMenu';
import { ContextMenu } from '@/shared/ui/ContextMenu';
import type { Activity } from '@/types';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => (key === 'activity.terrainRow' ? 'Relief' : key) }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/maps', () => ({
  resolveTerrain3D: () => ({ show3D: true }),
}));

jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'dark',
    getTerrain3DMode: () => 'auto',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => true,
  }),
}));
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: [] }),
}));
jest.mock('expo-router', () => {
  const { Text: RNText, View: RNView } = require('react-native');
  function Link({ children }: { children: React.ReactNode }) {
    return <RNView>{children}</RNView>;
  }
  function Trigger({ children }: { children: React.ReactNode }) {
    return children;
  }
  function Preview() {
    return null;
  }
  function Menu({ title, children }: { title: string; children: React.ReactNode }) {
    return <RNView testID={`native-menu-${title}`}>{children}</RNView>;
  }
  function MenuAction({
    children,
    isOn,
    onPress,
  }: {
    children: string;
    isOn?: boolean;
    onPress?: () => void;
  }) {
    return (
      <RNText testID="native-action" accessibilityState={{ checked: isOn }} onPress={onPress}>
        {children}
      </RNText>
    );
  }
  return {
    ...jest.requireActual('expo-router'),
    Link: Object.assign(Link, { Trigger, Preview, Menu, MenuAction }),
    router: { push: jest.fn() },
  };
});
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
}));

const activity = {
  id: 'a1',
  name: 'Morning ride',
  type: 'Ride',
  stream_types: ['latlng'],
  intervalsWebId: 'i901',
} as unknown as Activity;

const renderMenu = (visible: boolean, shown: Activity = activity, hasMap = true) =>
  render(
    <PaperProvider>
      <ActivityCardContextMenu
        visible={visible}
        onDismiss={jest.fn()}
        activity={shown}
        hasMap={hasMap}
      >
        <View testID="card" />
      </ActivityCardContextMenu>
    </PaperProvider>
  );

const nativeChecked = (label: string) =>
  screen.getAllByTestId('native-action').find((node) => node.props.children === label)?.props
    .accessibilityState.checked;

describe('the card menu on iOS', () => {
  it('is the shared context menu around the card, with no react-native Modal', async () => {
    await renderMenu(false);

    expect(screen.UNSAFE_getByType(ContextMenu)).toBeTruthy();
    expect(screen.getByTestId('card')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('offers the map styles as a checkable submenu and 3D terrain as a checkable item', async () => {
    await renderMenu(false);

    expect(screen.getByTestId('native-menu-activity.mapStyle')).toBeTruthy();
    expect(nativeChecked('settings.dark')).toBe(true);
    expect(nativeChecked('settings.light')).toBe(false);
    expect(nativeChecked('settings.satellite')).toBe(false);
    expect(nativeChecked('Relief')).toBe(true);
    expect(nativeChecked('activity.share')).toBeUndefined();
    expect(nativeChecked('activity.resetToDefault')).toBeUndefined();
  });
});

const nativeAction = (label: string) =>
  screen.getAllByTestId('native-action').find((node) => node.props.children === label)!;

describe('sharing from the card menu', () => {
  const warn = jest.mocked(console.warn);

  beforeEach(() => warn.mockClear());
  afterEach(() => jest.restoreAllMocks());

  it('sends the activity name as the email subject on iOS', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await renderMenu(false);

    await fireEvent.press(nativeAction('activity.share'));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toMatchObject({
      message: 'Morning ride',
      url: 'https://intervals.icu/activities/i901',
    });
    expect(share.mock.calls[0][1]).toEqual({ subject: 'Morning ride' });
  });

  it('keeps the subject on Android, where the title carries it', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await renderMenu(true);

    await fireEvent.press(screen.getByLabelText('activity.share'));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toMatchObject({
      message: 'Morning ride\nhttps://intervals.icu/activities/i901',
      title: 'Morning ride',
    });
  });

  it('reports a share sheet that fails to open rather than dropping it', async () => {
    const failure = new Error('the sheet could not be presented');
    const share = jest.spyOn(Share, 'share').mockRejectedValue(failure);
    await renderMenu(false);

    await fireEvent.press(nativeAction('activity.share'));

    expect(share).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.any(String), expect.any(String), failure)
    );
  });

  it('stays quiet when the athlete closes the sheet without sharing', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    await renderMenu(false);

    await fireEvent.press(nativeAction('activity.share'));

    expect(warn).not.toHaveBeenCalled();
  });
});

describe.each(['ios', 'android'] as const)('sharing on %s with no intervals.icu page', (os) => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', os));
  afterEach(() => jest.restoreAllMocks());

  const shareOffered = () =>
    screen.queryAllByText('activity.share').length > 0 ||
    screen.queryByLabelText('activity.share') !== null;

  it('offers no Share for a recording intervals.icu has not named', async () => {
    await renderMenu(os === 'android', { ...activity, id: 'local-ride-7', intervalsWebId: null });

    expect(shareOffered()).toBe(false);
    expect(screen.getAllByText('activity.viewDetails').length).toBeGreaterThan(0);
  });

  it('offers no Share for a body the feed read did not name', async () => {
    const { intervalsWebId: _dropped, ...unnamed } = activity;
    await renderMenu(os === 'android', unnamed as Activity);

    expect(shareOffered()).toBe(false);
  });

  it('shares the id the feed read names for an uploaded recording, not its row key', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await renderMenu(os === 'android', { ...activity, id: 'local-ride-8', intervalsWebId: 'i900' });

    await fireEvent.press(
      os === 'ios' ? nativeAction('activity.share') : screen.getByLabelText('activity.share')
    );

    expect(share).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(share.mock.calls[0][0]);
    expect(sent).toContain('https://intervals.icu/activities/i900');
    expect(sent).not.toContain('local-ride-8');
  });
});

describe('the card menu on Android', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 2 });
  });

  afterEach(() => jest.restoreAllMocks());

  it('scrolls its items inside the window on a small phone at 200 per cent text', async () => {
    await renderMenu(true);

    const scroll = screen.getByTestId('context-menu-scroll');
    const { maxHeight } = StyleSheet.flatten(scroll.props.style);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThan(568);
    expect(screen.getByLabelText('activity.resetToDefault')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('is no wider than the window and carries no fixed width', async () => {
    await renderMenu(true);

    const widths = screen
      .UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style)?.width)
      .filter((width) => typeof width === 'number');
    expect(widths).not.toContain(300);
    const surface = StyleSheet.flatten(screen.getByTestId('context-menu-surface').props.style);
    expect(surface.maxWidth).toBeLessThanOrEqual(320);
  });

  it('marks the map styles and 3D terrain checked by their state', async () => {
    await renderMenu(true);

    expect(screen.getByLabelText('settings.dark').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.getByLabelText('settings.light').props.accessibilityState).toEqual({
      checked: false,
    });
    expect(screen.getByLabelText('Relief').props.accessibilityState).toEqual({ checked: true });
  });

  it('keeps screen-reader focus inside the open menu', async () => {
    await renderMenu(true);

    expect(screen.getByTestId('context-menu-view').props.accessibilityViewIsModal).toBe(true);
  });
});

const noTrack = {
  id: 'a2',
  name: 'Treadmill run',
  type: 'Run',
  stream_types: ['heartrate'],
  intervalsWebId: 'i902',
} as unknown as Activity;

const weights = {
  id: 'a3',
  name: 'Leg day',
  type: 'WeightTraining',
  stream_types: [],
  intervalsWebId: 'i903',
} as unknown as Activity;

describe.each([
  ['ios', 'a card with no GPS track', noTrack],
  ['ios', 'a weight-training card', weights],
  ['android', 'a card with no GPS track', noTrack],
  ['android', 'a weight-training card', weights],
] as const)('the card menu on %s for %s', (os, _name, shown) => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', os));
  afterEach(() => jest.restoreAllMocks());

  it('offers no map style, 3D terrain or reset, only details and share', async () => {
    await renderMenu(true, shown, false);

    for (const label of [
      'activity.mapStyle',
      'settings.dark',
      'settings.light',
      'settings.satellite',
      'Relief',
      'activity.resetToDefault',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByTestId('native-menu-activity.mapStyle')).toBeNull();
    expect(screen.getAllByText('activity.viewDetails').length).toBeGreaterThan(0);
    expect(screen.getAllByText('activity.share').length).toBeGreaterThan(0);
  });
});
