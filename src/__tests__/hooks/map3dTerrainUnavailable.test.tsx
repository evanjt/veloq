/**
 * Scenario: the 3D page reports that it drew without terrain. The message has
 * to reach the caller, and the caller has to say why it dropped to the flat
 * map rather than leaving it looking like broken 3D.
 */

import { render, renderHook, screen } from '@testing-library/react-native';
import React from 'react';

import { useMap3DBridge } from '@/features/maps/hooks/useMap3DBridge';
import {
  TerrainUnavailableNotice,
  TERRAIN_UNAVAILABLE_TEST_ID,
} from '@/features/maps/components/TerrainUnavailableNotice';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function bridgeFor(handlers: { onTerrainUnavailable?: (reason: string) => void }) {
  const { result } = renderHook(() =>
    useMap3DBridge({
      webViewRef: { current: null },
      mapReadyRef: { current: false },
      savedCameraRef: { current: null },
      onMapClickRef: { current: undefined },
      onSectionClickRef: { current: undefined },
      onActivityClickRef: { current: undefined },
      updateLayers: () => {},
      ...handlers,
    })
  );
  return result.current;
}

const post = (bridge: ReturnType<typeof bridgeFor>, payload: object) =>
  bridge({ nativeEvent: { data: JSON.stringify(payload) } } as never);

describe('the 3D bridge', () => {
  it('hands the terrain report to the caller with its reason', () => {
    const onTerrainUnavailable = jest.fn();
    const bridge = bridgeFor({ onTerrainUnavailable });

    post(bridge, { type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

    expect(onTerrainUnavailable).toHaveBeenCalledWith('no terrain tiles: 6 failed');
  });

  it('names the reason even when the page sent none', () => {
    const onTerrainUnavailable = jest.fn();
    const bridge = bridgeFor({ onTerrainUnavailable });

    post(bridge, { type: 'terrainUnavailable' });

    expect(onTerrainUnavailable).toHaveBeenCalledWith('unknown');
  });

  it('does not read a terrain report as a failed page', () => {
    const onMapFailed = jest.fn();
    const onMapReady = jest.fn();
    const bridge = bridgeFor({ onMapFailed, onMapReady } as never);

    post(bridge, { type: 'terrainUnavailable', reason: 'x' });

    expect(onMapFailed).not.toHaveBeenCalled();
  });
});

describe('the terrain notice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says why the view is flat', () => {
    render(<TerrainUnavailableNotice onDismiss={() => {}} />);
    expect(screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(screen.getByText('maps.threeDUnavailable')).toBeTruthy();
  });

  it('clears itself, so it never has to be dismissed', () => {
    const onDismiss = jest.fn();
    render(<TerrainUnavailableNotice onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    expect(onDismiss).toHaveBeenCalled();
  });
});
