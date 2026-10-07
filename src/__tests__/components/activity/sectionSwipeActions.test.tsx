import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { SectionEncounter } from 'veloqrs';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import type { SectionEncounterGroup } from '@/features/activity/lib/groupSectionEncounters';

const mockSectionInlinePlot = jest.fn((_props: unknown) => null);
const mockDisableSection = jest.fn();

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: (props: unknown) => mockSectionInlinePlot(props),
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
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

function swipeActions(sectionId: string, sectionType: string, removeSection: jest.Mock) {
  mockSectionInlinePlot.mockClear();
  render(
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
  const props = received as {
    group: SectionEncounterGroup;
    renderRightActions: (
      group: SectionEncounterGroup,
      progress: unknown,
      dragX: { interpolate: (args: unknown) => number }
    ) => React.ReactNode;
  };
  const actions = props.renderRightActions(props.group, null, { interpolate: () => 1 });
  if (!React.isValidElement(actions)) throw new Error('Swipe actions were not rendered');
  return render(actions);
}

describe('activity section swipe actions', () => {
  it('deletes a custom section after confirmation even with a nonstandard id', async () => {
    const removeSection = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const swipe = swipeActions('foreign-id', 'custom', removeSection);

    fireEvent.press(swipe.getByText('common.delete'));
    expect(alert).toHaveBeenCalledWith(
      'sections.deleteSection',
      expect.any(String),
      expect.any(Array)
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
    const swipe = swipeActions('foreign-id', 'custom', removeSection);

    fireEvent.press(swipe.getByText('common.delete'));
    alert.mock.calls[0][2]?.find((button) => button.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('common.error', 'Error: Delete failed'));

    fireEvent.press(swipe.getByText('common.delete'));
    alert.mock.calls[2][2]?.find((button) => button.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(removeSection).toHaveBeenCalledTimes(2));
    alert.mockRestore();
  });

  it('only offers Hide for an auto section', () => {
    const removeSection = jest.fn();
    const swipe = swipeActions('custom_legacy', 'auto', removeSection);

    expect(swipe.getByText('common.hide')).toBeTruthy();
    expect(swipe.queryByText('common.delete')).toBeNull();
    fireEvent.press(swipe.getByText('common.hide'));
    expect(mockDisableSection).toHaveBeenCalledWith('custom_legacy');
    expect(removeSection).not.toHaveBeenCalled();
  });
});
