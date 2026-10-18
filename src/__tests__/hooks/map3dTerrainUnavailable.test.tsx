/**
 * Scenario: the 3D page reports that it drew without terrain. The message has
 * to reach the caller, and the caller has to say why it dropped to the flat
 * map rather than leaving it looking like broken 3D.
 */

import { render, renderHook, screen } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { useMap3DBridge } from '@/features/maps/hooks/useMap3DBridge';
import {
  TerrainUnavailableNotice,
  TERRAIN_UNAVAILABLE_TEST_ID,
} from '@/features/maps/components/TerrainUnavailableNotice';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

async function bridgeFor(handlers: { onTerrainUnavailable?: (reason: string) => void }) {
  const { result } = await renderHook(() =>
    useMap3DBridge({
      mapReadyRef: { current: false },
      savedCameraRef: { current: null },
      onMapClickRef: { current: undefined },
      onSectionClickRef: { current: undefined },
      updateLayers: () => {},
      syncRoute: () => {},
      syncStyle: () => {},
      onActivityClickRef: { current: undefined },
      ...handlers,
    })
  );
  return result.current;
}

const post = (bridge: Awaited<ReturnType<typeof bridgeFor>>, payload: object) =>
  bridge({ nativeEvent: { data: JSON.stringify(payload) } } as never);

describe('the 3D bridge', () => {
  it('hands the terrain report to the caller with its reason', async () => {
    const onTerrainUnavailable = jest.fn();
    const bridge = await bridgeFor({ onTerrainUnavailable });

    post(bridge, { type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

    expect(onTerrainUnavailable).toHaveBeenCalledWith('no terrain tiles: 6 failed');
  });

  it('names the reason even when the page sent none', async () => {
    const onTerrainUnavailable = jest.fn();
    const bridge = await bridgeFor({ onTerrainUnavailable });

    post(bridge, { type: 'terrainUnavailable' });

    expect(onTerrainUnavailable).toHaveBeenCalledWith('unknown');
  });

  it('does not read a terrain report as a failed page', async () => {
    const onMapFailed = jest.fn();
    const onMapReady = jest.fn();
    const bridge = await bridgeFor({ onMapFailed, onMapReady } as never);

    post(bridge, { type: 'terrainUnavailable', reason: 'x' });

    expect(onMapFailed).not.toHaveBeenCalled();
  });
});

describe('the terrain notice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says why the view is flat', async () => {
    await render(<TerrainUnavailableNotice onDismiss={() => {}} />);
    expect(screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(screen.getByText('maps.threeDUnavailable')).toBeTruthy();
  });

  it('clears itself, so it never has to be dismissed', async () => {
    const onDismiss = jest.fn();
    await render(<TerrainUnavailableNotice onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('keeps its six-second clock when the parent re-renders with a new callback', async () => {
    const onDismiss = jest.fn();
    const { rerender } = await render(<TerrainUnavailableNotice onDismiss={() => onDismiss()} />);

    for (let i = 0; i < 2; i++) {
      jest.advanceTimersByTime(2000);
      await rerender(<TerrainUnavailableNotice onDismiss={() => onDismiss()} />);
    }
    expect(onDismiss).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('speaks once on iOS when it appears, since it clears itself before a reader reaches it', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    announce.mockClear();
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    try {
      const { rerender } = await render(<TerrainUnavailableNotice onDismiss={() => {}} />);
      await rerender(<TerrainUnavailableNotice onDismiss={() => {}} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('maps.threeDUnavailable');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
      announce.mockRestore();
    }
  });

  it('is a polite live region that asks nothing of the athlete', async () => {
    await render(<TerrainUnavailableNotice onDismiss={() => {}} />);
    const notice = screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID);

    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByText('maps.threeDUnavailable')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
