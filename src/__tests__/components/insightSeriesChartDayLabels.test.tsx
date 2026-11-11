/**
 * Scenario: engine-fed insight series carry the athlete's own wall clock stamped as UTC. A ride at
 * 23:30 on 5 March is stamped 2026-03-05T23:30Z, and a reader that formats it in the device zone
 * labels it 6 March east of Greenwich.
 *
 * Expected behaviour: the day label is the stamp's UTC day in every zone.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { InsightSeriesChart } from '@/features/insights/components/InsightSeriesChart';
import { formatEpochDayUtc } from '@/shared/format/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const LATE_EVENING = Date.UTC(2026, 2, 5, 23, 30) / 1000;
const EARLY_MORNING = Date.UTC(2026, 2, 9, 0, 30) / 1000;

describe('InsightSeriesChart day labels', () => {
  it('labels a late-evening stamp with the day it was stamped', async () => {
    const tree = await render(
      <InsightSeriesChart
        samples={[
          { value: 2, date: EARLY_MORNING - 86400 * 7 },
          { value: 3, date: LATE_EVENING },
        ]}
        title="Efforts"
        color="#000"
        formatValue={(v) => String(v)}
      />
    );
    const readout = tree.getByTestId('insight-series-readout-date');
    expect(readout.props.children).toBe(formatEpochDayUtc(LATE_EVENING));
    expect(formatEpochDayUtc(LATE_EVENING)).toMatch(/5/);
  });
});
