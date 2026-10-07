/**
 * Scenario: a re-cut on a section recorded the activity among those around
 * it, and the athlete opens that activity.
 *
 * Expected behaviour: the sections tab lists the change under the "around this
 * change" wording, names how the row names the activity, and opens the section.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ActivityLedgerChange } from 'veloqrs';

import { ActivityLedgerChanges } from '@/features/activity/components/ActivityLedgerChanges';
import { navigateTo } from '@/shared/app/navigation';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

function change(overrides: Partial<ActivityLedgerChange>): ActivityLedgerChange {
  return {
    eventId: 1,
    sectionId: 's1',
    sectionName: 'Lake loop',
    sectionType: 'auto',
    at: '2026-08-20 10:00:00',
    kind: 'recut',
    relation: 'around',
    ...overrides,
  };
}

describe('ActivityLedgerChanges', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders nothing when no change names the activity', () => {
    const { queryByTestId } = render(<ActivityLedgerChanges changes={[]} isDark={false} />);
    expect(queryByTestId('activity-ledger-changes')).toBeNull();
  });

  it('lists each change with its section and opens that section', () => {
    const unnamed = change({
      eventId: 2,
      sectionId: 's2',
      kind: 'reference_reanchored',
      relation: 'reanchored_from',
    });
    delete unnamed.sectionName;
    const { getByTestId, getByText, queryByText } = render(
      <ActivityLedgerChanges
        changes={[change({ eventId: 1, relation: 'fork_around' }), unnamed]}
        isDark={false}
      />
    );
    expect(getByText('sectionHistory.around')).toBeTruthy();
    expect(getByText('Lake loop')).toBeTruthy();
    expect(getByText('sectionHistory.kind_recut')).toBeTruthy();
    expect(getByText('sectionHistory.forkAround')).toBeTruthy();
    expect(getByText('sectionHistory.kind_reference_reanchored')).toBeTruthy();
    expect(queryByText('sectionHistory.kind_split')).toBeNull();

    fireEvent.press(getByTestId('activity-ledger-change-2'));
    expect(navigateTo).toHaveBeenCalledWith('/section/s2');
  });

  it('leaves out the kind label of a change that needs a count the row does not carry', () => {
    const { getAllByText, queryByText } = render(
      <ActivityLedgerChanges
        changes={[change({ kind: 'split' }), change({ eventId: 2, kind: 'reverted' })]}
        isDark={false}
      />
    );
    expect(getAllByText('Lake loop')).toHaveLength(2);
    expect(queryByText('sectionHistory.kind_split')).toBeNull();
    expect(queryByText('sectionHistory.kind_reverted')).toBeNull();
  });
});
