/**
 * Scenario: Section 63 crossed forward and back filled cards 1 and 2 on the
 * activity Sections tab, so one section carried two index numbers.
 *
 * Expected behaviour: one card per section, one index, and a row per
 * direction inside it.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, type RenderAPI } from '@testing-library/react-native';

import { SectionInlinePlot } from '@/features/activity/components/SectionInlinePlot';
import { groupSectionEncounters } from '@/features/activity/lib/groupSectionEncounters';
import { sectionPalette, sectionPaletteIndex } from '@/theme';
import type { SectionEncounter } from 'veloqrs';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/features/routes/components/section/SectionSparkline', () => ({
  SectionSparkline: () => null,
}));

function encounter(overrides: Partial<SectionEncounter> & { sectionId: string }): SectionEncounter {
  return {
    sectionType: 'auto',
    sectionName: 'Mont d’Orge',
    direction: 'same',
    distanceMeters: 1200,
    startIndex: 0,
    lapTime: 140,
    lapPace: 2.3,
    isPr: false,
    isComplete: true,
    visitCount: 8,
    historyTimes: [],
    historyActivityIds: [],
    ...overrides,
  };
}

function renderGroup(
  encounters: SectionEncounter[],
  index = 0,
  sportType = 'Ride',
  isDark = false,
  actionsFor: () => { name: string; label: string; run: () => void }[] = () => []
) {
  const [group] = groupSectionEncounters(encounters);
  return render(
    <SectionInlinePlot
      group={group}
      activityId="act-1"
      sportType={sportType}
      index={index}
      isHighlighted={false}
      isDark={isDark}
      isMetric
      onPress={jest.fn()}
      onSwipeableOpen={jest.fn()}
      renderRightActions={() => null}
      actionsFor={actionsFor}
      swipeableRefs={{ current: new Map() }}
    />
  );
}

function relativeLuminance(hex: string): number {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour of a piece of text and of the nearest fill drawn behind it. */
function inkAndGround(screen: RenderAPI, text: string): [string, string] {
  const label = screen.getByText(text);
  const ink = StyleSheet.flatten(label.props.style)?.color as string;
  for (let node = label.parent; node; node = node.parent) {
    const style = typeof node.props.style === 'function' ? null : node.props.style;
    const fill = StyleSheet.flatten(style)?.backgroundColor;
    if (typeof fill === 'string' && fill !== 'transparent') return [ink, fill];
  }
  throw new Error(`nothing is drawn behind ${text}`);
}

/** A section id whose palette slot is `slot`, found the way the map finds it. */
function sectionIdInSlot(slot: number): string {
  for (let i = 0; ; i++) {
    if (sectionPaletteIndex(`slot-${i}`) === slot) return `slot-${i}`;
  }
}

