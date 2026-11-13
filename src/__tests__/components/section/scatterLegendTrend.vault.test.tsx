import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ScatterLegend } from '@/features/routes/components/section/ScatterLegend';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

it('names the drawn trend and explains its method on tap', async () => {
  const tree = await render(
    <ScatterLegend
      isDark={false}
      direction="forward"
      showRecord={false}
      showThisActivity={false}
      showTrend
    />
  );

  expect(tree.getByText('sections.legendTrend')).toBeTruthy();
  expect(tree.queryByText('sections.legendTrendMethod')).toBeNull();

  await fireEvent.press(tree.getByRole('button', { name: 'sections.legendTrend' }));
  expect(tree.getByText('sections.legendTrendMethod')).toBeTruthy();
});

it('omits the trend explanation when no curve is drawn', async () => {
  const tree = await render(
    <ScatterLegend isDark={false} direction="forward" showRecord={false} showThisActivity={false} />
  );

  expect(tree.queryByText('sections.legendTrend')).toBeNull();
});

it('names the hollow mark as an estimated time only when the plot draws one', async () => {
  const drawn = await render(
    <ScatterLegend
      isDark={false}
      direction="forward"
      showRecord={false}
      showThisActivity={false}
      showEstimated
    />
  );
  expect(drawn.getByTestId('scatter-legend-estimated')).toBeTruthy();
  expect(drawn.getByText('sections.legendEstimated')).toBeTruthy();

  const absent = await render(
    <ScatterLegend isDark={false} direction="forward" showRecord={false} showThisActivity={false} />
  );
  expect(absent.queryByTestId('scatter-legend-estimated')).toBeNull();
});
