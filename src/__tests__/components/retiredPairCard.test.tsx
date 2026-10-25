/**
 * Scenario: a tapped line on the retired layer names the sections paired with it.
 *
 * Expected behaviour: each pair is a button whose label is the sentence the card shows, the
 * wording follows which side was tapped, a ground pair carries its overlap, a hidden row says so,
 * and a section on nobody's ground says that instead.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RetiredPairCard } from '@/features/routes/components/preview/RetiredPairCard';
import type { RetiredSelection } from '@/features/routes/lib/retiredLineCollection';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const RETIRED: RetiredSelection = {
  id: 'old',
  kind: 'retired',
  name: 'Old Lake Loop',
  pairs: [
    { id: 'a', name: 'Lake Loop', kind: 'current', link: 'ground', overlap: 0.82, hidden: false },
    { id: 'b', name: null, kind: 'current', link: 'supersedes', overlap: null, hidden: true },
  ],
};

describe('the retired pair card', () => {
  it('lists each pair as a button and follows the one pressed', async () => {
    const onSelect = jest.fn();
    const tree = await render(
      <RetiredPairCard selection={RETIRED} onSelect={onSelect} onClose={jest.fn()} />
    );

    expect(tree.getByTestId('retired-pair-a').props.accessibilityRole).toBe('button');
    expect(tree.getByTestId('retired-pair-b').props.accessibilityRole).toBe('button');

    await fireEvent.press(tree.getByTestId('retired-pair-a'));

    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('words a retired section’s pairs from its side and a current section’s from the other', async () => {
    const retired = await render(
      <RetiredPairCard selection={RETIRED} onSelect={jest.fn()} onClose={jest.fn()} />
    );
    expect(retired.getByTestId('retired-pair-b').props.accessibilityLabel).toBe(
      'sectionHistory.pairRetiredSupersedes'
    );

    const current = await render(
      <RetiredPairCard
        selection={{
          id: 'new',
          kind: 'current',
          name: 'Lake Loop',
          pairs: [
            { id: 'o', name: 'Old', kind: 'retired', link: 'ledger', overlap: null, hidden: false },
          ],
        }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(current.getByTestId('retired-pair-o').props.accessibilityLabel).toBe(
      'sectionHistory.pairCurrentLedger'
    );
  });

  it('says a section shares its ground with nothing', async () => {
    const tree = await render(
      <RetiredPairCard
        selection={{ ...RETIRED, pairs: [] }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(tree.getByTestId('retired-pair-none')).toBeTruthy();
    expect(tree.queryByTestId('retired-pair-a')).toBeNull();
  });

  it('closes from its close button', async () => {
    const onClose = jest.fn();
    const tree = await render(
      <RetiredPairCard selection={RETIRED} onSelect={jest.fn()} onClose={onClose} />
    );

    await fireEvent.press(tree.getByTestId('retired-pair-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
