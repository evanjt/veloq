import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { darkColors, colorWithOpacity } from '@/theme/colors';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/theme/colors', () => {
  const actual = jest.requireActual('@/theme/colors');
  return { ...actual, darkColors: { ...actual.darkColors, chartFatigue: '#112233' } };
});

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
  useMetricSystem: () => true,
}));

/**
 * Scenario: the dark Custom tag took its ground from the fitness chart's fatigue series, so
 * retuning that series recoloured the tag while its text stayed put.
 * Expected behaviour: the tag ground is the same in dark theme whatever the fatigue series is.
 */

const CUSTOM: FrequentSection = {
  id: 's1',
  sectionType: 'custom',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

function tagGround(): unknown {
  render(<SectionRow section={CUSTOM} />);
  const label = screen.getByText('routes.custom');
  let node: ReactTestInstance | null = label.parent;
  while (node) {
    const bg = StyleSheet.flatten(node.props.style)?.backgroundColor;
    if (bg) return bg;
    node = node.parent;
  }
  return undefined;
}

describe('the dark Custom tag ground', () => {
  it('does not follow the dark fatigue series', () => {
    expect(darkColors.chartFatigue).toBe('#112233');
    expect(tagGround()).toBe(colorWithOpacity('#C084FC', 0.15));
  });
});
