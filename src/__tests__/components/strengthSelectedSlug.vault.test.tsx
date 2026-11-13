/**
 * Scenario: a scrub across the body pair moves the selected muscle on every step.
 * Expected behaviour: the pair draws the selection stroke itself from `selectedSlug`, so
 * its caller's `data` never changes for a selection, and a step re-hands each Body only
 * the parts whose stroke changed.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { BodyPairWithLoupe } from '@/features/strength/components/BodyPairWithLoupe';
import { viewBoxStroke } from '@/features/strength/lib/bodyScale';
import { bodyDiagram, stroke } from '@/theme';

const received: (readonly { slug?: string; styles?: unknown }[])[] = [];
const bodyProps: Record<string, unknown>[] = [];

jest.mock('react-native-body-highlighter', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('react-native-body-highlighter'),
    __esModule: true,
    default: (props: { data: readonly { slug?: string; styles?: unknown }[] }) => {
      received.push(props.data);
      bodyProps.push(props);
      return <View testID="body" />;
    },
  };
});

const DATA = [
  { slug: 'chest', intensity: 3 },
  { slug: 'biceps', intensity: 1 },
  { slug: 'abs', intensity: 2 },
] as const;

const pair = (selectedSlug: string | null) => (
  <BodyPairWithLoupe
    data={DATA as never}
    gender="male"
    maxScale={0.8}
    colors={['#111111']}
    selectedSlug={selectedSlug}
  />
);

beforeEach(() => {
  received.length = 0;
  bodyProps.length = 0;
});

describe('the body pair selection', () => {
  it('strokes only the selected part', async () => {
    await render(pair('chest'));

    const last = received[received.length - 1]!;
    expect(last.find((p) => p.slug === 'chest')?.styles).toMatchObject({
      stroke: expect.any(String),
    });
    expect(last.find((p) => p.slug === 'biceps')?.styles).toEqual({ stroke: 'none' });
  });

  it('leaves the caller data untouched', async () => {
    await render(pair('chest'));

    expect((DATA[0] as { styles?: unknown }).styles).toBeUndefined();
  });

  it('keeps an unselected part referentially stable across a scrub step', async () => {
    const tree = await render(pair('chest'));
    const before = received[received.length - 1]!.find((p) => p.slug === 'abs');

    await tree.rerender(pair('biceps'));

    const after = received[received.length - 1]!;
    expect(after.find((p) => p.slug === 'chest')?.styles).toEqual({ stroke: 'none' });
    expect(after.find((p) => p.slug === 'biceps')?.styles).toMatchObject({
      stroke: bodyDiagram.light.selectedStroke,
    });
    expect(after.find((p) => p.slug === 'abs')).toBe(before);
  });

  it('draws nothing selected for a null selection', async () => {
    await render(pair(null));

    expect(
      received[received.length - 1]!.every(
        (p) =>
          (p.styles as { stroke?: string } | undefined)?.stroke !== bodyDiagram.light.selectedStroke
      )
    ).toBe(true);
  });

  it('leaves a trained muscle unoutlined, so only untrained ones carry the track outline', async () => {
    await render(pair(null));

    for (const part of received[received.length - 1]!) {
      expect(part.styles).toEqual({ stroke: 'none' });
    }
  });

  it('outlines the selected part in the primary text colour at the two-point stroke', async () => {
    await render(pair('chest'));

    expect(received[received.length - 1]!.find((p) => p.slug === 'chest')?.styles).toEqual({
      stroke: bodyDiagram.light.selectedStroke,
      strokeWidth: viewBoxStroke(stroke.two, 0.8),
    });
  });

  it('draws untrained muscles in the neutral fill with the track outline', async () => {
    await render(pair(null));

    for (const props of bodyProps) {
      expect(props).toMatchObject({
        defaultFill: bodyDiagram.light.untrained,
        defaultStroke: bodyDiagram.light.untrainedStroke,
        border: bodyDiagram.light.untrainedStroke,
      });
    }
  });
});
