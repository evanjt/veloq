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
