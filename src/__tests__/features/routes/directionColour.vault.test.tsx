/**
 * Scenario: forward and reverse each had their own owner. Forward was the
 * action primary, passed down as a prop, and reverse was one pink for both
 * themes, so the dark pages drew the light value.
 *
 * Expected behaviour: one function gives each direction its colour in the theme
 * asked for, the two directions differ in both themes, each holds 3:1 as a mark
 * on the surfaces it is drawn on, and a page in dark draws the dark values.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { directionColour } from '@/features/routes/lib/directionColour';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';
import { DirectionArrow } from '@/features/routes/components/section/DirectionCue';
import { colourTokens } from '@/theme';
import { contrastRatio } from '../../__shared__/contrast';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const THEMES = [
  ['light', false],
  ['dark', true],
] as const;

describe('directionColour', () => {
  it.each(THEMES)('reads the direction pair in %s', (theme, isDark) => {
    expect(directionColour('forward', isDark)).toBe(colourTokens[theme]['direction-forward']);
    expect(directionColour('reverse', isDark)).toBe(colourTokens[theme]['direction-reverse']);
  });

  it.each(THEMES)('draws forward and reverse apart in %s', (_theme, isDark) => {
    expect(directionColour('forward', isDark)).not.toBe(directionColour('reverse', isDark));
  });

  it('gives each direction its own dark value', () => {
    for (const direction of ['forward', 'reverse'] as const) {
      expect(directionColour(direction, true)).not.toBe(directionColour(direction, false));
    }
  });

  it.each(THEMES)('holds 3:1 as a mark on surface and surface-raised in %s', (theme, isDark) => {
    for (const direction of ['forward', 'reverse'] as const) {
      for (const ground of ['surface', 'surface-raised'] as const) {
        expect(
          contrastRatio(directionColour(direction, isDark), colourTokens[theme][ground])
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

const best = (id: string, time: number) => ({
  count: 3,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

const summary: CalendarSummary = {
  years: [
    {
      year: 2026,
      traversalCount: 4,
      activityCount: 4,
      forward: best('lantern-out', 600),
      reverse: best('lantern-back', 610),
      months: [],
    },
  ],
  forwardPr: best('lantern-out', 600),
  reversePr: best('lantern-back', 610),
  sectionDistance: 2000,
};

describe('the calendar card in dark', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws each direction arrow in its dark value', () => {
    const tree = render(
      <SectionStatsCards calendarSummary={summary} isDark basis="speed" recordsSettled />
    );
    const arrows = tree.UNSAFE_getAllByType(DirectionArrow);
    const colourOf = (direction: 'forward' | 'reverse') =>
      new Set(arrows.filter((a) => a.props.direction === direction).map((a) => a.props.color));

    expect(colourOf('forward')).toEqual(new Set([colourTokens.dark['direction-forward']]));
    expect(colourOf('reverse')).toEqual(new Set([colourTokens.dark['direction-reverse']]));
  });
});
