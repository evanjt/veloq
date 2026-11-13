/**
 * Scenario: the decoupling card drew its one figure by hand at the screen title size
 * under a title that repeats the section's, and the section header printed the same
 * figure again above it.
 *
 * Expected behaviour: the card's figure is a `StatTile` under no title of its own, and
 * the efficiency section prints the figure once whether it is open or closed: in the
 * header while closed, in the tile while open.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import { DecouplingChart } from '@/features/stats/components/DecouplingChart';
import { FitnessTrendSections } from '@/features/fitness/components/sections/FitnessTrendSections';
import { StatTile } from '@/shared/ui/StatTile';
import { formatPercent } from '@/shared/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const SOURCE = {
  activityId: 'ride-7',
  name: 'Harbour loop',
  date: '2026-06-02T07:30:00',
  decoupling: 4.37,
};
const PRINTED = formatPercent(SOURCE.decoupling, 1);

describe('the decoupling card', () => {
  it('draws its figure as a stat tile', async () => {
    const view = await render(<DecouplingChart source={SOURCE} />);
    const tile = view.UNSAFE_getByType(StatTile);

    expect(tile.props.value).toBe(PRINTED);
    expect(view.getAllByText(PRINTED)).toHaveLength(1);
  });

  it('carries no title repeating the section it sits in', async () => {
    const view = await render(<DecouplingChart source={SOURCE} />);

    expect(view.queryByText('stats.aerobicDecoupling')).toBeNull();
  });
});

describe('the efficiency section', () => {
  function section(expanded: boolean) {
    return render(
      <FitnessTrendSections
        sportMode="Cycling"
        timeRange="1m"
        powerZones={undefined}
        hrZones={undefined}
        periodCoverage={RangeCoverage.Loaded}
        dominantZone={null}
        zonesExpanded={false}
        onZonesToggle={jest.fn()}
        eftpTrend={undefined}
        eftpCoverage={RangeCoverage.Loaded}
        ftpTrend={null}
        trendsExpanded={false}
        onTrendsToggle={jest.fn()}
        thresholdPace={undefined}
        runLthr={undefined}
        decouplingSource={SOURCE}
        efficiencyExpanded={expanded}
        onEfficiencyToggle={jest.fn()}
      />
    );
  }

  it('prints the figure once while open, in the tile', async () => {
    const view = await section(true);

    expect(view.getAllByText(PRINTED)).toHaveLength(1);
    expect(view.UNSAFE_getByType(StatTile).props.value).toBe(PRINTED);
  });

  it('prints the figure once while closed, in the header', async () => {
    const view = await section(false);

    expect(view.getAllByText(PRINTED)).toHaveLength(1);
  });
});
