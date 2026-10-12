/**
 * Scenario: the App Tour's strength slide, whose copy promises body diagrams
 * and a balance between antagonist pairs.
 *
 * Expected behaviour: it draws the strength tab's own body pair, shaded and
 * not tappable, beside volume split rows for pairs the strength tab compares,
 * each drawn with the strength tab's own split bar. It drew four per-muscle
 * week-on-week bars the app has nowhere and no body at all.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StrengthSlide } from '@/features/settings/components/whatsNew/StrengthSlide';
import { BALANCE_PAIR_NAME_KEYS, MUSCLE_NAME_KEYS } from '@/features/strength/lib/muscleNames';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `[${key}]` }),
}));

interface BodyProps {
  data: { slug: string; intensity: number }[];
  onMuscleTap?: unknown;
  onMuscleScrub?: unknown;
}

const mockBodies: BodyProps[] = [];
jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { View } = require('react-native');
  return {
    BodyPairWithLoupe: (props: BodyProps) => {
      mockBodies.push(props);
      return <View testID="tour-bodies" />;
    },
  };
});

function drawnText(): string[] {
  return screen.root.findAllByType('Text' as never).flatMap((node) => {
    const child = (node.props as { children?: unknown }).children;
    return typeof child === 'string' ? [child] : [];
  });
}

beforeEach(() => {
  mockBodies.length = 0;
});

describe('the strength tour slide', () => {
  it('draws the body pair the strength tab draws, shaded and not tappable', async () => {
    await render(<StrengthSlide />);

    expect(screen.getByTestId('tour-bodies')).toBeTruthy();
    const body = mockBodies[mockBodies.length - 1]!;
    expect(body.data.length).toBeGreaterThan(0);
    for (const part of body.data) {
      expect(Object.keys(MUSCLE_NAME_KEYS)).toContain(part.slug);
      expect(part.intensity).toBeGreaterThanOrEqual(1);
    }
    expect(body.onMuscleTap).toBeUndefined();
    expect(body.onMuscleScrub).toBeUndefined();
  });

  it('draws two volume split rows, each a pair the strength tab compares', async () => {
    await render(<StrengthSlide />);
    const drawn = drawnText();

    expect(drawn).toContain('[insights.strengthBalance.volumeSplit]');
    const pairNames = Object.values(BALANCE_PAIR_NAME_KEYS).map((key) => `[${key}]`);
    expect(drawn.filter((text) => pairNames.includes(text))).toHaveLength(2);
    expect(screen.getAllByTestId('strength-balance-scale')).toHaveLength(2);
  });

  it('draws no week-on-week muscle bars, which the app has nowhere', async () => {
    await render(<StrengthSlide />);
    const drawn = drawnText();

    expect(drawn).not.toContain('[whatsNew.v030.strengthThisWeek]');
    expect(drawn).not.toContain('[whatsNew.v030.strengthLastWeek]');
  });
});