describe('SectionInlinePlot', () => {
  it('shows the engine pace for a run even when distance and time imply another pace', async () => {
    const { getByText } = await renderGroup(
      [encounter({ sectionId: 'sec-pace', distanceMeters: 1000, lapTime: 100, lapPace: 2.5 })],
      0,
      'Run'
    );

    expect(getByText('6:40 /km')).toBeTruthy();
  });

  it('shows the engine pace per 100 metres for a swim', async () => {
    const { getByText } = await renderGroup(
      [encounter({ sectionId: 'sec-swim', distanceMeters: 100, lapTime: 100, lapPace: 2.5 })],
      0,
      'Swim'
    );

    expect(getByText('0:40 /100m')).toBeTruthy();
  });

  it('keeps elapsed time for a ride', async () => {
    const { getByText } = await renderGroup([
      encounter({ sectionId: 'sec-ride', lapTime: 140, lapPace: 2.5 }),
    ]);

    expect(getByText('2:20')).toBeTruthy();
  });

  it('shows one index and one name for a section crossed both ways', async () => {
    const { getAllByText, queryByText } = await renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(getAllByText('1')).toHaveLength(1);
    expect(getAllByText('Mont d’Orge')).toHaveLength(1);
    expect(queryByText('2')).toBeNull();
  });

  it('marks each direction inside the card', async () => {
    const { getByText } = await renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(getByText('→')).toBeTruthy();
    expect(getByText('↩')).toBeTruthy();
  });

  it('leaves a single forward crossing unmarked', async () => {
    const { queryByText } = await renderGroup([encounter({ sectionId: 'sec-70' })]);

    expect(queryByText('→')).toBeNull();
    expect(queryByText('↩')).toBeNull();
  });

  it('marks a single reverse crossing, which is not the default direction', async () => {
    const { getByText } = await renderGroup([
      encounter({ sectionId: 'sec-70', direction: 'reverse' }),
    ]);

    expect(getByText('↩')).toBeTruthy();
  });

  it('gives each direction its own trophy, so one PR does not claim both', async () => {
    const { queryByTestId } = await renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same', isPr: true }),
      encounter({ sectionId: 'sec-63', direction: 'reverse', isPr: false }),
    ]);

    expect(queryByTestId('section-inline-trophy-0')).toBeTruthy();
    expect(queryByTestId('section-inline-trophy-0-1')).toBeNull();
  });

  it.each([
    [2, 'sections.placeSecond'],
    [3, 'sections.placeThird'],
  ])('marks place %i beside the trophy slot with its label', async (rank, label) => {
    const { getByTestId, queryByTestId } = await renderGroup([
      encounter({ sectionId: 'sec-podium', rank }),
    ]);

    expect(getByTestId('section-inline-place-0').props.accessibilityLabel).toBe(label);
    expect(queryByTestId('section-inline-trophy-0')).toBeNull();
  });

  it.each([4, undefined])('draws no place mark for rank %s', async (rank) => {
    const { queryByTestId } = await renderGroup([
      encounter({ sectionId: 'sec-podium', ...(rank === undefined ? {} : { rank }) }),
    ]);

    expect(queryByTestId('section-inline-place-0')).toBeNull();
  });

  it('labels an under-coverage pass without a trophy', async () => {
    const { getByTestId, queryByTestId } = await renderGroup([
      encounter({ sectionId: 'sec-short', isComplete: false, isPr: true }),
    ]);

    expect(getByTestId('section-inline-partial-0')).toBeTruthy();
    expect(queryByTestId('section-inline-trophy-0')).toBeNull();
  });

  it('does not label a complete pass as partial', async () => {
    const { queryByTestId } = await renderGroup([encounter({ sectionId: 'sec-full' })]);
    expect(queryByTestId('section-inline-partial-0')).toBeNull();
  });

  it('shows neither direction nor visits for a partial-direction pass', async () => {
    const { getByTestId, queryByText } = await renderGroup([
      encounter({ sectionId: 'sec-short', direction: 'partial', isComplete: false, visitCount: 0 }),
    ]);

    expect(getByTestId('section-inline-partial-0')).toBeTruthy();
    expect(queryByText('→')).toBeNull();
    expect(queryByText('↩')).toBeNull();
    expect(queryByText(/0 routes.visits/)).toBeNull();
  });

  // The index number matches its section's colour on the map, and the palette
  // is drawn for map lines: six of its eight hues are under 3:1 on white.
  it.each(
    sectionPalette.flatMap((hue, slot) => [
      [hue, slot, false],
      [hue, slot, true],
    ])
  )(
    'draws the index number for %s, slot %i, at 4.5:1 on its ground (dark %s)',
    async (_hue, slot, dark) => {
      const screen = await renderGroup(
        [encounter({ sectionId: sectionIdInSlot(slot as number) })],
        0,
        'Ride',
        dark as boolean
      );

      const [ink, ground] = inkAndGround(screen, '1');

      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('keeps the section colour beside the index number', async () => {
    const slot = 5;
    const screen = await renderGroup([encounter({ sectionId: sectionIdInSlot(slot) })]);

    const [, ground] = inkAndGround(screen, '1');

    expect(ground).toBe(sectionPalette[slot]);
  });

  it('speaks each direction with its distance, visits, lap, record and place', async () => {
    const { getByRole } = await renderGroup([
      encounter({
        sectionId: 'sec-63',
        direction: 'same',
        isPr: true,
        historyTimes: [140, 150],
        historyActivityIds: ['act-1', 'act-0'],
      }),
      encounter({ sectionId: 'sec-63', direction: 'reverse', lapTime: 150, rank: 2 }),
    ]);

    expect(getByRole('button').props.accessibilityLabel).toBe(
      'Mont d’Orge, sections.forward, 1.2 km, sections.visitsCount, 2:20, a11y.personalRecord, ' +
        'sections.reverse, 1.2 km, 2:30, sections.placeSecond'
    );
  });

  it('speaks a partial pass as partial and claims no record for it', async () => {
    const { getByRole } = await renderGroup([
      encounter({ sectionId: 'sec-short', isComplete: false, isPr: true }),
    ]);

    expect(getByRole('button').props.accessibilityLabel).toBe(
      'Mont d’Orge, 1.2 km, 2:20, sections.partial'
    );
  });

  it('speaks the record trophy rather than leaving it a bare icon', async () => {
    const { getByTestId } = await renderGroup([encounter({ sectionId: 'sec-pr', isPr: true })]);

    const trophy = getByTestId('section-inline-trophy-0');
    expect(trophy.props.accessible).toBe(true);
    expect(trophy.props.accessibilityLabel).toBe('a11y.personalRecord');
  });

  it('reports the whole card height once, not one height per direction', async () => {
    const onRowHeight = jest.fn();
    const [group] = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);
    const { getByTestId } = await render(
      <SectionInlinePlot
        group={group}
        activityId="act-1"
        index={2}
        isHighlighted={false}
        isDark={false}
        isMetric
        onPress={jest.fn()}
        onSwipeableOpen={jest.fn()}
        onRowHeight={onRowHeight}
        renderRightActions={() => null}
        actionsFor={() => []}
        swipeableRefs={{ current: new Map() }}
      />
    );

    getByTestId('section-inline-plot-2').props.onLayout({
      nativeEvent: { layout: { height: 94 } },
    });

    expect(onRowHeight).toHaveBeenCalledTimes(1);
    expect(onRowHeight).toHaveBeenCalledWith(2, 94);
  });

  it('offers the swipe actions on the card a screen reader focuses', async () => {
    const hide = jest.fn();
    const { getByRole } = await renderGroup(
      [encounter({ sectionId: 'sec-a11y' })],
      0,
      'Ride',
      false,
      () => [{ name: 'hide', label: 'common.hide', run: hide }]
    );
    const card = getByRole('button');

    expect(card.props.accessibilityActions).toEqual([{ name: 'hide', label: 'common.hide' }]);
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'hide' } });
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
