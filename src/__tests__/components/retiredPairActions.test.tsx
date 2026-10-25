/**
 * Scenario: a tapped retired or current line offers the writes that settle its pairs.
 *
 * Expected behaviour: a retired section offers Restore when the engine named a version, each pair
 * offers both Prefer actions, a current section in the card or among the pairs offers Remove, and
 * a section with no pair offers Restore alone. Every action is a button whose label names the
 * sections it acts on, and each press hands the ids to the owner of the write.
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
  restorableVersion: 3,
  pairs: [
    { id: 'new', name: 'Lake Loop', kind: 'current', link: 'ground', overlap: 0.8, hidden: false },
  ],
};

function actions(overrides: Partial<React.ComponentProps<typeof RetiredPairCard>> = {}) {
  return {
    onSelect: jest.fn(),
    onClose: jest.fn(),
    onRestore: jest.fn(),
    onPrefer: jest.fn(),
    onRemove: jest.fn(),
    ...overrides,
  };
}

describe('the retired pair card actions', () => {
  it('offers both Prefer actions and Restore on a retired section with a ground pair', async () => {
    const props = actions();
    const tree = await render(<RetiredPairCard selection={RETIRED} {...props} />);

    await fireEvent.press(tree.getByTestId('retired-pair-prefer-current-new'));
    expect(props.onPrefer).toHaveBeenLastCalledWith('new', 'old');

    await fireEvent.press(tree.getByTestId('retired-pair-prefer-this-new'));
    expect(props.onPrefer).toHaveBeenLastCalledWith('old', 'new');

    await fireEvent.press(tree.getByTestId('retired-restore'));
    expect(props.onRestore).toHaveBeenCalledWith('old', 3);
  });

  it('removes the current section of a pair', async () => {
    const props = actions();
    const tree = await render(<RetiredPairCard selection={RETIRED} {...props} />);

    await fireEvent.press(tree.getByTestId('retired-pair-remove-new'));

    expect(props.onRemove).toHaveBeenCalledWith('new');
    expect(tree.queryByTestId('retired-remove')).toBeNull();
  });

  it('removes a tapped current section, and offers no Restore on it', async () => {
    const props = actions();
    const tree = await render(
      <RetiredPairCard
        selection={{
          id: 'new',
          kind: 'current',
          name: 'Lake Loop',
          restorableVersion: null,
          pairs: [
            {
              id: 'old',
              name: 'Old Lake Loop',
              kind: 'retired',
              link: 'ledger',
              overlap: null,
              hidden: false,
            },
          ],
        }}
        {...props}
      />
    );

    await fireEvent.press(tree.getByTestId('retired-remove'));
    expect(props.onRemove).toHaveBeenCalledWith('new');
    expect(tree.queryByTestId('retired-restore')).toBeNull();
    expect(tree.queryByTestId('retired-pair-remove-old')).toBeNull();

    await fireEvent.press(tree.getByTestId('retired-pair-prefer-this-old'));
    expect(props.onPrefer).toHaveBeenCalledWith('new', 'old');
  });

  it('offers Restore alone on a retired section with no pair', async () => {
    const tree = await render(
      <RetiredPairCard selection={{ ...RETIRED, pairs: [] }} {...actions()} />
    );

    expect(tree.getByTestId('retired-restore')).toBeTruthy();
    expect(tree.queryByTestId('retired-pair-prefer-this-new')).toBeNull();
    expect(tree.queryByTestId('retired-pair-remove-new')).toBeNull();
  });

  it('offers no Restore when the engine named no version', async () => {
    const tree = await render(
      <RetiredPairCard selection={{ ...RETIRED, restorableVersion: null }} {...actions()} />
    );

    expect(tree.queryByTestId('retired-restore')).toBeNull();
  });

  it('gives every action a button role and a label naming its sections', async () => {
    const tree = await render(<RetiredPairCard selection={RETIRED} {...actions()} />);

    for (const id of [
      'retired-pair-prefer-current-new',
      'retired-pair-prefer-this-new',
      'retired-pair-remove-new',
      'retired-restore',
    ]) {
      const node = tree.getByTestId(id);
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toMatch(/^sectionHistory\./);
    }
    expect(tree.getByTestId('retired-pair-prefer-current-new').props.accessibilityLabel).toBe(
      'sectionHistory.pairPreferLabel'
    );
  });
});
