/**
 * Scenario: a stats grid card and a chart chip are each one pressable, so a
 * screen reader speaks their label in place of what they draw.
 *
 * Expected behaviour: the label carries the value the element draws, not the
 * bare title.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { StatCard } from '@/features/activity/components/stats/StatCard';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the stats grid card label', () => {
  it('speaks the title, the value and the context', () => {
    const tree = render(
      <StatCard
        stat={{
          title: 'Power',
          value: '245',
          context: 'Above your average',
          icon: 'lightning-bolt',
          color: '#000000',
        }}
        isDark={false}
        onPress={() => {}}
      />
    );
    expect(tree.getByRole('button').props.accessibilityLabel).toBe(
      'Power, 245, Above your average'
    );
  });

  it('speaks no empty context', () => {
    const tree = render(
      <StatCard
        stat={{ title: 'Power', value: '245', icon: 'lightning-bolt', color: '#000000' }}
        isDark={false}
        onPress={() => {}}
      />
    );
    expect(tree.getByRole('button', { name: 'Power, 245' })).toBeTruthy();
  });
});

describe('the chart chip label', () => {
  const power = CHART_CONFIGS.power;

  it('speaks the visible value with its unit, not the width reserve', () => {
    const tree = render(
      <ChartTypeSelector
        available={[power]}
        selected={['power']}
        onToggle={() => {}}
        metricValues={[{ id: 'power', value: '212', unit: 'W', maxValueWidth: '1888' }]}
      />
    );
    const label = tree.getByTestId('chart-type-power').props.accessibilityLabel as string;
    expect(label).toMatch(/212 W/);
    expect(label).not.toMatch(/1888/);
  });

  it('speaks the stream name alone when the chip carries no value', () => {
    const tree = render(
      <ChartTypeSelector available={[power]} selected={[]} onToggle={() => {}} />
    );
    expect(tree.getByTestId('chart-type-power').props.accessibilityLabel).toBe('Power');
  });
});
