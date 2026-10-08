/**
 * Scenario: the App Tour opens on a short phone, or at a large font scale, and
 * the slide's title and body leave less room than the picture drawn under them.
 *
 * Expected behaviour: the picture is drawn smaller, inside the space the slide
 * has, rather than at its own size and cut off by the card at the bottom.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { WhatsNewSlide } from '@/features/settings/components/whatsNew/WhatsNewSlide';
import { HeatmapSlide } from '@/features/settings/components/whatsNew/HeatmapSlide';
import { tourPictureSpace } from '@/features/settings/lib/tourSlideFit';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  const Nothing = () => null;
  return {
    Canvas: View,
    RoundedRect: Nothing,
    Path: Nothing,
    Circle: Nothing,
    Line: Nothing,
    DashPathEffect: Nothing,
    vec: (x: number, y: number) => ({ x, y }),
  };
});

function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } };
}

function drawnHeight(tree: ReturnType<typeof render>): number {
  const frame = tree.getByTestId('tour-slide-picture');
  const height = StyleSheet.flatten(frame.props.style)?.height;
  expect(typeof height).toBe('number');
  return height as number;
}

function renderSlide(availableHeight: number) {
  return render(
    <WhatsNewSlide icon="grid" title="Title" body="Body" availableHeight={availableHeight}>
      <HeatmapSlide />
    </WhatsNewSlide>
  );
}

describe('a tour slide picture on a short screen', () => {
  it('is drawn inside the space the title and body leave it', () => {
    const tree = renderSlide(320);
    fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(140));
    fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));

    const space = tourPictureSpace(320, 140);
    expect(space).toBeLessThan(220);
    expect(drawnHeight(tree)).toBeLessThanOrEqual(space);
    expect(drawnHeight(tree)).toBeGreaterThan(0);
  });

  it('shrinks again when a larger font scale grows the title and body', () => {
    const tree = renderSlide(320);
    fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));
    fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(100));
    const before = drawnHeight(tree);

    fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(180));
    expect(drawnHeight(tree)).toBeLessThan(before);
    expect(drawnHeight(tree)).toBeLessThanOrEqual(tourPictureSpace(320, 180));
  });

  it('is drawn at its own size when the screen has room for it', () => {
    const tree = renderSlide(900);
    fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(140));
    fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));

    expect(drawnHeight(tree)).toBe(220);
  });
});
