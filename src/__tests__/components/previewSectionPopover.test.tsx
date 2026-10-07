/**
 * Scenario: a proposed section has no name and no number yet, so the card
 * header rendered empty and two proposals could not be told apart.
 *
 * Expected behaviour: a nameless proposal reads "New section N" by its place
 * among the run's new rows, and a named row keeps its own name.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { initializeI18n } from '@/i18n';
import { PreviewSectionPopover } from '@/features/routes/components/preview/PreviewSectionPopover';
import { previewNewNumber } from '@/features/routes/lib/previewNewNumber';
import type { PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

function row(over: Partial<PreviewSection>): PreviewSection {
  return {
    id: 'p1',
    liveId: null,
    status: 'new',
    name: null,
    polyline: new ArrayBuffer(0),
    visits: 3,
    distanceM: 1200,
    elevationGainM: null,
    avgGradePercent: null,
    pinned: false,
    ...over,
  };
}

describe('the preview section card header', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('heads a nameless proposal by its number', () => {
    const { getByText, queryByText } = render(
      <PreviewSectionPopover section={row({})} newNumber={2} onClose={() => {}} />
    );
    expect(getByText('New section 2')).toBeTruthy();
    expect(queryByText(/\{\{/)).toBeNull();
  });

  it('keeps the name of a matched row', () => {
    const { getByText } = render(
      <PreviewSectionPopover
        section={row({ status: 'changed', name: 'Section 7', liveId: 'l7' })}
        newNumber={null}
        onClose={() => {}}
      />
    );
    expect(getByText('Section 7')).toBeTruthy();
  });
});

describe('previewNewNumber', () => {
  const rows = [
    row({ id: 'a', status: 'unchanged', name: 'Section 1' }),
    row({ id: 'b' }),
    row({ id: 'c', status: 'gone', name: 'Section 2' }),
    row({ id: 'd' }),
  ];

  it('counts only new rows, in engine order', () => {
    expect(previewNewNumber(rows, rows[1])).toBe(1);
    expect(previewNewNumber(rows, rows[3])).toBe(2);
  });

  it('gives no number to other statuses or no selection', () => {
    expect(previewNewNumber(rows, rows[0])).toBeNull();
    expect(previewNewNumber(rows, null)).toBeNull();
  });
});
