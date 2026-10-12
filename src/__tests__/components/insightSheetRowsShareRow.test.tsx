/**
 * Scenario: the insight sheets drew each section as a raised, shadowed card
 * with its own 18 pt chevron, so a list of sections in a sheet looked and
 * measured unlike every other list of rows in the app.
 *
 * Expected behaviour: a section that opens the section screen is the shared
 * Row, at least the tap-target height, carrying the shared chevron and no other.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { layout } from '@/theme';
import { tapTo } from '@/shared/app/navigation';
import { Card } from '@/shared/ui/Card';
import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import { EfficiencyTrendContent } from '@/features/insights/components/content/EfficiencyTrendContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import type { Insight, SupportingSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  tapTo: jest.fn(),
}));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));
jest.mock('@/features/routes', () => ({
  useSectionPerformances: () => ({ records: [], bests: null, isLoading: false }),
}));

const SECTIONS: SupportingSection[] = [
  { sectionId: 'hill', sectionName: 'Quarry Hill', bestTime: 312, traversalCount: 9, trend: 1 },
  { sectionId: 'dock', sectionName: 'Dockside', bestTime: 140, traversalCount: 4, trend: -1 },
];

function insight(sections: SupportingSection[]): Insight {
  return { supportingData: { sections } } as unknown as Insight;
}

function rootStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
}

/** Every chevron drawn, each named by the testID it carries. */
function chevronIds(tree: Awaited<ReturnType<typeof render>>) {
  return tree
    .UNSAFE_queryAllByProps({ name: 'chevron-right' })
    .map((node) => node.props.testID as string | undefined);
}

function expectSectionRows(tree: Awaited<ReturnType<typeof render>>, names: string[]) {
  expect(chevronIds(tree)).toEqual(names.map(() => 'row-chevron'));
  for (const name of names) {
    const row = tree.getByRole('button', { name });
    expect(rootStyle(row).minHeight).toBe(layout.minTapTarget);
    expect(rootStyle(row).borderWidth).toBeUndefined();
  }
}

beforeEach(() => {
  jest.mocked(tapTo).mockClear();
});

describe('section rows in the insight sheets', () => {
  it('draws the supporting sections as shared rows that open the section', async () => {
    const tree = await render(<SupportingDataSection data={{ sections: SECTIONS }} />);
    expectSectionRows(tree, ['Quarry Hill', 'Dockside']);
    await fireEvent.press(tree.getByRole('button', { name: 'Dockside' }));
    expect(tapTo).toHaveBeenCalledWith('/section/dock');
  });

  it('draws the stale record sections as shared rows that open the section', async () => {
    const tree = await render(<StalePRContent insight={insight(SECTIONS)} />);
    expectSectionRows(tree, ['Quarry Hill', 'Dockside']);
    await fireEvent.press(tree.getByRole('button', { name: 'Quarry Hill' }));
    expect(tapTo).toHaveBeenCalledWith('/section/hill');
  });

  it('draws the efficiency sheet section link as a shared row', async () => {
    const tree = await render(<EfficiencyTrendContent insight={insight(SECTIONS.slice(0, 1))} />);
    // The supporting list below the link names the same section, so both are rows.
    expect(chevronIds(tree)).toEqual(['row-chevron', 'row-chevron']);
    const rows = tree.getAllByRole('button', { name: 'Quarry Hill' });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(rootStyle(row).minHeight).toBe(layout.minTapTarget);
  });

  it('holds each section trend accordion item in a flat card', async () => {
    const tree = await render(<SectionTrendContent insight={insight(SECTIONS)} />);
    const cards = tree.UNSAFE_queryAllByType(Card);
    expect(cards).toHaveLength(SECTIONS.length);
    for (const card of cards) expect(card.props.variant).toBe('flat');
  });
});
