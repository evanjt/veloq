/**
 * The engine measures every preview run and the numbers used to stop at the
 * FFI. `pool.activities` and `elapsedMs` cross into `PreviewResult` and nothing
 * read either, so a run over a whole riding area looked the same as a run over
 * three rides.
 *
 * The scope line is part of the same surface: the picker chooses a centre and
 * the run covers the component connected to it, which the area box implies is
 * not so.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewRunCost } from '@/features/routes/components/preview/PreviewRunCost';
import type { PreviewResult } from '../../../modules/veloqrs/src/delegates/preview';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

const POOL: PreviewResult['pool'] = { activities: 214, empty: 0, unreadable: 0 };

function renderCost(pool: PreviewResult['pool'], elapsedMs: number) {
  return render(<PreviewRunCost pool={pool} elapsedMs={elapsedMs} />);
}

describe('the preview run cost', () => {
  it('reports the pool the engine loaded and how long it took', () => {
    const { getByTestId } = renderCost(POOL, 3210);
    const text = getByTestId('preview-run-cost').props.children;
    expect(text).toContain('"count":214');
    expect(text).toContain('"duration":"3.2 s"');
  });

  it('says the run is not bounded by the picked area', () => {
    const { getByTestId } = renderCost(POOL, 100);
    expect(getByTestId('preview-run-scope')).toBeTruthy();
  });

  it('holds an unreadable count back until there is one', () => {
    const { queryByTestId } = renderCost(POOL, 100);
    expect(queryByTestId('preview-run-unreadable')).toBeNull();
  });

  it('reports unreadable tracks when the pool carries them', () => {
    const { getByTestId } = renderCost({ activities: 214, empty: 1, unreadable: 3 }, 100);
    expect(getByTestId('preview-run-unreadable').props.children).toContain('"count":3');
  });

  it('reads a single-activity pool as ordinary rather than as an error', () => {
    const { getByTestId, queryByTestId } = renderCost(
      { activities: 1, empty: 0, unreadable: 0 },
      40
    );
    expect(getByTestId('preview-run-cost').props.children).toContain('"count":1');
    expect(queryByTestId('preview-run-unreadable')).toBeNull();
  });

  it('reads a sub-second run in milliseconds rather than as 0.0 s', () => {
    const { getByTestId } = renderCost(POOL, 40);
    expect(getByTestId('preview-run-cost').props.children).toContain('"duration":"40 ms"');
  });
});
