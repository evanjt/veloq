/**
 * Scenario: the App Tour opens on a short phone, or at a large font scale, and
 * the slide's title and body leave less room than the picture drawn under them.
 *
 * Expected behaviour: the picture is drawn smaller, inside the space the slide
 * has, rather than at its own size and cut off by the card at the bottom. Once
 * it is at its floor the title and body scroll above it, so no text is clipped
 * and the picture is never dropped.
 */

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { WhatsNewSlide } from '@/features/settings/components/whatsNew/WhatsNewSlide';
import { HeatmapSlide } from '@/features/settings/components/whatsNew/HeatmapSlide';
import { TOUR_PICTURE_FLOOR, tourPictureSpace } from '@/features/settings/lib/tourSlideFit';

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

function drawnHeight(tree: Awaited<ReturnType<typeof render>>): number {
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
  it('is drawn inside the space the title and body leave it', async () => {
    const tree = await renderSlide(320);
    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(140));
    await fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));

    const space = tourPictureSpace(320, 140);
    expect(space).toBeLessThan(220);
    expect(drawnHeight(tree)).toBeLessThanOrEqual(space);
    expect(drawnHeight(tree)).toBeGreaterThan(0);
  });

  it('shrinks again when a larger font scale grows the title and body', async () => {
    const tree = await renderSlide(320);
    await fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));
    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(100));
    const before = drawnHeight(tree);

    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(160));
    expect(drawnHeight(tree)).toBeLessThan(before);
    expect(drawnHeight(tree)).toBeLessThanOrEqual(tourPictureSpace(320, 160));
  });

  it('is drawn at its own size when the screen has room for it', async () => {
    const tree = await renderSlide(900);
    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(140));
    await fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));

    expect(drawnHeight(tree)).toBe(220);
  });
});

describe('a tour slide whose title and body outgrow the slide', () => {
  function scrollerOf(tree: Awaited<ReturnType<typeof render>>) {
    return tree.getByTestId('tour-slide-text');
  }

  it('scrolls the title and body and keeps the picture at its floor', async () => {
    const tree = await renderSlide(320);
    await fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));
    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(420));

    const scroller = scrollerOf(tree);
    expect(scroller.props.scrollEnabled).toBe(true);
    expect(scroller.props.showsVerticalScrollIndicator).toBe(true);
    expect(within(scroller).getByText('Body')).toBeTruthy();
    expect(within(scroller).getByText('Title')).toBeTruthy();

    expect(drawnHeight(tree)).toBe(220 * TOUR_PICTURE_FLOOR);
    const textHeight = StyleSheet.flatten(scroller.props.style)?.maxHeight;
    expect(textHeight).toBe(320 - 24 - 24 - 220 * TOUR_PICTURE_FLOOR);
  });

  it('does not scroll when the title and body fit', async () => {
    const tree = await renderSlide(900);
    await fireEvent(tree.getByTestId('tour-slide-picture-content'), 'layout', layout(220));
    await fireEvent(tree.getByTestId('tour-slide-header'), 'layout', layout(140));

    expect(scrollerOf(tree).props.scrollEnabled).toBe(false);
    expect(StyleSheet.flatten(scrollerOf(tree).props.style)?.maxHeight).toBeUndefined();
  });
});
