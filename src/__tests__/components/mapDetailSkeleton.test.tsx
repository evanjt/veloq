/**
 * Scenario: a map detail screen opens before its screen read lands, with or without the picture
 * the feed card drew for it.
 *
 * Expected behaviour: the ground is that picture, drawn at once, or else the map's bare land,
 * never a pulsing block. The sheet stands at Peek with blocks for the name, the date line and
 * three numbers. A screen reader meets one busy element named for the screen kind, and nothing
 * the skeleton draws takes a touch from the header's back chip or the edge swipe.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import {
  configure,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';

import { MapDetailPeekSkeleton, MapDetailSkeleton } from '@/shared/ui/MapDetailSkeleton';
import { colourTokens } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

configure({ defaultIncludeHiddenElements: true });

const PREVIEW = 'file:///previews/harbour-loop.jpg';

function busyElements() {
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.props.accessible === true &&
      node.props.accessibilityState?.busy === true
  );
}

describe('MapDetailSkeleton', () => {
  it('draws the cached picture under the Peek blocks, at once', async () => {
    await render(<MapDetailSkeleton kind="activity" previewUri={PREVIEW} />);

    const preview = screen.getByTestId('map-detail-skeleton-preview');
    expect(preview.props.source).toEqual({ uri: PREVIEW });
    expect(preview.props.fadeDuration).toBe(0);
    expect(screen.getByTestId('map-detail-skeleton-peek')).toBeTruthy();
    expect(screen.getByTestId('map-detail-skeleton-name')).toBeTruthy();
    expect(screen.getByTestId('map-detail-skeleton-date')).toBeTruthy();
    expect(screen.getAllByTestId(/^map-detail-skeleton-stat-/)).toHaveLength(3);
  });

  it('draws the bare land ground of the theme without a picture', async () => {
    await render(<MapDetailSkeleton kind="route" />);

    expect(screen.queryByTestId('map-detail-skeleton-preview')).toBeNull();
    const ground = StyleSheet.flatten(screen.getByTestId('map-detail-skeleton-ground').props.style);
    expect(ground.backgroundColor).toBe(colourTokens.light['map-land']);
    expect(screen.getByTestId('map-detail-skeleton-peek')).toBeTruthy();
  });

  it('tells the screen when the picture settles, and at once when there is none', async () => {
    const settled = jest.fn();
    await render(
      <MapDetailSkeleton kind="activity" previewUri={PREVIEW} onPreviewSettled={settled} />
    );
    expect(settled).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('map-detail-skeleton-preview'), 'load');
    expect(settled).toHaveBeenCalledTimes(1);

    const bare = jest.fn();
    await render(<MapDetailSkeleton kind="activity" onPreviewSettled={bare} />);
    expect(bare).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['activity', 'maps.detailLoading.activity'],
    ['route', 'maps.detailLoading.route'],
    ['section', 'maps.detailLoading.section'],
  ] as const)('exposes one busy element for the %s screen', async (kind, label) => {
    await render(<MapDetailSkeleton kind={kind} previewUri={PREVIEW} />);

    const busy = busyElements();
    expect(busy).toHaveLength(1);
    expect(busy[0]!.props.accessibilityLabel).toBe(label);
    expect(busy[0]!.props.accessibilityRole).toBe('progressbar');
    expect(isHiddenFromAccessibility(screen.getByTestId('map-detail-skeleton-preview'))).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByTestId('map-detail-skeleton-name'))).toBe(true);
  });

  it('takes no touch, so the back chip and the edge swipe stay live', async () => {
    await render(<MapDetailSkeleton kind="section" />);

    expect(screen.getByTestId('map-detail-skeleton').props.pointerEvents).toBe('none');
  });
});

describe('MapDetailPeekSkeleton', () => {
  it('is the same Peek blocks behind one busy element, inside a sheet already shown', async () => {
    await render(<MapDetailPeekSkeleton kind="section" />);

    const busy = busyElements();
    expect(busy).toHaveLength(1);
    expect(busy[0]!.props.accessibilityLabel).toBe('maps.detailLoading.section');
    expect(screen.getAllByTestId(/^map-detail-skeleton-stat-/)).toHaveLength(3);
    expect(screen.queryByTestId('map-detail-skeleton-ground')).toBeNull();
  });
});
