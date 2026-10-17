/**
 * Scenario: three zones each hold a third of the time. Each share rounded on
 * its own prints 33%, 33% and 33%, which totals 99.
 *
 * Expected behaviour: the cards print the engine's whole shares, which total
 * 100, and do no rounding of their own.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ZoneDistributionChart } from '@/features/stats/components/ZoneDistributionChart';
import { ZoneTimeCard } from '@/features/activity/components/ZoneTimeCard';
import type { ZoneDistribution } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const THIRDS = [
  { seconds: 1200, share: 34 },
  { seconds: 1200, share: 33 },
  { seconds: 1200, share: 33 },
];

const printedShares = (texts: string[]) =>
  texts.filter((text) => /^\d+%$/.test(text)).map((text) => Number(text.slice(0, -1)));

function allText(view: Awaited<ReturnType<typeof render>>): string[] {
  return view
    .UNSAFE_queryAllByType(require('react-native').Text)
    .map((node: { props: { children?: unknown } }) => node.props.children)
    .filter((child: unknown): child is string => typeof child === 'string');
}

describe('zone shares', () => {
  it('the period card prints the shares the engine gave, totalling 100', async () => {
    const data: ZoneDistribution[] = THIRDS.map((band, i) => ({
      zone: i + 1,
      name: `Band ${i + 1}`,
      ...band,
    }));

    const view = await render(<ZoneDistributionChart data={data} type="hr" />);

    const shares = printedShares(allText(view));
    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it('the activity card prints the shares the engine gave, totalling 100', async () => {
    const view = await render(
      <ZoneTimeCard
        title="Zones"
        zoneTotalLabel={(duration) => duration}
        movingTime={3600}
        bands={THIRDS.map((band, i) => ({ zone: i + 1, min: i * 10, max: i * 10 + 10, ...band }))}
        formatRange={(min, max) => `${min}-${max}`}
        chartName="Zones"
      />
    );

    expect(printedShares(allText(view))).toEqual([34, 33, 33]);
  });
});
