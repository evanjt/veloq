/**
 * Scenario: the detail hero floats a header, a gradient and an info overlay
 * over a full-bleed map.
 *
 * Expected behaviour: every floating layer lets touches through to the map
 * except where it draws a control, so the map still pans under the overlay.
 * On iOS a strip along the leading edge keeps the touch from the map, so the
 * stack's back swipe starts there rather than the map's pan.
 */

import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { DetailHero } from '@/shared/ui/DetailHero';
import { BACK_SWIPE_EDGE_WIDTH } from '@/shared/ui/backSwipeEdge';

const renderHero = () =>
  render(
    <DetailHero height={320} overlay={<Text>Lausanne half marathon</Text>}>
      <Text>map</Text>
    </DetailHero>
  );

describe('DetailHero pointer events', () => {
  it('passes touches through the overlay to the map beneath', async () => {
    await renderHero();

    expect(screen.getByTestId('detail-hero-overlay').props.pointerEvents).toBe('box-none');
  });

  it('takes no touches at all on the gradient', async () => {
    await renderHero();

    expect(screen.getByTestId('detail-hero-gradient').props.pointerEvents).toBe('none');
  });

  it('draws no back control, the stack header owns it', async () => {
    await renderHero();

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('detail-hero-header')).toBeNull();
  });

  describe('back-swipe edge', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it('covers the leading edge over the full height on iOS and takes the touch', async () => {
      Platform.OS = 'ios';
      await renderHero();

      const edge = screen.getByTestId('detail-hero-back-edge');
      expect(['none', 'box-none']).not.toContain(edge.props.pointerEvents);
      expect(edge.props.accessible).toBe(false);
      const style = StyleSheet.flatten(edge.props.style);
      expect(style).toMatchObject({
        position: 'absolute',
        start: 0,
        top: 0,
        bottom: 0,
        width: BACK_SWIPE_EDGE_WIDTH,
      });
      expect(style.left).toBeUndefined();
      expect(style.right).toBeUndefined();
    });

    it('draws no strip on Android, whose back is the system gesture', async () => {
      Platform.OS = 'android';
      await renderHero();

      expect(screen.queryByTestId('detail-hero-back-edge')).toBeNull();
    });
  });
});
