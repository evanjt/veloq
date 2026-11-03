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
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const RETIRED: RetiredSelection = {
  id: 'old',
  kind: 'retired',
  name: 'Old Lake Loop',
  pairs: [
    {
      id: 'a',
      name: 'Lake Loop',
      kind: 'current',
      link: 'ground',
      overlap: 0.82,
      hidden: false,
      distanceMeters: null,
      visitCount: null,
    },
    {
      id: 'b',
      name: null,
      kind: 'current',
      link: 'supersedes',
      overlap: null,
      hidden: true,
      distanceMeters: null,
      visitCount: null,
    },
  ],
};

describe('the retired pair card', () => {
  it('shows a retired section’s length beside its name and on a retired pair', async () => {
    const own = await render(
      <RetiredPairCard
        selection={{ ...RETIRED, distanceMeters: 1250 }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(own.getByTestId('retired-pair-own-stats').props.children).toBe('1.3 km');

    const other = await render(
      <RetiredPairCard
        selection={{
          id: 'new',
          kind: 'current',
          name: 'Lake Loop',
          pairs: [
            {
              id: 'o',
              name: 'Old',
              kind: 'retired',
              link: 'ledger',
              overlap: null,
              hidden: false,
              distanceMeters: 2400,
              visitCount: null,
            },
          ],
        }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(other.getByTestId('retired-pair-stats-o').props.children).toBe('2.4 km');
  });

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
            {
              id: 'o',
              name: 'Old',
              kind: 'retired',
              link: 'ledger',
              overlap: null,
              hidden: false,
              distanceMeters: null,
              visitCount: null,
            },
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

  it('shows the length and passes of both sides, and leaves out a figure it does not hold', async () => {
    const tree = await render(
      <RetiredPairCard
        selection={{
          ...RETIRED,
          distanceMeters: 900,
          visitCount: 7,
          pairs: [
            { ...RETIRED.pairs[0]!, distanceMeters: 1500, visitCount: 4 },
            { ...RETIRED.pairs[1]!, distanceMeters: 800, visitCount: null },
          ],
        }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(tree.getByTestId('retired-pair-own-stats').props.children).toBe('900 m · 7×');
    expect(tree.getByTestId('retired-pair-stats-a').props.children).toBe('1.5 km · 4×');
    expect(tree.getByTestId('retired-pair-stats-b').props.children).toBe('800 m');
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

  it('says the ground is still being worked out rather than that nothing shares it', async () => {
    const empty = await render(
      <RetiredPairCard
        selection={{ ...RETIRED, pairs: [], pairsPending: true }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(empty.getByTestId('retired-pairs-pending')).toBeTruthy();
    expect(empty.queryByTestId('retired-pair-none')).toBeNull();

    const ledgerOnly = await render(
      <RetiredPairCard
        selection={{ ...RETIRED, pairs: RETIRED.pairs.slice(1), pairsPending: true }}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(ledgerOnly.getByTestId('retired-pairs-pending')).toBeTruthy();
    expect(ledgerOnly.getByTestId('retired-pair-b')).toBeTruthy();

    const level = await render(
      <RetiredPairCard selection={RETIRED} onSelect={jest.fn()} onClose={jest.fn()} />
    );
    expect(level.queryByTestId('retired-pairs-pending')).toBeNull();
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
