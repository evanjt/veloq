/**
 * Scenario: an athlete on imperial units taps a 4210 m section on the map.
 * Expected behaviour: the popup shows miles, not metres.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockMetric = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockMetric,
}));

const SECTION = {
  id: 's1',
  sectionType: 'auto',
  name: 'Hill',
  sportTypes: ['Run'],
  polyline: [],
  distanceMeters: 4210,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
} as FrequentSection;

function popupText(): string {
  const { toJSON } = render(
    <SectionPopup section={SECTION} bottom={0} onClose={() => undefined} />
  );
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') walk((node as { children?: unknown }).children);
  };
  walk(toJSON());
  return texts.join('');
}

describe('SectionPopup distance', () => {
  it('shows miles under imperial units', () => {
    mockMetric = false;
    expect(popupText()).toContain('2.6');
    expect(popupText()).not.toContain('4210');
  });

  it('shows kilometres under metric units', () => {
    mockMetric = true;
    expect(popupText()).toContain('4.2');
  });
});
