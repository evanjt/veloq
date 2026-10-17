import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SectionEncounter } from 'veloqrs';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import type { SectionEncounterGroup } from '@/features/activity/lib/groupSectionEncounters';
import { swipeAction } from '@/theme';

const mockSectionInlinePlot = jest.fn((_props: unknown) => null);
const mockDisableSection = jest.fn(() => true);

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: (props: unknown) => mockSectionInlinePlot(props),
}));
jest.mock('@/features/routes', () => ({
  ...jest.requireActual('@/features/routes/components/SectionSwipeAction'),
  DataRangeFooter: () => null,
  removeSectionWithUndo: jest.requireActual('@/features/routes/lib/sectionVisibility')
    .removeSectionWithUndo,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ disableSection: mockDisableSection }),
}));

function encounter(sectionId: string, sectionType: string): SectionEncounter {
  return {
    sectionId,
    sectionType,
    sectionName: 'Hill',
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
  } as SectionEncounter;
}

async function plotProps(sectionId: string, sectionType: string, removeSection: jest.Mock) {
  mockSectionInlinePlot.mockClear();
  await render(
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={[encounter(sectionId, sectionType)]}
      coordinates={[]}
      isDark={false}
      isMetric
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={jest.fn()}
      onSectionCreationModeChange={jest.fn()}
      removeSection={removeSection}
      scanMatches={[]}
      hasScanned={false}
      onScan={jest.fn()}
      onRematch={jest.fn()}
    />
  );

  const received = mockSectionInlinePlot.mock.calls[0]?.[0];
  if (!received) throw new Error('SectionInlinePlot was not rendered');
  return received as {
    group: SectionEncounterGroup;
    renderRightActions: (
      group: SectionEncounterGroup,
      progress: unknown,
      dragX: { interpolate: (args: unknown) => number }
    ) => React.ReactNode;
    actionsFor: (
      group: SectionEncounterGroup
    ) => { name: string; label: string; run: () => void }[];
  };
}

async function swipeActions(sectionId: string, sectionType: string, removeSection: jest.Mock) {
  const props = await plotProps(sectionId, sectionType, removeSection);
  const actions = props.renderRightActions(props.group, null, { interpolate: () => 1 });
  if (!React.isValidElement(actions)) throw new Error('Swipe actions were not rendered');
  return await render(actions);
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

/** The label's ink against the fill of the action it sits on. */
function labelContrast(swipe: ReturnType<typeof render>, label: string): number {
  const text = swipe.getByText(label);
  const ink = StyleSheet.flatten(text.props.style).color as string;
  for (let node = text.parent; node; node = node.parent) {
    const fill = StyleSheet.flatten(node.props.style)?.backgroundColor;
    if (typeof fill === 'string') return contrastRatio(ink, fill);
  }
  throw new Error(`nothing is drawn behind ${label}`);
}

describe('activity section swipe actions', () => {
  it.each([
    ['custom', 'common.delete'],
    ['auto', 'common.remove'],
  ])('draws the %s section action label at 4.5:1 on its fill', async (sectionType, label) => {
    const swipe = await swipeActions('s1', sectionType, jest.fn());

    expect(labelContrast(swipe, label)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws removing a detected section as the sections list draws it', async () => {
    const swipe = await swipeActions('s1', 'auto', jest.fn());
    const text = swipe.getByText('common.remove');
    let fill: unknown;
    for (let node = text.parent; node && fill === undefined; node = node.parent) {
      fill = StyleSheet.flatten(node.props.style)?.backgroundColor;
    }

    expect(fill).toBe(swipeAction.hide.bg);
    expect(StyleSheet.flatten(text.props.style).color).toBe(swipeAction.hide.text);
    expect(swipe.UNSAFE_getByType(MaterialCommunityIcons).props.name).toBe('minus-circle-outline');
  });

  it('exposes the scan action and blocks a second press while scanning', async () => {
    let finishScan: (() => void) | undefined;
    const onScan = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishScan = resolve;
        })
    );
    const screen = await render(
      <ActivitySectionsSection
        activityId="a1"
        sportType="Ride"
        encounters={[]}
        coordinates={[]}
        isDark={false}
        isMetric
        sectionCreationMode={false}
        cacheDays={30}
        highlightedSectionId={null}
        onHighlightedSectionIdChange={jest.fn()}
        onSectionCreationModeChange={jest.fn()}
        removeSection={jest.fn()}
        scanMatches={[]}
        hasScanned={false}
        onScan={onScan}
        onRematch={jest.fn()}
      />
    );

    const scanButton = () => screen.getByRole('button', { name: 'sections.scanForMatches' });
    await fireEvent.press(scanButton());
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    expect(scanButton().props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(scanButton());
    expect(onScan).toHaveBeenCalledTimes(1);
    await act(async () => finishScan?.());
    expect(scanButton().props.accessibilityState).toMatchObject({ busy: false });
  });

  it('deletes a custom section after confirmation even with a nonstandard id', async () => {
    const removeSection = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const swipe = await swipeActions('foreign-id', 'custom', removeSection);

    await fireEvent.press(swipe.getByText('common.delete'));
    expect(alert).toHaveBeenCalledWith(
      'sections.deleteSection',
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cancelable: true })
    );
    const buttons = alert.mock.calls[0][2];
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(removeSection).toHaveBeenCalledWith('foreign-id'));
    alert.mockRestore();
  });

  it('reports a failed deletion and lets the athlete retry', async () => {
    const removeSection = jest
      .fn()
      .mockRejectedValueOnce(new Error('Delete failed'))
      .mockResolvedValueOnce(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const swipe = await swipeActions('foreign-id', 'custom', removeSection);

    await fireEvent.press(swipe.getByText('common.delete'));
    alert.mock.calls[0][2]?.find((button) => button.style === 'destructive')?.onPress?.();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'sections.deleteFailedTitle',
        'sections.deleteFailed',
        undefined,
        expect.objectContaining({ cancelable: true })
      )
    );

    await fireEvent.press(swipe.getByText('common.delete'));
    alert.mock.calls[2][2]?.find((button) => button.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(removeSection).toHaveBeenCalledTimes(2));
    alert.mockRestore();
  });

  it('only offers Remove for an auto section', async () => {
    const removeSection = jest.fn();
    const swipe = await swipeActions('custom_legacy', 'auto', removeSection);

    expect(swipe.getByText('common.remove')).toBeTruthy();
    expect(swipe.queryByText('common.delete')).toBeNull();
    await fireEvent.press(swipe.getByText('common.remove'));
    expect(mockDisableSection).toHaveBeenCalledWith('custom_legacy');
    expect(removeSection).not.toHaveBeenCalled();
  });

  it('offers a screen reader the action the swipe shows, running the same handler', async () => {
    const removeSection = jest.fn();
    const hide = await plotProps('auto-1', 'auto', removeSection);
    const [hideAction, ...noMore] = hide.actionsFor(hide.group);

    expect(noMore).toEqual([]);
    expect(hideAction).toMatchObject({ name: 'remove', label: 'common.remove' });
    hideAction.run();
    expect(mockDisableSection).toHaveBeenCalledWith('auto-1');

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const custom = await plotProps('custom-1', 'custom', removeSection);
    const [deleteAction] = custom.actionsFor(custom.group);
    expect(deleteAction).toMatchObject({ name: 'delete', label: 'common.delete' });
    deleteAction.run();
    expect(alert).toHaveBeenCalledWith(
      'sections.deleteSection',
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cancelable: true })
    );
    alert.mockRestore();
  });
});
