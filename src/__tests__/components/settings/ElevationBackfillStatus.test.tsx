/**
 * The retry line names how many activity tracks failed, so it has to agree with
 * that count. It runs against the real catalogue rather than a stubbed `t`,
 * which is what proves the sentence comes from i18n and not from the component.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { ElevationBackfillStatus } from '@/features/settings/components/ElevationBackfillStatus';
import type { ElevationBackfillState } from '@/features/routes/hooks/useElevationBackfill';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockUseElevationBackfill = jest.fn();
jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => mockUseElevationBackfill(),
}));

function partialRun(failed: number): ElevationBackfillState {
  return { phase: 'partial', completed: 10, total: 10 + failed, failed, isRunning: false };
}

function statusText(): string {
  const tree = render(<ElevationBackfillStatus />);
  return tree.getByTestId('elevation-backfill-status').props.children as string;
}

describe('ElevationBackfillStatus retry line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('reads as a singular when one track failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(1));
    expect(statusText()).toBe('1 activity track could not be updated. It will be retried later.');
  });

  it('reads as a plural when more than one track failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(4));
    expect(statusText()).toBe(
      '4 activity tracks could not be updated. They will be retried later.'
    );
  });

  it('drops the count entirely when nothing failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(0));
    expect(statusText()).toBe(
      'Some activity tracks still need elevation. They will be retried later.'
    );
  });

  it('pluralises in every locale, never leaving a raw placeholder', async () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(1));
    for (const locale of ['fr', 'de-DE', 'ja', 'pl', 'zh-Hans'] as const) {
      await changeLanguage(locale);
      const text = statusText();
      expect(text).not.toContain('{{');
      expect(text).toContain('1');
    }
  });
});
