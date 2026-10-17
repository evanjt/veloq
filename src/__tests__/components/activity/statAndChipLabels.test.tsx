/**
 * Scenario: a stats grid card and a chart chip are each one pressable, so a
 * screen reader speaks their label in place of what they draw.
 *
 * Expected behaviour: the label carries the value the element draws, not the
 * bare title. A chip at rest draws the activity's average, and says so where
 * it is drawn and where it is spoken, so it never reads as a live reading.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { StatCard } from '@/features/activity/components/stats/StatCard';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { streamsFromArrays } from '@/features/activity/lib/streams';
import { computeAllAverages } from '@/features/stats/lib/combinedPlotData';
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
        stat={{ title: 'Power', value: '245', icon: 'lightning-bolt' }}
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

describe('the chart chip at rest', () => {
  const power = CHART_CONFIGS.power;
  const streams = streamsFromArrays({ watts: [200, 224], altitude: [100, 130] });

  it('is marked as an average, and the climb chip is not', () => {
    const chips = computeAllAverages(CHART_CONFIGS, streams, true, 30);
    expect(chips.find((c) => c.id === 'power')?.isAverage).toBe(true);
    expect(chips.find((c) => c.id === 'elevation')?.isAverage).toBeFalsy();
  });

  it('draws and speaks the average mark beside the value', () => {
    const [chip] = computeAllAverages({ power } as typeof CHART_CONFIGS, streams, true, 0);
    const tree = render(
      <ChartTypeSelector
        available={[power]}
        selected={['power']}
        onToggle={() => {}}
        metricValues={[chip!]}
      />
    );
    expect(tree.getByTestId('chart-type-power-average')).toBeTruthy();
    expect(tree.getByTestId('chart-type-power').props.accessibilityLabel).toBe(
      'Power, Average 212 W'
    );
  });

  it('drops the mark while scrubbing', () => {
    const tree = render(
      <ChartTypeSelector
        available={[power]}
        selected={['power']}
        onToggle={() => {}}
        metricValues={[{ id: 'power', value: '205', unit: 'W' }]}
      />
    );
    expect(tree.queryByTestId('chart-type-power-average')).toBeNull();
    expect(tree.getByTestId('chart-type-power').props.accessibilityLabel).toBe('Power, 205 W');
  });
});
