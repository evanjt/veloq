/**
 * Scenario: a preview pool of one activity read "1 activities analysed" and a
 * single unreadable track read "1 tracks could not be read".
 *
 * Expected behaviour: both lines take the singular at one and the plural
 * otherwise, through the real i18n instance rather than an echo of the key.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { initializeI18n } from '@/i18n';
import { PreviewRunCost } from '@/features/routes/components/preview/PreviewRunCost';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

describe('the preview run cost sentences', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('reads one analysed activity in the singular', () => {
    const { getByTestId } = render(
      <PreviewRunCost pool={{ activities: 1, empty: 0, unreadable: 0 }} elapsedMs={40} />
    );
    expect(getByTestId('preview-run-cost').props.children).toBe('1 activity analysed in 40 ms');
  });

  it('reads two analysed activities in the plural', () => {
    const { getByTestId } = render(
      <PreviewRunCost pool={{ activities: 2, empty: 0, unreadable: 0 }} elapsedMs={40} />
    );
    expect(getByTestId('preview-run-cost').props.children).toBe('2 activities analysed in 40 ms');
  });

  it('reads one unreadable track in the singular', () => {
    const { getByTestId } = render(
      <PreviewRunCost pool={{ activities: 5, empty: 0, unreadable: 1 }} elapsedMs={40} />
    );
    expect(getByTestId('preview-run-unreadable').props.children).toBe('1 track could not be read');
  });

  it('reads two unreadable tracks in the plural', () => {
    const { getByTestId } = render(
      <PreviewRunCost pool={{ activities: 5, empty: 0, unreadable: 2 }} elapsedMs={40} />
    );
    expect(getByTestId('preview-run-unreadable').props.children).toBe('2 tracks could not be read');
  });
});
