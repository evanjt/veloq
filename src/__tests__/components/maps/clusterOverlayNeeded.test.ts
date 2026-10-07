/**
 * Scenario: the map draws its cluster counts itself. The React overlay beside
 * them exists for accessibility, is invisible by default, and re-queried the
 * page on every pan settle regardless.
 *
 * Expected behaviour: the round trip happens when something is going to read
 * the nodes, and not otherwise.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import {
  ClusterCountOverlay,
  type ClusterCountOverlayRef,
  clusterOverlayNeeded,
} from '@/features/maps/components/regional/ClusterCountOverlay';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';

describe('clusterOverlayNeeded', () => {
  it('does nothing for an invisible overlay with no screen reader', () => {
    expect(clusterOverlayNeeded({ visible: false, screenReaderOn: false })).toBe(false);
  });

  it.each([
    ['the overlay is shown', { visible: true, screenReaderOn: false }],
    ['a screen reader is on', { visible: false, screenReaderOn: true }],
  ])('queries the page when %s', (_why, options) => {
    expect(clusterOverlayNeeded(options)).toBe(true);
  });

  it('needs only one reason, not both', () => {
    expect(clusterOverlayNeeded({ visible: true, screenReaderOn: true })).toBe(true);
  });
});

/**
 * Scenario: a developer session under Metro, where `__DEV__` is true, pans the
 * regional map with the overlay hidden and no screen reader. The overlay took
 * `__DEV__` to mean a build Maestro drives, but the debug APK Maestro drives
 * embeds its bundle with `__DEV__` false, so the flag never served a flow and
 * charged every developer session the per-pan query.
 *
 * Expected behaviour: a dev build pays the round trip on the same terms as a
 * release one. Jest runs with `__DEV__` true, so this is that build.
 */
describe('ClusterCountOverlay in a dev build', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function mount(visible: boolean) {
    const queryViewportFeatures = jest.fn().mockResolvedValue([]);
    const surfaceRef = { current: { queryViewportFeatures } as unknown as MapSurfaceRef };
    const ref = React.createRef<ClusterCountOverlayRef>();
    render(React.createElement(ClusterCountOverlay, { surfaceRef, visible, ref }));
    return { queryViewportFeatures, ref };
  }

  it('is a dev build', () => {
    expect(__DEV__).toBe(true);
  });

  it('does not query the map for an invisible overlay with no screen reader', async () => {
    const { queryViewportFeatures, ref } = mount(false);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      ref.current?.refresh();
    });

    expect(queryViewportFeatures).not.toHaveBeenCalled();
  });

  it('queries the map when the overlay is shown', async () => {
    const { queryViewportFeatures } = mount(true);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(queryViewportFeatures).toHaveBeenCalled();
  });
});
