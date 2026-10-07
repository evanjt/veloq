/**
 * Scenario: a scrub across the body pair moves the selected muscle on every step.
 * Expected behaviour: the pair draws the selection stroke itself from `selectedSlug`, so
 * its caller's `data` never changes for a selection, and a step re-hands each Body only
 * the parts whose stroke changed.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { BodyPairWithLoupe } from '@/features/strength/components/BodyPairWithLoupe';

const received: (readonly { slug?: string; styles?: unknown }[])[] = [];

jest.mock('react-native-body-highlighter', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('react-native-body-highlighter'),
    __esModule: true,
    default: ({ data }: { data: readonly { slug?: string; styles?: unknown }[] }) => {
      received.push(data);
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
    scale={0.8}
    colors={['#111111']}
    selectedSlug={selectedSlug}
  />
);

beforeEach(() => {
  received.length = 0;
});

describe('the body pair selection', () => {
  it('strokes only the selected part', () => {
    render(pair('chest'));

    const last = received[received.length - 1]!;
    expect(last.find((p) => p.slug === 'chest')?.styles).toMatchObject({
      stroke: expect.any(String),
    });
    expect(last.find((p) => p.slug === 'biceps')?.styles).toBeUndefined();
  });

  it('leaves the caller data untouched', () => {
    render(pair('chest'));

    expect((DATA[0] as { styles?: unknown }).styles).toBeUndefined();
  });

  it('keeps an unselected part referentially stable across a scrub step', () => {
    const tree = render(pair('chest'));
    const before = received[received.length - 1]!.find((p) => p.slug === 'abs');

    tree.rerender(pair('biceps'));

    const after = received[received.length - 1]!;
    expect(after.find((p) => p.slug === 'chest')?.styles).toBeUndefined();
    expect(after.find((p) => p.slug === 'biceps')?.styles).toBeDefined();
    expect(after.find((p) => p.slug === 'abs')).toBe(before);
  });

  it('draws nothing selected for a null selection', () => {
    render(pair(null));

    expect(received[received.length - 1]!.every((p) => p.styles === undefined)).toBe(true);
  });
});
